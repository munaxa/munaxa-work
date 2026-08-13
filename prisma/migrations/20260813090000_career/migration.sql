-- Career & Succession (Phase 15).
--
-- Twelve tables. Career records what an organization *intends* — a path somebody could follow, a
-- bench for a position, a plan for a person, a suggestion that they could move — and **executes
-- nothing**. No row here causes an employment, a position, an assignment or a salary to change,
-- and there is no column through which one could (ADR-0072).
--
-- Three absences are the point of the schema, and each is a column somebody would reasonably have
-- added:
--
--   * **No `criticality`.** `organization_position.criticality` exists and AD-004 assigns it to
--     Organization. `career_succession_plan` names a position by identifier and knows nothing else
--     about it. A copy here would be the staler of two answers to "is this position critical".
--
--   * **No potential band, no box code, no high-potential flag.** Performance owns
--     `performance_talent_placement`. Membership of a talent pool is a *decision* an organization
--     took and carries the name of whoever took it; a nine-box placement is an *observation* one
--     calibration meeting made in one cycle. Neither derives the other (ADR-0073).
--
--   * **No readiness score, no mix target, no balance verdict.** Readiness is *stated* by a person
--     against a tenant-configured level; the 70-20-10 development mix is `NOT VERIFIED` because the
--     specification gives a weighting and no validation rule (ADR-0074). A column would be schema
--     claiming a rule nobody wrote.
--
-- **Every date in this module is a civil `date`.** A target date, a membership period and an
-- assessment day are days, not instants — the same day in every time zone. `timestamptz` appears
-- only on audit columns and on `recorded_at`, which genuinely is the moment a row was written.
-- PostgreSQL refuses `date '2026-02-30'`, which is the boundary that closes the defect a Career
-- domain test found in the repository's shared `isCivilDate` helper.
--
-- **Every number is a small ordered integer a human chose** — a stage's position, a successor's
-- rank, a readiness level's ordinal. There is no `numeric`, no `bigint` and no money column, so
-- there is no rounding rule to get wrong.
--
-- **Cross-module identifiers carry no foreign key.** `employment_id`, `position_id`, `unit_id` and
-- `learning_assignment_id` are plain `uuid`, following ADR-0042 and Learning's treatment of the
-- same problem: a foreign key across a module boundary couples two schemas' migration order, and —
-- more importantly — **a foreign key does not provide tenant isolation**. PostgreSQL's referential
-- check runs without the policy, so an FK to `organization_position` would happily accept another
-- tenant's position. Containment comes from the row-level policy on Career's own row plus the
-- application confirming the reference through a published contract before writing.

-- ---------------------------------------------------------------------------------------------
-- Career paths, and the stages along them
-- ---------------------------------------------------------------------------------------------

