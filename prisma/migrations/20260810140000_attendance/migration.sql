-- Attendance — the record of when people actually worked (Phase 8).
--
-- Thirteen tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step.
--
-- Five decisions in this file are the ones a reviewer should challenge.
--
--   * **A raw event is immutable.** `attendance_time_event` is inserted and read. No repository in
--     this module offers an update for it, a correction writes a *new* event carrying
--     `supersedes_event_id`, and the original stays exactly as it was captured (ADR-0052).
--
--   * **Deduplication is a database constraint, not a check the application makes.**
--     `attendance_time_event_key` is the idempotency boundary the whole ingestion path rests on:
--     a device retry, a mobile offline queue and a re-run import all converge on one row, and two
--     concurrent submissions race here rather than producing two punches (ADR-0053).
--
--   * **An attendance day stores the inputs it was derived from**, not references to whatever those
--     inputs say today. `schedule_version`, `policy_version`, `shift_id`, `calculation_version` and
--     `inputs_digest` are what make a recalculation of March reproduce March — and what make a
--     changed input detectable with no event delivered.
--
--   * **Attendance owns no employment fact.** There is no employee number, no employment status, no
--     contracted hours and no person here. `employment_id` carries a foreign key because it points
--     *backward* to a module Attendance already depends on, which is the rule ADR-0042 states.
--
--   * **No column in this file holds money.** Not a rate, not a multiplier, not an amount. What
--     worked time is worth is Compensation's and Payroll's (ADR-0054).

-- ---------------------------------------------------------------------------------------------
-- Shifts and schedules: what is expected, before anybody has worked it.
-- ---------------------------------------------------------------------------------------------
create table attendance_shift (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  code                varchar(64) not null,
  name                jsonb not null,
  kind                varchar(24) not null,
  -- Wall-clock times. They are meaningless without the zone the schedule supplies, which is why
  -- no shift carries one of its own: two schedules in two countries may share a shift.
  start_local         varchar(5) not null,
  end_local           varchar(5) not null,
  crosses_midnight    boolean not null,
  flex_window_minutes integer,
  core_start_local    varchar(5),
  core_end_local      varchar(5),
  grace_in_minutes    integer not null,
  grace_out_minutes   integer not null,
  -- The authored expectation. Stored rather than computed so a daylight-saving day does not
  -- silently change what was asked of somebody.
  expected_minutes    integer not null,
  status              varchar(24) not null,
  version_number      integer not null,
  published_at        timestamptz(6),
  published_by        varchar(255),
  metadata            jsonb not null default '{}',
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  -- Five kinds, closed. A sixth is a schema change rather than a configuration change, which is
  -- the point: "add a kind" is how a checklist becomes a workflow engine one release at a time,
  -- and it is how a roster becomes a scheduling optimizer.
  constraint attendance_shift_kind_check
    check (kind in ('fixed', 'flexible', 'split', 'night', 'open')),
  constraint attendance_shift_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint attendance_shift_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint attendance_shift_expected_check
    check (expected_minutes >= 0 and expected_minutes <= 1440),
  constraint attendance_shift_grace_check
    check (grace_in_minutes >= 0 and grace_out_minutes >= 0),
  -- A flexible shift is the only kind with a flex window, and it is required for one. A window on
  -- a fixed shift is a rule nobody would find.
  constraint attendance_shift_flex_check
    check ((kind = 'flexible') = (flex_window_minutes is not null)),
  constraint attendance_shift_name_check check (name ? 'en' and name ? 'ar')
);

create unique index attendance_shift_code_key
  on attendance_shift (tenant_id, code, version_number)
  where deleted_at is null;

create index attendance_shift_status_idx on attendance_shift (tenant_id, status);

