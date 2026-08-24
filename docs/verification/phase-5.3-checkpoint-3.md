# Phase 5.3 — Checkpoint 3 · Custody Ageing & Outstanding Reporting · Implemented

**Branch** `claude/phase-5-employment-workforce-xaxasu` · **Base** `9c57699` · **Date** 2026-08-24
**Plan** [`phase-5.3-checkpoint-3-plan.md`](./phase-5.3-checkpoint-3-plan.md)

---

## 1. What was built

How long a custody has run, derived from the dates already on the row, and how much is out across a
tenant.

| | |
|---|---|
| Tables added | **none** |
| Columns added | **none** |
| Migrations added | **none** |
| Permissions added | **none** |
| Queries added | one — `assets.custody-summary` |
| Commands added | none |
| Cross-module dependencies added | none |

Every figure is computed from `issued_on` and `returned_on`. A persisted `days_outstanding` would be
correct on the day it was written and wrong every day after (ADR-0070), which is the same reasoning
that kept `in_custody` off `asset` in Checkpoint 1.

### The reads

- **`daysOutstanding`** — whole days from issue to an explicit `asAt`, on an open custody.
- **`daysHeld`** — whole days from issue to return, on a returned one. A closed fact: it does not
  depend on `asAt` and does not move again.
- **`asAt`** on both existing custody reads, defaulting to the server's day and **echoed in every
  response**, so no figure is measured against a date the caller cannot see.
- **`assets.custody-summary`** — `{ asAt, openCount, oldestIssuedOn?, longestDaysOutstanding? }`.

### Boundary semantics

- The day of issue is **day zero**.
- `asAt` before the issue → the figure is **absent**, not zero and not negative. As at that date the
  custody had not been issued.
- A malformed `asAt` is **refused**, never silently replaced with today. A quietly substituted date
  produces a report that is internally consistent and answers a different question than the one asked.
- A future `asAt` is permitted — the arithmetic is identical and nothing is persisted.
- Arithmetic is over **UTC midnights**, so no timezone or DST transition can move a boundary.

### What ageing is not

It is **not overdue**. No expected-return date exists anywhere in `asset_custody`, so overdue cannot
be computed and is not claimed. It is **not a business-state transition** — reading a custody's age
changes nothing and asserts nothing about clearance, liability or deduction. And it says **nothing
about the employment**: the reads ask Employment nothing at all.

---

## 2. The decision this checkpoint settled — and the one it did not

### D-5.3-11 · **SETTLED BY EXISTING EVIDENCE**

*Whether Assets learns that an employment has ended by subscription.* **It does not.**

Option A was **reachable**, which is why the refusal had to be a real one. `EventHandler`,
`InProcessEventDispatcher` and `ModuleRegistry.eventHandlers` all exist, and Employment already raises
`employment.employment.ended`. Nothing was missing.

It was refused on four pieces of evidence:

- **No module in this repository subscribes to another module's event.** The only `EventHandler` that
  exists — `onMembershipEnded` — is Identity reacting to Identity's own event.
- **`EmploymentEvents` is not exported from Employment's contract.** A subscriber would have to reach
  past the file whose entire purpose is to be the only thing consumers depend on.
- **ADR-0050**: dispatch is post-commit, in-process, at-most-once, no outbox, no replay, and there is
  *"no published event contract and no cross-module subscription contract."*
- **ADR-0058 and ADR-0053**: the module that needs the information asks for it, and the situation
  nothing watches for becomes visible as *"a number a human can see is a number a human notices
  growing."*

The concrete cost of Option A here: a process restarting mid-dispatch would leave an asset permanently
recorded as held by somebody who has left, with nothing able to replay the event and nothing recording
that it was owed. Silent, unrecoverable by design, and about company property.

### D-5.3-01 · **still OPEN**

*What should happen to a custody whose employment has ended* — option (a) it stays open and attached,
or option (c) it closes with an outstanding marker — is a **business rule**, and no line of code in
this repository expresses it. D-5.3-11 settles only the **mechanism**: whichever way D-5.3-01 is
decided, the trigger will be a command or a read, never a subscription.

**The reads were built so they cannot decide it by accident.** They ask Employment nothing, so a
custody held by an ended employment ages and counts exactly like one held by an active employment. A
test asserts the directory is never consulted. Both options remain reachable and each still costs one
migration.

### Every other decision

D-5.3-03, D-5.3-05, D-5.3-07, D-5.3-08 and D-5.3-10 remain **OPEN and untouched** — none was required.
D-5.3-02, D-5.3-04, D-5.3-06 and D-5.3-09 were **not reopened and not weakened**.

**Why reporting rather than incidents.** The Checkpoint 2 plan anticipated damage and liability as
Checkpoint 3. It cannot be built now without silently deciding open decisions: condition assessment
needs **D-5.3-05**, the liability-to-deduction path needs **D-5.3-03**, and what "outstanding" means
needs **D-5.3-01**. Reporting is the capability genuinely independent of all three.

---

## 3. Security and tenancy

- **No new table**, so no new RLS surface. The summary reads `asset_custody`, already enabled and
  **forced** under `app_protect_table`.
- **No `BYPASSRLS`**, no service-level tenant bypass, **no tenant parameter** anywhere. Tenancy comes
  from the execution context.
