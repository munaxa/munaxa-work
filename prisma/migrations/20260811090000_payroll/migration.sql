-- Payroll — what is actually paid for a period (Phase 11).
--
-- Fourteen tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step. This module holds net pay, so a table missed here would be the worst
-- disclosure this product can make.
--
-- Seven decisions in this file are the ones a reviewer should challenge.
--
--   * **The input snapshot is the centre of the design.** `payroll_input_snapshot` holds, per run
--     and employment, the four published contract views Payroll actually consumed — verbatim, as
--     `jsonb` — with each source's version and digest beside them. A finalized payroll is
--     calculated, explained and re-derived from these rows and never from a live source, so an
--     edit to a compensation record next year cannot change what was paid last year (ADR-0064).
--
--   * **`jsonb` rather than normalized snapshot columns**, deliberately. The snapshot's job is to
--     preserve *what a contract said*; a contract that gains a field later must not make an old
--     snapshot unreadable or force a migration of historical payroll. The *interpretation* is
--     normalized — it lives in the earning and deduction lines, where it is queried.
--
--   * **Overlapping periods for one payroll group are refused by the database.**
--     `payroll_period_overlap` is a GiST exclusion over `daterange(period_start, period_end, '[]')`,
--     so two administrators creating June concurrently race here rather than both committing.
--     Application validation alone loses that race, because both read before either wrote.
--
--   * **A finalized payroll cannot be mutated by any path**, and this is enforced twice: every
--     application update carries `where finalized_at is null`, and the trigger below refuses an
--     update or delete of a finalized row at the table. This is the first business trigger in this
--     repository and it was not introduced quietly — see ADR-0066 for the comparison of the three
--     enforcement mechanisms and the measured cost.
--
--   * **Money is `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint`**,
--     on every monetary row — the convention Compensation set in ADR-0061. Not `numeric`, not
--     `double precision`, never a JavaScript `number`. Two decimal places is a habit rather than a
--     rule: JOD, KWD, BHD and OMR all have three.
--
--   * **Self-approval is refused by a check constraint**, not only by the domain.
--     `payroll_approval_decision` carries a copy of `requested_by` for exactly that purpose: a
--     check constraint cannot reach another table.
--
--   * **No statutory content, no posting and no payment.** There is no tax column, no
--     social-security column, no exchange rate, no bank account, no ledger and no `posted` or
--     `executed` state. Payroll prepares an accounting output and a payment instruction and stops
--     there, because nothing in this repository posts a journal or moves money (ADR-0067).
--
-- `btree_gist` is already installed by the Leave migration, so the exclusion constraint below
-- needs no new extension.

-- ---------------------------------------------------------------------------------------------
-- Configuration: who is paid together, and what is deducted.
-- ---------------------------------------------------------------------------------------------