create table attendance_shift_segment (
  id           uuid primary key default app_uuid_v7(),
  tenant_id    uuid not null,
  shift_id     uuid not null,
  sequence     integer not null,
  kind         varchar(16) not null,
  start_local  varchar(5) not null,
  end_local    varchar(5) not null,
  paid         boolean not null,
  created_at   timestamptz(6) not null,
  created_by   varchar(255) not null,
  updated_at   timestamptz(6) not null,
  updated_by   varchar(255) not null,
  deleted_at   timestamptz(6),
  deleted_by   varchar(255),
  version      integer not null,
  constraint attendance_shift_segment_shift_fk
    foreign key (shift_id) references attendance_shift (id),
  constraint attendance_shift_segment_kind_check check (kind in ('work', 'break')),
  constraint attendance_shift_segment_sequence_check check (sequence > 0),
  -- A work segment is always "paid" in the sense that matters here — it is worked time. The flag
  -- exists for breaks, where paid and unpaid are genuinely different answers.
  constraint attendance_shift_segment_paid_check check (kind = 'break' or paid)
);

create unique index attendance_shift_segment_key
  on attendance_shift_segment (tenant_id, shift_id, sequence)
  where deleted_at is null;

create table attendance_schedule (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  code              varchar(64) not null,
  name              jsonb not null,
  -- The IANA zone the schedule's wall-clock times mean. Required, and this is the decision that
  -- lets Attendance resolve a local date without a work-location model (ADR-0055).
  zone              varchar(64) not null,
  cycle_length_days integer not null,
  -- The civil date at which cycle position 0 begins. What makes a four-week rotation
  -- reconstructable two years later rather than merely plausible.
  cycle_anchor_date date not null,
  status            varchar(24) not null,
  version_number    integer not null,
  published_at      timestamptz(6),
  published_by      varchar(255),
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint attendance_schedule_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint attendance_schedule_cycle_check
    check (cycle_length_days between 1 and 366),
  constraint attendance_schedule_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint attendance_schedule_name_check check (name ? 'en' and name ? 'ar')
);

create unique index attendance_schedule_code_key
  on attendance_schedule (tenant_id, code, version_number)
  where deleted_at is null;

create index attendance_schedule_status_idx on attendance_schedule (tenant_id, status);

create table attendance_schedule_day (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  schedule_id    uuid not null,
  cycle_position integer not null,
  shift_id       uuid not null,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint attendance_schedule_day_schedule_fk
    foreign key (schedule_id) references attendance_schedule (id),
  constraint attendance_schedule_day_shift_fk
    foreign key (shift_id) references attendance_shift (id),
  constraint attendance_schedule_day_position_check check (cycle_position >= 0)
);

-- One shift per cycle position. A position with no row is a rest day, which is why absence of a
-- row is meaningful and a second row would be ambiguous.
create unique index attendance_schedule_day_key
  on attendance_schedule_day (tenant_id, schedule_id, cycle_position)
  where deleted_at is null;

create table attendance_schedule_assignment (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  employment_id  uuid not null,
  schedule_id    uuid not null,
  effective_from date not null,
  effective_to   date,
  reason_code    varchar(64),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  -- Points backward, to a module Attendance already depends on (ADR-0042). It is also what makes
  -- it impossible for Attendance to schedule an employment it invented.
  constraint attendance_schedule_assignment_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_schedule_assignment_schedule_fk
    foreign key (schedule_id) references attendance_schedule (id),
  constraint attendance_schedule_assignment_period_check
    check (effective_to is null or effective_to >= effective_from)
);

-- One assignment may begin on a given date. Overlap beyond that is refused by the application's
-- timeline, which is the only place a range overlap can be checked without an exclusion constraint
-- and a btree_gist extension this product does not otherwise need.
create unique index attendance_schedule_assignment_key
  on attendance_schedule_assignment (tenant_id, employment_id, effective_from)
  where deleted_at is null;

create index attendance_schedule_assignment_employment_idx
  on attendance_schedule_assignment (tenant_id, employment_id, effective_from);

