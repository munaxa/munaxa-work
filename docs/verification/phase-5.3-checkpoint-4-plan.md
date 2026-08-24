# Phase 5.3 — Checkpoint 4 · Definition of Ready — Offboarding Clearance Projection

**Branch** `claude/phase-5-employment-workforce-xaxasu` · **Base** `e33f436` (Checkpoint 3, verified)
**Date** 2026-08-24

---

## 1. The decision that unblocked this checkpoint

**D-5.3-01 is APPROVED as option (a)**, in the owner's words:

> *An employment ending does not automatically close, cancel, transfer, or alter an open asset custody
> period. The custody remains an `open` period until an authorized human explicitly returns the asset.*

This is the decision the Checkpoint 3 report named as the sole blocker. It is recorded in the register
with the approval date and the wording above, and the prior recommendation text is preserved rather
than rewritten.

**What the approval does not authorize**, stated because each is a plausible misreading: employment
termination closing custody · Assets subscribing to Employment · Assets receiving termination events ·
automatic return · automatic transfer · a special `outstanding` state · any new persisted custody state.

**The consequence is intentional and stays explicit.** An employee who leaves holding an asset leaves an
open custody. That custody remains outstanding until somebody resolves the physical item, which may
block clearance for that employment and keeps the asset unavailable for another assignment. That is the
approved business rule working, not a defect.

---

## 2. D-5.3-11 is not reopened

Assets does not subscribe to Employment. Checkpoint 4 works **entirely from persisted Assets data**:
no `EventHandler`, no listener, no consumer, no outbox, no broker, no scheduler, no Platform job, no
automatic closure. The existing negative-space tests that assert this are kept and extended.

---

## 3. Investigation — who owns clearance

| Question | Finding |
|---|---|
| Is there an `offboarding` module? | **No.** `packages/modules/` holds nineteen modules; offboarding is not among them. |
| Who owns it? | **Phase 11.2**, per `DOMAIN_OWNERSHIP.md`: *"Offboarding case, clearance, settlement request → `offboarding` → Phase 11.2"*. |
| Does Employment own it? | **No, explicitly.** `lifecycle.use-case.ts:103` — *"It is deliberately not offboarding: no exit interview, no clearance, no asset return, no final settlement. Those belong to Offboarding (Phase 11.2), which will orchestrate the exit around it."* |
| Is there an existing clearance contract to conform to? | **No.** Nothing in the repository declares one. |
| How will the consumer reach it? | **By pulling.** `assets-module.ts:34` — *"Onboarding, Offboarding and Payroll will pull what they need when they need it."* Confirmed by ADR-0050, ADR-0053 and ADR-0058. |

**Conclusion.** Assets must publish the bounded fact it owns and must **not** own the clearance workflow.
There is no cross-module contract to change and none to create: the deliverable is a read on Assets'
own published contract, which the future Offboarding will pull. No owner decision is required for it.

---

## 4. Clearance semantics

Under approved D-5.3-01(a) the Assets-side truth is exactly two lines, and no rule is invented:

```
open custody      →  outstanding
returned custody  →  not outstanding
```

There is no employment-ended flag, no `closed_reason`, no persisted `outstanding`, and no second source
of truth. An open custody is outstanding **whether or not the employment has ended** — which is what
makes this read independent of Employment entirely.

### The naming decision, and why it matters

The response publishes **`assetsClear`**, not `clear`.

Assets does not decide whether a person is cleared. Offboarding will, across domains Assets knows
nothing about — IT accounts, finance, library, keys. A field called `clear` on an Assets contract would
be read by that future consumer as the whole answer, and it would be wrong the first time anything
outside Assets blocked an exit. `assetsClear` states what this module actually knows: *as far as company
assets are concerned, this employment has nothing outstanding.*

This also keeps the response what §14 of the authorization asks for — **facts, not workflow state
invented by Assets**. `assetsClear` is a fact about custody rows. `clear` would be a claim about a
process this module does not own.

---

## 5. Design

### 5.1 No table, no column, no migration

The existing `asset_custody` already represents the approved truth. Nothing is added: no `outstanding`,
no `clearance_status`, no `employment_ended`, no `closed_reason`, no `clearance_blocked`, no
`returned_reason`. There is therefore no new RLS surface, and **the migration count must stay at 31** —
verified explicitly rather than assumed.

### 5.2 No new permission

