# Munaxa Work — Next Product Slice Investigation (#3)

Investigation and prioritization only. No production code was modified. Attendance was not fixed,
its localization defect was not touched, and no slice was selected for implementation.

Rebuilt from source at `f23752f`. Where this disagrees with an earlier document, the figure here is
the one derived this turn.

---

## A. Current product state

Five completed slices. What they now demonstrate, measured fresh:

| | Count |
|---|---:|
| Modules | 18 |
| Prisma models | 186 |
| Migrations | 31 (verified against `_prisma_migrations`: 31 finished rows) |
| HTTP routes | 513 |
| `GET` routes | 187 |
| Admin routes | 25 |
| Detail routes (`[param]`) | **8** |
| Route files declaring `metadata` | **12** (plus the layout) |

**Every one of the 8 detail routes and all 12 titled route files belong to the five composed
slices.** Eleven modules still have a single route each and no detail route; three more — assets,
identity, relations — have no screen at all.

What the five slices established, in the order they established it:

1. **Employee Record** — one subject read from eleven modules, each section its own permission, each
   absence explained rather than blank.
2. **Approvals as Work** — a queue addressed to the reader; the discovery that eight characters of a
   UUIDv7 are the same for a whole afternoon, and that a membership must never be shortened.
3. **Hiring as Work** — refused ≠ empty ≠ withheld as a *per-read* discipline; server totals only.
4. **Payroll as Work** — no screen reads the first row of anything; a value is rendered or it is not
   shown.
5. **Leave as Work** — a number made *explainable* from a published ledger; a 404 and a 403 kept
   apart as far as the route; and the finding that a module can ship a complete domain with no
   translation at all for its own status vocabularies.

---

## B. Attendance backend inventory

### Routes — 13 `GET`, 34 total

| Route | Query | Permission | Consumed | Shape | Bounded |
|---|---|---|---|---|---|
| `GET /attendance/dashboard` | `attendance.dashboard` | `attendance.read` | yes | 6 counts | n/a |
| `GET /attendance/days` | `attendance.search-days` | `attendance.read` | yes | paged + `total` | yes |
| `GET /attendance/events` | `attendance.search-events` | **`attendance.event.read`** | yes | paged + `total` | yes |
| `GET /attendance/exceptions` | `attendance.search-exceptions` | `attendance.read` | yes | paged + `total` | yes |
| `GET /attendance/corrections` | `attendance.search-corrections` | `attendance.read` | yes | paged + `total` | yes |
| `GET /attendance/shifts` | `attendance.list-shifts` | `attendance.read` | yes | array | small |
| `GET /attendance/schedules` | `attendance.list-schedules` | `attendance.read` | yes | array | small |
| `GET /attendance/roster` | `attendance.read-roster` | `attendance.read` | yes | array | ranged |
| `GET /attendance/imports` | `attendance.list-imports` | **`attendance.import`** | yes | array | limited |
| `GET /attendance/days/:employmentId/:attendanceDate` | `attendance.read-day` | `attendance.read` | **no** | day + events + exceptions | one day |
| `GET /attendance/reconciliation` | `attendance.days-awaiting-recalculation` | `attendance.read` | **no** | `{ total, days[] }` | limited |
| `GET /attendance/snapshots` | `attendance.read-snapshots` | `attendance.read` | **no** | array | period |
| `GET /attendance/export` | `attendance.export` | **`attendance.export`** | **no** | one response | refuses over limit |

**9 of 13 consumed. Four unconsumed, and one of them is the whole workflow:**
`attendance.read-day` is the only 404-capable read in the module and returns the day, **its events
including the superseded ones**, and its exceptions in a single round trip.

### Contracts published

`AttendanceDashboardView`, `AttendanceDaySnapshot`, `AttendanceDayView`, `AttendanceExceptionView`,
`CorrectionView`, `ImportBatchView`, `PayableSnapshotView`, `RosterEntryView`, `ScheduleView`,
`ShiftView`, `TimeEventView` — plus 16 vocabulary types and 17 exported value sets.

`AttendanceDayView` alone carries **29 fields**, including `expectedStartAt`/`expectedEndAt`,
`expectedMinutes`, `firstInAt`, `lastOutAt`, `workedMinutes`, `breakMinutesTaken`,
`paidBreakMinutes`, `regularCandidateMinutes`, `overtimeCandidateMinutes`, `unpaidMinutes`,
`absenceMinutes`, `leaveState`, `leaveMinutes`, `approvedAt`/`approvedBy`, `lockedAt`,
`calculationVersion`, `inputsDigest`, `calculatedAt`, `inputsChangedAt`.