-- ---------------------------------------------------------------------------------------------
-- The roster: an explicit statement that overrides the schedule for one employment on one date.
-- ---------------------------------------------------------------------------------------------
create table attendance_roster_entry (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  employment_id    uuid not null,
  on_date          date not null,
  kind             varchar(24) not null,
  shift_id         uuid,
  reason_code      varchar(64),
  note             varchar(1024),
  swap_of_entry_id uuid,
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint attendance_roster_entry_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_roster_entry_shift_fk
    foreign key (shift_id) references attendance_shift (id),
  constraint attendance_roster_entry_kind_check
    check (kind in ('shift', 'rest', 'holiday', 'off_site')),
  -- A shift entry names a shift and nothing else does. An entry whose kind and reference disagree
  -- is a day nobody can resolve.
  constraint attendance_roster_entry_shift_check
    check ((kind = 'shift') = (shift_id is not null))
);

create unique index attendance_roster_entry_key
  on attendance_roster_entry (tenant_id, employment_id, on_date)
  where deleted_at is null;

create index attendance_roster_entry_date_idx on attendance_roster_entry (tenant_id, on_date);

-- ---------------------------------------------------------------------------------------------
-- The policy: how a tenant wants attendance interpreted. No statutory rule ships here (00B).
-- ---------------------------------------------------------------------------------------------
create table attendance_policy (
  id                                uuid primary key default app_uuid_v7(),
  tenant_id                         uuid not null,
  code                              varchar(64) not null,
  name                              jsonb not null,
  -- `tenant` today. `country_pack` is the value Phase 11.1 writes when it supplies the statutory
  -- version, which is why the column exists now: the substitution needs no schema change.
  source                            varchar(24) not null,
  rounding_minutes                  integer not null,
  rounding_mode                     varchar(16) not null,
  late_tolerance_minutes            integer not null,
  early_departure_tolerance_minutes integer not null,
  duplicate_window_seconds          integer not null,
  clock_skew_tolerance_seconds      integer not null,
  overtime_threshold_minutes        integer not null,
  overtime_requires_approval        boolean not null,
  absence_blocks_approval           boolean not null,
  status                            varchar(24) not null,
  effective_from                    date not null,
  effective_to                      date,
  version_number                    integer not null,
  published_at                      timestamptz(6),
  published_by                      varchar(255),
  metadata                          jsonb not null default '{}',
  created_at                        timestamptz(6) not null,
  created_by                        varchar(255) not null,
  updated_at                        timestamptz(6) not null,
  updated_by                        varchar(255) not null,
  deleted_at                        timestamptz(6),
  deleted_by                        varchar(255),
  version                           integer not null,
  constraint attendance_policy_source_check check (source in ('tenant', 'country_pack')),
  constraint attendance_policy_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint attendance_policy_rounding_check
    check (rounding_minutes >= 0 and rounding_minutes <= 60
           and rounding_mode in ('none', 'nearest', 'down', 'up')),
  constraint attendance_policy_tolerance_check
    check (late_tolerance_minutes >= 0 and early_departure_tolerance_minutes >= 0
           and duplicate_window_seconds >= 0 and clock_skew_tolerance_seconds >= 0
           and overtime_threshold_minutes >= 0),
  constraint attendance_policy_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint attendance_policy_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint attendance_policy_name_check check (name ? 'en' and name ? 'ar')
);

create unique index attendance_policy_code_key
  on attendance_policy (tenant_id, code, version_number)
  where deleted_at is null;

create index attendance_policy_effective_idx
  on attendance_policy (tenant_id, status, effective_from);

-- ---------------------------------------------------------------------------------------------
-- Imports, declared before the events that reference them.
-- ---------------------------------------------------------------------------------------------
create table attendance_import_batch (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  source         varchar(24) not null,
  source_label   varchar(128),
  submitted_at   timestamptz(6) not null,
  submitted_by   varchar(255) not null,
  rows_submitted integer not null,
  rows_created   integer not null,
  rows_skipped   integer not null,
  rows_failed    integer not null,
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint attendance_import_batch_counts_check
    check (rows_submitted >= 0 and rows_created >= 0 and rows_skipped >= 0 and rows_failed >= 0)
);

