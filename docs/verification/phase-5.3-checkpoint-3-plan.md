# Phase 5.3 — Checkpoint 3 · Definition of Ready — Custody Ageing & Outstanding Reporting

**Branch** `claude/phase-5-employment-workforce-xaxasu` · **Base** `9c57699` (Checkpoint 2, verified)
**Date** 2026-08-24

---

## 1. What this investigation was asked to settle

Two things, in order.

1. **The employment-ended custody boundary.** After Checkpoint 2 the open question was whether Assets
   should learn that an employment has ended (Option A — subscribe) or should not (Option B — stay
   independent and answer when asked). The instruction was explicit that the *absence* of behaviour in
   Checkpoint 2 is not approval of either.

2. **Whether a custody reporting capability can be built now** without touching any decision that is
   still open.

The answer to the first is **settled by repository evidence**, and it is settled more narrowly than it
first appears — the mechanism is settled, the business rule is not. The answer to the second is **yes**,
and it defines Checkpoint 3.

---

## 2. Verification of the starting state

Established from code, not from the previous checkpoint's own report.

| Claim | How it was verified |
|---|---|
| HEAD is `9c57699` | `git rev-parse HEAD` |
| Working tree clean | `git status --porcelain` — empty |
| Checkpoint 1 present | `asset_category` + `asset` tables, `20260823150000_assets_catalogue` |
| Checkpoint 2 present | `asset_custody`, `20260823180000_assets_custody`, `asset_custody_open_idx` |
| Custody state derived, not stored | no custody column on `asset`; `openFor` reads the open row |
| Module shape | seven commands, five queries, seven permissions |

---

## 3. The decisive evidence on Option A vs Option B

### 3.1 The mechanism exists, and is deliberately not used across modules

An event-handler mechanism **does** exist. `EventHandler` is declared in
`packages/kernel/src/persistence/unit-of-work.ts:43`, `InProcessEventDispatcher`
(`packages/kernel/src/domain/in-process-dispatcher.ts`) registers handlers by event name, and
`ModuleRegistry` accepts an `eventHandlers` array. Employment already raises the event that Option A
would need: `EmploymentEvents.employmentEnded = 'employment.employment.ended'`
(`packages/modules/employment/src/domain/employment-events.ts:35`), raised by the aggregate at
`packages/modules/employment/src/domain/employment.ts:195`.

So Option A is **reachable**. It is not blocked by a missing capability. That matters, because it means
the reason to refuse it has to be a real one.

**There is exactly one `EventHandler` in the entire repository**, and it is *intra-module*:
`onMembershipEnded` (`packages/modules/identity/src/application/on-membership-ended.ts`), registered at
`identity-module.ts:70`, where Identity reacts to **its own** `IdentityEvents.membershipEnded`. No module
anywhere subscribes to another module's event. Eight modules say so in their own module declarations —
Assets, Relations, Letters, Payroll, Performance and Career each state "nothing here subscribes to an
event".

`EmploymentEvents` is **not exported from Employment's contract**
(`packages/modules/employment/src/contracts/index.ts` exports views, statuses and transitions — no event
names). A subscriber outside Employment would have to reach past the published contract to name the
event it wanted, which is precisely the dependency the contract file exists to prevent.

### 3.2 Three ADRs answer this question directly, and they agree

**ADR-0050 — *An onboarding is started by an idempotent command and guaranteed by reconciliation, never
by an event.*** It states the delivery facts as verified properties of `PostgresUnitOfWork`, not as
opinion: commit happens and **then** dispatch; delivery is in-process; there is no broker, no queue, no
retry; there is **no outbox**, so nothing can replay; and there is **"no published event contract and no
cross-module subscription contract."** Its conclusion: *"an event is at-most-once, and 'the hire event
was raised' is not evidence that anything happened."*

**ADR-0058 — *Attendance pulls leave changes; Leave never writes to Attendance.*** This is the closest
structural analogue in the repository: a downstream module that needs to know an upstream fact moved.
It refuses the push design — *"The dependency points one way, and the module that needs the information
asks for it"* — and refuses a stored cursor with it: *"No cursor table, no feed, no subscription."*

**ADR-0053 — *Recalculation is found by asking, not by being told.*** It supplies the positive half of
the answer, and it is the half that defines this checkpoint: *"Reconciliation is a first-class query …
the count is on the administrator's dashboard rather than in an operations script. It is the number that
reveals a **failure**, and a number a human can see is a number a human notices growing."*

**ADR-0051 / ADR-0047 — *this module owns no employment fact.*** Assets already complies: it holds
`employment_id` and copies nothing.

### 3.3 What Option A would cost here specifically

Automatic custody closure driven by `employment.employment.ended` would mean that a process restarting
mid-dispatch leaves an asset **permanently** recorded as held by somebody who has left, with nothing that
can replay the event and nothing that records it was owed. The failure is silent and unrecoverable by
design, and it concerns company property. Under ADR-0050's standard this is not a tolerable dependency.

