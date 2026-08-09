# Phase 8 — Time & Attendance: Definition of Ready

**Date** 2026-08-10 · **Baseline** `fda3cf9` (Phase 7 approved and complete) · **Status** planning
checkpoint. No application code, no schema and no migration is changed by this document.

This is an analysis of what the repository *is*, not a restatement of what the phase documents say
it should be. Where the two disagree, the repository is authoritative for implemented behaviour and
the architecture documents are authoritative for approved intent; every such disagreement is named
in §36 or §37 rather than silently resolved.

---

## 1. Repository Analysis

### 1.1 What exists

| | |
| --- | --- |
| Modules | `identity` (2), `organization` (3), `people` (4), `employment` (5), `recruitment` (6), `onboarding` (7) |
| Prisma models | 54, all tenant-first, audited, versioned, soft-deleted, `snake_case`-mapped |
| Migrations | 7, most recent `20260810090000_onboarding` |
| Tests | 1,007, all passing; integration suites run against a real PostgreSQL as an unprivileged role |
| Packages | `@work/kernel`, `@work/persistence`, `@work/config`, `@work/testing`, `@work/contracts`, `@work/sdk`, `@work/country-packs` |

**There is no attendance table, model, module or contract anywhere in the repository.** The word
appears only in prose: in the kernel's `ApprovalPort` and rule-engine doc comments (both of which
name Attendance as a future consumer), in ADR-0040 and ADR-0041, and in Employment's contract header
listing the modules that will read it. Phase 8 is greenfield inside a settled architecture.

`packages/country-packs` exists and **exports nothing** — bootstrapped in Phase 0 so its build and
project-reference graph are proven, filled in Phase 11.1.

### 1.2 The five load-bearing mechanisms Phase 8 inherits

1. **CQRS pipeline** (`@work/kernel`). One shared `Dispatcher` and `ModuleRegistry`, assembled in
   `apps/api/src/identity/identity.module.ts`. A handler declares `commandName`/`queryName` and a
   `permission`; the pipeline applies tenancy, then authorization, then validation, then the handler.
2. **Unit of work** (`PostgresUnitOfWork`). Fresh connection, `begin`, `set_config('app.tenant_id',…,
   true)`, the work, `commit`, **then** `dispatcher.dispatch(collected)`. Post-commit, in-process,
   at-most-once, **no outbox**. §27 and §31 of this plan are consequences of that one fact.
3. **Row-level security** applied by the creating migration (`call app_protect_table(...)`), with
   `force row level security` and both `using` and `with check` (ADR-0030). Integration suites connect
   as a role with no `BYPASSRLS`.
4. **Bounded service grant** (ADR-0043). `runWithServiceGrant` + `GrantAwarePermissionChecker`: a
   module holds a named, explicitly listed cross-domain permission for one operation, the user is
   still checked for the operation they asked for, grants cannot nest, the actor and correlation stay
   on every audit column, and every elevation is logged.
5. **Idempotent command + reconciliation** (ADR-0050). The pattern Phase 7 established for work whose
   correctness cannot rest on event delivery: a command safe to retry, a database constraint that
   decides races, and a query that names what is missing.

### 1.3 Kernel capabilities Phase 8 will use rather than rebuild

| Capability | Where | Phase 8 use |
| --- | --- | --- |
| `Timeline` / `EffectiveDated` | `kernel/effective` | Schedule assignments, policy versions |
| `evaluateRule`, `versionInForce` | `kernel/rules` | Exception rules and, later, country-pack thresholds. Deterministic, total, self-explaining, sandboxed — rules are data, not code |
| `project`, `verifyRebuild` | `kernel/projection` | Attendance summaries as rebuildable read models |
| `toHijri` / `toGregorian` | `kernel/time` | Display and input only. **Not** attendance-date arithmetic |
| `DateRange`, `Quantity` | `kernel/value` | Periods and durations |
| `pagedResult`, `cursorResult` | `kernel/paging` | Every collection API |
| `ApprovalPort`, `NotificationPort`, `DocumentPort` | `kernel/ports` | Declared; **none wired into `apps/api`**; no `DocumentPort` implementation exists anywhere |

**The kernel has no IANA time-zone helper.** `kernel/time/calendar.ts` formats in `UTC` and relies on
ICU through `Intl`. Phase 8 needs zone-aware civil-date resolution, and §22 states where that lives.

### 1.4 Two measured findings from earlier phases that bind Phase 8

- **`ilike` under RLS is a sequential scan** (Phase 6, measured at ~110 ms over 100,000 rows). The
  policy qualifier is applied before a non-leakproof pattern match, so no trigram index is used. Phase
  8 must therefore not put free-text search on a high-volume table.
- **Foreign-key indexes lead with `tenant_id`, so hard deletes scan** (Phase 7 debt D-5). A delete's
  FK check asks for the child column alone and cannot use a `(tenant_id, …)` index. At 1,000,000 events
  this is materially worse than at 400,000 tasks. Phase 8 must not introduce a hard-delete path, and
  §34 states the consequence for any future retention sweep.

---

## 2. Phase 0–7 Compatibility Analysis

| Phase | What Phase 8 consumes | What Phase 8 must not do |
| --- | --- | --- |
| 1 — Foundation | Kernel, persistence, RLS, ports, rule engine, projections | Reimplement any of them |
| 2 — Identity | Tenant resolution from stored membership (ADR-0032); the execution context (tenant, actor, correlation) | Resolve a tenant from a request; invent an identity |
| 3 — Organization | `organization.tenant-settings` → `timeZone`, `language`, `calendar` | Duplicate the unit hierarchy or the calendar model |
| 4 — People | Nothing. Attendance never references a Person (AD-001) | Store a name, an identifier or any personal attribute |
| 5 — Employment | `employment.read-employment` (with `asOf`), `employment.search`, `employment.read-history` | Create an employee table, an employee number, a manager model, or contracted hours |
| 6 — Recruitment | Nothing | — |
| 7 — Onboarding | Nothing directly; inherits its idempotency and reconciliation architecture | — |

**No completed phase is modified.** Two integration gaps are identified (§3.3, §5.2) and each is
carried as a decision with a fully supported fallback rather than as an edit to a completed phase.

### 2.1 Architectural precedents Phase 8 follows deliberately

- **ADR-0045 / ADR-0049** — an approval is a decision by a named human, recorded here, with an
  `approval_reference` column reserved and null until Phase 16. Nothing consumes `AutoApprovingPort`.
- **ADR-0047** — a domain references the authoritative record and copies no fact from it.
- **ADR-0048** — a definition consumed by many records is immutable once published, and the record
  copies what it was given. §10, §11 and §15 apply this to shifts, schedules and policies.
- **ADR-0050** — correctness rests on an idempotent command plus reconciliation, never on an event.
  §15.5 applies this to recalculation.

---

## 3. Platform Contract Analysis

### 3.1 What Platform provides and Phase 8 consumes unchanged

Authentication (`PlatformAuthenticationPort`), authorization (`PlatformPermissionChecker` behind
`GrantAwarePermissionChecker`), tenant context, tenant isolation, UI (`@munaxa/ui`), design tokens,
configuration (`@work/config` — the only place `process.env` is read), and observability (the pino
logger the elevation observer already writes to). Phase 8 duplicates none of them.

### 3.2 Platform gaps carried forward, unchanged by this phase

| | Gap | Effect on Phase 8 |
| --- | --- | --- |
| **P-1** | **No authenticated-member → employment resolution.** The execution context carries a tenant, an actor and a correlation identifier, and nothing else | Every self-service contract (§27) is published and tested but **not routed**, exactly as Phase 7 left `onboarding.read-my-tasks`. A route that took the employment from the request is how somebody punches for a colleague |
| **P-2** | **Every business endpoint returns 401** until Platform's authentication adapter is supplied (ADR-0032) | The admin screen fails closed into its empty state; endpoint behaviour is proved by the API suites |

### 3.3 A gap this phase surfaces

**Organization publishes no calendar read.** `OrganizationCalendarView` and `CalendarDayView` are
exported contract types, and calendars are created and amended through
`organization.define-calendar` / `organization.record-calendar-day`, but the only *read* is inside
`organization.export-structure`, behind the export permission. There is no
`organization.read-calendar`.

This is analysed in §5.2 and carried as decision **D-2**, with a fallback that ships the phase
without touching Phase 3.

---

## 4. Employment Integration

### 4.1 The port, and what is absent from it

```ts
interface EmploymentDirectoryPort {
  /** One employment as it stood on a date. Never "as it is now" when calculating history. */
  find(employmentId: string, asOf: Date): Promise<EmploymentForAttendance | undefined>;
  /** A bounded page of employments that could have attendance. Roster and reconciliation reads. */
  employmentsInScope(request: ScopeRequest): Promise<readonly EmploymentForAttendance[]>;
}

interface EmploymentForAttendance {
  readonly employmentId: string;
  readonly status: string;          // active | suspended | ended | draft | pending_approval
  readonly startDate: string;       // civil date
  readonly endDate?: string;
  readonly unitId?: string;         // the assignment in force on asOf — for scoping, never for place
  readonly managerEmploymentId?: string;
  readonly contractedHoursPerWeek?: number;  // Employment's contract. Read, never stored.
}
```

