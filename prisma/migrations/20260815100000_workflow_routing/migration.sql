-- Enterprise Workflow & Approvals — the routing core (Phase 16B, Checkpoint 3).
--
-- Two new tables and four altered ones, bringing PostgreSQL into parity with the domain Phase 16B
-- Checkpoint 2 completed. Nothing here is a new capability: every column below is a domain field
-- that already exists in `packages/modules/workflow/src/domain` and currently has nowhere to live.
--
-- **Additive.** No table, column or row is dropped. Three objects are *replaced* — two unique
-- indexes and one check constraint — and each is replaced by something strictly wider, which is the
-- one shape of change that cannot lose a row that was legal before.
--
-- Three absences remain, and they are the same three 16A named:
--
--   * **No `due_at`, no `expires_at`, no `escalation_level`, no `breached`.** `JobPort` still has no
--     adapter anywhere in this repository, so nothing runs when nobody is asking. A branch whose
--     quorum can no longer be reached waits, visibly, until a person acts — which is a real
--     operational state, and a column claiming otherwise would need something to move it overnight.
--
--   * **No tally table, and no stored count.** A tally is a function of the decisions that exist
--     (`domain/branch.ts`). A stored `approvals` counter would be a second source of truth that
--     disagrees with `workflow_decision` the moment two approvers commit at once, and the decision
--     table is the one an auditor reads.
--
--   * **No weight, no percentage, no `numeric`.** Every voter has one vote and every threshold is an
--     integer count. `quorum` is `integer`; there is no floating-point column in this module for a
--     proportion to hide in, which is what makes "no rounding rule to get wrong" structural.
--
-- **A group is a list, not a lifecycle.** `workflow_approval_group` has no `status`, no `archived_at`
-- and no effective period. It is a name and a set of memberships somebody wrote down; a list that is
-- no longer wanted is soft-deleted like every other row in this repository. Inventing
-- `active | archived` would add a vocabulary, a check constraint and a transition table to express
-- something nobody asked for — and the domain (`domain/approval-group.ts`) deliberately has none.

-- ---------------------------------------------------------------------------------------------
-- Approval groups
-- ---------------------------------------------------------------------------------------------

