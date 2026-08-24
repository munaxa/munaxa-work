# Phase 5.3 · Checkpoint 2 — Custody · Verification

*Implemented 2026-08-23 on `claude/phase-5-employment-workforce-xaxasu`, from the baseline `44451a2`,
under the owner's explicit authorization of Checkpoint 2 and approval of D-5.3-09.*

---

## 1. What was built

One table, two commands, two reads, three permissions, one additive migration, **one cross-module
dependency that creates no contract**.

| | |
|---|---|
| **The custody** | `asset_custody` — one asset, one employment, from one day until another. One row is one handover (AD-003) |
| **Issuing** | `assets.issue-custody` — opens a custody against an employment Employment recognises |
| **Returning** | `assets.return-custody` — closes it, and the row becomes immutable at that instant |
| **Reading** | who holds an asset now and who held it before; what one employment holds |

## 2. Custody semantics

**A custody is a period, not an event.** Issuing opens one, returning closes it, and successive rows
are the history. A separate event log was rejected on evidence rather than taste: *"the latest event
for this asset is an issue"* is not indexable, so AD-004 would have degraded into a read-then-insert —
exactly what ADR-0071 forbids.

**The current holder is the open custody, derived and never stored.** There is at most one, and
`asset_custody_open_idx` is what makes that true. Nothing anywhere holds a second copy: no
`asset.current_employee_id`, no `in_custody`, no `assigned` — each asserted absent by name in the
module *and* in `information_schema.columns`.

**An asset in somebody's custody is still `available`.** This is the sharpest consequence of
Checkpoint 1's settled decision, and the checkpoint that could most easily have broken it did not:
`asset.status` says whether an item is *in service*, and whether it is *held* is this table's answer.
Asserted as behaviour, not merely stated.

*(Checkpoint 1's report glossed `available` as "in service and not held by anybody". The second half
was written before custody existed and was wrong; §5 of the Checkpoint 2 plan corrects it. The
vocabulary, the CHECK and the transitions are unchanged — only the English was.)*

**Retirement is refused while a custody is open** (D-5.3-09). It is an operational invariant, not a
termination rule: no status is invented, no custody is closed, nothing is automatic, and every other
status move is still permitted — an asset in custody can still go for repair.

## 3. D-5.3-09, and why it is race-safe

The invariant spans two tables, so **no single constraint can express it**. A pre-check alone would
not hold: two transactions could each read "no open custody" and "status is available", then both
commit.

The mechanism is a **row lock taken first**. `issue-custody` and `change-asset-status` both open with
`select … for update` on the asset row, *before* either checks anything. The two transactions therefore
serialize on that row: whichever arrives second blocks, and on unblocking PostgreSQL re-evaluates at
the committed version, so the re-check reads the truth rather than a stale one.

Proved against two real connections: an issue and a retirement racing produce **exactly one survivor**,
and the database is then queried directly for the forbidden combination — `status = 'retired'` **and**
an open custody — which never occurs. The `LockRows` node is asserted in the query plan, so the lock is
verified rather than assumed.

## 4. Security

**RLS enabled *and* forced** on `asset_custody` via `app_protect_table` (ADR-0030). Isolation proved in
**both directions** as an unprivileged role holding neither `BYPASSRLS` nor `SUPERUSER` — asserted from
`pg_roles` — with the neighbour's row confirmed to exist through the admin connection. Two tenants may
hold custody of assets carrying the same tag.

The RLS assertion that used to say "both tables" now **reconciles the protected set against
`ASSETS_TABLES` in both directions**, so a table added later without `app_protect_table` fails the
suite rather than shipping unprotected. That is stricter than the assertion it replaced.

**Three permissions, and the asymmetry is the point.** `assets.custody.read` · `.assign` · `.return`.
Issuing and returning are separate because a false *return* is the more dangerous direction — it makes
an outstanding asset disappear from the register offboarding clearance will read. `assets.asset.manage`
was **not** reused: maintaining a register of things and creating an obligation for a named person are
different authorities. Asserted in both directions, plus that the inventory read cannot reach custody.

No wildcard, no `assets.admin`, no `assets.custody.manage`, no `read-own`, and no permission for
transfer, acknowledgement or correction.

**No tenant identifier anywhere a caller can reach** — no command, query, DTO or route. **No actor
either**: who issued a custody is `created_by`, written by `@work/persistence` from the execution
context, and there is nowhere for a caller to put one.

**Employment is verified, not accepted.** An employment Employment does not recognise is refused as
`not_found` — the same answer another tenant's employment gets — so the command cannot enumerate a
workforce. When it is refused, **nothing is written**.

## 5. The Employment dependency