create index attendance_import_batch_idx on attendance_import_batch (tenant_id, submitted_at);

-- ---------------------------------------------------------------------------------------------
-- The raw event. The highest-volume table in the product, and the one nothing may amend.
-- ---------------------------------------------------------------------------------------------
create table attendance_time_event (
  id                       uuid primary key default app_uuid_v7(),
  tenant_id                uuid not null,
  employment_id            uuid not null,
  kind                     varchar(24) not null,
  source                   varchar(24) not null,
  source_reference         varchar(128),
  device_reference         varchar(128),
  event_key                varchar(200) not null,
  occurred_at              timestamptz(6) not null,
  -- Reported and received are kept apart even when they are equal. A mobile punch queued on an
  -- aeroplane and a turnstile with a drifting clock are both ordinary, and conflating the two
  -- timestamps loses the only evidence that either happened.
  reported_at              timestamptz(6) not null,
  received_at              timestamptz(6) not null,
  clock_skew_seconds       integer not null,
  captured_offline         boolean not null,
  zone                     varchar(64) not null,
  attendance_date          date not null,
  supersedes_event_id      uuid,
  -- Punch location evidence, captured only where a tenant enables it for that source. This is not
  -- an authoritative work location and there is no geofence verdict column: there is no location
  -- model in this product to verify against, and a verdict with nothing behind it would be a
  -- claim (ADR-0055, ADR-0041).
  latitude                 numeric(9, 6),
  longitude                numeric(9, 6),
  location_accuracy_metres integer,
  note                     varchar(1024),
  import_batch_id          uuid,
  metadata                 jsonb not null default '{}',
  created_at               timestamptz(6) not null,
  created_by               varchar(255) not null,
  updated_at               timestamptz(6) not null,
  updated_by               varchar(255) not null,
  deleted_at               timestamptz(6),
  deleted_by               varchar(255),
  version                  integer not null,
  constraint attendance_time_event_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_time_event_supersedes_fk
    foreign key (supersedes_event_id) references attendance_time_event (id),
  constraint attendance_time_event_batch_fk
    foreign key (import_batch_id) references attendance_import_batch (id),
  constraint attendance_time_event_kind_check
    check (kind in ('clock_in', 'clock_out', 'break_start', 'break_end')),
  -- Seven sources, closed. A vendor is not a source: a biometric reader, a turnstile and a QR gate
  -- all arrive as `device`, normalized by an adapter outside this module.
  constraint attendance_time_event_source_check
    check (source in ('web', 'mobile', 'device', 'manual', 'import', 'api', 'correction')),
  constraint attendance_time_event_self_supersede_check
    check (supersedes_event_id is null or supersedes_event_id <> id),
  -- A coordinate is either complete or absent. Half a position is not evidence of anything.
  constraint attendance_time_event_location_check
    check ((latitude is null) = (longitude is null)),
  constraint attendance_time_event_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint attendance_time_event_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180))
);

-- The idempotency boundary the whole ingestion path rests on. A device retry, a mobile offline
-- queue and a re-run import converge on one row; two concurrent submissions race here and the
-- loser reads the winner rather than writing a second punch (ADR-0053).
--
-- Tenant-scoped, deliberately. An index that omitted the tenant would let one customer's punch
-- silently suppress another's — the worst class of isolation failure, because it looks like a
-- business rule.
create unique index attendance_time_event_key
  on attendance_time_event (tenant_id, event_key)
  where deleted_at is null;

create index attendance_time_event_day_idx
  on attendance_time_event (tenant_id, employment_id, attendance_date);
create index attendance_time_event_date_idx
  on attendance_time_event (tenant_id, attendance_date);
