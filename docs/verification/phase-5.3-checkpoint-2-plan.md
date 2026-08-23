# Phase 5.3 · Checkpoint 2 — Custody · Definition of Ready

*Prepared 2026-08-23 against `7aedf7a`, immediately after Checkpoint 1 was verified. **Planning only.**
No custody table, command, permission or route exists.*

*Decisions are recorded in [`phase-5.3-register.md`](./phase-5.3-register.md). Nothing here is
approved, and readiness is not authorization.*

---

## 1. Objective

Record **who holds which asset, since when, and what happened when it came back** — the phase's own
sentence, and the half of Assets that Checkpoint 1 deliberately left out.

Checkpoint 2 makes offboarding clearance *possible* by giving it something to read. It does not build
clearance, does not compute it, and does not consume it.

## 2. Current state — verified from the repository, not from the report

| Claim | How it was checked |
|---|---|
| Checkpoint 1 is implemented | `7aedf7a`; 36 source files under `packages/modules/assets/src`; working tree clean |
| Two tables exist | `create table asset_category`, `create table asset` in `20260823150000_assets_catalogue`; both `app_protect_table` |
| Five commands, three queries | `define-category`, `amend-category`, `register-asset`, `amend-asset`, `change-asset-status`; `categories`, `read-asset`, `search-assets` — grepped from source, not from the report |
| Four permissions | `assets.category.read/manage`, `assets.asset.read/manage` |
| Four asset statuses, closed at the database | `asset_status_check` in the migration; `issued`, `in_custody`, `returned` absent |
| Zero cross-module dependencies | `assets-dependencies.ts` declares `unitOfWork` and `stores` only |
| Uniqueness by partial unique index | `asset_tag_idx`, `asset_serial_idx`, `asset_category_code_idx` |

**Nothing in Checkpoint 1 is reopened by this plan.** One piece of its *prose* is corrected in §5.

## 3. Repository evidence

Everything Checkpoint 2 needs already exists in this repository. Five findings settle most of the
design without an owner decision, and one is a defect.

### 3.1 The "immutable once closed" record — `relation_investigation`

```sql
create or replace function app_relation_investigation_refuse_concluded() returns trigger
language plpgsql as $$
begin
  if old.state = 'concluded' then
    raise exception 'relation_investigation_concluded' …
```
— `20260823060000_relations_investigations`, line 191

A row that is **editable while open and frozen the moment it closes**, enforced by a *conditional*
trigger. This is exactly custody's shape: an open custody is a fact still in progress; a closed one is
the historical record AD-003 requires to be immutable.

### 3.2 The "one open per subject" invariant — `relation_investigation_open_idx`

```sql
create unique index relation_investigation_open_idx
  on relation_investigation (tenant_id, violation_id)
  where state = 'open' and deleted_at is null;
```

AD-004 — *"an asset is in the custody of at most one employment at any instant"* — is the same shape
with `asset_id` in place of `violation_id`. **Partial**, so any number of closed custodies accumulate.

### 3.3 The repository has *two* history patterns, and they are chosen for different reasons

| Pattern | Where | Why |
|---|---|---|
| Current row with a mutable `state`, **plus** an append-only event log | `leave_request` + `leave_request_event`, `onboarding_task` + `onboarding_task_event`, `recruitment_application` + `…_event` | The subject persists and moves through states; the log carries the narrative |
| **No state column at all**, state derived from an append-only log | `relation_violation` + `relation_case_event` (D-5.2-15/16) | The subject row is *fully* immutable, so it physically cannot move |

Custody is neither. A custody **period** is a record with a beginning and an end: one row *is* one
handover. §7 draws the conclusion.

### 3.4 Read auditing exists in exactly two places, and both are genuinely sensitive

`document_access_event` and `relation_violation_access_event` — and nothing else in 30 migrations.
Attendance records when people arrived and left, Career records acknowledgements about named people,
Leave records absences; **none audits reads.** §11 draws the conclusion.

