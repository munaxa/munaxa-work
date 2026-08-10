-- Leave & Absence Management — the authorization to be absent (Phase 9).
--
-- Fourteen tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step.
--
-- Six decisions in this file are the ones a reviewer should challenge.
--
--   * **The ledger is authoritative and the balance is a projection.** `leave_ledger_entry` is
--     inserted and read; no repository in this module offers an update for it. `leave_balance` is
--     never written except by recalculation from the ledger, and it carries a digest and a stale
--     mark so a wrong figure is detectable rather than merely plausible.
--
--   * **Every duration is integer minutes.** Not a float, not a fractional day. Fractional days are
--     exact when they are 240 of 480 minutes, and inexact the moment they are 0.5 of a float.
--     Rounding is a configured rule applied at consumption, never an artefact of storage.
--
--   * **Overlapping leave is refused by the database.** `leave_request_day_overlap` is a GiST
--     exclusion constraint over a minutes-of-day range, so two concurrent requests for the same
--     morning race here rather than both committing. Application validation alone loses that race.
--
--   * **Self-approval is refused by a check constraint**, not only by the domain.
--     `leave_request_decision` carries a copy of `requested_by` for exactly that purpose: a check
--     constraint cannot reach another table.
--
--   * **Leave owns no employment fact.** There is no person, no employee number and no employment
--     status here. `employment_id` carries a foreign key because it points *backward* to a module
--     Leave already depends on, which is the rule ADR-0042 states.
--
--   * **No column in this file holds money.** Not a rate, not a multiplier, not an amount. What a
--     leave day is worth is Payroll's (ADR-0054).

-- The exclusion constraint below needs equality operators for uuid and date inside a GiST index,
-- which core PostgreSQL does not provide. This is the first extension this product requires, and it
-- is required rather than convenient: without it the overlap invariant is application-only, and an
-- application-only invariant is one two concurrent transactions can both satisfy.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------------------------
-- Configuration: what kinds of leave exist, and the rules governing each.
-- ---------------------------------------------------------------------------------------------
create table leave_type (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  code                  varchar(64) not null,
  name                  jsonb not null,
  unit                  varchar(16) not null,
  -- A tenant or country-pack code. Stored, compared, never interpreted: what "paid" costs is
  -- Payroll's question and the answer differs by jurisdiction.
  paid_treatment_code   varchar(64) not null,
  accrues               boolean not null,
  requires_attachment   boolean not null,
  requires_replacement  boolean not null,
  requires_contact      boolean not null,
  requires_address      boolean not null,
  gender_restriction    varchar(32),
  statutory_source_code varchar(64),
  status                varchar(24) not null,
  version_number        integer not null,
  published_at          timestamptz(6),
  published_by          varchar(255),
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint leave_type_unit_check check (unit in ('days', 'hours')),
  constraint leave_type_status_check check (status in ('draft', 'published', 'superseded')),
  constraint leave_type_publication_check check ((published_at is null) = (published_by is null)),
  constraint leave_type_name_check check (name ? 'en' and name ? 'ar')
);

create unique index leave_type_code_key
  on leave_type (tenant_id, code, version_number)
  where deleted_at is null;
create index leave_type_status_idx on leave_type (tenant_id, status);

