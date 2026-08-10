-- Compensation Management — what an employment is entitled to receive (Phase 10).
--
-- Fourteen tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step.
--
-- Six decisions in this file are the ones a reviewer should challenge.
--
--   * **Money is `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint`,
--     on every monetary row.** Not `numeric`, not `double precision`, and never a JavaScript
--     `number`. The exponent is carried beside the amount rather than looked up, because nothing in
--     this product publishes a currency's exponent and a historical row must stay exactly
--     reconstructable years later without a join to a table that can move. Two decimal places is a
--     habit, not a rule: KWD, BHD and OMR all have three (D-2).
--
--   * **Overlapping recurring compensation is refused by the database.**
--     `compensation_recurring_overlap` is a GiST exclusion constraint over
--     `daterange(effective_from, effective_to, '[)')`, so two administrators assigning the same
--     allowance concurrently race here rather than both committing. Application validation alone
--     loses that race, because both read before either wrote (D-4).
--
--   * **Historical value columns are never rewritten.** A change closes the previous period by
--     writing `effective_to` and inserts a new row. An amount assigned from a salary step is
--     *copied* onto the assignment, so revising the step next year cannot silently restate what
--     last year's payroll was run against.
--
--   * **Self-approval is refused by a check constraint**, not only by the domain.
--     `compensation_approval_decision` carries a copy of `requested_by` for exactly that purpose: a
--     check constraint cannot reach another table (D-9).
--
--   * **Both time axes are recorded.** `effective_from` answers "what was true on this date";
--     `recorded_at` answers "when did the system learn it". Without the second, a payroll dispute
--     cannot distinguish a back-dated raise from one everybody always knew about (D-5).
--
--   * **No statutory content, no deduction and no computed payment.** There is no tax column, no
--     social-security column, no gross, no net, no end-of-service accrual and no deduction table.
--     What is actually paid for a period is Payroll's (Phase 11); deductions are excluded from this
--     phase entirely (D-1); loan recovery is Phase 10.1's.
--
-- `btree_gist` is already installed by the Leave migration, so the exclusion constraint below needs
-- no new extension.

-- ---------------------------------------------------------------------------------------------
-- Configuration: the plan an employment is governed by, and the structures it may reference.
-- ---------------------------------------------------------------------------------------------