**There is no `create`, no `update`, and no `personId`.** No `create` for the reason ADR-0047 gave:
a port with one is a port a defect can misuse. No `personId` because AD-001 says Attendance never
references a Person, and Attendance genuinely never needs to — it identifies an employment, and
resolving that to a human being is People's read behind People's permission.

Both methods run under a bounded service grant permitting exactly `employment.employment.read`
(§24.3). An HR administrator reviewing attendance does not thereby become a reader of the employment
register.

### 4.2 What is resolved from Employment, and when

| Question | Answered by | Read at |
| --- | --- | --- |
| Does this employment exist in this tenant? | `find` | Event ingestion, and again at calculation |
| Was it active on the attendance date? | `find(asOf = attendance date)` → `statusOn` | Calculation |
| Which unit did it sit in on that date? | `find(asOf)` → assignment in force | Scoping and reporting only |
| Who was the manager on that date? | `find(asOf)` → reporting line in force | The MSS contract (§28) |
| What are the contracted hours? | `find` → contract in force | Policy inputs — **read, never copied** |

`employment.read-employment` already accepts `asOf` and reconstructs `statusOn` from the status
history rather than reading the row. That is precisely the shape historical recalculation needs, and
it is the reason no employment fact is stored in Attendance.

### 4.3 What Attendance must never build

No `employee` table. No employee number. No duplicate manager or reporting-line model. No copy of
contracted hours. No employment status column on any attendance row. §6.2 states the field-by-field
test a reviewer should apply.

### 4.4 Termination and the attendance that precedes it

An employment that ends keeps every attendance day it accumulated: the rows carry `employment_id`
and nothing rewrites them. Events *after* the end date are refused as a named conflict rather than
silently dropped, because a device that keeps sending punches for a departed employee is an
operational fact somebody should see. This is asserted as an edge case in §33.

---

## 5. Organization Integration

### 5.1 What is consumed

`organization.tenant-settings` → `timeZone`, read once per calculation batch and used only as the
**default** zone. The unit identifier from Employment's assignment is used for scoping a query
("today's attendance for the Riyadh operations unit") and for nothing else.

### 5.2 The time zone does not come from Organization, and that is the design

A shift written as `08:00–17:00` is meaningless without a zone. The zone therefore belongs to the
thing that states the wall-clock times — **the schedule** — and is a required column on it (§10).
Resolution order for an event's zone:

```
roster entry's shift → schedule's zone → tenant setting's zone
```

This resolves §24 without a work-location model and without a calendar read. It is also more correct
than either: two teams in one tenant, in two countries, on two schedules, get two zones, and neither
depends on where Organization happens to have modelled them.

### 5.3 Holidays: the gap, and the fallback that ships without Phase 3 changing

Attendance needs "was this a non-working day". Three sources are possible, and only two are legitimate:

| Source | Status |
| --- | --- |
| The schedule's own cycle (rest days) plus explicit roster entries of kind `holiday` | **Available today.** Tenant-entered, effective-dated, reconstructable |
| Organization's calendar (`OrganizationCalendarView.workingDays`, `CalendarDayView.kind = 'holiday'`) | **Modelled but unreadable** — no published query (§3.3) |
| A calendar inside Attendance | **Forbidden.** Two owners of "is the 23rd a holiday" produce two answers |

00B is explicit that the working week and public-holiday calendars are **country-pack** content
(Phase 11.1), which makes the fallback more defensible than it first appears: the durable answer is
a country pack, and Organization's calendar is a tenant override of it. Until either exists, a rest
day is a schedule fact and a public holiday is a roster entry.

Recorded as **D-2**. Recommendation: take the fallback, and let Phase 11.1 establish the read.

---

## 6. Attendance Domain Boundary

### 6.1 What Attendance owns

Time events · attendance days and their state · exceptions · corrections and their approval ·
shifts · schedules · schedule assignments · rosters · attendance policies · the payable snapshot
Payroll consumes · attendance history · imports.

### 6.2 What Attendance does not own, and the test for a violation

| Concept | Owner | The column that would be the violation |
| --- | --- | --- |
| The human being | People | any name, identifier, nationality, contact |
| The employment relationship | Employment | `employee_number`, `employment_status`, `contracted_hours` |
| Structure | Organization | a unit, position or cost-centre *definition* |
| Entitlement to be absent | Leave (9) | `leave_balance`, `leave_type`, `entitlement_days` |
| What time is worth | Compensation (10) / Payroll (11) | any money column, any rate, any multiplier |
| Routing a decision | Workflow (16) | an approver chain, an escalation, a step |
| Delivering a message | Communications (17) | a template, a recipient address, a delivery status |
| A place of work | nobody yet (ADR-0041) | `work_location_id` pointing at a unit |

A reviewer should read the proposed migration once looking only for those columns.

### 6.3 The distinction the whole module rests on

```
raw time event  ──►  calculation (schedule + roster + policy + approved leave)  ──►  attendance day
   immutable                            deterministic, versioned                      derived, replaceable
```

A punch is not an attendance result, and an attendance result is not a fact somebody recorded — it
is a *derivation* whose inputs are all still present. That is what makes a correction auditable and a
recalculation honest.

---

## 7. Aggregate Model

Seven aggregates. The in-repo specification lists ten; three of them are not aggregates in this
design and §37 (**D-1**) asks for that reduction to be confirmed, exactly as Phase 7's D-4 was.

| Aggregate | Consistency boundary | Why it is one |
| --- | --- | --- |
| `TimeEvent` | One event | Append-only and immutable. It has one invariant — it never changes — and a factory that enforces its shape |
| `AttendanceDay` | One employment, one attendance date, and its exceptions | The state machine (`calculated → under_review → approved → locked`) and the exception set must agree in one transaction |
| `Shift` | One shift version and its segments | Adding a segment to a published shift must be refused as one decision, not raced |
| `Schedule` | One schedule version and its cycle days | As above |
| `ScheduleAssignment` | One employment's assignment timeline | Non-overlap is the invariant |
| `AttendancePolicy` | One policy version | Immutable once published |
| `CorrectionRequest` | One request | Its own lifecycle (`requested → approved/rejected → applied`) and its own permission |

**Not aggregates, deliberately:**

- **`AttendanceException`** — a child of the day. An exception that could be resolved without the day
  agreeing is an exception a screen shows as open on a day that reads as closed.
- **`AttendanceApproval`** — a decision recorded *on* the day or the correction, with the actor and
  the instant, exactly as ADR-0045 records a requisition approval. An approval aggregate would be the
  first vertebra of a second workflow engine.
- **`AttendanceSummaryProjection`** — a projection, rebuildable from days (§30.4). Making it an
  aggregate would make a derived number writable.

`RosterEntry` and `PayableSnapshot` are records rather than aggregates: the first has one invariant
(one entry per employment per date) enforced by an index, the second is frozen at creation.

---

## 8. Raw Event Model

### 8.1 The row

`attendance_time_event`, the highest-volume table in the product.

| Column | Purpose |
| --- | --- |
| `employment_id` | Whose. Never `person_id` (AD-001) |
| `event_kind` | `clock_in`, `clock_out`, `break_start`, `break_end` — closed, checked in the database |
| `source` | `web`, `mobile`, `device`, `manual`, `import`, `api`, `correction` — closed |
| `source_reference` | The originating system's own identifier, opaque. Never parsed |
| `device_reference` | An opaque device or client identifier, for audit and for the duplicate-device case |
| `occurred_at` | The authoritative instant, UTC |
| `reported_at` | The instant the client claimed, UTC. Kept even when it equals `occurred_at` |
| `received_at` | The instant the server accepted it |
| `clock_skew_seconds` | `reported_at − received_at`, stored because it is evidence, not an error |
| `captured_offline` | Whether the client queued it before sending |
| `zone` | The IANA zone resolved at ingestion, stored so a recalculation years later uses the zone that applied |
| `attendance_date` | The resolved civil date (§26). Derived at ingestion, recomputed by recalculation |
| `event_key` | The deduplication identity (§8.3) |
| `supersedes_event_id` | Set only on a `correction` event. The original stays |
| `latitude`, `longitude`, `accuracy_metres` | Optional, tenant-gated (§31.2) |
| `note` | Free text on a manual entry, length-bounded |
| `import_batch_id` | Provenance when the source is `import` |
| `metadata` | Tenant data, never interpreted |

### 8.2 Immutability, and how it is enforced rather than promised

The repository already has the mechanism: `TaskEventRepository` in Phase 7 does not extend
`Repository`, so it has no `updateRow`, no `softDeleteRow` and no `restoreRow` — a history that can
be amended is not history, and the cheapest guarantee is to have no method that could. The event
store follows it exactly: **insert and read, and nothing else.**

The row still carries `deleted_at`/`deleted_by` because the schema gate requires them and because a
genuine erasure obligation (a GDPR request reaching Attendance through People) needs somewhere to
land. No code path in Phase 8 writes them.

### 8.3 Event identity and deduplication

Duplicates arrive from device retries, mobile offline queues, import re-runs and impatient users. The
strategy is one deterministic key and one database constraint, in the ADR-0050 lineage:

```
event_key =
  client-supplied idempotency key         when the caller sends one (mobile, API)
  source || ':' || source_reference       when the source has its own stable identifier
  digest(employment_id, event_kind, occurred_at, source, device_reference)   otherwise
```