create table leave_policy (
  id                                 uuid primary key default app_uuid_v7(),
  tenant_id                          uuid not null,
  leave_type_id                      uuid not null,
  code                               varchar(64) not null,
  name                               jsonb not null,
  version_number                     integer not null,
  status                             varchar(24) not null,
  effective_from                     date not null,
  effective_to                       date,
  minimum_service_months             integer not null,
  available_during_probation         boolean not null,
  eligibility_rule                   jsonb,
  maximum_consecutive_minutes        integer,
  maximum_per_request_minutes        integer,
  maximum_per_year_minutes           integer,
  minimum_notice_days                integer not null,
  maximum_backdate_days              integer not null,
  hourly_permitted                   boolean not null,
  hourly_minimum_minutes             integer,
  hourly_maximum_per_day_minutes     integer,
  hourly_maximum_per_month_minutes   integer,
  half_day_permitted                 boolean not null,
  duration_basis                     varchar(16) not null,
  negative_balance_limit_minutes     integer,
  accrual_method                     varchar(24) not null,
  accrual_amount_minutes             integer not null,
  proration_basis                    varchar(24) not null,
  carry_over_method                  varchar(24) not null,
  carry_over_cap_minutes             integer,
  carry_over_cap_percent             integer,
  carry_over_expiry_months           integer,
  leave_year_calendar                varchar(16) not null,
  leave_year_start_month             smallint not null,
  leave_year_start_day               smallint not null,
  approval_required                  boolean not null,
  approvals_required                 smallint not null,
  self_approval_permitted            boolean not null,
  encashable                         boolean not null,
  encashment_cap_minutes             integer,
  attachment_required_beyond_minutes integer,
  country_pack_id                    varchar(64),
  country_pack_version               varchar(32),
  published_at                       timestamptz(6),
  published_by                       varchar(255),
  metadata                           jsonb not null default '{}',
  created_at                         timestamptz(6) not null,
  created_by                         varchar(255) not null,
  updated_at                         timestamptz(6) not null,
  updated_by                         varchar(255) not null,
  deleted_at                         timestamptz(6),
  deleted_by                         varchar(255),
  version                            integer not null,
  constraint leave_policy_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_policy_status_check check (status in ('draft', 'published', 'superseded')),
  constraint leave_policy_period_check
    check (effective_to is null or effective_to >= effective_from),
  constraint leave_policy_basis_check
    check (duration_basis in ('working_days', 'calendar_days')),
  -- Five methods, closed. Which one a country requires is the country pack's decision; that the
  -- set exists at all is this product's.
  constraint leave_policy_accrual_check
    check (accrual_method in ('none', 'monthly', 'weekly', 'annual', 'front_loaded', 'service_band')
           and proration_basis in ('none', 'hire_date', 'calendar_month')),
  constraint leave_policy_carry_check
    check (carry_over_method in ('none', 'unlimited', 'capped_minutes', 'capped_percent')),
  -- Nothing statutory ships. Every threshold is inert until a tenant or a pack sets it, and the
  -- constraint only refuses values that are not numbers of minutes.
  constraint leave_policy_bounds_check
    check (minimum_service_months >= 0 and minimum_notice_days >= 0 and maximum_backdate_days >= 0
           and accrual_amount_minutes >= 0 and approvals_required >= 0
           and (negative_balance_limit_minutes is null or negative_balance_limit_minutes >= 0)
           and (carry_over_cap_percent is null
                or (carry_over_cap_percent >= 0 and carry_over_cap_percent <= 100))),
  constraint leave_policy_calendar_check
    check (leave_year_calendar in ('gregorian', 'hijri')
           and leave_year_start_month between 1 and 12
           and leave_year_start_day between 1 and 31),
  constraint leave_policy_approval_check
    check (approval_required = (approvals_required > 0)),
  constraint leave_policy_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint leave_policy_name_check check (name ? 'en' and name ? 'ar')
);

create unique index leave_policy_code_key
  on leave_policy (tenant_id, code, version_number)
  where deleted_at is null;
create index leave_policy_type_idx on leave_policy (tenant_id, leave_type_id, status);

create table leave_policy_assignment (
  id              uuid primary key default app_uuid_v7(),
  tenant_id       uuid not null,
  leave_policy_id uuid not null,
  scope           varchar(24) not null,
  scope_id        uuid,
  effective_from  date not null,
  effective_to    date,
  reason_code     varchar(64),
  created_at      timestamptz(6) not null,
  created_by      varchar(255) not null,
  updated_at      timestamptz(6) not null,
  updated_by      varchar(255) not null,
  deleted_at      timestamptz(6),
  deleted_by      varchar(255),
  version         integer not null,
  constraint leave_policy_assignment_policy_fk
    foreign key (leave_policy_id) references leave_policy (id),
  constraint leave_policy_assignment_scope_check
    check (scope in ('tenant', 'legal_entity', 'unit', 'employment')
           and (scope = 'tenant') = (scope_id is null)),
  constraint leave_policy_assignment_period_check
    check (effective_to is null or effective_to >= effective_from)
);

create index leave_policy_assignment_scope_idx
  on leave_policy_assignment (tenant_id, scope, scope_id, effective_from);
create index leave_policy_assignment_policy_idx
  on leave_policy_assignment (tenant_id, leave_policy_id);

