# Phase 16C — Checkpoint 5 — PostgreSQL repositories

**Scope.** Workflow's PostgreSQL persistence only: the row mappers, the parity suite, and the
persistence, concurrency and live-application tests around them. No migration, no schema change, no
domain change, no application command or query, no API, no Admin, no cross-module adapter.

The schema is frozen at `20260816100000_workflow_routing_resolution`. **No migration was created**,
and `prisma/` is untouched in this commit.

---

## 1. What Checkpoint 5 had to do

Checkpoint 3 put three columns in the database and Checkpoint 4 put three fields in the domain, and
**nothing joined them**. A step written through the repositories came back without the instant it
became awaiting and without the target it started with. Checkpoint 4 named this and left two
round-trip assertions failing rather than narrowing them; both are green now, which is the shortest
statement of what this checkpoint did.

| Table | Column | Domain field |
| --- | --- | --- |
| `workflow_step_template` | `service_level_count`, `service_level_unit` | `serviceLevel` |
| `workflow_step` | `service_level_count`, `service_level_unit` | `serviceLevel` |
| `workflow_step` | `awaiting_at` | `awaitingAt` |

All three round-trip exactly. No fourth column was needed, and none was added.

---

## 2. The mappers

**`workflow-service-level-columns.ts` (new, 45 lines).** The two service-level columns appear on
*two* tables and map identically on both, so the pair is written once rather than twice — a second
copy is how a target comes to round-trip on a template and be silently dropped on a step.

- `serviceLevelValues(target)` → both columns or both nulls. Neither function has a shape that could
  produce half a target; the database's two `*_service_level_check` constraints require both or
  neither, and the mapper agrees by construction rather than by a branch.
- `serviceLevelOf(count, unit)` → one value object, or nothing. `asNumber` on the count, because an
  `integer` column can arrive from the driver as a string and `Number.isInteger('2')` is false — a
  due time computed from that is `NaN`. Asserted rather than trusted.

**Two columns rather than an interval**, kept from Checkpoint 3's reasoning: "two days" and
"forty-eight hours" are the same duration and not the same sentence. The round-trip suite asserts
they stay distinguishable.

**`awaiting_at`** is mapped through `presentOf` as an ordinary nullable `timestamptz` — the driver
hands back a `Date` holding an absolute instant and the mapper passes it through untouched, in both
directions. Nothing generates it, defaults it, or derives it from `created_at` or from
`workflow_history`.

**Nothing derived is computed anywhere in persistence.** No `dueAt`, no `serviceLevelState`, no
`overdueByMinutes`. Those are the domain's, from the stored target, the awaiting instant and a
reading instant the caller supplies. A repository that computed one would be answering "is this
overdue?" as at whenever the row happened to be loaded, so the answer would differ by query.

---

## 3. The manager needed nothing

The finding worth stating plainly: **what Phase 16C added to persistence for the manager approver is
one value in an existing check constraint.**

- A **manager template** stores `approver_kind = 'manager'` with both identifier columns SQL `null`.
  No manager column exists on either table, and `workflow_step_template_approver_check` — written in
  16B as two biconditionals rather than a list of shapes — already refuses either identifier on that
  kind, without being edited.
- A **running manager step** stores `approver_kind = 'membership'` and the resolved membership in
  `approver_membership_id`. It is indistinguishable from a step a tenant typed, which is precisely
  the point: a running approval names a person and depends on no live organizational lookup.
  `workflow_step_approver_kind_check` still enumerates `membership` alone and was not widened.
- **The repository resolves nothing and cannot.** Asserted over the infrastructure source, with prose
  stripped: no file imports `@work/identity`, `@work/organization`, `@work/employment`,
  `@work/recruitment`, `ReportingLinePort`, `resolveManager` or `managerOf`.

The snapshot is asserted at the row and end to end: a step written with a resolved membership keeps
that membership after the reporting line changes — not because the repository defends it, but because
nothing on the row points at a reporting line that could be followed a second time. A *new* approval
started afterwards gets the new manager, so the assertion is about the snapshot rather than a stale
double.

---

## 4. A defect found in the audit tool

The parity suite ran three assertions, all **outward from the mapper**: nothing read that the schema
lacks, nothing written that the schema lacks, nothing required that is unsupplied. All three stay
green when the *database* grows a column no mapper touches.

So when Checkpoint 3 added three columns, the parity suite reported parity for a checkpoint and a
half while those columns were invisible to the application. A step round-trip assertion eventually
caught it; this file did not.

The fourth direction is closed:

