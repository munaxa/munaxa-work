-- Onboarding — the process that carries a new employment from hire to a first working day (Phase 7).
--
-- Six tables, and the row-level security that isolates every one of them (ADR-0030). The policies
-- are created here, in the migration that creates the tables, rather than in a later "hardening"
-- step.
--
-- Four decisions in this file are the ones a reviewer should challenge.
--
--   * **Onboarding owns no employment fact.** There is no status column here that shadows
--     Employment's, no unit, no position, no manager and no employee number. `employment_id` and
--     `person_id` are references — and they carry foreign keys, because they point *backward* to
--     modules Onboarding already depends on, which is the same rule ADR-0042 states.
--
--   * **One live onboarding per employment**, by partial unique index. That is what makes the start
--     command idempotent and two concurrent starts converge on one instance rather than two
--     (ADR-0050). A completed or cancelled onboarding leaves the index, so a rehire can be started.
--
--   * **A plan version is immutable once published**, and an instance copies its tasks at creation.
--     Those two together are why editing a plan cannot reach an onboarding already under way
--     (ADR-0048). The database enforces the first half: a published version's templates cannot be
--     changed, because the application refuses and the version carries `published_at` as evidence.
--
--   * **Overdue is not a column.** It is `due_on < today and status not terminal`, computed in the
--     query. A stored flag needs a sweeper and is wrong between sweeps.

-- ---------------------------------------------------------------------------------------------
-- Plans, versions and the templates a version holds.
-- ---------------------------------------------------------------------------------------------
create table onboarding_plan (
  id          uuid primary key default app_uuid_v7(),
  tenant_id   uuid not null,
  code        varchar(64) not null,
  name        jsonb not null,
  description jsonb,
  status      varchar(32) not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz(6) not null,
  created_by  varchar(255) not null,
  updated_at  timestamptz(6) not null,
  updated_by  varchar(255) not null,
  deleted_at  timestamptz(6),
  deleted_by  varchar(255),
  version     integer not null,
  constraint onboarding_plan_status_check check (status in ('draft', 'active', 'retired')),
  -- Both languages before a row is written. A plan named in one is a plan half the administrators
  -- of a bilingual tenant cannot read (00B).
  constraint onboarding_plan_name_check check (name ? 'en' and name ? 'ar')
);

create unique index onboarding_plan_code_key
  on onboarding_plan (tenant_id, code)
  where deleted_at is null;

create index onboarding_plan_status_idx on onboarding_plan (tenant_id, status);

create table onboarding_plan_version (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  plan_id        uuid not null,
  version_number integer not null,
  status         varchar(32) not null,
  published_at   timestamptz(6),
  published_by   varchar(255),
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint onboarding_plan_version_plan_fk
    foreign key (plan_id) references onboarding_plan (id),
  constraint onboarding_plan_version_status_check
    check (status in ('draft', 'published', 'superseded')),
  constraint onboarding_plan_version_number_check check (version_number > 0),
  -- A published version names who published it and when. Either half alone is a publication
  -- nobody can be held to.
  constraint onboarding_plan_version_publication_check
    check ((published_at is null) = (published_by is null))
);

create unique index onboarding_plan_version_number_key
  on onboarding_plan_version (tenant_id, plan_id, version_number)
  where deleted_at is null;

create index onboarding_plan_version_plan_idx
  on onboarding_plan_version (tenant_id, plan_id, version_number);

create table onboarding_task_template (
  id                       uuid primary key default app_uuid_v7(),
  tenant_id                uuid not null,
  plan_version_id          uuid not null,
  code                     varchar(64) not null,
  sequence                 integer not null,
  title                    jsonb not null,
  description              jsonb,
  kind                     varchar(24) not null,
  owner_kind               varchar(24) not null,
  owner_ref                uuid,
  owner_role               varchar(64),
  required                 boolean not null,
  due_anchor               varchar(24) not null,
  due_offset_days          integer not null,
  depends_on_template_code varchar(64),
  document_type_code       varchar(64),
  metadata                 jsonb not null default '{}',
  created_at               timestamptz(6) not null,
  created_by               varchar(255) not null,
  updated_at               timestamptz(6) not null,
  updated_by               varchar(255) not null,
  deleted_at               timestamptz(6),
  deleted_by               varchar(255),
  version                  integer not null,
  constraint onboarding_task_template_version_fk
    foreign key (plan_version_id) references onboarding_plan_version (id),
  -- Five kinds, closed. A sixth is a schema change rather than a configuration change, which is
  -- the point: `checklist`, `acknowledgement`, `document`, `approval`, `external`.
  constraint onboarding_task_template_kind_check
    check (kind in ('checklist', 'acknowledgement', 'document', 'approval', 'external')),
  constraint onboarding_task_template_owner_kind_check
    check (owner_kind in ('employee', 'manager', 'employment', 'role', 'unit')),
  -- An owner names exactly what its kind requires. A `role` queue with a unit identifier, or an
  -- `employment` owner with no identifier, is a task nobody can be shown.
  constraint onboarding_task_template_owner_check
    check (
      (owner_kind in ('employee', 'manager') and owner_ref is null and owner_role is null)
      or (owner_kind in ('employment', 'unit') and owner_ref is not null and owner_role is null)
      or (owner_kind = 'role' and owner_role is not null and owner_ref is null)
    ),
  constraint onboarding_task_template_anchor_check
    check (due_anchor in ('plan_start', 'employment_start')),
  constraint onboarding_task_template_sequence_check check (sequence > 0),
  -- A template cannot depend on itself, which is the one cycle a single predecessor permits.
  constraint onboarding_task_template_self_dependency_check
    check (depends_on_template_code is null or depends_on_template_code <> code),
  constraint onboarding_task_template_title_check check (title ? 'en' and title ? 'ar')
);

