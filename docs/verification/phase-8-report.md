# Phase 8 — Time & Attendance: completion report

**Date** 2026-08-11 · **Plan** [`phase-8-plan.md`](phase-8-plan.md) · **Approved decisions** recorded
before any code was written.

Every claim below is marked with what backs it:

- **IMPLEMENTED** — built here, and covered by a test that would fail if it broke.
- **CONTRACT AVAILABLE** — the seam exists and is honoured, but the capability behind it belongs to a
  later phase and does not work today.
- **NOT VERIFIED** — believed correct, not proved by anything in this repository.

---

## 1. What was built

| | |
| --- | --- |
| Tables | 13, all under row-level security applied by the creating migration |
| Domain aggregates | 5 — shift, schedule, attendance day, attendance policy (plus value shapes: the time event, the segment, the schedule day, the assignment, the roster entry, the exception, the correction, the snapshot, the import batch) |
| Commands | 21 |
| Queries | 13 |
| HTTP endpoints | 34, across seven controllers |
| Permissions | 14 |
| Tests | 95 in the module, 7 more at the API edge — all passing |
| Source files | 82 in the module |

The module is `@work/attendance`, laid out `domain → application → infrastructure → api` with the
dependency direction enforced by lint, and registered on the shared dispatcher and registry like
every module before it.

---

## 2. The event-delivery limitation, stated plainly

Unchanged since Phase 7, and restated because this phase's figures reach payroll:

> **Current event delivery is post-commit, in-process, at-most-once, with no outbox.**
> `PostgresUnitOfWork.execute` commits and *then* dispatches. A process that dies between the two
> loses the events. There is no broker, no queue, no retry and nothing that replays a lost one.

Nothing in this module claims durable delivery, exactly-once processing or outbox semantics. Internal
events are raised and are **not** the mechanism anything depends on
([ADR-0053](../adr/0053-recalculation-is-found-by-asking.md)).

**Event received ≠ recalculation guarantee; event not received ≠ recalculation failure.**

---

## 3. The four reliability properties, and the tests that are their evidence

### 3.1 A day whose inputs moved is found by asking · **IMPLEMENTED**

Every write that moves an input marks the affected days inside the same transaction: ingestion,
rostering, assigning and ending a schedule, publishing a policy, applying a correction. The
reconciliation query names what is marked and the recalculation command clears it.

Evidence: `attendance-reliability.test.ts` — "finds a day whose events arrived, recalculates it, and
finds nothing on a rerun"; `attendance-aftermath.test.ts` — "marks a day when its roster changes, in
the same transaction as the change". Against the real partial index:
`attendance-persistence.integration.test.ts` — "marks a period stale in one statement and finds
exactly those days" and "leaves days outside the marked period alone".

The predicate is **presence of the mark**, matching `attendance_day_stale_idx` exactly. A comparison
against `calculated_at` would lose an input that moved inside the same clock tick as the calculation
it invalidates — which is how the in-memory store was originally written, and what the roster test
caught.

### 3.2 Ingestion is idempotent, and the database decides · **IMPLEMENTED**

The deduplication key is derived in three tiers — the client's idempotency key, then the source's own
reference, then a sha256 digest of the punch — and enforced by the tenant-scoped partial unique index
`attendance_time_event_key`. A repeat is a success carrying `alreadyRecorded: true`, never a 409.

Evidence: `attendance-reliability.test.ts` — the same punch twice, the same punch with no client key
deduplicated by digest, and two concurrent ingestions converging on one event through the race
branch. Against the real index: `attendance-isolation.integration.test.ts` — "lets the index decide
when two submissions of one punch race" (one commits, one gets `23505`, one row remains) and "does
not let one tenant's event key suppress another's". At the HTTP edge:
`attendance.controller.spec.ts` — "returns the same event when a punch is submitted twice".

### 3.3 A raw event is never rewritten · **IMPLEMENTED**

`attendance_time_event` has no update and no delete, in the repository, in the row mapper or in the
migration. An amendment inserts a new event carrying `supersedes_event_id`; a removal writes **no
event** and the correction record is the tombstone.

Evidence: `attendance-aftermath.test.ts` — "corrects a day by superseding an event, keeping the
original" asserts the original is still readable and the superseding event points at it.
`attendance-records.integration.test.ts` — "reports an applied removal so the calculation can leave
the event out" asserts the removed event is still in the table with its original instant.