```sql
create unique index attendance_time_event_key
  on attendance_time_event (tenant_id, event_key)
  where deleted_at is null;
```

Ingestion reads the key first and returns the existing event as a **success** — `alreadyRecorded:
true`, not a `409`. A retry that fails is not an idempotent endpoint. Two concurrent submissions race
on the index, the loser reads the winner, and both callers see the same event identifier. This is
Phase 7's proven shape, applied to a table three orders of magnitude larger.

The digest fallback deduplicates a device that resends the same punch. It deliberately does **not**
deduplicate two genuine punches at the same instant from different devices — those differ by
`device_reference`, both are recorded, and the `duplicate_punch` exception asks a human which is real.

---

## 9. Attendance Result Model

### 9.1 The row

`attendance_day`, one per `(tenant, employment, attendance_date)`, enforced by a unique index.

| Group | Columns |
| --- | --- |
| Identity | `employment_id`, `attendance_date`, `zone` |
| Inputs as resolved | `shift_id`, `schedule_id`, `schedule_version`, `policy_id`, `policy_version`, `roster_entry_id` |
| Expected | `expected_start_at`, `expected_end_at`, `expected_minutes`, `expected_break_minutes`, `day_kind` (`working`, `rest`, `holiday`, `unscheduled`) |
| Actual | `first_in_at`, `last_out_at`, `worked_minutes`, `break_minutes_taken`, `paid_break_minutes` |
| Derived buckets | `regular_candidate_minutes`, `overtime_candidate_minutes`, `unpaid_minutes`, `absence_minutes` |
| Leave overlay | `leave_minutes`, `leave_state` (`none`, `applied`, `unknown`) — §17 |
| State | `state`, `approved_at`, `approved_by`, `locked_at`, `approval_reference` (reserved, null) |
| Reproducibility | `calculation_version`, `inputs_digest`, `calculated_at`, `inputs_changed_at` |
| Standard | tenant, audit, soft delete, `version`, `metadata` |

### 9.2 It is a derivation, and it says so

`inputs_digest` is a hash of the ordered event keys plus the identifiers and versions of the
schedule, shift, policy and roster entry used. Two consequences:

- **Reproducible.** Re-running the same calculation version over the same inputs must produce the
  same row; a test asserts it.
- **Staleness is detectable without an event.** Anything that changes an input — a new event, a
  roster change, a published policy — writes `inputs_changed_at` on the affected days **in the same
  transaction as the change**. §15.5 explains why that is not optional.

### 9.3 State

```
calculated ──► under_review ──► approved ──► locked
     │              │
     └──────────────┴──► recalculated (back to calculated, with the reason recorded)
```

`approved` is a human sign-off; `locked` is set when the day has been frozen into a payable snapshot
(§18). A locked day is not immutable — a correction may still arrive — but correcting it produces a
**new snapshot sequence** rather than altering the one Payroll already read.

---

## 10. Schedule Model

A schedule states what is expected, in cycle positions rather than in dates, so one schedule serves
every employment assigned to it.

| Column | Notes |
| --- | --- |
| `code`, `name` (bilingual) | Authored data, both languages required (00B) |
| `zone` | **Required IANA zone.** §5.2 |
| `cycle_length_days` | 7 for a weekly schedule, 28 for a four-week rotation, 1 for a daily pattern |
| `cycle_anchor_date` | The civil date at which cycle position 0 begins. What makes a rotation reconstructable years later |
| `status` | `draft`, `published`, `superseded` |
| `version_number`, `published_at`, `published_by` | ADR-0048's shape |

`attendance_schedule_day` maps a cycle position to a shift or to a rest day. Zero rows for a position
means rest.

**Published schedules are immutable.** Improving a rota drafts the next version; the published one
stays exactly as it was, because attendance days were calculated from it and an auditor will read it.
This is ADR-0048's argument, and it is what makes §23 answerable.

### 10.1 Assignment

`attendance_schedule_assignment` is the effective-dated link Employment → Schedule, held as a
`Timeline`: non-overlapping by construction, because two schedules in force on one day is two answers
to "when was this person expected at work". A gap is legitimate and means *unscheduled*.

---

## 11. Shift Model

A shift is a named pattern of expected time, versioned and immutable once published.

| Column | Notes |
| --- | --- |
| `code`, `name` (bilingual) | |
| `shift_kind` | `fixed`, `flexible`, `split`, `night`, `open` — closed set, checked |
| `start_local`, `end_local` | Wall-clock `HH:MM` in the schedule's zone. Never instants |
| `crosses_midnight` | Derived and stored, because every query about overnight work filters on it |
| `flex_window_minutes` | For `flexible`: how far the start may move |
| `core_start_local`, `core_end_local` | For `flexible`: the hours attendance is required |
| `grace_in_minutes`, `grace_out_minutes` | Lateness tolerance, per shift; the policy may narrow it |
| `expected_minutes` | The authored expectation, so a DST day does not silently change what was asked |

`attendance_shift_segment` carries the ordered segments: `work` and `break`, each with
`start_local`, `end_local`, and for a break `paid` (boolean). A split shift is two `work` segments
with a gap. This is why segments are rows rather than JSON: the calculation reads them, and the
database checks that they are ordered and non-overlapping.

**Five shift kinds, closed.** A sixth is a schema change rather than a configuration change,
deliberately — ADR-0049's argument, which is that "add a kind" is how a checklist becomes a workflow
engine one release at a time, and it applies just as well to a scheduler.

---

## 12. Roster Model

`attendance_roster_entry` is an explicit statement about one employment on one date, and it wins over
the schedule.

| Column | Notes |
| --- | --- |
| `employment_id`, `on_date` | Unique together, partial on `deleted_at is null` |
| `entry_kind` | `shift` (work this shift instead), `rest` (not expected), `holiday` (not expected, and named), `off_site` |
| `shift_id` | Required for `shift`, forbidden otherwise — a check constraint, not a convention |
| `reason_code`, `note` | Tenant code and free text |
| `swap_of_entry_id` | Set when the entry is one half of a shift swap |

**Resolution order, and it is the whole of the rule:**

```
roster entry for (employment, date)  ──►  schedule assignment in force on date  ──►  unscheduled
```

### 12.1 Historical reconstruction

A roster entry is effective for exactly one date and is **never edited in place after that date has
been calculated**: changing it writes a new entry version and marks the day's `inputs_changed_at`, so
the change is visible and the recalculation is deliberate. Editing March's rota in June must not
silently change what March's attendance meant, and §33 asserts it.

---

## 13. Exception Model

An exception is a named deviation attached to a day, produced by the calculation and resolved by a
human or by a rule.

| Exception | Detected when |
| --- | --- |
| `missing_clock_in` / `missing_clock_out` | An odd number of punches bounding a work segment |
| `late_arrival` / `early_departure` | Beyond the shift's grace, after policy rounding |
| `absent_unexplained` | Expected, no events, and leave is not known to cover it (§17) |
| `unscheduled_attendance` | Events on a day with no expected work |
| `rest_day_work` / `holiday_work` | Events on a `rest` or `holiday` roster entry |
| `duplicate_punch` | Two events of the same kind within the policy's window from different devices |
| `invalid_punch` | Out of order, or outside the day's tolerance window |
| `schedule_mismatch` | Events materially outside the expected shift |
| `clock_skew` | `clock_skew_seconds` beyond the configured tolerance |
| `overtime_candidate` | Worked beyond the expected minutes, past the policy threshold |
| `undertime` | Worked less than expected without leave covering it |
| `location_unverified` | A punch the tenant expected to carry location and which did not (§19) |

Each carries `severity` (`information`, `warning`, `blocking`), `state` (`open`, `resolved`,
`waived`, `superseded`), the resolving actor and instant, and a `reason_code`. A **blocking**
exception prevents a day being approved; that is the only mechanical consequence a severity has.

### 13.1 Who resolves what

Determined by the exception's `resolution` attribute, which is **policy data rather than code**:
`automatic` (the calculation resolves it — e.g. lateness inside grace never becomes an exception at
all), `employee_correction`, `manager_approval`, `hr_approval`. The set of exception kinds is closed
and checked; the routing of each is tenant configuration evaluated through the kernel's rule engine.

**No second workflow engine.** A resolution requiring approval creates a `CorrectionRequest` (§14),
which records the decision of a named human holding the permission. `approval_reference` is reserved
for Phase 16 and is null today — the same treatment `recruitment_requisition.approval_id` and
`onboarding_task.approval_reference` already have.

---

## 14. Correction Model

### 14.1 The rule

**A correction never overwrites an event.** The chain is:

```
original event(s)  ──►  correction request  ──►  decision by a named human  ──►
correction event (supersedes_event_id set, source = 'correction')  ──►  recalculation  ──►  new day
```

Everything before the arrow survives. The original event stays readable, the request stays readable,
and the day carries the calculation that produced it.

### 14.2 The request

| Column | Notes |
| --- | --- |
| `employment_id`, `attendance_date` | What is being corrected |
| `request_kind` | `add_event`, `amend_event`, `remove_event`, `manual_day`, `overtime`, `shift_swap`, `off_site` |
| `target_event_id` | For `amend`/`remove` |
| `proposed` | The proposed event shape, as authored data |
| `reason_code`, `justification` | Both required. A correction with no reason is an edit |
| `state` | `requested`, `approved`, `rejected`, `applied`, `withdrawn` |
| `requested_by`, `requested_at` | From the authenticated context, never from the body |
| `decided_by`, `decided_at`, `decision_note` | As above |
| `resulting_event_id` | Written when applied. The link from intent to effect |
| `approval_reference` | Reserved for Phase 16, null today |

