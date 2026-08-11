# Phase 9 — Leave & Absence Management — completion report

**Status** Complete · **Date** 2026-08-10 · **Baseline** Phase 8 at `48fafd0`

Leave explains authorized absence. Attendance records what happened. Payroll decides what it costs.

This report distinguishes four things throughout, and the distinction is the point of it:

| Marking | Means |
| --- | --- |
| **IMPLEMENTED** | Built, wired end to end, and covered by a test that would fail if it broke |
| **CONTRACT AVAILABLE** | A published contract exists and is typed; **no implementation stands behind it in this repository** |
| **NOT VERIFIED** | Cannot be demonstrated here, and why |
| **TECHNICAL DEBT** | Works, with a stated cost carried forward |

---

## 1. What was built

Fourteen tables, 18 commands, 17 queries, 14 permissions, 32 endpoints across 7 controllers,
90 source files, ~15,700 lines.

| Area | State |
| --- | --- |
| Leave types — tenant-configured, versioned, published | **IMPLEMENTED** |
| Leave policies — versioned, effective-dated, immutable once published | **IMPLEMENTED** |
| Policy assignment — four scopes, most-specific-wins, ties refused | **IMPLEMENTED** |
| Entitlement — granted, sourced, written to the ledger in one transaction | **IMPLEMENTED** |
| The ledger — append-only, signed minutes, idempotent by source | **IMPLEMENTED** |
| Balance projection — digest, stale mark, reconciliation query, recalculation command | **IMPLEMENTED** |
| Balance as of a past date — re-derived from the ledger, independent of the projection | **IMPLEMENTED** |
| Projected year-end balance — same pure accrual function the run uses | **IMPLEMENTED** |
| Requests — draft, submit, per-date breakdown, nine states as data | **IMPLEMENTED** |
| Partial days and hourly leave — halves exact, cross-midnight refused by name | **IMPLEMENTED** |
| Approval — named human, self-approval refused three ways, chain published | **IMPLEMENTED** |
| Withdrawal, cancellation (reversal), amendment (supersession) | **IMPLEMENTED** |
| Adjustments — reason and note both required | **IMPLEMENTED** |
| Accrual, leave-year closure, carry-over expiry — bounded, idempotent, restartable | **IMPLEMENTED** |
| Blackout periods | **IMPLEMENTED** |
| Working-day duration — asks Attendance, refuses when it cannot | **IMPLEMENTED** |
| `leave.approved-leave-for` / `-affecting` — what Attendance reads | **IMPLEMENTED** |
| Attendance's `attendance.expected-working-days` and `attendance.reconcile-leave` | **IMPLEMENTED** |
| Payroll period view (`LeavePayrollPeriodView`) | **CONTRACT AVAILABLE** |
| Approval routing, escalation, timeout, delegation resolution | **Not built** — Workflow, Phase 16 |
| Employee and manager self-service | **Not built** — Phase 18 |
| Scheduled execution of accrual, closure and expiry | **NOT VERIFIED** — §6 |
| Document verification of an attachment | **NOT VERIFIED** — §6 |
| Notification of an approver | **Not built** — Communications, Phase 17 |

---

## 2. The five decisions, and what they cost

### The ledger is authoritative; the balance is a projection (ADR-0059)

`leave_ledger_entry` is inserted and read — no `update`, no `delete`, on the repository, the port or
in the migration. A correction is a reversal plus a replacement. `leave_balance` is written only by
`leave.recalculate-balances`, carries `entries_digest` and `inputs_changed_at`, and
`leave.balance-as-of` re-derives the same figure from the ledger **without reading the projection at
all** — which is what makes a wrong projection detectable rather than merely unlikely.

Every duration is integer minutes. A half day of a 405-minute day is 202 and 203 minutes, which sum
to exactly 405; rounding both to 203 would create six minutes of leave nobody granted, once per
odd-length day, for ever. That case is a test.

**Cost.** A cancellation leaves two rows where a counter would have left none. That is the point.

### Overlapping leave is refused by the database (approved D-4)

`leave_request_day_overlap` is a GiST exclusion constraint over `span`, a **generated**
`int4range` of minutes-of-day. `btree_gist` is created by the migration. Two full days on one date
are refused; a first and a second half coexist; two *overlapping hourly* requests are refused —
which a partial unique index could not have expressed.

The concurrency suite opens two real connections and races them. Exactly one commits. A sequential
test would have passed with no constraint at all.