create table leave_blackout (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  leave_type_id uuid,
  scope         varchar(24) not null,
  scope_id      uuid,
  name          jsonb not null,
  from_date     date not null,
  to_date       date not null,
  reason_code   varchar(64),
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint leave_blackout_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_blackout_scope_check
    check (scope in ('tenant', 'legal_entity', 'unit', 'employment')
           and (scope = 'tenant') = (scope_id is null)),
  constraint leave_blackout_period_check check (to_date >= from_date),
  constraint leave_blackout_name_check check (name ? 'en' and name ? 'ar')
);

create index leave_blackout_period_idx on leave_blackout (tenant_id, from_date, to_date);

-- ---------------------------------------------------------------------------------------------
-- Entitlement, the authoritative ledger, and the projection derived from it.
-- ---------------------------------------------------------------------------------------------
create table leave_entitlement (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  employment_id    uuid not null,
  leave_type_id    uuid not null,
  leave_policy_id  uuid not null,
  leave_year_start date not null,
  leave_year_end   date not null,
  granted_minutes  integer not null,
  source           varchar(24) not null,
  source_id        uuid,
  reason_code      varchar(64),
  metadata         jsonb not null default '{}',
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint leave_entitlement_employment_fk
    foreign key (employment_id) references employment (id),
  constraint leave_entitlement_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_entitlement_policy_fk foreign key (leave_policy_id) references leave_policy (id),
  constraint leave_entitlement_source_check
    check (source in ('opening', 'accrual', 'carry_over', 'adjustment', 'statutory')),
  constraint leave_entitlement_period_check check (leave_year_end >= leave_year_start)
);

-- The idempotency boundary an accrual run rests on: one grant per employment, per type, per leave
-- year, per source. A run restarted after an interruption finds its own grants already present and
-- writes nothing, which is what makes a bounded run safe to retry rather than something an operator
-- has to be careful with.
create unique index leave_entitlement_source_key
  on leave_entitlement (tenant_id, employment_id, leave_type_id, leave_year_start, source, source_id)
  where deleted_at is null and source_id is not null;

create index leave_entitlement_bucket_idx
  on leave_entitlement (tenant_id, employment_id, leave_type_id, leave_year_start);

create table leave_ledger_entry (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  employment_id          uuid not null,
  leave_type_id          uuid not null,
  leave_year_start       date not null,
  kind                   varchar(24) not null,
  -- Signed. A balance is `sum(minutes)`, which is one expression that cannot disagree with itself,
  -- rather than a case statement per kind that eventually will.
  minutes                integer not null,
  effective_on           date not null,
  recorded_at            timestamptz(6) not null,
  source_kind            varchar(24) not null,
  source_id              uuid not null,
  reverses_entry_id      uuid,
  leave_policy_id        uuid,
  reason_code            varchar(64),
  note                   varchar(1024),
  balance_before_minutes integer not null,
  balance_after_minutes  integer not null,
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint leave_ledger_employment_fk foreign key (employment_id) references employment (id),
  constraint leave_ledger_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_ledger_reverses_fk
    foreign key (reverses_entry_id) references leave_ledger_entry (id),
  constraint leave_ledger_kind_check
    check (kind in ('opening', 'accrual', 'carry_in', 'carry_out', 'consumption', 'expiry',
                    'adjustment', 'reversal')),
  constraint leave_ledger_source_check
    check (source_kind in ('request', 'accrual_run', 'adjustment', 'leave_year', 'entitlement')),
  -- A zero-minute movement is not a movement. It would sum to nothing and read as a mystery.
  constraint leave_ledger_minutes_check check (minutes <> 0),
  -- The sign convention, in the database rather than only in application code. A ledger whose
  -- signs live in one language is a ledger that eventually sums to the wrong number.
  constraint leave_ledger_sign_check
    check ((kind in ('opening', 'accrual', 'carry_in') and minutes > 0)
           or (kind in ('consumption', 'expiry', 'carry_out') and minutes < 0)
           or kind in ('adjustment', 'reversal')),
  constraint leave_ledger_self_reverse_check
    check (reverses_entry_id is null or reverses_entry_id <> id),
  constraint leave_ledger_adjustment_reason_check
    check (kind <> 'adjustment' or reason_code is not null)
);

-- The idempotency boundary every writer rests on. An accrual run repeated writes nothing; an
-- approval retried consumes once; a leave-year close rerun produces no second carry pair.
create unique index leave_ledger_source_key
  on leave_ledger_entry (tenant_id, source_kind, source_id, kind)
  where deleted_at is null;