-- A compensation plan version. Immutable once published, like every definition in this product
-- (ADR-0048): a compensation record names the version that governed it, and a plan edited in June
-- would rewrite what March meant.
create table compensation_plan (
  id                             uuid primary key default app_uuid_v7(),
  tenant_id                      uuid not null,
  code                           varchar(64) not null,
  name                           jsonb not null,
  version_number                 integer not null,
  status                         varchar(24) not null,
  -- Optional. Every level of the salary hierarchy is optional, and a plan that names no structure
  -- is the ordinary shape for a company that pays simple salaries.
  salary_structure_id            uuid,
  default_currency_code          char(3) not null,
  default_currency_exponent      smallint not null,
  approval_required              boolean not null,
  approvals_required             smallint not null,
  self_approval_permitted        boolean not null,
  -- Change control, in basis points. Both nullable and inert when null — the discipline every
  -- threshold in this product follows. Nothing statutory is implied by either.
  maximum_increase_basis_points  integer,
  maximum_decrease_basis_points  integer,
  -- Null for a tenant-defined plan; set when a country pack authored this version (ADR-0025).
  country_pack_id                varchar(64),
  country_pack_version           integer,
  published_at                   timestamptz(6),
  published_by                   varchar(255),
  metadata                       jsonb not null default '{}',
  created_at                     timestamptz(6) not null,
  created_by                     varchar(255) not null,
  updated_at                     timestamptz(6) not null,
  updated_by                     varchar(255) not null,
  deleted_at                     timestamptz(6),
  deleted_by                     varchar(255),
  version                        integer not null,
  constraint compensation_plan_status_check check (status in ('draft', 'published', 'superseded')),
  constraint compensation_plan_name_check check (name ? 'en' and name ? 'ar'),
  constraint compensation_plan_currency_shape_check check (default_currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_plan_exponent_check
    check (default_currency_exponent between 0 and 4),
  constraint compensation_plan_approvals_check check (approvals_required between 0 and 10),
  constraint compensation_plan_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint compensation_plan_increase_check
    check (maximum_increase_basis_points is null or maximum_increase_basis_points >= 0),
  constraint compensation_plan_decrease_check
    check (maximum_decrease_basis_points is null or maximum_decrease_basis_points >= 0),
  constraint compensation_plan_pack_check
    check ((country_pack_id is null) = (country_pack_version is null))
);

create unique index compensation_plan_code_key
  on compensation_plan (tenant_id, code, version_number)
  where deleted_at is null;
create index compensation_plan_status_idx on compensation_plan (tenant_id, status);

-- Which plan version governs which scope, effective-dated. Most-specific-wins is resolved in the
-- domain; a tie is refused rather than broken, because two plans claiming one unit on one date is a
-- configuration mistake with no correct answer.
create table compensation_plan_assignment (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  compensation_plan_id uuid not null,
  scope                varchar(24) not null,
  scope_id             uuid,
  effective_from       date not null,
  effective_to         date,
  reason_code          varchar(64),
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint compensation_plan_assignment_plan_fk
    foreign key (compensation_plan_id) references compensation_plan (id),
  constraint compensation_plan_assignment_scope_check
    check (scope in ('tenant', 'legal_entity', 'unit', 'employment')),
  -- A tenant assignment applies to everybody and therefore names nobody; every other scope must.
  constraint compensation_plan_assignment_scope_id_check
    check ((scope = 'tenant') = (scope_id is null)),
  constraint compensation_plan_assignment_period_check
    check (effective_to is null or effective_to > effective_from)
);

create index compensation_plan_assignment_scope_idx
  on compensation_plan_assignment (tenant_id, scope, scope_id, effective_from);
create index compensation_plan_assignment_plan_idx
  on compensation_plan_assignment (tenant_id, compensation_plan_id);

-- The optional root of the salary hierarchy. A tenant that pays simple salaries has none.
create table compensation_salary_structure (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  code           varchar(64) not null,
  name           jsonb not null,
  description    varchar(1024),
  status         varchar(24) not null,
  effective_from date not null,
  effective_to   date,
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint compensation_salary_structure_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint compensation_salary_structure_name_check check (name ? 'en' and name ? 'ar'),
  constraint compensation_salary_structure_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index compensation_salary_structure_code_key
  on compensation_salary_structure (tenant_id, code)
  where deleted_at is null;

-- A pay range: a minimum, a midpoint, a maximum and a currency, effective-dated.
--
-- `position_grade_label` is the whole of its relationship with Organization's `position.grade`, and
-- it is deliberately a *label* rather than a foreign key (D-8). Organization's grade is an opaque
-- job-architecture band; this is a monetary range. A foreign key would make Compensation unable to
-- price anything Organization had not graded.
create table compensation_pay_grade (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  salary_structure_id  uuid,
  code                 varchar(64) not null,
  name                 jsonb not null,
  description          varchar(1024),
  minimum_minor        bigint not null,
  midpoint_minor       bigint not null,
  maximum_minor        bigint not null,
  currency_code        char(3) not null,
  currency_exponent    smallint not null,
  position_grade_label varchar(64),
  status               varchar(24) not null,
  effective_from       date not null,
  effective_to         date,
  metadata             jsonb not null default '{}',
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint compensation_pay_grade_structure_fk
    foreign key (salary_structure_id) references compensation_salary_structure (id),
  constraint compensation_pay_grade_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint compensation_pay_grade_name_check check (name ? 'en' and name ? 'ar'),
  -- A grade whose midpoint sits outside its own range is a configuration mistake the database can
  -- refuse for free.
  constraint compensation_pay_grade_order_check
    check (minimum_minor <= midpoint_minor and midpoint_minor <= maximum_minor),
  constraint compensation_pay_grade_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_pay_grade_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_pay_grade_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index compensation_pay_grade_code_key
  on compensation_pay_grade (tenant_id, code, effective_from)
  where deleted_at is null;
create index compensation_pay_grade_structure_idx
  on compensation_pay_grade (tenant_id, salary_structure_id, effective_from);

-- A scale within a grade. `progression_model` is a code Compensation stores and never acts on:
-- nothing in this module moves an employment between steps by itself.
create table compensation_pay_scale (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  pay_grade_id       uuid not null,
  code               varchar(64) not null,
  name               jsonb not null,
  minimum_minor      bigint not null,
  midpoint_minor     bigint not null,
  maximum_minor      bigint not null,
  currency_code      char(3) not null,
  currency_exponent  smallint not null,
  progression_model  varchar(64) not null,
  status             varchar(24) not null,
  effective_from     date not null,
  effective_to       date,
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint compensation_pay_scale_grade_fk
    foreign key (pay_grade_id) references compensation_pay_grade (id),
  constraint compensation_pay_scale_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint compensation_pay_scale_name_check check (name ? 'en' and name ? 'ar'),
  constraint compensation_pay_scale_order_check
    check (minimum_minor <= midpoint_minor and midpoint_minor <= maximum_minor),
  constraint compensation_pay_scale_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_pay_scale_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_pay_scale_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index compensation_pay_scale_code_key
  on compensation_pay_scale (tenant_id, pay_grade_id, code)
  where deleted_at is null;
create index compensation_pay_scale_grade_idx on compensation_pay_scale (tenant_id, pay_grade_id);

-- A step belongs to a scale **or** to a grade, and exactly one of the two. A step under a grade is
-- the shape a tenant uses when it has grades and steps but no intermediate scales.
create table compensation_salary_step (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  pay_scale_id      uuid,
  pay_grade_id      uuid,
  step_number       smallint not null,
  code              varchar(64),
  amount_minor      bigint not null,
  currency_code     char(3) not null,
  currency_exponent smallint not null,
  effective_from    date not null,
  effective_to      date,
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint compensation_salary_step_scale_fk
    foreign key (pay_scale_id) references compensation_pay_scale (id),
  constraint compensation_salary_step_grade_fk
    foreign key (pay_grade_id) references compensation_pay_grade (id),
  constraint compensation_salary_step_parent_check
    check ((pay_scale_id is null) <> (pay_grade_id is null)),
  constraint compensation_salary_step_number_check check (step_number > 0),
  constraint compensation_salary_step_amount_check check (amount_minor >= 0),
  constraint compensation_salary_step_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_salary_step_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_salary_step_period_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index compensation_salary_step_scale_key
  on compensation_salary_step (tenant_id, pay_scale_id, step_number)
  where deleted_at is null and pay_scale_id is not null;
create unique index compensation_salary_step_grade_key
  on compensation_salary_step (tenant_id, pay_grade_id, step_number)
  where deleted_at is null and pay_grade_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Components: the configurable definition of a thing an employment can be entitled to.
-- ---------------------------------------------------------------------------------------------

-- Nothing is seeded. There is no basic salary here, no housing allowance, no transport allowance
-- and no meal allowance — every one of them is a component a tenant or a country pack defines
-- (00B). `kind` excludes `deduction`: deductions are out of scope for this phase (D-1).
--
-- `payroll_treatment_code` is the whole of the tax boundary. Compensation stores it and never reads
-- it; what it means is Payroll's country pack's question.
create table compensation_component (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  code                    varchar(64) not null,
  name                    jsonb not null,
  kind                    varchar(24) not null,
  calculation_basis       varchar(32) not null,
  basis_component_id      uuid,
  percentage_basis_points integer,
  rounding_mode           varchar(16) not null,
  recurrence              varchar(16) not null,
  payroll_treatment_code  varchar(64) not null,
  proratable              boolean not null,
  eligibility_rule        jsonb,
  statutory_source_code   varchar(64),
  status                  varchar(24) not null,
  version_number          integer not null,
  published_at            timestamptz(6),
  published_by            varchar(255),
  metadata                jsonb not null default '{}',
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint compensation_component_basis_fk
    foreign key (basis_component_id) references compensation_component (id),
  constraint compensation_component_kind_check check (kind in ('base', 'allowance', 'one_time')),
  constraint compensation_component_basis_kind_check
    check (calculation_basis in ('fixed_amount', 'percentage_of_component')),
  -- A percentage names what it is a percentage of, and states the percentage. Neither is optional,
  -- and a fixed amount carries neither.
  constraint compensation_component_percentage_check
    check (
      (calculation_basis = 'percentage_of_component')
        = (basis_component_id is not null and percentage_basis_points is not null)
    ),
  constraint compensation_component_basis_points_check
    check (percentage_basis_points is null or percentage_basis_points between 0 and 1000000),
  -- Rounding is stated, never defaulted: `Money.multipliedBy` has no default mode and that is
  -- deliberate.
  constraint compensation_component_rounding_check
    check (rounding_mode in ('half-up', 'half-even', 'down', 'up')),
  constraint compensation_component_recurrence_check
    check (recurrence in ('recurring', 'one_time')),
  constraint compensation_component_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint compensation_component_name_check check (name ? 'en' and name ? 'ar'),
  constraint compensation_component_publication_check
    check ((published_at is null) = (published_by is null)),
  constraint compensation_component_self_basis_check
    check (basis_component_id is null or basis_component_id <> id)
);

create unique index compensation_component_code_key
  on compensation_component (tenant_id, code, version_number)
  where deleted_at is null;
create index compensation_component_status_idx on compensation_component (tenant_id, status, kind);

-- Which components a plan version permits, and on what terms.
create table compensation_plan_component (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  compensation_plan_id  uuid not null,
  component_id          uuid not null,
  mandatory             boolean not null,
  minimum_minor         bigint,
  maximum_minor         bigint,
  currency_code         char(3),
  currency_exponent     smallint,
  eligibility_rule      jsonb,
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint compensation_plan_component_plan_fk
    foreign key (compensation_plan_id) references compensation_plan (id),
  constraint compensation_plan_component_component_fk
    foreign key (component_id) references compensation_component (id),
  -- A bound is a monetary value, so it carries its currency and exponent or it carries neither.
  constraint compensation_plan_component_currency_check
    check ((currency_code is null) = (currency_exponent is null)),
  constraint compensation_plan_component_bounds_currency_check
    check (
      (minimum_minor is null and maximum_minor is null) or currency_code is not null
    ),
  constraint compensation_plan_component_bounds_check
    check (minimum_minor is null or maximum_minor is null or minimum_minor <= maximum_minor),
  constraint compensation_plan_component_currency_shape_check
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_plan_component_exponent_check
    check (currency_exponent is null or currency_exponent between 0 and 4)
);

create unique index compensation_plan_component_key
  on compensation_plan_component (tenant_id, compensation_plan_id, component_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- The authoritative compensation records.
-- ---------------------------------------------------------------------------------------------

-- What an employment is entitled to receive repeatedly.
--
-- The amount is **copied here**, never joined from a step or a grade: revising a step next year
-- must not restate what last year's payroll was run against. `recorded_at` is the system-time axis
-- beside the business-time `effective_from`, and it is what makes a retroactive correction
-- explainable rather than indistinguishable from a change everybody always knew about.
create table compensation_recurring (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  employment_id           uuid not null,
  component_id            uuid not null,
  compensation_plan_id    uuid not null,
  pay_grade_id            uuid,
  pay_scale_id            uuid,
  salary_step_id          uuid,
  amount_minor            bigint not null,
  currency_code           char(3) not null,
  currency_exponent       smallint not null,
  percentage_basis_points integer,
  basis_component_id      uuid,
  effective_from          date not null,
  effective_to            date,
  recorded_at             timestamptz(6) not null,
  recorded_by             varchar(255) not null,
  source                  varchar(24) not null,
  source_id               varchar(128),
  reason_code             varchar(64),
  note                    varchar(1024),
  approval_state          varchar(24) not null,
  approved_at             timestamptz(6),
  supersedes_id           uuid,
  metadata                jsonb not null default '{}',
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint compensation_recurring_employment_fk
    foreign key (employment_id) references employment (id),
  constraint compensation_recurring_component_fk
    foreign key (component_id) references compensation_component (id),
  constraint compensation_recurring_plan_fk
    foreign key (compensation_plan_id) references compensation_plan (id),
  constraint compensation_recurring_grade_fk
    foreign key (pay_grade_id) references compensation_pay_grade (id),
  constraint compensation_recurring_scale_fk
    foreign key (pay_scale_id) references compensation_pay_scale (id),
  constraint compensation_recurring_step_fk
    foreign key (salary_step_id) references compensation_salary_step (id),
  constraint compensation_recurring_basis_fk
    foreign key (basis_component_id) references compensation_component (id),
  constraint compensation_recurring_supersedes_fk
    foreign key (supersedes_id) references compensation_recurring (id),
  -- Zero is permitted and meaningful: "entitled to this component, currently at nothing" is a
  -- different fact from "not entitled to it", and only the first is expressible any other way.
  constraint compensation_recurring_amount_check check (amount_minor >= 0),
  constraint compensation_recurring_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_recurring_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_recurring_percentage_check
    check ((percentage_basis_points is null) = (basis_component_id is null)),
  constraint compensation_recurring_period_check
    check (effective_to is null or effective_to > effective_from),
  constraint compensation_recurring_source_check
    check (source in ('manual', 'import', 'adjustment', 'plan_assignment', 'offer')),
  constraint compensation_recurring_approval_check
    check (approval_state in ('not_required', 'pending', 'approved', 'rejected')),
  constraint compensation_recurring_approved_check
    check (approved_at is null or approval_state = 'approved'),
  constraint compensation_recurring_self_supersede_check
    check (supersedes_id is null or supersedes_id <> id)
);

-- **The overlap invariant, in the database.** One employment holds at most one active assignment of
-- the same component at the same time. `'[)'` — half-open — so a period ending on the day the next
-- begins does not overlap it, which is exactly how a timeline closes a period. The tenant is part
-- of the constraint so one tenant's assignment cannot block another's.
alter table compensation_recurring
  add constraint compensation_recurring_overlap
  exclude using gist (
    tenant_id with =,
    employment_id with =,
    component_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (deleted_at is null);

-- The index the current-compensation, as-of and set-based payroll-period reads all lead with.
create index compensation_recurring_effective_idx
  on compensation_recurring (tenant_id, employment_id, component_id, effective_from desc);
-- The reconciliation read: what Payroll pulls to find retroactive corrections.
create index compensation_recurring_recorded_idx
  on compensation_recurring (tenant_id, recorded_at desc, id);
-- The register's sort, exactly. `id desc` rather than `id`, because PostgreSQL can only walk an
-- index backwards when *every* key reverses: an index on `(effective_from desc, id)` cannot serve
-- `order by effective_from desc, id desc`, and the planner falls back to an incremental sort over
-- the whole table. Measured at 624 ms before this and 0.3 ms after.
create index compensation_recurring_register_idx
  on compensation_recurring (tenant_id, effective_from desc, id desc)
  where deleted_at is null;

-- An import writes once. Retried, it finds its row already present and skips it.
create unique index compensation_recurring_source_key
  on compensation_recurring (tenant_id, source, source_id, component_id, employment_id)
  where deleted_at is null and source_id is not null;

-- Bonuses, commissions and awards. No effective period, therefore no overlap rule: two bonuses on
-- one date is ordinary. Compensation records that it is owed and when it becomes payable; which
-- payroll period consumes it is Payroll's decision.
create table compensation_one_time (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  employment_id          uuid not null,
  component_id           uuid not null,
  compensation_plan_id   uuid not null,
  amount_minor           bigint not null,
  currency_code          char(3) not null,
  currency_exponent      smallint not null,
  payable_on             date not null,
  reason_code            varchar(64) not null,
  note                   varchar(1024),
  source                 varchar(24) not null,
  source_id              varchar(128),
  recorded_at            timestamptz(6) not null,
  recorded_by            varchar(255) not null,
  approval_state         varchar(24) not null,
  approved_at            timestamptz(6),
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint compensation_one_time_employment_fk
    foreign key (employment_id) references employment (id),
  constraint compensation_one_time_component_fk
    foreign key (component_id) references compensation_component (id),
  constraint compensation_one_time_plan_fk
    foreign key (compensation_plan_id) references compensation_plan (id),
  constraint compensation_one_time_amount_check check (amount_minor >= 0),
  constraint compensation_one_time_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_one_time_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_one_time_source_check
    check (source in ('manual', 'import', 'adjustment', 'plan_assignment', 'offer')),
  constraint compensation_one_time_approval_check
    check (approval_state in ('not_required', 'pending', 'approved', 'rejected'))
);

create unique index compensation_one_time_source_key
  on compensation_one_time (tenant_id, source, source_id, component_id, employment_id)
  where deleted_at is null and source_id is not null;
create index compensation_one_time_period_idx
  on compensation_one_time (tenant_id, employment_id, payable_on);
create index compensation_one_time_payable_idx
  on compensation_one_time (tenant_id, payable_on desc, id desc)
  where deleted_at is null;
create index compensation_one_time_recorded_idx
  on compensation_one_time (tenant_id, recorded_at desc, id);

-- ---------------------------------------------------------------------------------------------
-- The explanation beside a change, the decision that authorized it, and the log of both.
-- ---------------------------------------------------------------------------------------------

-- An adjustment is the *reason record* beside a compensation change, not a second way to store one.
-- A reason code and a written note are both required, for the reason Leave requires them on a
-- balance adjustment: it is the movement no rule produced, which makes it the one an auditor reads
-- first.
create table compensation_adjustment (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  employment_id         uuid not null,
  component_id          uuid,
  adjustment_type       varchar(64) not null,
  previous_amount_minor bigint,
  new_amount_minor      bigint,
  currency_code         char(3) not null,
  currency_exponent     smallint not null,
  effective_from        date not null,
  reason_code           varchar(64) not null,
  note                  varchar(1024) not null,
  requested_by          varchar(255) not null,
  recorded_at           timestamptz(6) not null,
  approval_state        varchar(24) not null,
  recurring_id          uuid,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint compensation_adjustment_employment_fk
    foreign key (employment_id) references employment (id),
  constraint compensation_adjustment_component_fk
    foreign key (component_id) references compensation_component (id),
  constraint compensation_adjustment_recurring_fk
    foreign key (recurring_id) references compensation_recurring (id),
  constraint compensation_adjustment_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint compensation_adjustment_exponent_check check (currency_exponent between 0 and 4),
  constraint compensation_adjustment_approval_check
    check (approval_state in ('not_required', 'pending', 'approved', 'rejected'))
);

create index compensation_adjustment_employment_idx
  on compensation_adjustment (tenant_id, employment_id, effective_from desc);
create index compensation_adjustment_register_idx
  on compensation_adjustment (tenant_id, recorded_at desc, id)
  where deleted_at is null;

-- Inserted and read. A wrong decision is corrected by a **reversal** — a new row naming the one it
-- reverses — never by an edit. `requested_by` is copied from the subject so the self-approval check
-- below is enforceable: a check constraint cannot reach another table.
create table compensation_approval_decision (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  subject_kind         varchar(24) not null,
  subject_id           uuid not null,
  sequence             smallint not null,
  decision             varchar(16) not null,
  decided_by           varchar(255) not null,
  decided_at           timestamptz(6) not null,
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
  constraint compensation_approval_decision_reverses_fk
    foreign key (reverses_decision_id) references compensation_approval_decision (id),
  constraint compensation_approval_decision_subject_check
    check (subject_kind in ('recurring', 'one_time', 'adjustment')),
  constraint compensation_approval_decision_kind_check check (decision in ('approved', 'rejected')),
  constraint compensation_approval_decision_self_approval_check check (decided_by <> requested_by),
  constraint compensation_approval_decision_self_reverse_check
    check (reverses_decision_id is null or reverses_decision_id <> id)
);

create unique index compensation_approval_decision_key
  on compensation_approval_decision (tenant_id, subject_kind, subject_id, sequence)
  where deleted_at is null;
create index compensation_approval_decision_chain_idx
  on compensation_approval_decision (tenant_id, subject_kind, subject_id, sequence);

-- Append-only history: what changed, from what, to what, when it took effect, when it was recorded,
-- who did it and why. The periods answer "what was the salary"; this answers "what happened" —
-- including the events that changed no value, such as an approval or a reversal.
--
-- Full jsonb snapshots rather than column deltas, because a delta needs the schema it was written
-- against to stay interpretable years later.
create table compensation_change (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  employment_id  uuid not null,
  component_id   uuid,
  subject_kind   varchar(24) not null,
  subject_id     uuid not null,
  change_kind    varchar(32) not null,
  previous_state jsonb,
  new_state      jsonb,
  effective_from date,
  recorded_at    timestamptz(6) not null,
  actor          varchar(255) not null,
  reason_code    varchar(64),
  source         varchar(24) not null,
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint compensation_change_employment_fk
    foreign key (employment_id) references employment (id),
  constraint compensation_change_subject_check
    check (subject_kind in ('recurring', 'one_time', 'adjustment')),
  constraint compensation_change_kind_check
    check (
      change_kind in (
        'assigned', 'amended', 'superseded', 'ended', 'adjusted',
        'imported', 'approved', 'approval_reversed', 'rejected'
      )
    ),
  constraint compensation_change_source_check
    check (source in ('manual', 'import', 'adjustment', 'plan_assignment', 'offer'))
);

create index compensation_change_employment_idx
  on compensation_change (tenant_id, employment_id, recorded_at desc);
create index compensation_change_subject_idx
  on compensation_change (tenant_id, subject_kind, subject_id);

-- What a bulk load covered, wrote, skipped and failed. `rows_skipped` is the count that
-- demonstrates idempotency rather than merely claiming it.
create table compensation_import_batch (
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
  constraint compensation_import_batch_source_check
    check (source in ('legacy', 'csv', 'api', 'bulk_adjustment', 'offer')),
  constraint compensation_import_batch_counts_check
    check (
      rows_submitted >= 0 and rows_created >= 0 and rows_skipped >= 0 and rows_failed >= 0
        and rows_created + rows_skipped + rows_failed <= rows_submitted
    )
);

create index compensation_import_batch_idx
  on compensation_import_batch (tenant_id, submitted_at desc);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in this module — and compensation is the most sensitive
-- data this product holds, so a table missed here would be the worst disclosure it can make.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('compensation_plan');
call app_protect_table('compensation_plan_assignment');
call app_protect_table('compensation_salary_structure');
call app_protect_table('compensation_pay_grade');
call app_protect_table('compensation_pay_scale');
call app_protect_table('compensation_salary_step');
call app_protect_table('compensation_component');
call app_protect_table('compensation_plan_component');
call app_protect_table('compensation_recurring');
call app_protect_table('compensation_one_time');
call app_protect_table('compensation_adjustment');
call app_protect_table('compensation_approval_decision');
call app_protect_table('compensation_change');
call app_protect_table('compensation_import_batch');

comment on table compensation_recurring is
  'The authoritative record of recurring entitlement. Value columns are never rewritten: a change closes the previous period and inserts a new one, so a payroll re-run for a past period still produces that period''s figure.';
comment on table compensation_change is
  'Append-only compensation history. Inserted and read; no update, no delete. It answers what happened, who did it and why — including the events that changed no value.';
comment on constraint compensation_recurring_overlap on compensation_recurring is
  'The overlap invariant, enforced by the database because two administrators assigning the same component concurrently would both pass an application check.';
comment on constraint compensation_approval_decision_self_approval_check on compensation_approval_decision is
  'Separation of duties, in the database. requested_by is copied onto the decision because a check constraint cannot reach another table.';