### 3.5 Acknowledgement has a shipped mechanism, and it needs no permission of its own

`career.acknowledge-development-plan` rides on `career.development.manage`; the columns are
`employee_acknowledged_on` / `employee_acknowledgement_recorded_by` (D-5.3-02, settled).

### 3.6 **A defect in Relations that Checkpoint 2 must not copy**

`GrantAwarePermissionChecker` matches a grant by **exact string**:

```ts
if (grant === undefined || !grant.permits.includes(permission)) return false;
```
— `packages/kernel/src/tenancy/service-context.ts`, line 114

`employment.read-employment` declares `EmploymentPermissions.employmentRead`, whose value is
**`employment.employment.read`**. Seven adapters name that string correctly — Career, Documents,
Learning, Letters, Payroll, Performance. **Relations names `'employment.read'`**
(`apps/api/src/relations/relations-sources.ts:9`), and **no handler anywhere declares that string** —
verified by grepping the whole repository.

So `RelationsEmploymentDirectory.exists()` cannot succeed through its grant. It returns `true` only
when the *calling user personally* holds `employment.employment.read`, because the delegate check runs
first. A relations officer who holds only `relations.violation.record` has every
`relations.record-violation` refused as `employment_unknown`.

**This is a shipped Relations defect, outside this checkpoint's authorized scope.** It is recorded
here because Checkpoint 2 is about to use the identical pattern, and because a one-line constant is
exactly the kind of thing a second module copies. §19 and §23 carry the consequences: Assets must name
`employment.employment.read`, and must **reconcile the string against Employment's own declaration in a
test** rather than hard-coding it twice.

## 4. Business scope

**In:** opening a custody (issuing an asset to an employment), closing it (recording its return), and
reading both the current holder and the full history — per asset and per employment.

**Out, and each for a stated reason:** §24.

## 5. Custody definition — and one correction to Checkpoint 1's prose

A **custody** is a period: one asset, one employment, a start, and — once it ends — an end. One row is
one handover, which is precisely what AD-003 asks for: *"every handover, return and transfer is a new
record."*

### The correction

Checkpoint 1's verification report glossed `available` as *"in service and not held by anybody."*
**The second half of that gloss was written before custody existed and is wrong.**

Checkpoint 1 settled — and this plan does not reopen — that `issued`, `in_custody` and `returned` are
**not** persisted statuses. It follows that `asset.status` cannot express whether an item is held: an
asset in somebody's custody stays `available`, and *"is it held"* is answered by the custody table.

So `available` means **in service**, and nothing more. The persisted vocabulary, the CHECK constraint,
the transition table and the derived/persisted split are all unchanged — only the English is corrected.
Checkpoint 2's report must restate it, and the custody view is where "held" is answered.

## 6. Identity boundary

**Custody references Employment, never People (AD-001), and never a workforce user or an Identity
membership.**

| | |
|---|---|
| Column | `asset_custody.employment_id uuid not null` |
| Ownership | Employment owns the employment; Assets owns only the reference |
| Foreign key | **None.** A cross-module FK would couple two schemas that are meant to separate — the rule `relation_violation.employment_id` already follows |
| How existence is confirmed | Employment's **already published** `employment.read-employment`, under a bounded service grant (ADR-0043) |
| New cross-module contract | **No.** Employment publishes the read today and is not modified |
| What Assets learns | **One boolean.** Not a name, not a status, not a manager, not a grade |

**No employee name, email, national identifier or user account is copied into Assets.** A screen that
wants a name asks People or Employment for it.

This is the `RelationsEmploymentDirectory` template — with §3.6's constant corrected.

### The one honest change from Checkpoint 1

Checkpoint 1 had **zero** cross-module dependencies. Checkpoint 2 has **one**, and it consumes an
existing published read rather than creating a contract. The composition suite's "takes the unit of
work and nothing else" assertion becomes stale and must be **replaced with an exact statement of the
new boundary** — one adapter, one permission, one boolean — not deleted.