### 14.3 Self-approval is refused by the domain, not only by permissions

`requested_by === decided_by` is refused even when the caller holds both permissions. A control that
depends on nobody being granted two roles is a control that fails the first time somebody is.

### 14.4 What audit answers

Who requested · what changed (the original and the proposed, side by side) · why (`reason_code` and
`justification`) · who approved · when · and the attendance state before and after, because the day's
`inputs_digest` and `calculation_version` change and the previous values are in the day's history.

---

## 15. Attendance Calculation

### 15.1 The function

```
calculate(employment, attendanceDate) =
    events in the day's window (ordered, superseded ones excluded)
  + shift and expectation resolved for that date
  + policy version in force on that date
  + approved leave for that date (or "unknown")
  ─────────────────────────────────────────────
  = worked, regular-candidate, overtime-candidate, unpaid, absence, and a set of exceptions
```

**Pure.** No clock, no I/O, no randomness inside the calculation itself — the same inputs give the
same outputs forever. Ingestion and persistence are outside it, which is what makes it testable
against a table of scenarios rather than against a database.

### 15.2 Pairing

Events are paired into intervals by kind and order: `clock_in` opens, `clock_out` closes,
`break_start`/`break_end` nest inside an open work interval. An unmatched opener at the end of the
window is a `missing_clock_out`; an unmatched closer is a `missing_clock_in`. Nothing is invented to
close a pair — an incomplete day is reported as incomplete, because a system that guesses an end time
is a system that pays a guess.

### 15.3 Rounding and grace

Both are **policy**, applied after pairing and before bucketing, and both record what they did. A
rounded figure that cannot say what it rounded from is a figure nobody can dispute.

### 15.4 Versioning

`calculation_version` is an integer constant in the code, bumped whenever the algorithm's output could
change. It is stored on every day. Payroll can therefore prove which algorithm produced the hours it
paid, and a re-run of an old period can be recognised as having been produced by a newer version
rather than silently differing.

### 15.5 Recalculation is a command with reconciliation, never an event

This is the phase's central reliability decision, and it follows directly from §1.2's fact that event
delivery is post-commit, in-process and at-most-once with no outbox.

- Every write that changes an input — an ingested event, an applied correction, a published policy, a
  roster change, a schedule assignment change — sets `inputs_changed_at` on the affected
  `attendance_day` rows **in the same transaction**. A day that has no row yet is created in the
  `pending` state by ingestion, so there is always something to mark.
- `attendance.recalculate` is an **idempotent, bounded command**: same inputs, same result, safe to
  run twice, and it never creates a duplicate day because of the unique index.
- `attendance.days-awaiting-recalculation` is the **reconciliation query**: days where
  `inputs_changed_at > calculated_at`, tenant-scoped, bounded, deterministic.

An event may be an accelerator. **Event received ≠ recalculation guarantee; event not received ≠
recalculation failure.** Nothing in this phase will claim durable delivery, exactly-once processing
or outbox semantics.

### 15.6 What recalculation must never do

Destroy an event · change an approved day without recording that it changed · alter a frozen payable
snapshot (§18.3) · run unbounded over a whole tenant in one request.

---

## 16. Overtime Boundary

Attendance produces **candidate time**, and the word is load-bearing.

| Produced here | Not produced here |
| --- | --- |
| `worked_minutes` | Any monetary amount |
| `regular_candidate_minutes` | Any rate or multiplier |
| `overtime_candidate_minutes` | Whether overtime is payable |
| `unpaid_minutes` | Whether it needed pre-approval to be payable |
| `absence_minutes` | Statutory daily or weekly caps |

The threshold above which time becomes an overtime candidate is **attendance-policy data**, authored
by the tenant, with **no shipped default**. Phase 11.1's country pack will supply the statutory
version through the same rule-engine seam, and the policy row already carries
`source` (`tenant`, `country_pack`) so the substitution needs no schema change.

No Saudi, Jordanian, Emirati or any other jurisdiction's rule appears in the core domain. §30 states
the extension points.

**Overtime approval**, where a tenant requires it, is a `CorrectionRequest` of kind `overtime` — the
same mechanism as every other decision, before or after the fact per configuration.

---

## 17. Leave Integration

Phase 9 owns Leave. Phase 8 establishes the contract and, critically, is honest about not having it.

```ts
interface LeaveDirectoryPort {
  approvedLeaveFor(
    employmentId: string,
    from: string,          // civil dates
    to: string,
  ): Promise<LeaveCoverage>;
}

type LeaveCoverage =
  | { readonly known: false }                                   // Leave is not available
  | { readonly known: true; readonly days: readonly ApprovedLeaveDay[] };

interface ApprovedLeaveDay {
  readonly onDate: string;
  readonly coverage: 'full_day' | 'partial_day' | 'hourly';
  readonly minutes?: number;          // partial or hourly
  readonly fromLocal?: string;        // 'HH:MM' for a bounded partial day
  readonly toLocal?: string;
  readonly leaveRequestId: string;    // a reference, never a leave record
}
```

### 17.1 The honest default

Phase 8 ships a **null adapter that answers `{ known: false }`** — not "no leave". The difference is
the whole point:

- With `known: false`, an expected day with no attendance produces
  **`absence_pending_explanation`**, and the day's `leave_state` is `unknown`.
- Only when Leave answers do days become `absent_unexplained` or reconcile to leave.

Asserting `absent` when the system has no way to know whether leave was approved would be a false
statement on a person's record, and it is exactly the kind of fake completeness §45 prohibits. The
capability is marked **NOT VERIFIED** with the reason: *no Leave module exists; the port has no
adapter.*

### 17.2 Reconciliation, not events

When Leave arrives, an approval, a cancellation or a correction changes the answer for dates already
calculated. Because delivery is at-most-once, Phase 8 does **not** design around a leave event: the
same `inputs_changed_at` + `days-awaiting-recalculation` mechanism (§15.5) covers it, and Phase 9's
adapter marks the affected days when it writes. Attendance never edits leave, and Leave never edits
attendance (Phase 9 AD-002).

---

## 18. Payroll Integration

### 18.1 The output contract

Payroll must never inspect raw attendance internals. It reads one shape:

```ts
interface AttendancePayableSnapshot {
  readonly snapshotId: string;
  readonly employmentId: string;
  readonly periodStart: string;          // civil dates, supplied by the caller
  readonly periodEnd: string;
  readonly sequence: number;             // 1, 2, 3 — a correction produces the next
  readonly frozenAt: Date;
  readonly frozenBy: string;
  readonly workedMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  readonly leaveMinutes: number;
  readonly leaveState: 'none' | 'applied' | 'unknown';
  readonly daysApproved: number;
  readonly daysUnapproved: number;
  readonly blockingExceptions: number;   // > 0 means Payroll should refuse or query
  readonly calculationVersion: number;
  readonly inputsDigest: string;
}
```

### 18.2 Attendance does not own the payroll period

There is no attendance period table. `attendance.freeze-period` takes an explicit date range from the
caller, because a payroll calendar is Payroll's and inventing one here would be two owners of "when
does the month end".

### 18.3 Frozen means frozen

Once a snapshot exists, later corrections **never alter it**. They produce sequence *n+1*. Payroll
records which sequence it paid, and a dispute six months later can compare the two. This is
ADR-0048's immutability argument applied to a number rather than to a checklist, and retrofitting it
would be impossible once a customer had run payroll.

`daysUnapproved` and `blockingExceptions` are on the contract rather than filtered out, so Payroll
can decide — and can decide *visibly* — rather than paying an incomplete month without noticing.

---

## 19. Device Integration

### 19.1 The boundary

```
biometric reader / turnstile / QR gate / vendor middleware
                    │
                    ▼   (outside this module, and outside this phase)
            vendor adapter — resolves the device's subject to an employmentId
                    │
                    ▼   normalized contract
        attendance.record-time-event  /  attendance.record-time-events
                    │
                    ▼
              Attendance
```

**No vendor SDK, no device registry and no subject-mapping table in Phase 8.** The adapter resolves
its own badge numbers to employments — that is a vendor-specific concern and, when it becomes
generic, Phase 22's (Enterprise Integrations). Attendance receives `employmentId`, `source: 'device'`,
an opaque `device_reference`, an opaque `source_reference` and the two timestamps, and stores them for
audit without parsing any of them.

This satisfies §7 exactly: the required contract is documented, and no vendor-specific infrastructure
is built to satisfy the phase.

### 19.2 What is NOT VERIFIED

Biometric device ingestion, turnstile ingestion and QR ingestion are **NOT VERIFIED** in Phase 8, with
the reason: *no device adapter exists in this repository, and none is built here.* The ingestion
command is real, tested and usable by an integrator today; the devices are not connected.

### 19.3 Biometric data

**No biometric template, image, vector or hash is stored anywhere in Attendance, ever.** No column
exists for one, and none will. A device that matches a fingerprint sends an identifier; the matching,
the enrolment and the template storage are the device's and the vendor's. Attendance creates no
biometric identity system, and §31 states the privacy consequence.

