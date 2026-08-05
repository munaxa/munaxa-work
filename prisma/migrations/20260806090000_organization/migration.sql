-- Organization (Phase 3).
--
-- Eleven tables, and the row-level security that isolates every one of them (ADR-0030). The
-- policies are created here, in the migration that creates the tables, rather than in a later
-- "hardening" step: a table that exists for one deployment without its policy is a table that
-- leaked for that deployment, and applying the policy afterwards does not un-leak it.
--
-- Two decisions in this file are the ones a reviewer should challenge, and both have an ADR:
--
--   * There is no `company` table, no `branch` table and no `team` table — no table per level at
--     all. Nine tables would be nine levels, and AD-003 requires unlimited depth, so the levels
--     are rows in `organization_unit_type` and every node is an `organization_unit`. ADR-0034.
--
--   * `legal_entity.country_code` is where a country enters this product. An employment resolves
--     its country pack from its legal entity and never from the tenant (00B), which is what lets
--     one customer run a Saudi company and a Jordanian one at once. ADR-0035.

-- ---------------------------------------------------------------------------------------------
-- The levels of a tenant's hierarchy — tenant data, not ours (ADR-0034).
-- ---------------------------------------------------------------------------------------------
create table organization_unit_type (
  id                   uuid primary key default app_uuid_v7(),
  tenant_id            uuid not null,
  code                 varchar(64) not null,
  name                 jsonb not null,
  -- Display order in an administration screen. Deliberately NOT a depth: depth is a property of
  -- a placement, and a depth column here would be the fixed ladder AD-003 forbids.
  ordinal              integer not null,
  -- Which type codes may parent this one. Empty means any, which is the honest default for a
  -- tenant that has not stated a rule.
  allowed_parent_codes text[] not null default '{}',
  allowed_at_root      boolean not null default true,
  carries_legal_entity boolean not null default false,
  status               varchar(32) not null,
  created_at           timestamptz(6) not null,
  created_by           varchar(255) not null,
  updated_at           timestamptz(6) not null,
  updated_by           varchar(255) not null,
  deleted_at           timestamptz(6),
  deleted_by           varchar(255),
  version              integer not null,
  constraint organization_unit_type_status_check
    check (status in ('active', 'inactive', 'closed')),
  constraint organization_unit_type_name_bilingual_check
    check (name ? 'en' and name ? 'ar')
);

-- Case-insensitively unique, matching the repository's lookup rather than merely resembling it:
-- a tenant that could hold both `Department` and `department` would have two levels nobody can
-- tell apart in a list.
create unique index organization_unit_type_code_key
  on organization_unit_type (tenant_id, lower(code)) where deleted_at is null;
create index organization_unit_type_tenant_ordinal_idx
  on organization_unit_type (tenant_id, ordinal);