## 7. Custody model — one table, and why not two

**One table: `asset_custody`.** A row is a custody period. Open rows are editable; closed rows are
frozen by a conditional trigger (§3.1). The current holder is the open row (§8).

Rejected, with reasons:

| Rejected | Why |
|---|---|
| **Pure append-only event log**, current custody derived | **AD-004 could not be enforced at the database.** "The latest event for this asset is an issue" is not indexable, so one-custodian-at-a-time would become a read-then-insert — precisely what ADR-0071 forbids. This is decisive, not a preference |
| **A period table *plus* an `asset_custody_event` log** | The period row already carries the whole narrative of one custody, and successive rows carry the sequence. A second table would be a second answer to "what happened". `relation_case_event` exists only because `relation_violation` is *fully* immutable and cannot move — custody has no such constraint |
| **A `current_custody` table plus an archive** | Two tables holding the same fact at different times; the move between them is a write nobody audits |
| **Generic event store / workflow engine / lifecycle framework** | Explicitly out (§19), and none exists in this repository to reuse |

## 8. The current custodian — derived, never copied

**The current custodian of an asset is the open `asset_custody` row.** There is exactly one, or none,
and the partial unique index is what makes that true.

**No `asset.current_employee_id`, no `asset.in_custody`, no `asset.assigned`, no
`asset.current_custody_id`.** Each would be a second answer that goes stale the moment a custody row is
written — ADR-0070's stored flag, and the same reasoning that kept `issued` out of `asset.status` in
Checkpoint 1. The history model provides the current holder in one indexed read, so the denormalization
has nothing to justify it.

## 9. Lifecycle

Two operations. The others are excluded, each for a stated reason.

### `assets.issue-custody`

| Question | Answer |
|---|---|
| Who | `assets.custody.assign` |
| What changes | One new `asset_custody` row, `state = 'open'` |
| Previous record immutable | N/A — nothing precedes it |
| New record | Yes |
| Current custody after | The new row |
| Asset already in custody | **Refused** `asset_already_in_custody` (conflict); the index settles the race |
| Asset not available | **Refused** — custody may open only from `available`; `registered`, `under_repair` and `retired` are refused by name |
| Race | Two issues of one asset → `asset_custody_open_idx` |
| Database invariant | `unique (tenant_id, asset_id) where state = 'open' and deleted_at is null` |

### `assets.return-custody`

| Question | Answer |
|---|---|
| Who | `assets.custody.return` — **a separate grant from assign**, see §10 |
| What changes | The open row closes: `state = 'closed'`, `returned_on` set |
| Previous record immutable | It becomes immutable at that instant, by trigger |
| New record | No — a custody period ends where it began |
| Current custody after | None; the asset is holdable again |
| Not in custody | **Refused** `custody_not_open` |
| Race | Two returns → the `version` predicate in the update's `where`; the loser meets a stale version, and if it retries, the closed-row trigger |
| Database invariant | The conditional trigger plus `check ((state = 'closed') = (returned_on is not null))` |

### Excluded, and why

| Operation | Why not in Checkpoint 2 |
|---|---|
| **transfer** | Its authority is a genuine owner choice — **D-5.3-08**. The kernel's `CommandHandler.permission` is a *single* string, so a transfer cannot require both `assign` and `return`; whether it rides on `assign` or earns a grant of its own is not settled by precedent. Until then a handover is recordable as **return then issue** — two true records, no history lost; only the fact that it was *direct* is not distinguished |
| **accept / acknowledge** | The *mechanism* is settled (D-5.3-02) but nothing in custody depends on it, and its `acknowledgement_required` flag belongs to `asset_category`, which Checkpoint 1 deliberately left without one. §8 of the Checkpoint 1 plan's reasoning applies unchanged: configuration nothing reads is worse than none. Separable and additive |
| **cancel** | A custody opened in error is a *correction*, not a lifecycle state — **D-5.3-10** |
| **correct** | Both repository precedents are substantial mechanisms, not details: Attendance has a whole `attendance_correction_request` table with its own state machine, and D-5.2-19 uses a backward reference on a new record with its own unique index. Inventing custody's semantics now — does a cancelled custody count for clearance? — would answer a question nobody asked. **D-5.3-10** |