| | |
|---|---|
| Read | `employment.read-employment` — already published; Employment is **not modified** |
| Grant | bounded (ADR-0043), permitting **`EmploymentPermissions.employmentRead`** |
| Learned | one boolean |
| New contract | none |

**The permitted string is read from Employment's own export rather than typed as a literal**, and a
test reconciles the two. That is not fastidiousness: `GrantAwarePermissionChecker` matches a grant by
*exact string*, and `apps/api/src/relations/relations-sources.ts` permits `'employment.read'` while the
handler declares `employment.employment.read`. No handler anywhere declares the former — so Relations'
employment check cannot succeed through its grant. **That defect is Relations' and is not touched
here**; it is recorded in the register, and the reconciliation test is what stops Assets repeating it.

## 6. Audit

`created_by` / `updated_by` / `version` on `asset_custody`, plus `deleted_at` / `deleted_by`. Who issued
a custody and who recorded its return are the audit columns; there is no second copy in a business
column, because two copies of one fact eventually disagree.

**Reads are not audited and there is no custody access-trail table.** The only two audited-read domains
in this repository hold medical documents and disciplinary allegations. Attendance records when people
arrive and leave and audits no read; custody records who holds a laptop. Asserted rather than stated:
reading custody leaves the store byte-identical.

**No personal information reaches an audit record.** The row carries an employment identifier, and the
audit columns carry the acting principal. No name, no email, no national identifier — there is nowhere
to put one, asserted by name.

## 7. Immutability

**A returned custody refuses every update and delete, from any path** — `app_asset_custody_refuse_returned`,
proved against raw SQL through the admin connection, including a **soft delete**, which is an update.

**An open custody remains correctable**, because it is a period still in progress. That is the
conditional-trigger shape `relation_investigation` uses and the reason it is conditional.

**Checkpoint 1's tables gained no trigger and no column.** Its "no trigger on `asset` or
`asset_category`" assertion still passes, and a new assertion checks that no `current_employee_id`,
`current_custody_id`, `in_custody`, `is_issued` or `assigned_to` appeared on `asset`.

**No correction mechanism was built** (D-5.3-10). A returned custody is final, and the limitation is
stated rather than worked around.

## 8. Concurrency, proved against PostgreSQL

Two real connections contending, **no sleeps and no timing assumptions**, asserting the invariant
rather than which transaction wins.

| Race | Arbiter | Outcome |
|---|---|---|
| Two issues of one asset | `asset_custody_open_idx` | Exactly one custody; the loser names the index |
| Two returns of one custody | the `version` predicate in the update's `where` | Exactly one close; the row advances by exactly one version |
| An issue racing a retirement | the `for update` row lock on `asset` | Exactly one survivor, and never `retired` **and** held |

Two returned custodies accumulate freely on one asset — the index is partial for exactly that — and a
returned asset can be issued again.

## 9. Boundaries

| Boundary | State |
|---|---|
| Payroll | **untouched** — no port, no command, no amount, no numeric column but `version` |
| Workflow | **untouched** — no subject, no instance, no `ApprovalPort` |
| Documents | **untouched** — no reference, no adapter, **no `document_source` change** |
| Identity | **untouched** — no membership read |
| Platform | **untouched** — nothing scheduled, no `JobPort` |
| People | **untouched** — no person anywhere (AD-001) |
| Relations | **untouched** — its defect recorded, not fixed |
| Employment | **read only**, through its own published query. No production change |

## 10. Assertions replaced, and why none was weakened

Seven became stale because the approved capability genuinely changed the boundary. Each was replaced
with an exact statement of the new one.

| Assertion | Before | After |
|---|---|---|
| Custody absent | `assetCustody`, `asset_custody`, `custodyStore` forbidden | **Removed only because Checkpoint 2 was authorized to build them.** Replaced by an assertion pinning what custody *is* — two states, two commands — plus a still-exact ban on transfer, acknowledgement, acceptance, cancellation and correction |
| No employment named | `employmentId` forbidden | Now asserts it *is* named, and forbids `personId`, `employeeName`, `emailAddress`, `nationalId`, `userId` and `membershipId` — **stricter than the original**, which named none of those |
| No port to another module | `EmploymentDirectoryPort` forbidden | **Exactly one** port, named, every other still forbidden; plus a new assertion that it returns one boolean and never an `EmploymentView` |
| No clock | `Clock` forbidden | The clock is read; `setTimeout`, `setInterval`, `cron`, `schedule`, `JobPort`, `runAt` and `nextRun` still forbidden |
| Zero cross-module dependencies | composition took one argument | One adapter, one permission, one query — plus the permission reconciled against Employment's own export |
| RLS on "both tables" | expected two | Reconciles the protected set against `ASSETS_TABLES` **in both directions** |
| No custody route | `custody`, `return` forbidden in every path | An **exact set** of the twelve paths, plus a still-exact ban on `acknowledge`, `accept`, `incident`, `waiver`, `deduction`, `clearance`, `transfer`, `cancel`, `correct` and `condition` |

