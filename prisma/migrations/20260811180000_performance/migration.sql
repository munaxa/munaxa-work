-- Performance management: goals, competencies, review cycles, calibration and talent
-- classification (Phase 13; the roadmap's 6.1).
--
-- Twenty-three tables in one module, and the row-level security that isolates every one of them
-- (ADR-0030). The policies are created here, in the migration that creates the tables, because a
-- performance review is among the most sensitive rows this product holds: it records what one
-- named person thinks of another's work, and it is read years later by people who were not there.
--
-- Seven decisions in this file are the ones a reviewer should challenge.
--
--   * **There is no `grade` here, and there never will be.** `position.grade` (Phase 3) means a
--     job's level and `compensation_pay_grade` (Phase 10) means a pay band. A third meaning would
--     make the word useless in all three modules, so a performance level is a
--     `performance_rating_level` belonging to a `performance_rating_scale`, and the word `grade`
--     does not appear (D-7).
--
--   * **No column holding a score, a weight or a proportion is a floating-point type.** Weights are
--     integer basis points, scores are integer hundredths, key-result values are integers with
--     their own exponent — the same discipline ADR-0061 established for money. A percentage stored
--     as a `double` is a percentage that does not add to 100, and this schema computes a number
--     that decides somebody's rating.
--
--   * **Self, manager and peer assessments are separate rows, never states of one row.** Each
--     assessor writes their own `performance_assessment`, immutable once submitted. It is the only
--     shape in which one actor cannot overwrite another's opinion (D-10), and the specification
--     names all three as separate aggregate roots.
--
--   * **A calibration decision never overwrites what was calculated.** It records the original
--     score and rating alongside the calibrated ones, with the actor, the moment and the reason.
--     The calibrated value becomes effective; the original remains as history, and a trigger
--     refuses any later edit of the decision.
--
--   * **Nothing here is anonymous.** Every row carries `created_by`, every read is tenant-scoped by
--     policy, and a peer assessment records its assessor's employment. Hiding a name in a screen
--     would not change that, so this schema makes no anonymity claim; aggregate-only display with a
--     minimum respondent count is a presentation rule, not a property of these tables (D-12).
--
--   * **Evidence is a reference and never a byte.** `evidence_document_id` points at Documents'
--     row and nothing else. `StoragePort` still has no adapter anywhere in this repository, so
--     upload and download remain unbuilt; this module stores no content and copies no metadata
--     (D-24).
--
--   * **Performance writes to no other module.** No column here changes a salary, a position, an
--     employment status or a learning record. `employment_id`, `organization_unit_id` and
--     `evidence_document_id` are references resolved through published contracts, and carry no
--     foreign key: a polymorphic or cross-module reference cannot carry one, and Phase 11 settled
--     that a cross-module foreign key does not enforce tenant isolation anyway (ADR-0042).

-- ---------------------------------------------------------------------------------------------
-- Configuration: what a tenant decides once, and every cycle then refers to.
-- ---------------------------------------------------------------------------------------------

-- The scale a tenant rates against, and the range its scores must fall in.
--
-- `minimum_score` and `maximum_score` are hundredths, so a 1–5 scale stores 100 and 500. They are
-- the range a calculated score must land in: a calculation that produces a value outside it fails
-- explicitly rather than clamping, because a silently clamped rating is a wrong rating that looks
-- right.
--
-- Effective-dated, because a tenant that changes its scale must not change what last year's reviews
-- were rated against. Reviews completed under the old scale keep it in their snapshot (D-28).
create table performance_rating_scale (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  code           varchar(64) not null,
  name           jsonb not null,
  description    jsonb,
  minimum_score  integer not null,
  maximum_score  integer not null,
  effective_from date not null,
  effective_to   date,
  active         boolean not null,
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint performance_rating_scale_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_rating_scale_range_check check (maximum_score > minimum_score),
  constraint performance_rating_scale_period_check
    check (effective_to is null or effective_to >= effective_from)
);

create unique index performance_rating_scale_code_idx
  on performance_rating_scale (tenant_id, code) where deleted_at is null;

-- One band on a scale: "Exceeds expectations", and the score range that earns it.
--
-- `ordinal` orders the levels from lowest to highest and is what a nine-box placement and a
-- calibration comparison use. The score bounds are hundredths on the parent scale's range.
create table performance_rating_level (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  performance_rating_scale_id uuid not null,
  code                      varchar(64) not null,
  name                      jsonb not null,
  description               jsonb,
  ordinal                   smallint not null,
  minimum_score             integer not null,
  maximum_score             integer not null,
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint performance_rating_level_scale_fk
    foreign key (performance_rating_scale_id) references performance_rating_scale (id),
  constraint performance_rating_level_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_rating_level_ordinal_check check (ordinal >= 1),
  constraint performance_rating_level_range_check check (maximum_score >= minimum_score)
);

create unique index performance_rating_level_code_idx
  on performance_rating_level (tenant_id, performance_rating_scale_id, code)
  where deleted_at is null;

create unique index performance_rating_level_ordinal_idx
  on performance_rating_level (tenant_id, performance_rating_scale_id, ordinal)
  where deleted_at is null;

-- A named, versioned set of competencies.
--
-- `framework_version` is part of the identity rather than a mutable column: redefining a competency
-- publishes a new version, and a review completed under version 2 keeps version 2 in its snapshot.
--
-- `weighted` is the whole of D-6's third decision. A framework that does not carry weights is
-- aggregated as an unweighted mean; weights are used **only** where the framework explicitly says
-- it has them, and none are invented for a framework that does not.
create table performance_competency_framework (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  code              varchar(64) not null,
  framework_version integer not null,
  name              jsonb not null,
  description       jsonb,
  weighted          boolean not null,
  effective_from    date not null,
  effective_to      date,
  active            boolean not null,
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint performance_competency_framework_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_competency_framework_version_check check (framework_version >= 1),
  constraint performance_competency_framework_period_check
    check (effective_to is null or effective_to >= effective_from)
);

create unique index performance_competency_framework_code_idx
  on performance_competency_framework (tenant_id, code, framework_version)
  where deleted_at is null;

-- One competency within a framework: what is assessed, not what somebody has learned.
--
-- The boundary with People and Learning is deliberate and is the most consequential line in this
-- phase (D-9). `person_capability` (Phase 4) holds what a person *claims*; Learning (Phase 14) will
-- hold what a person has *attained*. This holds what a manager observed of the job, in a cycle,
-- against a definition — and it is neither of the other two.
--
-- `weight_basis_points` is null unless the parent framework says it is weighted. Where the
-- framework carries no weights, this column stays null and the aggregate is an unweighted mean.
create table performance_competency (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  framework_id        uuid not null,
  code                varchar(64) not null,
  name                jsonb not null,
  description         jsonb,
  category            varchar(32) not null,
  weight_basis_points integer,
  display_order       smallint not null,
  active              boolean not null,
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint performance_competency_framework_fk
    foreign key (framework_id) references performance_competency_framework (id),
  constraint performance_competency_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_competency_category_check
    check (category in ('core', 'leadership', 'functional', 'technical')),
  constraint performance_competency_weight_check
    check (weight_basis_points is null
           or (weight_basis_points >= 0 and weight_basis_points <= 10000))
);

create unique index performance_competency_code_idx
  on performance_competency (tenant_id, framework_id, code) where deleted_at is null;

-- A behavioural level on a competency, and the score demonstrating it earns.
--
-- The score is hundredths on the review template's rating scale, which is what makes a competency
-- assessment a number the scoring engine can aggregate rather than a label somebody interprets.
create table performance_competency_level (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  competency_id          uuid not null,
  ordinal                smallint not null,
  name                   jsonb not null,
  behavioural_indicators jsonb not null default '[]',
  score                  integer not null,
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint performance_competency_level_competency_fk
    foreign key (competency_id) references performance_competency (id),
  constraint performance_competency_level_ordinal_check check (ordinal >= 1),
  constraint performance_competency_level_score_check check (score >= 0)
);

create unique index performance_competency_level_ordinal_idx
  on performance_competency_level (tenant_id, competency_id, ordinal) where deleted_at is null;

-- What a tenant calls a kind of goal. Configuration, and nothing more.
create table performance_goal_category (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  code       varchar(64) not null,
  name       jsonb not null,
  active     boolean not null,
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  constraint performance_goal_category_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')
);

create unique index performance_goal_category_code_idx
  on performance_goal_category (tenant_id, code) where deleted_at is null;

-- The shape of a review: which scale, which framework, what is required, and what the goals must
-- weigh in total.
--
-- `goal_weight_total_basis_points` is D-5's "must total", made tenant-configurable rather than
-- hard-coded at 10,000. A tenant that runs unweighted goals sets it to zero and every goal weighs
-- nothing; a tenant that requires a complete goal set leaves it at 10,000 and a review whose goals
-- do not add up is refused before it can be scored.
--
-- `minimum_peer_responses` is a display rule, not an anonymity guarantee. It withholds an aggregate
-- computed from too few responses. It does not make the underlying rows anonymous, and nothing in
-- this schema claims that it does.
create table performance_review_template (
  id                             uuid primary key default app_uuid_v7(),
  tenant_id                      uuid not null,
  code                           varchar(64) not null,
  name                           jsonb not null,
  description                    jsonb,
  rating_scale_id                uuid not null,
  competency_framework_id        uuid,
  requires_self_assessment       boolean not null,
  requires_peer_assessment       boolean not null,
  requires_calibration           boolean not null,
  goal_weight_total_basis_points integer not null,
  minimum_peer_responses         smallint,
  active                         boolean not null,
  metadata                       jsonb not null default '{}',
  created_at                     timestamptz(6) not null,
  created_by                     varchar(255) not null,
  updated_at                     timestamptz(6) not null,
  updated_by                     varchar(255) not null,
  deleted_at                     timestamptz(6),
  deleted_by                     varchar(255),
  version                        integer not null,
  constraint performance_review_template_scale_fk
    foreign key (rating_scale_id) references performance_rating_scale (id),
  constraint performance_review_template_framework_fk
    foreign key (competency_framework_id) references performance_competency_framework (id),
  constraint performance_review_template_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_review_template_goal_total_check
    check (goal_weight_total_basis_points >= 0
           and goal_weight_total_basis_points <= 10000),
  constraint performance_review_template_peer_responses_check
    check (minimum_peer_responses is null or minimum_peer_responses >= 1),
  -- Peer assessment without a minimum is a screen that shows one person's opinion as though it
  -- were the group's. If a template asks for peers, it says how few is too few.
  constraint performance_review_template_peer_minimum_check
    check (not requires_peer_assessment or minimum_peer_responses is not null)
);

create unique index performance_review_template_code_idx
  on performance_review_template (tenant_id, code) where deleted_at is null;

-- What the final score is made of, and how much each part counts.
--
-- Integer basis points, and the set must total 10,000 (D-6). **That total is a cross-row invariant
-- and no check constraint can express it**, so it is enforced in the domain when a template is
-- defined, refused again before a review is scored, and reported by the reconciliation query. The
-- honest statement is that this table constrains each row and the application constrains the set —
-- pretending otherwise would put a rule in a comment that nothing enforces.
create table performance_review_template_component (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  template_id         uuid not null,
  component           varchar(24) not null,
  weight_basis_points integer not null,
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint performance_review_template_component_template_fk
    foreign key (template_id) references performance_review_template (id),
  constraint performance_review_template_component_check
    check (component in ('goals', 'competencies')),
  constraint performance_review_template_component_weight_check
    check (weight_basis_points >= 0 and weight_basis_points <= 10000)
);

create unique index performance_review_template_component_idx
  on performance_review_template_component (tenant_id, template_id, component)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Goals. A goal outlives the cycle that assessed it, which is why it is not a child of a review.
-- ---------------------------------------------------------------------------------------------

-- One goal, at whichever level of the organization set it.
--
-- `parent_goal_id` is D-4's explicit parent reference — the shape Organization already uses for
-- units, and the depth here is shallower still. `scope` decides which owner column is populated,
-- and a check constraint refuses the combinations that would leave a goal belonging to nobody or
-- to two things at once.
--
-- `title` and `description` are free text rather than the bilingual `jsonb` this schema uses for
-- tenant configuration. A goal is written once by one person in the language they were speaking;
-- demanding two translations of "Reduce onboarding time to ten days" would mean either a
-- machine-translated goal or an empty one (§17).
--
-- `weight_basis_points` participates in the review's goal aggregate. A cancelled goal is excluded
-- entirely — it contributes neither a score nor a denominator weight (D-6).
create table performance_goal (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  goal_category_id     uuid,
  parent_goal_id       uuid,
  cycle_id             uuid,
  scope                varchar(16) not null,
  employment_id        uuid,
  organization_unit_id uuid,
  title                varchar(255) not null,
  description          text,
  measurement          varchar(24) not null,
  target_description   text,
  weight_basis_points  integer not null,
  status               varchar(16) not null,
  start_date           date not null,
  due_date             date not null,
  progress_basis_points integer not null default 0,
  approved_at          timestamptz(6),
  approved_by          varchar(255),
  closed_at            timestamptz(6),
  closed_by            varchar(255),
  -- Recorded at closure, in hundredths on the cycle's rating scale. Null while the goal is open,
  -- and null forever on a cancelled goal.
  final_score          integer,
  closure_reason       varchar(1024),
  evidence_document_id uuid,
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint performance_goal_parent_fk
    foreign key (parent_goal_id) references performance_goal (id),
  constraint performance_goal_category_fk
    foreign key (goal_category_id) references performance_goal_category (id),
  -- The reference to `performance_cycle` is added after that table exists, further down. A goal
  -- outlives the cycle that assessed it, which is why the column is nullable.
  constraint performance_goal_scope_check
    check (scope in ('corporate', 'department', 'team', 'individual')),
  constraint performance_goal_measurement_check
    check (measurement in ('percentage', 'numeric', 'milestone', 'binary')),
  constraint performance_goal_status_check
    check (status in ('draft', 'approved', 'active', 'achieved', 'missed', 'cancelled')),
  constraint performance_goal_owner_check
    check (
      case scope
        when 'individual' then employment_id is not null and organization_unit_id is null
        when 'corporate' then employment_id is null and organization_unit_id is null
        else employment_id is null and organization_unit_id is not null
      end
    ),
  constraint performance_goal_weight_check
    check (weight_basis_points >= 0 and weight_basis_points <= 10000),
  constraint performance_goal_progress_check
    check (progress_basis_points >= 0 and progress_basis_points <= 10000),
  constraint performance_goal_period_check check (due_date >= start_date),
  constraint performance_goal_parent_not_self_check check (parent_goal_id <> id),
  -- A goal is approved by a named human. `system:auto-approval` is not a person, and no module in
  -- this repository has accepted it for a decision somebody is accountable for (D-15).
  constraint performance_goal_approval_check
    check ((approved_at is null) = (approved_by is null)),
  constraint performance_goal_approval_actor_check
    check (approved_by is null or approved_by <> 'system:auto-approval'),
  constraint performance_goal_closure_check
    check ((closed_at is null) = (closed_by is null)),
  -- A cancelled goal carries no score. This is the table half of D-6's sixth decision; the
  -- scoring engine excludes it from the denominator as well.
  constraint performance_goal_cancelled_score_check
    check (status <> 'cancelled' or final_score is null),
  constraint performance_goal_final_score_check check (final_score is null or final_score >= 0)
);

create index performance_goal_employment_idx
  on performance_goal (tenant_id, employment_id, due_date desc) where deleted_at is null;

create index performance_goal_cycle_idx
  on performance_goal (tenant_id, cycle_id, status) where deleted_at is null;

create index performance_goal_parent_idx
  on performance_goal (tenant_id, parent_goal_id) where deleted_at is null;

-- An objective beneath a goal, in the OKR shape the specification names.
create table performance_objective (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  goal_id       uuid not null,
  title         varchar(255) not null,
  description   text,
  display_order smallint not null,
  status        varchar(16) not null,
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint performance_objective_goal_fk foreign key (goal_id) references performance_goal (id),
  constraint performance_objective_status_check
    check (status in ('open', 'achieved', 'missed', 'cancelled'))
);

create index performance_objective_goal_idx
  on performance_objective (tenant_id, goal_id, display_order) where deleted_at is null;

-- A measurable result under an objective.
--
-- The values are integers with a shared exponent, exactly as money is: `target_value = 105` with
-- `value_exponent = -1` is 10.5. A key result measured in a floating-point column would drift, and
-- this is a number somebody is held to.
create table performance_key_result (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  objective_id   uuid not null,
  title          varchar(255) not null,
  unit           varchar(32),
  start_value    bigint not null,
  target_value   bigint not null,
  current_value  bigint not null,
  value_exponent smallint not null,
  display_order  smallint not null,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint performance_key_result_objective_fk
    foreign key (objective_id) references performance_objective (id),
  -- A target equal to the start is a key result that is met before it begins.
  constraint performance_key_result_target_check check (target_value <> start_value),
  constraint performance_key_result_exponent_check
    check (value_exponent >= -6 and value_exponent <= 0)
);

create index performance_key_result_objective_idx
  on performance_key_result (tenant_id, objective_id, display_order) where deleted_at is null;

-- A progress entry. Insert-only: what somebody reported in March is not rewritten in September.
--
-- There is no update method on this table in any repository, and the trigger below refuses one
-- from any path including SQL nobody wrote in TypeScript.
create table performance_goal_progress (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  goal_id               uuid not null,
  key_result_id         uuid,
  progress_basis_points integer not null,
  observed_value        bigint,
  note                  text,
  evidence_document_id  uuid,
  recorded_at           timestamptz(6) not null,
  recorded_by           varchar(255) not null,
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint performance_goal_progress_goal_fk
    foreign key (goal_id) references performance_goal (id),
  constraint performance_goal_progress_key_result_fk
    foreign key (key_result_id) references performance_key_result (id),
  constraint performance_goal_progress_value_check
    check (progress_basis_points >= 0 and progress_basis_points <= 10000)
);

create index performance_goal_progress_goal_idx
  on performance_goal_progress (tenant_id, goal_id, recorded_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Cycles and reviews. A cycle is the container; a review is one employment's instance within it.
-- Payroll's period/run pair is the precedent, and this follows it deliberately.
-- ---------------------------------------------------------------------------------------------

-- A scheduled evaluation period.
--
-- The due dates are configuration and **nothing fires them**. `JobPort` has no adapter anywhere in
-- this repository, so overdue work is a query somebody runs, not a sweep that happens (D-22). The
-- reconciliation query answers "which reviews are incomplete past their due date"; no reminder is
-- sent, and no screen implies one was.
create table performance_cycle (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  code                   varchar(64) not null,
  name                   jsonb not null,
  review_template_id     uuid not null,
  kind                   varchar(24) not null,
  status                 varchar(16) not null,
  period_start           date not null,
  period_end             date not null,
  self_assessment_due    date,
  manager_assessment_due date,
  peer_assessment_due    date,
  calibration_due        date,
  opened_at              timestamptz(6),
  closed_at              timestamptz(6),
  closed_by              varchar(255),
  cancelled_at           timestamptz(6),
  cancellation_reason    varchar(1024),
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint performance_cycle_template_fk
    foreign key (review_template_id) references performance_review_template (id),
  constraint performance_cycle_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_cycle_kind_check
    check (kind in ('annual', 'semi-annual', 'quarterly', 'monthly', 'probation', 'project')),
  constraint performance_cycle_status_check
    check (status in ('draft', 'open', 'in_progress', 'calibration', 'closed', 'cancelled')),
  constraint performance_cycle_period_check check (period_end >= period_start),
  constraint performance_cycle_closure_check check ((closed_at is null) = (closed_by is null)),
  constraint performance_cycle_cancellation_check
    check ((cancelled_at is null) = (cancellation_reason is null))
);

create unique index performance_cycle_code_idx
  on performance_cycle (tenant_id, code) where deleted_at is null;

create index performance_cycle_status_idx
  on performance_cycle (tenant_id, status, period_end desc) where deleted_at is null;

-- Deferred from `performance_goal` above, which is created first because a goal exists
-- independently of any cycle. The reference points forwards, so it is added once the target exists.
alter table performance_goal
  add constraint performance_goal_cycle_fk foreign key (cycle_id) references performance_cycle (id);

-- One employment's review within a cycle. Enrolment and review are the same row: a participant who
-- has no review is not a participant.
--
-- `calculated_score` is what the scoring engine produced from the assessments. `final_score` is
-- what the review is rated at — equal to the calculated score unless a calibration decision
-- overrode it, in which case the calibration decision holds both and this column holds the
-- effective one. **The calculated score is never overwritten** (D-6).
--
-- `manager_employment_id` is the manager at the moment of enrolment. The manager at completion is
-- snapshotted separately, because a transfer between the two is exactly the case the snapshot
-- exists for (D-13).
create table performance_review (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  cycle_id                  uuid not null,
  employment_id             uuid not null,
  manager_employment_id     uuid,
  rating_scale_id           uuid not null,
  status                    varchar(24) not null,
  calculated_score          integer,
  calculated_rating_level_id uuid,
  final_score               integer,
  final_rating_level_id     uuid,
  calibrated                boolean not null default false,
  scored_at                 timestamptz(6),
  completed_at              timestamptz(6),
  completed_by              varchar(255),
  archived_at               timestamptz(6),
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint performance_review_cycle_fk foreign key (cycle_id) references performance_cycle (id),
  constraint performance_review_scale_fk
    foreign key (rating_scale_id) references performance_rating_scale (id),
  constraint performance_review_calculated_level_fk
    foreign key (calculated_rating_level_id) references performance_rating_level (id),
  constraint performance_review_final_level_fk
    foreign key (final_rating_level_id) references performance_rating_level (id),
  constraint performance_review_status_check
    check (status in ('pending', 'self_assessment', 'manager_assessment', 'peer_assessment',
                      'calibration', 'completed', 'archived')),
  constraint performance_review_completion_check
    check ((completed_at is null) = (completed_by is null)),
  -- A review is completed by a named human. Five modules have refused `system:auto-approval` for a
  -- decision somebody is accountable for; a final performance rating is not the exception.
  constraint performance_review_completion_actor_check
    check (completed_by is null or completed_by <> 'system:auto-approval'),
  -- Completion without a score is a rating nobody can explain.
  constraint performance_review_completed_score_check
    check (status <> 'completed' or (final_score is not null and final_rating_level_id is not null)),
  constraint performance_review_archived_check
    check (archived_at is null or completed_at is not null),
  constraint performance_review_score_sign_check
    check ((calculated_score is null or calculated_score >= 0)
           and (final_score is null or final_score >= 0)),
  -- Nothing is calibrated without a recorded decision to point at; the application writes both in
  -- one transaction and the reconciliation query looks for any row that drifted.
  constraint performance_review_calibrated_check check (not calibrated or final_score is not null)
);

create unique index performance_review_participant_idx
  on performance_review (tenant_id, cycle_id, employment_id) where deleted_at is null;

-- The manager queue: this manager's reports, in this cycle, in whatever state they are in.
create index performance_review_manager_idx
  on performance_review (tenant_id, manager_employment_id, cycle_id, status)
  where deleted_at is null;

create index performance_review_employment_idx
  on performance_review (tenant_id, employment_id, completed_at desc) where deleted_at is null;

-- Who was asked to assess this review, and in what capacity.
--
-- 360° is a set of roles here rather than a parallel system (D-2): a peer, a direct report and a
-- skip-level manager are three reviewer roles on one review, not three feature areas. The row
-- records who was asked and whether they answered; the answer itself is an assessment.
create table performance_reviewer_assignment (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  review_id              uuid not null,
  reviewer_employment_id uuid not null,
  role                   varchar(24) not null,
  status                 varchar(16) not null,
  requested_at           timestamptz(6) not null,
  requested_by           varchar(255) not null,
  responded_at           timestamptz(6),
  decline_reason         varchar(1024),
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint performance_reviewer_assignment_review_fk
    foreign key (review_id) references performance_review (id),
  constraint performance_reviewer_assignment_role_check
    check (role in ('self', 'manager', 'peer', 'direct_report', 'skip_level')),
  constraint performance_reviewer_assignment_status_check
    check (status in ('pending', 'submitted', 'declined')),
  constraint performance_reviewer_assignment_response_check
    check ((status = 'pending') = (responded_at is null)),
  constraint performance_reviewer_assignment_decline_check
    check (decline_reason is null or status = 'declined')
);

create unique index performance_reviewer_assignment_idx
  on performance_reviewer_assignment (tenant_id, review_id, reviewer_employment_id, role)
  where deleted_at is null;

create index performance_reviewer_assignment_reviewer_idx
  on performance_reviewer_assignment (tenant_id, reviewer_employment_id, status)
  where deleted_at is null;

-- One assessor's assessment of one review.
--
-- Separate rows per assessor and kind, never states of one record (D-10). A manager cannot
-- overwrite an employee's self-assessment because there is no column in which to do it, and a
-- second peer does not replace the first.
--
-- Immutable from submission, enforced in the domain, in the application and by the trigger below.
-- `assessor_employment_id` comes from the authenticated context at submission and never from a
-- request body: an assessment whose author is client-supplied is an assessment anybody can forge.
create table performance_assessment (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  review_id              uuid not null,
  reviewer_assignment_id uuid,
  assessor_employment_id uuid not null,
  assessment_kind        varchar(24) not null,
  status                 varchar(16) not null,
  goal_score             integer,
  competency_score       integer,
  overall_score          integer,
  rating_level_id        uuid,
  overall_comment        text,
  strengths              text,
  development_areas      text,
  submitted_at           timestamptz(6),
  submitted_by           varchar(255),
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint performance_assessment_review_fk
    foreign key (review_id) references performance_review (id),
  constraint performance_assessment_assignment_fk
    foreign key (reviewer_assignment_id) references performance_reviewer_assignment (id),
  constraint performance_assessment_level_fk
    foreign key (rating_level_id) references performance_rating_level (id),
  constraint performance_assessment_kind_check
    check (assessment_kind in ('self', 'manager', 'peer', 'direct_report', 'skip_level')),
  constraint performance_assessment_status_check check (status in ('draft', 'submitted')),
  constraint performance_assessment_submission_check
    check ((status = 'submitted') = (submitted_at is not null)
           and (submitted_at is null) = (submitted_by is null)),
  constraint performance_assessment_score_check
    check ((goal_score is null or goal_score >= 0)
           and (competency_score is null or competency_score >= 0)
           and (overall_score is null or overall_score >= 0))
);

-- The race in §13: two submissions of the same assessment. One row per assessor per kind, settled
-- by the database rather than by a read-then-write in the application.
create unique index performance_assessment_assessor_idx
  on performance_assessment (tenant_id, review_id, assessor_employment_id, assessment_kind)
  where deleted_at is null;

create index performance_assessment_review_idx
  on performance_assessment (tenant_id, review_id, assessment_kind) where deleted_at is null;

-- One line of an assessment: a goal scored, or a competency rated.
--
-- `excluded` and `exclusion_reason` are D-6's fifth decision made into columns. Work that is
-- missing, incomplete or cancelled is **excluded from the denominator and recorded as excluded**,
-- because silently converting it to a zero would rate somebody down for work nobody assessed.
create table performance_assessment_item (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  assessment_id       uuid not null,
  item_kind           varchar(16) not null,
  goal_id             uuid,
  competency_id       uuid,
  score               integer,
  rating_level_id     uuid,
  weight_basis_points integer,
  comment             text,
  excluded            boolean not null default false,
  exclusion_reason    varchar(32),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint performance_assessment_item_assessment_fk
    foreign key (assessment_id) references performance_assessment (id),
  constraint performance_assessment_item_goal_fk
    foreign key (goal_id) references performance_goal (id),
  constraint performance_assessment_item_competency_fk
    foreign key (competency_id) references performance_competency (id),
  constraint performance_assessment_item_level_fk
    foreign key (rating_level_id) references performance_rating_level (id),
  constraint performance_assessment_item_kind_check check (item_kind in ('goal', 'competency')),
  constraint performance_assessment_item_subject_check
    check (
      case item_kind
        when 'goal' then goal_id is not null and competency_id is null
        else competency_id is not null and goal_id is null
      end
    ),
  constraint performance_assessment_item_exclusion_check
    check (
      case
        when excluded then exclusion_reason is not null and score is null
        else exclusion_reason is null
      end
    ),
  constraint performance_assessment_item_exclusion_reason_check
    check (exclusion_reason is null
           or exclusion_reason in ('missing', 'incomplete', 'cancelled', 'not_applicable')),
  constraint performance_assessment_item_score_check check (score is null or score >= 0),
  constraint performance_assessment_item_weight_check
    check (weight_basis_points is null
           or (weight_basis_points >= 0 and weight_basis_points <= 10000))
);

create unique index performance_assessment_item_goal_idx
  on performance_assessment_item (tenant_id, assessment_id, goal_id)
  where deleted_at is null and item_kind = 'goal';

create unique index performance_assessment_item_competency_idx
  on performance_assessment_item (tenant_id, assessment_id, competency_id)
  where deleted_at is null and item_kind = 'competency';

-- What each component of the final score contributed, and the arithmetic that produced it.
--
-- A rating somebody disagrees with is a conversation, and a conversation needs the working. This
-- table holds the component weight, the component's aggregate, the denominator it was divided by,
-- and — where a component did not participate — the reason it was left out. It is written by the
-- scoring engine in the same transaction as the review's calculated score.
create table performance_review_component_score (
  id                       uuid primary key default app_uuid_v7(),
  tenant_id                uuid not null,
  review_id                uuid not null,
  component                varchar(24) not null,
  weight_basis_points      integer not null,
  score                    integer,
  included                 boolean not null,
  exclusion_reason         varchar(32),
  -- The sum of the weights that actually participated, in basis points. For an unweighted
  -- competency mean this is the count of scored competencies expressed as a weight of one each.
  denominator_basis_points integer not null,
  contributed_score        integer,
  calculated_at            timestamptz(6) not null,
  created_at               timestamptz(6) not null,
  created_by               varchar(255) not null,
  updated_at               timestamptz(6) not null,
  updated_by               varchar(255) not null,
  deleted_at               timestamptz(6),
  deleted_by               varchar(255),
  version                  integer not null,
  constraint performance_review_component_score_review_fk
    foreign key (review_id) references performance_review (id),
  constraint performance_review_component_score_component_check
    check (component in ('goals', 'competencies')),
  constraint performance_review_component_score_weight_check
    check (weight_basis_points >= 0 and weight_basis_points <= 10000),
  constraint performance_review_component_score_inclusion_check
    check (
      case
        when included then score is not null and exclusion_reason is null
        else score is null and exclusion_reason is not null
      end
    ),
  constraint performance_review_component_score_reason_check
    check (exclusion_reason is null
           or exclusion_reason in ('missing', 'incomplete', 'cancelled', 'not_applicable')),
  constraint performance_review_component_score_denominator_check
    check (denominator_basis_points >= 0)
);

create unique index performance_review_component_score_idx
  on performance_review_component_score (tenant_id, review_id, component) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Calibration and talent classification.
-- ---------------------------------------------------------------------------------------------

-- A meeting at which a group of reviews is compared before any of them is completed.
create table performance_calibration_session (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  cycle_id             uuid not null,
  code                 varchar(64) not null,
  name                 jsonb not null,
  status               varchar(16) not null,
  organization_unit_id uuid,
  scheduled_for        timestamptz(6),
  facilitator          varchar(255),
  opened_at            timestamptz(6),
  concluded_at         timestamptz(6),
  concluded_by         varchar(255),
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint performance_calibration_session_cycle_fk
    foreign key (cycle_id) references performance_cycle (id),
  constraint performance_calibration_session_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  constraint performance_calibration_session_status_check
    check (status in ('scheduled', 'in_session', 'concluded')),
  constraint performance_calibration_session_conclusion_check
    check ((concluded_at is null) = (concluded_by is null)),
  constraint performance_calibration_session_conclusion_actor_check
    check (concluded_by is null or concluded_by <> 'system:auto-approval')
);

create unique index performance_calibration_session_code_idx
  on performance_calibration_session (tenant_id, cycle_id, code) where deleted_at is null;

-- What a calibration session decided about one review.
--
-- **The original is kept.** `original_score` and `original_rating_level_id` are the scoring
-- engine's output; the calibrated columns are what the session settled on. The calibrated value
-- becomes effective on the review, and this row is the immutable record of what it was before,
-- who changed it, when, and why (D-6's seventh decision).
--
-- A reason is not optional. A rating changed in a meeting with no recorded reason is a rating
-- nobody can defend to the person it belongs to.
create table performance_calibration_decision (
  id                         uuid primary key default app_uuid_v7(),
  tenant_id                  uuid not null,
  calibration_session_id     uuid not null,
  review_id                  uuid not null,
  original_score             integer,
  original_rating_level_id   uuid,
  calibrated_score           integer not null,
  calibrated_rating_level_id uuid not null,
  reason                     varchar(1024) not null,
  decided_at                 timestamptz(6) not null,
  decided_by                 varchar(255) not null,
  created_at                 timestamptz(6) not null,
  created_by                 varchar(255) not null,
  updated_at                 timestamptz(6) not null,
  updated_by                 varchar(255) not null,
  deleted_at                 timestamptz(6),
  deleted_by                 varchar(255),
  version                    integer not null,
  constraint performance_calibration_decision_session_fk
    foreign key (calibration_session_id) references performance_calibration_session (id),
  constraint performance_calibration_decision_review_fk
    foreign key (review_id) references performance_review (id),
  constraint performance_calibration_decision_original_level_fk
    foreign key (original_rating_level_id) references performance_rating_level (id),
  constraint performance_calibration_decision_level_fk
    foreign key (calibrated_rating_level_id) references performance_rating_level (id),
  constraint performance_calibration_decision_score_check
    check (calibrated_score >= 0 and (original_score is null or original_score >= 0)),
  constraint performance_calibration_decision_reason_check check (length(trim(reason)) > 0),
  constraint performance_calibration_decision_actor_check
    check (decided_by <> 'system:auto-approval')
);

create unique index performance_calibration_decision_idx
  on performance_calibration_decision (tenant_id, calibration_session_id, review_id)
  where deleted_at is null;

create index performance_calibration_decision_review_idx
  on performance_calibration_decision (tenant_id, review_id, decided_at desc)
  where deleted_at is null;

-- The nine-box placement: performance against potential, for one employment in one cycle.
--
-- Performance publishes this as a **recommendation**. It changes no employment, triggers no
-- promotion and writes to no other module; Career & Succession (Phase 15) may pull it (D-17).
--
-- The performance band is derived from the review's rating. The potential band is a human
-- judgement, which is why it carries an assessor and a rationale rather than being computed.
create table performance_talent_placement (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  cycle_id          uuid not null,
  review_id         uuid not null,
  employment_id     uuid not null,
  performance_band  smallint not null,
  potential_band    smallint not null,
  box_code          varchar(16) not null,
  rationale         text,
  placed_at         timestamptz(6) not null,
  placed_by         varchar(255) not null,
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint performance_talent_placement_cycle_fk
    foreign key (cycle_id) references performance_cycle (id),
  constraint performance_talent_placement_review_fk
    foreign key (review_id) references performance_review (id),
  constraint performance_talent_placement_performance_check
    check (performance_band between 1 and 3),
  constraint performance_talent_placement_potential_check
    check (potential_band between 1 and 3),
  constraint performance_talent_placement_actor_check
    check (placed_by <> 'system:auto-approval')
);

create unique index performance_talent_placement_idx
  on performance_talent_placement (tenant_id, cycle_id, employment_id) where deleted_at is null;

create index performance_talent_placement_box_idx
  on performance_talent_placement (tenant_id, cycle_id, box_code) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Continuous feedback.
-- ---------------------------------------------------------------------------------------------

-- Feedback given outside a review.
--
-- `performance_feedback`, never a bare `feedback`: Recruitment (Phase 7) already owns interview
-- feedback with its own states and its own meaning, and two tables called `feedback` in one
-- database is a vocabulary collision waiting to be mis-joined (D-20).
--
-- Insert-only. There is no update method in any repository: feedback somebody gave is what they
-- said, and a record that can be edited afterwards is not a record of what was said.
create table performance_feedback (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  subject_employment_id  uuid not null,
  author_employment_id   uuid not null,
  kind                   varchar(24) not null,
  visibility             varchar(16) not null,
  body                   text not null,
  related_goal_id        uuid,
  related_review_id      uuid,
  requested_by           varchar(255),
  given_at               timestamptz(6) not null,
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint performance_feedback_goal_fk
    foreign key (related_goal_id) references performance_goal (id),
  constraint performance_feedback_review_fk
    foreign key (related_review_id) references performance_review (id),
  constraint performance_feedback_kind_check
    check (kind in ('praise', 'suggestion', 'observation', 'requested')),
  -- `subject` means the person it is about can read it; `manager` adds their manager; `hr` is
  -- neither of those. There is no `anonymous` value, because this table cannot provide one.
  constraint performance_feedback_visibility_check
    check (visibility in ('subject', 'manager', 'hr')),
  constraint performance_feedback_body_check check (length(trim(body)) > 0),
  -- Feedback about oneself is a note, not feedback, and it would distort every aggregate built
  -- from this table.
  constraint performance_feedback_self_check
    check (subject_employment_id <> author_employment_id)
);

create index performance_feedback_subject_idx
  on performance_feedback (tenant_id, subject_employment_id, given_at desc) where deleted_at is null;

create index performance_feedback_author_idx
  on performance_feedback (tenant_id, author_employment_id, given_at desc) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- The completion snapshot.
-- ---------------------------------------------------------------------------------------------

-- What a completed review must survive: a manager change, a department move, a competency
-- redefinition, a rating-scale change, a goal redefinition and a position change.
--
-- Written once, at completion, and immutable afterwards. It holds the inputs to the decision — the
-- reviewers and their roles, the manager at the time, the organizational placement, the rating
-- scale and its levels, the framework version and each competency's definition, each goal's
-- definition and weight, and every component score with its arithmetic.
--
-- It holds **no person's name and no pay figure**. A snapshot is the inputs to a decision, not a
-- copy of the database (ADR-0064, and Phase 11's discipline applied here).
create table performance_review_snapshot (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  review_id             uuid not null,
  manager_employment_id uuid,
  reviewers             jsonb not null,
  placement             jsonb not null,
  rating_scale          jsonb not null,
  competency_framework  jsonb,
  goals                 jsonb not null,
  component_scores      jsonb not null,
  calculation           jsonb not null,
  taken_at              timestamptz(6) not null,
  taken_by              varchar(255) not null,
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint performance_review_snapshot_review_fk
    foreign key (review_id) references performance_review (id)
);

create unique index performance_review_snapshot_review_idx
  on performance_review_snapshot (tenant_id, review_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Immutability, at the table.
--
-- The mechanism and its cost were settled in ADR-0066; this reuses it rather than inventing a
-- second approach. Phase 12's lesson is applied deliberately: **a trigger that refuses too much is
-- as much a defect as one that refuses too little**, so each rule below names exactly the moment
-- the row freezes, and the integration suite asserts the permitted case alongside the refusals.
-- ---------------------------------------------------------------------------------------------

-- A progress entry is written once. What somebody reported in March is not rewritten in September.
create or replace function app_performance_goal_progress_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'performance_goal_progress_immutable'
    using errcode = 'restrict_violation',
          detail = format('performance_goal_progress %s is immutable', old.id),
          hint = 'A correction records a new progress entry. Nothing rewrites an existing one.';
end; $$;

create trigger performance_goal_progress_no_mutation
  before update or delete on performance_goal_progress
  for each row execute function app_performance_goal_progress_immutable();

-- A submitted assessment is frozen. Before submission it is a draft its author may edit freely;
-- from submission it is one named person's recorded opinion of another's work.
--
-- The one permitted change after submission is the soft delete a retention policy performs, and
-- even that leaves every other column untouched — which is why the comparison below ignores the
-- delete columns and the audit trail that accompanies them.
create or replace function app_performance_assessment_refuse_change() returns trigger
language plpgsql as $$
declare
  unchanged_old jsonb;
  unchanged_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'performance_assessment_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_assessment %s is immutable', old.id),
            hint = 'A submitted assessment is retained. A correction is a new assessment.';
  end if;

  if old.status <> 'submitted' then
    return new;
  end if;

  unchanged_old := to_jsonb(old) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';
  unchanged_new := to_jsonb(new) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';

  if unchanged_old <> unchanged_new then
    raise exception 'performance_assessment_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_assessment %s was submitted and is frozen', old.id),
            hint = 'A submitted assessment is not edited. A correction is a new assessment.';
  end if;
  return new;
end; $$;

create trigger performance_assessment_immutable
  before update or delete on performance_assessment
  for each row execute function app_performance_assessment_refuse_change();

-- An item belongs to its assessment, and freezes with it. Without this the scores could be
-- rewritten underneath a frozen header, which would make the header's immutability decorative.
create or replace function app_performance_assessment_item_refuse_change() returns trigger
language plpgsql as $$
declare
  submitted boolean;
begin
  select status = 'submitted' into submitted
    from performance_assessment
   where id = coalesce(new.assessment_id, old.assessment_id);

  if coalesce(submitted, false) then
    raise exception 'performance_assessment_item_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_assessment_item %s belongs to a submitted assessment',
                            old.id),
            hint = 'A submitted assessment is not edited. A correction is a new assessment.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end; $$;

create trigger performance_assessment_item_immutable
  before update or delete on performance_assessment_item
  for each row execute function app_performance_assessment_item_refuse_change();

-- A completed review is frozen (AD-004). The permitted changes afterwards are archival and the
-- soft delete a retention policy performs; a correction is a new review in a new cycle.
--
-- This is also what settles the race in §13: two managers completing one review contend on the
-- optimistic `version`, and whichever loses meets this trigger rather than silently overwriting a
-- final rating. A unique partial index on the completed state would have been vacuous — one row
-- cannot collide with itself — so the guarantee is stated where it actually holds.
create or replace function app_performance_review_refuse_change() returns trigger
language plpgsql as $$
declare
  unchanged_old jsonb;
  unchanged_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'performance_review_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_review %s is immutable', old.id),
            hint = 'A completed review is retained. A correction is a new review.';
  end if;

  if old.completed_at is null then
    return new;
  end if;

  unchanged_old := to_jsonb(old) - 'status' - 'archived_at' - 'deleted_at' - 'deleted_by'
                   - 'updated_at' - 'updated_by' - 'version';
  unchanged_new := to_jsonb(new) - 'status' - 'archived_at' - 'deleted_at' - 'deleted_by'
                   - 'updated_at' - 'updated_by' - 'version';

  if unchanged_old <> unchanged_new then
    raise exception 'performance_review_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_review %s was completed and is frozen', old.id),
            hint = 'A rating changes only through a recorded calibration decision, before completion.';
  end if;

  -- Archival is the one status move a completed review makes, and it makes it once.
  if new.status not in ('completed', 'archived') or old.status = 'archived' then
    raise exception 'performance_review_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_review %s cannot move from %s to %s',
                            old.id, old.status, new.status),
            hint = 'A completed review is archived. It does not reopen.';
  end if;
  return new;