## 10. Acknowledgement

**Not in Checkpoint 2.** §9 states why.

When it arrives it reuses Career's semantics exactly and adds nothing new: a `party` naming *whose*
acknowledgement is recorded, `recorded_by` taken from the authenticated context and never from the
command, columns named so no screen can present it as a signature, and **self-service left
`NOT VERIFIED`** — ADR-0032 still resolves a principal to a tenant membership rather than an
employment, and that has not changed.

Career's acknowledgement rides on `career.development.manage` and has no permission of its own (§3.5),
so acknowledgement will not need one here either.

**Custody assignment is not employee acknowledgement**, and Checkpoint 2 must not present it as one:
an issued custody records that an administrator issued something, and nothing more.

## 11. Approval

**Not in Checkpoint 2, and no `ApprovalPort`.**

D-5.3-06 settled that Assets records its own named-human decisions in `ApprovalPort`'s shape rather
than consuming the port — the position seven modules already hold. But the prior question is whether
custody needs approval at all, and **it does not**: issuing a laptop is an administrative act by an
authorized human, complete when it is recorded.

**Workflow requires no modification and is not touched.** Approval, if it is ever wanted, belongs to
the waiver in Checkpoint 3, where AD-006 actually asks for one.

## 12. Permissions

Three, and no fourth:

```
assets.custody.read · assets.custody.assign · assets.custody.return
```

**`assets.asset.manage` is deliberately *not* reused.** Maintaining an inventory and issuing company
property to a named person are different authorities: the first is about things, the second creates an
obligation for somebody.

**`assign` and `return` are separate, and the asymmetry is the point.** A false *return* is the more
dangerous direction — it makes an outstanding laptop disappear from the register that offboarding
clearance will read. Relations separated `investigation.conduct` from `violation.record`, and
`action.issue` again, on exactly this reasoning.

**`assets.custody.read` is separate from `assets.asset.read`**, and this is why the custody view is not
folded into `read-asset`: a custody row names an employment, and reading the inventory must not imply
reading who holds what.

No wildcard, no `assets.admin`, no permission for transfer, acknowledgement, correction, waiver,
incident or deduction — none of those is in this checkpoint.

## 13. Audit

| | |
|---|---|
| **Mutation audit** | `created_by` / `updated_by` / `version` on `asset_custody`, written by `@work/persistence` from the execution context. Who issued a custody and who recorded its return are `created_by` and `updated_by` |
| **Access audit** | **None**, and no access-trail table |
| **Acknowledgement audit** | N/A — deferred with acknowledgement |
| **History visibility** | The full custody history of an asset, and of an employment, behind `assets.custody.read` |

The access-audit decision follows §3.4 rather than intuition. The only two audited-read domains in this
repository hold medical documents and disciplinary allegations. Attendance records when people arrive
and leave and audits no read; custody records who holds a laptop. Auditing it would be the "audit every
query" mechanism D-5.2-05 rejected, and it would need a table this checkpoint has no reason to build.

**No personal information reaches an audit record**: the rows carry an employment identifier, and the
audit columns carry the acting principal. No name, no email, no national identifier — there is nowhere
to put one.

## 14. Immutability

**A closed custody is immutable; an open one is not.**

Enforced by a conditional trigger in the shape of §3.1 — `refuse update or delete when
old.state = 'closed'` — so it holds against SQL nobody wrote in TypeScript. An open custody is a fact
still in progress and remains correctable.

**Checkpoint 1's immutability position is unchanged**: `asset` and `asset_category` stay mutable, and
this checkpoint adds no trigger to either. The Checkpoint 1 assertion that *no* trigger exists on those
two tables stays true and must keep passing.