**Two served reads cannot be typed by a screen.** `AttendanceExport` and `ExpectedWorkingDaysView`
are exported from the module root but **not from `contracts/index.ts`**, and the admin app may only
import from `@work/attendance/contracts`. This is the *second* instance of the pattern — Leave's
`BalanceAsOfView` was the first — and §P proposes a separate investigation for it.

### Permissions — 19 declared, 4 gate reads

`attendance.read` · `attendance.event.read` · `attendance.import` · `attendance.export`. The other
fifteen gate writes, or are the two `*-own` self-service permissions.

### Existing UI

One route, `/attendance`, four files, **zero tests**:

| File | Lines |
|---|---:|
| `api.ts` | 132 |
| `sections.tsx` | 197 |
| `configuration.tsx` | 193 |
| `locale.ts` | 62 |

It has the four defects the five slices each removed: no detail route and no link at all; `total`
discarded by an `itemsOf` helper; a single `unavailable: boolean` collapsing refused, unreachable
and empty; and `short()` truncating every identifier — 8 call sites here.

### Module tests

**11 test files inside the module**, covering the domain, authorization, edge cases, reliability,
shifts and persistence. The backend is not the weak side.

### Dependencies

Two cross-module ports, both wired in the composition root: `EmploymentDirectoryPort` and
`LeaveDirectoryPort`. Both run under bounded service grants (ADR-0043).

---

## C. Attendance workflow assessment — the smallest honest workflow

Derived from the contracts, not from the conceptual model in §4.

```
/attendance                                  the register: today's counts, the exception
                                             queue, the days, the rota and the definitions
/attendance/days/[employmentId]/[date]       one day: expected against actual, its punches,
                                             its exceptions, its leave state
```

**Two routes.** Attendance's drill-down subject is a *day*, and a day is addressed by the pair
`(employmentId, attendanceDate)` — which is exactly what `attendance.read-day` takes and exactly
what `AttendanceDaySnapshot` answers. Forcing a third route would be inventing a subject the
contracts do not have.

The user questions §4 lists, answered against published fields only:

| Question | Answered by | Published? |
|---|---|---|
| Did I attend today? | `AttendanceDayView.state` + `firstInAt` | yes |
| What shift was I assigned? | `RosterEntryView.shiftId` → `ShiftView` | yes, but by identifier |
| When did I check in / out? | `firstInAt` / `lastOutAt` on the day; `TimeEventView.occurredAt` for each punch | yes |
| Was I late? | exception `late_arrival` with its own `minutes` | **yes, as a domain verdict** |
| Was I early? | exception `early_departure` with its own `minutes` | **yes** |
| Was overtime recorded? | `overtimeCandidateMinutes` **and** exception `overtime_candidate` | yes |
| Was there an exception? | `AttendanceExceptionView` — kind, severity, state, minutes | yes |
| Is there a correction pending? | `CorrectionView.state = 'requested'` | yes |
| What happened on previous days? | `attendance.search-days` filtered by employment and range | yes |

**The decisive property: lateness is not a calculation, it is a verdict.** All 15 exception kinds
carry their own `minutes`, their own `severity` and their own **fully translated sentence in both
languages** — "Arrived late." / "حضور متأخر." · "Left early." / "انصراف مبكر." · "Worked beyond the
expected day." · "Worked less than the expected day." A screen can present the hardest part of an
attendance product with zero arithmetic.

**Class: A — product-ready. No backend change required for these two routes.**

---

## D. ZK / biometric assessment

**There is no ZK integration in this repository, and its absence is a decision rather than a gap.**

ADR-0057 — *A vendor is not a source* — states it directly:

> A time event has seven sources, and none of them is a vendor: `web`, `mobile`, `device`, `manual`,
> `import`, `api`, `correction`. A biometric reader, a turnstile and a QR gate all arrive as
> `device`. Which physical unit produced the punch is `device_reference` — an opaque string, stored
> and compared, never parsed.
>
> **No vendor SDK is imported by this module, at any layer.**
>
> **No raw biometric template is stored anywhere.** Not a fingerprint, not a face embedding, not a
> hash of one.
>
> **No device integration is shipped or verified in this phase.** There is no reader in this
> repository to test against, and the completion report marks device and biometric integration
> **NOT VERIFIED** rather than claiming a mock proves anything.

What therefore exists, and what a product surface may honestly show:

- **Punches do enter Munaxa** through `attendance.record-event`, idempotent, with three separate
  timestamps (`occurredAt`, `reportedAt`, `receivedAt`), `clockSkewSeconds` and `capturedOffline`.
  `TimeEventView` publishes all of them, plus `deviceReference` and — only where a tenant enabled
  capture — coordinates, behind `attendance.event.read`.