end; $$;

create trigger performance_review_immutable
  before update or delete on performance_review
  for each row execute function app_performance_review_refuse_change();

-- A calibration decision is evidence of what a meeting changed and why. It is never edited: the
-- original score it records is the whole point, and a record whose "before" can be rewritten
-- records nothing.
create or replace function app_performance_calibration_decision_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'performance_calibration_decision_immutable'
    using errcode = 'restrict_violation',
          detail = format('performance_calibration_decision %s is immutable', old.id),
          hint = 'A different outcome is a new decision in a new session, not an edit of this one.';
end; $$;

create trigger performance_calibration_decision_no_mutation
  before update or delete on performance_calibration_decision
  for each row execute function app_performance_calibration_decision_immutable();

-- The snapshot is the reason a completed review can still be explained years later.
create or replace function app_performance_review_snapshot_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'performance_review_snapshot_immutable'
    using errcode = 'restrict_violation',
          detail = format('performance_review_snapshot %s is immutable', old.id),
          hint = 'A snapshot records the inputs to a completed decision. It is never rewritten.';
end; $$;

create trigger performance_review_snapshot_no_mutation
  before update or delete on performance_review_snapshot
  for each row execute function app_performance_review_snapshot_immutable();

-- Feedback somebody gave is what they said. There is no update path in any repository, and the
-- table refuses one too: withdrawal is a soft delete, which leaves every word of it in place.
create or replace function app_performance_feedback_immutable() returns trigger
language plpgsql as $$
declare
  unchanged_old jsonb;
  unchanged_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'performance_feedback_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_feedback %s is immutable', old.id),
            hint = 'Feedback is withdrawn by a soft delete, never removed.';
  end if;

  unchanged_old := to_jsonb(old) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';
  unchanged_new := to_jsonb(new) - 'deleted_at' - 'deleted_by' - 'updated_at' - 'updated_by'
                   - 'version';

  if unchanged_old <> unchanged_new then
    raise exception 'performance_feedback_immutable'
      using errcode = 'restrict_violation',
            detail = format('performance_feedback %s is frozen as given', old.id),
            hint = 'Feedback is withdrawn by a soft delete, never edited.';
  end if;
  return new;
