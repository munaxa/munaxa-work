# ADR-0054 — Attendance produces candidate minutes, never money, and freezes them in sequence

**Status** Accepted · **Date** 2026-08-11 · **Author** Phase 8 · **Approval** Approved before implementation

## Context

Overtime is where an attendance module usually stops being an attendance module. The next question
after "they worked ninety minutes past the shift" is "at what multiplier", and the answer is a
jurisdiction question, a contract question and a compensation-policy question — none of which are
about when somebody came and went.

The second question is what Payroll reads. A month is paid from a figure; a correction lands two days
later; and both "what was paid" and "what is now true" have to remain answerable.

## Decision

**No column in this module holds money.** Not a rate, not a multiplier, not an amount. The
calculation produces minutes in named buckets — worked, regular candidate, overtime candidate,
unpaid, absence, leave — and `overtimeCandidateMinutes` is a *candidate*. The word is load-bearing:
it is time beyond the expected day plus whatever threshold the tenant configured, and whether it is
payable is Compensation's and Payroll's decision.

**Nothing statutory ships.** Every policy value is inert unless the tenant configures it: no
rounding, no grace period, no late tolerance, no overtime threshold. A shipped grace period would be
this product deciding a labour-relations question for a customer who never asked, and in several
markets the answer is statutory and belongs to a country pack (00B).

**The payable snapshot is frozen and sequenced.** `attendance_payable_snapshot` is inserted and read;
there is no update method. A correction after a freeze produces the **next sequence** rather than
altering the row Payroll already read, and
`attendance_payable_snapshot_key (tenant_id, employment_id, period_start, period_end, sequence)`
makes that a fact rather than an intention.

**A snapshot carries its own completeness.** `daysUnapproved` and `blockingExceptions` are on the
contract rather than filtered out, so a consumer decides visibly instead of being handed a silently
incomplete month. Freezing is refused outright while a day in the period is awaiting recalculation.

## Consequences

- Payroll cannot read a pay figure from Attendance, which is correct: it reads minutes and applies
  its own rules.
- A month can be re-frozen as many times as corrections require, and every version stays readable.
- A tenant that has configured no attendance policy gets a refusal by name — `no_policy_in_force` —
  rather than a calculation against invented defaults.

## Alternatives considered

**Store an overtime multiplier on the policy.** Rejected. It is compensation data wearing an
attendance policy's clothes, and it would make this module the place two teams edit the same number.

**Let a correction update the existing snapshot.** Rejected. It erases what was paid, which is the
one thing a payroll dispute needs.