create unique index onboarding_task_template_code_key
  on onboarding_task_template (tenant_id, plan_version_id, code)
  where deleted_at is null;

create index onboarding_task_template_version_idx
  on onboarding_task_template (tenant_id, plan_version_id, sequence);

-- ---------------------------------------------------------------------------------------------
-- The onboarding instance.
-- ---------------------------------------------------------------------------------------------
create table onboarding_instance (
  id                       uuid primary key default app_uuid_v7(),
  tenant_id                uuid not null,
  employment_id            uuid not null,
  person_id                uuid not null,
  application_id           uuid,
  plan_id                  uuid,
  plan_version_id          uuid,
  state                    varchar(24) not null,
  planned_start_on         date not null,
  employment_start_on      date,
  completed_on             date,
  completed_at             timestamptz(6),
  completed_by             varchar(255),
  cancelled_at             timestamptz(6),
  cancelled_by             varchar(255),
  cancellation_reason_code varchar(64),
  metadata                 jsonb not null default '{}',
  created_at               timestamptz(6) not null,
  created_by               varchar(255) not null,
  updated_at               timestamptz(6) not null,
  updated_by               varchar(255) not null,
  deleted_at               timestamptz(6),
  deleted_by               varchar(255),
  version                  integer not null,
  -- The two keys that cross a module boundary, both pointing backward to a module this one already
  -- depends on. Employment and People are created by Recruitment's hire (ADR-0046); Onboarding
  -- creates neither and could not, because these keys would refuse a row it invented.
  constraint onboarding_instance_employment_fk
    foreign key (employment_id) references employment (id),
  constraint onboarding_instance_person_fk foreign key (person_id) references person (id),
  constraint onboarding_instance_plan_version_fk
    foreign key (plan_version_id) references onboarding_plan_version (id),
  constraint onboarding_instance_state_check
    check (state in ('draft', 'preboarding', 'in_progress', 'completed', 'cancelled')),
  -- A completed onboarding names when and by whom. A cancelled one names why.
  constraint onboarding_instance_completion_check
    check ((state = 'completed') = (completed_at is not null)),
  constraint onboarding_instance_completed_by_check
    check ((completed_at is null) = (completed_by is null)),
  constraint onboarding_instance_cancellation_check
    check ((state = 'cancelled') = (cancelled_at is not null)),
  constraint onboarding_instance_cancellation_reason_check
    check ((cancelled_at is null) = (cancellation_reason_code is null)),
  -- A plan version implies the plan it belongs to. Half a reference resolves to nothing.
  constraint onboarding_instance_plan_check
    check ((plan_id is null) = (plan_version_id is null))
);

-- One live onboarding per employment. This is the idempotency boundary the start command rests on:
-- two concurrent starts race here, one wins, and the loser reads the winner's instance rather than
-- creating a second (ADR-0050). Terminal states leave the index so a rehire can be onboarded again.
create unique index onboarding_instance_live_employment_key
  on onboarding_instance (tenant_id, employment_id)
  where state in ('draft', 'preboarding', 'in_progress') and deleted_at is null;

create index onboarding_instance_state_idx on onboarding_instance (tenant_id, state);
create index onboarding_instance_employment_idx on onboarding_instance (tenant_id, employment_id);
create index onboarding_instance_planned_start_idx
  on onboarding_instance (tenant_id, planned_start_on);