**No correction mechanism is built** (D-5.3-10). Until one is approved, a closed custody is final, and
that limitation is stated rather than worked around.

## 15. Concurrency

Every race is settled by PostgreSQL. No in-memory lock, no application timing, **no sleeps**, and no
check-then-insert without a database invariant (ADR-0071).

| Race | Arbiter | Assertion |
|---|---|---|
| **Double issue** — two users issue one available asset | `asset_custody_open_idx` | Exactly one row survives; the loser names the index |
| **Double return** — two users return one custody | the `version` predicate in the update's `where`, then the closed-row trigger | Exactly one close lands; the row's version advances by exactly one |
| **Issue racing a return** | the same index — the new open row cannot exist while the old one is open | Exactly one valid outcome |
| **Transfer race** | not applicable — transfer is excluded |
| **Acknowledgement race** | not applicable — acknowledgement is excluded |

Proved with **two real connections contending**, asserting the invariant rather than which transaction
wins — the Checkpoint 1 suite's own discipline.

## 16. Tenancy and RLS

| | |
|---|---|
| Tenant ownership | `asset_custody.tenant_id`, on every row |
| RLS | Enabled **and forced** — `call app_protect_table('asset_custody')` (ADR-0030) |
| Policy | The shared one the procedure installs; no bespoke policy |
| Tenant source | The execution context. **No command, query, DTO or route accepts a tenant** |
| Cross-tenant behaviour | Another tenant's custody reads as absent; `not_found`, never `forbidden` |

No `BYPASSRLS`, no service-level tenant bypass, no wildcard tenant access. Proved as an unprivileged
role holding neither `BYPASSRLS` nor `SUPERUSER`, in **both directions**, with the neighbour's row
confirmed to exist through the admin connection.

## 17. Schema

**One table. One migration. Nothing existing altered.**

### `asset_custody` — the custody period

*Purpose:* to record that one employment held one asset from one day until another. It is the only
table this checkpoint adds, and every column below is read by Checkpoint 2 itself.

```
id                 uuid primary key default app_uuid_v7()
tenant_id          uuid not null
asset_id           uuid not null
employment_id      uuid not null      -- Employment, never person (AD-001). No cross-module FK.
issued_on          date not null      -- a day in the tenant's world, not an instant
returned_on        date               -- null while open
state              varchar(16) not null   -- 'open' | 'closed'
issue_note         varchar(500)
return_note        varchar(500)
metadata           jsonb not null default '{}'
created_at/by, updated_at/by, deleted_at/by, version
```

| Constraint | Shape |
|---|---|
| `asset_custody_asset_fk` | `asset_id references asset (id)` — same module, so a real FK |
| `asset_custody_state_check` | `state in ('open', 'closed')` |
| `asset_custody_closure_check` | `(state = 'closed') = (returned_on is not null)` — a closed custody has a return date and an open one has none, or it is neither |
| `asset_custody_dates_check` | `returned_on is null or returned_on >= issued_on` |

| Index | Purpose |
|---|---|
| `asset_custody_open_idx` **unique** `(tenant_id, asset_id) where state = 'open' and deleted_at is null` | **AD-004.** Partial, so closed custodies accumulate freely |
| `asset_custody_asset_idx` `(tenant_id, asset_id, issued_on) where deleted_at is null` | An asset's history, newest first |
| `asset_custody_employment_idx` `(tenant_id, employment_id, issued_on) where deleted_at is null` | What one employment holds — the read Checkpoint 4 will need |

*Immutability:* `app_asset_custody_refuse_closed`, a conditional trigger refusing update and delete
when `old.state = 'closed'`.
*RLS:* `call app_protect_table('asset_custody')`.
*Audit:* the standard columns; no access trail.
*Correction:* none — D-5.3-10.
*Concurrency invariant:* the partial unique index above.

### Columns deliberately **not** created

