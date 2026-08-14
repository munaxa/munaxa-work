-- Enterprise Workflow & Approvals (Phase 16A).
--
-- Seven tables. Workflow records **process** — a definition a tenant configured, a version of it
-- frozen at publication, a running instance, the steps it is made of, the decisions approvers made,
-- and the history of how it got where it is. It records **no business data**, and there is no column
-- here through which it could (AD-001).
--
-- Three absences are the point of the schema, and each is a column somebody would reasonably have
-- added:
--
--   * **No `role_id`, no `group_id`, no approver directory.** `PlatformPermissionChecker` states
--     that this product will never implement a role or permission engine, and nothing in this
--     repository can answer "everybody who may approve X". An approver is a **membership** — a
--     person a tenant admitted, named individually. Groups are Phase 16B, if a directory ever can
--     exist (D-3, D-4).
--
--   * **No `sla_hours`, no `due_at`, no `escalation_level`, no `breached`.** `JobPort` has no
--     adapter anywhere in this repository, so nothing runs when nobody is asking, and a stored
--     breach flag would need something to move it overnight. SLA and escalation are Phase 16B, and
--     there is no column here for either to hide in (D-11, D-12).
--
--   * **No `pattern`, no `quorum`, no `threshold`, no `condition`.** In 16A a single approval *is* a
--     one-step sequential approval, so a pattern column would carry two values with identical
--     behaviour — schema claiming a distinction the product does not make. Majority, unanimity and
--     first-response tallies are unspecified in their denominator, their ties and their abstentions
--     (D-6), and conditional branching has no expression language (D-7). Both are 16B.
--
-- **There is no `workflow_approval_request` table.** The specification names an Approval Request
-- aggregate, and in this implementation the request *is* the instance: `ApprovalPort.request()`
-- creates one, and the `approvalId` it returns — the value the four reserved `approval_id` columns
-- across Recruitment, Leave, Onboarding and Attendance are shaped for — is the instance's own
-- identifier. A second table would be one row per instance carrying nothing the instance does not.
--
-- **There is no approval queue table either.** A queue is a *read* — the steps awaiting a decision
-- whose approver is the caller — and it is served by `workflow_step_queue_idx` rather than by a
-- projection something has to keep current.
--
-- **Delegation is Identity's and is not copied here** (AD-010). A delegated decision stores the
-- membership it acted for in `on_behalf_of_membership_id`, which is an identifier and not a
-- reference: there is no foreign key to `delegation`, and no row here restates Identity's period.
-- Whether a delegation was in force is Identity's answer, asked at the moment of the decision.
--
-- **Every instant here is a `timestamptz` and there is no `date` column at all.** A request, a
-- decision and a step becoming current are moments rather than days — "was this decided before that"
-- is a question about an instant, and Attendance settled that instants are for events. Career's
-- civil dates exist because a target date is the same day in every time zone; nothing in Workflow is.
--
-- **Every number is a bounded integer and there is no `numeric`, `real`, `double precision`,
-- `bigint` or money column.** Two numbers exist: a version number and a step ordinal. Both are
-- `integer` **rather than `smallint`**, deliberately — AD-004 forbids a hardcoded approval limit, and
-- a `smallint` ordinal would cap a process at 32,767 steps, which is a limit whether or not anybody
-- meant it as one. `integer` is the storage type's own range rather than a rule about approvals.
--
-- **Cross-module identifiers carry no foreign key.** `approver_membership_id`,
-- `requested_by_membership_id`, `decided_by_membership_id`, `on_behalf_of_membership_id` and
-- `subject_id` are stored values, following ADR-0042 and Career's treatment of the same problem: a
-- foreign key across a module boundary couples two schemas' migration order, and — more importantly
-- — **a foreign key does not provide tenant isolation**, because PostgreSQL's referential check runs
-- without the policy. Containment comes from the row-level policy plus the application confirming
-- the reference through a published contract before writing.

-- ---------------------------------------------------------------------------------------------
-- Definitions, and the versions of them
-- ---------------------------------------------------------------------------------------------