create index attendance_time_event_source_idx
  on attendance_time_event (tenant_id, source, received_at);

-- ---------------------------------------------------------------------------------------------
-- The derived day, and the exceptions on it.
-- ---------------------------------------------------------------------------------------------
create table attendance_day (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  employment_id              uuid not null,
  attendance_date            date not null,
  zone                       varchar(64) not null,
  -- The inputs as resolved for this date, by identifier *and version*. A schedule edited in June
  -- must not change what March meant, and storing the live reference alone would let it.
  schedule_id                uuid,
  schedule_version           integer,
  shift_id                   uuid,
  roster_entry_id            uuid,
  policy_id                  uuid,
  policy_version             integer,
  day_kind                   varchar(24) not null,
  expected_start_at          timestamptz(6),
  expected_end_at            timestamptz(6),
  expected_minutes           integer not null,
  expected_break_minutes     integer not null,
  first_in_at                timestamptz(6),
  last_out_at                timestamptz(6),
  worked_minutes             integer not null,
  break_minutes_taken        integer not null,
  paid_break_minutes         integer not null,
  regular_candidate_minutes  integer not null,
  overtime_candidate_minutes integer not null,
  unpaid_minutes             integer not null,
  absence_minutes            integer not null,
  -- What Leave was able to say. `unknown` is a real answer and is not the same as `none`: the
  -- first means nobody can tell, the second means somebody checked (ADR-0056).
  leave_state                varchar(16) not null,
  leave_minutes              integer not null,
  state                      varchar(24) not null,
  approved_at                timestamptz(6),
  approved_by                varchar(255),
  locked_at                  timestamptz(6),
  approval_reference         varchar(64),
  -- Reproducibility, and staleness that is detectable with no event delivered.
  calculation_version        integer not null,
  inputs_digest              varchar(64) not null,
  calculated_at              timestamptz(6),
  inputs_changed_at          timestamptz(6),
  metadata                   jsonb not null default '{}',
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint attendance_day_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_day_schedule_fk
    foreign key (schedule_id) references attendance_schedule (id),
  constraint attendance_day_shift_fk foreign key (shift_id) references attendance_shift (id),
  constraint attendance_day_policy_fk foreign key (policy_id) references attendance_policy (id),
  constraint attendance_day_kind_check
    check (day_kind in ('working', 'rest', 'holiday', 'unscheduled')),
  constraint attendance_day_state_check
    check (state in ('pending', 'calculated', 'under_review', 'approved', 'locked')),
  constraint attendance_day_leave_state_check
    check (leave_state in ('none', 'applied', 'unknown')),
  constraint attendance_day_approval_check
    check ((approved_at is null) = (approved_by is null)),
  -- A locked day has been frozen into a payable snapshot, which cannot happen before approval.
  constraint attendance_day_lock_check
    check (locked_at is null or approved_at is not null),
  constraint attendance_day_minutes_check
    check (worked_minutes >= 0 and expected_minutes >= 0 and regular_candidate_minutes >= 0
           and overtime_candidate_minutes >= 0 and unpaid_minutes >= 0 and absence_minutes >= 0
           and leave_minutes >= 0 and break_minutes_taken >= 0 and paid_break_minutes >= 0),
  -- A day that has been calculated says which algorithm produced it.
  constraint attendance_day_calculation_check
    check (calculated_at is null or calculation_version > 0)
);

-- One result per employment per date. Recalculation replaces the row rather than adding a second,
-- and this is what makes "replace" mean something.
create unique index attendance_day_key
  on attendance_day (tenant_id, employment_id, attendance_date)
  where deleted_at is null;

create index attendance_day_date_idx on attendance_day (tenant_id, attendance_date, state);
create index attendance_day_employment_idx
  on attendance_day (tenant_id, employment_id, attendance_date);