- **`reads every domain column the database has, so none is silently unmapped`** — every catalogue
  column that is not on an explicit `INFRASTRUCTURE` list (`tenant_id`, `metadata`, and the audit and
  soft-delete pairs) must be read by a mapper. A new column must now be mapped, or named by somebody
  who decided it should not be.
- **`maps the three columns Phase 16C added, on both tables that carry them`** — by name, so a rename
  cannot satisfy the general assertion by disappearing from both sides at once.

Both were verified to fail as intended: removing `awaiting_at` from `stepColumns` makes them report
`workflow_step.awaiting_at` by name.

A column silently unmapped is the worst of the four failures because it is the quiet one — everything
inserts, everything selects, and the value simply never arrives.

---

## 5. Files

**New (6)**

| File | Lines | What |
| --- | --- | --- |
| `workflow-service-level-columns.ts` | 45 | the two columns, mapped once for two tables |
| `workflow-manager-persistence.integration.test.ts` | 323 | 10 tests |
| `workflow-service-level-persistence.integration.test.ts` | 341 | 15 tests |
| `workflow-derived-columns.integration.test.ts` | 99 | 2 tests — split at budget |
| `workflow-routing-live.integration.test.ts` | 331 | 13 tests — the in-memory/PostgreSQL parity run |
| `workflow-routing-races.integration.test.ts` | 154 | 2 tests — split at budget |

**Changed (5)** — `workflow-config-rows.ts`, `workflow-record-rows.ts` (the mappers),
`workflow-repository-parity.integration.test.ts` (§4), `workflow-states.ts` (`aManagerTemplate`,
`aStartedApproval`, `BranchOptions.serviceLevel`), `workflow-live.fixture.ts` (the reporting-line
double, `StepSpec.approverKind` and `.serviceLevel`).

**Also changed** — `domain/instance.ts` and `application/instance.use-case.ts`, **formatting only**.
See §11.

---

## 6. Transaction ownership, append-only, groups and branches

All unchanged, and all still asserted by the 16A/16B suites, which pass untouched:

- **Transactions** — repositories take the transaction they are given. None opens one, commits,
  rolls back, or creates a connection for a write. `workflow-repository-transaction.integration.test.ts`
  proves a template, instance and steps commit together; that a later failure rolls back earlier
  writes; that a PostgreSQL-raised failure rolls back the surrounding transaction; and that a second
  connection cannot see uncommitted writes.
- **Append-only** — `workflow_decision` and `workflow_history` still have no update method, no soft
  delete and no restore, and the triggers still refuse update, no-op update, soft delete and hard
  delete over raw SQL. No trigger was touched.
- **Groups and branches** — create, read, search, add member, read members, `membersOfAll`, removal,
  reuse after removal, tenant isolation; several templates at one ordinal, several running steps at
  one, several awaiting at once, one decision per step, deterministic ordering; and the three
  snapshot rules (editing, removing from and adding to a group after the start changes nothing).

---

## 7. RLS, tenancy and concurrency

**RLS** — unchanged and unbypassed. Every fixture role is created with `rolsuper = false` and
`rolbypassrls = false`, asserted before any security conclusion, and the new suites use the same
roles. Manager steps, service-level fields, instance detail, the pending queue, totals, and group and
branch reads are each asserted invisible from a second tenant. No privileged access was introduced.

**Concurrency** — two real PostgreSQL connections, overlapping transactions, no sleeps, and every
outcome classified by constraint name or by `ConcurrencyException` rather than by "an error
happened". Two new properties:

- **Two steps may take the same awaiting instant and the same target at once**, asserted positively.
  An index on `awaiting_at` would make parallel approval unrepresentable, since every step of a
  branch opens at the same instant by construction.
- **A manager-resolved step races exactly as a membership step does** — a duplicate decision loses to
  `workflow_decision_step_idx` by name. If the manager approver had acquired any persistence
  mechanism of its own, this is where it would surface.

---

## 8. Query plans and indexes

**No index was added, dropped or altered.** Plans are still taken from the statements the
repositories actually issue, captured by a recording `Transaction` rather than retyped beside the
repository. The widened select lists changed no plan: the queue read still reaches
`workflow_step_queue_idx` with the `limit` in the statement, the instance search still reaches the
status index, the duplicate-convergence read the subject index, and `membersOfAll` is still one
statement whatever the group count.

**Known debt, restated rather than fixed.** `workflow_step_awaiting_idx` is reachable — the schema
suites prove it — but **no repository query uses it**. It has been unused by the repositories since
16B widened it from a uniqueness constraint into an ordinary index, and it is carried forward as debt
under §19 rather than given a query invented to justify it.