| Absent | Why |
|---|---|
| `expected_return_on` | Nothing in this checkpoint computes overdue-ness, and no scheduler exists. It is the column that invites the automatic reminders §19 prohibits — it arrives with a capability that reads it |
| `condition_at_issue`, `condition_at_return` | **D-5.3-05 is OPEN.** Creating them would answer it by accident |
| `acknowledged_on`, `acknowledgement_recorded_by` | Deferred with acknowledgement (§10) |
| `closed_reason` | Only transfer and cancellation would need values, and both are excluded |
| any amount, valuation or deduction column | Non-goals of the phase. There is no numeric column but `version` |
| `document_id`, evidence | D-5.3-04 settled the mechanism; nothing here reads one |
| `person_id`, employee name, email, user account | AD-001, and §6 |

### The one helper that must come back

Checkpoint 1's `row-writer.ts` deliberately omitted `civilDateColumn` because neither table held a
date. `asset_custody` holds two, so it returns — and **every select of this table must project them
with `to_char(…, 'YYYY-MM-DD')`**, which is the Phase 5.2 Checkpoint 3 defect and the reason Checkpoint 1
named its columns in the first place.

## 18. Commands, queries and API

### Commands

| | `assets.issue-custody` | `assets.return-custody` |
|---|---|---|
| Request | `assetId`, `employmentId`, `issuedOn`, `issueNote?` | `custodyId`, `expectedVersion`, `returnedOn`, `returnNote?` |
| Server-derived | `custodyId` (uuidV7), `state`, tenant, `created_by` | `state`, tenant, `updated_by` |
| Authenticated actor | From the execution context. **Never from the command** | The same |
| Permission | `assets.custody.assign` | `assets.custody.return` |
| Transaction | One unit of work: read asset → read employment existence → insert | One unit of work: read custody → update |
| Idempotency | **None claimed.** A repeated issue meets the index and is refused; it is not silently converged | The `expectedVersion` makes a repeat a refusal, not a second close |
| Concurrency | `asset_custody_open_idx` | version predicate, then the trigger |
| Errors | `not_found` asset · `not_found` employment · conflict `asset_already_in_custody` · conflict `asset_not_available` · rejected malformed/future date | `not_found` custody · conflict `custody_not_open` · rejected `returned_before_issued` / future date |

Both dates are **civil dates the caller supplies for a past or present day**; a future date is refused
against the server's own clock, because a caller who could date a handover forward could pre-date a
return. *(Checkpoint 1 needed no clock; Checkpoint 2 does — the same `systemClock` every module uses.)*

### Queries

| | `assets.asset-custody` | `assets.employment-custody` |
|---|---|---|
| Request | `assetId`, page, pageSize | `employmentId`, `openOnly?`, page, pageSize |
| Response | current custody (or absent) + the asset's history | the custodies of one employment |
| Pagination | Yes — default 50, maximum 200, as Checkpoint 1 | The same |
| Permission | `assets.custody.read` | `assets.custody.read` |
| Tenant boundary | Context only; another tenant's identifier answers as absent | The same |
| Audit | None (§13) | None |

**There is no tenant-wide custody listing.** Every collection read takes an asset or an employment —
the bound Relations applied to violations, for the same reason: a query returning every custody in a
tenant is a report nobody approved.

`read-asset` is **not** extended with the current holder: that would put an employment identifier
behind `assets.asset.read` and defeat §12.

### API

```
POST /v1/assets/:assetId/custody           issue
POST /v1/assets/custody/:custodyId/return  return
GET  /v1/assets/:assetId/custody           an asset's current custody and history
GET  /v1/assets/custody                    ?employmentId=…  what an employment holds
```

No `PUT`, `PATCH` or `DELETE`. `assets/custody` is a literal prefix and must be declared **before**
`:assetId` routes, or Nest resolves it as an asset identifier — the lesson Checkpoint 1's route test
already encodes.

## 19. Cross-module dependencies

**One, and it creates no contract.**

| | |
|---|---|
| Module | Employment |
| Existing published read | `employment.read-employment` |
| Permission the grant permits | **`employment.employment.read`** — the exact string the handler declares, reconciled by test against `EmploymentPermissions.employmentRead` rather than typed twice (§3.6) |
| What Assets learns | one boolean |
| Employment change | **none** |