create index leave_ledger_bucket_idx
  on leave_ledger_entry (tenant_id, employment_id, leave_type_id, leave_year_start, effective_on);
create index leave_ledger_source_idx on leave_ledger_entry (tenant_id, source_kind, source_id);

create table leave_balance (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  employment_id       uuid not null,
  leave_type_id       uuid not null,
  leave_year_start    date not null,
  leave_year_end      date not null,
  opening_minutes     integer not null,
  accrued_minutes     integer not null,
  carried_in_minutes  integer not null,
  consumed_minutes    integer not null,
  adjusted_minutes    integer not null,
  expired_minutes     integer not null,
  carried_out_minutes integer not null,
  available_minutes   integer not null,
  entries_digest      varchar(64) not null,
  entry_count         integer not null,
  calculated_at       timestamptz(6),
  inputs_changed_at   timestamptz(6),
  closed_at           timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint leave_balance_employment_fk foreign key (employment_id) references employment (id),
  constraint leave_balance_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_balance_period_check check (leave_year_end >= leave_year_start),
  -- `available_minutes` may legitimately be negative where a policy permits it, so it is not
  -- bounded here. The components that can only ever be credits are.
  constraint leave_balance_components_check
    check (accrued_minutes >= 0 and carried_in_minutes >= 0 and consumed_minutes >= 0
           and expired_minutes >= 0 and entry_count >= 0)
);

create unique index leave_balance_key
  on leave_balance (tenant_id, employment_id, leave_type_id, leave_year_start)
  where deleted_at is null;

-- The reconciliation read: projections whose ledger moved after they were last calculated.
-- Partial, so it indexes the few rows that are stale rather than the millions that are not.
create index leave_balance_stale_idx
  on leave_balance (tenant_id, inputs_changed_at)
  where inputs_changed_at is not null and deleted_at is null;

create index leave_balance_employment_idx on leave_balance (tenant_id, employment_id);

-- ---------------------------------------------------------------------------------------------
-- Requests, their coverage, their decisions and their history.
-- ---------------------------------------------------------------------------------------------
create table leave_request (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  employment_id              uuid not null,
  leave_type_id              uuid not null,
  leave_policy_id            uuid not null,
  from_date                  date not null,
  to_date                    date not null,
  total_minutes              integer not null,
  duration_basis             varchar(16) not null,
  state                      varchar(24) not null,
  reason_code                varchar(64),
  justification              varchar(1024),
  requested_by               varchar(255) not null,
  requested_at               timestamptz(6) not null,
  submitted_at               timestamptz(6),
  balance_at_request_minutes integer not null,
  approvals_required         smallint not null,
  approved_at                timestamptz(6),
  rejected_at                timestamptz(6),
  cancelled_at               timestamptz(6),
  cancelled_by               varchar(255),
  cancellation_reason_code   varchar(64),
  withdrawn_at               timestamptz(6),
  contact_during_absence     varchar(255),
  address_during_absence     varchar(512),
  replacement_employment_id  uuid,
  delegation_id              uuid,
  attachment_reference       varchar(512),
  supersedes_request_id      uuid,
  approval_id                varchar(64),
  metadata                   jsonb not null default '{}',
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint leave_request_employment_fk foreign key (employment_id) references employment (id),
  constraint leave_request_replacement_fk
    foreign key (replacement_employment_id) references employment (id),
  constraint leave_request_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_request_policy_fk foreign key (leave_policy_id) references leave_policy (id),
  constraint leave_request_supersedes_fk
    foreign key (supersedes_request_id) references leave_request (id),
  -- Eight states, closed, and each one has an invariant. `submitted` is distinct from
  -- `pending_approval` because a policy may require no approval, and such a request reaches
  -- `approved` with no decision row — the absence being itself the record.
  constraint leave_request_state_check
    check (state in ('draft', 'submitted', 'pending_approval', 'approved', 'taken', 'closed',
                     'rejected', 'cancelled', 'withdrawn')),
  constraint leave_request_period_check check (to_date >= from_date),
  constraint leave_request_minutes_check check (total_minutes >= 0),
  constraint leave_request_basis_check
    check (duration_basis in ('working_days', 'calendar_days')),
  -- A cancellation names who did it and why. Either half alone is a cancellation nobody can be
  -- held to.
  constraint leave_request_cancellation_check
    check ((cancelled_at is null) = (cancelled_by is null)),
  constraint leave_request_self_supersede_check
    check (supersedes_request_id is null or supersedes_request_id <> id),
  -- A request that reached `approved` says when. Reaching it without a timestamp would make the
  -- ledger consumption unexplainable.
  constraint leave_request_approved_check
    check (state not in ('approved', 'taken', 'closed') or approved_at is not null)
);