- **No new permission.** `assets.custody-summary` sits behind the `assets.custody.read` that already
  existed and discloses strictly less than the two reads beside it. Minting one would be a permission
  for a capability rather than for an authority.
- **The summary publishes no identifier of any kind** — not an asset, not a custody, not an employment.
  This is what separates a dashboard number from the tenant-wide custody *listing* this module still
  refuses to build. A test renders the payload and asserts no identifier appears in it, and pins the
  exact key set.
- Authorization failure still behaves as absence, never as a distinguishable permission error.
- **No cross-module change.** The Employment read remains the module's only cross-module dependency,
  bounded, and still names `EmploymentPermissions.employmentRead` rather than a hand-written string.

---

## 4. Concurrency

Checkpoint 3 adds no write path, so it adds no new invariant. The Checkpoint 2 guarantees are re-proved
rather than assumed: `asset_custody_open_idx` still admits one open custody per asset, the returned-row
trigger still refuses every update and delete, and the asset-row lock still serializes issuance against
retirement.

The summary is a single aggregate statement — no read-then-assume, and nothing it could race against.

---

## 5. Tests

| Suite | Tests |
|---|---|
| `custody-ageing.test.ts` *(new)* | 13 — day zero, month and year boundaries, leap and non-leap February, DST-straddling spans, before-issue absence, a returned span held still against three dates |
| `custody-reporting.test.ts` *(new)* | 15 — `asAt` echoed on both reads, server-day fallback, malformed date refused on both, summary counts, agreement between summary and item reads, no identifier in the payload, permission boundary, Employment never consulted |
| `assets-reporting-boundaries.test.ts` *(new)* | 4 — no persisted ageing figure, no tenant-wide listing, no invented threshold, no employment status |
| `assets-isolation.integration.test.ts` | +3 — the summary's tenant isolation in **both directions** against real PostgreSQL as an **unprivileged role**, the civil-date projection, and the empty tenant |
| **`@work/assets` total** | **204** across 16 files |
| **`@work/api` assets specs** | **20** across 2 files |

**Stale assertions reconciled, none deleted.** Four exact assertions became stale because the query set
genuinely grew by one, and each was replaced with a more exact statement plus a positive assertion of
what the new capability is:

| Assertion | Reconciliation |
|---|---|
| "seven commands and **five** queries" | → six, as the full set; plus a new test that the reporting read is a **query** behind the **pre-existing** permission |
| "dispatches exactly the **twelve** names" | → thirteen |
| "exactly the **twelve** paths" | → the exact set plus `summary`; plus a new test that the literal segment is declared **before** the collection read it shares a controller with |
| `eventHandlers` length 0 | → its own test naming D-5.3-11, additionally scanning the composition source for `EventHandler`, `subscribe` and `onEmploymentEnded` |

**Two assertions were made non-vacuous rather than merely added.** The migration scan names both tables
first, so a moved or renamed directory fails loudly instead of passing every absence trivially.

---

## 6. Gates

```
pnpm standards        Standards: no violations
                      Architecture: 186 models, no violations
                      Localization: 19 catalogue sets complete
                      Dependencies: 1,887 source files, no cycles, no unused, no unreachable
pnpm format:check     All matched files use Prettier code style
prisma validate       valid
prisma migrate status 31 migrations, database schema up to date — no drift, and none added
```

Full gate: `pnpm exec turbo run build lint typecheck test --force --concurrency=1`, with Turbo's own
exit code read directly and the command not piped through `tail`, `grep`, `tee` or `echo`. Results in
the final report.

No lint suppression, no architecture exemption, no standards exception, no `any`, no `as never`, no
blanket cast, and no unrelated module modified to make the gate pass.

**Two line budgets were exceeded and both were split at architectural seams**, not exempted:

- `custody.controller.ts` (153/150) → the asset-scoped routes moved to `asset-custody.controller.ts`.
  The two classes already had different subjects and different path prefixes; the file was holding two
  controllers because they were written together.
- `assets-boundaries.test.ts` (455/400) → the Checkpoint 3 negative space moved to
  `assets-reporting-boundaries.test.ts`, over a shared `source-scan.fixture.ts`. One scanner, so two
  copies cannot drift about what counts as source.

---

## 7. Files

25 files changed, +1,578 / −134.

**Every changed file is inside `packages/modules/assets`, `apps/api/src/assets` or `docs/`.** No module
outside Assets was touched — not Platform, Payroll, Workflow, Employment, Documents, Identity or
Relations — and this time not even the shared composition root, because no new dependency was wired.

---

## 8. Scope deliberately not built

Incidents · liability · waivers · deductions · the clearance projection · transfer · acknowledgement ·
cancellation · correction · condition · valuation · any employment-ended behaviour · any Employment
subscription · bucket thresholds · any persisted reporting figure · any custody access-history table ·
any Platform job, timer or reminder.

The Relations grant defect recorded at Checkpoint 2 remains **reported and unfixed**, as it is outside
this phase's authorized scope.

---

## 9. Where Phase 5.3 stands

**Checkpoints 1, 2 and 3 of 4 are complete. Phase 5.3 is not complete.**

Checkpoint 4 — the Offboarding clearance projection (AD-006) — remains, and it is **blocked by
D-5.3-01**, which is exactly the decision this checkpoint was careful not to answer.