### 3.4 A civil date is never a truncated UTC instant · **IMPLEMENTED**

The schedule carries the IANA zone; conversion is `Intl.DateTimeFormat` with an explicit `timeZone`,
solved in two passes.

Evidence: `attendance-domain.test.ts` — a small-hours punch resolving to the local date, a
non-whole-hour offset (Kathmandu), a spring-forward day of 1,380 minutes and an autumn day of 1,500,
an overnight shift measured across a transition by real elapsed time. End to end:
`attendance-shifts.test.ts` — "files a small-hours punch under the local date, not the UTC one",
"carries an overnight shift into the next civil date without adding a day", "does not turn a
daylight-saving hour into absence".

---

## 4. The approved decisions, and what each produced

### D-2 — no Organization calendar read, no Attendance calendar · **HONOURED**

Phase 3 was not reopened, no Attendance→Organization calendar adapter was written, and Attendance
builds no calendar. A public holiday is a **roster entry** a tenant records, and the schedule's cycle
decides ordinary rest days. The gap is documented in `docs/modules/attendance.md` and in the roster
use case: the public-holiday calendar is country-pack content a later phase supplies, and two owners
of "is the 23rd a holiday" would produce two answers.

### D-4 — no authoritative work location, no geofence enforcement · **HONOURED**

No `attendance_site`, no location table, no tenant-wide location model, and `unit_id` is not used as
a substitute for a physical place. ADR-0041 and Phase 3 were not reopened.

What exists is **punch location evidence**: optional latitude, longitude and the device's own
accuracy estimate on a time event, where a tenant enables capture. Beside them there is no site
identifier, no geofence, no verdict and no sequence of positions. Coordinates appear on no list
screen and in no export.

[ADR-0055](../adr/0055-the-schedule-owns-the-time-zone.md) states the three-way distinction in the
terms the decision required: **punch location evidence** (built), **an authoritative work location**
(does not exist in this product), **continuous employee location tracking** (not built). The
extension point is preserved and its owning phase is deliberately left unassigned — the ADR says so
rather than assuming Manager Self-Service owns it.

**Geofence enforcement is NOT VERIFIED and not implemented.** It needs both an authoritative location
model and a mobile client whose coordinates can be trusted; this repository has neither.

### D — Leave: three answers, never two · **IMPLEMENTED**

`LeaveCoverage` is `{ known: false }` or `{ known: true, days }`. The three cases produce three
different records:

| Leave says | `leaveState` | Exception |
| --- | --- | --- |
| known, covered | `applied` | `undertime` (information) |
| known, not covered | `none` | `absent_unexplained` |
| cannot be asked | `unknown` | `absence_pending_explanation` |

The adapter wired in the composition root is `leaveUnavailable`, which answers `{ known: false }`. No
leave balance, entitlement or record exists in this module.

Evidence: `attendance-aftermath.test.ts` — "distinguishes leave unknown, no leave, and approved
leave" runs all three through the real pipeline. At the edge: `attendance.controller.spec.ts` —
"reports an unexplained absence as pending explanation while Leave cannot be asked", and "ships a
Leave adapter that admits it cannot answer".

### D — the domain boundary · **IMPLEMENTED**

Attendance owns raw events, days, exceptions, schedules, shifts, rosters, policies, corrections and
the payable snapshot. It owns no Person, no Employment, no Organization, no Leave, no Payroll, no
workflow infrastructure, no notification infrastructure and no document infrastructure. There is no
`person_id` in any of the thirteen tables and no column holds money — both are checked by reading the
migration, and both are stated in the contracts file that publishes the views.

### D — Employment, not Person · **IMPLEMENTED**

`employment_id` with a foreign key on every table that has one. No employee number, no employment
status, no contracted hours, no manager copy. Historical attendance stays with the employment under
which it occurred: the day stores the schedule, shift, policy and their version numbers, so a later
employment change does not rewrite it
([ADR-0051](../adr/0051-attendance-owns-no-employment-fact.md)).

Evidence: `attendance-shifts.test.ts` — "leaves an earlier month on the schedule that was in force
then" reassigns somebody in June and asserts May's digest is unchanged.

### D — deterministic, reproducible calculation · **IMPLEMENTED**