### 3.4 The distinction that must be preserved

**The mechanism is settled. The business rule is not.**

- *Settled by evidence*: Assets does not subscribe, does not consume an Employment event, does not close
  a custody automatically, and does not schedule anything. It answers when asked. This is recorded below
  as **D-5.3-11**.
- *Still open*: what **should** happen to a custody whose employment has ended — option (a) it stays open
  and attached to the ended employment, or option (c) it closes with an outstanding marker. That is
  **D-5.3-01**, it is a business rule about company property, and no line of code in this repository
  expresses it. It remains **OPEN** and it still blocks Checkpoint 4.

D-5.3-11 does not decide D-5.3-01. It decides only that whichever way D-5.3-01 is settled, the trigger
will be a command or a read — never a subscription.

---

## 4. Why Checkpoint 3 is reporting and not incidents

The specification's remaining domain objects are **AssetIncident** (loss, damage, theft; assessment,
liability decision, authorized deduction) and **ClearanceItem** (the Offboarding projection). The
Checkpoint 2 plan anticipated incidents as Checkpoint 3.

Incidents cannot be built now without deciding open decisions:

| Requirement of AssetIncident | Blocked by |
|---|---|
| Condition at assessment | **D-5.3-05** — whether the condition scale is tenant vocabulary or a closed set · **OPEN** |
| Liability decision → authorized deduction | **D-5.3-03** — how a non-return deduction reaches Payroll · **OPEN** |
| What "outstanding" means for clearance | **D-5.3-01** · **OPEN** |

Building any of them would mean silently choosing an owner decision, which §3 of the authorization
forbids. So Checkpoint 3 takes the capability that is genuinely independent of all three.

---

## 5. Checkpoint 3 scope — custody ageing, derived

### 5.1 What already exists and is *not* rebuilt

Checkpoint 2 already ships outstanding custody by asset and by employment:

- `assets.asset-custody` derives `current` — the open custody — and pages the history.
- `assets.employment-custody` takes `openOnly`, which narrows to what is still out.

So "outstanding custody by employment" and "by asset" and "current custody state derived from
`asset_custody`" are **already true**. Restating them would be new code for no new capability.

### 5.2 What is genuinely new

**1. Ageing, derived from persisted civil dates.**

- An **open** custody publishes `daysOutstanding` — whole days from `issuedOn` to an explicit `asAt`.
- A **returned** custody publishes `daysHeld` — whole days from `issuedOn` to `returnedOn`. This is a
  **closed fact** and does not depend on `asAt` at all.

**2. An explicit `asAt` on both custody reads**, defaulting to the server clock's today and echoed in
every response, so a figure can never be reproduced against an unknown date.

**3. `assets.custody-summary` — the ADR-0053 dashboard number.** Tenant-scoped, aggregate only:
`{ asAt, openCount, oldestIssuedOn?, longestDaysOutstanding? }`.

### 5.3 Boundary semantics, stated exactly

- Both `issuedOn` and `asAt` are civil dates `YYYY-MM-DD`. Arithmetic is over UTC midnights, so no
  timezone can move a boundary.
- Issued today, read today → `0`. The day of issue is day zero, not day one.
- `asAt` **before** `issuedOn` → `daysOutstanding` is **absent**, not zero and not negative. As at that
  date the custody had not been issued, and absence is the honest answer. A clamp to zero would report
  that something was outstanding when it had not yet happened.
- A malformed `asAt` is **refused**, not silently replaced with today. A report whose date was quietly
  substituted is a report nobody can reproduce.
- `asAt` may be in the future. Asking "how old will this be at year end" is a legitimate question and
  the arithmetic is the same one; nothing is persisted, so no future date can contaminate a record.

### 5.4 What ageing explicitly is **not**

- It is **not** overdue. There is no expected-return date anywhere in `asset_custody`, so overdue cannot
  be computed and is not claimed. The negative-space test that Checkpoint 2 wrote — *"records no expected
  return and schedules no reminder"* — stays exactly as it is, and stays true.
- It is **not** a business-state transition. Reading a custody's age changes nothing and asserts nothing
  about clearance, liability or deduction (AD-005, AD-006).
- It is **not** a statement about the employment. The reads never ask Employment anything, so a custody
  held by an ended employment ages identically to one held by an active employment. This is what keeps
  the read from quietly reinterpreting **D-5.3-01**.

### 5.5 Why the summary is a count and not a list

The Checkpoint 2 custody reads state the rule: *"there is deliberately no 'every custody in this
organisation' read: that is a report nobody approved, and it is the read that turns an asset register
into a surveillance list."*