-- A payroll group: the population a run covers and the policy it is calculated under.
--
-- `legal_entity_id` is mandatory and is the anchor for everything jurisdictional — ADR-0035 puts
-- the country and the currency on the legal entity rather than on the tenant, so a group spanning
-- two entities would span two countries and have no single statutory answer.
--
-- `legal_entity_id` carries **no foreign key**, which is the convention Compensation set for
-- Organization references (ADR-0042, ADR-0051, and Phase 10's D-8): another module's row is
-- referenced by identifier and read through its published query, never joined. A foreign key would
-- also not enforce what a reader assumes it does — referential checks run as the table owner with
-- RLS suspended, so it constrains the row's existence and not its tenant. Employment references do
-- carry one, following Compensation, because the workforce chain is the one place this product
-- already accepts that coupling.
--
-- Membership is `eligibility_rule`, evaluated against facts Employment publishes, rather than a
-- stored list: a list is a fourth copy of the workforce that goes stale the moment somebody
-- transfers. `eligibility_rule_version` is written into every snapshot, so re-running a closed
-- period selects the people the rule selected *then* (D-18).
create table payroll_group (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  legal_entity_id           uuid not null,
  code                      varchar(64) not null,
  name                      jsonb not null,
  pay_frequency             varchar(24) not null,
  -- The currencies this group pays in, each with its exponent. A group permitting exactly one is
  -- the ordinary case. Nothing here converts between them.
  permitted_currencies      jsonb not null,
  proration_basis           varchar(24) not null,
  rounding_mode             varchar(16) not null,
  -- No default. Whether a suspended employment is paid is a contract question, not a product one.
  pays_suspended            boolean not null,
  eligibility_rule          jsonb,
  eligibility_rule_version  integer not null,
  -- Which country pack would supply statutory rules. Nothing implements one (ADR-0067).
  country_pack_id           varchar(64),
  country_pack_version      integer,
  -- Opaque tenant-configured account codes. Payroll owns no chart of accounts.
  expense_account           varchar(64) not null,
  deduction_account         varchar(64) not null,
  payable_account           varchar(64) not null,
  payment_method_code       varchar(64) not null,
  active                    boolean not null,
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint payroll_group_frequency_check
    check (pay_frequency in ('monthly', 'semi_monthly', 'biweekly', 'weekly', 'custom')),
  constraint payroll_group_proration_check
    check (proration_basis in ('calendar_days', 'working_days', 'scheduled_minutes')),
  constraint payroll_group_rounding_check
    check (rounding_mode in ('half-up', 'half-even', 'down', 'up')),
  constraint payroll_group_name_check check (name ? 'en' and name ? 'ar'),
  constraint payroll_group_currencies_check
    check (jsonb_typeof(permitted_currencies) = 'array' and jsonb_array_length(permitted_currencies) > 0),
  constraint payroll_group_pack_check
    check ((country_pack_id is null) = (country_pack_version is null))
);

create unique index payroll_group_code_idx
  on payroll_group (tenant_id, code)
  where deleted_at is null;

-- A tenant's configured deduction. Generic: a fixed amount or a share of gross, and a priority.
--
-- `deduction_source` reserves three classifications with **no producer in this phase** —
-- `statutory` (a country pack's), `benefit` (Phase 12's) and `loan_advance` (a future domain's).
-- Reserving a classification is not implementing a domain: there is no loan schedule here, no
-- outstanding balance and no benefit enrolment, because creating one would make Payroll the owner
-- of a domain it must not own (ADR-0067).
create table payroll_deduction_definition (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  payroll_group_id        uuid not null,
  code                    varchar(64) not null,
  name                    jsonb not null,
  deduction_source        varchar(24) not null,
  payroll_treatment_code  varchar(64) not null,
  basis                   varchar(24) not null,
  amount_minor            bigint,
  currency_code           char(3),
  currency_exponent       smallint,
  basis_points            integer,
  rounding_mode           varchar(16) not null,
  priority                smallint not null,
  active                  boolean not null,
  metadata                jsonb not null default '{}',
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint payroll_deduction_definition_group_fk
    foreign key (payroll_group_id) references payroll_group (id),
  constraint payroll_deduction_definition_source_check
    check (
      deduction_source in
        ('unpaid_leave', 'voluntary', 'payroll_adjustment', 'statutory', 'benefit', 'loan_advance')
    ),
  constraint payroll_deduction_definition_basis_check
    check (basis in ('fixed_amount', 'basis_points_of_gross')),
  constraint payroll_deduction_definition_rounding_check
    check (rounding_mode in ('half-up', 'half-even', 'down', 'up')),
  constraint payroll_deduction_definition_name_check check (name ? 'en' and name ? 'ar'),
  -- A fixed amount needs its currency; a share needs its basis points. Neither is optional for
  -- the basis that uses it, and a definition that supplies neither cannot produce a figure.
  constraint payroll_deduction_definition_amount_check
    check (
      (basis = 'fixed_amount' and amount_minor is not null and currency_code is not null
        and currency_exponent is not null and basis_points is null)
      or
      (basis = 'basis_points_of_gross' and basis_points is not null and amount_minor is null)
    ),
  constraint payroll_deduction_definition_currency_shape_check
    check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_deduction_definition_exponent_check
    check (currency_exponent is null or currency_exponent between 0 and 4),
  constraint payroll_deduction_definition_basis_points_check
    check (basis_points is null or basis_points between 0 and 1000000),
  constraint payroll_deduction_definition_priority_check check (priority between 0 and 999)
);

create unique index payroll_deduction_definition_code_idx
  on payroll_deduction_definition (tenant_id, payroll_group_id, code)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Period and run: when payroll happened, and each execution of it.
-- ---------------------------------------------------------------------------------------------

-- One interval, for one payroll group, with one payment date.
--
-- Both endpoints are **inclusive civil dates** — June ends on the thirtieth, not at midnight on
-- the first. `payment_date` may fall outside the period, and usually does: work in June is paid
-- in July. Nothing requires it to be inside, because a rule that did would be a convention.
--
-- There is no `paid` status. Nothing in this repository pays.
create table payroll_period (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  payroll_group_id  uuid not null,
  code              varchar(64) not null,
  period_start      date not null,
  period_end        date not null,
  payment_date      date not null,
  status            varchar(24) not null,
  opened_at         timestamptz(6),
  opened_by         varchar(255),
  closed_at         timestamptz(6),
  closed_by         varchar(255),
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint payroll_period_group_fk
    foreign key (payroll_group_id) references payroll_group (id),
  constraint payroll_period_status_check
    check (
      status in ('draft', 'open', 'calculating', 'calculated', 'approved', 'finalized', 'reversed')
    ),
  constraint payroll_period_order_check check (period_end >= period_start),
  constraint payroll_period_opening_check check ((opened_at is null) = (opened_by is null)),
  constraint payroll_period_closing_check check ((closed_at is null) = (closed_by is null)),
  -- Two administrators creating June at the same moment both read before either wrote, so only
  -- the database can settle it. `23P01` is translated into a named refusal at the edge.
  constraint payroll_period_overlap
    exclude using gist (
      tenant_id with =,
      payroll_group_id with =,
      daterange(period_start, period_end, '[]') with &&
    ) where (deleted_at is null)
);

create unique index payroll_period_code_idx
  on payroll_period (tenant_id, payroll_group_id, code)
  where deleted_at is null;
create index payroll_period_register_idx
  on payroll_period (tenant_id, period_start desc, id desc)
  where deleted_at is null;

-- One auditable execution, not a batch identifier.
--
-- `cursor_employment_id` is what makes a hundred-thousand-employee run survivable: the run is
-- processed in bounded batches, each in its own transaction, and the cursor is where the next
-- batch resumes. A run whose cursor has not reached the end is not `calculated` and therefore
-- cannot be approved — a partial payroll must never look like a complete one (D-14).
--
-- `accounting_prepared_at` and `payment_prepared_at` are the only progress this system can
-- honestly claim. There is no `posted` and no `executed`.
create table payroll_run (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  payroll_period_id         uuid not null,
  payroll_group_id          uuid not null,
  run_sequence              integer not null,
  run_kind                  varchar(16) not null,
  status                    varchar(24) not null,
  calculation_version       integer not null,
  -- Over the active deduction definitions and group configuration. Catches the case a version
  -- number misses entirely: the code did not change, but a tenant edited a definition (D-10).
  rule_set_digest           varchar(16) not null,
  population_digest         varchar(16),
  snapshot_digest           varchar(16),
  eligibility_rule_version  integer not null,
  country_pack_id           varchar(64),
  country_pack_version      integer,
  cursor_employment_id      uuid,
  population_size           integer not null,
  result_count              integer not null,
  exception_count           integer not null,
  stale_count               integer not null,
  calculated_at             timestamptz(6),
  calculated_by             varchar(255),
  approved_at               timestamptz(6),
  approved_by               varchar(255),
  finalized_at              timestamptz(6),
  finalized_by              varchar(255),
  reversal_of_run_id        uuid,
  reversed_at               timestamptz(6),
  reversed_by               varchar(255),
  stale_detected_at         timestamptz(6),
  accounting_prepared_at    timestamptz(6),
  payment_prepared_at       timestamptz(6),
  failure_reason            varchar(128),
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint payroll_run_period_fk foreign key (payroll_period_id) references payroll_period (id),
  constraint payroll_run_group_fk foreign key (payroll_group_id) references payroll_group (id),
  constraint payroll_run_reversal_fk foreign key (reversal_of_run_id) references payroll_run (id),
  constraint payroll_run_kind_check check (run_kind in ('regular', 'correction', 'reversal')),
  constraint payroll_run_status_check
    check (
      status in
        ('draft', 'calculating', 'calculated', 'stale', 'approved', 'finalized', 'reversed', 'failed')
    ),
  constraint payroll_run_counts_check
    check (
      population_size >= 0 and result_count >= 0 and exception_count >= 0 and stale_count >= 0
    ),
  constraint payroll_run_calculation_check check ((calculated_at is null) = (calculated_by is null)),
  constraint payroll_run_approval_check check ((approved_at is null) = (approved_by is null)),
  constraint payroll_run_finalization_check check ((finalized_at is null) = (finalized_by is null)),
  constraint payroll_run_reversal_actor_check check ((reversed_at is null) = (reversed_by is null)),
  -- A reversal names what it reverses; nothing else may.
  constraint payroll_run_reversal_kind_check
    check ((run_kind = 'reversal') = (reversal_of_run_id is not null))
);

create unique index payroll_run_sequence_idx
  on payroll_run (tenant_id, payroll_period_id, run_sequence)
  where deleted_at is null;

-- **One non-terminal run per period.** Two concurrent calculation commands cannot both proceed;
-- the loser is refused rather than silently forking the period into two payrolls.
create unique index payroll_run_active_idx
  on payroll_run (tenant_id, payroll_period_id)
  where deleted_at is null and status in ('draft', 'calculating', 'calculated', 'stale', 'approved');

-- One reversal per original run, so a double-reversal race cannot produce two contra sets.
create unique index payroll_run_reversal_idx
  on payroll_run (tenant_id, reversal_of_run_id)
  where deleted_at is null and reversal_of_run_id is not null;

create index payroll_run_register_idx
  on payroll_run (tenant_id, created_at desc, id desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- The snapshot: what Payroll consumed, frozen (ADR-0064).
-- ---------------------------------------------------------------------------------------------

-- One row per run and employment, holding the four published views verbatim.
--
-- This is **not** a copy of another module's tables. It is Payroll's record of what it was told,
-- which is a fact only Payroll can hold: deleting a compensation row does not make this row wrong,
-- it makes this row the only remaining explanation of a payslip.
--
-- Each source contributes both a version and a digest, because they answer different questions —
-- a version says which record, a digest says which content. Reconciliation compares these against
-- freshly-read sources, which is how a change nobody was told about is found (D-11).
create table payroll_input_snapshot (
  id                            uuid primary key default app_uuid_v7(),
  tenant_id                     uuid not null,
  payroll_run_id                uuid not null,
  employment_id                 uuid not null,
  -- The four contract payloads, exactly as they arrived.
  employment_facts              jsonb,
  compensation_facts            jsonb,
  attendance_facts              jsonb,
  leave_facts                   jsonb,
  employment_version            integer,
  compensation_digest           varchar(16),
  compensation_version          integer,
  attendance_digest             varchar(16),
  attendance_sequence           integer,
  leave_digest                  varchar(16),
  leave_version                 integer,
  snapshot_digest               varchar(16) not null,
  eligibility_rule_version      integer not null,
  captured_at                   timestamptz(6) not null,
  -- Set when the run is finalized. The trigger below refuses any change afterwards.
  finalized_at                  timestamptz(6),
  created_at                    timestamptz(6) not null,
  created_by                    varchar(255) not null,
  updated_at                    timestamptz(6) not null,
  updated_by                    varchar(255) not null,
  deleted_at                    timestamptz(6),
  deleted_by                    varchar(255),
  version                       integer not null,
  constraint payroll_input_snapshot_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_input_snapshot_employment_fk
    foreign key (employment_id) references employment (id)
);

create unique index payroll_input_snapshot_unique_idx
  on payroll_input_snapshot (tenant_id, payroll_run_id, employment_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Results and lines: the figures, and the explanation of each one.
-- ---------------------------------------------------------------------------------------------

-- One row per run, employment and **currency**.
--
-- An employment paid a local salary and a foreign-currency allowance has two gross figures and two
-- nets and no total: combining them needs a conversion nothing in this repository owns (ADR-0067).
--
-- `gross`, `total_deductions` and `net` are persisted rather than recomputed on read, and an
-- invariant test asserts each equals the sum of its lines over the persisted rows. A stored total
-- that can drift from its lines is a reconciliation bug waiting to be found by an employee.
create table payroll_result (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  payroll_run_id            uuid not null,
  employment_id             uuid not null,
  currency_code             char(3) not null,
  currency_exponent         smallint not null,
  gross_amount_minor        bigint not null,
  deductions_amount_minor   bigint not null,
  net_amount_minor          bigint not null,
  snapshot_digest           varchar(16) not null,
  calculation_version       integer not null,
  finalized_at              timestamptz(6),
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint payroll_result_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_result_employment_fk foreign key (employment_id) references employment (id),
  constraint payroll_result_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_result_exponent_check check (currency_exponent between 0 and 4),
  -- Net is gross less deductions, in the database as well as in the domain. A row that violates
  -- this cannot be written even by a repository that forgot to compute it.
  constraint payroll_result_net_check
    check (net_amount_minor = gross_amount_minor - deductions_amount_minor),
  -- **A negative payslip is almost always a data error**, and paying it silently is worse than
  -- refusing. The domain records an exception instead; this is the second line of defence.
  constraint payroll_result_non_negative_check
    check (gross_amount_minor >= 0 and deductions_amount_minor >= 0 and net_amount_minor >= 0)
);

-- The idempotency key. A retried calculation finds the existing result or loses the race; it
-- never inserts a second one (§28).
create unique index payroll_result_unique_idx
  on payroll_result (tenant_id, payroll_run_id, employment_id, currency_code)
  where deleted_at is null;
create index payroll_result_employment_idx
  on payroll_result (tenant_id, employment_id, created_at desc)
  where deleted_at is null;

-- An earning, and the arithmetic that produced it.
--
-- `detail` carries the basis, the numerator, the denominator, the rounding mode and — where a
-- country pack produced the line — its own statutory source code. A line that says "127.500 JOD"
-- explains nothing; one that says "1500.000 x 17 / 30 calendar days, half-up" explains itself.
--
-- `earning_source` includes `attendance_overtime`, which **no code path produces**. Attendance
-- publishes candidate minutes by design and no approved overtime result exists; the value reserves
-- the classification so the eventual contract needs no migration of historical lines, and a test
-- asserts it stays unreachable (ADR-0065).
create table payroll_earning_line (
  id                      uuid primary key default app_uuid_v7(),
  tenant_id               uuid not null,
  payroll_result_id       uuid not null,
  payroll_run_id          uuid not null,
  employment_id           uuid not null,
  sequence                smallint not null,
  earning_source          varchar(32) not null,
  component_id            uuid,
  component_code          varchar(64) not null,
  payroll_treatment_code  varchar(64) not null,
  amount_minor            bigint not null,
  currency_code           char(3) not null,
  currency_exponent       smallint not null,
  calculation_reason      varchar(64) not null,
  detail                  jsonb not null default '{}',
  source_reference        varchar(64),
  effective_from          date,
  effective_to            date,
  finalized_at            timestamptz(6),
  created_at              timestamptz(6) not null,
  created_by              varchar(255) not null,
  updated_at              timestamptz(6) not null,
  updated_by              varchar(255) not null,
  deleted_at              timestamptz(6),
  deleted_by              varchar(255),
  version                 integer not null,
  constraint payroll_earning_line_result_fk
    foreign key (payroll_result_id) references payroll_result (id),
  constraint payroll_earning_line_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_earning_line_source_check
    check (
      earning_source in
        ('compensation_recurring', 'compensation_one_time', 'attendance_overtime', 'leave_paid',
         'payroll_adjustment', 'country_rule')
    ),
  constraint payroll_earning_line_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_earning_line_exponent_check check (currency_exponent between 0 and 4),
  constraint payroll_earning_line_amount_check check (amount_minor >= 0)
);

create index payroll_earning_line_result_idx
  on payroll_earning_line (tenant_id, payroll_result_id, sequence)
  where deleted_at is null;
create index payroll_earning_line_run_idx
  on payroll_earning_line (tenant_id, payroll_run_id)
  where deleted_at is null;

-- A deduction, and the arithmetic that produced it. `priority` runs lowest first, and is what a
-- statutory net floor reduces in reverse.
create table payroll_deduction_line (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  payroll_result_id         uuid not null,
  payroll_run_id            uuid not null,
  employment_id             uuid not null,
  sequence                  smallint not null,
  deduction_source          varchar(24) not null,
  deduction_definition_id   uuid,
  deduction_code            varchar(64) not null,
  payroll_treatment_code    varchar(64) not null,
  amount_minor              bigint not null,
  currency_code             char(3) not null,
  currency_exponent         smallint not null,
  calculation_reason        varchar(64) not null,
  detail                    jsonb not null default '{}',
  source_reference          varchar(64),
  priority                  smallint not null,
  finalized_at              timestamptz(6),
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint payroll_deduction_line_result_fk
    foreign key (payroll_result_id) references payroll_result (id),
  constraint payroll_deduction_line_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_deduction_line_definition_fk
    foreign key (deduction_definition_id) references payroll_deduction_definition (id),
  constraint payroll_deduction_line_source_check
    check (
      deduction_source in
        ('unpaid_leave', 'voluntary', 'payroll_adjustment', 'statutory', 'benefit', 'loan_advance')
    ),
  constraint payroll_deduction_line_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_deduction_line_exponent_check check (currency_exponent between 0 and 4),
  constraint payroll_deduction_line_amount_check check (amount_minor >= 0)
);

create index payroll_deduction_line_result_idx
  on payroll_deduction_line (tenant_id, payroll_result_id, sequence)
  where deleted_at is null;
create index payroll_deduction_line_run_idx
  on payroll_deduction_line (tenant_id, payroll_run_id)
  where deleted_at is null;

-- Why an employment was not calculated, or was calculated with a doubt recorded.
--
-- Every one of these is a **real answer reported**, never a silent skip and never a result of
-- zero. A payroll that quietly pays nothing to somebody whose compensation is missing looks
-- exactly like a correct payroll of zero, which is the worst failure this module has.
create table payroll_exception (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  payroll_run_id    uuid not null,
  employment_id     uuid not null,
  exception_code    varchar(48) not null,
  detail            jsonb not null default '{}',
  resolved_at       timestamptz(6),
  resolved_by       varchar(255),
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint payroll_exception_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_exception_employment_fk
    foreign key (employment_id) references employment (id),
  constraint payroll_exception_resolution_check
    check ((resolved_at is null) = (resolved_by is null))
);

create index payroll_exception_run_idx
  on payroll_exception (tenant_id, payroll_run_id, exception_code)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Intervention: adjustments, approval, and what reconciliation found.
-- ---------------------------------------------------------------------------------------------

-- A line somebody added deliberately, with a sentence explaining why.
--
-- **Both `reason_code` and `note` are required.** A figure changed on somebody's pay without a
-- sentence explaining why is an audit finding waiting to happen. The note sits behind
-- `payroll.adjust` rather than `payroll.read`: reading a figure is not reading the reason.
--
-- A retroactive adjustment names the prior period and run and is paid in the **current** period.
-- The closed period's figures never move.
create table payroll_adjustment (
  id                          uuid primary key default app_uuid_v7(),
  tenant_id                   uuid not null,
  payroll_run_id              uuid not null,
  employment_id               uuid not null,
  kind                        varchar(16) not null,
  code                        varchar(64) not null,
  payroll_treatment_code      varchar(64) not null,
  amount_minor                bigint not null,
  currency_code               char(3) not null,
  currency_exponent           smallint not null,
  reason_code                 varchar(64) not null,
  note                        text not null,
  retroactive_of_period_id    uuid,
  retroactive_of_run_id       uuid,
  requested_by                varchar(255) not null,
  recorded_at                 timestamptz(6) not null,
  created_at                  timestamptz(6) not null,
  created_by                  varchar(255) not null,
  updated_at                  timestamptz(6) not null,
  updated_by                  varchar(255) not null,
  deleted_at                  timestamptz(6),
  deleted_by                  varchar(255),
  version                     integer not null,
  constraint payroll_adjustment_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_adjustment_employment_fk
    foreign key (employment_id) references employment (id),
  constraint payroll_adjustment_period_fk
    foreign key (retroactive_of_period_id) references payroll_period (id),
  constraint payroll_adjustment_kind_check check (kind in ('earning', 'deduction')),
  constraint payroll_adjustment_amount_check check (amount_minor > 0),
  constraint payroll_adjustment_note_check check (length(btrim(note)) > 0),
  constraint payroll_adjustment_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_adjustment_exponent_check check (currency_exponent between 0 and 4)
);

create index payroll_adjustment_run_idx
  on payroll_adjustment (tenant_id, payroll_run_id, employment_id)
  where deleted_at is null;

-- An approval decision, made by a named human (ADR-0045, ADR-0060, and Compensation's).
--
-- `requested_by` is copied onto the row for one reason: **a check constraint cannot reach another
-- table**, and without the copy the self-approval rule would live only in the domain. Payroll is
-- the module where that would be worst — an approval is the moment somebody accepts responsibility
-- for what a workforce is about to be paid.
--
-- A wrong decision is corrected by a reversal row that names it. Both stay in the chain.
create table payroll_approval_decision (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  payroll_run_id        uuid not null,
  sequence              smallint not null,
  decision              varchar(16) not null,
  decided_by            varchar(255) not null,
  decided_at            timestamptz(6) not null,
  requested_by          varchar(255) not null,
  comment               text,
  reverses_decision_id  uuid,
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint payroll_approval_decision_run_fk
    foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_approval_decision_reversal_fk
    foreign key (reverses_decision_id) references payroll_approval_decision (id),
  constraint payroll_approval_decision_check
    check (decision in ('approved', 'rejected', 'reversed')),
  -- The rule the domain also enforces, enforceable here because `requested_by` is on the row.
  constraint payroll_approval_decision_self_approval_check check (decided_by <> requested_by),
  constraint payroll_approval_decision_reversal_kind_check
    check ((decision = 'reversed') = (reverses_decision_id is not null))
);

create unique index payroll_approval_decision_sequence_idx
  on payroll_approval_decision (tenant_id, payroll_run_id, sequence)
  where deleted_at is null;

-- What reconciliation found: which employment's which source moved after the run was calculated.
--
-- Written by a command that records a result, not by a background job, and it never mutates a
-- result. A finalized run is never touched automatically (D-11).
create table payroll_reconciliation (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  payroll_run_id    uuid not null,
  employment_id     uuid not null,
  stale_source      varchar(16) not null,
  previous_digest   varchar(16),
  current_digest    varchar(16),
  detected_at       timestamptz(6) not null,
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint payroll_reconciliation_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_reconciliation_employment_fk
    foreign key (employment_id) references employment (id),
  constraint payroll_reconciliation_source_check
    check (stale_source in ('compensation', 'attendance', 'leave', 'employment'))
);

create index payroll_reconciliation_run_idx
  on payroll_reconciliation (tenant_id, payroll_run_id, detected_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Outputs: prepared, and acted on by nothing (ADR-0067).
-- ---------------------------------------------------------------------------------------------

-- A balanced journal, in Payroll's own table.
--
-- **There is no Finance module, no ledger and no chart of accounts in this repository**, so
-- `account_reference` is an opaque tenant-configured code and nothing is posted anywhere. Debits
-- equal credits per run and currency, asserted by test over these rows: an unbalanced accounting
-- export is worse than none, because it is discovered by an accountant months later.
create table payroll_accounting_line (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  payroll_run_id        uuid not null,
  payroll_result_id     uuid not null,
  employment_id         uuid not null,
  direction             varchar(8) not null,
  account_reference     varchar(64) not null,
  cost_center_id        uuid,
  unit_id               uuid,
  amount_minor          bigint not null,
  currency_code         char(3) not null,
  currency_exponent     smallint not null,
  source_reference      varchar(64) not null,
  journal_reference     varchar(64) not null,
  finalized_at          timestamptz(6),
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint payroll_accounting_line_run_fk foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_accounting_line_result_fk
    foreign key (payroll_result_id) references payroll_result (id),
  constraint payroll_accounting_line_direction_check check (direction in ('debit', 'credit')),
  constraint payroll_accounting_line_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_accounting_line_exponent_check check (currency_exponent between 0 and 4),
  constraint payroll_accounting_line_amount_check check (amount_minor >= 0)
);

create index payroll_accounting_line_run_idx
  on payroll_accounting_line (tenant_id, payroll_run_id, id)
  where deleted_at is null;

-- A payment instruction that nothing executes.
--
-- **No account number, no IBAN, no sort code, no card token, no credential of any kind.** There is
-- no bank-account domain to reference; `payee_account_ref` is reserved and is null in this phase,
-- for a future payment domain to populate with its own identifier. There is no `sent`, no
-- `executed` and no `settled` status, because nothing here transmits a payment.
create table payroll_payment_instruction (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  payroll_run_id        uuid not null,
  payroll_result_id     uuid not null,
  employment_id         uuid not null,
  amount_minor          bigint not null,
  currency_code         char(3) not null,
  currency_exponent     smallint not null,
  payment_date          date not null,
  payment_method_code   varchar(64) not null,
  payment_reference     varchar(64) not null,
  payee_account_ref     varchar(128),
  status                varchar(16) not null,
  finalized_at          timestamptz(6),
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint payroll_payment_instruction_run_fk
    foreign key (payroll_run_id) references payroll_run (id),
  constraint payroll_payment_instruction_result_fk
    foreign key (payroll_result_id) references payroll_result (id),
  constraint payroll_payment_instruction_status_check check (status in ('prepared', 'reversed')),
  constraint payroll_payment_instruction_currency_shape_check
    check (currency_code ~ '^[A-Z]{3}$'),
  constraint payroll_payment_instruction_exponent_check check (currency_exponent between 0 and 4),
  constraint payroll_payment_instruction_amount_check check (amount_minor >= 0)
);

create unique index payroll_payment_instruction_unique_idx
  on payroll_payment_instruction (tenant_id, payroll_result_id)
  where deleted_at is null;
create index payroll_payment_instruction_run_idx
  on payroll_payment_instruction (tenant_id, payroll_run_id, payment_date)
  where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Finalized immutability (ADR-0066). **The first business trigger in this repository.**
-- ---------------------------------------------------------------------------------------------
--
-- The requirement: a finalized result, earning line, deduction line, payment instruction,
-- accounting line and snapshot must be impossible to mutate through any normal or accidental
-- application path.
--
-- Three mechanisms were compared before this was written, and the comparison is what justifies it.
-- A `where finalized_at is null` predicate protects the code path that remembers to write it —
-- and it ships on every application update regardless. A check constraint cannot see the previous
-- row. A rule is deprecated and interacts badly with `returning`. Revoking `update` cannot work,
-- because the application role owns these tables and must update rows that are *not* yet
-- finalized. RLS `with check` discriminates on the new row and cannot read the old one.
--
-- **Only a trigger reads the old row**, which is what "was already finalized" requires. For the
-- one dataset in this product where a silent edit is close to fraud, protecting the table rather
-- than the code path is the right trade — and the measured cost is in the Phase 11 report.
create or replace function app_payroll_refuse_finalized() returns trigger
language plpgsql as $$
begin
  if old.finalized_at is not null then
    raise exception 'payroll_finalized_immutable'
      using errcode = 'restrict_violation',
            detail = format('%s row %s was finalized at %s', tg_table_name, old.id, old.finalized_at),
            hint = 'A finalized payroll is corrected by a reversal or a correction run, never by an update.';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function app_payroll_refuse_finalized() is
  'Refuses any update or delete of a finalized payroll row. The first business trigger in this repository; see ADR-0066 for the comparison of enforcement mechanisms.';

create trigger payroll_result_immutable
  before update or delete on payroll_result
  for each row execute function app_payroll_refuse_finalized();

create trigger payroll_earning_line_immutable
  before update or delete on payroll_earning_line
  for each row execute function app_payroll_refuse_finalized();

create trigger payroll_deduction_line_immutable
  before update or delete on payroll_deduction_line
  for each row execute function app_payroll_refuse_finalized();

create trigger payroll_input_snapshot_immutable
  before update or delete on payroll_input_snapshot
  for each row execute function app_payroll_refuse_finalized();

create trigger payroll_accounting_line_immutable
  before update or delete on payroll_accounting_line
  for each row execute function app_payroll_refuse_finalized();

create trigger payroll_payment_instruction_immutable
  before update or delete on payroll_payment_instruction
  for each row execute function app_payroll_refuse_finalized();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in this module.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('payroll_group');
call app_protect_table('payroll_deduction_definition');
call app_protect_table('payroll_period');
call app_protect_table('payroll_run');
call app_protect_table('payroll_input_snapshot');
call app_protect_table('payroll_result');
call app_protect_table('payroll_earning_line');
call app_protect_table('payroll_deduction_line');
call app_protect_table('payroll_exception');
call app_protect_table('payroll_adjustment');
call app_protect_table('payroll_approval_decision');
call app_protect_table('payroll_reconciliation');
call app_protect_table('payroll_accounting_line');
call app_protect_table('payroll_payment_instruction');

comment on table payroll_input_snapshot is
  'What Payroll consumed, frozen. A finalized payroll is explained and re-derived from these rows and never from a live source, so an edit to a compensation record next year cannot change what was paid last year.';
comment on table payroll_result is
  'One result per run, employment and currency. Nothing is ever totalled across currencies: combining them needs a conversion this product does not own.';
comment on table payroll_payment_instruction is
  'A payment instruction that nothing executes. No account number, no credential, and no state beyond prepared.';