-- ---------------------------------------------------------------------------------------------
-- The nodes.
-- ---------------------------------------------------------------------------------------------
create table organization_unit (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  unit_type_id   uuid not null,
  code           varchar(64) not null,
  name           jsonb not null,
  description    jsonb,
  status         varchar(32) not null,
  -- Tenant-authored, stored and never interpreted. No rule in this module reads a metadata key;
  -- one that did would be a business rule hidden in a customer's data (AD-005).
  metadata       jsonb not null default '{}',
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint organization_unit_type_fk
    foreign key (unit_type_id) references organization_unit_type (id),
  constraint organization_unit_status_check check (status in ('active', 'inactive', 'closed')),
  -- Both first-class languages, checked by the database as well as by the aggregate. A unit
  -- missing its Arabic name renders Latin characters in the middle of an Arabic org chart,
  -- forever, because nobody was ever asked for the second name.
  constraint organization_unit_name_bilingual_check check (name ? 'en' and name ? 'ar'),
  constraint organization_unit_existence_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index organization_unit_code_key
  on organization_unit (tenant_id, lower(code)) where deleted_at is null;
create index organization_unit_tenant_type_idx on organization_unit (tenant_id, unit_type_id);
create index organization_unit_tenant_status_idx on organization_unit (tenant_id, status);
-- Search by name, in either language, without a sequential scan.
create index organization_unit_name_idx on organization_unit using gin (name);

-- ---------------------------------------------------------------------------------------------
-- Where each unit sat, and from when — the table that makes historical reorganizations
-- answerable.
--
-- Adjacency (a nullable parent) rather than a materialized path, deliberately. A path would have
-- to be rewritten for every descendant whenever a subtree moved, so one reorganization would
-- become an unbounded cascade of writes — and a path column is a depth encoding, which is
-- precisely what AD-003 says must not exist. The ancestor walk is in the application layer, over
-- these rows, because it is a rule rather than a storage concern.
-- ---------------------------------------------------------------------------------------------
create table organization_unit_placement (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  unit_id        uuid not null,
  -- Null means the unit was a root of the tenant's structure for this period. A root is a real
  -- placement, not an absent one: "this company became a root in January" and "nobody has ever
  -- said where this company sits" are different facts.
  parent_unit_id uuid,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint organization_unit_placement_unit_fk
    foreign key (unit_id) references organization_unit (id),
  constraint organization_unit_placement_parent_fk
    foreign key (parent_unit_id) references organization_unit (id),
  constraint organization_unit_placement_period_check
    check (effective_to is null or effective_to > effective_from),
  -- A unit is never its own parent. A cycle is not bad data, it is a structure walk that never
  -- terminates; the one-step case is cheap to forbid outright and the general case is refused by
  -- the ancestor check before the write.
  constraint organization_unit_placement_not_self_check check (unit_id <> parent_unit_id)
);

-- At most one *open* period per unit. The domain's `Timeline` enforces full non-overlap — which
-- a unique index cannot express without an exclusion constraint and an extension — and this
-- catches the failure that actually happens: two open periods, which is two answers to "where is
-- this unit now".
create unique index organization_unit_placement_one_open_key
  on organization_unit_placement (tenant_id, unit_id)
  where effective_to is null and deleted_at is null;
create index organization_unit_placement_unit_idx
  on organization_unit_placement (tenant_id, unit_id, effective_from);
-- The index a structure query uses: everything in force on a date.
create index organization_unit_placement_in_force_idx
  on organization_unit_placement (tenant_id, effective_from, effective_to);
create index organization_unit_placement_parent_idx
  on organization_unit_placement (tenant_id, parent_unit_id);

-- ---------------------------------------------------------------------------------------------
-- Where a country enters this product (ADR-0035, 00B).
-- ---------------------------------------------------------------------------------------------
create table legal_entity (
  id                  uuid primary key default app_uuid_v7(),
  tenant_id           uuid not null,
  unit_id             uuid not null,
  -- ISO 3166-1 alpha-2, constrained by *shape* and never against a list of countries. A list
  -- would be a schema change every time the product sells somewhere new, which 00B prohibits.
  country_code        char(2) not null,
  registered_name     jsonb not null,
  registration_number varchar(64) not null,
  tax_identifier      varchar(64),
  -- ISO 4217. On the entity rather than the tenant, for the same reason the country is.
  currency_code       char(3) not null,
  incorporated_on     date,
  status              varchar(32) not null,
  metadata            jsonb not null default '{}',
  effective_from      timestamptz(6) not null,
  effective_to        timestamptz(6),
  created_at          timestamptz(6) not null,
  created_by          varchar(255) not null,
  updated_at          timestamptz(6) not null,
  updated_by          varchar(255) not null,
  deleted_at          timestamptz(6),
  deleted_by          varchar(255),
  version             integer not null,
  constraint legal_entity_unit_fk foreign key (unit_id) references organization_unit (id),
  constraint legal_entity_status_check check (status in ('active', 'inactive', 'closed')),
  constraint legal_entity_country_shape_check check (country_code ~ '^[A-Z]{2}$'),
  constraint legal_entity_currency_shape_check check (currency_code ~ '^[A-Z]{3}$'),
  constraint legal_entity_name_bilingual_check
    check (registered_name ? 'en' and registered_name ? 'ar'),
  constraint legal_entity_existence_check
    check (effective_to is null or effective_to > effective_from)
);

-- One registration per unit. Two would mean two countries for the same node, and every statutory
-- calculation beneath it would depend on which row was read first.
create unique index legal_entity_unit_key
  on legal_entity (tenant_id, unit_id) where deleted_at is null;
create unique index legal_entity_registration_key
  on legal_entity (tenant_id, country_code, registration_number) where deleted_at is null;
create index legal_entity_tenant_country_idx on legal_entity (tenant_id, country_code);

-- ---------------------------------------------------------------------------------------------
-- Cost and profit centres — reference data finance recognizes (AD-007).
--
-- One table with a `kind`, because the two are the same shape and two near-identical tables
-- would be duplicated logic that drifts the first time one of them gains a column. The
-- *permissions* stay separate, and every lookup takes the kind so a caller holding one cannot
-- reach the other by identifier.
--
-- Deliberately no budget, no actuals and no allocation rule: financial ownership belongs to the
-- finance system this product integrates with.
-- ---------------------------------------------------------------------------------------------
create table financial_center (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  kind           varchar(16) not null,
  code           varchar(64) not null,
  name           jsonb not null,
  unit_id        uuid,
  status         varchar(32) not null,
  metadata       jsonb not null default '{}',
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint financial_center_unit_fk foreign key (unit_id) references organization_unit (id),
  constraint financial_center_kind_check check (kind in ('cost', 'profit')),
  constraint financial_center_status_check check (status in ('active', 'inactive', 'closed')),
  constraint financial_center_name_bilingual_check check (name ? 'en' and name ? 'ar'),
  constraint financial_center_existence_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index financial_center_code_key
  on financial_center (tenant_id, kind, lower(code)) where deleted_at is null;
create index financial_center_tenant_kind_status_idx
  on financial_center (tenant_id, kind, status);
create index financial_center_unit_idx on financial_center (tenant_id, unit_id);

-- ---------------------------------------------------------------------------------------------
-- The position catalogue.
--
-- Named `job_position` rather than `position`, because POSITION is a SQL function and a table of
-- that name needs quoting in every statement that touches it — which is a trap set for whoever
-- writes the next query.
--
-- No occupant column, and there never will be one: people occupy positions through Employment
-- assignments (AD-006). A position that knew who held it would be a second answer to a question
-- Employment owns.
-- ---------------------------------------------------------------------------------------------
create table job_position (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  code           varchar(64) not null,
  title          jsonb not null,
  description    jsonb,
  family         varchar(64),
  grade          varchar(64),
  criticality    varchar(16) not null,
  status         varchar(32) not null,
  metadata       jsonb not null default '{}',
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint job_position_criticality_check
    check (criticality in ('standard', 'important', 'critical')),
  constraint job_position_status_check check (status in ('active', 'inactive', 'closed')),
  constraint job_position_title_bilingual_check check (title ? 'en' and title ? 'ar'),
  constraint job_position_existence_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index job_position_code_key
  on job_position (tenant_id, lower(code)) where deleted_at is null;
create index job_position_tenant_status_idx on job_position (tenant_id, status);
create index job_position_tenant_family_idx on job_position (tenant_id, family);
create index job_position_title_idx on job_position using gin (title);

-- ---------------------------------------------------------------------------------------------
-- Manpower planning: budgeted headcount per position per unit, effective dated.
--
-- Organization owns the *budgeted* number and never the filled one. Filled is a count of
-- employment assignments, Employment owns those, and counting them here would be the duplicated
-- ownership the master instructions exist to prevent (AD-002).
-- ---------------------------------------------------------------------------------------------
create table position_establishment (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  position_id        uuid not null,
  unit_id            uuid not null,
  budgeted_headcount integer not null,
  status             varchar(32) not null,
  approved_at        timestamptz(6),
  approved_by        varchar(255),
  effective_from     timestamptz(6) not null,
  effective_to       timestamptz(6),
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint position_establishment_position_fk
    foreign key (position_id) references job_position (id),
  constraint position_establishment_unit_fk
    foreign key (unit_id) references organization_unit (id),
  constraint position_establishment_status_check
    check (status in ('draft', 'approved', 'withdrawn')),
  constraint position_establishment_headcount_check
    check (budgeted_headcount >= 0 and budgeted_headcount <= 1000000),
  constraint position_establishment_period_check
    check (effective_to is null or effective_to > effective_from),
  -- An approved line records who approved it and when, or it is not approved. A status without
  -- an approver is an approval nobody can be asked about.
  constraint position_establishment_approval_check
    check (status <> 'approved' or (approved_at is not null and approved_by is not null))
);

-- One open budget per position per unit. Two would be two answers to "how many are approved
-- here", and a requisition would be validated against whichever the planner returned first.
create unique index position_establishment_one_open_key
  on position_establishment (tenant_id, position_id, unit_id)
  where effective_to is null and deleted_at is null;
create index position_establishment_unit_idx on position_establishment (tenant_id, unit_id);
create index position_establishment_position_idx
  on position_establishment (tenant_id, position_id, effective_from);

-- ---------------------------------------------------------------------------------------------
-- Organizational calendars.
--
-- Nothing in this schema knows a single holiday, a weekend or a working week. `working_days` is
-- supplied by the tenant and the exception days are rows a tenant or a country pack writes. That
-- is 00B made structural: adding a country must never be a change to this file.
-- ---------------------------------------------------------------------------------------------
create table organization_calendar (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  code           varchar(64) not null,
  name           jsonb not null,
  unit_id        uuid,
  time_zone      varchar(64) not null,
  -- ISO-8601 weekdays: Monday is 1, Sunday is 7. ISO rather than the zero-based Sunday-first
  -- convention because the working week in this product's first markets starts on neither
  -- uniformly, and a convention that privileges one invites arithmetic that assumes the other.
  working_days   smallint[] not null,
  status         varchar(32) not null,
  effective_from timestamptz(6) not null,
  effective_to   timestamptz(6),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint organization_calendar_unit_fk foreign key (unit_id) references organization_unit (id),
  constraint organization_calendar_status_check check (status in ('active', 'inactive', 'closed')),
  constraint organization_calendar_name_bilingual_check check (name ? 'en' and name ? 'ar'),
  -- A working week with no working days is not a calendar, it is a mistake with a save button.
  constraint organization_calendar_working_week_check
    check (array_length(working_days, 1) between 1 and 7),
  constraint organization_calendar_existence_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index organization_calendar_code_key
  on organization_calendar (tenant_id, lower(code)) where deleted_at is null;
create index organization_calendar_unit_idx on organization_calendar (tenant_id, unit_id);

-- A holiday is a *day in a place*, not an instant — so `on_date` is a `date` and the calendar
-- carries the zone. Stored as a timestamp it lands on the day before or after for anybody east
-- or west of whoever entered it, which is the classic way a public holiday moves.
create table organization_calendar_day (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  calendar_id uuid not null,
  on_date     date not null,
  kind        varchar(16) not null,
  name        jsonb not null,
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint organization_calendar_day_calendar_fk
    foreign key (calendar_id) references organization_calendar (id),
  constraint organization_calendar_day_kind_check
    check (kind in ('holiday', 'working', 'non-working')),
  constraint organization_calendar_day_name_bilingual_check check (name ? 'en' and name ? 'ar')
);

-- One entry per date per calendar. Two facts about the same date is what makes a working-day
-- count ambiguous, and the upsert in the repository depends on this being the conflict target —
-- so it is a table constraint rather than a partial index, which `on conflict` cannot use.
alter table organization_calendar_day
  add constraint organization_calendar_day_date_key unique (tenant_id, calendar_id, on_date);
create index organization_calendar_day_range_idx
  on organization_calendar_day (tenant_id, calendar_id, on_date);

-- ---------------------------------------------------------------------------------------------
-- One tenant's own defaults — the table that closes the Phase 2 debt (ADR-0036).
--
-- Before this, `ConfiguredTenantSettings` resolved every tenant in a deployment to the same
-- environment variables, so a hosting arrangement with a Riyadh customer and an Amman customer
-- in it had to pick one language and one calendar for both.
-- ---------------------------------------------------------------------------------------------
create table tenant_settings (
  id                       uuid primary key default app_uuid_v7(),
  tenant_id                uuid not null,
  -- A BCP 47 tag, not one of a list this product ships: Arabic and English are first-class in
  -- the *catalogues*, and the tenant default is still a tag.
  language                 varchar(35) not null,
  calendar                 varchar(16) not null,
  time_zone                varchar(64) not null,
  numerals                 varchar(16) not null,
  invitation_validity_days integer not null,
  default_portals          text[] not null default '{}',
  created_at               timestamptz(6) not null,
  created_by               varchar(255) not null,
  updated_at               timestamptz(6) not null,
  updated_by               varchar(255) not null,
  deleted_at               timestamptz(6),
  deleted_by               varchar(255),
  version                  integer not null,
  constraint tenant_settings_calendar_check check (calendar in ('gregorian', 'hijri')),
  constraint tenant_settings_numerals_check check (numerals in ('western', 'arabic-indic')),
  constraint tenant_settings_validity_check
    check (invitation_validity_days between 1 and 365)
);

-- One row per tenant. Two would be two answers to "what language does this customer read".
create unique index tenant_settings_tenant_key
  on tenant_settings (tenant_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030).
--
-- Every table here carries `tenant_id`, so every one takes the standard policy. There is no
-- exception in this module — `workforce_user` in Phase 2 was the only tenant-less table in the
-- product and remains so.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('organization_unit_type');
call app_protect_table('organization_unit');
call app_protect_table('organization_unit_placement');
call app_protect_table('legal_entity');
call app_protect_table('financial_center');
call app_protect_table('job_position');
call app_protect_table('position_establishment');
call app_protect_table('organization_calendar');
call app_protect_table('organization_calendar_day');
call app_protect_table('tenant_settings');

comment on table organization_unit_type is
  'The levels of one tenant''s hierarchy. Tenant data, not ours — which is what makes unlimited depth true rather than claimed (ADR-0034).';
comment on table organization_unit_placement is
  'Where each unit sat, and from when. Never edited: a move closes one period and opens another, so "what did this structure look like on this date" keeps exactly one answer.';
comment on column legal_entity.country_code is
  'ISO 3166-1 alpha-2. An employment resolves its country pack from here and never from the tenant (00B, ADR-0035).';
comment on table tenant_settings is
  'One tenant''s own language, calendar, time zone, numerals and invitation validity. Closes the deployment-wide-settings debt recorded in the Phase 2 report (ADR-0036).';
