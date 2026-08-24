# Phase 5.3 — Checkpoint 4 · Offboarding Clearance Projection · Implemented

**Branch** `claude/phase-5-employment-workforce-xaxasu` · **Base** `e33f436` · **Date** 2026-08-24
**Plan** [`phase-5.3-checkpoint-4-plan.md`](./phase-5.3-checkpoint-4-plan.md)

---

## 1. What was built

What Assets contributes to an offboarding clearance (AD-006), derived on every read.

| | |
|---|---|
| Tables added | **none** |
| Columns added | **none** |
| Migrations added | **none** — 31 before, 31 after, zero files changed under `prisma/` |
| Permissions added | **none** — seven before, seven after |
| Commands added | **none** — the command set has not moved since Checkpoint 2 |
| Queries added | one — `assets.employment-clearance` |
| Cross-module contracts created or changed | **none** |

```
GET /api/v1/assets/custody/clearance?employmentId=…&asAt=…
```

```
{ employmentId, asAt, assetsClear, outstandingCount, blockers: [
    { assetCustodyId, assetId, assetTag, assetCategoryId, issuedOn, daysOutstanding? } ] }
```

---

## 2. D-5.3-01 — approved, and implemented as approved

The owner approved **option (a)**:

> *An employment ending does not automatically close, cancel, transfer, or alter an open asset custody
> period. The custody remains an `open` period until an authorized human explicitly returns the asset.*

So the Assets-side truth is two lines, and no business rule was invented to reach them:

```
open custody      →  outstanding
returned custody  →  not outstanding
```

**No reinterpretation was made.** Employment termination closes nothing; Assets subscribes to nothing;
no termination event is received; nothing is automatically returned or transferred; no `outstanding`
state was persisted; no new custody state exists. `CUSTODY_STATES` is still exactly `open · returned`,
asserted against the migration SQL.

**The consequence stays explicit and is intentional.** An employee who leaves holding an asset leaves an
open custody, which keeps their clearance blocked and the asset unavailable until somebody resolves the
physical item. A test proves this at its strongest form: an employment the directory no longer
recognises at all still blocks, and its custody row is untouched.

---

## 3. D-5.3-11 — preserved, not reopened

Assets does not subscribe to Employment. Checkpoint 4 works **entirely from persisted Assets data**:
no `EventHandler`, no listener, no consumer, no outbox, no broker, no scheduler, no Platform job.

This is asserted in three places rather than asserted once and trusted: the composition root registers
zero event handlers and its source contains none of `EventHandler`, `eventHandlers`, `subscribe` or
`onEmploymentEnded`; the module scan forbids the same; and the clearance read is proved **never to call
the Employment directory at all** — an answer that cannot depend on employment status cannot change
when it changes.

---

## 4. Cross-module boundary

| Question | Finding |
|---|---|
| Is there an `offboarding` module? | **No.** Nineteen modules; offboarding is not among them. |
| Who owns clearance? | **Offboarding, Phase 11.2** (`DOMAIN_OWNERSHIP.md`). |
| Does Employment own it? | **No, explicitly** — *"deliberately not offboarding: no exit interview, no clearance, no asset return, no final settlement"* (`lifecycle.use-case.ts:103`). |
| Existing clearance contract to conform to? | **None.** |
| How will the consumer reach it? | **By pulling** — ADR-0050, ADR-0053, ADR-0058. |

**No cross-module contract was created or changed, so no owner decision was required for one.** Assets
publishes on its own contract and Offboarding will pull it. Employment, Payroll, Workflow, Platform,
Identity, Documents and Relations are untouched.

### `assetsClear`, not `clear`

Assets does not decide whether a person is cleared — Offboarding will, across domains this module knows
nothing about: accounts, finance, keys. A field called `clear` on an Assets contract would be read as
the whole answer and would be wrong the first time anything outside Assets blocked an exit.
`assetsClear` states only what this module knows, and keeps the response what it should be: **facts,
not workflow state invented by Assets**. A test asserts the response has no `clear` property.

---

## 5. The correctness property that governs the shape

**`assetsClear` follows `outstandingCount`, never `blockers.length`.**

The count is read from `asset_custody` alone — the authoritative custody fact. The blocker list is a
join onto `asset` to name each item, and is bounded at 200.

That separation fails safe in every direction: if the bound truncates, or if the join ever dropped a
row, `outstandingCount` still exceeds the list and clearance stays **blocked**. A truncated list can
never turn a blocked employment into a clear one, and the truncation is visible to the caller rather
than silent. Proved at 0, 1, 199, 200, 201 and 250 outstanding items.