---

## 20. Mobile Offline Contract

Phase 19.1 builds the mobile application. Phase 8 makes the domain tolerate what it will send.

| Requirement | Mechanism |
| --- | --- |
| A punch made offline and sent later | `captured_offline` flag; `reported_at` and `received_at` stored separately and never conflated |
| The queue is retried | Client-generated `event_key`; a repeat is a success naming the existing event (§8.3) |
| The device clock is wrong | `clock_skew_seconds` stored; a `clock_skew` exception past the configured tolerance. **The client clock is never trusted, and divergence is data, not an error to discard** |
| Events arrive out of order | Ordering is by `occurred_at`, not by arrival. Pairing is recomputed on every recalculation |
| Events arrive after the day was calculated | `inputs_changed_at` is set; the day appears in the reconciliation query |
| Events arrive after the day was approved | Accepted, the day is marked, and the *approval is not silently voided* — a `late_event_after_approval` exception asks a human |
| A batch is submitted at once | `attendance.record-time-events` accepts a bounded array; each row is deduplicated independently |

**`occurred_at` is the server's judgement, not the client's claim.** Ingestion sets it to
`reported_at` when the skew is within tolerance and to `received_at` when it is not, and records both
either way, so the decision is visible and reversible by a correction.

Nothing of the mobile application is implemented in Phase 8.

---

## 21. Import Architecture