---

## 9. In-memory and PostgreSQL parity

`workflow-routing-live.integration.test.ts` runs Checkpoint 4's scenarios through the real handlers,
the real domain, the real `PostgresUnitOfWork` and the PostgreSQL repositories: manager template,
manager-resolved step, the snapshot after the reporting line moves, fail-closed with nothing written,
service-level target through configuration and start, a later step's clock starting when *that* step
opens, a parallel branch sharing an instant, the queue row carrying the target, and tenant isolation
on both.

**Neither store was changed to make the two agree.** The in-memory stores hold whole state objects
and therefore carried the new fields already; the columns were added in Checkpoint 3 to match a
domain that already existed. PostgreSQL is the authoritative implementation and the assertions above
are about what it does.

---

## 10. Tests

| Suite | Tests |
| --- | --- |
| `workflow-manager-persistence` | 10 |
| `workflow-service-level-persistence` | 15 |
| `workflow-derived-columns` | 2 |
| `workflow-routing-live` | 13 |
| `workflow-routing-races` | 2 |
| `workflow-repository-parity` (2 added) | 9 |

**Module total: 56 files, 669 tests, all passing.** Nothing skipped, no `.only`, no
`eslint-disable`, no `any`, no broad `toThrow()`, no sleeps, no disabled constraint or policy, and no
privileged role used to prove a security property. No test was deleted, and the two Checkpoint 4
reds are green.

---

## 11. Defects

**1. The parity suite was missing a direction.** §4. Fixed in the audit tool, verified to fail as
intended, and the cause of the two Checkpoint 4 reds.

**2. The race fixture leaked an unhandled rejection, latent since Phase 16B.**
`workflow-race.fixture.ts` ended with
`{ first: await outcomeOf(firstRun), second: await outcomeOf(secondRun) }`. `outcomeOf` is what
attaches a `catch`, so the **second** promise had no handler until the first had settled — and a
challenger that lost its race before then rejected with nothing listening. Node reports that as an
unhandled rejection and Vitest fails the run for it, even with every test passing.

It is a timing window rather than a certainty, which is why it survived from 16B until the uncached
serial run at §14 happened to lose it — reported as `669 passed, 1 error, ELIFECYCLE`. Fixed at the
cause: both `outcomeOf` calls now happen before either is awaited, so both promises carry a handler
from the moment they exist. No test was changed, and none was weakened — the fix makes a real failure
mode impossible rather than tolerated.

**3. Two Checkpoint 4 files were committed unformatted.** `domain/instance.ts` and
`application/instance.use-case.ts` fail `prettier --check`. `pnpm format:check` was not among the
gates run at Checkpoint 4 — it is in this checkpoint's list, which is how it surfaced. Fixed by
`prettier --write`; **no code changed**, only line wrapping in an import and a call.

None required a schema, application, Identity, Organization, API or Admin change.

---

## 12. Stop conditions

None was met. Specifically: `awaiting_at` persists with no schema modification; the service-level
fields match the schema exactly; the manager-resolved membership needs no manager column; the
repository needs neither Identity nor Organization; no new index is required; no index, constraint,
RLS policy or append-only guarantee was weakened; SLA needs no persisted `due_at` or `expired`; a
manager step is representable as a concrete membership step; no 16B concurrency guarantee changed; no
completed module was modified; no cross-module adapter was required; and nothing needed a scheduler,
`JobPort`, notification, outbox, worker or timer.

---

## 13. NOT VERIFIED

Unchanged from Checkpoint 4, and none of it acquired persistence here: automatic expiry, automatic
escalation, business-day targets, role routing, external approvers, notifications, analytics,
self-service portals, and any scheduler, job, outbox or timer. The `ReportingLinePort` adapter is
still unwired — `WorkflowDependencies.reportingLine` remains the one optional field, and
`workflow.composition.ts` was not modified.

---

## 14. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,695 files, no cycles |
| `pnpm format:check` | all files clean |
| `pnpm lint` | 47/47, no errors, no warnings |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `pnpm prisma validate` | schema valid |
| `pnpm prisma migrate status` | 23 migrations, database up to date |
| `pnpm verify --force --concurrency=1` | exit 0 |
| `turbo run test --force --concurrency=1` | 47/47 tasks, 0 cached, **3,626 tests passed**, 0 failed, 0 skipped, 0 `.only`, 0 unhandled errors |

---

**Phase 16C Checkpoint 5 is complete. Checkpoint 6 has not started.**