- **Attendance summaries are derived server-side**, not in a client: `AttendanceDayView` is a
  calculated projection carrying `calculationVersion` and `inputsDigest`.
- **Bulk arrival is visible** through `ImportBatchView` — `rowsSubmitted`, `rowsCreated`,
  `rowsSkipped`, `rowsFailed`, `submittedAt`, `submittedBy` — behind `attendance.import`.

**What does not exist, and must not be invented:**

- **No synchronization status model.** There is no "device X last reported at T", no heartbeat, no
  connector health, no missing-sync signal. `ImportBatchView` says what *one batch* did; it cannot
  say that a turnstile went quiet on Tuesday.
- Therefore **a "sync failed" state cannot be represented honestly.** A screen that inferred one
  from an absence of punches would be asserting a device fault it has no evidence for — the same
  class of false statement ADR-0056 exists to prevent.

**Assessment: the existing integration provides enough for a useful product surface, and nothing
for a synchronization surface.** A future slice may show punches, their source, their skew and
whether they were captured offline. It may not show device health. That is a bounded, honest line
and it does not block Attendance.

---

## E. Leave integration — already composed, server-side

**This is the strongest single finding of the investigation, and it required no new work at all.**

`apps/api/src/attendance/leave.directory.ts` wires `LeaveDirectoryPort` to Leave's published
`leave.approved-leave-for` query, under a **bounded service grant naming exactly one permission,
`leave.read`**. So an attendance day's leave state is decided in the domain, before any screen sees
it, and `AttendanceDayView` carries it:

- `leaveState: 'none' | 'applied' | 'unknown'`
- `leaveMinutes: number`

The three-value vocabulary is the point, and the adapter's own comment says why:

> If a failure were collapsed into "no leave approved", every unexplained absence during a Leave
> outage would be written onto somebody's record as an absence *without leave* — a false statement
> about a person, produced by a system fault they had nothing to do with.

`unknown` is carried through into the exception vocabulary as two distinct kinds —
`absence_pending_explanation` ("Absent, and leave cannot yet be checked.") versus
`absent_unexplained` ("Absent, with no leave approved.") — both already translated in both
languages.

**And the relationship runs both ways.** `apps/api/src/leave/leave.composition.ts` calls
`attendance.expected-working-days` so Leave can count a request in working days. That query has
**no HTTP route**: it exists only for this composition. Attendance↔Leave is fully composed at the
domain layer, in both directions, today.

**What can be shown with no new abstraction:** an attendance day may state, from its own view, that
leave was applied and for how many minutes, or that leave could not be checked — and it may say so
in a sentence the module already ships.

**The one gap, stated precisely: `AttendanceDayView` carries no `leaveRequestId`.** So a day can
say *that* leave applied but cannot link to *which* request — and now that `/leave/requests/[id]`
exists, that link is the natural next step and is the one thing missing. Closing it in the UI would
mean asking Leave per day, which is an N+1 across a page of days and is forbidden. Closing it
properly is one optional field on a published contract, which is a Leave/Attendance contract change
and is **out of scope for a composition slice**. Recorded, not proposed.

---

## F. Payroll integration — published and unconsumed

Attendance already publishes exactly what Payroll consumes, and publishes it as a **frozen,
sequenced** record rather than a live figure.

`PayableSnapshotView` carries `workedMinutes`, `regularCandidateMinutes`,
`overtimeCandidateMinutes`, `unpaidMinutes`, `absenceMinutes`, `leaveMinutes`, `leaveState`,
`daysTotal`, `daysApproved`, **`daysUnapproved`**, **`blockingExceptions`**, `calculationVersion`,
`inputsDigest`, `sequence`, `frozenAt`, `frozenBy`.

Two of those are on the contract deliberately, and the module says so:

> `daysUnapproved` and `blockingExceptions` are on the contract rather than filtered out, so a
> consumer decides visibly instead of being handed a silently incomplete month.

It is served at `GET /attendance/snapshots` under `attendance.read` — **and no screen consumes it.**

The word *candidate* is load-bearing throughout: `overtimeCandidateMinutes` is minutes, never money,
and Compensation and Payroll decide what it is worth (ADR-0054). A product surface may show the
snapshot's own figures and its completeness counts. It may not total them, convert them, or place a
rate beside them.

**Assessment: an existing published relationship is sufficient.** No aggregation endpoint is needed
and none should be built. Whether the snapshot belongs on an Attendance screen or is left to
Payroll's is a scoping question for the Definition of Ready, not a capability gap.