Verified as *not* required: **Identity** (no membership is named; the actor is the authenticated
principal), **Career** (no acknowledgement), **Workflow** (no approval), **Payroll** (no deduction),
**Documents** (no evidence), **People** (AD-001), **Platform** (nothing scheduled).

## 20. Negative space

Asserted, not promised. Checkpoint 2 must not reach into:

Payroll deduction · Workflow approval · termination integration or any employment-ended listener ·
employee self-service · Platform scheduling · automatic reminders · country-specific legal rules ·
document storage · evidence attachments · a generic asset workflow · depreciation · accounting ·
valuation · liability · insurance · disciplinary action · grievance · a generic approval framework ·
a generic event store · a generic lifecycle framework.

Also asserted absent, because they are the ones this checkpoint could reach by accident: any persisted
`in_custody` / `issued` / `returned` status, any `current_employee_id` on `asset`, any person reference,
any amount, any second copy of the current custodian.

**If one becomes genuinely required, it is recorded as a dependency and stops the work — it is not
implemented silently.**

## 21. Tests

Domain rules in isolation · application behaviour through the **real dispatcher and real handlers** ·
**real PostgreSQL** for RLS in both directions, the partial unique index under two contending
connections, the closed-row trigger against raw SQL, and the closure CHECK · negative-space assertions
for every boundary above.

Specifically required, because each is a property rather than a path:

* An asset in custody is still `available` — §5's correction, asserted.
* Issuing from `registered`, `under_repair` or `retired` is refused **by name**.
* A returned asset can be issued again; a second open custody cannot exist.
* The grant's permitted string **equals** `EmploymentPermissions.employmentRead`, reconciled from
  Employment's own export — the assertion §3.6's defect would have failed.
* Checkpoint 1's "no trigger on `asset` or `asset_category`" assertion still passes.
* Checkpoint 1's "zero cross-module dependencies" assertion is **replaced** with an exact statement of
  the new boundary — one adapter, one permission, one boolean — never deleted.

## 22. Migration

**One additive migration**: `create table asset_custody`, its constraints and three indexes, one
trigger function and trigger, one `app_protect_table`. Plus the Prisma model and the back-relation on
`Asset` — the addition Phase 5.2 Checkpoint 4 had to make after the fact.

**No existing table, column, constraint, index, trigger or migration is modified.** Timestamps stay
strictly ordered. `prisma validate` and `prisma migrate status` must both be clean with no drift.

## 23. Risks

| Risk | Mitigation |
|---|---|
| **Copying Relations' broken grant constant** (§3.6) | The permitted string is reconciled against Employment's own export in a test, not typed twice |
| Pressure to add `expected_return_on` "while the table is open" | Excluded in §17 with a named reason; it is the column that leads to reminders |
| Pressure to add `condition_at_issue` | D-5.3-05 is OPEN; adding it answers the decision by accident |
| Pressure to persist the current custodian on `asset` for a faster read | §8; the indexed open-row read is one lookup |
| The `available` gloss confusing a reviewer into thinking custody should move the status | §5 states the correction; a test asserts the behaviour |
| Transfer arriving as "just an issue with a different note" | Excluded with a named decision (D-5.3-08); the closure-reason column that would carry it is absent |
| Rollback | The migration creates only new objects; reverting the commit and dropping one table is complete |

## 24. Deferred capabilities

Transfer (D-5.3-08) · acknowledgement and acceptance · cancellation and correction (D-5.3-10) ·
condition at issue and return (D-5.3-05) · expected-return dates and any reminder · incidents, loss,
damage and liability (Checkpoint 3) · waivers and approval · the clearance projection (Checkpoint 4) ·
deduction and any Payroll seam (D-5.3-03) · behaviour when an employment ends (D-5.3-01) · document
references (D-5.3-04) · self-service acknowledgement (`NOT VERIFIED`, ADR-0032).