That rule stands, and the summary does not breach it. It publishes **no identifier of any kind** — no
asset, no custody, no employment. It publishes a count, the oldest issue date, and the largest number of
days. It is exactly ADR-0053's *"number a human notices growing"*, and it is the shape that lets somebody
discover that twelve items have been out for two years without being handed a list of who holds them.

The bucket thresholds that a report of this kind usually carries — 30/60/90 days — are **deliberately not
implemented.** Those are business thresholds, and inventing them here would be manufacturing a rule the
repository does not express.

---

## 6. Design

### 6.1 No migration, no table, no column

Checkpoint 3 adds **no** table, **no** column and **no** migration. Every figure is computed from
`issued_on` and `returned_on`, which already exist. This is ADR-0070 applied directly — *"a stored flag
that nothing maintains is worse than no flag"* — and a persisted `days_outstanding` would be wrong every
day after the day it was written.

Consequently there is no new RLS surface. The summary reads `asset_custody`, which is already protected
and forced by `app_protect_table`.

### 6.2 Domain — one pure function

`custodyAgeing(custody, asAt)` in `src/domain/custody-ageing.ts`, returning `daysOutstanding` for an open
custody and `daysHeld` for a returned one. Pure, no clock, no I/O — the date it works against is passed
in, which is what makes it testable and what makes the API's `asAt` real rather than decorative.

### 6.3 Application

- `custodyView` gains the derived figures via the ageing function; the view stays the single place that
  decides what leaves the module.
- Both existing custody queries accept `asAt?` and echo the resolved `asAt`.
- `readCustodySummaryHandler` — `assets.custody-summary`, permission `assets.custody.read`.

**No new permission.** The summary discloses strictly less than the two reads that already exist behind
`assets.custody.read`; minting a permission for it would be a permission for a future capability, which
the Checkpoint 1 authorization forbids.

### 6.4 Infrastructure

`CustodyStore.openSummary(transaction, asAt)` → `{ openCount, oldestIssuedOn? }`, a single SQL aggregate.
A tenant-wide count cannot be paged for in the application, so it is computed where the rows are.

`longestDaysOutstanding` is then derived **in TypeScript** from `oldestIssuedOn` by the same
`custodyAgeing` arithmetic the item reads use. This is deliberate: it means there is exactly **one**
implementation of the day arithmetic in the module, so the summary and the item reads cannot disagree.

### 6.5 API

One new route: `GET /api/v1/assets/custody/summary`, declared on `CustodyController` **before** the
existing `GET /` so the literal segment cannot be swallowed — the same resolution rule the controller
already depends on, asserted by a route test rather than trusted.

`asAt` is added as a query parameter to the two existing custody routes. No `PUT`, no `PATCH`, no
`DELETE`. No route takes a tenant or an actor.

---

## 7. Decisions

| ID | Question | Outcome |
|---|---|---|
| **D-5.3-11** *(new)* | Whether Assets learns that an employment has ended by subscription | **SETTLED BY EXISTING EVIDENCE** — it does not. ADR-0050, ADR-0058, ADR-0053. |
| D-5.3-01 | What custody attaches to when an employment ends | **OPEN** — unchanged. Blocks Checkpoint 4. |
| D-5.3-03, D-5.3-05, D-5.3-07, D-5.3-08, D-5.3-10 | — | **OPEN** — unchanged, and none is required by Checkpoint 3. |
| D-5.3-02, D-5.3-04, D-5.3-06, D-5.3-09 | — | Settled/approved. Not reopened, not weakened. |

---

## 8. Test plan

**Unit.** Day-zero; a whole span; `asAt` before issue → absent; a returned custody's `daysHeld`
independent of `asAt`; a leap day; a year boundary; malformed `asAt` refused; the two reads echo the
resolved `asAt`; the summary of an empty tenant is `0` with no dates.

**Real PostgreSQL.** Tenant isolation of the summary under an unprivileged role — a second tenant's open
custodies must not reach the count. Permission boundaries — `assets.custody.read` required, and absence
answers as absence. The summary agrees with the item reads over the same data. Pagination bounds hold.
The returned-custody trigger and `asset_custody_open_idx` still hold (Checkpoint 2 invariants, re-proved).

**Negative space.** No ageing column exists on any Assets table, reconciled against the live catalogue.
No tenant-wide custody *listing*. No event handler and no subscription. No Platform, Payroll or Workflow
reference. No expected-return or reminder. No tenant or actor parameter. No wildcard permission. No
employment-status read.

---

## 9. What Checkpoint 3 deliberately does not build

Incidents · liability · waivers · deductions · the clearance projection · transfer · acknowledgement ·
cancellation · correction · condition · valuation · any employment-ended behaviour · bucket thresholds ·
any persisted reporting figure.

---

## 10. Readiness

**Ready.** No open decision is required. No new table, no new permission, no cross-module change, no
migration. The one decision this investigation opened, D-5.3-11, is settled by evidence rather than by
choice, and it is recorded as settled rather than as approved.