end; $$;

create trigger performance_feedback_no_mutation
  before update or delete on performance_feedback
  for each row execute function app_performance_feedback_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy, with no exception.
--
-- **What these policies do not express**, stated here rather than left to be assumed: employee A
-- must not read employee B's review, and that is not a tenant property. A policy would need to
-- know which employment the caller *is*, and this product has no principal-to-employment
-- resolution (ADR-0032). That guarantee therefore lives in the application layer and is asserted
-- at the HTTP edge — the database enforces tenant isolation and nothing finer.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('performance_rating_scale');
call app_protect_table('performance_rating_level');
call app_protect_table('performance_competency_framework');
call app_protect_table('performance_competency');
call app_protect_table('performance_competency_level');
call app_protect_table('performance_goal_category');
call app_protect_table('performance_review_template');
call app_protect_table('performance_review_template_component');
call app_protect_table('performance_goal');
call app_protect_table('performance_objective');
call app_protect_table('performance_key_result');
call app_protect_table('performance_goal_progress');
call app_protect_table('performance_cycle');
call app_protect_table('performance_review');
call app_protect_table('performance_reviewer_assignment');
call app_protect_table('performance_assessment');
call app_protect_table('performance_assessment_item');
call app_protect_table('performance_review_component_score');
call app_protect_table('performance_calibration_session');
call app_protect_table('performance_calibration_decision');
call app_protect_table('performance_talent_placement');
call app_protect_table('performance_feedback');
call app_protect_table('performance_review_snapshot');