The `23P01` the driver raises is translated into a business refusal naming the date
(`leave_already_covers_this_date`), because two people wanting the same morning is an ordinary
mistake rather than a 500.

### Attendance pulls; Leave never writes to Attendance (ADR-0058, approved D-2)

The Definition of Ready proposed `attendance.mark-inputs-changed`, called from Leave. **That was
rejected and the rejection was right**: Attendance already depends on Leave, so the write would have
closed a dependency cycle and made Leave responsible for another module's derived state.

What was built instead: Leave publishes `leave.approved-leave-affecting`; Attendance's
`attendance.reconcile-leave` asks it and marks **its own** days. There is no cursor table, no feed,
no event bus and no outbox.

**The property this buys**: if every domain event in the product were dropped, an operator running
the reconciliation would still find the change and the attendance record would still converge.

**Cost.** Reconciliation is not instantaneous. Between an approval and the next run, an attendance
day may still read `absent_unexplained`. That is a visible lag with a command that closes it.

### Leave asks Attendance what a working day is (ADR approved as D-1)

Attendance gained one query, `attendance.expected-working-days` — a read over the resolution logic
it already had, with **no schema change and no behaviour change**. Leave does not reimplement the
schedule engine and does not touch `organization_calendar`.

`known: false` is refused by name (`no_working_pattern`), never counted as calendar days. A casual
worker with no schedule has no working-day denominator, and inventing one mis-charges exactly the
people least likely to notice.

### Nothing statutory ships; approval is recorded, not delegated (ADR-0060, approved D-5)

No leave type, entitlement figure, accrual formula, carry-over rule or eligibility threshold ships.
Every policy threshold is nullable and inert; `accrualMethod` defaults to `none`, `carryOverMethod`
to `none`, `minimumServiceMonths` to zero. A test asserts a policy created with no settings has
none of them.

Approval is recorded against a named human from the authenticated context. Self-approval is refused
by the domain, by the permission separation and by a **check constraint** — enforceable only because
`leave_request_decision` carries a copy of `requested_by`, since a check constraint cannot reach
another table. A policy requiring no approval produces **no decision row at all**, and the published
chain says so rather than naming `system:auto-approval`.

**This contradicts the phase specification's "It consumes the ApprovalPort defined in Phase 1", and
that is stated rather than hidden.** The only adapter behind that port approves everything
immediately; treating it as human approval of paid absence would be recording something that did not
happen. The chain is published in `ApprovalPort`'s own shape, so Phase 16 changes the source and not
the contract.

---

## 3. Evidence

### Tests

| Suite | Count | What it proves |
| --- | ---: | --- |
| Leave domain (4 files) | 45 | Ledger sign and idempotency, digest stability, the stale mark cleared even when nothing moved, the state machine exhaustive over every ordered pair, Hijri and Gregorian leave years, exact halves, cross-midnight refused, accrual proration in integers, carry-over caps, no statutory default |
| Leave integration, real PostgreSQL (3 files) | 24 | RLS on all fourteen tables, the exclusion constraint, the ledger and entitlement idempotency indexes, the stale partial index, the self-approval check constraint, foreign keys, and **two live connections racing** |
| Attendance (existing + Phase 9 additions) | 74 | Unchanged, plus the working-day read and the leave reconciliation |
| API, including the cross-module suite | 105 | Endpoint behaviour, and the boundary below |

**The cross-module test** (`apps/api/src/leave/leave.cross-module.spec.ts`) runs Employment,
Attendance and Leave on **one real dispatcher** through the **real adapters the composition root
builds**, and asserts the sequence end to end:

1. an employment on a published schedule;
2. Leave asks Attendance the day's length and gets 480 minutes — the two modules agreeing;
3. a day with no punches calculates as a *checked* absence (`leaveState: 'none'`);
4. leave is requested, and a **different human** approves it;
5. `attendance.reconcile-leave` asks Leave, finds the change and marks its own days;
6. recalculation runs and the same day reads `leaveState: 'applied'`.

A second test flips Leave to throwing and asserts the day reads `unknown` with
`absence_pending_explanation` — not `absent_unexplained`. That is ADR-0056 holding through a real
adapter.

### Quality gates — all PASS

`pnpm verify`: `check-standards`, `check-architecture` (81 models), `check-localization` (9
catalogue sets), `check-dependencies` (no cycles, no unused dependencies, no unreachable files),
`format:check`, `lint`, `typecheck`, `test`, `build`.

