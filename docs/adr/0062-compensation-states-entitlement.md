# ADR-0062 — Compensation states entitlement; Payroll determines payment

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 10 · **Approval** Approved before implementation (D-7)

## Context

Compensation is the module that most invites scope creep, because almost every question a customer
asks about it *sounds* like a compensation question and is actually a payroll question. "What does
this person cost us this month" needs proration. "What did the raise cost in arrears" needs to know
what was already paid. "What is their net" needs tax. None of those can be answered without facts
Compensation does not hold and must not.

Phase 11 does not exist yet, so there was no consumer to push back. A module with no consumer is
exactly where a "convenience" total gets added and never removed.

## Decision

**Compensation answers one question: what is this employment entitled to receive, and what was it
entitled to on a given date. Payroll answers what is actually paid for a period.**

The boundary is drawn in the published contract rather than in a comment. `compensation.payroll-period`
carries:

- component identifiers and codes, amounts, currencies and exponents;
- `payrollTreatmentCode` — a tenant or country-pack code, **travelling uninterpreted**;
- `proratable` — a *flag*, stating that Payroll may prorate, not how;
- `partialPeriod` — a *fact*, stating that a period does not span the whole payroll period;
- `resolvedFrom` — where a percentage amount came from, so a figure can be checked;
- an `inputsDigest` and a `calculationVersion`, so a disputed figure is traceable.

It does not carry, and no code path could produce: a gross, a net, a tax, a social-security figure,
an overtime payment, an unpaid-leave deduction, an arrears amount, an end-of-service accrual or a
converted currency.

**Compensation reads neither Attendance nor Leave.** Payroll consumes all three separately.
Attendance's `overtimeCandidateMinutes` stays a candidate (ADR-0054) and Leave's
`paidTreatmentCode` stays uninterpreted (ADR-0060); multiplying either by a rate is Payroll's, and
doing it here would make Compensation depend on two modules it has no reason to know about.

### And the corollary: no projection

The payroll-period read is answered **set-based from the authoritative rows** — one statement for a
page of employments — rather than from a maintained projection. Leave needed a projection because a
balance is a sum over an unbounded, growing ledger; a current salary is one indexed row, and the set
grows with the number of *changes* rather than with time employed.

A projection would have added a staleness class of bug that does not otherwise exist, a digest and a
stale mark to maintain, and a second place a salary figure can be found — and therefore a second
place it can be wrong.

The decision was made conditional on measurement, and the measurement was taken: see the Phase 10
report for the figure. If a later scale overturns it, a projection must be **rebuildable,
digest-versioned, stale-detectable, tenant-scoped, bounded and idempotent**, and must never become
authoritative.

## Consequences

- Payroll can be built without changing this module: it reads a contract that already exists.
- The contract is **assembled by a query handler**, never by exposing a table, so a column rename is
  not a contract change.
- Deductions are absent entirely (D-1): statutory deductions are Payroll's and loan recovery is
  Phase 10.1's, and a partial version here would create the second owner this architecture forbids.
- A consumer wanting one total per employment gets one total **per currency** instead, because the
  alternative requires a conversion nothing here performs.
- **Payroll reconciles by asking**, through `compensation.changed-since`, not by being told. Events
  are raised and nothing downstream depends on one: if every event were dropped, a payroll run would
  still find every change (ADR-0058's discipline, applied before the consumer exists).
