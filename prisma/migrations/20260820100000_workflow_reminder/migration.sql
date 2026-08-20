-- ------------------------------------------------------------------------------------------------
-- Phase 16E — the automatic service-level reminder
-- ------------------------------------------------------------------------------------------------
--
-- One approved automatic action, and this migration carries everything it needs to be recorded and
-- to be safe under a runner that may deliver the same job twice.
--
-- **Additive throughout.** One value added to a closed vocabulary, four nullable columns, one partial
-- index. No column is dropped, no type changes, no constraint is weakened, and no existing row can
-- fail anything here.
--
-- **What this migration does not add**, stated so a reader does not go looking: no `due_at`, no
-- `breached`, no `expired`, no `overdue`, no `sla_state`. The service level stays derived — answered
-- from `service_level_count`, `service_level_unit` and `awaiting_at` on every read — because a stored
-- flag needs something to maintain it and ADR-0070 has the last word on flags nothing maintains. What
-- is recorded here is the *action*, never the condition.

-- ---------------------------------------------------------------------------------------------
-- A tenth history event
-- ---------------------------------------------------------------------------------------------

-- `WORKFLOW_HISTORY_EVENTS` and this constraint are one vocabulary in two places, and the parity
-- suite fails the moment they disagree. Dropping and recreating rather than altering, because
-- PostgreSQL has no "widen a check" and a recreate is what a widening is; every existing row already
-- satisfies the new one, since the old set is a subset of it.
--
-- **A reminder is not an escalation and not a decision.** `step-escalated` means a human widened an
-- approval by adding somebody; recording a reminder as that would say an approver had been added when
-- none was. `step-approved`, `step-rejected` and `step-skipped` would put an answer in the timeline
-- that nobody gave. The domain names the event (`REMINDER_EVENT`) and this is what makes every
-- alternative impossible rather than merely discouraged.
--
-- Exactly one value is added. Not `sla-breached` or `sla-overdue`, which assert a *state* this
-- product deliberately does not store; not `notification-sent`, which claims a delivery Workflow does
-- not perform and cannot observe; and not `automation-executed`, `job-executed` or `scheduler-fired`,
-- which name infrastructure rather than anything that happened to the approval.
alter table workflow_history drop constraint workflow_history_event_check;
alter table workflow_history add constraint workflow_history_event_check
  check (event in ('instance-started', 'step-awaiting', 'step-approved', 'step-rejected',
                   'step-skipped', 'step-escalated', 'step-reminded', 'instance-completed',
                   'instance-rejected', 'instance-cancelled'));

comment on constraint workflow_history_event_check on workflow_history is
  'The ten events this module records. `step-reminded` says the system told a step''s approver that the step had passed its service level; it changes nothing about the approval and is deliberately neither an escalation nor a decision.';

-- ---------------------------------------------------------------------------------------------
-- Execution provenance
-- ---------------------------------------------------------------------------------------------

-- Which automatic execution produced an entry, for the entries no person produced.
--
-- **Dedicated columns rather than `metadata`.** `metadata` is on the repository parity suite's
-- infrastructure list: no mapper reads it and no mapper writes it, so provenance placed there would
-- be invisible to the application — the silent-unmapping failure that suite exists to catch. It is
-- also unconstrained JSON, and an audit fact nothing constrains is an audit fact nothing can be held
-- to.
--
-- **These are not the actor.** `actor_membership_id` and `on_behalf_of_membership_id` stay null on an
-- automatic entry, because no membership acted and writing one would be the fake human every approved
-- decision refuses. These answer the different question of *what ran*.
--
-- **Nullable, and null on every one of the nine human events.** A person's entry has no execution
-- behind it, and a default here would attach one to nine kinds of row that never had one.
--
-- `varchar(255)` matches `created_by`, which already carries the same kind of subject — a machine
-- writes `service:<clientId>` there today, beside the `system:<reason>` a migration writes.
alter table workflow_history add column execution_identity varchar(255);
alter table workflow_history add column execution_correlation_id varchar(255);
alter table workflow_history add column execution_job_id varchar(255);
alter table workflow_history add column execution_attempt integer;