The migration applies cleanly to a real database, and the integration suites run against it as an
**unprivileged role that owns nothing and holds no `BYPASSRLS`**. That role is the only configuration
under which an isolation assertion means anything.

### Performance — measured, not estimated

100,000 employments · 1,000,000 ledger entries · 40,000 balances · 400,000 requests · 1,200,000
request days. Median of eleven runs, as the unprivileged role, inside a transaction with
`app.tenant_id` set.

| Read | Budget | Measured |
| --- | ---: | ---: |
| Balance for one employment and type | 50 ms | **0.4 ms** |
| `approved-leave-for` — Attendance calls this per day | 50 ms | **0.8 ms** |
| Balance as of a past date (ledger sum) | 50 ms | **0.3 ms** |
| Balances awaiting recalculation (partial index) | 50 ms | **0.4 ms** |
| Approval queue, paged | 50 ms | **0.4 ms** |
| Request register, paged and filtered | 50 ms | **1.4 ms** |
| Calendar: who is away, over a month | 50 ms | **2.1 ms** |
| Conflict detection for one request | 50 ms | **0.2 ms** |
| Ledger for one employment, paged | 50 ms | **0.8 ms** |
| Accrual run's employment page | — | **0.4 ms** |

**The register was 86.6 ms on the first run and is reported here because it was.** A date-filtered
register sorted the whole matched set — 86,000 rows — to return twenty-five. The fix is
`leave_request_register_idx on (tenant_id, requested_at desc, id) where deleted_at is null`, added
to the migration; the measurement above is after it. The first run also revealed a flaw in the
*benchmark* rather than the schema: every seeded request shared one `requested_at`, making the sort
degenerate. Both were corrected and the figure above is the honest one.

**The 2-second accrual-run budget is NOT VERIFIED.** What is measured is the employment page the run
reads (0.4 ms). The run itself is a command through the application stack, and measuring it needs a
harness this phase did not build.

---

## 4. Cross-module boundaries

| Direction | Mechanism | Permission |
| --- | --- | --- |
| Leave → Employment | `employment.read-employment`, `employment.search` | `employment.employment.read`, bounded grant |
| Leave → Attendance | `attendance.expected-working-days` | `attendance.read`, bounded grant |
| Attendance → Leave | `leave.approved-leave-for`, `leave.approved-leave-affecting` | `leave.read`, bounded grant |

Every one is a **read**. No adapter in either direction has a `create`, an `update` or any method
that could write. Cross-module read: allowed. Cross-module write: absent, not merely forbidden.

Leave holds no `personId`, no employment status, no money column, no attendance identifier and no
`on_leave` state anywhere.

---

## 5. Completed phases: what changed and why

Phase 8 (Attendance) gained exactly three things, all additive:

1. **`attendance.expected-working-days`** — a new query over existing `resolveExpectation` logic. No
   schema change, no behaviour change. This is approved decision D-1.
2. **`attendance.reconcile-leave`** and `LeaveDirectoryPort.approvedLeaveAffecting` — the pull
   direction of D-2 as approved.
3. **The real Leave adapter replaces `leaveUnavailable`** in the composition root.

Nothing else in Attendance changed — which is what the Phase 8 comment predicted would happen, and
did: the port was the right shape, the three answers were already modelled, and the calculation
already distinguished "no leave" from "nobody could be asked".

`attendance-ports.ts` was split into `attendance-ports.ts` and `cross-module-ports.ts` when the
added method took it past the 400-line budget. No behaviour changed; the export surface is
identical.

**The Phase 8 composition-root correction at `48fafd0` was not touched.** Employment's `asOf?: Date`
contract, `EmploymentSnapshot`'s structure and the historical `statusOn` semantics are unchanged.
Leave's own Employment adapter applies the same civil-date-to-instant conversion from the start.

---

## 6. NOT VERIFIED

**Scheduled execution of accrual, leave-year closure and carry-over expiry.** Nothing in this
repository runs on a timer. All three are operator commands — bounded, idempotent and restartable —
and each reports what it covered, wrote, skipped and refused. No fake scheduler was built and no
test pretends one exists. Phase 24 owns scheduling.

**Document verification.** An `attachmentReference` is stored and never resolved. No `DocumentPort`
adapter exists anywhere in this repository. The policy can require that a reference is *present*;
nothing verifies it points at anything.