`calculate()` is pure: no clock, no database, no randomness. It records `calculationVersion` and an
`inputsDigest` of everything it read. Recalculating unchanged inputs reproduces the digest and the
row is left alone.

Evidence: `attendance-rules.test.ts` — "produces the same digest and the same buckets for the same
inputs"; `attendance-reliability.test.ts` — "reproduces the same figures when recalculation is
retried".

### D — no exactly-once claim, no outbox · **HONOURED**

Stated in §2, in ADR-0053, in the module documentation and in the release note. No outbox was
introduced and no general-purpose event infrastructure was built.

### D — devices and imports · **IMPLEMENTED** (contract) / **NOT VERIFIED** (integration)

Seven closed sources, none of them a vendor. No SDK is imported at any layer. No raw biometric
template is stored anywhere ([ADR-0057](../adr/0057-a-vendor-is-not-a-source.md)). Import sends the
same `attendance.record-event` command row by row through the real dispatcher, so a re-run
deduplicates for free.

Evidence: `attendance-reliability.test.ts` — "imports a batch, and a re-run skips every row rather
than duplicating it".

### D — offline mobile · **CONTRACT AVAILABLE**

Three timestamps are stored separately and always together: `occurred_at`, `reported_at`,
`received_at`, with the drift on the row and a `captured_offline` flag. The mobile app is not built.

Evidence: `attendance-edge-cases.test.ts` — "accepts an offline punch flushed twice as one event".

### D — overtime is candidate minutes · **IMPLEMENTED**

No rate, no multiplier, no amount, anywhere. Nothing statutory ships: every policy tolerance starts
inert ([ADR-0054](../adr/0054-attendance-produces-candidate-minutes.md)).

---

## 5. Kernel ports and external capabilities: what is real and what is not

| Capability | State | Why |
| --- | --- | --- |
| **Notification delivery** | **NOT VERIFIED** | No notification adapter is wired in this repository, in this module or in any before it. No endpoint here sends anything, and nothing in the module depends on a message arriving |
| **Document storage** | **NOT VERIFIED** | No `DocumentPort` adapter exists. Attendance stores no bytes and has no endpoint that accepts a file |
| **Device integration** | **NOT VERIFIED** | The normalized contract is built and tested; there is no reader in this repository to test an adapter against, and a mock proving a mock works would prove nothing |
| **Biometric capture** | **NOT VERIFIED, and deliberately not built** | No raw template, hash or embedding is stored. Attendance is not a biometric identity service |
| **GPS / geofence verification** | **NOT VERIFIED, and deliberately not built** | There is no authoritative location model to verify a coordinate against (D-4, ADR-0055) |
| **Mobile client** | **NOT VERIFIED** | The contract supports the offline case; the app is a later phase |
| **Leave** | **CONTRACT AVAILABLE** | The port has three answers and the shipped adapter honestly gives the third. Phase 9 replaces one line in the composition root |
| **Payroll consumption** | **CONTRACT AVAILABLE** | `PayableSnapshotView` is published, frozen and sequenced. No payroll module reads it yet |
| **Approval routing** | **CONTRACT AVAILABLE** | `approvalReference` is reserved for Phase 16 and is null. A day is signed off by a named human recorded here |
| **Scheduled recalculation** | **NOT VERIFIED** | The command and the reconciliation query exist; nothing in this repository calls them on a timer. Phase 24 owns job infrastructure |

---

## 6. Platform boundary

Every business endpoint returns 401 until Platform supplies an authentication adapter (ADR-0032).
This is unchanged and is why the administration screen fails closed to its empty state rather than to
an error page.

---

## 7. Authorization · **IMPLEMENTED**

Fourteen permissions, all Attendance-specific. No broad People or Organization management permission
is introduced or required. Six separations are deliberate and each is covered by a test:

