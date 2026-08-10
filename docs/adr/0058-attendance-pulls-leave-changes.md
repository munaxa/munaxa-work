# ADR-0058 — Attendance pulls leave changes; Leave never writes to Attendance

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 9 · **Approval** Approved before implementation

## Context

When leave is approved, cancelled or amended, the attendance days for those dates are stale: their
`leaveState` and `absenceMinutes` were computed against a different answer. Something has to notice.

The obvious design is for Leave to tell Attendance — a command, `attendance.mark-inputs-changed`,
sent from Leave's approval handler under a bounded service grant. That was the shape Phase 9's
Definition of Ready proposed.

It is wrong, and the reason is structural rather than stylistic. **Attendance already depends on
Leave**: every attendance calculation asks `leave.approved-leave-for` to decide whether an absence
was authorized (ADR-0056). A Leave-to-Attendance write closes that loop. The two modules would
depend on each other, the dependency gate would refuse the import graph, and — worse than either —
**Leave would become responsible for mutating Attendance's derived state**, which is a boundary
violation no service grant makes acceptable.

There is also a delivery problem. Event delivery in this repository is post-commit, in-process and
at-most-once with no outbox. A design that depended on Leave successfully calling Attendance would
lose the call to any crash between the two.

## Decision

**The dependency points one way, and the module that needs the information asks for it.**

1. **Leave publishes two reads and no writes.** `leave.approved-leave-for` answers "what leave is
   approved for this employment over these dates". `leave.approved-leave-affecting` adds
   `changedSince` and answers the same question narrowed to what has *moved*. Both return the
   `leave_request_day` rows themselves, so the two modules cannot disagree about which dates are
   covered.

2. **Attendance pulls.** `attendance.reconcile-leave { employmentId, from, to, changedSince? }` asks
   Leave what changed and marks **its own** days stale. It marks; it does not calculate.
   `attendance.recalculate` does that, idempotently and boundedly, so a marking run that
   half-finished is simply re-run.

3. **Leave contains no Attendance identifier, no Attendance command and no Attendance table
   reference.** There is no method on any Leave port that could write one.

4. **`changedSince` is supplied, not remembered.** No cursor table, no feed, no subscription: the
   caller passes the instant it last reconciled from, and a run without one re-examines the range. A
   stored cursor is a piece of cross-module state that can drift out of step with what was actually
   recalculated, and recovering from a drifted cursor is harder than re-reading a range.

5. **The reconciliation reports whether Leave could be asked.** `leaveKnown: false` is distinct from
   "nothing changed", for the same reason ADR-0056 gives.

## Consequences

- The dependency graph stays acyclic and the direction is legible: Attendance → Leave, always.
- Correctness does not depend on delivery. If every domain event in the product were dropped, an
  operator running `attendance.reconcile-leave` would still find the change and the attendance
  record would still converge. This is ADR-0053's argument applied across a module boundary.
- Leave's approval transaction is **shorter and cannot fail for Attendance's reasons**. Under the
  rejected design an approval would have failed if Attendance was unavailable — refusing somebody's
  leave because a different module was down.
- Reconciliation is not instantaneous. Between an approval and the next reconciliation run, an
  attendance day may still say `absent_unexplained`. That is a *visible* lag with a command that
  closes it, rather than an invisible one that depends on a message having arrived.
- Nothing schedules the reconciliation, because nothing in this repository runs on a timer. Phase 24
  owns scheduling; until then it is an operator's command, and the phase report says so.

## Alternatives considered

**Leave calls `attendance.mark-inputs-changed`.** Rejected: it closes the dependency cycle described
above, and it makes Leave responsible for another module's derived state. The bounded service grant
would have made it *authorized*, not *correct*.

**An outbox, or a published event contract.** Rejected for this phase. One consumer does not justify
a delivery guarantee the whole product would then depend on, and Phases 16 and 17 own that work
properly. A pull that already works is a better foundation for it than an outbox built for a single
caller.

**A shared reconciliation cursor table.** Rejected: cross-module state with no owner. Whichever
module held it would be storing a fact about the other module's progress.

**Attendance subscribing to `leave.request.approved`.** Rejected as a *guarantee*; permitted as an
accelerator. At-most-once delivery cannot be the mechanism that keeps somebody's absence record
accurate.