**Notification of an approver.** `RecordingNotificationPort` records; it does not deliver. Leave
raises internal domain events and Communications (Phase 17) subscribes when it can address a
recipient.

**Every business endpoint returns 401.** Platform's authentication adapter is not supplied
(ADR-0032). The API surface is real, typed and tested through the dispatcher; it is unreachable over
HTTP by an authenticated human because there are no authenticated humans yet.

**Payroll consumption.** `LeavePayrollPeriodView` is published and typed. **No handler produces
one.** Phase 11 will implement the read against this contract; nothing in this phase pretends it
works.

**Statutory golden cases.** None exist, because no statutory rule ships to test. 00B's golden-case
acceptance criterion is **not met, and is not claimed to be**. What is tested instead is that the
machinery is country-agnostic.

**The two-contrived-country-packs fixture** described in the plan (§22) was **not built**. The
absence of statutory branching is evidenced by inspection and by the "no statutory default" domain
test, not by that fixture. Carried as debt D-4 below.

**Accrual run wall-clock at scale.** See §3.

---

## 7. Technical debt

| | Debt | Cost | Why not now |
| --- | --- | --- | --- |
| **D-1** | A foreign key does not enforce the tenant. PostgreSQL runs referential checks as the table owner with RLS suspended, so `leave_request.employment_id` resolves against another tenant's employment. Nothing leaks — the row is still tenant-scoped and invisible across tenants — and the application refuses it by resolving the employment through Employment's tenant-scoped read first. **Both halves are asserted in the isolation suite.** | A guarantee that lives in the application rather than the database | The fix is a composite foreign key on `(tenant_id, employment_id)`, which needs a matching unique constraint on Employment's side — a change to a completed phase |
| **D-2** | `standardDayMinutes` divides contracted weekly hours by a stated five-day week. A tenant on a six-day week using `calendar_days` gets a day length a sixth too long | Wrong day length for one configuration | The remedy exists and is better: `working_days`, which asks Attendance for the real pattern. Making the divisor configurable adds a field with no owner |
| **D-3** | `maximumConsecutiveMinutes` is checked per request. Two adjacent requests each at the maximum both pass | A cap that a determined requester can double | Catching it needs a rule about gaps between requests that no policy field expresses. Inventing one would decide a labour-relations question on a customer's behalf |
| **D-4** | The two-contrived-country-packs fixture is not built | Country-agnosticism is evidenced by inspection rather than by a test | Real work, and it belongs with the first country pack rather than before one exists |
| **D-5** | `row-writer.ts` is a fourth near-copy across modules (Recruitment, Onboarding, Attendance, Leave) | Four files that must change together | Hoisting it into `@work/persistence` changes a package every phase depends on. Inherited from Phase 7 |
| **D-6** | Leave-year closure and expiry read a page of balances via `search`, so a tenant with more than 1,000 buckets needs several runs | An operator runs the command more than once | The runs are idempotent and report their counts, so re-running is safe and visible. A cursor is Phase 24's shape |

---

## 8. Edge cases covered

Approved leave spanning a leave-year boundary (the ledger buckets by year and the request keeps its
day rows). Leave on a non-working day (no row, and the exclusion is *visible* in the response).
Cancellation after the leave has started (permitted, reverses). Amendment of an approved request
(supersedes; original's consumption reversed in the approving transaction). A balance driven
negative where the policy permits it (not clamped). A policy widened after a request was approved
(the request records its policy version). Two halves of one day (permitted). Two overlapping hourly
requests (refused, by the database, under real concurrency). A request whose employment has no
working pattern (refused by name). Leave unavailable to Attendance (the day says the question is
open). A repeated accrual run (writes nothing the second time). A repeated leave-year closure
(refused, no second carry pair).

---

## 9. Production readiness

**What is production-ready.** The domain model, the ledger and its guarantees, the constraint set,
tenant isolation, the permission separations, the API surface, the two cross-module boundaries, and
the reconciliation mechanisms. The measured read performance has headroom of one to two orders of
magnitude against every budget.

**What is not, and is marked so.** No authentication reaches these endpoints. No scheduler runs the
bounded commands. No document is verified. No notification is delivered. No statutory content exists
for any market. No self-service exists for employees or managers.

A customer could not operate leave from this build alone. What they could do is configure it,
exercise every rule through the API, and get arithmetic that is correct, auditable and fast — which
is what this phase was for.

---

## 10. Phase 10

**NOT STARTED.**