`assets.custody.read`. The projection is a read of custody rows and nothing else, so a permission named
for clearance would be a permission minted for a word rather than for an authority. Seven permissions
stay seven.

### 5.3 One query

`assets.employment-clearance { employmentId, asAt? }` → `AssetClearanceView`:

```
{
  employmentId,
  asAt,
  assetsClear: boolean,
  outstandingCount: number,
  blockers: [ { assetCustodyId, assetId, assetTag, assetCategoryId, issuedOn, daysOutstanding? } ]
}
```

`asAt` follows Checkpoint 3's semantics exactly — explicit, echoed, malformed values refused rather than
substituted, UTC midnights, future dates permitted. It affects **only** `daysOutstanding`; it does not
filter which custodies are outstanding, because outstanding-ness is the row's `state` and not a function
of a date.

### 5.4 The correctness property that governs the shape

**`assetsClear` is derived from `outstandingCount`, never from `blockers.length`.**

The count is read from `asset_custody` alone — the authoritative custody fact. The blocker list is a
join onto `asset` to name each item, and it is **bounded**, because an unbounded read is against this
module's conventions.

That combination fails safe in every direction: if the bound truncates, or if a join ever dropped a row,
`outstandingCount` still exceeds `blockers.length` and clearance stays **blocked**. A truncated list can
never turn a blocked employment into a clear one, and the truncation is visible to the caller rather
than silent. A test asserts `outstandingCount >= blockers.length` and that a truncated response is still
`assetsClear: false`.

### 5.5 Why `assetTag` is published, and why that is not an escalation

A blocker that cannot name the physical item is not actionable — "return asset `019a3f…`" is not
something a person can act on, and the whole purpose of the projection is to explain the block.

The read is bounded to **one employment's open custodies**, so it cannot enumerate the inventory. That is
the distinction `assets-permissions.ts` already draws: somebody who may read custody is not thereby
somebody who may *"enumerate every laptop in the company"*. Naming the two or three items one named
employment currently holds is not that enumeration. The exact key set of the response is pinned by a
test so nothing else follows the tag out.

### 5.6 The read modifies nothing

No write path, no lock, no claim, no reservation, no persisted flag. Nothing auto-completes: the system
never marks an employment cleared, never closes custody, never returns an asset, never resolves a
blocker and never infers recovery. A human resolves it through the existing `assets.return-custody`.

### 5.7 API

`GET /api/v1/assets/custody/clearance?employmentId=…&asAt=…`, declared on `CustodyController` after
`summary` and **before** `@Get()`, so the literal segment resolves before the collection read. No `PUT`,
`PATCH` or `DELETE`. No tenant, no actor, no caller-supplied clearance or blocker state.

---

## 6. Test plan

**Clearance:** no open custody → clear · one → blocked with one blocker · several → all reported ·
returned custody does not block · another employment's custody does not block · another tenant's does not
block (real PostgreSQL, unprivileged role, both directions).

**Approved D-5.3-01(a):** an open custody is outstanding **regardless of the employment's status**;
Employment is never consulted; no subscription exists; nothing closes automatically; the return command
is the only thing that clears a blocker, and it works exactly as before.

**Correctness of the bound:** `outstandingCount >= blockers.length`; a truncated list stays blocked.

**Security:** authorized read succeeds · unauthorized behaves as the established Assets pattern · no
cross-tenant row appears · the response key set is exact.

**Existing invariants re-proved:** one open custody per asset, returned custody immutable, concurrent
issue and concurrent return race-safe — against real PostgreSQL, no sleeps, asserting the resulting
invariant rather than which connection won.

---

## 7. Negative space to extend

No termination subscription · no automatic closure · no automatic return · no `closed_reason` · no
employment-ended state in Assets · no persisted `outstanding` · no persisted clearance state · no
clearance state machine · no scheduler · no Platform job · no Payroll or Workflow dependency · no
synthetic actor · no tenant parameter · no wildcard permission · and **no migration added**.

---

## 8. Readiness

**Ready.** D-5.3-01 is approved, which was the only blocker. No other open decision is required: this
checkpoint records no condition (D-5.3-05), authorizes no deduction (D-5.3-03), requires no active-
employment rule (D-5.3-07), no transfer (D-5.3-08) and no correction (D-5.3-10). No cross-module
contract is created or changed, and no new table, column, migration or permission is introduced.