-- A named list of memberships a tenant maintains.
--
-- **This is not a directory, and that distinction is why it is allowed to exist.** A directory
-- answers "who holds role X" — a question about people, evaluated whenever it is asked, against
-- facts somebody else owns. `PlatformPermissionChecker` states this product will never build one.
-- What is here is the opposite: a list somebody wrote down, kept by Workflow, with no query behind
-- it, no nesting, no inheritance and no role semantics.
--
-- `membership_id` on the member row is an **opaque value**, exactly as every other membership
-- identifier in this module is: Identity owns membership identity, and a foreign key across a module
-- boundary would couple two schemas' migration order while providing no isolation at all (ADR-0042).
create table workflow_approval_group (
  id         uuid primary key default app_uuid_v7(),
  tenant_id  uuid not null,
  code       varchar(64) not null,
  name       jsonb not null,
  metadata   jsonb not null default '{}',
  created_at timestamptz(6) not null,
  created_by varchar(255) not null,
  updated_at timestamptz(6) not null,
  updated_by varchar(255) not null,
  deleted_at timestamptz(6),
  deleted_by varchar(255),
  version    integer not null,
  -- The same code shape `isCode` enforces in the domain, and the same six other modules use.
  constraint workflow_approval_group_code_shape_check
    check (code ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  -- Not a second identity: `id` is already unique. This exists so a child row can carry a **composite**
  -- foreign key and be unable to name a group in another tenant. See the member table below.
  constraint workflow_approval_group_tenant_key unique (id, tenant_id)
);

-- One code per tenant, and the same code freely reusable in another. Partial on `deleted_at`, so a
-- code a tenant discarded can be used again — the treatment every code index in this repository has.
create unique index workflow_approval_group_code_idx
  on workflow_approval_group (tenant_id, code) where deleted_at is null;

-- One membership's place in one group.
--
-- A row rather than an array on the group, because membership is added and removed individually and
-- each change is an ordinary audited write with its own `added_at` — which is the question asked
-- after an approval went to somebody nobody expected.
--
-- **The foreign key is composite, and that is deliberate.** PostgreSQL's referential check runs
-- *without* consulting a row-level policy, so a plain `references workflow_approval_group (id)` would
-- happily let one tenant attach a member row to another tenant's group: the parent is invisible to
-- them for every purpose except this one. Naming `(id, tenant_id)` makes the reference itself carry
-- the tenant, so a cross-tenant parent is refused by the key rather than by a predicate somebody has
-- to remember to write. This is the one place in the module where an intra-module foreign key can do
-- that work, because it is the one place a child names a parent the writer may not read.
create table workflow_approval_group_member (
  id                uuid primary key default app_uuid_v7(),
  tenant_id         uuid not null,
  approval_group_id uuid not null,
  membership_id     uuid not null,
  added_at          timestamptz(6) not null,
  metadata          jsonb not null default '{}',
  created_at        timestamptz(6) not null,
  created_by        varchar(255) not null,
  updated_at        timestamptz(6) not null,
  updated_by        varchar(255) not null,
  deleted_at        timestamptz(6),
  deleted_by        varchar(255),
  version           integer not null,
  constraint workflow_approval_group_member_group_fk
    foreign key (approval_group_id, tenant_id)
    references workflow_approval_group (id, tenant_id)
);

-- **One row per membership per group**, and the key is exactly that pair rather than the pair with a
-- tenant in front of it. The tenant is already fixed by the composite foreign key above, and a key
-- beginning with `tenant_id` would let the same person appear twice in one group if the two rows
-- ever disagreed about the tenant — which is the case the composite key closes and this must not
-- reopen.
--
-- Arbitrated here rather than in the domain because it is a fact about a **set** of rows: two
-- administrators can add the same person in the same instant, and a read-then-write check would let
-- both through. `addApprovalGroupMember` says so, and deliberately does not check it.
create unique index workflow_approval_group_member_idx
  on workflow_approval_group_member (approval_group_id, membership_id) where deleted_at is null;

-- Reading a group's membership, which is what an instance start does once per group it expands.
create index workflow_approval_group_member_group_idx
  on workflow_approval_group_member (tenant_id, approval_group_id, membership_id)
  where deleted_at is null;

call app_protect_table('workflow_approval_group');
call app_protect_table('workflow_approval_group_member');

-- ---------------------------------------------------------------------------------------------
-- Conditions, as a structure the database can check and a meaning it cannot
-- ---------------------------------------------------------------------------------------------

-- Whether a stored condition list has the **shape** the domain's closed form describes.
--
-- `jsonb` accepts any JSON at all, so a column with no constraint would accept `{"drop": true}` and
-- call it a condition. What is checkable here is structure: an array of objects, each naming a
-- non-empty key, one of the five operators, and a value. What is **not** checkable here is meaning —
-- whether the value's type suits the operator, whether the key exists in a particular instance's
-- context, whether a missing key is a refusal rather than a false. Those are `domain/condition.ts`'s,
-- they depend on a request's payload, and re-expressing them in SQL would be a second definition of
-- the rule that drifts from the first.
--
-- A function rather than an inline `check`, because a check constraint may not contain a subquery
-- and walking an array requires one. `immutable` is what makes it legal in a constraint at all.
create or replace function app_workflow_condition_shaped(condition jsonb) returns boolean
  language sql
  immutable
as $$
  select jsonb_typeof(condition) = 'array'
     and not exists (
       select 1
         from jsonb_array_elements(condition) as entry
        where jsonb_typeof(entry) <> 'object'
           or entry->>'key' is null
           or btrim(entry->>'key') = ''
           or entry->>'operator' is null
           or entry->>'operator' not in
              ('equals', 'not-equals', 'greater-than', 'less-than', 'in')
           or not (entry ? 'value')
     );
$$;

-- ---------------------------------------------------------------------------------------------
-- Step templates: a group may be named, a branch may have a rule, and an ordinal is now a branch
-- ---------------------------------------------------------------------------------------------

-- `approver_membership_id` stops being mandatory because a `group` template names no person. The
-- pairing is not left loose: the constraint below requires **exactly** the field the kind implies,
-- which is stricter per row than `not null` was.
alter table workflow_step_template alter column approver_membership_id drop not null;

alter table workflow_step_template add column approver_group_id uuid;
alter table workflow_step_template add column branch_rule varchar(16);
alter table workflow_step_template add column quorum integer;
alter table workflow_step_template add column condition jsonb;

-- The widening 16A anticipated in as many words: *"adding a kind in 16B is a migration and a
-- check-constraint change somebody reviews, rather than a new meaning quietly given to an existing
-- column"*. Exactly two kinds, matching `APPROVER_KINDS` exactly, and the parity suite compares the
-- two by machine.
alter table workflow_step_template drop constraint workflow_step_template_approver_kind_check;
alter table workflow_step_template add constraint workflow_step_template_approver_kind_check
  check (approver_kind in ('membership', 'group'));

-- Exactly one approver field, and the right one for the kind. Both present is the dangerous case
-- rather than the untidy one: a template naming a person *and* a group has two readings, and
-- whichever an implementation happened to pick would decide who approves. `approverIsCoherent`
-- refuses it in the domain; this refuses it to everything, including SQL nobody wrote in TypeScript.
alter table workflow_step_template add constraint workflow_step_template_approver_check
  check ((approver_kind = 'membership') = (approver_membership_id is not null)
     and (approver_kind = 'group') = (approver_group_id is not null));

-- Composite, for the reason the member table's is: a group a tenant cannot read is still a group
-- their template must not be able to name.
alter table workflow_step_template add constraint workflow_step_template_group_fk
  foreign key (approver_group_id, tenant_id)
  references workflow_approval_group (id, tenant_id);

-- Null means `unanimous` with a quorum of one, which is exactly what every step written before this
-- phase is: one approver who must approve. `branchOf` reads that default in one place, so the absent
-- value has one meaning rather than a meaning per call site — and no backfill is needed, which is
-- what keeps this migration additive.
alter table workflow_step_template add constraint workflow_step_template_branch_rule_check
  check (branch_rule is null or branch_rule in ('unanimous', 'majority', 'first-response'));
-- Bounded below and deliberately not above, as both ordinals are: a quorum larger than its branch is
-- refusable only against the branch's size, which is a fact about a set of rows and is checked at
-- publication by `branchConfigurationIsUsable`.
alter table workflow_step_template add constraint workflow_step_template_quorum_check
  check (quorum is null or quorum >= 1);
alter table workflow_step_template add constraint workflow_step_template_condition_check
  check (condition is null or app_workflow_condition_shaped(condition));

-- **An ordinal is a branch, not a position, and this is where that stops being unique.**
--
-- 16A's index read `unique (tenant_id, workflow_version_id, ordinal)`, which was the right rule while
-- every ordinal held exactly one step. Phase 16B defines a branch as *the set of templates sharing an
-- ordinal* — three approvers asked at once are three rows at ordinal 2 — so the uniqueness that
-- expressed "sequential" now expresses "no branch may have more than one member in it", which is the
-- opposite of the feature.
--
-- What replaces it is the same key without the uniqueness: the lookup "the templates of this
-- version, in branch order" is the read that actually happens, and it is what the index is for now.
-- Contiguity of the distinct ordinals is still checked once, by the domain, at publication — a
-- partial index cannot express "no gaps" and never could.
drop index workflow_step_template_ordinal_idx;
create index workflow_step_template_ordinal_idx
  on workflow_step_template (tenant_id, workflow_version_id, ordinal) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Running steps: the group is already resolved, and a branch may await as a whole
-- ---------------------------------------------------------------------------------------------

-- `approver_kind` on a running step **does not change**, and that is the point of the snapshot. A
-- template may name a group; a step never does, because the group was expanded into its members
-- before this row existed. At the moment somebody is actually asked there is only ever a person, so
-- `workflow_step_approver_kind_check` keeps the single value it has had since 16A — and the parity
-- suite compares it against that single value rather than against the whole vocabulary, so a
-- machine-checked parity rule cannot turn into pressure to widen it.
--
-- `source_group_id` is **provenance, and deliberately not a reference.** It records which list a
-- person came from so "why was I asked?" has an answer. A foreign key here would tie a running
-- approval to a row somebody may later edit or delete, which is precisely the dependency the
-- snapshot exists to sever (AD-003): editing a group must not reach an approval already under way.
alter table workflow_step add column source_group_id uuid;
alter table workflow_step add column branch_rule varchar(16);
alter table workflow_step add column quorum integer;
alter table workflow_step add column condition jsonb;

alter table workflow_step add constraint workflow_step_branch_rule_check
  check (branch_rule is null or branch_rule in ('unanimous', 'majority', 'first-response'));
alter table workflow_step add constraint workflow_step_quorum_check
  check (quorum is null or quorum >= 1);
alter table workflow_step add constraint workflow_step_condition_check
  check (condition is null or app_workflow_condition_shaped(condition));

-- The running counterpart of the template change above: several steps of one instance share an
-- ordinal, because that is what a parallel branch *is*.
drop index workflow_step_ordinal_idx;
create index workflow_step_ordinal_idx
  on workflow_step (tenant_id, instance_id, ordinal) where deleted_at is null;

-- **The awaiting invariant moves from "one step" to "one branch", and only the domain can hold it.**
--
-- 16A's index read `unique (tenant_id, instance_id) where status = 'awaiting'`: at most one step of
-- an instance awaits a decision. Phase 16B asks every step of the open branch at once, so that index
-- now refuses the feature's ordinary case.
--
-- What is *not* attempted here is a unique index over `(tenant_id, instance_id, ordinal)` on the
-- awaiting rows. It would look like the same invariant one level up — "one branch awaits" — and it is
-- not: it would refuse the second and third member of a single branch, which are the rows that must
-- exist. "At most one **ordinal** among an instance's awaiting steps" is a condition on a set that no
-- unique index can express, and expressing it with a trigger would mean a row trigger reading other
-- rows of the same table under concurrency — which is exactly the read-then-write check every index
-- in this module exists to avoid, rebuilt in PL/pgSQL and no safer for it.
--
-- So it is stated where it can be true: `chooseBranch` opens one branch, and the invariants that
-- remain arbitrated by the database are the ones a database can actually arbitrate — **one decision
-- per step** (`workflow_decision_step_idx`, unchanged and load-bearing) and a step's status being one
-- value, so no row is both decided and awaiting. What replaces the index is the read it was
-- incidentally serving: the open branch of one instance.
drop index workflow_step_awaiting_idx;
create index workflow_step_awaiting_idx
  on workflow_step (tenant_id, instance_id, ordinal)
  where status = 'awaiting' and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------------------------
comment on table workflow_approval_group is
  'A named list of memberships a tenant maintains. Not a directory: no query, no nesting, no inheritance and no role semantics. Resolved once, when an instance starts, and never consulted again.';
comment on constraint workflow_approval_group_member_group_fk on workflow_approval_group_member is
  'Composite so the reference carries the tenant. PostgreSQL checks a foreign key without consulting a policy, so a plain reference would let one tenant attach a member to another tenant''s group.';
comment on index workflow_approval_group_member_idx is
  'One row per membership per group. Keyed on the pair alone rather than on the pair behind a tenant, because a tenant in front of the key would let the same person appear twice if two rows disagreed about it.';
comment on index workflow_step_awaiting_idx is
  'The open branch of an instance. No longer unique: Phase 16B asks every step of a branch at once, and "one branch awaits" is a condition on a set that no unique index can express.';
comment on index workflow_step_ordinal_idx is
  'The steps of an instance in branch order. No longer unique: an ordinal is a branch, and several steps sharing one is what a parallel branch is.';
comment on column workflow_step.source_group_id is
  'Provenance, deliberately not a reference: the group a snapshotted approver came from. A foreign key would tie a running approval to a list somebody may later edit, which is the dependency the snapshot exists to sever.';
comment on column workflow_step_template.condition is
  'The closed condition form — (key, operator, value), combined only by all-of. The database checks its shape; whether it can be evaluated depends on a request''s context and is the domain''s.';
comment on function app_workflow_condition_shaped(jsonb) is
  'Structure, never meaning. An array of objects each naming a key, one of the five operators and a value. Type suitability and a missing key are the domain''s, and depend on facts no constraint can see.';