- recording an event is not managing attendance (a turnstile's service account cannot sign a day off);
- reading a day is not reading its raw events, which carry device evidence;
- requesting a correction is not deciding one — **and the domain and the database both refuse
  self-approval**, so the separation survives somebody holding both;
- publishing a schedule or shift is not drafting one;
- freezing a period is its own permission, because it is the number Payroll pays;
- exporting is narrower than reading, because an export is the largest disclosure this module makes.

The one cross-module read runs under a **bounded service grant** (ADR-0043): an explicit single-item
list (`employment.employment.read`), non-nesting, tenant and actor untouched, every elevation logged.

Evidence: `attendance-authorization.test.ts` — six refusal cases through the real dispatcher, the
reviewer who can read a day but not its punches, and the self-approval refusal for a caller granted
everything. `attendance.controller.spec.ts` — a 403 at the HTTP edge, and a 400 (not 422) for a
malformed body.

---

## 8. Tenant isolation · **IMPLEMENTED**

All thirteen tables carry row-level security applied by the creating migration. The integration suite
connects as a role that owns nothing and holds no `BYPASSRLS` — the only configuration under which
any of it means anything.

Nine assertions in `attendance-isolation.integration.test.ts`: every table protected; punches hidden
by identifier, by key, by day and by search; days, exceptions and the reconciliation queue hidden;
**`markStale` cannot touch another tenant's month** (the bulk statement, which writes by predicate
rather than by identity, and would therefore fail silently rather than loudly); schedules, shifts,
rotas, assignments and policies hidden; corrections and snapshots hidden; one tenant's event key not
suppressing another's punch; and a day refused for an employment that does not exist.

The application suite proves the same scope through the dispatcher without a database, so the fast
tests exercise the tenant filter too.

---

## 9. Performance, measured

`node scripts/measure-attendance-performance.mjs`, against PostgreSQL, as the **unprivileged
application role under row-level security**, median of five runs.

Seeded: **100,000 employments, 1,440,000 time events, 360,000 attendance days, 32,000 of them stale,
24,000 open exceptions.**

| Read | Median | Budget |
| --- | ---: | ---: |
| Deduplication read (before every punch) | **0.7 ms** | 50 ms |
| One day for one employment (the ingestion touch) | **0.8 ms** | 50 ms |
| One day's events (per day, per recalculation) | **1.5 ms** | 50 ms |
| The reconciliation read (partial index, bounded) | **32.0 ms** | 50 ms |
| One employment's ninety days | **2.6 ms** | 50 ms |
| The daily attendance screen (one date, paged) | **45.2 ms** | 50 ms |
| The open exception queue (indexed, paged) | **12.6 ms** | 50 ms |
| Blocking exceptions for one employment and month | **2.3 ms** | 50 ms |
| Schedule assignment lookup | **0.4 ms** | 50 ms |
| Roster window for one employment | **0.5 ms** | 50 ms |
| Dashboard counts for one date | **1.6 ms** | 50 ms |
| One employment's punches, paged | **1.2 ms** | 50 ms |

Every target met. The reconciliation read uses `attendance_day_stale_idx` — the plan is printed by
the script and shows a bitmap index scan over 32,000 rows out of 360,000, not a sequential scan.

Two figures are close to budget and are named rather than rounded down. The **daily attendance
screen** at 45.2 ms is dominated by fetching 4,000 wide rows for one date before paging them; it is
the read most likely to need attention first, and the answer would be a narrower projection rather
than another index. The **reconciliation read** at 32.0 ms sorts 32,000 stale rows to take 200; the
partial index finds them in 0.7 ms and the sort is the rest.

There is no N+1 in the module: exceptions for a page of days are read with `= any(...)`, shifts and
segments likewise, and `markStale` and `supersedeOpen` are single statements rather than loops.

---

## 10. Quality gates

| Gate | Result |
| --- | --- |
| Engineering standards (file budgets, complexity, parameters, no `any`, no suppressions, no TODOs) | **pass** — no violations |
| Architecture (Prisma model conventions) | **pass** — 67 models checked |
| Localization (en/ar catalogue parity) | **pass** — 8 catalogue sets complete |
| Dependencies (no cycles, no unused, no unreachable) | **pass** — 672 source files |
| `format:check` | **pass** |
| `lint` | **pass** |
| `typecheck` | **pass** |
| `test` | **pass** — 1,109 tests across the repository, 95 of them this module's plus 7 at the API edge |
| `build` | **pass** |

Migration applied cleanly to a real database; the integration suites run against it.

---

## 11. Production completeness

Nothing in this phase counts a mock as a capability. Specifically:

- there is **no mock device integration** and no fake biometric integration — the contract exists and
  the integration is marked **NOT VERIFIED**;
- there is **no fake GPS verification** and **no fake geofence enforcement** — a verdict with nothing
  behind it would be a claim;
- there is **no fake mobile synchronization** — three timestamps and an idempotency key support the
  case; no app is claimed;
