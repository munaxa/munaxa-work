-- Learning and development: the catalogue, what people were asked to do, what they did, and what
-- they hold as a result (Phase 14A; the roadmap's 6.2).
--
-- Twelve tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, because a failed safety
-- assessment says as much about a person as a performance rating does.
--
-- Six decisions in this file are the ones a reviewer should challenge.
--
--   * **Learning owns the expiry of what Learning issued, and only that** (ADR-0070, approved as
--     D-1). `person_history.expires_on` keeps what somebody arrived with, `document.expiry_date`
--     keeps the validity of a scan, and `learning_certification.valid_until` keeps the validity of
--     the qualification this employer issued. Where the same certificate is also a Document, the
--     certification references it through `evidence_document_id` rather than creating a second
--     expiry authority.
--
--   * **There is no `expired` column, and no `overdue` one.** Both are functions of a date and
--     today, derived on read. A materialized flag needs something to move it on the right morning;
--     `JobPort` has no adapter anywhere in this repository, so nothing would, and a screen showing
--     `valid` for a licence that lapsed in March is worse than no flag at all (ADR-0071).
--
--   * **A certification may exist with no enrolment behind it** (D-2). A tenant recording a forklift
--     licence somebody already held must be able to, and manufacturing an enrolment to satisfy a
--     foreign key would assert that they took a course they never took. `source` states which of
--     the three it is as a fact on the row, not as an inference from which columns are null.
--
--   * **Recurrence is computed, and `learning_assignment_occurrence_idx` is what makes it
--     idempotent** (ADR-0071). A partial unique index over the derived `occurrence_key` — not a
--     read-then-write check, which does not survive two administrators pressing the button at once
--     — is why running the reconciliation command twice creates nothing the second time.
--
--   * **No column here holds a score, a total, a percentage or a pass mark.** The specification
--     names five assessment kinds and defines no formula, no threshold, no weighting and no
--     rounding. `raw_mark` is `varchar` because it is the tenant's own text kept verbatim for their
--     records; nothing in this product reads it, compares it, orders by it or adds it up, and
--     aggregate scoring is NOT VERIFIED rather than approximated.
--
--   * **No `session`, no `capacity`, no `waitlist`, no `seat`.** Those are Phase 14B. A column left
--     here "ready for them" would be schema claiming a capability nobody built, so there is not
--     one — an instructor row answers "who delivered this", never "who is free on Tuesday".
--
-- Learning writes to no other module. `employment_id`, `organization_unit_id`, `position_id` and
-- `evidence_document_id` are references resolved through published contracts and carry no foreign
-- key: Phase 11 settled that a cross-module foreign key does not enforce tenant isolation anyway
-- (ADR-0042).

-- ---------------------------------------------------------------------------------------------
-- The catalogue.
-- ---------------------------------------------------------------------------------------------

-- A tenant's own filing for its courses. No rule in this product reads it (AD-003).
create table learning_course_category (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  code        varchar(64) not null,
  name        jsonb not null,
  description jsonb,
  metadata    jsonb not null default '{}',
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint learning_course_category_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')
);

create unique index learning_course_category_code_idx
  on learning_course_category (tenant_id, code) where deleted_at is null;

-- A course's stable identity. What it teaches lives in its versions.
--
-- The `document` → `document_version` shape Phase 12 established, for the same reason: an enrolment
-- references a *version*, so a completed enrolment still names what was actually completed after
-- somebody rewrites the syllabus. `archived` and never deleted — a certification issued three years
-- ago has to stay explainable, and a deleted course would make it unexplainable.
--
-- `delivery` is a label describing the mode a course was designed for. It schedules nothing: a
-- course marked `classroom` in Phase 14A is one a tenant arranges outside this product.
create table learning_course (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  code               varchar(64) not null,
  name               jsonb not null,
  description        jsonb,
  category_id        uuid,
  delivery           varchar(24) not null,
  status             varchar(16) not null,
  current_version_id uuid,
  archived_at        timestamptz(6),
  archived_by        varchar(255),
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint learning_course_category_fk
    foreign key (category_id) references learning_course_category (id),
  constraint learning_course_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint learning_course_delivery_check
    check (delivery in ('self_paced', 'instructor_led', 'virtual', 'classroom', 'blended', 'external')),
  constraint learning_course_status_check check (status in ('draft', 'published', 'archived')),
  -- A published course with nothing to teach would accept enrolments referencing nothing.
  constraint learning_course_published_check
    check (status <> 'published' or current_version_id is not null)
);

create unique index learning_course_code_idx
  on learning_course (tenant_id, code) where deleted_at is null;
create index learning_course_status_idx
  on learning_course (tenant_id, status, code) where deleted_at is null;

-- One version of a course: what it taught, for as long as anybody needs to know.
--
-- **Insert-only**, enforced by a trigger below. AD-004 says historical versions remain available,
-- and a version that could be edited would make every enrolment pinned to it a record of something
-- that may since have changed. Correcting a course publishes version 4; it never rewrites version 3.
--
-- `content_reference` is an opaque key this product never resolves. `StoragePort` has no adapter
-- anywhere in this repository, so there is no upload, no download and no URL — the position
-- Documents takes about `storage_reference`, for the same reason.
--
-- `requires_assessment` is the tenant's configuration, not a rule this product wrote. It says an
-- assessment outcome is needed before completion; it does not say what passing means, because
-- nothing in the specification does.
create table learning_course_version (
  id                          uuid primary key default app_uuid_v7(),
  tenant_id                   uuid not null,
  course_id                   uuid not null,
  version_number              integer not null,
  title                       jsonb not null,
  objectives                  jsonb,
  content_reference           varchar(1024),
  duration_minutes            integer,
  requires_assessment         boolean not null,
  certification_valid_months  integer,
  published_at                timestamptz(6) not null,
  published_by                varchar(255) not null,
  metadata                    jsonb not null default '{}',
  created_at                  timestamptz(6) not null,
  created_by                  varchar(255) not null,
  updated_at                  timestamptz(6) not null,
  updated_by                  varchar(255) not null,
  deleted_at                  timestamptz(6),
  deleted_by                  varchar(255),
  version                     integer not null,
  constraint learning_course_version_course_fk
    foreign key (course_id) references learning_course (id),
  constraint learning_course_version_number_check check (version_number >= 1),
  constraint learning_course_version_duration_check
    check (duration_minutes is null or (duration_minutes >= 1 and duration_minutes <= 525600)),
  constraint learning_course_version_validity_check
    check (certification_valid_months is null
      or (certification_valid_months >= 1 and certification_valid_months <= 600))
);

create unique index learning_course_version_number_idx
  on learning_course_version (tenant_id, course_id, version_number);
create index learning_course_version_course_idx
  on learning_course_version (tenant_id, course_id, version_number desc);

-- What a course version asks somebody to demonstrate. A kind, a title, and whether it is required.
--
-- Note what is absent: no pass mark, no weight, no attempt limit, no total. The specification
-- defines none of them, and a threshold invented here would decide who passes mandatory safety
-- training on the strength of a number nobody asked for.
create table learning_assessment (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  course_version_id uuid not null,
  title             jsonb not null,
  kind              varchar(24) not null,
  required          boolean not null,
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint learning_assessment_version_fk
    foreign key (course_version_id) references learning_course_version (id),
  constraint learning_assessment_kind_check
    check (kind in ('quiz', 'practical', 'assignment', 'observation', 'external_result'))
);

create index learning_assessment_version_idx
  on learning_assessment (tenant_id, course_version_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Paths: courses a tenant grouped together. A path recommends; it never certifies (AD-002).
-- ---------------------------------------------------------------------------------------------

create table learning_path (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  code        varchar(64) not null,
  name        jsonb not null,
  description jsonb,
  kind        varchar(24) not null,
  status      varchar(16) not null,
  archived_at timestamptz(6),
  archived_by varchar(255),
  metadata    jsonb not null default '{}',
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint learning_path_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint learning_path_kind_check
    check (kind in ('role_based', 'department', 'certification', 'leadership', 'custom')),
  constraint learning_path_status_check check (status in ('draft', 'published', 'archived'))
);

create unique index learning_path_code_idx
  on learning_path (tenant_id, code) where deleted_at is null;

-- One course's place in a path. `sequence` is an order, not a gate: nothing here refuses an
-- enrolment because an earlier step is unfinished, because no prerequisite rule was ever specified.
create table learning_path_step (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  path_id    uuid not null,
  course_id  uuid not null,
  sequence   smallint not null,
  optional   boolean not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  constraint learning_path_step_path_fk foreign key (path_id) references learning_path (id),
  constraint learning_path_step_course_fk foreign key (course_id) references learning_course (id),
  constraint learning_path_step_sequence_check check (sequence >= 1 and sequence <= 500)
);

create unique index learning_path_step_sequence_idx
  on learning_path_step (tenant_id, path_id, sequence) where deleted_at is null;
create unique index learning_path_step_course_idx
  on learning_path_step (tenant_id, path_id, course_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Mandatory training: configuration that fires nothing (ADR-0071).
-- ---------------------------------------------------------------------------------------------

-- What an audience must hold, and how often. Every course is mandatory because a tenant said so
-- (AD-006): this product ships no rules and no default compliance catalogue.
--
-- The audience is resolved through Employment's published contract when the rule is reconciled,
-- never from a list somebody typed — so a rule targeting a unit covers the person who transferred
-- in yesterday without anybody editing anything.
--
-- `recurrence_months` of 0 is a rule that never repeats: once satisfied, always satisfied.
create table learning_mandatory_rule (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  course_id            uuid not null,
  name                 jsonb not null,
  kind                 varchar(24) not null,
  audience             varchar(24) not null,
  organization_unit_id uuid,
  position_id          uuid,
  effective_from       date not null,
  recurrence_months    smallint not null,
  due_within_days      smallint not null,
  active               boolean not null,
  retired_at           timestamptz(6),
  retired_by           varchar(255),
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint learning_mandatory_rule_course_fk foreign key (course_id) references learning_course (id),
  constraint learning_mandatory_rule_kind_check
    check (kind in ('compliance', 'safety', 'policy', 'orientation', 'role_based')),
  constraint learning_mandatory_rule_audience_check
    check (audience in ('everybody', 'organization_unit', 'position')),
  -- A compliance rule that silently covers nobody is worse than no rule at all.
  constraint learning_mandatory_rule_target_check check (
    (audience = 'organization_unit' and organization_unit_id is not null and position_id is null)
    or (audience = 'position' and position_id is not null and organization_unit_id is null)
    or (audience = 'everybody' and organization_unit_id is null and position_id is null)
  ),
  constraint learning_mandatory_rule_recurrence_check
    check (recurrence_months >= 0 and recurrence_months <= 600),
  constraint learning_mandatory_rule_due_window_check
    check (due_within_days >= 0 and due_within_days <= 3650)
);

create index learning_mandatory_rule_active_idx
  on learning_mandatory_rule (tenant_id, active, course_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- What somebody was asked to do, and what they did.
-- ---------------------------------------------------------------------------------------------

-- One person asked to learn one thing by one date.
--
-- `source` records *why*, so a queue of eleven items can be explained to the person holding it, and
-- the check below refuses a provenance the row cannot back up.
--
-- `occurrence_key` is the civil date on which the occurrence began — derived from the rule's
-- interval and the person's last completion, never a counter. The partial unique index over it is
-- the whole of the idempotency guarantee in ADR-0071: it is what makes a second reconciliation run
-- create nothing, under concurrency, without a read-then-write check that could not.
create table learning_assignment (
  id                            uuid primary key default app_uuid_v7(),
  tenant_id                     uuid not null,
  employment_id                 uuid not null,
  course_id                     uuid not null,
  source                        varchar(24) not null,
  mandatory_rule_id             uuid,
  path_id                       uuid,
  occurrence_key                date,
  status                        varchar(16) not null,
  due_on                        date,
  assigned_at                   timestamptz(6) not null,
  assigned_by                   varchar(255) not null,
  satisfied_by_enrolment_id     uuid,
  satisfied_by_certification_id uuid,
  satisfied_at                  timestamptz(6),
  waived_at                     timestamptz(6),
  waived_by                     varchar(255),
  waiver_reason                 varchar(1024),
  cancelled_at                  timestamptz(6),
  cancelled_by                  varchar(255),
  metadata                      jsonb not null default '{}',
  created_at                    timestamptz(6) not null,
  created_by                    varchar(255) not null,
  updated_at                    timestamptz(6) not null,
  updated_by                    varchar(255) not null,
  deleted_at                    timestamptz(6),
  deleted_by                    varchar(255),
  version                       integer not null,
  constraint learning_assignment_course_fk foreign key (course_id) references learning_course (id),
  constraint learning_assignment_rule_fk
    foreign key (mandatory_rule_id) references learning_mandatory_rule (id),
  constraint learning_assignment_path_fk foreign key (path_id) references learning_path (id),
  constraint learning_assignment_source_check
    check (source in ('mandatory_rule', 'learning_path', 'direct')),
  constraint learning_assignment_status_check
    check (status in ('assigned', 'satisfied', 'waived', 'cancelled')),
  constraint learning_assignment_provenance_check check (
    (source = 'mandatory_rule' and mandatory_rule_id is not null)
    or (source = 'learning_path' and path_id is not null)
    or source = 'direct'
  ),
  -- An occurrence belongs to a rule. A key on a direct assignment would claim a recurrence nobody
  -- configured, and would take a slot in the uniqueness index that keeps reconciliation idempotent.
  constraint learning_assignment_occurrence_check
    check (occurrence_key is null or mandatory_rule_id is not null),
  -- Closing an assignment with no evidence is indistinguishable from quietly dismissing it.
  constraint learning_assignment_satisfaction_check check (
    status <> 'satisfied'
    or satisfied_by_enrolment_id is not null
    or satisfied_by_certification_id is not null
  ),
  constraint learning_assignment_waiver_check
    check (status <> 'waived' or (waiver_reason is not null and waived_by is not null)),
  -- Nothing excuses anybody from safety training on its own.
  constraint learning_assignment_waiver_human_check
    check (waived_by is null or waived_by <> 'system:auto-approval')
);

-- ADR-0071's idempotency guarantee, as an index rather than as a check in application code.
create unique index learning_assignment_occurrence_idx
  on learning_assignment (tenant_id, employment_id, mandatory_rule_id, occurrence_key)
  where deleted_at is null and occurrence_key is not null;

create index learning_assignment_employment_idx
  on learning_assignment (tenant_id, employment_id, status, due_on) where deleted_at is null;
-- The compliance queue: open assignments by date, which is how overdue-ness is answered on read.
create index learning_assignment_due_idx
  on learning_assignment (tenant_id, due_on, id) where deleted_at is null and status = 'assigned';

-- One employment's participation in one version of one course.
--
-- It references a **version**, which is what makes a completed enrolment still describe what was
-- actually completed. Completion is immutable, refused by the domain and again by a trigger below:
-- a correction is a new enrolment, as a correction to a finalized payroll is a reversal.
--
-- Withdrawing is not failing. A compliance report that could not tell "left the course" from "did
-- not pass it" would describe two very different people identically.
create table learning_enrolment (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  employment_id     uuid not null,
  course_id         uuid not null,
  course_version_id uuid not null,
  assignment_id     uuid,
  status            varchar(16) not null,
  enrolled_at       timestamptz(6) not null,
  enrolled_by       varchar(255) not null,
  started_at        timestamptz(6),
  completed_at      timestamptz(6),
  completed_by      varchar(255),
  completed_on      date,
  outcome_note      varchar(1024),
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint learning_enrolment_course_fk foreign key (course_id) references learning_course (id),
  constraint learning_enrolment_version_fk
    foreign key (course_version_id) references learning_course_version (id),
  constraint learning_enrolment_assignment_fk
    foreign key (assignment_id) references learning_assignment (id),
  constraint learning_enrolment_status_check
    check (status in ('enrolled', 'in_progress', 'completed', 'failed', 'withdrawn')),
  -- A completion is somebody's statement that another person finished. One with nobody's name
  -- against it cannot be questioned later by the person it belongs to.
  constraint learning_enrolment_completion_check
    check (status <> 'completed' or (completed_by is not null and completed_on is not null)),
  constraint learning_enrolment_completion_human_check
    check (completed_by is null or completed_by <> 'system:auto-approval')
);

-- One open enrolment per person per course. Retaking is allowed — the index covers only the two
-- states that mean "currently on the course", so a second attempt after a failure is a new row.
create unique index learning_enrolment_open_idx
  on learning_enrolment (tenant_id, employment_id, course_id)
  where deleted_at is null and status in ('enrolled', 'in_progress');

create index learning_enrolment_employment_idx
  on learning_enrolment (tenant_id, employment_id, status) where deleted_at is null;
create index learning_enrolment_course_idx
  on learning_enrolment (tenant_id, course_id, status) where deleted_at is null;
-- The last completion of a course by a person: what the recurrence arithmetic reads.
create index learning_enrolment_completion_idx
  on learning_enrolment (tenant_id, employment_id, course_id, completed_on desc)
  where deleted_at is null and status = 'completed';

-- One assessor's record of how one enrolment went on one assessment.
--
-- **Insert-only**, by trigger. What an assessor recorded on a date is a thing that happened, and an
-- editable result would make every completion that depended on it unverifiable afterwards. A later
-- result supersedes an earlier one by being later; nothing is overwritten.
--
-- `raw_mark` is `varchar` on purpose. It is the tenant's own text kept verbatim — a numeric column
-- would invite a query to compare, order by or average it, and this product was never told what any
-- of those would mean.
create table learning_assessment_result (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  assessment_id  uuid not null,
  enrolment_id   uuid not null,
  employment_id  uuid not null,
  outcome        varchar(16) not null,
  raw_mark       varchar(32),
  raw_mark_scale varchar(255),
  assessed_on    date not null,
  assessed_by    varchar(255) not null,
  notes          varchar(4000),
  recorded_at    timestamptz(6) not null,
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint learning_assessment_result_assessment_fk
    foreign key (assessment_id) references learning_assessment (id),
  constraint learning_assessment_result_enrolment_fk
    foreign key (enrolment_id) references learning_enrolment (id),
  constraint learning_assessment_result_outcome_check
    check (outcome in ('passed', 'failed', 'recorded')),
  constraint learning_assessment_result_mark_scale_check
    check (raw_mark is null or raw_mark_scale is not null),
  -- Nothing in this product decides that somebody passed, because nothing was told what passing is.
  constraint learning_assessment_result_human_check check (assessed_by <> 'system:auto-approval')
);

create index learning_assessment_result_enrolment_idx
  on learning_assessment_result (tenant_id, enrolment_id, assessed_on desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Certifications: what somebody holds, and until when (ADR-0070).
-- ---------------------------------------------------------------------------------------------

-- There is no `expired` status here. `valid_until` is the only fact, and expiry is derived on read;
-- the expiring queue is an indexed predicate over a date, correct at every instant.
--
-- `revoked` and `superseded` are different endings: the issuer withdrew it, or a recertification
-- replaced it. A report that could not tell "we took it away" from "they renewed it" would describe
-- two very different people the same way.
create table learning_certification (
  id                            uuid primary key default app_uuid_v7(),
  tenant_id                     uuid not null,
  employment_id                 uuid not null,
  enrolment_id                  uuid,
  course_id                     uuid,
  title                         varchar(255) not null,
  source                        varchar(24) not null,
  status                        varchar(16) not null,
  issued_on                     date not null,
  valid_until                   date,
  supersedes_certification_id   uuid,
  evidence_document_id          uuid,
  revoked_at                    timestamptz(6),
  revoked_by                    varchar(255),
  revocation_reason             varchar(1024),
  issued_by                     varchar(255) not null,
  metadata                      jsonb not null default '{}',
  created_at                    timestamptz(6) not null,
  created_by                    varchar(255) not null,
  updated_at                    timestamptz(6) not null,
  updated_by                    varchar(255) not null,
  deleted_at                    timestamptz(6),
  deleted_by                    varchar(255),
  version                       integer not null,
  constraint learning_certification_enrolment_fk
    foreign key (enrolment_id) references learning_enrolment (id),
  constraint learning_certification_course_fk foreign key (course_id) references learning_course (id),
  constraint learning_certification_supersedes_fk
    foreign key (supersedes_certification_id) references learning_certification (id),
  constraint learning_certification_source_check
    check (source in ('learning_completion', 'external', 'recorded')),
  constraint learning_certification_status_check
    check (status in ('active', 'revoked', 'superseded')),
  -- A certification claiming to come from a completed course, with no enrolment behind it, would be
  -- unverifiable by anybody reading it later.
  constraint learning_certification_completion_check
    check (source <> 'learning_completion' or enrolment_id is not null),
  -- A certificate that expired before it was issued is a data-entry error, and accepting it would
  -- put a permanently-expired row in a compliance report nobody could explain.
  constraint learning_certification_validity_check
    check (valid_until is null or valid_until > issued_on),
  constraint learning_certification_revocation_check
    check (status <> 'revoked' or (revoked_by is not null and revocation_reason is not null)),
  constraint learning_certification_issuer_check check (issued_by <> 'system:auto-approval')
);

create index learning_certification_employment_idx
  on learning_certification (tenant_id, employment_id, status) where deleted_at is null;
-- The expiring queue. Active certifications by the date they lapse, which is the whole of how the
-- question "what expires in the next 60 days" is answered without a scheduler.
create index learning_certification_expiry_idx
  on learning_certification (tenant_id, valid_until, id)
  where deleted_at is null and status = 'active' and valid_until is not null;

-- ---------------------------------------------------------------------------------------------
-- Instructors: an identity, and only an identity (D-6).
-- ---------------------------------------------------------------------------------------------

-- An internal instructor is an employment reference and nothing else — no copied name, no title, no
-- department. An external instructor is a Learning-owned record, because a visiting trainer is not
-- an employee: a manufactured `person` row for them would put a non-employee into headcount
-- reports, org charts and document queues.
--
-- Nothing here schedules anybody. No availability, no calendar, no booking, no rate.
create table learning_instructor (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  employment_id         uuid,
  external_name         jsonb,
  external_organization varchar(255),
  external_contact      varchar(255),
  active                boolean not null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  -- Exactly one identity. Two names could disagree; neither would be nobody.
  constraint learning_instructor_identity_check check (
    (employment_id is not null and external_name is null)
    or (employment_id is null and external_name is not null)
  ),
  -- Contact details belong to whoever owns the identity. A second copy here is the one somebody
  -- eventually emails after it has gone stale.
  constraint learning_instructor_internal_check check (
    employment_id is null
    or (external_organization is null and external_contact is null)
  )
);

create index learning_instructor_active_idx
  on learning_instructor (tenant_id, active) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Immutability. Three shapes in this module are records of things that happened.
-- ---------------------------------------------------------------------------------------------

-- A course version is insert-only. AD-004 keeps historical versions available, and an editable
-- version would make every enrolment pinned to it a record of something that may since have
-- changed.
create or replace function app_learning_course_version_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'learning_course_version_immutable'
    using errcode = 'restrict_violation',
          detail = format('learning_course_version %s is immutable', old.id),
          hint = 'Correcting a course publishes a new version. It never rewrites an old one.';
end; $$;

create trigger learning_course_version_no_mutation
  before update or delete on learning_course_version
  for each row execute function app_learning_course_version_immutable();

-- An assessment result is insert-only. A later result supersedes an earlier one by being later.
create or replace function app_learning_assessment_result_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'learning_assessment_result_immutable'
    using errcode = 'restrict_violation',
          detail = format('learning_assessment_result %s is immutable', old.id),
          hint = 'A correction is a new result, recorded on the day it was made.';
end; $$;

create trigger learning_assessment_result_no_mutation
  before update or delete on learning_assessment_result
  for each row execute function app_learning_assessment_result_immutable();

-- A completed enrolment is frozen. The domain refuses the transition; this refuses it again, because
-- what somebody completed is a thing that happened and a correction is a new enrolment.
--
-- Soft deletion stays possible: a row created in error is withdrawn, which leaves every word of it
-- in place rather than changing what it says.
create or replace function app_learning_enrolment_refuse_change() returns trigger
language plpgsql as $$
declare
  unchanged_old jsonb;
  unchanged_new jsonb;
begin
  if old.status not in ('completed', 'failed', 'withdrawn') then
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'learning_enrolment_immutable'
      using errcode = 'restrict_violation',
            detail = format('learning_enrolment %s has ended', old.id),
            hint = 'An ended enrolment is withdrawn by a soft delete, never removed.';
  end if;

  unchanged_old := to_jsonb(old) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';
  unchanged_new := to_jsonb(new) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';

  if unchanged_old <> unchanged_new then
    raise exception 'learning_enrolment_immutable'
      using errcode = 'restrict_violation',
            detail = format('learning_enrolment %s has ended', old.id),
            hint = 'A correction to a completed enrolment is a new enrolment.';
  end if;
  return new;
end; $$;

create trigger learning_enrolment_immutable
  before update or delete on learning_enrolment
  for each row execute function app_learning_enrolment_refuse_change();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy, with no exception.
--
-- **What these policies do not express**, stated rather than assumed: employee A must not read
-- employee B's assessment result, and that is not a tenant property. A policy would need to know
-- which employment the caller *is*, and this product has no principal-to-employment resolution
-- (ADR-0032). That guarantee lives in the application layer and is asserted at the HTTP edge; the
-- database enforces tenant isolation and nothing finer.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('learning_course_category');
call app_protect_table('learning_course');
call app_protect_table('learning_course_version');
call app_protect_table('learning_assessment');
call app_protect_table('learning_path');
call app_protect_table('learning_path_step');
call app_protect_table('learning_mandatory_rule');
call app_protect_table('learning_assignment');
call app_protect_table('learning_enrolment');
call app_protect_table('learning_assessment_result');
call app_protect_table('learning_certification');
call app_protect_table('learning_instructor');
