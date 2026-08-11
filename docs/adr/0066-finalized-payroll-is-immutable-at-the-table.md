# ADR-0066 — Finalized payroll is immutable at the table, not only in the code

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 11 · **Approval** The requirement was approved before implementation (D-9); the mechanism was required to be compared explicitly first, and this records that comparison

## Context

Finalization is the moment a payroll stops being a working figure and becomes a record: it is what an
employee is paid against, what an accounting export is derived from, and what a labour court would
be shown. After it, a silent edit is not a bug — it is indistinguishable from fraud, and it is
invisible, because the row simply reads differently afterwards.

The requirement is therefore stronger than "the API refuses": **a finalized result, earning line,
deduction line, snapshot, accounting line and payment instruction must be impossible to mutate
through any normal or accidental application path.**

This repository has no business triggers. The only server-side code in ten migrations is
`app_current_tenant()`, `app_protect_table()`, `app_isolation_diagnostics()`, `app_uuid_v7()` and
`app_memberships_of()` — all infrastructure. Adding the first business trigger is architecturally
significant, so the review required the alternatives to be compared before one was written rather
than after.

## The comparison

**Option 1 — application-level only.** Every repository update carries `where finalized_at is null`.

Protects: every path that remembers the predicate. Cheap, obvious, and testable.

Fails against: a new repository method written next year that omits it; a data-fix migration; a
`psql` session; an ad-hoc `update` run at three in the morning to unblock a payroll. Every one of
those is a realistic way a finalized row gets edited, and none of them goes through the code that
holds the rule.

**Option 2 — a `before update or delete` trigger raising on a finalized row.**

Protects: every write to the table, from any path, including SQL nobody wrote in TypeScript.

Costs: the repository's first business trigger — a new class of thing to reason about, invisible in
the TypeScript, and capable of surprising somebody debugging a failing write. Plus a per-row
execution cost, measured below.

**Option 3 — another repository-compatible database mechanism.** Included because the review
required it, and the comparison is what shows the category is empty:

| Mechanism | Why it cannot express this |
| --- | --- |
| `check` constraint | Sees only the new row. It cannot ask whether the row *was already* finalized, so it cannot distinguish finalizing a row from editing a finalized one |
| Rule (`create rule`) | Deprecated, and interacts badly with `returning` — which every repository write in this codebase uses |
| Revoked `update` grant | The application role owns these tables and must update rows that are **not** yet finalized. A grant is per-table, not per-row |
| RLS `with check` | Discriminates on the **new** row. `using` restricts which rows are visible, not which transitions are legal, so neither half can say "this row was finalized before you touched it" |
| Generated / immutable column | PostgreSQL has no "write-once" column, and a generated column cannot depend on its own previous value |

Only a trigger reads the old row, and reading the old row is exactly what "was already finalized"
requires.

### The measured cost

Measured on the benchmark database, 100,000 seeded rows, comparing an identically-shaped table with
and without the trigger. Reported as measured, not rounded down:

| Operation | Without trigger | With trigger | Difference |
| --- | --- | --- | --- |
| 10,000 single-row updates (median of 3) | 1,069 ms | 1,158 ms | **+8%, ≈ 14 µs per row** |
| One bulk `update` of all 100,000 rows | 1,403–1,779 ms | 1,552–2,143 ms | Within run-to-run noise |

14 microseconds per row, on the cheapest statement PostgreSQL can execute. In the real write path —
which adds a network round trip, RLS policy evaluation, an audit column set and a `returning` — the
relative cost is smaller still. It is not free, and it is not close to mattering.

## Decision

**Both.** `where finalized_at is null` ships on every application update path, and a
`before update or delete` trigger refuses any change to a finalized row on the six tables that carry
finalized data.

The predicate is the fast, legible rule that lives beside the code doing the work. The trigger is
the one that survives the code being rewritten by somebody who has not read this file.

The trigger raises `payroll_finalized_immutable` with SQLSTATE `restrict_violation`, a detail naming
the table, row and finalization instant, and a hint saying what the caller should do instead —
because an error that only says "no" sends somebody looking for a workaround.

Corrections remain what they always were: an explicit reversal run, an explicit correction run, an
adjustment run, or a controlled recalculation at a stated version. Every one preserves the original.

## Consequences

- A finalized payroll cannot be changed by a repository bug, a forgotten predicate, a migration or a
  human at a `psql` prompt. The mutation-attempt tests exercise each of those paths and all are
  refused.
- **This repository now has business logic in the database**, and the precedent needs a boundary:
  this is a *refusal*, not a calculation. Nothing is computed, defaulted or rewritten in a trigger,
  and a future phase proposing one that does should be made to argue it separately.
- Every write path to those six tables pays ~14 µs per row. Bulk finalization writes are unaffected
  within measurement noise.
- The trigger fires on `delete` as well as `update`, so soft-deleting a finalized row is refused
  too — which is the loophole a delete-only guard would have left open.
- A row is protected from the moment `finalized_at` is set, and finalization sets it in the same
  transaction that freezes the run. There is no window between the two.

## Alternatives considered

Discussed above. Two more were raised and dismissed quickly:

**Move finalized rows to a separate append-only table.** Doubles every read path and every foreign
key, and introduces a moment where a row exists in neither table or both.

**Rely on an audit log to detect edits after the fact.** Detection is not prevention, and a payroll
edited last quarter and detected this quarter has already been paid, exported and possibly filed.