Bounded, synchronous and auditable, in the Phase 6 lineage (`IMPORT_LIMIT = 2000`, refuse by name
beyond it, background jobs are Phase 24's).

| Property | How |
| --- | --- |
| Tenant-scoped | Every row inherits the request's tenant; nothing in the payload can name another |
| Deduplicated | Each row computes an `event_key`; a repeat is skipped, not failed. **A file that stopped at row 900 can be sent again** |
| Retry-safe | The above, plus a batch identifier so a partial import is identifiable |
| Auditable | `attendance_import_batch` records the actor, the instant, the row count, and the counts created, skipped and failed |
| Validated | Every row goes through the same ingestion command an integrator would call — never straight into the table |

Formats: a normalized JSON row shape. **CSV parsing happens at the edge, not in the domain**, and no
vendor-specific importer is built (§22 of the brief). Import is resumable, not atomic, and the
limitation is stated rather than implied.

---

## 22. Time Zone Model

### 22.1 The rule

**A civil date is never derived from a UTC instant by truncation.** `occurred_at.toISOString()
.slice(0, 10)` is the defect this section exists to prevent: for a tenant in `Asia/Riyadh`, a punch at
02:00 local on the 3rd is 23:00 UTC on the 2nd, and the truncation puts a day of work on the wrong
date, in the wrong week, in the wrong payroll period.

### 22.2 Where the zone comes from

```
roster entry's shift → schedule's zone (required column) → tenant settings' zone
```

The resolved zone is **stored on the event and on the day**, because a schedule's zone can be
corrected and a recalculation years later must use the zone that applied then, not the zone that
applies now.

### 22.3 Implementation

Conversion between an instant and a wall-clock time in a named zone uses the ICU data the runtime
already provides, through `Intl.DateTimeFormat` with an explicit `timeZone` — the same dependency
`kernel/time/calendar.ts` already relies on for Umm al-Qura. **No zone table is shipped and no offset
is hardcoded.**

A small, well-tested zone helper is needed and does not exist. §37 (**D-3**) asks whether it belongs
in `@work/kernel` (right home, changes a package every phase depends on) or inside Attendance for now
(no blast radius, extract when a second consumer appears — the argument Phase 7's debt D-3 recorded
about `row-writer.ts`, now on its third occurrence). Recommendation: **inside Attendance**, with the
extraction named.

---

## 23. Effective Dating

Everything an attendance calculation reads must be answerable as at a date.

| Thing | Mechanism | The question it answers |
| --- | --- | --- |
| Schedule assignment | `Timeline`, non-overlapping | Which schedule applied on 3 March? |
| Schedule version | Immutable once published; the day stores `schedule_version` | What did that schedule say in March? |
| Shift version | Immutable once published; the day stores `shift_id` | What hours were expected? |
| Roster entry | One per employment per date; superseded, never edited in place | Was that a rest day at the time? |
| Policy | Versioned, effective-dated, immutable once published; the day stores `policy_version` | Which grace period applied? |
| Employment facts | Not stored — read from Employment with `asOf` | Was the employment active? Which unit? Which manager? |

**A recalculation of March uses March's schedule, March's policy and March's employment status.**
Using today's is the defect this whole section exists to prevent, and §33 asserts it twice.

---

## 24. Authorization

### 24.1 The permission set

Fifteen permissions. The brief's suggested list is not assumed; this is the model the phase's actual
operations require.

| Permission | Covers |
| --- | --- |
| `attendance.read` | Attendance days, exceptions, summaries |
| `attendance.event.read` | Raw events — separate, because events carry device and location evidence a reviewer of a day does not need |
| `attendance.event.record` | Submitting a time event. Held by an integration principal and by a punch clock's service account |
| `attendance.event.record-own` | An employee's own punch (Phase 18 contract, unrouted — §27) |
| `attendance.read-own` | An employee's own attendance (Phase 18 contract, unrouted) |
| `attendance.manage` | Manual day entry, day state transitions |
| `attendance.correct.request` | Raising a correction |
| `attendance.correct.approve` | Deciding one. **Never the same permission as requesting** |
| `attendance.approve` | Signing off a day or a range |
| `attendance.recalculate` | Running recalculation |
| `attendance.schedule.manage` | Drafting shifts and schedules |
| `attendance.schedule.publish` | Freezing one. Separate, because a published schedule is what a hundred people are measured against |
| `attendance.roster.manage` | Rostering |
| `attendance.policy.manage` | Attendance policy |
| `attendance.import` | Bulk import |
| `attendance.export` | Taking the register out. Held by fewer people than read |
| `attendance.period.freeze` | Producing the payable snapshot Payroll consumes |

### 24.2 The separations that are doing work

- **Recording an event is not managing attendance.** A turnstile's service account needs one narrow
  permission, and it must not be able to approve a day.
- **Requesting a correction is not approving one**, and the domain additionally refuses
  self-approval (§14.3).
- **Reading a day is not reading its raw events**, because the events carry device identifiers and,
  where enabled, coordinates.
- **Publishing a schedule is not drafting one**, on ADR-0048's argument.
- **Freezing a period is its own permission**, because it is the number payroll pays.

### 24.3 The bounded service grants

Two, each permitting exactly one cross-domain read:

| Operation | Permits | Why |
| --- | --- | --- |
| `attendance.record-time-event`, `attendance.recalculate` | `employment.employment.read` | Confirm the employment and read its state as at the date |
| `attendance.recalculate` (Phase 9 onward) | `leave.request.read` (name to be confirmed by Phase 9) | Read approved leave |

No broad Employment, People or Organization permission is granted to any attendance role. The grant
does not touch the execution context, so every audit column and every event still names the human who
asked, and every elevation is logged.

---

## 25. Tenant Isolation

Every table carries `tenant_id` and takes `call app_protect_table(...)` in the creating migration.
Proved as an unprivileged role with no `BYPASSRLS`, which is the only configuration under which the
assertions mean anything.

The nine assertions:

1. Every `attendance_%` table has row-level security enabled and forced — a table-coverage test, so a
   future table cannot be added without one.
2. A time event is invisible to another tenant by identifier, by employment and by list.
3. An attendance day and its exceptions are invisible across tenants, **including their counts** — a
   tally is a disclosure, and "how many people were late" is a question one tenant must not be able
   to ask about another.
4. Schedules, shifts and rosters are invisible across tenants.
5. A correction request is invisible across tenants, and a decision on one is refused.
6. **The deduplication key is scoped to the tenant.** `(tenant_id, event_key)`: an index that omitted
   the tenant would make one customer's punch silently suppress another's, which is the worst class of
   isolation failure because it looks like a business rule.
7. **Import cannot write across tenants** — a payload naming another tenant is refused.
8. **Recalculation cannot cross tenants.** It is a tenant-scoped command running inside the request's
   context; there is no background processor in Phase 8, and §34 states that explicitly rather than
   leaving it to be assumed.
9. Cross-tenant reads and writes at the application layer return **404, not 403**, so an identifier is
   never confirmed to exist.

---

## 26. Audit

Existing infrastructure only: audit columns written by `Repository`/`insertRow` from the
authenticated context, `version` for optimistic concurrency, soft delete, plus append-only history
where the sequence itself is the evidence. **No second audit infrastructure.**

| Action | Where the evidence lives |
| --- | --- |
| Punch created | The event row itself — immutable, with actor, source, device, both timestamps |
| Punch corrected | The correction request, plus a new event with `supersedes_event_id`. The original is untouched |
| Attendance recalculated | `calculation_version`, `inputs_digest`, `calculated_at` on the day, and the day's `version` increment |
| Manual attendance | An event with `source = 'manual'` and the actor from the context |
| Schedule / shift changed | A new version with `published_by`, `published_at`; the old one immutable |
| Roster changed | A superseding entry, and `inputs_changed_at` on the affected day |
| Approval | `approved_by`, `approved_at` on the day; `decided_by`, `decided_at` on the correction |
| Exception resolved | The exception's resolving actor, instant and reason code |
| Import | `attendance_import_batch`: actor, instant, counts created, skipped and failed |
| Period frozen | `frozen_by`, `frozen_at`, `sequence` on the snapshot |
| Administrative override | Not a separate concept — every override is one of the operations above, performed by an actor holding the permission, and recorded with their name |

The actor is always taken from the authenticated context and never from a command.

---

## 27. Domain Events

Internal to this repository, used where a within-transaction reaction is useful, and **not exported
from the module's contracts**. There is no published cross-module event contract and no subscription
contract; inventing one for Attendance is the thing Phase 16/17 exist to do properly, and Phase 7's
D-1 was refused on exactly that basis.

Proposed internal events: `attendance.event.recorded`, `attendance.day.calculated`,
`attendance.day.approved`, `attendance.exception.raised`, `attendance.correction.applied`,
`attendance.period.frozen`.

**No downstream correctness depends on any of them.** Recalculation is a command plus reconciliation
(§15.5); Payroll reads a frozen snapshot (§18). Nothing in this phase will claim durable delivery,
exactly-once processing or outbox semantics.

### 27.1 Notifications

No attendance-specific notification infrastructure. Notification *intents* are expressed as the events
above; delivery is Communications' (Phase 17). Actual delivery is **NOT VERIFIED**, with the reason:
*`NotificationPort` has no adapter wired in `apps/api`, and the contract addresses a workforce user
that a shift worker may not have.* No screen will claim a message was sent.

### 27.2 Documents

No attendance document infrastructure. Where evidence needs a document — a medical note against an
absence — the row carries a validated *reference* and nothing else. No endpoint accepts bytes.
**NOT VERIFIED**, reason: *no `DocumentPort` adapter exists anywhere in this repository.*

---

## 28. API

`/api/v1/attendance/...`, Nest controllers under the established conventions: OpenAPI, Problem Details
(RFC 9457), `class-validator` DTOs with `forbidNonWhitelisted`, correlation and request identifiers,
every collection paged and bounded.

| Route | Method | Notes |
| --- | --- | --- |
| `/attendance/events` | `GET` | Paged. Filter by employment, date range, source, kind |
| `/attendance/events` | `POST` | Record one. **Idempotent**: a repeat returns the same event with `alreadyRecorded: true` |
| `/attendance/events/batch` | `POST` | Bounded array, each row deduplicated independently |
| `/attendance/days` | `GET` | Paged. Filter by employment, unit, date range, state, exception kind |
| `/attendance/days/{employmentId}/{date}` | `GET` | One day, its events, its exceptions, its buckets |
| `/attendance/days/{id}/approval` | `POST` | Sign-off |
| `/attendance/recalculation` | `GET` | Days awaiting recalculation — the reconciliation read |
| `/attendance/recalculation` | `POST` | Bounded, idempotent recalculation |
| `/attendance/exceptions` | `GET` | The queue. Paged, filtered, indexed |
| `/attendance/exceptions/{id}/resolution` | `POST` | Resolve or waive, with a reason |
| `/attendance/corrections` | `GET`, `POST` | Request one |
| `/attendance/corrections/{id}/decision` | `POST` | Approve or reject. Refuses self-approval |
| `/attendance/shifts` | `GET`, `POST` | Draft |
| `/attendance/shifts/{id}/publication` | `POST` | Publish. Separate permission |
| `/attendance/schedules` | `GET`, `POST`, `/{id}/publication` | As above |
| `/attendance/schedules/{id}/assignments` | `GET`, `POST` | Effective-dated |
| `/attendance/rosters` | `GET`, `POST`, `DELETE` | Per employment per date |
| `/attendance/policies` | `GET`, `POST`, `/{id}/publication` | Versioned |
| `/attendance/imports` | `POST` | Bounded, refuses by name beyond the limit |
| `/attendance/periods/freeze` | `POST` | Produces the payable snapshot |
| `/attendance/periods` | `GET` | Snapshots, by employment and range |
| `/attendance/export` | `GET` | Separate permission, bounded, **no location data** |

**Route ordering matters** and will be asserted, as it was in Phase 7: `/attendance/recalculation`,
`/attendance/export` and `/attendance/periods` are each one segment after `/attendance`.

### 28.1 Contracts published but not routed

`attendance.read-own`, `attendance.record-own-event` and `attendance.request-own-correction` are
implemented, permissioned and tested, and deliberately have **no HTTP route** — P-1. Mounting them
would mean taking the employment from the request, which is how one employee punches for another.

---

## 29. UI

One admin area, read-only in this phase, consistent with every module before it. Write screens are
Phase 18/19's, and building them only here would make Attendance the one module with them.

| Screen | Shows |
| --- | --- |
| Attendance dashboard | Today: expected, present, late, absent-pending-explanation, open exceptions. Counts from aggregate queries, never row loads |
| Daily attendance | One date across a unit: expected vs actual, state, exceptions |
| Employment attendance | One employment over a range, with its events and its history |
| Exceptions queue | Filtered by kind, severity and state. The screen an HR administrator lives in |
| Corrections | Requests and their decisions, with the original and the proposal side by side |
| Schedules and shifts | Definitions, versions, who published each |
| Rosters | Per unit per week |
| Policies | Versions and what each changed |
| Imports | Batches, with created / skipped / failed counts |
| Boundaries | What Attendance does not hold — stated on the screen, so a customer learns it rather than concluding a field is missing |

Platform UI (`@munaxa/ui`) only. Bilingual from the module's own catalogues, `?lang=ar` switching
language *and* direction together. Employment identifiers are shown, never names: resolving one is
People's read behind People's permission.

**Location is not plotted on any map and not shown on any list**; where it exists it is visible only
on a single event's detail, to a caller holding `attendance.event.read`.

---

## 30. Performance

Attendance is the highest-volume domain in the product. Benchmarks at **1,000,000 time events,
100,000 employments, 12 months of history, 20,000 attendance days per day of operation, and a
100,000-row exception queue**, measured as the unprivileged role under row-level security, median of
five runs — the methodology Phases 6 and 7 used.

| Query | Target | Design |
| --- | --- | --- |
| Record one event (read-then-insert) | < 20 ms | `(tenant_id, event_key)` unique index; no scan |
| Events for one employment for one day | < 30 ms | `(tenant_id, employment_id, attendance_date)` |
| One day with its events and exceptions | < 50 ms | Two reads; buckets already computed |
| Daily attendance for a unit | < 100 ms | `(tenant_id, attendance_date, state)`; unit filter applied to a bounded employment set |
| Exception queue page | < 100 ms | `(tenant_id, state, severity, attendance_date)` |
| Days awaiting recalculation | < 100 ms | Partial index on `inputs_changed_at > calculated_at` |
| Employment history, one month | < 100 ms | `(tenant_id, employment_id, attendance_date)` |
| Recalculate one day | < 50 ms | Bounded event read; pure calculation |
| Recalculate a bounded batch (500 days) | < 10 s | Sequential, tenant-scoped, reported |
| Freeze a period for one employment | < 100 ms | Aggregate over days, not events |
| Dashboard counts | < 200 ms | Aggregate queries with `filter (where …)`, never row loads |

### 30.1 Forbidden and tested against

Unbounded reads (every list paged; export bounded and refusing by name) · N+1 (events for a page of
days in one query) · per-event expensive work (ingestion does one indexed read and one insert) ·
full-table recalculation (bounded and reported) · client-side filtering (every filter is a SQL
predicate) · free-text search on `attendance_time_event` (the Phase 6 finding — `ilike` under RLS is a
sequential scan).

### 30.2 Partitioning

**Not in Phase 8.** Range partitioning `attendance_time_event` by `attendance_date` is the obvious
next step at 10⁷–10⁸ rows, and it interacts with `app_protect_table`, with the migration conventions
and with the unique index's scope. Introducing it speculatively would be a schema decision taken
without a measurement. §35 records it as a named future option **with the trigger**: when measured
ingestion or the daily read misses its target at the benchmark volume, or when the table exceeds
50,000,000 rows.

### 30.3 The hard-delete finding

Phase 7's debt D-5 — FK-supporting indexes lead with `tenant_id`, so a delete's FK check scans —
applies here with more force. Phase 8 introduces **no hard-delete path**, and any future retention
sweep over these tables must be designed with it in mind. Recorded again in §35.

### 30.4 Summaries

Monthly and per-unit summaries are **projections** built with the kernel's `project`/`verifyRebuild`,
so they can be thrown away and rebuilt from the days. A summary that cannot be rebuilt is a second
source of truth that drifts, and the drift is discovered by a customer disputing a number.

---

## 31. Security / Privacy

Attendance is the most behaviourally revealing data in the product: it says when a named person
arrived, left, took a break, and how often they were late.

| Concern | Position |
| --- | --- |
| Biometric templates | **Never stored.** No column exists (§19.3) |
| Continuous tracking | **Prohibited.** Location is captured at the punch or not at all. There is no column that could hold a track, and no endpoint that accepts one |
| Location capture | Off unless the tenant enables it *for that source*. One point, with accuracy, per punch |
| Location exposure | Behind `attendance.event.read`, never in the day view, never in the export, never in a log, never in an event payload |
| Names | Never joined into attendance. Queues show employment identifiers |
| Notes and justifications | Length-bounded, never in an event payload, never in the export governed by `attendance.read` alone |
| Device identifiers | Opaque, stored for audit, never rendered outside a single event's detail |
| Logs | No coordinates, no notes, no employment-level pattern data. The elevation log records the operation, not the person's day |
| Cross-tenant | 404 rather than 403, so an identifier is never confirmed |
| Retention | **No retention period is invented.** When to erase attendance is a policy question a country pack and the GRC phase own. The schema carries soft-delete columns so an obligation has somewhere to land, and §35 records that nothing sweeps them |

**Attendance supports punch verification, not surveillance**, and the distinction is enforced by what
the schema can hold rather than by what the code chooses to do.

---

## 32. Testing

No fewer tests per unit of behaviour than Phase 7 (46 module + 7 API). The domain's calculation makes
a table-driven suite natural and the target is substantially higher.

### 32.1 Domain

Event pairing (ordered, out of order, unmatched opener, unmatched closer) · deduplication key
derivation for each source · attendance-date resolution including cross-midnight · shift matching
(fixed, flexible with core hours, split, night, open) · grace periods at and either side of the
boundary · paid and unpaid breaks, taken and missing · expected-minutes on a DST day · exception
detection for every kind in §13 · overtime-candidate bucketing at, below and above threshold ·
rounding, with the pre-rounding figure preserved · policy version selection by date.

### 32.2 Application

Authorization: a caller holding everything *except* the permission under test is refused, per
permission · self-approval refused even when both permissions are held · tenant isolation for every
read and write · **idempotent ingestion** (twice, and concurrently) · **recalculation is
idempotent and reproducible** (same inputs → identical `inputs_digest` and buckets) ·
reconciliation finds a day whose input changed and finds nothing on a rerun · import: duplicate
skipped, failure reported, re-run safe · leave port answering `{ known: false }` produces
`absence_pending_explanation`, not `absent` · freezing twice produces sequence 2 and leaves sequence 1
byte-identical.

### 32.3 API

Authentication and authorization at the edge · validation, including a rejected undeclared property ·
pagination and bounds on every collection · filtering · 400 vs 422 vs 404 vs 409 · route ordering ·
the idempotent `POST /attendance/events` returning the same identifier on retry.

### 32.4 Security

Every table under RLS (coverage test) · the nine assertions of §25 as an unprivileged role · no
location in the export, the day view, or any event payload · no privilege escalation through the
service grant (a caller cannot reach Employment data outside the grant's operation).

### 32.5 Integration

Employment: an ended employment refuses later events; a historical calculation uses the status,
assignment and manager *as at the date*. Leave: the null adapter's `{ known: false }` path, and a
fake adapter proving the reconciliation path without implementing Leave. Payroll: the snapshot is
reproducible and a correction produces a new sequence.

**No future domain is implemented in order to test its contract.** Fakes are named as test
infrastructure and exported as such, exactly as `FakeEmployment` and `FakePeople` are.

---

## 33. Critical Edge Cases

Each of these will have a named test.

| Case | How the design handles it |
| --- | --- |
| **Overnight shift** | The shift declares `crosses_midnight`; the attendance date is the shift's start date (§26) |
| **Split shift** | Two `work` segments with a gap; the gap is not a break and is not worked time |
| **Flexible schedule** | `flex_window_minutes` and core hours; lateness measured against the core start, not the nominal start |
| **Cross-midnight punch** | Resolved by the day window (§26), not by UTC truncation |
| **Duplicate punch** | Same `event_key` → the existing event returned as a success. Different device → both stored, `duplicate_punch` exception raised |
| **Out-of-order punch** | Ordering is by `occurred_at`; pairing is recomputed on every calculation |
| **Missing punch** | Reported as `missing_clock_in`/`missing_clock_out`. **Nothing is invented to close the pair** |
| **Late punch** | Beyond grace → `late_arrival`; inside grace → no exception at all |
| **Early departure** | Symmetric |
| **Multiple punches** | Paired in order; extra openers and closers become exceptions |
| **Device retry** | Deduplicated by `event_key` |
| **Mobile retry** | Deduplicated by the client-generated key |
| **Offline event** | `captured_offline`, `reported_at` vs `received_at` preserved; the day is marked for recalculation |
| **Clock drift** | `clock_skew_seconds` stored; past tolerance the server's receipt time is authoritative and a `clock_skew` exception is raised. Both values remain |
| **DST transition** | Expected minutes come from the shift's authored figure; worked minutes from instants. A 23-hour day does not become a 1-hour absence, and a 25-hour day does not become an hour of overtime |
| **Tenant time zone** | Default only. The schedule's zone wins, and the resolved zone is stored on the row |
| **Schedule changed after the attendance date** | The day stores `schedule_version` and `shift_id`; a recalculation uses what applied then. Changing a schedule marks affected *future* days only |
| **Assignment changed after the attendance date** | Employment is read with `asOf`; the unit that applied then is the unit used |
| **Employment terminated** | Attendance before the end date stands. Events after it are refused by name |
| **Leave overlap** | Full-day, partial-day and hourly coverage reduce absence minutes; with no Leave module the state is `unknown` and the exception is `absence_pending_explanation` (§17.1) |

---

## 34. Database / Migration Plan

### 34.1 Existing tables

**None to reuse.** No attendance or time table exists in the 54 models. No historical migration is
touched.

### 34.2 New tables — thirteen

| Table | Holds |
| --- | --- |
| `attendance_time_event` | The immutable raw event |
| `attendance_day` | The derived result for one employment on one date |
| `attendance_day_exception` | Deviations on a day |
| `attendance_shift` | A shift version |
| `attendance_shift_segment` | Its ordered work and break segments |
| `attendance_schedule` | A schedule version |
| `attendance_schedule_day` | Cycle position → shift |
| `attendance_schedule_assignment` | Employment → schedule, effective-dated |
| `attendance_roster_entry` | An explicit statement for one employment on one date |
| `attendance_policy` | A versioned tenant policy |
| `attendance_correction_request` | A correction and its decision |
| `attendance_payable_snapshot` | The frozen output Payroll consumes |
| `attendance_import_batch` | Import provenance |

All tenant-first, audited, versioned, soft-deleted, `snake_case`, UUIDv7, and every one takes
`call app_protect_table(...)` in the creating migration.

### 34.3 The constraints that carry the design

```sql
-- Deduplication. The idempotency boundary, tenant-scoped.
create unique index attendance_time_event_key
  on attendance_time_event (tenant_id, event_key) where deleted_at is null;

-- One result per employment per date.
create unique index attendance_day_key
  on attendance_day (tenant_id, employment_id, attendance_date) where deleted_at is null;

-- One roster statement per employment per date.
create unique index attendance_roster_entry_key
  on attendance_roster_entry (tenant_id, employment_id, on_date) where deleted_at is null;

-- The reconciliation read.
create index attendance_day_stale_idx
  on attendance_day (tenant_id, inputs_changed_at)
  where inputs_changed_at is not null and deleted_at is null;
```

Plus check constraints for every closed set (`event_kind`, `source`, `day_kind`, `state`,
`shift_kind`, `entry_kind`, `severity`), the owner-shape constraint on a roster entry (`shift_id`
present exactly when `entry_kind = 'shift'`), and the approval-shape constraints
(`approved_at is null` = `approved_by is null`).

**Foreign keys point backward only.** `employment_id` references `employment(id)`, as
`onboarding_instance` does, which makes it structurally impossible for Attendance to invent an
employment. No foreign key points at People, and no `person_id` column exists.

### 34.4 Backfill and rollback

**No backfill.** Existing employments do not receive historical attendance; inventing it is not a
migration. Rollback: the migration is additive; dropping thirteen tables removes the feature and
touches nothing else.

### 34.5 What is not in the migration

No partitioning (§30.2) · no device or subject-mapping table (§19.1) · no site or work-location table
(§37, D-4) · no attendance calendar (§5.3) · no period definition table (§18.2) · no biometric column
of any kind.

---

## 35. Risks

| | Risk | Mitigation |
| --- | --- | --- |
| **R-1** | **Attendance becomes a second employment record.** A status, a unit or an hours column here is the classic failure | §6.2's field-by-field test; no employment fact stored; a test asserting a historical calculation reads Employment `asOf` rather than a copy |
| **R-2** | **A UTC truncation puts a night shift on the wrong day.** Silent, systematic, and discovered in payroll | §22 and §26; the zone is stored on every row; cross-midnight and DST are named edge cases with tests |
| **R-3** | **A correction overwrites an event.** The single highest-risk operation in the domain | The event store has no update method (§8.2); a correction is a new event with `supersedes_event_id`; asserted structurally |
| **R-4** | **Recalculation silently does not run**, because it waited for an at-most-once event | §15.5: `inputs_changed_at` written in the same transaction, a reconciliation query, and an idempotent bounded command. The ADR-0050 lineage |
| **R-5** | **The calculation is not reproducible**, so a disputed number cannot be explained | `calculation_version` + `inputs_digest` on every day; a reproducibility test; the pure calculation function |
| **R-6** | **Attendance drifts into a scheduling engine** — optimization, coverage, cost, auto-rostering are each one plausible request away | Five closed shift kinds; a roster is a statement, not a solver; §6.1's boundary |
| **R-7** | **Attendance drifts into a workflow engine** | §13.1 and §14: a decision by a named human, `approval_reference` reserved, ADR-0049's argument |
| **R-8** | **Overtime becomes payroll.** A multiplier appears, then a rate, then an amount | §16: candidate minutes only; no money column exists; a schema-level test that no attendance table has a monetary column |
| **R-9** | **"Absent" is asserted with no way to know.** A false statement on a person's record | §17.1: `{ known: false }` → `absence_pending_explanation`, and it is marked NOT VERIFIED |
| **R-10** | **Location becomes tracking.** One extra column and a background sender is all it takes | §31: one point at the punch, tenant-gated, no site model in Phase 8, and nothing in the schema can hold a track |
| **R-11** | **Volume outruns the design.** 10⁶ events is the *start* | §30's benchmarks with real numbers, and §30.2's named partitioning trigger rather than a speculative implementation |
| **R-12** | **A hard-delete path is added later and scans** (Phase 7 D-5, worse here) | No hard delete in Phase 8; recorded, and the retention question is named as unowned |
| **R-13** | **A device integration is faked to make a demo work** | §19.2: the contract is real, the adapters are absent, and absence is marked NOT VERIFIED |

---

## 36. Ambiguities

Where the in-repo specification and the repository disagree, or where the specification is silent.

| | Ambiguity | Resolution proposed |
| --- | --- | --- |
| **Q-1** | The spec lists **ten aggregate roots**, including `AttendanceApproval` and `AttendanceSummaryProjection` | Seven (§7). An approval is a recorded decision; a summary is a projection. **D-1** |
| **Q-2** | The spec's "Attendance Requests … route through the **ApprovalPort** from Phase 1" | ADR-0045 and Phase 7 both refused to consume `AutoApprovingPort`, because an approval nobody made is not an approval. §14 records a named human's decision and reserves `approval_reference`. Consistency with two accepted ADRs is preferred over the literal text. **Confirmed by D-1** |
| **Q-3** | The spec requires **geofencing** with permitted locations per employment, site or schedule | There is no location model in this product, and ADR-0041 says so explicitly. **D-4** |
| **Q-4** | The spec says schedules support "holiday calendars" | Organization owns calendars and publishes no read; 00B says holidays are country-pack content. Fallback in §5.3. **D-2** |
| **Q-5** | The spec's "Time Source" is listed as a scope item, implying an entity | It is an attribute of an event — a closed set — not a table. No entity is created |
| **Q-6** | The spec lists both `Attendance Record` and `Work Day` | One concept, one table: `attendance_day` |
| **Q-7** | Whether an event arriving after a day is **approved** should void the approval | Recommended: it does not. The day is marked, a `late_event_after_approval` exception is raised, and a human decides. Silently voiding a sign-off is a worse surprise than an exception |
| **Q-8** | Whether Attendance should refuse events for a **suspended** employment | Recommended: accept and flag. A suspension is an employment fact whose attendance consequences differ by market; refusing would be Attendance deciding labour law |
| **Q-9** | Whether a zone helper belongs in the kernel | **D-3** |
| **Q-10** | Whether the payable snapshot should include unapproved days | Recommended: yes, with `daysUnapproved` and `blockingExceptions` on the contract, so Payroll decides visibly rather than being handed a silently incomplete month |

---

## 37. Decisions Requiring Approval

**D-1 — Confirm the reduced aggregate set and the approval treatment.** Seven aggregates (§7);
`AttendanceApproval` and `AttendanceSummaryProjection` are not among them; an approval is a decision
by a named human with `approval_reference` reserved for Phase 16, and no `ApprovalPort` adapter is
consumed. *Recommendation: confirm.* It is the treatment ADR-0045 and ADR-0049 already established
and Phase 7 shipped.

**D-2 — Confirm the holiday fallback, or approve an additive Organization calendar read.** Attendance
needs "was this a non-working day". Option (a): a new `organization.read-calendar` query — additive,
no behaviour change, no schema change, but it touches completed Phase 3. Option (b): rest days come
from the schedule cycle and public holidays from roster entries, with Phase 11.1's country pack
supplying the statutory set later. *Recommendation: take option (b).* Phase 7's equivalent decision
(D-1) was refused on the principle that a completed phase should not be reopened for one consumer,
00B makes holidays country-pack content anyway, and option (b) ships the phase with no change to any
completed module. The cost — a tenant entering public holidays as roster entries until Phase 11.1 —
is real and is stated rather than hidden.

**D-3 — Where the IANA time-zone helper lives.** Option (a): `@work/kernel`, which is the right home
and changes a package every phase depends on. Option (b): inside `@work/attendance`, extracted when a
second consumer appears. *Recommendation: option (b),* consistent with how `row-writer.ts` has been
handled through three phases, with the extraction named as debt on first reuse.

**D-4 — Geofencing and the location model.** ADR-0041 states that Attendance must either wait for a
location model or supply its own and own it. Option (a): Attendance defines a narrow
`attendance_punch_site` (coordinates, radius, zone) used *only* for punch verification, explicitly not
a work location and never joinable by Payroll or statutory reporting. Option (b): no site model in
Phase 8; a punch may carry coordinates when the tenant enables capture, there is no geofence verdict,
and both the site and the verdict arrive with Phase 19.1 Mobile, which is where geofencing is actually
consumed. *Recommendation: option (b).* There is no mobile client in this repository, so a geofence
would have nothing to verify; option (a) creates precisely the ownerless location model ADR-0041 was
written to prevent, and adding a nullable verdict column to the events table later is cheap. Under
option (b) the phase reports geofencing as **NOT VERIFIED — not implemented, deferred to Phase 19.1**
rather than shipping an unused model.

**D-5 — Confirm that Attendance stores no `person_id`.** AD-001 says Attendance references Employment
and never Person. Onboarding stores both because its foreign keys prove the pair exists; Attendance
has no such need. *Recommendation: confirm* — one fewer cross-module key on the highest-volume table
in the product, and one fewer place personal data could be joined.

**D-6 — Confirm that the null Leave adapter answers "unknown", not "no leave".** With the consequence
that an unexplained absence is reported as `absence_pending_explanation` until Phase 9 exists, and
that this is marked **NOT VERIFIED**. *Recommendation: confirm.*

**D-7 — Confirm the closed sets.** Four `event_kind`s, seven `source`s, five `shift_kind`s, four
`entry_kind`s, and the twelve exception kinds of §13, each enforced by a check constraint; a
sixth of anything is a schema change rather than a configuration change. *Recommendation: confirm.*

**D-8 — Confirm no partitioning in Phase 8**, with the measured trigger of §30.2 recorded instead.
*Recommendation: confirm.*

If implementation reveals that any of these conflicts with the actual repository architecture or a
completed-phase contract, the implementation stops and reports the conflict rather than silently
changing the architecture.

---

## 38. Definition of Done

Phase 8 is complete when all of the following hold.

**Scope**

1. Time events: recorded from web, manual, API and import; idempotent, deduplicated, immutable;
   device and mobile sources supported by the same contract and marked NOT VERIFIED for connectivity.
2. Shifts and schedules: drafted, versioned, published, immutable once published; assigned to
   employments with effective dating; rosters overriding them per date.
3. Attendance days: calculated deterministically and reproducibly, with expected and actual time,
   buckets, exceptions and state.
4. Exceptions: detected, queued, resolved or waived, with a reason and an actor.
5. Corrections: requested, decided by a named human who is not the requester, applied as a new event
   that supersedes rather than overwrites, and recalculated.
6. Recalculation: idempotent, bounded, with a reconciliation query that names stale days.
7. Payable snapshot: frozen, sequenced, reproducible, and the only shape Payroll reads.
8. Import: bounded, deduplicated, resumable, audited.
9. Admin screens per §29; **no ESS or MSS UI**.

**Boundaries**

10. `@work/attendance` depends on **no** sibling module package; every cross-module read goes through
    a published application service under a bounded grant.
11. No Person, Employment, Organization or Leave fact is duplicated; no monetary column exists; a test
    asserts each.
12. Phases 0–7 unmodified, except any change explicitly approved under §37.

**Quality**

13. `pnpm verify` clean: standards, architecture, localization, dependencies, format, lint, typecheck,
    test, build.
14. Tenant isolation proved by the nine assertions of §25, as an unprivileged role.
15. Performance measured at the §30 volumes, reported with real numbers, including any miss.
16. Both locale catalogues complete; every rejection and exception kind has a bilingual message.
17. Concurrency proved: duplicate ingestion converges, and two concurrent corrections do not overwrite
    one another.

**Honesty**

18. No mock device integration, fake biometric integration, fake GPS verification, fake mobile sync,
    fake notification, fake document, placeholder calculation, hardcoded schedule or simulated payroll
    output.
19. Device connectivity, notification delivery, document storage, geofencing and Leave reconciliation
    marked **NOT VERIFIED**, each with its reason.
20. `docs/modules/attendance.md`, the ADRs this phase needs, `DOMAIN_OWNERSHIP.md`, `PHASES.md`,
    `ARCHITECTURE.md`, `RELEASE_NOTES.md` and the debt register updated.
21. `docs/verification/phase-8-report.md` distinguishing **IMPLEMENTED**, **CONTRACT AVAILABLE** and
    **NOT VERIFIED**, with the carried-forward debt register and the event-delivery limitation stated
    verbatim.