-- The reusable process. `subject_type` is the opaque string a business module supplies through
-- `ApprovalPort` — `recruitment.requisition`. Its **shape** is checked and its meaning is not: a list
-- of legal subject types would be a list of business modules, and this module is required to know
-- about none of them.
create table workflow_definition (
  id           uuid primary key default app_uuid_v7(),
  tenant_id    uuid not null,
  code         varchar(64) not null,
  name         jsonb not null,
  description  jsonb,
  subject_type varchar(128) not null,
  status       varchar(16) not null,
  retired_at   timestamptz(6),
  retired_by   varchar(255),
  metadata     jsonb not null default '{}',
  created_at   timestamptz(6) not null,
  created_by   varchar(255) not null,
  updated_at   timestamptz(6) not null,
  updated_by   varchar(255) not null,
  deleted_at   timestamptz(6),
  deleted_by   varchar(255),
  version      integer not null,
  constraint workflow_definition_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  -- Every segment takes hyphens, including the first: this module does not get to know which
  -- segment is a module name, so the rule has to be uniform. The domain's `isSubjectType` is the
  -- same rule, and the parity suite asserts that the two agree.
  constraint workflow_definition_subject_type_shape_check
    check (subject_type ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$'),
  constraint workflow_definition_status_check check (status in ('active', 'retired')),
  -- Retirement is a state *and* a record of who retired it, or it is neither.
  constraint workflow_definition_retirement_check
    check ((status = 'retired') = (retired_at is not null)),
  constraint workflow_definition_retired_by_check
    check ((retired_at is null) = (retired_by is null))
);

create unique index workflow_definition_code_idx
  on workflow_definition (tenant_id, code) where deleted_at is null;
create index workflow_definition_subject_idx
  on workflow_definition (tenant_id, subject_type, status) where deleted_at is null;

-- A version of a definition, and the row AD-003 is about.
--
-- **Immutability is enforced above rather than by a trigger**, deliberately. The domain refuses to
-- add a step to a published version and offers no `published → draft` transition, and an instance
-- **copies** its steps at creation — so nothing that could rewrite a running approval exists to be
-- blocked. A trigger here would freeze the audit columns too, and `updated_at` legitimately moves
-- when a published version is archived.
--
-- **Nothing constrains a definition to one published version.** Neither the domain nor the approved
-- plan states that rule, and a tenant may reasonably publish version three while version two is
-- still the one being chosen, until they archive it. Which published version a new instance uses is
-- the application's selection — `workflow_version_published_idx` is ordered to serve it — and
-- inventing a uniqueness rule here would be schema deciding a question nobody asked it.
create table workflow_version (
  id             uuid primary key default app_uuid_v7(),
  tenant_id      uuid not null,
  definition_id  uuid not null,
  version_number integer not null,
  status         varchar(16) not null,
  published_at   timestamptz(6),
  published_by   varchar(255),
  metadata       jsonb not null default '{}',
  created_at     timestamptz(6) not null,
  created_by     varchar(255) not null,
  updated_at     timestamptz(6) not null,
  updated_by     varchar(255) not null,
  deleted_at     timestamptz(6),
  deleted_by     varchar(255),
  version        integer not null,
  constraint workflow_version_definition_fk
    foreign key (definition_id) references workflow_definition (id),
  constraint workflow_version_number_check check (version_number >= 1),
  constraint workflow_version_status_check check (status in ('draft', 'published', 'archived')),
  -- A published version knows when it was published. An archived one may never have been published
  -- at all — the domain permits `draft → archived` — so the implication runs one way only.
  constraint workflow_version_published_check
    check (status <> 'published' or published_at is not null),
  constraint workflow_version_publication_origin_check
    check (published_at is null or status in ('published', 'archived')),
  constraint workflow_version_published_by_check
    check ((published_at is null) = (published_by is null))
);

create unique index workflow_version_number_idx
  on workflow_version (tenant_id, definition_id, version_number) where deleted_at is null;
create index workflow_version_published_idx
  on workflow_version (tenant_id, definition_id, status, version_number desc)
  where deleted_at is null;

-- One step of a version: who is asked, and where in the order.
--
-- `approver_kind` carries one legal value today. The column exists rather than being implied so that
-- adding a kind in 16B is a migration and a check-constraint change somebody reviews, rather than a
-- new meaning quietly given to an existing column — the position ADR-0049 took on onboarding task
-- kinds.
--
-- **Ordinal uniqueness is arbitrated here rather than in the domain**, because one step per ordinal
-- per version is a fact about a set of rows: two administrators can add a step at the same instant,
-- and a read-then-write check would let both through. That contiguity from one holds is checked once,
-- by the domain, at publication — a partial index cannot express "no gaps".
create table workflow_step_template (
  id                    uuid primary key default app_uuid_v7(),
  tenant_id             uuid not null,
  workflow_version_id   uuid not null,
  ordinal               integer not null,
  name                  jsonb not null,
  approver_kind         varchar(16) not null,
  approver_membership_id uuid not null,
  metadata              jsonb not null default '{}',
  created_at            timestamptz(6) not null,
  created_by            varchar(255) not null,
  updated_at            timestamptz(6) not null,
  updated_by            varchar(255) not null,
  deleted_at            timestamptz(6),
  deleted_by            varchar(255),
  version               integer not null,
  constraint workflow_step_template_version_fk
    foreign key (workflow_version_id) references workflow_version (id),
  -- Bounded below and deliberately not above (AD-004).
  constraint workflow_step_template_ordinal_check check (ordinal >= 1),
  constraint workflow_step_template_approver_kind_check check (approver_kind in ('membership'))
);

create unique index workflow_step_template_ordinal_idx
  on workflow_step_template (tenant_id, workflow_version_id, ordinal) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Running instances, and their steps
-- ---------------------------------------------------------------------------------------------

-- A running process.
--
-- `subject_id` is `varchar(64)` rather than `uuid`: it is another module's identifier, and Workflow
-- does not get to know what shape another module's identifiers take. It is the same width as the
-- four reserved `approval_id` columns this instance's own identifier will be written into, which is
-- the seam pointing the other way.
--
-- `context` is the requesting module's own facts, stored because it is the request's payload and an
-- auditor asking "what was this decided on" should find it. **Nothing in 16A reads it.**
-- `ApprovalRequest.context` is described by the port as "facts the routing rules may read", and 16A
-- has no routing rules — branching is 16B. It is documented as unread so nobody infers a rule from
-- its presence.
create table workflow_instance (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  definition_id             uuid not null,
  workflow_version_id       uuid not null,
  subject_type              varchar(128) not null,
  subject_id                varchar(64) not null,
  requested_by_membership_id uuid not null,
  status                    varchar(16) not null,
  started_at                timestamptz(6) not null,
  completed_at              timestamptz(6),
  cancelled_by              varchar(255),
  cancellation_reason       varchar(1024),
  correlation_id            uuid not null,
  context                   jsonb not null default '{}',
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint workflow_instance_definition_fk
    foreign key (definition_id) references workflow_definition (id),
  constraint workflow_instance_version_fk
    foreign key (workflow_version_id) references workflow_version (id),
  constraint workflow_instance_subject_type_shape_check
    check (subject_type ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$'),
  constraint workflow_instance_subject_id_check check (length(trim(subject_id)) > 0),
  constraint workflow_instance_status_check
    check (status in ('running', 'completed', 'rejected', 'cancelled')),
  -- Every ending records when it ended; a running instance has not ended.
  constraint workflow_instance_completion_check
    check ((status = 'running') = (completed_at is null)),
  -- Cancellation is the one ending that names a person and a reason, because it is the one an
  -- approver did not make. A rejection is explained by its decision row instead.
  constraint workflow_instance_cancellation_check
    check ((status = 'cancelled') = (cancelled_by is not null)),
  constraint workflow_instance_cancellation_reason_check
    check ((cancelled_by is null) = (cancellation_reason is null)),
  constraint workflow_instance_cancellation_reason_present_check
    check (cancellation_reason is null or length(trim(cancellation_reason)) > 0)
);

-- The specification's "Duplicate Approval Requests" validation, arbitrated where it has to be. Two
-- submissions of the same requisition at the same instant would each pass a read-then-write check
-- and produce two open approvals for one thing, which is two queues, two chains and two answers.
create unique index workflow_instance_open_subject_idx
  on workflow_instance (tenant_id, subject_type, subject_id)
  where status = 'running' and deleted_at is null;
-- The business module's own lookup: "what happened to my requisition", open or not.
create index workflow_instance_subject_idx
  on workflow_instance (tenant_id, subject_type, subject_id, status) where deleted_at is null;
create index workflow_instance_status_idx
  on workflow_instance (tenant_id, status, started_at, id) where deleted_at is null;

-- One step of a running instance, copied from a template at creation (AD-003).
--
-- No column references the template it came from. That is what makes the copy a copy: archiving the
-- version, retiring the definition or publishing a replacement cannot reach a running approval,
-- because there is no path from here back to the configuration.
create table workflow_step (
  id                     uuid primary key default app_uuid_v7(),
  tenant_id              uuid not null,
  instance_id            uuid not null,
  ordinal                integer not null,
  approver_kind          varchar(16) not null,
  approver_membership_id uuid not null,
  status                 varchar(16) not null,
  metadata               jsonb not null default '{}',
  created_at             timestamptz(6) not null,
  created_by             varchar(255) not null,
  updated_at             timestamptz(6) not null,
  updated_by             varchar(255) not null,
  deleted_at             timestamptz(6),
  deleted_by             varchar(255),
  version                integer not null,
  constraint workflow_step_instance_fk
    foreign key (instance_id) references workflow_instance (id),
  constraint workflow_step_ordinal_check check (ordinal >= 1),
  constraint workflow_step_approver_kind_check check (approver_kind in ('membership')),
  constraint workflow_step_status_check
    check (status in ('pending', 'awaiting', 'approved', 'rejected', 'skipped'))
);

create unique index workflow_step_ordinal_idx
  on workflow_step (tenant_id, instance_id, ordinal) where deleted_at is null;

-- **Exactly one step of an instance awaits a decision.** The domain states this as an invariant and
-- this is what makes it one: "sequential" becomes a property of the data rather than of whatever
-- code happens to walk it, and no defect in a later repository can produce two open queue entries
-- for one approval.
--
-- Note for the repository that will write these: a partial unique index cannot be deferred, so
-- advancing must move the decided step **out** of `awaiting` before it moves the next step **in**.
-- The reverse order momentarily holds two awaiting rows and PostgreSQL refuses it — which is the
-- index doing its job, not an obstacle to route around.
create unique index workflow_step_awaiting_idx
  on workflow_step (tenant_id, instance_id)
  where status = 'awaiting' and deleted_at is null;

-- The queue: the steps awaiting a decision, by the membership being asked. This is the screen the
-- whole phase is for, and it is a read rather than a table. Ordered by `id` so paging is
-- deterministic, and partial so it stays the size of the open work rather than of the history.
create index workflow_step_queue_idx
  on workflow_step (tenant_id, approver_membership_id, id)
  where status = 'awaiting' and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Decisions and history — the two append-only facts
-- ---------------------------------------------------------------------------------------------

-- What an approver said, written once.
--
-- **Two memberships, never one.** `decided_by_membership_id` is always the person who actually
-- decided; `on_behalf_of_membership_id` is the assigned approver whose authority they used, and it
-- is present only under delegation. Writing the delegator into the actor column and calling it their
-- approval is precisely the dishonesty this seam exists to prevent, so the two are separate columns
-- rather than one that means different things on different rows.
--
-- `created_by` is the audit actor — `user:<workforceUserId>` — and it is a different thing again
-- from either: it says which authenticated request wrote the row. `system:auto-approval` is refused
-- on it, as fourteen check constraints across Performance, Learning and Career already refuse it on
-- the act that matters (ADR-0045). The membership columns are `uuid` and cannot hold that value at
-- all, which is the stronger half of the same guarantee.
create table workflow_decision (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  instance_id               uuid not null,
  step_id                   uuid not null,
  decision                  varchar(16) not null,
  decided_by_membership_id  uuid not null,
  authority                 varchar(16) not null,
  on_behalf_of_membership_id uuid,
  decided_at                timestamptz(6) not null,
  comment                   varchar(1024),
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint workflow_decision_instance_fk
    foreign key (instance_id) references workflow_instance (id),
  constraint workflow_decision_step_fk foreign key (step_id) references workflow_step (id),
  constraint workflow_decision_kind_check check (decision in ('approved', 'rejected')),
  constraint workflow_decision_authority_check check (authority in ('assigned', 'delegated')),
  -- The domain's coherence rule, enforced where a later path around the domain cannot skip it.
  constraint workflow_decision_delegation_check
    check ((authority = 'delegated') = (on_behalf_of_membership_id is not null)),
  -- Deciding your own step needs no delegation, and recording one would put an arrangement in the
  -- audit trail that Identity never granted.
  constraint workflow_decision_self_delegation_check
    check (on_behalf_of_membership_id is null
           or on_behalf_of_membership_id <> decided_by_membership_id),
  constraint workflow_decision_human_check check (created_by <> 'system:auto-approval')
);

-- One decision per step. A step reaches a terminal state when it is decided, so a second decision is
-- already impossible through the domain — this makes it impossible through anything, including SQL
-- nobody wrote in TypeScript.
create unique index workflow_decision_step_idx
  on workflow_decision (tenant_id, step_id) where deleted_at is null;
-- "The approvals I have decided", and the chain of one instance in order.
create index workflow_decision_decider_idx
  on workflow_decision (tenant_id, decided_by_membership_id, id) where deleted_at is null;
create index workflow_decision_instance_idx
  on workflow_decision (tenant_id, instance_id, id) where deleted_at is null;

-- How an instance got where it is: Workflow's audit of **routing**, never a business fact.
--
-- "The requisition was approved" is Recruitment's sentence, in Recruitment's own decision table.
-- What belongs here is "step 2 of instance X was approved by membership Y acting for membership Z".
-- The event vocabulary is closed and contains no business word, which is how "no source-specific
-- logic inside Workflow" is enforced rather than intended.
--
-- An entry carries **no comment and no rationale**: those live on the decision, where a permission
-- decides who may read them, rather than in a timeline a queue screen renders.
create table workflow_history (
  id                        uuid primary key default app_uuid_v7(),
  tenant_id                 uuid not null,
  instance_id               uuid not null,
  event                     varchar(32) not null,
  occurred_at               timestamptz(6) not null,
  step_id                   uuid,
  ordinal                   integer,
  actor_membership_id       uuid,
  on_behalf_of_membership_id uuid,
  metadata                  jsonb not null default '{}',
  created_at                timestamptz(6) not null,
  created_by                varchar(255) not null,
  updated_at                timestamptz(6) not null,
  updated_by                varchar(255) not null,
  deleted_at                timestamptz(6),
  deleted_by                varchar(255),
  version                   integer not null,
  constraint workflow_history_instance_fk
    foreign key (instance_id) references workflow_instance (id),
  constraint workflow_history_step_fk foreign key (step_id) references workflow_step (id),
  constraint workflow_history_event_check
    check (event in ('instance-started', 'step-awaiting', 'step-approved', 'step-rejected',
                     'step-skipped', 'instance-completed', 'instance-rejected',
                     'instance-cancelled')),
  -- A step entry names the step and where it sat in the order, or it is not a step entry.
  constraint workflow_history_step_check check ((step_id is null) = (ordinal is null)),
  constraint workflow_history_ordinal_check check (ordinal is null or ordinal >= 1),
  -- Nobody acts on another's behalf without acting.
  constraint workflow_history_authority_check
    check (on_behalf_of_membership_id is null or actor_membership_id is not null)
);

create index workflow_history_instance_idx
  on workflow_history (tenant_id, instance_id, occurred_at, id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Immutability.
--
-- Two tables, and both for the same reason ADR-0045 gives: **an edited decision is not evidence.**
-- A decision an approver made and a record of how an approval was routed are the two things somebody
-- asks about a year later, and the cheapest way to guarantee they were not rewritten is to give the
-- database no way to rewrite them.
--
-- `before update or delete` catches a soft delete too — setting `deleted_at` is an update — which is
-- deliberate: a decision that can be hidden is a decision that can be denied. A correction is a new
-- instance, never a rewritten decision.
--
-- Deliberately the only two triggers in this module. Every other invariant here is a check
-- constraint, a partial unique index or an optimistic version — mechanisms that do not need to
-- compare an old row with a new one. Triggers are architecturally significant in this repository,
-- and one added for convenience is one nobody expects.
-- ---------------------------------------------------------------------------------------------
create or replace function app_workflow_decision_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'workflow_decision_immutable'
    using errcode = 'restrict_violation',
          detail = format('workflow_decision %s is immutable', old.id),
          hint = 'A correction is a new approval, not a rewritten decision.';
end; $$;

create trigger workflow_decision_no_mutation
  before update or delete on workflow_decision
  for each row execute function app_workflow_decision_immutable();

create or replace function app_workflow_history_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'workflow_history_immutable'
    using errcode = 'restrict_violation',
          detail = format('workflow_history %s is immutable', old.id),
          hint = 'History records what happened; what happened does not change.';
end; $$;

create trigger workflow_history_no_mutation
  before update or delete on workflow_history
  for each row execute function app_workflow_history_immutable();

-- ---------------------------------------------------------------------------------------------
-- Row-level security (ADR-0030). Every table here carries `tenant_id`, so every one takes the
-- standard policy, with no exception.
--
-- **What these policies do not express**, stated rather than assumed: approver A must not read
-- approver B's queue, and that is not a tenant property. A policy would need to know which
-- membership the caller is — which, unlike an employment, this product *can* resolve (§3.6 of the
-- plan) — but expressing it here would put an authorization rule in a place no test of the
-- application layer can see. That guarantee lives in the application and is asserted at the HTTP
-- edge; the database enforces tenant isolation and nothing finer.
--
-- **A foreign key is not isolation.** The nine foreign keys above couple rows *within* Workflow, and
-- PostgreSQL's referential check runs without consulting a policy — so containment across the
-- boundary comes from these policies plus the application confirming a cross-module identifier
-- through a published contract before it writes one.
-- ---------------------------------------------------------------------------------------------
call app_protect_table('workflow_definition');
call app_protect_table('workflow_version');
call app_protect_table('workflow_step_template');
call app_protect_table('workflow_instance');
call app_protect_table('workflow_step');
call app_protect_table('workflow_decision');
call app_protect_table('workflow_history');

comment on table workflow_instance is
  'A running approval. This *is* the specification''s Approval Request: `ApprovalPort.request()` creates one and its identifier is the `approvalId` the four reserved `approval_id` columns are shaped for.';
comment on index workflow_instance_open_subject_idx is
  'The "Duplicate Approval Requests" validation. Two submissions of one subject at the same instant would each pass a read-then-write check and produce two queues for one thing.';
comment on index workflow_step_awaiting_idx is
  'Exactly one step of an instance awaits a decision. Cannot be deferred, so advancing must move the decided step out of `awaiting` before it moves the next one in.';
comment on index workflow_step_queue_idx is
  'The approval queue, as a read rather than a table. Partial, so it stays the size of the open work rather than of the history.';
comment on column workflow_decision.on_behalf_of_membership_id is
  'The assigned approver whose authority a delegate used. Identity owns delegation (AD-010); this is an identifier, not a reference, and no row here restates Identity''s period.';
comment on column workflow_instance.context is
  'The requesting module''s own facts. Stored for audit and read by nothing in Phase 16A: routing rules that would read it are conditional branching, which is 16B.';
comment on column workflow_step_template.ordinal is
  '`integer` rather than `smallint` deliberately: AD-004 forbids a hardcoded approval limit, and a smallint would cap a process at 32,767 steps whether or not anybody meant it as a rule.';