-- The reconciliation read: days whose inputs moved after they were last calculated. Partial, so it
-- indexes the few rows that are stale rather than the millions that are not (ADR-0053).
create index attendance_day_stale_idx
  on attendance_day (tenant_id, inputs_changed_at)
  where inputs_changed_at is not null and deleted_at is null;

create table attendance_day_exception (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  attendance_day_id      uuid not null,
  employment_id          uuid not null,
  attendance_date        date not null,
  kind                   varchar(40) not null,
  severity               varchar(16) not null,
  state                  varchar(16) not null,
  detail                 varchar(1024),
  minutes                integer,
  resolution_reason_code varchar(64),
  resolved_at            timestamptz(6),
  resolved_by            varchar(255),
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint attendance_day_exception_day_fk
    foreign key (attendance_day_id) references attendance_day (id),
  -- Thirteen kinds, closed and checked. Which of them requires whose decision is policy data
  -- evaluated through the shared rule engine; which of them *exist* is product behaviour.
  constraint attendance_day_exception_kind_check
    check (kind in ('missing_clock_in', 'missing_clock_out', 'late_arrival', 'early_departure',
                    'absence_pending_explanation', 'absent_unexplained', 'unscheduled_attendance',
                    'rest_day_work', 'holiday_work', 'duplicate_punch', 'invalid_punch',
                    'clock_skew', 'overtime_candidate', 'undertime',
                    'late_event_after_approval')),
  constraint attendance_day_exception_severity_check
    check (severity in ('information', 'warning', 'blocking')),
  constraint attendance_day_exception_state_check
    check (state in ('open', 'resolved', 'waived', 'superseded')),
  -- A resolved or waived exception names who decided and when. Either half alone is a resolution
  -- nobody can be held to.
  constraint attendance_day_exception_resolution_check
    check ((state in ('resolved', 'waived')) = (resolved_at is not null)),
  constraint attendance_day_exception_resolver_check
    check ((resolved_at is null) = (resolved_by is null))
);

create index attendance_day_exception_queue_idx
  on attendance_day_exception (tenant_id, state, severity, attendance_date);
create index attendance_day_exception_day_idx
  on attendance_day_exception (tenant_id, attendance_day_id);

-- ---------------------------------------------------------------------------------------------
-- Corrections: how an attendance day changes without a raw event ever being rewritten.
-- ---------------------------------------------------------------------------------------------
create table attendance_correction_request (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  employment_id        uuid not null,
  attendance_date      date not null,
  kind                 varchar(24) not null,
  target_event_id      uuid,
  proposed_kind        varchar(24),
  proposed_occurred_at timestamptz(6),
  proposed_minutes     integer,
  reason_code          varchar(64) not null,
  justification        varchar(1024) not null,
  state                varchar(16) not null,
  requested_by         varchar(255) not null,
  requested_at         timestamptz(6) not null,
  decided_by           varchar(255),
  decided_at           timestamptz(6),
  decision_note        varchar(1024),
  resulting_event_id   uuid,
  approval_reference   varchar(64),
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint attendance_correction_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_correction_target_fk
    foreign key (target_event_id) references attendance_time_event (id),
  constraint attendance_correction_result_fk
    foreign key (resulting_event_id) references attendance_time_event (id),
  constraint attendance_correction_kind_check
    check (kind in ('add_event', 'amend_event', 'remove_event', 'manual_day', 'overtime',
                    'shift_swap', 'off_site')),
  constraint attendance_correction_state_check
    check (state in ('requested', 'approved', 'rejected', 'applied', 'withdrawn')),
  -- Amending or removing names what it acts on. Adding does not, and must not.
  constraint attendance_correction_target_check
    check ((kind in ('amend_event', 'remove_event')) = (target_event_id is not null)),
  constraint attendance_correction_decision_check
    check ((decided_at is null) = (decided_by is null)),
  -- A decided request has a decision. Reaching `applied` without one would be an edit.
  constraint attendance_correction_decided_check
    check (state in ('requested', 'withdrawn') or decided_at is not null),
  -- Self-approval is refused by the domain as well, because a control that depends on nobody
  -- holding two roles is a control that fails the first time somebody does.
  constraint attendance_correction_self_approval_check
    check (decided_by is null or decided_by <> requested_by)
);

