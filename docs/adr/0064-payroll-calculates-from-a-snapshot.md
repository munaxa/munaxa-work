# ADR-0064 — Payroll calculates from an immutable snapshot, never from a live source

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 11 · **Approval** Approved before implementation (D-2, D-3, D-10, D-11, D-14)

## Context

A payroll figure has to be defensible years after it was paid, to an employee, an auditor or a
labour court. Every fact it depends on — a salary, an approved leave day, a worked minute, an
organizational placement — lives in a module that will keep changing after the payslip is issued. A
salary is amended, a leave request is cancelled, an attendance period is re-frozen, an employee
transfers to another cost centre.

So "why did this person receive this amount" cannot be answered by asking the sources again. Asking
again answers a different question: what *would* they receive if the period were run today.

There is a second pressure. The event system in this repository is post-commit, in-process,
at-most-once, with no outbox and no durable subscription — verified in `PostgresUnitOfWork`, not
assumed. Any design where a payroll notices a change *because it was told* is wrong the first time a
process restarts mid-dispatch.

And a third: a large tenant is 100,000 employments. A design that reads the workforce into memory
works in a test and dies in production.

## Decision

**At calculation time Payroll captures an immutable record of the facts it actually consumed, and
every subsequent calculation, explanation, correction and export reads that record rather than the
sources.**

### What is captured

Per employment, the four consumed contract views **verbatim**:

- `CompensationPeriodView` from `compensation.payroll-period`;
- `PayableSnapshotView` from `attendance.read-snapshots`;
- `LeavePayrollPeriodView` from `leave.payroll-period`;
- the Employment facts from `employment.read-employment` resolved **as at the period**.

Plus, per source, its version and digest; plus the payroll group's population rule and rule version;
plus the country pack identifier and version where one applies; plus a digest over the payload and a
population digest over the sorted employment identifiers.

**Verbatim, not remodelled.** Storing Payroll's interpretation of a compensation view would leave the
snapshot unable to answer "what did Compensation tell us", which is the question a dispute actually
asks. The interpretation lives in the earning and deduction lines, where each carries the basis,
quantity, denominator and rounding mode that produced it.

**Minimal.** The snapshot is not a copy of the source domains. It holds no leave ledger, no
attendance event, no compensation history, no organizational hierarchy, and — under ADR-0038 — no
person, no name, no national identifier and no bank detail.

### What follows from it

**The calculation stages are pure.** Given the same snapshot and the same calculation version they
produce the same result, with no clock read, no database read and no source call. That is what makes
reproducibility testable rather than asserted: a finalized run's snapshot is replayed and compared to
the persisted result line for line.

**Change is found by pulling.** Reconciliation re-asks each source and compares against the
snapshot — `compensation.changed-since` on the system axis, the attendance snapshot's `sequence` and
digest, the leave digest, the employment `version`. It writes a reconciliation record naming which
employments went stale and why, moves the run to `stale`, and **never mutates a result**. If every
event this module raises were dropped, no payroll would be wrong.

**Versions are two things, not one.** A version says which record; a digest says which content. Both
are recorded, because the case a version alone misses is real: the code did not change, but a tenant
edited a deduction definition between two calculations.

**Scale is handled by batching, not by memory.** A run is processed in bounded batches of
employments, each a complete retrieve-calculate-persist cycle in its own transaction, with a
resumable cursor on the run. A failure at employee 60,000 resumes; a partial run cannot be approved;
peak memory is a function of the batch size and not of the tenant.

## Consequences

- A finalized payroll cannot silently change when a source record is later edited. It is not
  protected by a rule — the data it was computed from is a different set of rows.
- Storage is a real cost, stated rather than discovered: roughly 2–6 KB of `jsonb` per employment per
  run, which at 100,000 employments over twelve periods is single-digit gigabytes per tenant per
  year. Retention policy is deferred to a phase that owns data lifecycle.
- `jsonb` rather than normalized columns is deliberate: a contract that gains a field later must not
  make an old snapshot unreadable or force a migration of historical payroll.
- Reconciliation costs a real read per source per run. `compensation.changed-since` is cheap by
  design; attendance and leave require a period read, bounded by the population and paged.
- Recalculation is scoped to the employments reconciliation named, so an unaffected result is never
  recomputed.

## Alternatives considered

**Calculate from live sources and store only the result.** Cheapest, and it cannot answer §53's
question at all. A dispute over a two-year-old payslip would be met with today's salary.

**Snapshot whole source domains.** Reproducible and enormous, and it makes Payroll a second owner of
four domains — the duplication this architecture spends most of its rules preventing.

**Event-driven staleness.** Would work if the event system were durable. It is at-most-once with no
outbox, so a missed event is a silently wrong payroll, and the failure mode is invisible.

**Database-side calculation.** Rejected for the engine (D-3): a country pack would have to be SQL,
versioned in migrations, unable to use `Money`, and untestable by the existing infrastructure. The
repository contains no business logic in SQL at all, and this is not the place to start.
