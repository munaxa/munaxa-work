-- Enterprise Workflow & Approvals — escalation (Phase 16D, Checkpoint 3).
--
-- One column, one widened vocabulary and one index. Every one of the three was named by Checkpoint 2
-- as the persistence the domain cannot provide for itself, and nothing else is added here.
--
-- **Additive.** No table, column, row, index, policy or trigger is dropped. **One** object is
-- replaced — a check constraint — and it is replaced by something strictly wider, which is the one
-- shape of change that cannot reject a row that was legal before. It is the same move Phase 16C made
-- on `workflow_step_template_approver_kind_check`, for the same reason.
--
-- Three things this migration deliberately does **not** do:
--
--   * **No `escalated_by`, no `escalation_reason`, no `escalation_id`.** Who escalated and why are
--     facts about an *act*, and this module already has a place for those: `workflow_history` records
--     the actor and the event. A second copy on the step would be a second answer to "who did this",
--     and the append-only table is the one an auditor reads.
--
--   * **No `due_at`, no `expired`, no `breached`.** Unchanged from Phase 16C and for the same reason
--     (D-16C-06): due-ness is derived from the target, the awaiting instant and an explicit reading
--     instant, every time it is asked. Escalation does not make any of it storable.
--
--   * **No scheduler or job state.** There is no `run_at`, no attempt counter and no lock column,
--     because nothing runs. Escalation is a human's act (D-16D-02), and the command is deterministic
--     and idempotent so that a future runner *could* invoke it — which is a property of the
--     semantics, not of a column.

-- ---------------------------------------------------------------------------------------------
-- Which approvers the instance snapshotted, and which one somebody added
-- ---------------------------------------------------------------------------------------------

-- The instant an escalation added this approver. `NULL` on every step the instance snapshotted.
--
-- **Its absence is the denominator**, which is the whole reason the column exists. 16B locked the
-- rule that the branch's denominator is the approver set snapshotted when the instance started, and
-- the tally counts it from the rows at an ordinal — so a row added later would move `assigned`, move
-- `threshold`, and could revert a branch that had already been decided back to `awaiting`. Marking
-- the addition is what keeps the original set countable after it has been added to: the tally counts
-- the rows where this column is null, and the snapshot stays exactly what it was.
--
-- **Nullable, with no default, and not backfilled.** A default would make every existing step look
-- escalated, which is precisely backwards; and there is nothing to backfill, because no escalation
-- has ever happened. `NULL` is not "unknown" here — it is the positive statement that this approver
-- was in the set the approval started with.
--
-- It sits beside `source_group_id`, which is the same kind of fact: where this approver came from.
-- One says "from a list"; this one says "from somebody's decision to bring them in". Neither is a
-- reference and neither has a foreign key.
alter table workflow_step add column escalated_at timestamptz;

comment on column workflow_step.escalated_at is
  'The instant an escalation added this approver, or null when the instance snapshotted them at start. Null is the denominator: the branch tally counts the steps where this is null, so adding an approver never moves the assigned count or the threshold of a branch already under way.';

-- ---------------------------------------------------------------------------------------------
-- The ninth event
-- ---------------------------------------------------------------------------------------------

-- `step-escalated` joins the eight events 16A wrote.
--
-- Replaced rather than added to, because a check constraint has no `alter`. Every value legal before
-- is legal after: this is a strict widening and a row that satisfied the old constraint cannot fail
-- the new one.
--
-- **An escalation is not a decision, and this is where that is enforced.** Recording it as
-- `step-approved`, `step-rejected` or `step-skipped` would put an answer in the timeline that nobody
-- gave — a person appearing to have decided something because somebody else brought them in. The
-- domain names the event (`ESCALATION_EVENT`) and asserts it is none of those three; the constraint
-- is what makes the alternative impossible rather than merely discouraged.
--
-- Exactly one value is added. Not `escalation-requested`, `escalation-failed`, `escalation-expired`,
-- `escalation-automatic` or `step-reassigned`: the first two describe an attempt this module does not
-- record, the third and fourth describe a scheduler that does not exist, and the last describes a
-- replacement D-16D-02 forbade.
alter table workflow_history drop constraint workflow_history_event_check;
alter table workflow_history add constraint workflow_history_event_check
  check (event in ('instance-started', 'step-awaiting', 'step-approved', 'step-rejected',
                   'step-skipped', 'step-escalated', 'instance-completed', 'instance-rejected',
                   'instance-cancelled'));

comment on constraint workflow_history_event_check on workflow_history is
  'The nine events this module records. `step-escalated` says an approver was added to a branch; it is deliberately not one of the three decision events, because an escalation is not an answer.';

-- ---------------------------------------------------------------------------------------------
-- One escalation per person per branch, under concurrency
-- ---------------------------------------------------------------------------------------------

-- The uniqueness ADR-0071 requires, and the reason it is an index rather than a check in code.
--
-- The domain refuses a duplicate by reading the branch it was handed. That is correct and it is not
-- sufficient: two transactions can each read a branch without the other's row and each conclude there
-- is nothing to add, and both then insert. ADR-0071 settles the point for this repository —
-- *"a `select` followed by an `insert` is not idempotent under concurrency"* — so the guarantee is
-- here, where the database can arbitrate it, and the loser gets a constraint violation rather than a
-- silent second approver.
--
-- **Partial on `escalated_at is not null`**, which is what makes it a rule about escalations rather
-- than about steps. Two steps at one ordinal naming the same membership is not something this schema
-- has ever forbidden, and forbidding it now would be a new rule about ordinary branches that nobody
-- approved. What is forbidden is escalating the *same* person onto the *same* branch twice.
--
-- `deleted_at is null` joins the predicate because every partial index in this module carries it: a
-- soft-deleted row must not reserve a key that a live row needs.
--
-- `tenant_id` leads the key, as it leads every other index here. Two tenants may legitimately hold
-- the same instance, ordinal and membership identifiers, and a key without the tenant in it would let
-- one tenant's escalation refuse another's.
create unique index workflow_step_escalation_idx
  on workflow_step (tenant_id, instance_id, ordinal, approver_membership_id)
  where escalated_at is not null and deleted_at is null;