comment on column workflow_history.execution_identity is
  'The non-human subject the platform authenticated for the execution that produced this entry — service:<clientId>, apikey:<keyId>. Never a membership, and never a credential.';
comment on column workflow_history.execution_correlation_id is
  'The correlation identifier of the execution that produced this entry.';
comment on column workflow_history.execution_job_id is
  'The durable identity of the scheduled job, when one scheduled the execution. Null when nothing scheduled it.';
comment on column workflow_history.execution_attempt is
  'Which attempt at that job this was. 1 for the first delivery. Null when no job scheduled it.';

-- The four move together or not at all.
--
-- An entry naming a job but no execution, or an attempt but no job, would be provenance that cannot
-- be read back — and the failure would surface as a puzzle in an audit rather than as an error at the
-- moment it was written. Two rules, and both are implications rather than equalities: an execution
-- needs a correlation, and a job number needs a job.
alter table workflow_history add constraint workflow_history_execution_check
  check (
    (execution_identity is null) = (execution_correlation_id is null)
    and (execution_job_id is null or execution_identity is not null)
    and (execution_attempt is null or execution_job_id is not null)
    and (execution_attempt is null or execution_attempt >= 1)
  );

-- **A machine did it, or a person did — never both.**
--
-- The one rule that keeps automatic and human work distinguishable in this table for good. Without
-- it, a future writer could produce an entry that named an approver *and* an execution, and a reader
-- could no longer tell whether the person acted or the system did on their behalf. Impersonation
-- becomes unrepresentable rather than merely forbidden.
alter table workflow_history add constraint workflow_history_execution_not_human_check
  check (execution_identity is null or actor_membership_id is null);

-- ---------------------------------------------------------------------------------------------
-- One reminder per step, under concurrency
-- ---------------------------------------------------------------------------------------------

-- The uniqueness ADR-0071 requires, and the reason it is an index rather than a check in code.
--
-- The application refuses a duplicate by reading the history it was handed. That is correct and it is
-- not sufficient: two workers can each read a step with no reminder recorded and each conclude there
-- is one to send, and both then insert. *"A `select` followed by an `insert` is not idempotent under
-- concurrency"* — so the guarantee is here, where the database can arbitrate it, and the loser gets a
-- constraint violation that aborts its whole transaction rather than a silent second reminder.
--
-- **`(tenant_id, step_id)` is the whole identity**, and deliberately not the instant, the job or the
-- attempt. A step's clock starts once when it becomes `awaiting`, nothing restarts it, and a step
-- never returns to `awaiting` — so a step crosses its target exactly once, and one reminder per step
-- is the complete rule. Anything more in the key would let one step be reminded twice.
--
-- **Partial on the event**, which makes it a rule about reminders rather than about history. The
-- other nine events legitimately repeat on one step: several `step-awaiting` entries and a
-- `step-approved` share a `step_id`, and forbidding that would be a new rule about ordinary history
-- that nobody approved.
--
-- `deleted_at is null` joins the predicate because every partial index in this module carries it. It
-- is belt and braces here — `workflow_history_no_mutation` refuses every update and delete, so a
-- soft delete is impossible and the claim can never be released — and it is kept rather than dropped
-- so that a reader comparing the two indexes finds them consistent.
--
-- `tenant_id` leads the key, as it leads every other index here. Two tenants may legitimately hold
-- the same step identifier, and a key without the tenant in it would let one tenant's reminder
-- suppress another's.
create unique index workflow_history_reminder_idx
  on workflow_history (tenant_id, step_id)
  where event = 'step-reminded' and deleted_at is null;

comment on index workflow_history_reminder_idx is
  'At most one automatic service-level reminder per step, per tenant, enforced by the database rather than by a preceding read (ADR-0071). The history row is itself the idempotency record.';