---

## G. Attendance localization defect

Re-verified live this turn against the running application, in both languages. **Unchanged.**

### Affected keys — 6 per language, 5 rendered

```
attendance.label.boundary.employment      rendered
attendance.label.boundary.leave           rendered
attendance.label.boundary.location        rendered
attendance.label.boundary.money           rendered
attendance.label.boundary.notifications   rendered
attendance.navigation.attendance.daily    not currently requested by any screen
```

### Root cause

The catalogue stores these as **flat keys containing dots** — the literal string
`"boundary.employment"` nested under `attendance.label`. `scripts/check-localization.mjs` flattens a
catalogue by joining nested keys with `.`, so it sees `attendance.label.boundary.employment` as
present and passes. The runtime translator in `apps/admin/src/attendance/locale.ts` splits the
requested key on `.` and walks segment by segment, so it looks for a nested `boundary` object that
does not exist and returns the key — deliberately, because "a blank label looks like a design choice
and survives review".

**The gate and the runtime disagree about what a dot means.** That is the defect; the five keys are
its symptom.

### Remediation required

Three parts, and the third is the one that matters:

1. Re-nest the six keys (`attendance.label.boundary.employment` → `label: { boundary: { employment } }`),
   in both catalogues. Purely additive-shaped, no value changes.
2. Delete `attendance.navigation.attendance.daily` or re-nest it; nothing requests it.
3. **Close the class**, so it cannot recur: make `check-localization.mjs` reject a key containing a
   dot, which is the smallest change that makes the gate agree with the resolver. Leave's catalogue
   already satisfies this and a test in `apps/admin/src/leave/` asserts no key reaches the markup in
   either language.

Blast radius, re-measured across all 36 module catalogues: **attendance only.** No other module has
a flat dotted key.

### Does it block readiness?

**No.** It is a one-commit fix inside the module that owns it, and part 3 is a gate change of a few
lines. It belongs in the Definition of Ready as a precondition, not as a reason to defer.

**Not fixed in this investigation.** No locale file and no Attendance production code was modified.

---

## H. Attendance state model

| State | Supported? | By what |
|---|---|---|
| **Refused** | yes | Four permissions gate reads: `attendance.read`, `attendance.event.read`, `attendance.import`, `attendance.export`. The CQRS pipeline checks permission *before* the handler, so a refusal is a different event from an empty result. |
| **Empty** | yes | Every paged read returns `{ items, total }` counted in the database. |
| **Populated** | yes | — |
| **Withheld** | **yes, and security-relevant** | `attendance.event.read` separately gates the punches, and `TimeEventView` is where `deviceReference`, `latitude`, `longitude` and `locationAccuracyMetres` live. A caller holding `attendance.read` and not `attendance.event.read` must see the day and its exceptions with the punch list explicitly *withheld*. This is the last genuinely security-relevant withheld state left in the product. |
| **Loading** | yes | Route-level `loading.tsx`, as the five slices already do. |
| **Not found** | **yes, exactly one read** | `attendance.read-day` returns `notFound('attendance day')`. It is the module's only 404-capable read, and it is unconsumed. |

Domain-specific states §9 asks about:

| Condition | Published as | Honest? |
|---|---|---|
| No attendance record | `attendance.read-day` → 404 | yes |
| Incomplete day | `DayState = 'pending'` — ingestion created it, nothing calculated | yes |
| Missing punch | exception `missing_clock_in`, severity `blocking` | yes |
| Missing checkout | exception `missing_clock_out`, severity `blocking` | yes |
| Exception | 15 kinds × 3 severities × 4 states, all published | yes |
| Overtime | `overtimeCandidateMinutes` + exception `overtime_candidate` | yes |
| Correction pending | `CorrectionView.state = 'requested'`, with `requestedBy` and `justification` | yes |
| Figure may be stale | `inputsChangedAt` present, plus a dedicated reconciliation read | yes |
| **Synchronization-related absence** | **nothing** | **no — see §D. Must not be inferred.** |

Eight of nine. The ninth cannot be honestly represented and a future slice must not try.

---

## I. Authorization assessment — Attendance only

19 permissions declared. Four gate reads. Findings, none fixed:

