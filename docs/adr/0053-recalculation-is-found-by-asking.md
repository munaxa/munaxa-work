# ADR-0053 — Recalculation is found by asking, not by being told

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

The facts about event delivery in this repository have not changed since Phase 7 (ADR-0050):
`PostgresUnitOfWork.execute` commits and **then** dispatches; delivery is in-process; there is no
outbox and no replay. An event is at-most-once, and "the punch event was raised" is not evidence that
anything was calculated.

Attendance makes the stakes higher than Onboarding's. A day that was never recalculated after its
inputs moved is a wrong figure that looks right, and it is frozen into a payable snapshot at the end
of the month.

## Decision

**Every write that moves an input marks the affected days in the same transaction.** Ingesting an
event, rostering a day, assigning or ending a schedule, publishing a policy, applying a correction —
each sets `inputs_changed_at` on the days it touched, inside the transaction that made the change.
Not afterwards: a mark written afterwards is the mark that will be missing for exactly the day whose
events arrived during a deployment.

**Recalculation is an idempotent, bounded command.** `attendance.recalculate` takes what is marked,
recalculates it, and reports what changed. Identical inputs produce an identical `inputs_digest`, the
row is left alone and the caller is told `unchanged`. A run has a limit, so it finishes.

**Reconciliation is a first-class query.**
`GET /api/v1/attendance/reconciliation` names the days whose inputs moved and which nobody has
recalculated, and the count is on the administrator's dashboard rather than in an operations script.
It is the number that reveals a *failure*, and a number a human can see is a number a human notices
growing.

**The predicate is presence of the mark**, matching the partial index
`where inputs_changed_at is not null` exactly — never a comparison against `calculated_at`. An input
that moves within the same clock tick as the calculation it invalidates would be lost by a
comparison, and lost silently. The recalculation clears the mark.

**Ingestion is idempotent, and the database decides.** `attendance_time_event_key` is a tenant-scoped
partial unique index over a deduplication key derived in three tiers — the client's idempotency key,
then the source's own reference, then a digest of the punch itself. A device retry, a mobile offline
queue flushing twice and a re-run import all converge on one row. Two concurrent submissions race at
the index; the loser catches `23505`, re-reads, and both callers are told the same event identifier.
A repeat is a **200 with `alreadyRecorded: true`**, never a 409 — a punch clock retries, and an
endpoint whose retry fails is not idempotent.

**Event received ≠ recalculation guarantee; event not received ≠ recalculation failure.**

## Consequences

- Nothing in this module claims exactly-once processing, durable delivery or outbox semantics, and
  the completion report says so verbatim.
- Recalculation is **not automatic** unless something calls the command. Whether that is an operator
  or a scheduler is a deployment decision; Phase 8 introduces no job infrastructure.
- The reconciliation queue growing is the visible symptom of every delivery failure this design
  tolerates, which is the point of putting it on a screen.

## Alternatives considered

**Recalculate synchronously inside every write.** Rejected: publishing a policy would recalculate a
month of days for every employment inside one request.

**Subscribe to the internal `event.recorded` event.** Rejected on the delivery facts above. The
events are still raised, and a subscriber would be an accelerator — never the guarantee.
