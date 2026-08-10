# ADR-0059 — The leave ledger is authoritative; the balance is a projection

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 9 · **Approval** Approved before implementation

## Context

A leave balance is the number an employee plans a holiday against, a manager approves against, and a
payroll clerk pays a leaving employee against. It is disputed more often than almost any figure this
product holds.

The conventional implementation is a mutable counter: a `balance` column incremented on accrual and
decremented on approval. It is fast, it is simple, and it has two failure modes that cannot be
recovered from. A counter incremented twice is wrong and there is nothing to compare it against. A
counter that is *right* is indistinguishable from one that is wrong, because the number is all there
is.

The worst version of this failure is silent: nobody notices until somebody is refused leave they
had, months later, with no way to reconstruct what happened.

## Decision

**Every balance is a sum of append-only rows. The stored figure is a projection of them.**

1. **`leave_ledger_entry` is inserted and read.** There is no `update` and no `delete` — not on the
   repository, not on the port, not in the migration. A correction is a **reversal plus a
   replacement**: two new signed rows, so the arithmetic that produced yesterday's figure is still
   visible after today's correction.

2. **Minutes are signed**, so a balance is `sum(minutes)`: one expression that cannot disagree with
   itself, rather than a case statement per kind that eventually will. The sign convention is
   enforced by a check constraint as well as by the domain.

3. **Every duration is integer minutes.** Not a fractional day, not a float. Half a day is 240 of
   480 minutes and is exact; half a day as `0.5` does not sum to a whole number over a year.
   Fractional-day *display* is a conversion at the edge, through the employment's contracted hours,
   with the basis stated.

4. **`leave_balance` is never written except by recalculation.** No command increments it. It
   carries `entries_digest`, `entry_count`, `calculated_at` and `inputs_changed_at`.

5. **Every ledger write marks the balance in the same transaction**, and a reconciliation query
   names what is outstanding — ADR-0053 applied to a second module. The predicate is *presence of
   the mark*, matching the partial index, never a comparison against `calculated_at`.

6. **`leave.balance-as-of` re-derives the figure from the ledger and never reads the projection.**
   It is an independent derivation of the same number, which is what makes a wrong projection
   detectable rather than merely unlikely.

7. **`(source_kind, source_id, kind)` is unique**, so every writer is idempotent: an accrual run
   repeated writes nothing, an approval retried consumes once, a leave-year close rerun produces no
   second carry pair.

## Consequences

- "Why is my balance this number" is answerable by listing rows, and the admin UI has a screen that
  does exactly that.
- A disputed figure is settled by arithmetic over rows nobody could have rewritten.
- Bounded runs are safe to **retry rather than repair**, which is the difference between an operator
  who can act and one who has to call somebody.
- Reading a balance costs one indexed row, not an aggregate over a million: the projection exists
  for that, and the digest is what makes trusting it defensible.
- A cancellation leaves *two* rows where a mutable counter would have left none — consumption and
  reversal. That is more storage and it is the point: "consumed and then given back" and "never
  consumed" are different facts about somebody's year.
- The projection can be stale. That is a visible state with a query that finds it and a command that
  fixes it, rather than an invisible one.

## Alternatives considered

**A mutable balance column.** Rejected: unrecoverable when wrong, and indistinguishable from correct.

**An event-sourced aggregate.** Rejected: this product has no event store, and building one for a
single module would be a persistence architecture nobody else uses. The ledger is the durable part
of event sourcing without the machinery.

**Ledger only, no projection.** Rejected on the read path. `leave.approved-leave-for` and the balance
screens are hot, and summing a million entries on every read is a cost with no compensating benefit —
provided the projection is derived, marked and reconciled, which is what the rest of this decision
buys.