**1. A composite read bypasses a finer permission — and the module says so on purpose.**
`attendance.read-day` returns the day's **events** under `attendance.read`, while
`attendance.search-events` requires `attendance.event.read`. The module documents the separation
("The day view carries no device identifier and no coordinate. Those are on the event view, behind
`attendance.event.read`, and the separation is the point") — yet the snapshot includes the events.
This is the same shape as the five instances catalogued in investigation #2. **It is an owner
decision, not a defect to fix unilaterally**, and it has a direct product consequence: a day screen
built on `attendance.read-day` would show punches to a caller who could not read them through
`/events`.

**2. `attendance.read-snapshots` is gated by `attendance.read`, not `attendance.period.freeze`.**
Freezing a period has its own permission because it is "the number Payroll pays"; *reading* the
frozen figures does not. This may be intentional — a payroll operator needs to read what they will
pay without being able to freeze it — and it is recorded as an observation rather than a finding.

**3. Two `*-own` permissions are declared and unreferenced:** `attendance.read-own` and
`attendance.event.record-own`, both commented "(Phase 18)". **These are not defects.** Self-service
is not built (§M), and they are correct declarations awaiting a surface. Classifying them as
authorization gaps is the mistake this task warns against.

The three previously identified findings (`recruitment.offer.read`,
`employment.reporting-line.read`, `employment.contract.read`) remain open and untouched.

---

## J. Cross-module references — the evidence is now conclusive

Attendance produces the same problem, and the pattern now spans **all five completed slices plus the
next candidate**.

| Reference on an Attendance row | Owning module | Bounded read exists? |
|---|---|---|
| `employmentId` | Employment | **yes** — `GET /employments/:id` returns `personName` when the caller may read the person |
| `shiftId` | Attendance itself | yes — `list-shifts`, one page-wide read |
| `scheduleId` | Attendance itself | yes — `list-schedules` |
| unit / position | Organization | **no** — and `organization.cost-center.read` / `profit-center.read` are declared for reads that do not exist |
| leave request | Leave | **no field to resolve** — `AttendanceDayView` has no `leaveRequestId` (§E) |
| payroll period | Payroll | no |

Attendance's own comment states the constraint plainly: *"No read joins a person's name. A queue
shows an employment identifier; resolving one is People's read behind People's permission."*

**The accumulated evidence now warrants a dedicated investigation.** Its exact scope:

> **What bounded cross-module reference capabilities should Munaxa Work publish so product surfaces
> can show human-readable business context without violating module ownership?**
>
> In scope: whether a *batched* bounded read (many identifiers, one round trip) should exist for
> Employment and Organization, and under which permission; whether `organization.cost-center.read`
> and `organization.profit-center.read` should gain the reads they already declare; whether
> `AttendanceDayView` should carry an optional `leaveRequestId`; and what a screen must do when a
> name is legitimately withheld.
>
> Out of scope, explicitly: a generic resolver, a universal lookup service, a reference service, a
> cross-module cache, and any speculative abstraction.

**Not implemented. Nothing in Organization, Payroll or Leave was modified.**

---

## K. `notFound()` HTTP status — measured across all five slices

Tested this turn against the running application with an API answering 404 to everything:

| Route | Status | Boundary rendered |
|---|---:|---|
| `/employment/[employmentId]` | **200** | yes |
| `/approvals/[instanceId]` | **200** | yes |
| `/recruitment/requisitions/[requisitionId]` | **200** | yes |
| `/recruitment/applications/[applicationId]` | **200** | yes |
| `/payroll/runs/[payrollRunId]` | **200** | yes |
| `/payroll/results/[payrollResultId]` | **200** | yes |
| `/leave/requests/[leaveRequestId]` | **200** | yes |
| an unrouted path | **404** | Next's own |

Seven of seven. The correct page renders every time; only the status is wrong. An unrouted path
still answers 404, so the application's 404 handling is not broken in general.

**Classification: C — an implementation issue requiring a future shared routing correction.**

Not A: nothing in the repository declares 200 as the intended status, and the pages call
`notFound()` precisely to signal absence. Not B alone: the API layer is correct — Leave answers 404
for a request in another tenant, and `unwrapOrThrow` maps `not_found` to `NotFoundException`
faithfully. The defect is in the portal's rendering, not the product's semantics.

**Most probable cause, from a 7-of-7 correlation:** every one of those seven routes has a
route-level `loading.tsx`. A `loading.tsx` creates a Suspense boundary, which makes Next stream the
response — headers, including the status, are flushed before the page function resolves and throws.
A streamed response cannot change its status after the first byte. The skeleton is genuinely
valuable, so the remedy is a real trade-off (resolve the route's subject above the boundary, or
accept 200 and document it) rather than a one-line fix.

**This warrants a separate investigation** — it spans five slices, the correction is shared, and
normalizing it inside Attendance alone would make Attendance the one route whose status differs from
the other seven. Stated as the probable cause, to be confirmed there rather than assumed.

**Not fixed.**

---

## L. Identifier consistency

| Convention | Slices | `short()` call sites |
|---|---|---:|
| Truncate to 8 characters | Employee Record, Approvals | 11 |
| Render whole, monospaced, muted, `<bdi>`-isolated | Hiring, Payroll, Leave | 0 |

**108 `short()` call sites remain across 34 files.** Attendance is one of them, with **8 sites**
across `sections.tsx` and `configuration.tsx`.

Attendance is the most acute remaining case, and for a measurable reason. `short()` keeps the first
8 hex characters of a UUIDv7, which are the top 32 bits of its 48-bit millisecond timestamp — so
**every identifier created within the same 65,536 ms window renders as the same string**. Attendance
rows are written in exactly that pattern: an import batch, a device uplink recovering, a
recalculation run. Six sections on the current screen render an `employmentId` column, and a reader's
whole task is to compare them across sections.

The repository already knows this. `apps/admin/src/workflow/exact.ts` documents the failure mode and
`apps/admin/src/approvals/queue.test.tsx:130` states it flatly — *"A membership is never shortened:
eight characters of a UUIDv7 are the same for a whole afternoon."* — while judging truncation
tolerable "for a row identifier nobody compares". **On Attendance that tolerance condition does not
hold**, exactly as it did not hold on Leave.

**Attendance confirms the need, and a slice can settle it for itself** — Leave did, in one file, at
no extra cost. The remaining 100 sites across eleven other screens are a shared design-system
question and belong in the investigation §P proposes. **Do not normalize Employee Record or
Approvals inside a slice.**

---

## M. Alternative candidates

### Self-Service / My Work — re-checked, and the blocker is *stronger* than recorded

Not assumed: re-verified from source this turn.

- **There is still no `/me` route** anywhere in 513 routes.
- `currentMembershipId()` still exists at `packages/kernel/src/tenancy/tenant-context.ts:175`, and
  `workflow` is still the only module that uses it.
- **New finding: the absence is structurally asserted.** `apps/api/src/workflow/workflow.routes.spec.ts`
  contains a test named *"has no route for any capability this phase defers"* which lists `/me` and
  `/my-team` among "the routes that must not exist", and checks them **on the wire *and* in the
  source** — "A 404 alone would prove only that nobody had written the route yet; the source check
  is what makes the absence structural."

So Self-Service is not merely unbuilt: opening it means deliberately retiring an assertion somebody
wrote to keep it closed. That raises the bar from "small backend change" to "an owner decision plus
a small backend change".

**Class: D — blocked.** Value remains the highest of any candidate; readiness remains the lowest.

### Manager Workspace — re-evaluated as two different things

**As a manager portal:** blocked by the same `/me` gap, and `/my-team` is on the same forbidden list.
`apps/manager-portal/src` still contains four files and no product surface. **Class D.**

**As a team lens inside the admin app:** partly composable, and Attendance sharpens the limit.
`employment.search?managerEmploymentId=` is a real, reachable filter, and Performance honours the
same parameter — described there as *"a filter, not a credential"*. But **Attendance publishes no
manager filter at all**: `dayFilters` accepts `employmentId`, `state`, `dayKind`, `fromDate`,
`toDate` and nothing else. So "this manager's team's attendance today" means resolving the reports
from Employment and then issuing one attendance request per report — an N+1 that is forbidden — or
adding a filter, which is a backend change.

**Class: C — backend/domain required** for a team *attendance* lens specifically. A team lens over
Employment and Performance alone remains class B but is thin on its own.

### Other credible existing capability

Three modules have complete backends and no screen at all: **assets** (7 `GET`), **relations**
(10 `GET`), **identity** (4 `GET`). Assets publishes `AssetClearanceView`, already consumed by the
Employee Record, and a custody/clearance workflow is coherent. Relations holds violations,
investigations, corrections and disciplinary actions — commercially significant and unusually
sensitive, which makes it a poor sixth slice while the authorization questions of §I remain open.
Neither displaces Attendance; both are recorded so the ranking is not a two-horse race by default.

---

## N. Ranking

### #1 — Attendance as Work · Class A

| | |
|---|---|
| **User workflow** | The register and its exception queue → one day, examined: expected against actual, its punches, its exceptions, its leave state |
| **Customer value** | Attendance is the operational surface an HR team lives in daily. It is also the only remaining module whose *hardest* content — was somebody late, by how much, and does it matter — is already a translated domain verdict rather than a calculation |
| **Commercial importance** | High. Time and attendance is a headline capability in every enterprise HCM tender in this market, and Munaxa currently ships a backend for it behind a screen that opens nothing |
| **Backend readiness** | Complete. 13 `GET` routes, 11 published views, 11 module test files, both cross-module ports wired |
| **Routes** | 2 — `/attendance` and `/attendance/days/[employmentId]/[attendanceDate]` |
| **Contracts** | `AttendanceDaySnapshot`, `AttendanceDayView`, `AttendanceExceptionView`, `TimeEventView`, `CorrectionView`, `ShiftView`, `ScheduleView`, `RosterEntryView`, `ImportBatchView`, `AttendanceDashboardView` — all exported |
| **Permissions** | 4 gate reads; `attendance.event.read` gives the last security-relevant withheld state in the product |
| **UI readiness** | One legacy page carrying all four defects the slices removed. Zero tests. Replacing it is the slice |
| **Dependencies** | Employment (name, bounded, one read per detail page) and Leave (already composed server-side — §E) |
| **Authentication** | None required beyond what every screen already assumes |
| **Cross-module complexity** | **Lowest of any remaining candidate.** Leave is composed in the domain; Payroll's relationship is a published view; only the `leaveRequestId` link is missing, and it is optional |
| **New backend required** | **None** for the two routes. The localization defect (§G) is a fix inside Attendance, not new capability |
| **Why #1** | It is the only class-A candidate. Every read it needs exists, is permissioned, is bounded, and one of them is 404-capable. It closes the last major operational gap with composition alone |

### #2 — Assets / Employee Clearance · Class B

| | |
|---|---|
| **User workflow** | What an employee holds, what is outstanding, what blocks their clearance |
| **Customer value** | Moderate — sharp at offboarding, quiet otherwise |
| **Commercial importance** | Moderate |
| **Backend readiness** | 7 `GET` routes, `AssetClearanceView` already proven in the Employee Record |
| **Routes / contracts / permissions** | To be derived; not investigated to slice depth here |
| **UI readiness** | **No screen at all** — a clean start rather than a replacement |
| **New backend required** | Unknown until investigated; the clearance view suggests little |
| **Why #2** | A real workflow on an unexposed backend, with the lowest risk of any alternative. It is second because its value is episodic where Attendance's is daily |

### #3 — Manager Team Lens (Employment + Performance only) · Class B

| | |
|---|---|
| **User workflow** | The employments reporting to one manager, as at a date, with their goals and reviews |
| **Customer value** | Moderate, and it compounds whatever is built around it |
| **Commercial importance** | Moderate |
| **Backend readiness** | `employment.search?managerEmploymentId=` and Performance's three manager-filtered reads exist and are reachable |
| **New backend required** | None **if attendance is excluded**; a filter **if it is not** (§M) |
| **Why #3** | Thin standing alone, and its most valuable lens — the team's attendance — is precisely the one the contracts cannot serve today |

**Not ranked:** Self-Service (class D, blocked and structurally asserted closed), Manager Portal
(class D), Relations (backend complete, but its sensitivity argues for settling §I first).

**No slice is selected. #1 is a recommendation awaiting authorization.**

---

## O. Definition of Ready — Attendance as Work

Offered for the owner to accept, amend or reject. Not authorization.

### Routes — two

```
/attendance                                          the register
/attendance/days/[employmentId]/[attendanceDate]     one day, examined
```

The day's address is the pair the contract takes. A third route would be inventing a subject.

### Existing GET APIs

**Register:** `attendance.dashboard` · `attendance.search-exceptions` · `attendance.search-days` ·
`attendance.days-awaiting-recalculation` *(new)* · `attendance.search-corrections` ·
`attendance.list-shifts` · `attendance.list-schedules` · `attendance.read-roster`.

**Day:** `attendance.read-day` *(new, 404-capable)* — day + events + exceptions in one call — plus
`GET /employments/:employmentId` for the name, one bounded read for one identifier.

That takes consumption from 9 of 13 to **11 of 13**. `attendance/export` and `attendance/snapshots`
stay out: the first cannot be typed from the contracts (§B), and the second is Payroll's subject.

### UI surfaces

Register: the six dashboard counts; the **exception queue first**, because it is the work; the days;
the reconciliation queue; then rota, shifts and schedules as configuration. Day: expected against
actual as facts; the exceptions as sentences; the punches; the corrections; the leave state.

### States

All six of §H, per read rather than per page. Specifically: `attendance.event.read` refused must
render the punch list as **withheld**, never empty; a day the module does not have must be a
**404**, and a refusal on the same route must not be.

### Permissions

`attendance.read` · `attendance.event.read`. The composite-read question of §I must be **raised with
the owner before the day route is built**, because a day screen built on `attendance.read-day` shows
punches to a caller who could not read them through `/events`. If the owner rules that the composite
should narrow, that is a backend change and the day route waits.

### Localization — a precondition, not a task

1. Re-nest the six flat dotted keys in both catalogues.
2. Add the **54 untranslated vocabulary values** across 13 sets: `EVENT_KINDS` (4),
   `EVENT_SOURCES` (7), `DAY_KINDS` (4), `SHIFT_KINDS` (5), `SEGMENT_KINDS` (2), `ROSTER_KINDS` (4),
   `DEFINITION_STATUSES` (3), `EXCEPTION_SEVERITIES` (3), `EXCEPTION_STATES` (4),
   `CORRECTION_KINDS` (7), `CORRECTION_STATES` (5), `ROUNDING_MODES` (4), `POLICY_SOURCES` (2).
   Already translated and **not** needing work: all 15 exception kinds, all 5 day states, all 3 leave
   states. Attendance starts far ahead of where Leave did — 54 values against Leave's 131.
3. Harden `check-localization.mjs` to reject a dotted key, closing the class.

### Mobile

1440 px and 390 px. Tables inside the design system's own `Table`, which brings its scroll
container; no page-level horizontal scroll. Durations pinned `dir="ltr"` inside `<bdi>` so a signed
figure keeps its sign — the defect Leave found.

### Tests

Anchored to findings, as Leave's were. At minimum: every day opens; server totals never
`items.length`; refused ≠ empty ≠ withheld per read; **404 renders not-found and 403 does not**; no
`items[0]`; no read inside a `map` over rows; every vocabulary translated; **no raw catalogue key in
English or Arabic** — the test that would have caught §G; identifiers whole and `<bdi>`-isolated; no
control; and the leave state rendered from the day's own field rather than a lookup.

### Out of scope, explicitly

Any write — recording an event, resolving an exception, deciding a correction, recalculating,
approving or locking a day, freezing a period. Device or synchronization status (§D). The
`leaveRequestId` link (§E). The payable snapshot. Self-service. A manager or team lens. Normalizing
Employee Record or Approvals identifiers. The `notFound()` status. Any Organization, Payroll or
Leave change.

---

## P. Separate investigations

Four, each now supported by evidence from more than one slice.

1. **Cross-module reference capabilities** — scope defined verbatim in §J. Six slices now show the
   same problem; Attendance adds the sharpest case and one new instance (`leaveRequestId`).
2. **`notFound()` HTTP status** — §K. Seven routes across five slices, 200 where 404 is meant, with
   a probable cause to confirm. Shared correction; must not be normalized inside one slice.
3. **Identifier consistency** — §L. 108 sites across 34 files and two conventions. A slice can
   settle its own screens; the other 100 sites are a design-system decision.
4. **Contracts completeness — reads served but not typeable.** New, and now a pattern rather than an
   incident: Leave's `BalanceAsOfView`, and Attendance's `AttendanceExport` and
   `ExpectedWorkingDaysView`, are all served or used but absent from their module's
   `contracts/index.ts`, so no screen may type them. The question is whether a served read must
   always publish its view, and whether a gate should enforce it.

Carried forward unchanged: **authorization consistency** (`recruitment.offer.read`,
`employment.reporting-line.read`, `employment.contract.read`, plus the composite-read decisions and
the six permissions for reads that do not exist), and the **`/me` route** — whose absence §M shows is
structurally asserted, making it an owner decision rather than only an engineering one.

---

## Q. Verification

Run on the finished tree. **No result is a cache replay** — every task forced, database live, all
31 migrations verified applied.

| Gate | Result |
|---|---|
| Migrations | `_prisma_migrations` holds **31** finished rows; `prisma/migrations` holds 31 directories |
| `pnpm standards` | pass — `check-standards`, `check-architecture` (186 models), `check-localization` (20 catalogue sets complete), `check-dependencies` (1,983 files, no cycles, no unused, no unreachable) |
| `pnpm format:check` | pass |
| `lint` · `typecheck` · `test` · `build` | **116 successful, 116 total; 0 cached**, 12m 51s (`turbo --force`) |
| Tests | **5,174 passed, 0 skipped, 0 failed** across 24 packages |

---

## R. Git

- Branch: `claude/munaxa-product-readiness-audit-8mr34d`
- Investigation commit: `d619f37`
- Working tree clean; this document is the only change.
- **No local registry workaround committed.** `git diff` on `package.json` and `pnpm-lock.yaml` is
  empty.

---

# INVESTIGATION COMPLETE — AWAITING OWNER REVIEW AND SLICE AUTHORIZATION