## 25. Decisions

| # | Decision | State | Blocks Checkpoint 2? |
|---|---|---|---|
| D-5.3-01 | Custody when an employment ends | **OPEN** | **No** — see below |
| D-5.3-03 | The Payroll intake | **OPEN** | No — nothing is deducted |
| D-5.3-05 | The condition scale | **OPEN** | **No**, on one condition: Checkpoint 2 creates no condition column |
| D-5.3-02 · 04 · 06 | Acknowledgement · document references · approvals | **SETTLED** | No — none applies here |
| **D-5.3-07** | Whether issuing requires an *active* employment or merely an existing one | **OPEN — new** | No — `exists()` alone is the precedent and the recommendation |
| **D-5.3-08** | Whether direct transfer is its own authority | **OPEN — new** | **Blocks transfer only**, which is therefore excluded |
| **D-5.3-09** | Whether an asset in open custody may be retired | **OPEN — new** | **A behaviour Checkpoint 2 must choose.** Recommendation: refuse — the reversible direction |
| **D-5.3-10** | Whether custody may be cancelled or corrected, and with what semantics | **OPEN — new** | No — deferred entirely |

### D-5.3-01 can be deferred, and this is not a silent approval

Checkpoint 2 implements **no termination behaviour**: no employment-ended listener, no Platform job, no
read of employment status, no `outstanding` closure. An employment that ends simply leaves its custody
open, because nothing is watching.

That *resembles* option (a), and the distinction matters: it is the **absence of behaviour**, not a
choice of it. Option (c) — closing custody with an outstanding marker — stays reachable **additively**,
because the closure vocabulary is a CHECK that widens by approved change and the `closed_reason` column
it would need does not exist yet in either direction. **Neither option is foreclosed**, and the owner's
decision costs a migration whichever way it goes.

## 26. Definition of Ready checklist

| # | Item | State |
|---|---|---|
| 1 | Checkpoint 1 verified from the repository, not the report | ✅ §2 |
| 2 | Checkpoint 1 decisions preserved; statuses unchanged | ✅ §5, §14 |
| 3 | Custody model chosen from precedent, alternatives rejected with reasons | ✅ §7 |
| 4 | Current custodian derived, not copied | ✅ §8 |
| 5 | Identity boundary is Employment, with no new contract | ✅ §6, §19 |
| 6 | Lifecycle minimal; every excluded operation has a named reason | ✅ §9 |
| 7 | Acknowledgement and approval evaluated and excluded on evidence | ✅ §10, §11 |
| 8 | Permissions minimal, separated on risk, no wildcard | ✅ §12 |
| 9 | Audit decided from precedent, no new framework | ✅ §13 |
| 10 | Immutability conditional, Checkpoint 1's unchanged | ✅ §14 |
| 11 | Every race has a database arbiter | ✅ §15 |
| 12 | RLS enabled and forced, both directions, unprivileged role | ✅ §16 |
| 13 | One table, every column justified, speculative ones rejected by name | ✅ §17 |
| 14 | Commands and queries fully specified | ✅ §18 |
| 15 | Cross-module dependency minimal and reconciled by test | ✅ §19, §23 |
| 16 | Negative space explicit | ✅ §20 |
| 17 | Migration additive; nothing existing modified | ✅ §22 |
| 18 | New decisions recorded, none inferred or approved | ✅ §25 |
| 19 | A shipped defect found and reported rather than copied | ✅ §3.6 |
| 20 | **Owner authorization to implement** | ⏳ **Pending** |

## Authorization boundary

**This document is a statement of readiness. It is not permission to implement.**

Checkpoint 2 is blocked by no decision — D-5.3-09 is a behaviour the owner should confirm at
authorization, and its recommendation is the reversible one. Nothing in
`packages/modules/assets`, `apps/api/src/assets`, `prisma/schema.prisma` or `prisma/migrations` should
change until the owner authorizes this checkpoint explicitly.
