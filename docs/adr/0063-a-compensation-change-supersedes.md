# ADR-0063 — A compensation change supersedes; a pay grade is not a job grade

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 10 · **Approval** Approved before implementation (D-4, D-5, D-8)

## Context

Three decisions in Phase 10 are about the same underlying property: a compensation figure must stay
answerable for ever, and must have exactly one answer on any given date.

Two of them are about *time*. The third is about a name collision that would have produced a second
answer of a different kind.

## Decision

### A change closes a period and inserts a new one. No value column is ever rewritten

An amendment does not edit. It writes `effective_to` on the period it supersedes — the only write
ever made to a historical row — and inserts a new row with the new amount, both in one transaction.
The superseded row keeps its amount, its currency, its plan, its actor and both timestamps.

This is what lets a payroll re-run for a closed period produce that period's figure, and it is why
an amount assigned from a salary step is **copied onto the assignment** rather than joined: revising
the step next year would otherwise silently restate what last year's payroll was run against.

Append-only in the strongest sense the repositories can express: `compensation_change` and
`compensation_approval_decision` offer `insert` and reads and **no** `update` or `remove` — not
because a caller is trusted not to use them, but because they do not exist (ADR-0052 applied to a
fourth module).

### Overlap is refused by the database, and both time axes are recorded

**One employment holds at most one active assignment of the same component at the same time**,
enforced by a GiST exclusion constraint over `daterange(effective_from, effective_to, '[)')` per
`(tenant, employment, component)`.

Application validation cannot make this guarantee. Two administrators assigning the same allowance
concurrently both read, both find nothing in the way, and both write — the read happened before
either wrote. Only the database can settle it, and the `23P01` it raises is translated into a
business refusal (`component_already_assigned`) rather than surfacing as a server fault. The tenant
is part of the constraint, so one tenant's assignment cannot block another's.

Half-open `'[)'` is deliberate: a period ending on the day the next begins does not overlap it,
which is exactly how a change closes one.

**Both `effective_from` and `recorded_at` are stored on every compensation record.** Business time
answers "what was true on this date"; system time answers "when did we learn it". Without the
second, a payroll dispute cannot distinguish a back-dated raise from one everybody always knew
about — and `compensation.changed-since`, which is how Payroll finds a retroactive correction, is a
query on the *system* axis that an effective-date filter cannot answer.

Phase 10 publishes as-of queries on **effective time only**. A full as-of-knowledge query is a
payroll-audit requirement nobody has stated, and building it speculatively is the wrong order; the
data to support one is recorded.

### A pay grade is not a job grade

Organization already holds `position.grade` as an opaque `varchar(64)` — a job-architecture band
somebody authored. Compensation's `compensation_pay_grade` is a **monetary range**: a minimum, a
midpoint, a maximum and a currency, effective-dated.

They are different things and are named so. The relationship between them is **configuration, not a
foreign key**: a pay grade may carry an optional `position_grade_label` a tenant sets to match
Organization's string. Nothing in Compensation branches on it, and a tenant using one and not the
other is unaffected.

A foreign key was considered and rejected: it would make Compensation **unable to price anything
Organization has not graded**, which is a dependency no customer asked for and the smaller company
would hit first. Organization is not modified in either direction.

## Consequences

- A grade **constrains** an amount and never supplies one: an assignment naming a grade is checked
  against that grade's range *at the effective date*, and refused outside it by name. A system that
  filled in a midpoint would be deciding somebody's salary.
- Retroactive and future-dated changes are both ordinary, and neither is a special case in the code:
  a future change is stored immediately, visible through `compensation.future-changes`, and does not
  affect what `at(today)` returns.
- A gap is permitted. An employment may genuinely have had no assignment of a component for a time,
  and `at(date)` returning nothing is a real answer rather than a zero.
- A zero amount is permitted and meaningful: "entitled to this component, currently at nothing" is a
  different fact from "not entitled to it", and only the first is expressible any other way.
- An import goes through exactly the same writer, so a bulk-loaded row meets the same period rules,
  the same currency rules and the same constraint. An import is not a back door.
