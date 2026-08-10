# ADR-0065 — A candidate is not an approved fact, and configuration cannot promote one

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 11 · **Approval** Approved before implementation — the original Phase 11 proposal was rejected in review (D-16)

## Context

Attendance publishes `PayableSnapshotView` with `overtimeCandidateMinutes`. ADR-0054 is explicit
about what that word means: Attendance produces *candidate* minutes and never money, and the
candidacy is the point — minutes that look like overtime against a schedule are not minutes somebody
approved as overtime.

Nothing in Attendance publishes an approved overtime quantity. There is no overtime approval
decision, no approving actor, no approved rate band.

Overtime pay is one of the first things anyone asks a payroll system for, and the candidate minutes
are sitting right there in the snapshot. The Phase 11 Definition of Ready proposed what looked like
a careful compromise: pay from candidate minutes **where the payroll group explicitly configures
them as approved-by-policy**, recording that basis on the line.

**That proposal was rejected in review, and the rejection was right.**

## Decision

**Payroll consumes an approved overtime result only through an explicit published Attendance
contract. A configuration flag may not promote a candidate into an approved fact.**

Concretely:

- `overtimeCandidateMinutes` is **never** treated as approved overtime — not by group configuration,
  not by a tenant setting, not by any other route.
- Candidate minutes **are** snapshotted, because they are part of what Attendance said and the
  snapshot records what Attendance said (ADR-0064).
- They produce **no earning line**. `attendance_overtime` exists as an `earning_source` value and
  **no code path reaches it**, which is asserted by test.
- Payroll builds **no second overtime calculation engine and no overtime approval engine**.
- **Overtime payroll is `NOT VERIFIED`** until Attendance publishes an authoritative
  approved-overtime contract.
- Attendance is not modified silently. The required contract is recorded as an explicit dependency:
  an approved quantity per employment and period, carrying the approving actor and instant, the
  minutes at each approved rate band, and a digest — produced by an Attendance command rather than
  derived at read time.

## Why the compromise was wrong

The flag looked like configuration and was actually an approval. A tenant that switched it on would
have Payroll paying minutes nobody approved, while the audit trail still said Attendance was the
authority for overtime. Two things would be true at once and both would be misleading: Attendance
would show candidate minutes it never approved, and a payslip would show overtime pay with no
approver's name behind it.

The generalizable rule, and the reason this is an ADR rather than a line in a plan:

**When a module marks a fact as non-authoritative, no downstream module may make it authoritative by
configuration.** Authority is granted by the owner publishing it, not by the consumer opting in. A
consumer that can promote a fact has quietly become its owner while leaving the responsibility
behind.

This is the same discipline as ADR-0056 — "leave unknown" is not "no leave" — and ADR-0060 —
approval is recorded, not delegated. Each is the same sentence applied to a different fact: *the
system may not assert something nobody established.*

## Consequences

- **Phase 11 ships a payroll that does not pay overtime**, and says so. For tenants who need
  overtime this is a real gap, and it is visible rather than approximated.
- The gap has a named cause and a named fix, so it is closed by Attendance publishing one contract
  rather than by an unpicking of Payroll.
- An unreachable enum value ships in the schema. That is deliberate: it reserves the classification
  so the eventual contract does not need a migration of historical lines, and the test asserting it
  is unreachable is what stops it becoming reachable by accident.
- A tenant whose overtime is genuinely approved by policy rather than per-instance is still not
  served. That case is real, and the answer is an Attendance contract expressing "approved by
  standing policy, by this actor, from this date" — which is an approval Attendance owns, not a flag
  Payroll reads.

## Alternatives considered

**Pay candidate minutes where configured** (the rejected proposal). Discussed above.

**Pay candidate minutes unconditionally.** Worse, and at least honest about being wrong.

**Add overtime approval to Payroll.** Builds the second engine §19 forbids, and puts an attendance
decision in the module furthest from the evidence — the punches, the schedule, the exceptions and
the supervisor who saw the work happen are all Attendance's.

**Add the approved-overtime contract to Attendance as part of Phase 11.** Defensible, and rejected
for scope: it needs an approval model, a permission, an audit trail and a UI in a completed module,
which is a broader domain-model change than an additive query. It is raised as a dependency instead.