-- Configuration, and the only thing in this module that is effective-dated (Phase 13 D-28 restricts
-- effective dating to configuration; a plan is a record, not a fact in force on a date).
create table career_path (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  code           varchar(64) not null,
  name           jsonb not null,
  description    jsonb,
  kind           varchar(24) not null,
  status         varchar(16) not null,
  effective_from date not null,
  effective_to   date,
  archived_at    timestamptz(6),
  archived_by    varchar(255),
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint career_path_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint career_path_kind_check
    check (kind in ('technical', 'management', 'leadership', 'executive', 'specialist', 'custom')),
  constraint career_path_status_check check (status in ('draft', 'published', 'archived')),
  constraint career_path_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index career_path_code_idx
  on career_path (tenant_id, code) where deleted_at is null;
create index career_path_status_idx
  on career_path (tenant_id, status, effective_from) where deleted_at is null;

-- A stage's `sequence` is an order, **not a gate**. Nothing in this product requires stage two
-- before stage three: prerequisites were never specified, and enforcing an unspecified one would
-- block a real career on a rule nobody wrote (D-17). The same position Learning takes on path steps.
--
-- `target_position_id` is Organization's identifier and nothing else — no title, no grade, no
-- criticality.
create table career_stage (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  path_id            uuid not null,
  sequence           smallint not null,
  name               jsonb not null,
  target_position_id uuid,
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint career_stage_path_fk foreign key (path_id) references career_path (id),
  constraint career_stage_sequence_check check (sequence >= 1 and sequence <= 500)
);

create unique index career_stage_sequence_idx
  on career_stage (tenant_id, path_id, sequence) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Career plans
-- ---------------------------------------------------------------------------------------------

-- A plan names an **employment**, never a person (AD-001).
--
-- `path_id` is nullable (D-18): a tenant may plan somebody towards a target stage without committing
-- to a whole published path, and requiring one would make an ad-hoc plan impossible to record. A
-- stage may only be named where a path is, because a stage belongs to a path and nothing could
-- later check that the two agree.
create table career_plan (
  id               uuid primary key default app_uuid_v7(),
  tenant_id        uuid not null,
  employment_id    uuid not null,
  path_id          uuid,
  current_stage_id uuid,
  target_stage_id  uuid,
  status           varchar(16) not null,
  started_on       date not null,
  target_date      date,
  notes            varchar(4000),
  closed_on        date,
  closed_by        varchar(255),
  metadata         jsonb not null default '{}',
  created_at       timestamptz(6) not null,
  created_by       varchar(255) not null,
  updated_at       timestamptz(6) not null,
  updated_by       varchar(255) not null,
  deleted_at       timestamptz(6),
  deleted_by       varchar(255),
  version          integer not null,
  constraint career_plan_path_fk foreign key (path_id) references career_path (id),
  constraint career_plan_current_stage_fk foreign key (current_stage_id) references career_stage (id),
  constraint career_plan_target_stage_fk foreign key (target_stage_id) references career_stage (id),
  constraint career_plan_status_check
    check (status in ('draft', 'active', 'achieved', 'abandoned', 'archived')),
  -- A stage belongs to a path. Naming one without the other claims a relationship nothing verifies.
  constraint career_plan_stage_needs_path_check check (
    path_id is not null or (current_stage_id is null and target_stage_id is null)
  ),
  constraint career_plan_target_check check (target_date is null or target_date >= started_on),
  -- An ending records the day it ended and who ended it. A plan that closed with neither is one
  -- nobody can explain a year later.
  constraint career_plan_closure_check check (
    status in ('draft', 'active') or (closed_on is not null and closed_by is not null)
  )
);

-- One active plan per employment (§15). A partial unique index rather than a pre-check, because a
-- read-then-write is idempotent only when nobody else is writing.
create unique index career_plan_active_idx
  on career_plan (tenant_id, employment_id) where deleted_at is null and status = 'active';

create index career_plan_employment_idx
  on career_plan (tenant_id, employment_id, status) where deleted_at is null;
create index career_plan_path_idx
  on career_plan (tenant_id, path_id, status) where deleted_at is null and path_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Talent pools, and the periods people were in them
-- ---------------------------------------------------------------------------------------------

-- A pool named `high_potential` is a name a tenant chose. **Nothing in this product branches on a
-- pool's kind**, and no column here is derived from Performance's potential band (ADR-0073).
create table career_talent_pool (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  code        varchar(64) not null,
  name        jsonb not null,
  description jsonb,
  kind        varchar(24) not null,
  status      varchar(16) not null,
  closed_at   timestamptz(6),
  closed_by   varchar(255),
  metadata    jsonb not null default '{}',
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint career_talent_pool_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint career_talent_pool_kind_check check (
    kind in ('graduate', 'leadership', 'technical_expert', 'future_manager', 'high_potential',
             'custom')
  ),
  constraint career_talent_pool_status_check check (status in ('active', 'closed'))
);

create unique index career_talent_pool_code_idx
  on career_talent_pool (tenant_id, code) where deleted_at is null;

-- **Removing somebody is a period ending, never a delete.** `to_date` is set and the row stays: a
-- succession review a year later asks "who did we invest in, and what happened to them", and a
-- deleted row cannot answer it.
--
-- Both ends are inclusive: somebody removed on the 30th was in the pool on the 30th.
create table career_pool_membership (
  id              uuid primary key default app_uuid_v7(),
  tenant_id       uuid not null,
  talent_pool_id  uuid not null,
  employment_id   uuid not null,
  from_date       date not null,
  to_date         date,
  added_by        varchar(255) not null,
  added_reason    varchar(1024),
  removed_by      varchar(255),
  removed_reason  varchar(1024),
  metadata        jsonb not null default '{}',
  created_at      timestamptz(6) not null,
  created_by      varchar(255) not null,
  updated_at      timestamptz(6) not null,
  updated_by      varchar(255) not null,
  deleted_at      timestamptz(6),
  deleted_by      varchar(255),
  version         integer not null,
  constraint career_pool_membership_pool_fk
    foreign key (talent_pool_id) references career_talent_pool (id),
  constraint career_pool_membership_period_check check (to_date is null or to_date >= from_date),
  -- An ended membership names who ended it. The period is a historical fact and it has an author.
  constraint career_pool_membership_removal_check
    check (to_date is null or removed_by is not null)
);

-- One **open** membership per pool and employment (§15). A person may be in two pools at once, and
-- may rejoin a pool they left — what they cannot be is in the same pool twice at the same time.
create unique index career_pool_membership_open_idx
  on career_pool_membership (tenant_id, talent_pool_id, employment_id)
  where deleted_at is null and to_date is null;

create index career_pool_membership_pool_idx
  on career_pool_membership (tenant_id, talent_pool_id, from_date) where deleted_at is null;
create index career_pool_membership_employment_idx
  on career_pool_membership (tenant_id, employment_id, from_date) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Readiness
-- ---------------------------------------------------------------------------------------------

-- A tenant's own ladder. `ordinal` orders the levels least to most ready so a screen can sort them
-- and a consumer can compare by index. **It is not a score and is never published as one** — the
-- construction Organization uses for `POSITION_CRITICALITIES`, and for the same reason: publishing
-- a number means promising it stays stable and means something.
create table career_readiness_level (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  code       varchar(64) not null,
  name       jsonb not null,
  ordinal    smallint not null,
  active     boolean not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  constraint career_readiness_level_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint career_readiness_level_ordinal_check check (ordinal >= 1 and ordinal <= 100)
);

create unique index career_readiness_level_code_idx
  on career_readiness_level (tenant_id, code) where deleted_at is null;
create unique index career_readiness_level_ordinal_idx
  on career_readiness_level (tenant_id, ordinal) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Succession
-- ---------------------------------------------------------------------------------------------

-- The plan **for** a position, not a second record of the position (D-3). `position_id` is
-- Organization's identifier; there is no criticality column here and there will not be one.
--
-- `review_on` is a day somebody chose to look at this again. **Nothing reminds them.** `JobPort` has
-- no adapter anywhere in this repository, so "reviews due" is a query an administrator runs, and
-- scheduled review is `NOT VERIFIED`.
create table career_succession_plan (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  position_id uuid not null,
  status      varchar(16) not null,
  review_on   date,
  notes       varchar(4000),
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
  constraint career_succession_plan_status_check check (status in ('draft', 'active', 'archived'))
);

-- One active plan per position (§15).
create unique index career_succession_plan_active_idx
  on career_succession_plan (tenant_id, position_id) where deleted_at is null and status = 'active';

create index career_succession_plan_status_idx
  on career_succession_plan (tenant_id, status, position_id) where deleted_at is null;
create index career_succession_plan_review_idx
  on career_succession_plan (tenant_id, review_on)
  where deleted_at is null and status = 'active' and review_on is not null;

-- A nomination. `rank` is an order a human put the bench in — **not a score, and nothing computes
-- it**. `readiness_level_id` names a level somebody stated (ADR-0074).
--
-- `confirmed` is the moment an organization commits to a name and is what an auditor asks about, so
-- it carries its own actor and day; `system:auto-approval` is refused outright, as Performance
-- refuses it on completing a review and Learning on waiving and revoking (ADR-0072).
--
-- **Withdrawal is a state, never a delete.** "We put this person forward and later took them off"
-- is exactly the history a succession review needs.
create table career_successor (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  succession_plan_id  uuid not null,
  employment_id       uuid not null,
  readiness_level_id  uuid,
  rank                smallint,
  status              varchar(16) not null,
  nominated_on        date not null,
  nominated_by        varchar(255) not null,
  confirmed_on        date,
  confirmed_by        varchar(255),
  withdrawn_on        date,
  withdrawn_by        varchar(255),
  withdrawal_reason   varchar(1024),
  metadata            jsonb not null default '{}',
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint career_successor_plan_fk
    foreign key (succession_plan_id) references career_succession_plan (id),
  constraint career_successor_level_fk
    foreign key (readiness_level_id) references career_readiness_level (id),
  constraint career_successor_status_check
    check (status in ('nominated', 'confirmed', 'withdrawn')),
  constraint career_successor_rank_check check (rank is null or (rank >= 1 and rank <= 50)),
  -- A confirmation names its day and its author, or it is not a confirmation.
  constraint career_successor_confirmation_check
    check (status <> 'confirmed' or (confirmed_on is not null and confirmed_by is not null)),
  -- Taking somebody off a bench needs a reason. It is the act somebody asks about later.
  constraint career_successor_withdrawal_check check (
    status <> 'withdrawn'
    or (withdrawn_on is not null and withdrawn_by is not null and withdrawal_reason is not null)
  ),
  -- Nothing commits an organization to a successor without a person behind it.
  constraint career_successor_nominator_check check (nominated_by <> 'system:auto-approval'),
  constraint career_successor_confirmer_check
    check (confirmed_by is null or confirmed_by <> 'system:auto-approval')
);

-- One **open** nomination per plan and employment (§15) — the specification's "Duplicate Successor
-- Assignments" validation, at the database rather than in a pre-check, because two managers can run
-- it at the same instant. A withdrawn nomination does not occupy the slot: somebody taken off a
-- bench may be put back on it.
--
-- A person may be a successor for **more than one position** (D-15), so the uniqueness is per plan.
create unique index career_successor_open_idx
  on career_successor (tenant_id, succession_plan_id, employment_id)
  where deleted_at is null and status in ('nominated', 'confirmed');

create index career_successor_plan_idx
  on career_successor (tenant_id, succession_plan_id, status) where deleted_at is null;
create index career_successor_employment_idx
  on career_successor (tenant_id, employment_id, status) where deleted_at is null;
create index career_successor_readiness_idx
  on career_successor (tenant_id, readiness_level_id)
  where deleted_at is null and readiness_level_id is not null;

-- **Readiness is stated by a person and nothing computes it** (ADR-0074, D-10).
--
-- There is no score column, no weight, no derived level and no reference to the inputs a derivation
-- would have used — Performance's potential band, Learning's completions, Employment's tenure are
-- all absent by construction. A readiness level decides who is put forward for a director's post,
-- and inventing the rule that produces it would have this product deciding on a rule nobody wrote.
--
-- **Append-only** (D-14). A correction is a new assessment, so the trail shows what was thought and
-- when it changed. Enforced by the trigger below rather than by the application alone.
create table career_readiness_assessment (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  employment_id        uuid not null,
  readiness_level_id   uuid not null,
  position_id          uuid,
  succession_plan_id   uuid,
  assessed_on          date not null,
  assessed_by          varchar(255) not null,
  rationale            varchar(4000),
  recorded_at          timestamptz(6) not null,
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint career_readiness_assessment_level_fk
    foreign key (readiness_level_id) references career_readiness_level (id),
  constraint career_readiness_assessment_plan_fk
    foreign key (succession_plan_id) references career_succession_plan (id),
  -- An assessment must be *about* something. "Ready" with no answer to "ready for what" is not a
  -- statement anybody can act on or challenge.
  constraint career_readiness_assessment_subject_check
    check (position_id is not null or succession_plan_id is not null),
  constraint career_readiness_assessment_assessor_check
    check (assessed_by <> 'system:auto-approval')
);

create index career_readiness_assessment_employment_idx
  on career_readiness_assessment (tenant_id, employment_id, assessed_on desc)
  where deleted_at is null;
create index career_readiness_assessment_plan_idx
  on career_readiness_assessment (tenant_id, succession_plan_id, assessed_on desc)
  where deleted_at is null and succession_plan_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Development
-- ---------------------------------------------------------------------------------------------

-- **Joint ownership is `NOT VERIFIED`** (D-9). The specification asks for a plan "jointly owned by
-- the employee and the manager", and this product cannot identify either: there is no
-- principal-to-employment resolution (ADR-0032). So the columns say what is true — an administrator
-- *recorded* that each party acknowledged, and the recorder is the authenticated actor. A column
-- named `employee_signed_by` would claim something the platform cannot deliver.
create table career_development_plan (
  id                                     uuid primary key default app_uuid_v7(),
  tenant_id                              uuid not null,
  employment_id                          uuid not null,
  career_plan_id                         uuid,
  cycle_label                            varchar(255),
  status                                 varchar(16) not null,
  started_on                             date not null,
  target_date                            date,
  employee_acknowledged_on               date,
  employee_acknowledgement_recorded_by   varchar(255),
  manager_acknowledged_on                date,
  manager_acknowledgement_recorded_by    varchar(255),
  closed_on                              date,
  closed_by                              varchar(255),
  metadata                               jsonb not null default '{}',
  created_at                             timestamptz(6) not null,
  created_by                             varchar(255) not null,
  updated_at                             timestamptz(6) not null,
  updated_by                             varchar(255) not null,
  deleted_at                             timestamptz(6),
  deleted_by                             varchar(255),
  version                                integer not null,
  constraint career_development_plan_career_plan_fk
    foreign key (career_plan_id) references career_plan (id),
  constraint career_development_plan_status_check
    check (status in ('draft', 'active', 'completed', 'abandoned')),
  constraint career_development_plan_target_check
    check (target_date is null or target_date >= started_on),
  constraint career_development_plan_closure_check check (
    status in ('draft', 'active') or (closed_on is not null and closed_by is not null)
  ),
  -- An acknowledgement names the day and the person who recorded it, together or not at all.
  constraint career_development_plan_employee_ack_check check (
    (employee_acknowledged_on is null) = (employee_acknowledgement_recorded_by is null)
  ),
  constraint career_development_plan_manager_ack_check check (
    (manager_acknowledged_on is null) = (manager_acknowledgement_recorded_by is null)
  ),
  constraint career_development_plan_employee_ack_human_check check (
    employee_acknowledgement_recorded_by is null
    or employee_acknowledgement_recorded_by <> 'system:auto-approval'
  ),
  constraint career_development_plan_manager_ack_human_check check (
    manager_acknowledgement_recorded_by is null
    or manager_acknowledgement_recorded_by <> 'system:auto-approval'
  )
);

create index career_development_plan_employment_idx
  on career_development_plan (tenant_id, employment_id, status) where deleted_at is null;

-- **A course item is a reference to Learning, and Career keeps no status for it** (ADR-0073).
--
-- `learning_assignment_id` is present exactly when `kind = 'course'`, and it is the whole of what
-- Career stores about that course: no title of Learning's, no completion date, no progress. Whether
-- somebody finished is `learning_enrolment`'s answer, and a second copy here would be the one that
-- goes stale the first time an enrolment was withdrawn.
--
-- `category` records which of the three kinds of development this is. **It is counted and never
-- validated**: the 70-20-10 model the specification names has no rule, tolerance or measure of
-- contribution attached to it, so there is no target column, no tolerance column and no balance
-- verdict anywhere in this schema (ADR-0074, D-12 `NOT VERIFIED`).
create table career_development_item (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  development_plan_id    uuid not null,
  category               varchar(16) not null,
  kind                   varchar(24) not null,
  title                  varchar(255) not null,
  learning_assignment_id uuid,
  target_date            date,
  status                 varchar(16) not null,
  completed_on           date,
  completed_by           varchar(255),
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint career_development_item_plan_fk
    foreign key (development_plan_id) references career_development_plan (id),
  constraint career_development_item_category_check
    check (category in ('experience', 'exposure', 'education')),
  constraint career_development_item_kind_check check (
    kind in ('course', 'coaching', 'mentoring', 'project', 'stretch_assignment', 'assessment')
  ),
  constraint career_development_item_status_check
    check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  -- The boundary against Learning, at the table. A course item names its assignment; nothing else
  -- may name one, because that would claim a relationship Learning knows nothing about.
  constraint career_development_item_learning_check
    check ((kind = 'course') = (learning_assignment_id is not null)),
  -- A course item takes its progress from Learning, so Career never records a completion for one.
  constraint career_development_item_course_status_check
    check (learning_assignment_id is null or status = 'planned'),
  constraint career_development_item_completion_check
    check (status <> 'completed' or (completed_on is not null and completed_by is not null))
);

create index career_development_item_plan_idx
  on career_development_item (tenant_id, development_plan_id, category) where deleted_at is null;
create index career_development_item_due_idx
  on career_development_item (tenant_id, target_date)
  where deleted_at is null and target_date is not null and status in ('planned', 'in_progress');

-- ---------------------------------------------------------------------------------------------
-- Mobility
-- ---------------------------------------------------------------------------------------------

-- **A suggestion, and nothing that moves anybody.** `status = 'accepted'` means a named person, on a
-- named day, agreed the move is a good idea. No employment changes, no assignment is written, no
-- letter is issued and nobody is told (ADR-0072). There is no `effective_date` and no
-- `assignment_id` column, because there is nothing for either to point at.
--
-- **`expired` is never stored** (D-13). The row carries the civil day the suggestion stops being
-- current, and whether it *has* is a function of that day and the day somebody asked — because a
-- stored flag would need something to move it overnight and `JobPort` has no adapter. This is
-- Learning's certificate-validity construction (ADR-0070), and the check constraint below refuses
-- `expired` as a stored value so nothing can quietly start writing it.
create table career_mobility_recommendation (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  employment_id      uuid not null,
  kind               varchar(32) not null,
  target_position_id uuid,
  target_unit_id     uuid,
  rationale          varchar(4000),
  status             varchar(16) not null,
  recommended_on     date not null,
  recommended_by     varchar(255) not null,
  valid_until        date,
  decided_on         date,
  decided_by         varchar(255),
  decision_note      varchar(1024),
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint career_mobility_recommendation_kind_check check (
    kind in ('promotion', 'lateral_move', 'cross_department', 'international_assignment',
             'temporary_assignment')
  ),
  -- Three stored values. `expired` is derived on read and this refuses it as a column value.
  constraint career_mobility_recommendation_status_check
    check (status in ('proposed', 'accepted', 'declined')),
  constraint career_mobility_recommendation_validity_check
    check (valid_until is null or valid_until > recommended_on),
  constraint career_mobility_recommendation_decision_check check (
    status = 'proposed' or (decided_on is not null and decided_by is not null)
  ),
  constraint career_mobility_recommendation_recommender_check
    check (recommended_by <> 'system:auto-approval'),
  constraint career_mobility_recommendation_decider_check
    check (decided_by is null or decided_by <> 'system:auto-approval')
);

create index career_mobility_recommendation_employment_idx
  on career_mobility_recommendation (tenant_id, employment_id, status) where deleted_at is null;
create index career_mobility_recommendation_open_idx
  on career_mobility_recommendation (tenant_id, valid_until)
  where deleted_at is null and status = 'proposed';

-- ---------------------------------------------------------------------------------------------
-- Immutability. One trigger, for the one fact the approved plan makes append-only (D-14).
--
-- A readiness assessment is a statement one person made about another on one day. Editing it would
-- destroy the trail that makes the statement answerable — "who said this, and when did they change
-- their mind" is the question a succession review asks, and an edited row cannot answer it. A
-- correction is a *new* assessment; the domain has no amend function, and this refuses the rewrite
-- from any path, including SQL nobody wrote in TypeScript.
--
-- Deliberately the only trigger in this module. Every other invariant here is a check constraint, a
-- partial unique index or an optimistic version — mechanisms that do not need to compare an old row
-- with a new one. Triggers are architecturally significant in this repository, and one added for
-- convenience is one nobody expects.
-- ---------------------------------------------------------------------------------------------
create or replace function app_career_readiness_assessment_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'career_readiness_assessment_immutable'
    using errcode = 'restrict_violation',
          detail = format('career_readiness_assessment %s is immutable', old.id),
          hint = 'A correction is a new assessment, recorded on the day it was made.';
end; $$;

create trigger career_readiness_assessment_no_mutation
  before update or delete on career_readiness_assessment
  for each row execute function app_career_readiness_assessment_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy, with no exception.
--
-- **What these policies do not express**, stated rather than assumed: employee A must not read
-- employee B's readiness assessment, and that is not a tenant property. A policy would need to know
-- which employment the caller *is*, and this product has no principal-to-employment resolution
-- (ADR-0032). That guarantee lives in the application layer and is asserted at the HTTP edge; the
-- database enforces tenant isolation and nothing finer.
--
-- **A foreign key is not isolation.** The FKs above couple rows *within* Career, and PostgreSQL's
-- referential check runs without consulting a policy — so containment across the boundary comes
-- from these policies plus the application confirming a cross-module identifier through a published
-- contract before it writes one.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('career_path');
call app_protect_table('career_stage');
call app_protect_table('career_plan');
call app_protect_table('career_talent_pool');
call app_protect_table('career_pool_membership');
call app_protect_table('career_readiness_level');
call app_protect_table('career_succession_plan');
call app_protect_table('career_successor');
call app_protect_table('career_readiness_assessment');
call app_protect_table('career_development_plan');
call app_protect_table('career_development_item');
call app_protect_table('career_mobility_recommendation');