**The negative space is tighter after this checkpoint than before it**, and a new assertion was added
that Checkpoint 1 could not have made: no `expectedReturn`, `dueOn`, `overdue` or `reminder` anywhere —
the column that would lead to the Platform scheduling this checkpoint must not reach.

## 11. Decisions

| Decision | State after this checkpoint |
|---|---|
| **D-5.3-09** — retirement while in custody | **APPROVED and IMPLEMENTED.** Refused, race-safe, reversible |
| D-5.3-01 — custody after an employment ends | **OPEN**, untouched. No listener, no Platform job, no status read, no automatic closure. The absence of behaviour is **not** approval of option (a), and option (c) stays reachable additively |
| D-5.3-03 — the Payroll intake | **OPEN**, untouched |
| D-5.3-05 — the condition scale | **OPEN**, untouched. No condition column was created, and none added to prepare for one |
| D-5.3-07 — active versus existing employment | **OPEN.** `exists()` only, per the recommendation; the limitation is stated in §12 |
| D-5.3-08 — transfer authority | **OPEN.** Transfer is not built; a handover is recordable as return-then-issue |
| D-5.3-10 — correction and cancellation | **OPEN.** No correction mechanism exists |
| D-5.3-02 · 04 · 06 | **SETTLED**, none reopened, none applies here |

## 12. Stated limitations

1. **An asset can be issued to an employment that has ended.** The port answers existence, not
   standing — D-5.3-07 is open, and widening it would make an asset register into a workforce
   directory. Stated rather than guessed at.
2. **No direct transfer.** A handover is two records: a return and an issue. The history is true; it
   simply does not distinguish a *direct* handover, and the `closed_reason` column that would is absent
   in both directions (D-5.3-08).
3. **A returned custody is final.** No correction, no cancellation (D-5.3-10).
4. **No acknowledgement.** Recording an issue is not the employee's acknowledgement, and the module
   says so in both languages. Self-service remains `NOT VERIFIED` under ADR-0032.
5. **No expected-return date and no reminder.** Nothing computes overdue-ness, and no scheduler exists.
6. **UTC "today"**, inherited and unchanged. Near midnight far from UTC the server's day may differ
   from the tenant's by one.
7. **`employment_id` has no foreign key.** It crosses a module boundary; existence is confirmed
   through Employment's published read before the insert, and a deleted employment would leave a
   custody pointing at it. That is the established trade-off `relation_violation` already makes.

## 13. Verification

Every figure is from an actual run, and the gate's status is Turbo's own exit code — the command was
not piped into anything that could have replaced it.

| Gate | Result |
|---|---|
| `pnpm standards` | clean — **186** models, **19** catalogue sets, **1,881** source files, no cycles, no unused dependencies, no unreachable files |
| `pnpm format:check` | clean |
| `prisma validate` | valid |
| `prisma migrate status` | **31 migrations**, database up to date, **no drift** |
| `turbo run build lint typecheck test --force --concurrency=1` | **116 / 116 tasks successful · `TURBO_EXIT=0` · 12m 23s** |
| Tests | **4,804 passed, 0 failed, 0 skipped** |

`@work/assets` contributes **168 tests in 14 files** — 42 domain, 43 application, 22 negative space,
15 authorization, and **46 integration tests against real PostgreSQL**. `@work/api` contributes 18 more
in its two assets specs, inside its 824.

Also verified: no `.only`, no `any`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`, no
skipped test. The only `skipIf` is the fixture's database guard, which **refuses to skip in CI**.

**`as never` was removed rather than added.** §20 of the authorization forbids it; Checkpoint 1 had
inherited four occurrences from Relations' harness pattern. The unit-of-work stubs are now typed —
`UnitOfWork` has one method, so a real implementation costs a line — and the harness dispatch is typed
as `Command & Record<string, unknown>`, which is strictly better: a suite that forgets a `commandName`
now fails to compile instead of being cast past the type system.

The migration is purely additive: one table, its constraints, three indexes, one trigger and one
`app_protect_table`. Outside `packages/modules/assets`, `apps/api/src/assets`, `docs/` and `prisma/`,
the diff is **one file** — `apps/api/src/identity/identity.module.ts`, the shared composition root, one
line of registration. **No module's production code was modified.**