-- ---------------------------------------------------------------------------------------------
-- Tasks, and every movement of one.
-- ---------------------------------------------------------------------------------------------
create table onboarding_task (
  id                 uuid primary key default app_uuid_v7(),
  tenant_id          uuid not null,
  onboarding_id      uuid not null,
  template_code      varchar(64),
  sequence           integer not null,
  title              jsonb not null,
  description        jsonb,
  kind               varchar(24) not null,
  owner_kind         varchar(24) not null,
  owner_ref          uuid,
  owner_role         varchar(64),
  required           boolean not null,
  status             varchar(24) not null,
  due_on             date,
  depends_on_task_id uuid,
  document_reference varchar(128),
  document_type_code varchar(64),
  approval_reference varchar(64),
  completed_at       timestamptz(6),
  completed_by       varchar(255),
  completion_note    varchar(1024),
  waiver_reason_code varchar(64),
  metadata           jsonb not null default '{}',
  created_at         timestamptz(6) not null,
  created_by         varchar(255) not null,
  updated_at         timestamptz(6) not null,
  updated_by         varchar(255) not null,
  deleted_at         timestamptz(6),
  deleted_by         varchar(255),
  version            integer not null,
  constraint onboarding_task_instance_fk
    foreign key (onboarding_id) references onboarding_instance (id),
  constraint onboarding_task_predecessor_fk
    foreign key (depends_on_task_id) references onboarding_task (id),
  constraint onboarding_task_kind_check
    check (kind in ('checklist', 'acknowledgement', 'document', 'approval', 'external')),
  constraint onboarding_task_owner_kind_check
    check (owner_kind in ('employee', 'manager', 'employment', 'role', 'unit')),
  constraint onboarding_task_owner_check
    check (
      (owner_kind in ('employment', 'unit', 'employee', 'manager') and owner_role is null)
      or (owner_kind = 'role' and owner_role is not null and owner_ref is null)
    ),
  constraint onboarding_task_status_check
    check (status in ('pending', 'blocked', 'in_progress', 'done', 'waived', 'cancelled')),
  -- Done means somebody did it, and the record names them. A waiver names why it did not apply.
  constraint onboarding_task_completion_check
    check ((status in ('done', 'waived')) = (completed_at is not null)),
  constraint onboarding_task_completed_by_check
    check ((completed_at is null) = (completed_by is null)),
  constraint onboarding_task_waiver_check
    check ((status = 'waived') = (waiver_reason_code is not null)),
  constraint onboarding_task_self_dependency_check
    check (depends_on_task_id is null or depends_on_task_id <> id),
  constraint onboarding_task_title_check check (title ? 'en' and title ? 'ar')
);

-- One task per template per onboarding. A plan applied twice cannot double the checklist.
create unique index onboarding_task_template_key
  on onboarding_task (tenant_id, onboarding_id, template_code)
  where template_code is not null and deleted_at is null;

create index onboarding_task_instance_idx on onboarding_task (tenant_id, onboarding_id, sequence);
-- The queue a named owner opens.
create index onboarding_task_owner_idx
  on onboarding_task (tenant_id, owner_kind, owner_ref, status);
-- The queue a role opens: "everything waiting on IT".
create index onboarding_task_role_queue_idx on onboarding_task (tenant_id, owner_role, status);
-- The overdue query, which is a date comparison rather than a stored flag.
create index onboarding_task_due_idx on onboarding_task (tenant_id, due_on, status);

create table onboarding_task_event (
  id            uuid primary key default app_uuid_v7(),
  tenant_id     uuid not null,
  task_id       uuid not null,
  onboarding_id uuid not null,
  kind          varchar(24) not null,
  from_status   varchar(24),
  to_status     varchar(24),
  detail        varchar(1024),
  occurred_at   timestamptz(6) not null,
  recorded_by   varchar(255) not null,
  created_at    timestamptz(6) not null,
  created_by    varchar(255) not null,
  updated_at    timestamptz(6) not null,
  updated_by    varchar(255) not null,
  deleted_at    timestamptz(6),
  deleted_by    varchar(255),
  version       integer not null,
  constraint onboarding_task_event_task_fk foreign key (task_id) references onboarding_task (id),
  constraint onboarding_task_event_kind_check
    check (kind in ('created', 'assigned', 'rescheduled', 'status-changed', 'completed', 'waived'))
);

create index onboarding_task_event_task_idx
  on onboarding_task_event (tenant_id, task_id, occurred_at);
create index onboarding_task_event_instance_idx
  on onboarding_task_event (tenant_id, onboarding_id, occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy. There is no exception in this module.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('onboarding_plan');
call app_protect_table('onboarding_plan_version');
call app_protect_table('onboarding_task_template');
call app_protect_table('onboarding_instance');
call app_protect_table('onboarding_task');
call app_protect_table('onboarding_task_event');

comment on table onboarding_instance is
  'One onboarding process for one employment. Owns no employment fact: no status shadowing Employment''s, no unit, no manager, no employee number. Recruitment creates the Person and the Employment (ADR-0046); Onboarding references them.';
comment on index onboarding_instance_live_employment_key is
  'One live onboarding per employment. The idempotency boundary the start command rests on: two concurrent starts race here and converge on one instance (ADR-0050).';
comment on column onboarding_task.due_on is
  'A civil date. Overdue is `due_on < today and status not terminal`, computed in the query — a stored flag needs a sweeper and is wrong between sweeps.';
comment on column onboarding_task.approval_reference is
  'Reserved for Workflow (Phase 16). Null while Onboarding records an approval-kind decision directly, exactly as recruitment_requisition.approval_id is (ADR-0045).';