`assetTag` is published because a blocker that cannot name the physical item is not actionable. The read
is bounded to one employment's open custodies, so it cannot enumerate an inventory — the distinction
`assets-permissions.ts` already draws. The response key set is pinned exactly, at both levels.

---

## 6. Security, RLS, concurrency

- **No new table**, so no new RLS surface. `asset_custody` and `asset` remain enabled **and forced**.
- Tenant isolation of the clearance read proved **in both directions** against real PostgreSQL as an
  **unprivileged role** (no `BYPASSRLS`, not superuser), using the *same employment identifier* holding
  an asset in each tenant — the strongest form, since a leak cannot be explained as a different subject.
  The join is exercised too, so a policy covering custody but not `asset` would surface here.
- **No tenant parameter, no actor, no synthetic actor, no wildcard permission.** Tenancy from execution
  context.
- **No new write path.** No lock, no claim, no reservation, no persisted flag, nothing race-sensitive.
  Checkpoint 2's invariants are re-proved rather than duplicated: one open custody per asset, returned
  custody immutable, concurrent issue and concurrent return race-safe against real connections, no
  sleeps, asserting the resulting invariant rather than which connection won.
- The read **modifies nothing** — asserted by snapshotting custody and asset rows across two reads.

---

## 7. Tests

| Suite | Tests |
|---|---|
| `clearance.test.ts` *(new)* | 15 — clear/blocked, multiple blockers, returned does not block, another employment does not block, return is the only thing that clears, Employment never consulted, an unrecognised employment still blocks, the read changes nothing, the bound at six sizes, exact key sets, no tenant/actor/note/status, malformed date refused, permission boundary, no clearance permission minted |
| `assets-reporting-boundaries.test.ts` | +3 — no persisted clearance state or employment-ended concept, no authority over the decision, nothing automatic |
| `assets-isolation.integration.test.ts` | +2 — clearance tenant isolation both directions, and an employment holding nothing |
| **`@work/assets`** | **224** across 18 files |
| **`@work/api` assets specs** | **21** across 2 files |

### Stale assertions reconciled — six, none deleted

| Assertion | Reconciliation |
|---|---|
| `'clearance'` in the module exclusion list | Removed; **`ClearanceItem` kept**. Checkpoint 4 publishes what Assets *contributes*; it does not define the entity Offboarding will own. Replaced by three new assertions stating what clearance is allowed to be. |
| `'clearance'` in the forbidden-route list | Removed; **`waiver` kept**. AD-006 has two halves — clearance blocked by custody, *"unless explicitly waived"*. The first is built, the second is not, so the word for the unbuilt half stays forbidden. Paired with a positive assertion that the route is a bounded `GET`. |
| "six queries" | → seven, as the full set |
| "thirteen dispatched names" | → fourteen |
| "exactly the paths" | → plus `clearance`, plus an ordering assertion for both literal segments |
| composition "six queries" | → seven, with the permission count asserted **unchanged** at seven |

The migration scans are non-vacuous: they name `create table asset_custody` and the state CHECK first,
so a moved or renamed migration fails loudly rather than passing every absence trivially.

---

## 8. Negative space verified

No termination subscription · no automatic custody closure · no automatic return · no automatic
completion or inference of recovery · no `closed_reason` · no employment-ended state in Assets · no
persisted `outstanding` · no persisted clearance state · no clearance state machine · no scheduler or
Platform job · no Payroll or Workflow dependency · no synthetic actor · no tenant parameter · no
wildcard permission · **and no migration generated**.

---

## 9. Gates

```
pnpm standards        no violations · 186 models · 19 catalogues · 1,890 files, no cycles
pnpm format:check     clean
prisma validate       valid
prisma migrate status 31 migrations, up to date — no drift, none added
```

Full gate results in the final report, with Turbo's own exit code read directly and not piped through
`tail`, `grep`, `tee` or `echo`.

No lint suppression, no architecture exemption, no standards exception, no `any`, no `as never`, no
weakened test, and no unrelated module modified.

---

## 10. Files

20 files changed, +1,163 / −61. **Every file is inside `packages/modules/assets`,
`apps/api/src/assets` or `docs/` — zero files elsewhere.**

`asAtFrom` was extracted to `as-at.ts` so the three reads that publish an elapsed figure share one
definition of what a date may be, rather than growing a second that could disagree.

---

## 11. Phase 5.3 scope

**Implemented across Checkpoints 1–4:** the asset catalogue and inventory · the custody lifecycle,
with one-custodian enforced by a partial unique index and returned custody immutable at the database ·
custody ageing and outstanding reporting, derived · the offboarding clearance contribution, derived.

**Deferred and explicitly not built** — see §12 of the final report.