create index attendance_correction_state_idx
  on attendance_correction_request (tenant_id, state, requested_at);
create index attendance_correction_day_idx
  on attendance_correction_request (tenant_id, employment_id, attendance_date);

-- ---------------------------------------------------------------------------------------------
-- The frozen output Payroll consumes.
-- ---------------------------------------------------------------------------------------------
create table attendance_payable_snapshot (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  employment_id              uuid not null,
  period_start               date not null,
  period_end                 date not null,
  sequence                   integer not null,
  frozen_at                  timestamptz(6) not null,
  frozen_by                  varchar(255) not null,
  worked_minutes             integer not null,
  regular_candidate_minutes  integer not null,
  overtime_candidate_minutes integer not null,
  unpaid_minutes             integer not null,
  absence_minutes            integer not null,
  leave_minutes              integer not null,
  leave_state                varchar(16) not null,
  days_total                 integer not null,
  days_approved              integer not null,
  days_unapproved            integer not null,
  blocking_exceptions        integer not null,
  calculation_version        integer not null,
  inputs_digest              varchar(64) not null,
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint attendance_payable_snapshot_employment_fk
    foreign key (employment_id) references employment (id),
  constraint attendance_payable_snapshot_period_check check (period_end >= period_start),
  constraint attendance_payable_snapshot_sequence_check check (sequence > 0),
  constraint attendance_payable_snapshot_leave_state_check
    check (leave_state in ('none', 'applied', 'unknown'))
);

-- A correction after a freeze produces the *next* sequence rather than altering the one Payroll
-- already read. This index is what makes that a fact rather than an intention.
create unique index attendance_payable_snapshot_key
  on attendance_payable_snapshot (tenant_id, employment_id, period_start, period_end, sequence)
  where deleted_at is null;

create index attendance_payable_snapshot_idx
  on attendance_payable_snapshot (tenant_id, employment_id, period_start);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in this module.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('attendance_shift');
call app_protect_table('attendance_shift_segment');
call app_protect_table('attendance_schedule');
call app_protect_table('attendance_schedule_day');
call app_protect_table('attendance_schedule_assignment');
call app_protect_table('attendance_roster_entry');
call app_protect_table('attendance_policy');
call app_protect_table('attendance_import_batch');
call app_protect_table('attendance_time_event');
call app_protect_table('attendance_day');
call app_protect_table('attendance_day_exception');
call app_protect_table('attendance_correction_request');
call app_protect_table('attendance_payable_snapshot');

comment on table attendance_time_event is
  'One raw time event, exactly as captured. Inserted and read; never updated. A correction writes a new event carrying supersedes_event_id and the original is untouched (ADR-0052).';
comment on index attendance_time_event_key is
  'The idempotency boundary ingestion rests on: a device retry, a mobile offline queue and a re-run import converge on one row (ADR-0053). Tenant-scoped, so one customer cannot suppress another''s punch.';
comment on index attendance_day_stale_idx is
  'The reconciliation read. Event delivery is at-most-once with no outbox, so recalculation is found by asking rather than by being told (ADR-0053).';
comment on column attendance_day.leave_state is
  '`unknown` is a real answer and is not `none`: the first means Leave cannot yet be asked, the second means it was asked and said no leave (ADR-0056).';
comment on column attendance_time_event.latitude is
  'Punch location evidence where a tenant enables capture. Not an authoritative work location, and there is no geofence verdict: no location model exists to verify against (ADR-0055, ADR-0041).';
comment on column attendance_day.approval_reference is
  'Reserved for Workflow (Phase 16). Null while Attendance records the decision of a named human directly, exactly as recruitment_requisition.approval_id and onboarding_task.approval_reference are.';