- there are **no fake notifications** and **no fake documents**;
- there are **no placeholder calculations, no hardcoded schedules and no simulated payroll output** —
  a tenant with no policy gets a named refusal, not a calculation against invented defaults.

**This product ships no attendance data.** No shift, no schedule, no policy, no grace period, no
rounding rule and no overtime threshold. Every tolerance starts at zero until a customer configures
it, because in several of this product's markets those numbers are statutory (00B).

---

## 12. Critical edge cases, and where each is covered

| Case | Covered by |
| --- | --- |
| Overnight shift | `attendance-shifts.test.ts`, `attendance-rules.test.ts` |
| Split shift | `attendance-shifts.test.ts` |
| Flexible schedule | `attendance-shifts.test.ts`, `attendance-rules.test.ts` |
| Cross-midnight punch | `attendance-shifts.test.ts` |
| Duplicate punch | `attendance-capture.test.ts` (near-duplicate window), `attendance-reliability.test.ts` |
| Out-of-order punch | `attendance-edge-cases.test.ts`, `attendance-domain.test.ts` |
| Missing punch | `attendance-edge-cases.test.ts` (and approval refused) |
| Late punch / early departure | `attendance-edge-cases.test.ts`, `attendance-rules.test.ts` |
| Multiple punches | `attendance-domain.test.ts` |
| Device retry | `attendance-reliability.test.ts` |
| Mobile retry / offline event | `attendance-edge-cases.test.ts` |
| Clock drift | `attendance-edge-cases.test.ts`, `attendance-capture.test.ts` |
| DST transition | `attendance-domain.test.ts`, `attendance-shifts.test.ts` |
| Schedule time zone | `attendance-domain.test.ts`, `attendance-shifts.test.ts` |
| Schedule change after the attendance date | `attendance-shifts.test.ts` |
| Employment assignment change after the date | `attendance-shifts.test.ts` |
| Employment termination | `attendance-edge-cases.test.ts` |
| Leave known / no leave / unknown | `attendance-aftermath.test.ts` |
| Recalculation retry | `attendance-reliability.test.ts` |
| Concurrent event ingestion | `attendance-reliability.test.ts`, `attendance-isolation.integration.test.ts` |
| Concurrent correction | `attendance-aftermath.test.ts`, `attendance-records.integration.test.ts` |

---

## 13. Technical debt this phase records

| | Item | Why it was not done here |
| --- | --- | --- |
| **D-1** | **No outbox and no published event contract** (inherited) | The approved decision was explicit. Attendance is built so the gap costs nothing: the mark is written in the same transaction and reconciliation is the guarantee. Phase 16/17 own the fix |
| **D-2** | **Recalculation needs something to call it.** There is no scheduler | Phase 8 introduces no job infrastructure. The command and the query exist; who runs them is a deployment decision |
| **D-3** | `row-writer.ts` is a fourth near-copy | Hoisting it into `@work/persistence` changes a package every phase depends on. Fourth occurrence, and the case for extracting it is now strong enough that the next phase to need it should |
| **D-4** | **A roster entry cannot move somebody to a different zone for one night** | The schedule's zone applies. Modelling a per-day zone override needs a location or travel model this product does not have, and inventing one here is what D-4 forbade |
| **D-5** | **Foreign-key indexes lead with `tenant_id`, so hard deletes scan** (inherited, and worse here) | `attendance_time_event` references itself, so a hard delete of a million rows is a million scans. The product soft-deletes and never meets it; a future retention sweep would. Documented in the benchmark script |
| **D-6** | **The daily attendance screen fetches wide rows before paging** (45.2 ms at 4,000 rows for one date) | Correct at the measured volume. A narrower projection for the list is the answer if it ever is not, and it is a contract change rather than an index |
| **D-7** | **No attendance policy list endpoint** | A policy is read through the day it governed, which stores the policy and its version. A list read invites reading "the" policy rather than the one in force on the disputed date |
| **D-8** | ~~**The composition root's Employment call was never exercised**~~ | **Closed by §13a.** Every cross-module adapter in this repository was, until now, covered only by a fake. The lesson generalises: a fake answers whatever it is asked, so it cannot notice that the question was malformed. Recruitment's and Onboarding's composition adapters remain uncovered at their real boundary, and are the next candidates |

---

## 13a. Defect fix after approval — the composition-root call to Employment

