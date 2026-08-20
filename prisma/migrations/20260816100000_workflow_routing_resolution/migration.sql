-- Enterprise Workflow & Approvals — routing resolution (Phase 16C, Checkpoint 3).
--
-- Two altered tables and one widened vocabulary, bringing PostgreSQL into parity with the domain
-- Phase 16C Checkpoint 2 completed. Nothing here is a new capability: every column below is a domain
-- field that already exists in `packages/modules/workflow/src/domain` and currently has nowhere to
-- live.
--
-- **Additive.** No table, column, row or index is dropped. **One** object is replaced — a single
-- check constraint — and it is replaced by something strictly wider, which is the one shape of
-- change that cannot lose a row that was legal before.
--
-- Two things this migration deliberately does **not** do, and both were decided rather than
-- overlooked:
--
--   * **No second approver column for a manager.** A `manager` template names nobody: whose manager
--     it means is fixed — the person who raised the approval — so there is no target to configure
--     (P-1). The manager is resolved once, when the instance starts, and the resolved person lands
--     in `workflow_step.approver_membership_id` exactly as a group's members do. A running approval
--     therefore still names a concrete membership and depends on no live organizational lookup,
--     which is the 16B invariant this had to preserve rather than a happy accident.
--
--   * **No `due_at`, no `expires_at`, no `overdue`, no `breached`.** Due-ness is *derived* from two
--     instants and an integer, every time it is asked (D-16C-06). A stored due time would be a
--     second source of truth that disagrees with its own inputs the moment a target is corrected,
--     and a stored `expired` would need something to write it — a scheduler this phase does not have
--     (D-16C-01) or a synthetic actor ADR-0045 refuses (D-16C-02). What is stored is the
--     configuration and the authoritative instant; the arithmetic stays in `domain/service-level.ts`.

-- ---------------------------------------------------------------------------------------------
-- The approver a template may name
-- ---------------------------------------------------------------------------------------------

-- `manager` joins `membership` and `group`.
--
-- Replaced rather than added to, because a check constraint has no `alter`. Every value legal before
-- is legal after: this is a strict widening, and a row that satisfied the old constraint cannot fail
-- the new one.
alter table workflow_step_template drop constraint workflow_step_template_approver_kind_check;
alter table workflow_step_template add constraint workflow_step_template_approver_kind_check
  check (approver_kind in ('membership', 'group', 'manager'));

-- **`workflow_step_template_approver_check` is deliberately untouched**, and that is worth a
-- sentence because it looks like an omission.
--
-- It reads `(kind = 'membership') = (membership_id is not null) and (kind = 'group') = (group_id is
-- not null)` — two biconditionals rather than a list of permitted shapes. For `manager` both sides
-- of both are false, so a manager template with **neither** identifier satisfies it and one carrying
-- **either** violates it. That is exactly the approved rule (P-1), enforced by a constraint written
-- in 16B for a different vocabulary. A disjunction of named shapes would have needed editing here;
-- a biconditional generalized for free.

-- `workflow_step_approver_kind_check` is untouched for the opposite reason: it enumerates
-- `membership` alone and must continue to. A group is resolved into its members and a manager into
-- one membership *before* a step row exists, so at the moment somebody is actually asked there is
-- only ever a person. Widening it would let a running approval defer the question of who decides.

-- ---------------------------------------------------------------------------------------------
-- How long a step is expected to take
-- ---------------------------------------------------------------------------------------------

-- A whole count and a unit, on the template and on the step.
--
-- **Two columns rather than an `interval`**, because "two days" and "forty-eight hours" are the same
-- duration and not the same sentence: an administrator typed one of them and a screen has to show
-- them back what they typed. An `interval` would also be a fifth column type in a module that has
-- four, and its precision is not the integer discipline this module keeps everywhere else.
--
-- **`integer`, never `numeric`.** There is no fractional target: half a day is a question about
-- working hours that Workflow cannot answer, and rounding one silently would answer it wrongly. The
-- domain refuses a fraction (`serviceLevelTarget`) and there is no column here for one to survive in.
alter table workflow_step_template add column service_level_count integer;
alter table workflow_step_template add column service_level_unit varchar(8);

alter table workflow_step_template add constraint workflow_step_template_service_level_check
  check (
    (service_level_count is null) = (service_level_unit is null)
    and (service_level_count is null or service_level_count >= 1)
    and (service_level_unit is null or service_level_unit in ('hours', 'days'))
  );

-- The same two on a running step, **copied when the instance starts**.
--
-- Not read back from the template, for the reason AD-003 gives and 16B repeated for `branch_rule`,
-- `quorum` and `condition`: an approval already under way follows the version it started on, and a
-- target edited afterwards must not silently move a due time on a step somebody is already waiting
-- to answer.
alter table workflow_step add column service_level_count integer;
alter table workflow_step add column service_level_unit varchar(8);

alter table workflow_step add constraint workflow_step_service_level_check
  check (
    (service_level_count is null) = (service_level_unit is null)
    and (service_level_count is null or service_level_count >= 1)
    and (service_level_unit is null or service_level_unit in ('hours', 'days'))
  );

-- ---------------------------------------------------------------------------------------------
-- When the clock started
-- ---------------------------------------------------------------------------------------------

-- The instant this step became `awaiting`.
--
-- **The one genuinely new fact in this migration**, and the minimum one: a target is meaningless
-- without the instant it counts from, and the approved rule is that the clock starts when *this
-- step* becomes awaiting rather than when the approval started (P-5). For a sequential chain the
-- third step's clock starts when the second is answered; for a parallel branch every step starts its
-- own when the branch opens. Neither is derivable from `workflow_instance.started_at`.
--
-- **Why not read it from `workflow_history`.** The history table already records
-- `(event = 'step-awaiting', step_id, occurred_at)`, so the instant does exist there — and it stays
-- there, as the narrative. Two reasons it is not the operative input. First, history is an **audit
-- log**: making it load-bearing for a live computation would mean a routing answer depended on a
-- record whose purpose is to describe what happened, and 16A and 16B never read it to decide
-- anything. Second, it is a row in another append-only table that grows without bound, so every
-- overdue reading would join per step — and the queue this feeds is a screen somebody opens every
-- morning, held to the 100 ms budget.
--
-- **Nullable, and not backfilled.** A step with no instant has no clock, which is exactly what
-- `dueAt` answers for one. No existing row needs one either: `service_level_count` is null on every
-- template and every step this migration touches, so no approval already running has a target for a
-- missing instant to be measured against. A backfill would change data to no effect.
alter table workflow_step add column awaiting_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------------------------

comment on column workflow_step_template.service_level_count is
  'How long this step is expected to take once it becomes awaiting, as a whole count of the unit beside it. A target and not a deadline: nothing fires when it passes.';
comment on column workflow_step_template.service_level_unit is
  'Whole hours or whole days. Elapsed time, never business days — Workflow holds no calendar and takes no Organization dependency for one.';
comment on column workflow_step.service_level_count is
  'The target this step started with, copied from its template when the instance started. An edit to the template never moves it.';
comment on column workflow_step.service_level_unit is
  'The unit this step started with, copied from its template when the instance started.';
comment on column workflow_step.awaiting_at is
  'The instant this step became awaiting, and the instant a service-level target counts from. Null while the step has not been reached and on every step that predates Phase 16C. Nothing derived is stored beside it: due-ness is computed from this, the target and an explicit reading instant.';
comment on constraint workflow_step_template_approver_kind_check on workflow_step_template is
  'membership, group or manager. A manager template names nobody: whose manager it means is the requester, fixed rather than configured.';