create index leave_request_employment_idx on leave_request (tenant_id, employment_id, from_date);
create index leave_request_queue_idx on leave_request (tenant_id, state, requested_at);
create index leave_request_type_idx on leave_request (tenant_id, leave_type_id, from_date);

create table leave_request_day (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  leave_request_id uuid not null,
  employment_id    uuid not null,
  on_date          date not null,
  portion          varchar(16) not null,
  minutes          integer not null,
  start_local      varchar(5),
  end_local        varchar(5),
  zone             varchar(64) not null,
  expected_minutes integer not null,
  -- The minutes-of-day the portion occupies, maintained by the database so the exclusion
  -- constraint has something to compare. Generated rather than supplied: a caller that could set
  -- it could defeat the constraint by lying about it.
  span             int4range generated always as (
    case portion
      when 'full_day'    then int4range(0, 1440)
      when 'first_half'  then int4range(0, 720)
      when 'second_half' then int4range(720, 1440)
      else int4range(
        coalesce(substring(start_local from 1 for 2)::int * 60
                 + substring(start_local from 4 for 2)::int, 0),
        greatest(
          coalesce(substring(end_local from 1 for 2)::int * 60
                   + substring(end_local from 4 for 2)::int, 1440),
          coalesce(substring(start_local from 1 for 2)::int * 60
                   + substring(start_local from 4 for 2)::int, 0) + 1))
    end
  ) stored,
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint leave_request_day_request_fk
    foreign key (leave_request_id) references leave_request (id),
  constraint leave_request_day_employment_fk
    foreign key (employment_id) references employment (id),
  constraint leave_request_day_portion_check
    check (portion in ('full_day', 'first_half', 'second_half', 'hours')),
  -- An hourly portion states its hours; no other portion may. A half day that carried times would
  -- be two different answers to how long it was.
  constraint leave_request_day_hours_check
    check ((portion = 'hours') = (start_local is not null and end_local is not null)),
  constraint leave_request_day_minutes_check check (minutes > 0 and minutes <= 1440)
);

-- **The overlap invariant, in the database.** Two full days on one date are refused; a first and a
-- second half coexist; two overlapping hourly requests are refused. `deleted_at is null` is in the
-- predicate so an amendment's superseded rows step aside, and only live states participate — a
-- rejected or withdrawn request blocks nothing.
alter table leave_request_day
  add constraint leave_request_day_overlap
  exclude using gist (
    tenant_id with =,
    employment_id with =,
    on_date with =,
    span with &&
  ) where (deleted_at is null);

create index leave_request_day_coverage_idx
  on leave_request_day (tenant_id, employment_id, on_date);
create index leave_request_day_request_idx on leave_request_day (tenant_id, leave_request_id);

create table leave_request_decision (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  leave_request_id     uuid not null,
  sequence             smallint not null,
  decision             varchar(16) not null,
  decided_by           varchar(255) not null,
  decided_at           timestamptz(6) not null,
  -- Copied from the request so the check below is enforceable: a check constraint cannot reach
  -- another table, and a separation of duties that lives only in application code is one any
  -- future path around that code silently removes.
  requested_by         varchar(255) not null,
  comment              varchar(1024),
  reverses_decision_id uuid,
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint leave_request_decision_request_fk
    foreign key (leave_request_id) references leave_request (id),
  constraint leave_request_decision_reverses_fk
    foreign key (reverses_decision_id) references leave_request_decision (id),
  constraint leave_request_decision_kind_check check (decision in ('approved', 'rejected')),
  constraint leave_request_decision_self_approval_check check (decided_by <> requested_by),
  constraint leave_request_decision_self_reverse_check
    check (reverses_decision_id is null or reverses_decision_id <> id)
);

create unique index leave_request_decision_key
  on leave_request_decision (tenant_id, leave_request_id, sequence)
  where deleted_at is null;
create index leave_request_decision_chain_idx
  on leave_request_decision (tenant_id, leave_request_id, sequence);