**Date** 2026-08-10 · Found by the Phase 9 Definition of Ready's repository analysis, corrected
before Phase 9 implementation began, on the approver's instruction. A corrective fix, not a feature
change: no domain model, schema, migration, endpoint or screen was touched.

`apps/api/src/attendance/attendance.composition.ts` held **two** defects in one call, and the second
was found only by the regression test written for the first.

**Defect 1 — a civil date sent where an instant was required.** `AttendanceEmploymentDirectory.find`
took a civil attendance date and passed the *string* to `employment.read-employment`, whose published
contract is `asOf?: Date`. The call site cast the literal to `Query`, so the compiler saw nothing. At
runtime the value reached `DateRange.contains(instant)` → `instant.getTime()`, which throws on a
string.

**Defect 2 — the response read as though it were flat.** `employment.read-employment` returns an
`EmploymentSnapshot`, which *wraps* the employment alongside its assignments, its reporting line and
`statusOn`. The adapter destructured it as a flat `{ employmentId, status, startDate, … }`, so every
field it took would have been `undefined`. Defect 1 masked it: the call threw before the mapping ran.

Both were unreachable in production only because every business endpoint returns 401 until
Platform's authentication adapter lands (ADR-0032), and because every other Attendance test uses
`FakeEmployment`, which answers whatever it is asked and therefore cannot notice a malformed
question.

**The correction.**

- The civil date is converted to UTC midnight by `asOfInstant`, which is the same conversion
  Employment's own edge performs on a ten-character date (`employment/src/api/as-of.ts`). Employment's
  contract was **not** changed to accommodate the caller: it was already right.
- The response is typed as Employment's own published `EmploymentSnapshot` rather than a guessed
  shape, and flattened by `fromSnapshot`. **`statusOn` is preferred over the employment row's
  `status`** — the row answers "now", `statusOn` is reconstructed from the status history and answers
  "then", and a March recalculation must see March.
- Both `as Query` casts are gone. The two queries are typed against local interfaces that mirror
  Employment's, so the next mismatch is a compile error in this file rather than a `TypeError` in
  production. The mirror is named as a mirror in the file, because Employment does not export its
  query types and adding an export to a completed phase to satisfy a caller is the wrong direction.

**The regression test.** `apps/api/src/attendance/attendance.composition.spec.ts` registers **both**
modules on one real dispatcher and exercises the real adapter — the first test in this repository to
cross that boundary without a fake. Four cases: an employment resolved as at a civil date; the
malformed shape the adapter used to send, asserted to be refused; the `asOf` genuinely reaching
Employment rather than defaulting to today; and the roster scan.

Both defects were verified to fail the suite before the fix, by reintroducing each in isolation:

| Reintroduced | Failure |
| --- | --- |
| The civil-date string | `TypeError: instant.getTime is not a function`, in `versioned-child.ts` |
| The flat mapping | `expected undefined to be '019df15b-…'` — every field lost |

`pnpm verify` passes: all four gates, format, lint, typecheck, **1,113 tests** (103 in the API, up
from 99) and build.

---

## 14. What Phase 8 does not include

Leave, compensation, payroll, benefits, performance, learning, career development, offboarding,
workforce relations, full document management, loans and advances, health and claims, country
compliance packs, government integrations, mobile and AI are all untouched. There is no employee
self-service and no manager self-service UI, as scoped — only the contracts a future phase will
consume, and no punch button on an administrator's screen. Phases 0 through 7 are unmodified.

---

## 15. Verdict

Phase 8 is complete against its approved decisions. The Attendance domain is implemented end to end —
schema, domain, application services, persistence, API, administration screen, documentation and
tests — with every quality gate passing and every performance target met at a million events.

The phase's four central risks are answered rather than described. A punch cannot be rewritten,
because no code path exists that could. A stale figure is found by asking rather than by waiting for
an event this product cannot promise to deliver. A civil date is resolved in the schedule's own zone,
so a night shift lands on the day it belongs to. And where Leave cannot be asked, the record says so
instead of asserting that somebody was absent without leave.

The capabilities that genuinely do not work — device and biometric integration, geofence
verification, mobile synchronization, notification delivery, document storage, scheduled
recalculation — are marked **NOT VERIFIED** with their reasons, rather than approximated by a stub
that would make this report read better and the product worse.