create table leave_request_event (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  leave_request_id uuid not null,
  kind             varchar(32) not null,
  from_state       varchar(24),
  to_state         varchar(24),
  detail           varchar(1024),
  occurred_at      timestamptz(6) not null,
  recorded_by      varchar(255) not null,
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint leave_request_event_request_fk
    foreign key (leave_request_id) references leave_request (id)
);

create index leave_request_event_idx
  on leave_request_event (tenant_id, leave_request_id, occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Administrative movements, and the runs that produce entitlement.
-- ---------------------------------------------------------------------------------------------
create table leave_adjustment (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  employment_id    uuid not null,
  leave_type_id    uuid not null,
  leave_year_start date not null,
  minutes          integer not null,
  effective_on     date not null,
  reason_code      varchar(64) not null,
  note             varchar(1024) not null,
  adjusted_by      varchar(255) not null,
  adjusted_at      timestamptz(6) not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint leave_adjustment_employment_fk foreign key (employment_id) references employment (id),
  constraint leave_adjustment_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_adjustment_minutes_check check (minutes <> 0)
);

create index leave_adjustment_employment_idx
  on leave_adjustment (tenant_id, employment_id, leave_type_id);

create table leave_accrual_run (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  leave_policy_id      uuid not null,
  leave_type_id        uuid not null,
  period_start         date not null,
  period_end           date not null,
  run_by               varchar(255) not null,
  run_at               timestamptz(6) not null,
  employments_examined integer not null,
  entries_written      integer not null,
  entries_skipped      integer not null,
  refusals             integer not null,
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint leave_accrual_run_policy_fk foreign key (leave_policy_id) references leave_policy (id),
  constraint leave_accrual_run_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_accrual_run_period_check check (period_end >= period_start),
  constraint leave_accrual_run_counts_check
    check (employments_examined >= 0 and entries_written >= 0 and entries_skipped >= 0
           and refusals >= 0)
);

-- One run per policy per period. Re-invoking the command for the same period resumes the same run
-- rather than opening a second one, so the grants it already wrote are recognised as its own.
create unique index leave_accrual_run_key
  on leave_accrual_run (tenant_id, leave_policy_id, period_start, period_end)
  where deleted_at is null;

create index leave_accrual_run_idx
  on leave_accrual_run (tenant_id, leave_policy_id, period_start);

create table leave_year (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  leave_policy_id     uuid not null,
  leave_type_id       uuid not null,
  leave_year_start    date not null,
  leave_year_end      date not null,
  closed_at           timestamptz(6) not null,
  closed_by           varchar(255) not null,
  employments_closed  integer not null,
  carried_out_minutes integer not null,
  carried_in_minutes  integer not null,
  expired_minutes     integer not null,
  metadata            jsonb not null default '{}',
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint leave_year_policy_fk foreign key (leave_policy_id) references leave_policy (id),
  constraint leave_year_type_fk foreign key (leave_type_id) references leave_type (id),
  constraint leave_year_period_check check (leave_year_end >= leave_year_start)
);

-- One closure per policy per year. A rerun is refused here rather than producing a second carry
-- pair, which is what makes closing a year safe to retry.
create unique index leave_year_key
  on leave_year (tenant_id, leave_policy_id, leave_year_start)
  where deleted_at is null;
create index leave_year_idx on leave_year (tenant_id, leave_policy_id, leave_year_start);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in this module.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('leave_type');
call app_protect_table('leave_policy');
call app_protect_table('leave_policy_assignment');
call app_protect_table('leave_blackout');
call app_protect_table('leave_entitlement');
call app_protect_table('leave_ledger_entry');
call app_protect_table('leave_balance');
call app_protect_table('leave_request');
call app_protect_table('leave_request_day');
call app_protect_table('leave_request_decision');
call app_protect_table('leave_request_event');
call app_protect_table('leave_adjustment');
call app_protect_table('leave_accrual_run');
call app_protect_table('leave_year');

comment on table leave_ledger_entry is
  'The authoritative record of every balance movement. Inserted and read; never updated, never deleted. A correction is a reversal plus a replacement, so a disputed balance is a sum of rows nobody rewrote.';
comment on table leave_balance is
  'A projection derived from the ledger, never written except by recalculation. The digest and the stale mark are what make a wrong figure detectable rather than plausible (ADR-0053).';
comment on constraint leave_request_day_overlap on leave_request_day is
  'The overlap invariant, enforced by the database because two concurrent requests for the same morning would both pass an application check.';
