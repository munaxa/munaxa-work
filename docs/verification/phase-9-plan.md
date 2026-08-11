# Phase 9 — Leave & Absence Management: Definition of Ready

**Date** 2026-08-10 · **Baseline** `f6b39b1` (Phase 8 approved) · **Status** planning checkpoint. No
application code, schema or migration is changed by this document.

This plan is written from the repository, not from the phase specification. Where the two disagree,
the disagreement is named and carried to §36 rather than resolved silently.

---

## 1. Repository Analysis

### 1.1 What is actually there

| | |
| --- | --- |
| Modules | `identity` (2), `organization` (3), `people` (4), `employment` (5), `recruitment` (6), `onboarding` (7), `attendance` (8) |
| Prisma models | 67 |
| ADRs | 0001–0020 founding, 0021–0057 in `docs/adr/` |
| Tests | 1,109 passing |
| Apps | `api`, `admin` (read-only screens), `employee-portal` and `manager-portal` (shells: `page.tsx` + `layout.tsx` only), `mobile` (own toolchain) |

Layout is module-first (ADR-0023): `packages/modules/<module>/src/{domain,application,infrastructure,contracts,api}`,
with the direction `domain ◄ application ◄ infrastructure ◄ api ◄ presentation` enforced by lint.
One shared `Dispatcher` and one `ModuleRegistry`, assembled in
`apps/api/src/identity/identity.module.ts`. Every module owns its own controllers.

### 1.2 Shared Kernel capabilities Leave will consume

Verified present in `packages/kernel/src`:

| Capability | File | What it gives Leave |
| --- | --- | --- |
| Gregorian ⇄ Hijri (Umm al-Qura) | `time/calendar.ts` | `toHijri`, `fromHijri`, `toGregorian`, `toInstant`, `formatCalendarDate`. ICU-backed, range 1900–2100, throws `calendar_out_of_range` outside it |
| Service period | `time/service-period.ts` | `serviceBetween` — years/months/days of service, for minimum-service eligibility and service-band accrual |
| Rule engine | `rules/rule-engine.ts` | `evaluateRule`, `versionInForce`, `EvaluationTrace`. **Decides; it does not compute** (carried debt) |
| Effective dating | `effective/effective-dated.ts` | `Timeline`, `.at(instant)`, `.scheduledAfter(instant)` |
| Money | `money/money.ts` | Exists. Leave will **not** use it (§21) |
| Ports | `ports/approval.ts`, `ports/notification.ts`, `ports/document.ts` | Interfaces only; adapters are `AutoApprovingPort` and `RecordingNotificationPort` |
| Projection | `projection/projection.ts` | The read-model base |

**`ApprovalPort` exists** with `ApprovalRequest`, `ApprovalStatus`, `ApprovalStep`, `ApprovalDecided`.
Its shipped adapter, `AutoApprovingPort`, approves everything immediately and records the approver as
`system:auto-approval`. See §12.

### 1.3 Two findings that change the plan

**Finding 1 — Organization publishes no calendar read, and no holiday read at all.**

`organization_calendar` (with `working_days: Int[]` and `time_zone`) and `organization_calendar_day`
(holidays) both exist and are written by `organization.define-calendar`, `organization.amend-calendar`
and `organization.record-calendar-day`. The published query list is exactly:

```
organization.list-unit-types · organization.list-units · organization.describe-unit
organization.list-legal-entities · organization.list-positions
organization.export-structure · organization.tenant-settings
```

`OrganizationCalendarView` is exported as a *type* and is reachable only inside
`organization.export-structure`, which returns the entire organization and is gated on
`OrganizationPermissions.exportStructure` — the broadest permission the module has.
`CalendarDayView` is exported as a type and **no query returns it**: there is no way to read a
tenant's public holidays through a contract.

This is the same gap Phase 8 recorded as D-2 and worked around. Phase 9 §14 cannot work around it the
same way, because leave *duration* is the number an employee is charged. See §19 and D-2 in §36.

**Finding 2 — a latent defect in Phase 8's composition root.**

`apps/api/src/attendance/attendance.composition.ts:131` declares `asOf: string` and passes it to
`employment.read-employment`, whose contract is `asOf?: Date`
(`employment-queries.ts:161`). The call site casts to `Query`, so the compiler does not see it. At
runtime the value reaches `inForceOn(states, instant)` → `DateRange.contains(instant)` →
`instant.getTime()`, which throws on a string.

It is unreachable today: every business endpoint returns 401 until Platform's authentication adapter
lands (ADR-0032), and no test exercises the real composition root. It is nonetheless wrong, and Leave
will write the same adapter shape. Carried to §36 as **D-1** rather than fixed here, because fixing it
is a Phase 8 change and this is a planning checkpoint.

---

## 2. Phase 0–8 Compatibility Analysis

| Phase | What Leave must respect | Where it is written |
| --- | --- | --- |
| 1 | Ports precede engines; calendar conversion is kernel-only; storage is UTC | ADR-0024, ADR-0027 |
| 1.1 | Layer direction, file budgets, complexity 10 / 5, no `any`, no suppressions | `docs/ENGINEERING_STANDARDS.md` |
| 2 | Tenant resolves from membership, not a header; delegation is Identity's | ADR-0032, ADR-0033 |
| 3 | Country comes from the legal entity, never the tenant; tenant settings are Organization's | ADR-0035, ADR-0036 |
| 4 | Personal data is protected; Leave reads no personal attribute | ADR-0038 |
| 5 | **There is no `on_leave` employment status, deliberately, because Leave owns it** | ADR-0040 |
| 5 | A reference to another module is one foreign key plus one published query | ADR-0042 |
| 6 | A control that authorizes something is decided by a named human, not by `AutoApprovingPort` | ADR-0045 |
| 7 | A guarantee is an idempotent command plus reconciliation, never an event | ADR-0050 |
| 8 | Raw evidence is immutable; recalculation is found by asking; the schedule owns the zone; `unknown ≠ none` | ADR-0052…0056 |
| 8 | A vendor is not a source; normalized contracts at the boundary | ADR-0057 |

**ADR-0040 is the load-bearing one.** Employment deliberately has no `on_leave` state so that Leave is
the single answer to "is this person on leave". Phase 9 must therefore never write an employment
status, and must never be asked to.

**Nothing in Phases 0–8 needs to change for Leave to be built**, with two exceptions that are
decisions rather than defects: the working-day read (§19, D-2) and the attendance-staleness trigger
(§20, D-3). Both are additions to Attendance, not modifications of it.

---

## 3. Platform Contract Analysis

Platform owns authentication, authorization, RBAC and the design system. Work consumes them.

- **Authentication**: `PlatformAuthenticationPort`; the shipped adapter authenticates nobody
  (ADR-0032). Every Leave endpoint will return 401 in this repository. That is expected and is not a
  Leave defect; it is stated again in the completion report rather than worked around.
- **Authorization**: `PlatformPermissionChecker`, wrapped by `GrantAwarePermissionChecker`
  (ADR-0043). Leave declares its own permissions and holds no Platform permission.
- **UI**: `@munaxa/ui` only. Leave's admin screens compose `Card` and the existing primitives; no
  component is added to the design system.
- **`@work/contracts`** is still an empty placeholder. Leave publishes through
  `@work/leave/contracts`, as every module before it has. Filling `@work/contracts` is not Phase 9's.

---

## 4. Employment Integration

**Leave attaches to `employment_id` and copies no employment fact** — the rule ADR-0051 states for
Attendance, applied identically.

What Leave needs and where it comes from:

| Need | Source | Note |
| --- | --- | --- |
| Does this employment exist in this tenant, as at a date | `employment.read-employment { employmentId, asOf }` | `asOf` is a **`Date`**, not a civil-date string (§1.3) |
| Status on the date, from the status history | Same query — `EmploymentSnapshot` reconstructs `statusOn` from history, not from the row | Suspension and ending both matter to eligibility |
| Start date, original hire date, end date | Same query | Proration and service bands |
| Probation end date | `ContractView.probationEndDate` | Probationary eligibility (§9) |
| Contracted weekly hours | `ContractView.workingHoursPerWeek` | The **only** honest basis for hours ⇄ days conversion (§18) |
| Unit and manager, for scoping | `EmploymentSnapshot.assignment.unitId`, `managerEmploymentId` | Scoping a queue. Never a business rule |
| A bounded page of employments | `employment.search` | Accrual runs and balance projections |

`ContractView.workingHoursPerWeek` is **optional**. An employment with no contract, or a contract with
no hours, cannot convert hours to days. That is a refusal by name — not a default of 8 — and it is
listed in §32 as an edge case with its own test.

Every one of these reads runs under a **bounded service grant** (ADR-0043) permitting exactly
`employment.employment.read`. A leave administrator does not thereby gain the employment register.

**Historical leave stays with the employment under which it was taken.** A leave request records the
employment, the leave type, the policy *version*, the entitlement rows it drew from and the working-day
basis it was computed against. A later transfer, manager change or contract change does not rewrite it.

**Forbidden, explicitly**: no `person_id` column anywhere in Leave; no employee number; no employment
status column; no second employee lifecycle; no `leave_employee` table.

---

## 5. Attendance Integration

Phase 8 declares the port Leave must now implement:

```ts
export interface ApprovedLeaveDay {
  readonly onDate: string;
  readonly coverage: 'full_day' | 'partial_day' | 'hourly';
  readonly minutes?: number;
  readonly leaveRequestId: string;
}
export type LeaveCoverage =
  | { readonly known: false }
  | { readonly known: true; readonly days: readonly ApprovedLeaveDay[] };
export interface LeaveDirectoryPort {
  approvedLeaveFor(employmentId: string, from: string, to: string): Promise<LeaveCoverage>;
}
```

Attendance calls it on **every** recalculation (`leaveOverlayFor` in `recalculate.use-case.ts`), and
maps the three answers to `applied` / `none` / `unknown` (ADR-0056).

### 5.1 The rule the adapter must obey

Phase 9 supplies `LeaveDirectory`, wired in `apps/api/src/attendance/attendance.composition.ts` in
place of `leaveUnavailable`. Three rules, each with a test:

1. Leave answered and there is approved leave → `{ known: true, days: [...] }`.
2. **Leave answered and there is none → `{ known: true, days: [] }`.** This is the case the whole
   contract exists for. An adapter that returned `{ known: false }` here would leave every employee
   permanently "pending explanation" and would make Phase 9 pointless.
3. Leave could not answer — the query threw, the grant was refused, the module is not registered →
   `{ known: false }`. **Never** `{ known: true, days: [] }`. Swallowing an error into "no leave" is
   how a system asserts an absence without leave that nobody checked.

Rule 3 is the one that will be got wrong by a future contributor tidying up error handling, so it is
stated in the adapter's own comment and covered by a test that makes the underlying query throw.

### 5.2 Direction, and what Leave may not do

```text
Attendance ──► LeaveDirectoryPort ──► leave.approved-leave-for (query) ──► Leave
```

Attendance never reads a Leave table. Leave never reads an Attendance table and **never writes one**
(AD-002). The one thing Leave must cause in Attendance — a recalculation — is §20.

### 5.3 What Leave reads *from* Attendance

Only two things, both queries, both under a bounded grant:

- the working-day expectation for a date range (§19 — this query does not exist yet);
- whether attendance already exists on a date being cancelled (§32 — `attendance.read-day`).

Leave does not read punches, does not read exceptions and does not read snapshots.

---

## 6. Leave Domain Boundary

**Leave owns**: leave types, leave policies and their versions, policy assignment, entitlements, the
leave ledger, balance projections, leave requests and their day breakdown, decisions, cancellations,
amendments, adjustments, accrual runs, blackout periods, and the published answer to "is there
approved leave on this date".

**Leave does not own**: Person, Employment, organizational structure, the working-time schedule, time
events, attendance results, public-holiday calendars, money, workflow routing, notification delivery,
document storage, employee identity resolution.

**Leave explains authorized absence. Attendance records what happened. Payroll decides what it costs.**

| Tempting to build here | Where it belongs | Why |
| --- | --- | --- |
| A holiday calendar | Organization, then country packs | Two owners of "is the 23rd a holiday" give two answers |
| A working-time schedule | Attendance | Already built, versioned and zone-aware |
| An employment status of `on_leave` | Nowhere | ADR-0040 |
| A pay value for a leave day | Payroll | §21 |
| An approval routing engine | Workflow (16) | §12 |
| A leave document store | Documents | §31 |

---

## 7. Leave Type Model

`leave_type` is tenant-configurable and **nothing is seeded**. No annual leave, no sick leave, no
codes. A tenant that has configured none gets a screen that says so.

| Column | Purpose |
| --- | --- |
| `code`, `name` (jsonb, en+ar) | Identity. The code is the tenant's or the country pack's, never ours |
| `unit` | `days` or `hours` — the unit the type is *expressed* in. Storage is always minutes (§10) |
| `paid_treatment_code` | Tenant/country-pack code. Leave stores it and never interprets it — Payroll does (§21) |
| `requires_attachment` | Whether the policy layer may demand supporting evidence |
| `requires_replacement`, `requires_contact`, `requires_address` | Fields the phase specification names, gated per type |
| `gender_restriction` | `none` \| a tenant/country-pack code. **Not** an enumeration of our own |
| `accrues` | Whether the type has entitlement at all. Unpaid leave typically does not |
| `statutory_source_code` | Null for a tenant-defined type; set by a country pack (§22) |
| `status`, `version_number` | Draft / published / superseded, as every definition in this product |

**No leave type is hardcoded.** Hajj leave, Iddah leave, bereavement by degree of kinship and marriage
leave are all *configuration* — they appear in the phase specification as examples of what a tenant or
a country pack may define, and this module ships none of them.

---

## 8. Policy Model

The separation the specification asks for:

```text
leave_type  ──►  leave_policy (versioned)  ──►  leave_policy_assignment (effective-dated)
                        │
                        └── eligibility rules, evaluated by the kernel rule engine
```

`leave_policy` is **versioned and effective-dated**, and a published version is immutable — the rule
Phase 7 established for plan versions (ADR-0048) and Phase 8 for shifts and schedules. Changing a
policy drafts the next version; the request and the ledger entry both record which version governed
them, so a policy widened in June does not retroactively re-entitle March.

What a policy version carries:

| Group | Fields |
| --- | --- |
| Eligibility | `minimum_service_months`, `available_during_probation`, `eligibility_rule` (a `RuleDefinition` evaluated by the kernel engine, with its trace stored on refusal) |
| Limits | `maximum_consecutive_minutes`, `maximum_per_request_minutes`, `maximum_per_year_minutes`, `minimum_notice_days`, `maximum_backdate_days` |
| Hourly | `hourly_permitted`, `hourly_minimum_minutes`, `hourly_maximum_per_day_minutes`, `hourly_maximum_per_month_minutes` |
| Duration basis | `duration_basis` — `working_days` \| `calendar_days` (§19) |
| Balance | `negative_balance_limit_minutes` (0 = prohibited, N = a floor, null = unlimited) |
| Accrual | `accrual_method`, `accrual_amount_minutes`, `accrual_anniversary_basis`, `proration_basis` (§15) |
| Carry-over | `carry_over_method`, `carry_over_cap_minutes`, `carry_over_cap_percent`, `carry_over_expiry_months` (§16) |
| Leave year | `leave_year_calendar` (`gregorian` \| `hijri`), `leave_year_start_month`, `leave_year_start_day` |
| Encashment | `encashable`, `encashment_cap_minutes` — **eligibility only, never a value** (§21) |
| Approval | `approval_required`, `self_approval_permitted` (default false) |
| Attachment | `attachment_required_beyond_minutes` |

`leave_year_calendar` is a first-class column because 00B requires it: *"Fiscal, payroll, leave and
service-period calculations state which calendar governs them, and the choice is configuration, not
code."* A Hijri leave year is not a display preference — it changes when entitlement resets.

`leave_policy_assignment` binds a policy version to a scope (`tenant` \| `legal_entity` \| `unit` \|
`employment`) with `effective_from`/`effective_to`. Resolution is most-specific-wins, as at the leave
date, and the resolution is recorded on the request so it stays reproducible. Overlapping assignments
at the same specificity are refused, not merged — the rule Attendance uses for schedule assignments.

---

## 9. Entitlement Model

An **entitlement** is a grant of leave for one employment, one leave type and one leave year. It is
not a balance; it is one of the inputs a balance is derived from.

`leave_entitlement` carries: employment, leave type, policy version, `leave_year_start`,
`leave_year_end`, `granted_minutes`, `source` (`accrual` \| `opening` \| `carry_over` \| `adjustment` \|
`statutory`), `accrual_run_id` where it came from a run, and the standard audit and version columns.

Eligibility is evaluated at three moments, and the answer is recorded rather than recomputed later:

1. **At entitlement creation** — is this employment eligible for this type at all (service, probation,
   the eligibility rule)?
2. **At request** — does the policy permit this request now (notice, limits, blackout, balance)?
3. **At approval** — the same checks re-run, because the world moved between submission and decision.

Re-running at approval is deliberate. A request submitted with balance and approved after that balance
was consumed elsewhere must be refused at the decision, not silently approved into a negative the
policy prohibits.

---

## 10. Balance Model

**The ledger is authoritative; the balance is a projection.** This is the answer to §8 of the phase
instruction, and it is the Attendance pattern applied to a different subject.

```text
leave_ledger_entry  (append-only, authoritative)
        │
        └──►  leave_balance  (projection, digest + inputs_changed_at)
                      │
                      └──►  reconciliation query + idempotent recalculation command
```

### 10.1 The ledger

`leave_ledger_entry` is **inserted and read. There is no update and no delete** — the same guarantee
`attendance_time_event` gives, for the same reason: a balance somebody disputes is a sum of rows, and
a row that could be edited is not evidence.

| Column | |
| --- | --- |
| `employment_id`, `leave_type_id`, `leave_year_start` | The bucket |
| `kind` | `opening` \| `accrual` \| `carry_in` \| `carry_out` \| `consumption` \| `expiry` \| `adjustment` \| `reversal` |
| `minutes` | **Signed.** Credits positive, consumption negative. A balance is a `sum`, not a case expression |
| `effective_on` | The civil date the movement belongs to — which may be back-dated |
| `recorded_at` | When it was written. Distinct from `effective_on`, always |
| `source_kind`, `source_id` | The request, the accrual run, the adjustment or the reversed entry |
| `reverses_entry_id` | A correction is a **reversal plus a replacement**, never an edit |
| `reason_code`, `note` | Required on `adjustment` |
| `policy_version_id` | Which rules produced it |

A unique index on `(tenant_id, source_kind, source_id, kind)` where not deleted makes every writer
idempotent: an accrual run that is repeated writes nothing the second time, and an approval retried
consumes once.

### 10.2 The projection

`leave_balance` holds `(tenant_id, employment_id, leave_type_id, leave_year_start)` with
`opening_minutes`, `accrued_minutes`, `carried_in_minutes`, `consumed_minutes`, `adjusted_minutes`,
`expired_minutes`, `available_minutes`, plus `entries_digest`, `calculated_at` and
`inputs_changed_at`.

Every write to the ledger sets `inputs_changed_at` on the affected balance **in the same
transaction**. `leave.recalculate-balances` recomputes what is marked, idempotently and bounded, and
`leave.balances-awaiting-recalculation` names what is outstanding. This is ADR-0053 applied verbatim,
and the reason is identical: event delivery is post-commit, in-process, at-most-once with no outbox,
so a projection that waited to be told would sometimes wait forever — and a stale balance looks
exactly like a correct one.

**A balance is never written except by recalculation from the ledger.** No command increments it.

### 10.3 The three questions the specification requires

The phase specification requires all three, and they are queries rather than reports:

| Question | How |
| --- | --- |
| Balance as of today | The projection row |
| Balance as of any past date | `sum(minutes) where effective_on <= :date` over the ledger. Deterministic, and it re-derives the row |
| **Balance projected to the end of the leave year** | The projection row **plus** the accrual the policy will produce between today and the leave-year end, computed by the same pure accrual function the run uses |

The third is what an employee plans against and what a manager approves against. It is a first-class
query, `leave.projected-balance`, and it is marked on the contract as a *projection*: it assumes
continued employment and unchanged policy, and it says so.

### 10.4 Minutes, not fractional days

Everything is stored as **integer minutes**. The specification requires fractional balances and
requires that they are never silently rounded. Integer minutes give exact halves, thirds and sevenths
of a day with no floating point anywhere; days are a presentation conversion through the employment's
contracted hours (§18). Rounding, where a policy configures it, is applied at consumption and recorded
on the ledger entry — never at storage.

---

## 11. Request Model

`leave_request` is the aggregate. `leave_request_day` is its child, and the child is what makes
duration unambiguous.

### 11.1 The request

`employment_id`, `leave_type_id`, `policy_version_id`, `from_date`, `to_date`, `total_minutes`,
`duration_basis`, `state`, `reason_code`, `justification`, `requested_by`, `requested_at`,
`balance_at_request_minutes`, `contact_during_absence`, `address_during_absence`,
`replacement_employment_id`, `delegation_id`, `attachment_reference`, `approval_id` (reserved, null),
`supersedes_request_id`, metadata, audit, version.

Three of those deserve a note.

- **`balance_at_request_minutes`** is recorded on the request because the specification requires it and
  because "what did they have when they asked" is the first question in every dispute.
- **`replacement_employment_id` and `delegation_id` are different things.** One covers the work, the
  other covers the authority. The delegation is **Identity's** — `identity.active-delegations-for`
  returns `DelegationView` — and Leave stores a reference, never a copy. Leave does not create
  delegations.
- **`attachment_reference`** is a reference. Leave stores no bytes (§31).

### 11.2 The day breakdown

`leave_request_day` holds one row per civil date: `on_date`, `portion`
(`full_day` \| `first_half` \| `second_half` \| `hours`), `minutes`, and for the hourly case
`start_local`/`end_local` wall-clock plus the `zone` they are meant in.

This child exists for four reasons, and each is load-bearing:

1. It is **exactly what `LeaveDirectoryPort` returns**. The adapter is a read of this table with no
   arithmetic, so Attendance and Leave cannot disagree about which dates are covered.
2. It makes duration unambiguous. A request is not "three days" — it is three rows whose minutes sum.
3. It is where non-working days are **excluded and visible**: a request spanning a weekend has no row
   for the weekend, and the screen can say why.
4. It is what conflict detection compares (§32), at date granularity rather than range granularity.

### 11.3 Lifecycle

```text
draft ──► submitted ──► pending_approval ──► approved ──► taken ──► closed
                │             │                  │
                │             ├──► rejected      ├──► cancelled
                └──► withdrawn                   └──► amended (superseded)
```

Every state earns its place:

| State | The invariant it represents |
| --- | --- |
| `draft` | Not yet asserted. Consumes no balance, blocks nothing, invisible to conflict detection |
| `submitted` | Asserted, validated, balance provisionally held. Distinct from `pending_approval` because a policy may require no approval — such a request goes `submitted → approved` without a decision row, and the absence of a decision row is itself the record |
| `pending_approval` | A named human owes a decision |
| `approved` | A decision was made. **Consumption is written to the ledger here**, not at `taken` |
| `taken` | The leave period has begun. A clerical state that a scheduled sweep or an operator moves; it changes no figure |
| `closed` | The leave year is settled and the request is beyond amendment |
| `rejected` | Decided against. Terminal |
| `cancelled` | Approved, then unmade. **Reverses the ledger consumption**, never deletes it |
| `withdrawn` | Taken back by the requester before a decision. No ledger effect |

The machine is **data** (`PERMITTED_TRANSITIONS`), tested exhaustively over every pair, as Employment's
and Attendance's are.

Consumption is written at `approved` rather than at `taken` because an approved future absence is
already committed: the balance an employee sees must not include leave they have been granted.

---

## 12. Approval Model

### 12.1 The conflict, stated

The phase specification says the approval-chain view *"is required from this phase, not from Phase 16.
It consumes the ApprovalPort defined in Phase 1."*

The repository says something different, and says it twice. ADR-0045 (Recruitment, approved) and the
Attendance dependencies file both record a deliberate refusal to use `ApprovalPort`, because the only
adapter is `AutoApprovingPort`, which approves everything immediately as `system:auto-approval`. The
approved decision behind ADR-0045 was explicit: *do not use `AutoApprovingPort` as if it represented
real human approval.*

Leave approval authorizes paid absence. It is the same class of control.

### 12.2 The proposal

**Leave records its own decision, in its own table, and does not consult `ApprovalPort` — while
publishing the chain in `ApprovalPort`'s own shape.**

`leave_request_decision`: `request_id`, `sequence`, `decision` (`approved` \| `rejected`),
`decided_by` (from the authenticated context — a caller cannot supply it), `decided_at`, `comment`,
`requested_by`, `reverses_decision_id`, audit, version.

`requested_by` is **copied onto the decision row**, and the copy is deliberate rather than careless:
a check constraint cannot reach another table, so `check (decided_by <> requested_by)` is only
enforceable in the database if both values are on the same row. Attendance gets this for free because
its correction request and its decision are one row; Leave's decisions are their own table so that
multi-level approval is a sequence rather than a column, and the copy is what buys the same
guarantee. It is written once, at insert, from the request — never supplied by a caller.

The published `LeaveApprovalChainView` has fields named and ordered to match `ApprovalStep`
(`approver`, `decidedAt`, `decision`, `comment`) inside a `LeaveApprovalStatusView` matching
`ApprovalStatus` (`approvalId`, `state`, `steps`, `completedAt`). The employee sees the chain from this
phase, as the specification requires. When Phase 16 lands, the *source* of those steps changes from
this table to Workflow and **the contract does not**.

`leave_request.approval_id` is present and null, exactly as `recruitment_requisition.approval_id` and
`attendance_day.approval_reference` are.

Multi-level approval in Phase 9 is **sequence, not routing**: a policy may require N decisions, and the
request stays `pending_approval` until N distinct approvers have decided. There is no escalation, no
timeout, no delegation resolution and no conditional path — those are Workflow's, and building them
here would be the second workflow engine the instruction forbids.

Carried to §36 as **D-4**, because it contradicts the phase specification in writing.

### 12.3 Integrity

Actor-specific · auditable · tenant-scoped · permission-controlled (`leave.approve`, separate from
`leave.request` and from `leave.manage`) · self-approval refused by the domain **and** by a check
constraint · immutable, with reversal as the only correction · **auto-approval is never recorded as
human approval**. A policy with `approval_required = false` produces a request that reaches `approved`
with **no decision row at all**, and the view says "no approval was required" rather than naming a
system approver.

---

## 13. Cancellation Model

Cancellation and rejection are different events and are modelled separately.

- **Rejection** ends a request that was never granted. No ledger effect.
- **Withdrawal** is the requester taking back their own undecided request. No ledger effect. Refused
  once a decision exists.
- **Cancellation** unmakes an *approved* request. It writes a `reversal` ledger entry against the
  original consumption, marks the affected attendance dates for recalculation (§20), and records
  `cancelled_by`, `cancelled_at` and a reason code.

Three rules:

1. Cancellation **never deletes** the consumption entry. Reversal is a new signed row.
2. Cancelling leave **wholly in the past** requires `leave.cancel` plus a reason, and is refused when
   attendance already exists on those dates unless the caller also holds `leave.manage` — because
   somebody's attendance record already says they were absent, and unmaking the authorization silently
   converts an authorized absence into an unexplained one. See §32.
3. **Partial cancellation is an amendment**, not a cancellation (§14).

---

## 14. Amendment Model

An approved request is never edited.

```text
original request (approved)
        │
        ├──► amendment request  (state: pending_approval, supersedes_request_id = original)
        │            │
        │            └──► decision by a named human
        │                        │
        ▼                        ▼
   superseded              approved — the new authoritative state
```

The original keeps its rows and its ledger entries; the amendment writes a reversal of the original
consumption and a fresh consumption of its own, both in the transaction that approves it. The chain is
readable in both directions: `supersedes_request_id` forward, and a query backward.

Shortening leave, lengthening it, moving it and changing its type are all amendments. Changing the
*reason text* on an undecided request is an ordinary update; changing it on an approved one is not
permitted, because the reason is part of what was decided.

---

## 15. Accrual

`leave_accrual_run` records a run: `policy_version_id`, `leave_type_id`, `period_start`, `period_end`,
`run_by`, `run_at`, and counts of employments examined, entries written and refused. A run is:

- **Pure at its core.** `accrue(employment facts, policy version, period) → minutes` is a function
  with no clock, no database and no randomness, tested against a table of cases.
- **Idempotent.** The ledger's unique index on `(source_kind, source_id, kind)` makes a repeated run
  write nothing. A run interrupted half way is re-run, not repaired.
- **Bounded.** A run takes a page of employments and reports what it covered; it does not attempt a
  hundred thousand in one request. Background scheduling is Phase 24's (§29 debt).
- **Explainable.** Every entry names the run and the policy version that produced it.

Methods supported, all configuration: `monthly`, `weekly`, `annual`, `front_loaded`,
`service_band`, `none`. Proration bases: `hire_date`, `calendar_month`, `none`. Service bands are a
`RuleDefinition` evaluated through the kernel rule engine, so a country pack can supply the bands
without code.

**No statutory formula is implemented.** Twenty-one days after five years is Jordanian law, not this
product's opinion (§22).

---

## 16. Carry-over

Carry-over is a **pair** of ledger entries, not a mutation: `carry_out` (negative) against the closing
year and `carry_in` (positive) against the opening one, written by one idempotent command
`leave.close-leave-year` in a single transaction. The pair is what makes the movement auditable in both
years.

Methods: `none` (the default; not every type carries over), `unlimited`, `capped_minutes`,
`capped_percent`. Expiry: `carry_over_expiry_months` from the new leave year's start, producing an
`expiry` entry on that date.

Historical years are preserved. Closing a year does not delete its balance projection; the projection
is retained and its `closed_at` is set, so "what did they have on the last day of 2026" is answerable
in 2029.

---

## 17. Expiry

Two distinct expiries, and they are not the same thing:

- **Carried-over leave expires** at `carry_over_expiry_months` after the leave-year start. An `expiry`
  entry is written for the unused remainder of the carried-in amount.
- **Ordinary entitlement lapses** at the leave-year end where the policy carries nothing over. That is
  the `carry_out` entry with no matching `carry_in`, and it is deliberately *not* called expiry,
  because the two produce different rows and different reports.

Expiry is produced by `leave.expire-carry-over`, an idempotent bounded command with a reconciliation
query — the same shape as accrual, for the same reason. Nothing expires because a timer fired and
nobody noticed.

---

## 18. Partial-Day and Hourly Leave

`leave_request_day.portion` is `full_day` \| `first_half` \| `second_half` \| `hours`.

- **Full day** draws the expected minutes of that date, from the working-day basis (§19). A date on
  which nothing was expected has no row.
- **Halves** draw half the expected minutes. `first_half`/`second_half` rather than a bare
  `half_day`, because two half-days on one date must be distinguishable — and because a manager
  needs to know which half.
- **Hours** carry `start_local`, `end_local` and the `zone`. The minutes are the elapsed wall-clock
  minutes in that zone, computed with the same two-pass zone solver Attendance uses — not by
  subtracting strings.

Hourly leave is **gated by policy**, never by type alone: `hourly_permitted`,
`hourly_minimum_minutes`, `hourly_maximum_per_day_minutes`, `hourly_maximum_per_month_minutes`.

**Hours ⇄ days conversion uses `ContractView.workingHoursPerWeek` and the employment's expected
working days**, and refuses by name when either is absent. There is no default working day in this
product, and inventing eight hours would be a labour-relations decision for a customer who never asked.

Cross-midnight hourly leave is **not supported in Phase 9** and is refused by name
(`hourly_leave_crosses_midnight`). Supporting it needs the leave day to be attributable to a shift
rather than to a civil date, which is a schedule question Attendance owns. Recorded in §35.

---

## 19. Working-Day Calculation

This is the plan's hardest question and it has no answer the repository already supplies.

### 19.1 What exists

- Attendance knows, per employment per date, whether work was expected and for how many minutes. The
  logic is `resolveExpectation` in `attendance/src/application/expectation-resolution.ts`, which
  resolves roster → schedule assignment → unscheduled, in the schedule's IANA zone. **It is internal.
  No query publishes it.**
- Organization holds `working_days` on a calendar and holidays in `organization_calendar_day`.
  Working days are reachable only through `organization.export-structure` (whole structure, broadest
  permission). **Holidays are reachable through nothing.**
- Phase 8's approved D-2 fallback made a public holiday an Attendance *roster entry* of kind
  `holiday`, and a rest day a property of the schedule cycle.

### 19.2 The options

| | Approach | Assessment |
| --- | --- | --- |
| **A** | Attendance publishes `attendance.expected-working-days { employmentId, from, to }` returning per-date `{ onDate, expected, expectedMinutes, dayKind, zone }` | **Recommended.** No duplication. Attendance already owns the answer, already applies the roster (so it picks up the D-2 holiday fallback), and already resolves the zone. It is a new query over existing logic — no schema change, no behaviour change |
| **B** | Organization publishes a calendar and holiday read; Leave combines it with a weekend rule | Reopens Phase 3, and still leaves rosters and schedules out — an employee on a night rota does not work Organization's calendar week |
| **C** | Leave counts calendar days, with `duration_basis` configurable | Correct for `calendar_days` policies and wrong for everything else. Kept as the **configured** basis, never as a fallback that pretends to be working days |
| **D** | Leave reimplements the schedule engine | Forbidden by §14 of the instruction, and it would be the second answer to "was Tuesday a working day" |

### 19.3 The proposal

Adopt **A**, with **C** as an explicitly configured alternative, and a named refusal in between.

- `duration_basis = working_days` → ask Attendance. If Attendance answers that the employment has no
  schedule at all (`dayKind = 'unscheduled'` for the whole range), the request is **refused by name**
  (`no_working_pattern`) rather than silently falling back to calendar days. A casual worker with no
  schedule has no working-day denominator, and inventing one mis-charges their entitlement.
- `duration_basis = calendar_days` → count every date in the range. Honest, and some statutory leave
  genuinely is counted this way.

Attendance's new query is additive and needs approval (§36, **D-2**). Until it exists, Phase 9 cannot
compute working-day durations correctly, and shipping `working_days` without it would be exactly the
fake completeness the instruction forbids.

---

## 20. Attendance Reconciliation

### 20.1 What must happen

When leave is approved, cancelled or amended, the attendance days for those dates are stale: their
`leaveState` and `absenceMinutes` were computed against a different answer.

### 20.2 What exists

`attendance.recalculate { employmentId?, attendanceDate?, limit? }` exists and is idempotent. But:

- with `employmentId` + `attendanceDate` it returns `not_found` when **no attendance day row exists** —
  and for a leave date with no punches and no roster entry, none does;
- without them it recalculates whatever is already marked, and nothing marks these days;
- `markStale` is a store method, reachable only from inside Attendance.

So today there is **no mechanism by which Leave can cause an attendance recalculation**. This is a real
gap, not a preference.

### 20.3 The proposal

Attendance gains one command:

```
attendance.mark-inputs-changed { employmentId, from, to, reason }
```

It marks the days in the range and **opens a day where none exists** — the same `markDay` behaviour
rostering already has, so a leave date with no punches becomes a day the calculation can explain rather
than a date nothing knows about. It carries its own permission (`attendance.recalculate`, reused), and
Leave calls it under a bounded service grant naming exactly that permission.

Leave writes its own `inputs_changed_at` on the affected balance in the same transaction, and calls
the Attendance command in the same transaction as the approval. If the call fails, the approval fails
— an approval that silently left attendance wrong is worse than a refused approval.

**And, because the command may still be lost to a crash between the two**, Leave publishes
`leave.days-awaiting-attendance-sync`: leave request days whose `attendance_synced_at` is null or older
than their last change. That is the reconciliation half, and it is the reason this design does not
depend on the command succeeding. ADR-0053, applied to a second module.

Carried to §36 as **D-3**.

### 20.4 What is not proposed

- No outbox. No event contract. No general-purpose messaging. The instruction forbids it and Phase
  16/17 own it.
- No Leave→Attendance table write, ever.
- No dependency on the internal `leave.request.approved` event for correctness. It may be raised; it is
  an accelerator, never the guarantee.

---

## 21. Payroll Integration

Payroll is Phase 11 and must not read a Leave table. Phase 9 publishes the contract it will read:

```ts
interface LeavePayrollPeriodView {
  employmentId: string;
  periodStart: string;            // civil dates
  periodEnd: string;
  lines: readonly {
    leaveTypeId: string;
    leaveTypeCode: string;
    paidTreatmentCode: string;    // the tenant's or the country pack's code, uninterpreted
    minutes: number;
    days: number;                 // converted through contracted hours; the basis is stated
    conversionBasisHoursPerWeek?: number;
    requestIds: readonly string[];
  }[];
  encashableMinutes: number;      // eligibility only
  calculationVersion: number;
  inputsDigest: string;
}
```

Three rules:

1. **No column in Leave holds money.** Not a rate, not a multiplier, not an amount. `paid_treatment_code`
   is a code Leave stores and never interprets — the same discipline `overtimeCandidateMinutes` follows
   in Attendance (ADR-0054).
2. **Encashment is eligibility, not value.** Leave says how many minutes are encashable under the
   policy. What they are worth is Payroll's, and computing it here would put a compensation decision in
   a leave module.
3. The view carries `calculationVersion` and `inputsDigest` so a payroll run is reproducible and a
   disputed figure is explainable — and so a period can be **frozen** if Phase 11 asks for it. Phase 9
   does not build a frozen snapshot; whether Leave needs one is Phase 11's question to ask, and
   pre-building it would be speculative.

---

## 22. Country Compliance Boundary

**No statutory rule is implemented in Phase 9.** Not Jordanian annual leave, not Saudi Hajj leave, not
UAE maternity, not a single accrual formula, entitlement figure or eligibility threshold.

The extension points, each concrete:

| Point | How a country pack uses it |
| --- | --- |
| `leave_type.statutory_source_code` | Marks a type as supplied by a pack rather than by the tenant |
| `leave_policy.country_pack_id`, `country_pack_version` | Which pack version authored this policy version |
| `leave_policy.eligibility_rule` | A `RuleDefinition`, evaluated by the kernel rule engine, versioned by `versionInForce` |
| `accrual_method = 'service_band'` + a rule | Bands as data |
| `leave_year_calendar` | Hijri leave years, where the law uses them |
| `gender_restriction` as a code | Maternity and Iddah leave without this product enumerating them |
| Policy assignment scoped to `legal_entity` | The pack resolves from the legal entity, never the tenant (ADR-0035) |

A tenant operating in three countries has three legal entities, three packs and three sets of policy
versions, resolved per employment. **If a new country requires a change to this module, that is an
architecture defect** (00B) — and the test that proves it is a fixture that configures two contrived
country packs with different accrual and different leave years and asserts that no Leave code path
branches on either.

**No golden-case statutory tests exist in Phase 9**, because Phase 9 ships no statutory rule to test.
The completion report will say so rather than claim 00B's golden-case criterion is met.

---

## 23. Authorization

Fourteen permissions, Attendance's shape:

| Permission | Held by |
| --- | --- |
| `leave.read` | Reads leave requests, balances and calendars across the tenant |
| `leave.read-own` | An employee's own leave. Phase 18 |
| `leave.request` | Submits on behalf of somebody else — an HR administrator |
| `leave.request-own` | Submits their own. Phase 18 |
| `leave.manage` | Amends, withdraws, moves a request administratively |
| `leave.approve` | **Decides.** Never the same permission as requesting |
| `leave.cancel` | Unmakes an approved request |
| `leave.adjust` | Writes an adjustment to the ledger |
| `leave.entitlement.manage` | Grants and revokes entitlement |
| `leave.accrual.run` | Runs accrual, closes a leave year, expires carry-over |
| `leave.policy.manage` | Drafts types and policies |
| `leave.policy.publish` | Freezes them. Separate, because a published policy governs everybody |
| `leave.balance.read` | Reads a balance without reading the reasons. Narrower than `leave.read` |
| `leave.export` | The register. Held by fewer people than read |

Separations that matter, each with a test: requesting is not approving (and the domain refuses
self-approval regardless of grants); drafting a policy is not publishing it; reading a balance is not
reading somebody's medical-leave reason text; running accrual is not managing entitlement.

**No broad People or Organization permission is required to manage leave.** The two cross-module reads
run under bounded service grants (ADR-0043) naming exactly `employment.employment.read` and — if D-2 is
approved — one Attendance read permission. Non-nesting, tenant and actor untouched, every elevation
logged.

---

## 24. Tenant Isolation

Every Leave entity is tenant-scoped, with row-level security applied by the creating migration
(ADR-0030): `call app_protect_table(...)` with `force row level security`, `using` and `with check`.

The integration suite connects as a role that owns nothing and holds no `BYPASSRLS`, following Phases
5–8. Assertions required before the phase is done — one per table plus four that are specifically
dangerous:

1. Every Leave table carries the policy (a single assertion over `pg_tables`).
2. Types, policies, assignments, entitlements, ledger entries, balances, requests, request days,
   decisions, adjustments, accrual runs and blackouts each hidden cross-tenant, by identifier and by
   search.
3. **A bulk `markStale` on balances cannot touch another tenant's rows** — the statement writes by
   predicate rather than by identity, so a missing tenant clause fails silently rather than loudly.
   This is the assertion Phase 8 found most valuable.
4. **The ledger sum is tenant-scoped.** A cross-tenant leak in an aggregate is invisible: the balance
   is just wrong by an amount nobody can trace.
5. **`leave.approved-leave-for` is tenant-scoped**, because it is the query Attendance calls and a leak
   there puts one tenant's leave on another tenant's attendance record.
6. A leave request refused for an employment that does not exist (the foreign key).

---

## 25. Audit

The existing infrastructure, not a second one. Audit columns on every table
(`created_at/by`, `updated_at/by`, `deleted_at/by`, `version`), written by
`auditForInsert`/`auditForUpdate`; the actor comes from the authenticated context and a caller cannot
supply it.

Beyond the columns, three tables are **append-only by design** and are the audit for the things that
matter: `leave_ledger_entry` (every balance movement), `leave_request_decision` (every approval),
`leave_request_event` (every state transition, with from/to, actor and instant).

Adjustments record, as §24 of the instruction requires: actor, reason code, note, signed minutes, leave
type, effective date, **and the projected balance before and after** — captured on the ledger entry at
the moment of writing, so "what did this adjustment change" needs no replay.

---

## 26. Events

Internal only. `leave.request.submitted`, `leave.request.approved`, `leave.request.cancelled`,
`leave.balance.recalculated` — raised through `transaction.collect(...)` and dispatched post-commit,
in-process, at-most-once.

**No correctness-critical effect depends on one.** Balance projection is reconciled (§10.2); attendance
staleness is a command plus a reconciliation query (§20). No published event contract, no outbox, no
subscription across a module boundary.

The completion report will state verbatim: *current event delivery is post-commit, in-process,
at-most-once, with no outbox.*

---

## 27. API

`/api/v1/leave/...`, every collection paginated, Problem Details on every failure, the 400/422
distinction the other modules use (malformed request versus refused business rule), 404 rather than 403
for another tenant's record.

| Group | Endpoints |
| --- | --- |
| Types | `GET /types` · `POST /types` · `POST /types/:id/publication` |
| Policies | `GET /policies` · `GET /policies/:id` · `POST /policies` · `POST /policies/:id/versions` · `POST /policies/:id/publication` · `POST /policies/:id/assignments` · `POST /assignments/:id/end` |
| Entitlements | `GET /entitlements` · `POST /entitlements` · `POST /entitlements/:id/revocation` |
| Accrual | `POST /accrual-runs` · `GET /accrual-runs` · `POST /leave-years/close` · `POST /carry-over/expiry` |
| Balances | `GET /balances` · `GET /balances/:employmentId` · `GET /balances/:employmentId/projected` · `GET /balances/:employmentId/as-of?date=` · `GET /balances/reconciliation` · `POST /balances/recalculation` |
| Ledger | `GET /ledger` (paginated, filterable by employment, type, kind, period) |
| Requests | `GET /requests` · `GET /requests/:id` · `POST /requests` · `POST /requests/:id/submission` · `POST /requests/:id/withdrawal` · `POST /requests/:id/amendment` |
| Decisions | `GET /requests/:id/approval-chain` · `POST /requests/:id/decision` · `POST /requests/:id/cancellation` |
| Adjustments | `GET /adjustments` · `POST /adjustments` |
| Calendar | `GET /calendar?from=&to=&unitId=` — who is away, for the admin screen |
| Sync | `GET /attendance-sync/outstanding` |
| Export | `GET /export?from=&to=` — bounded, refuses beyond the bound |

Route ordering is load-bearing (Phase 8 proved it): literal segments before parameterised ones, and an
API test asserts the resolution rather than trusting the declaration order.

Both calendars on the wire: a date field accepts `{ year, month, day, calendar }` **or** an ISO string,
and the response carries both representations where the specification requires it (leave requests do).
Conversion is the kernel's; no Hijri arithmetic exists in this module.

---

## 28. UI

`apps/admin`, read-only, consistent with every module before it. `@munaxa/ui` only. `?lang=ar` switches
language and direction together.

| Screen | Shows |
| --- | --- |
| Dashboard | Pending approvals, leave in progress today, balances awaiting recalculation, attendance sync outstanding |
| Types | Configured leave types and their status |
| Policies | Policy versions, their effective dates and their assignments |
| Entitlements | Grants by employment and leave year, with their source |
| Balances | The projection, with opening / accrued / consumed / adjusted / expired / available and the projected year-end figure |
| Ledger | The authoritative movements behind a balance — the screen that answers "why is it this number" |
| Requests | The register, filterable |
| Approvals | The queue, with the chain visible |
| Calendar | Who is away, by unit and date range |
| Adjustments | Every manual movement, with actor and reason |
| Boundaries | What Leave does not hold — no money, no attendance, no employment status, no documents |

**No Employee Self-Service and no Manager Self-Service UI.** No "request leave" button on an
administrator's screen. The portals stay shells.

The dashboard's two reconciliation counts are on the screen for the reason Attendance's is: they are
the numbers that reveal a *failure*, and a number a human can see is a number a human notices growing.

---

## 29. Performance

Representative scale to seed and measure, as Phase 8 did, as the unprivileged role under RLS:

- 100,000 employments
- 20,000 with leave activity, over two leave years
- ~1,500,000 ledger entries
- ~200,000 requests and ~600,000 request days
- 5,000 pending approvals

| Read | Budget |
| --- | ---: |
| Balance for one employment and type (projection row) | 50 ms |
| **`leave.approved-leave-for` for one employment and date range** — called by Attendance on every recalculation | 50 ms |
| Balance as of a past date (ledger sum) | 50 ms |
| Projected year-end balance | 50 ms |
| Approval queue, paged | 50 ms |
| Request register, paged and filtered | 50 ms |
| Calendar view for a unit and a month | 50 ms |
| Conflict detection for one request | 50 ms |
| Balances awaiting recalculation (partial index) | 50 ms |
| Accrual run over a page of 200 employments | 2 s |

`leave.approved-leave-for` gets the most attention: it is on the path of every attendance
recalculation, so its cost is multiplied by every day of every run.

Avoided by construction: no N+1 (request days for a page of requests read with `= any(...)`; ledger
sums aggregated in SQL); no full-table recalculation (only marked balances); no unbounded query (every
list paginated, export refuses beyond its bound).

---

## 30. Security

- **Leave reason text is sensitive.** A sick-leave justification is close to health data. `leave.read`
  and `leave.balance.read` are separate permissions for exactly this reason, and the export carries
  **no justification text and no attachment reference** — the same discipline that keeps coordinates
  out of Attendance's export.
- No personal data is stored: no name, no identifier, no contact detail except
  `contact_during_absence`, which the employee supplies for the absence and which is bounded in length
  and never indexed for search.
- Every input validated at the edge (`class-validator`) and again in the domain. Nothing a caller sends
  is concatenated into SQL.
- The actor is never taken from a request body — not the requester, not the approver, not the adjuster.
- Cross-tenant access is refused by RLS *and* by an explicit tenant predicate, as ADR-0030 requires.
- Rate limiting remains absent repository-wide (carried debt, Phase 24).

---

## 31. Testing

Modelled on Phase 8's 95 + 7.

**Domain (pure, no database)** — entitlement eligibility; each accrual method; proration at hire and at
termination; service bands through the rule engine; carry-over methods and caps; expiry; the request
state machine, exhaustive over every pair; duration from a day breakdown; halves; hourly minutes across
a zone; negative-balance policy variants; ledger arithmetic and digest reproducibility; the
self-approval refusal.

**Application (in-memory stores, through the real dispatcher)** — request → submit → approve → ledger
consumption; rejection; withdrawal; cancellation writing a reversal; amendment superseding; adjustment
with before/after; accrual run idempotent on rerun; leave-year close writing the carry pair; balance
recalculation reproducing the digest; the reconciliation query finding and clearing.

**Integration (real PostgreSQL, unprivileged role)** — RLS on every table (§24); the ledger's
idempotency index refusing a duplicate; the self-approval check constraint; the overlap constraint
(§32); civil dates surviving the round trip; concurrent approvals of one request converging; concurrent
requests racing on the same dates.

**Security** — every permission refused to a caller holding all the others; self-approval refused for a
caller granted both; cross-tenant reads; the export carrying no justification text.

**Reliability** — duplicate request submission; concurrent approval; **attendance recalculation
triggered after a leave change**; **reconciliation recovering a leave change whose attendance sync was
lost**; balance recalculation after a back-dated adjustment.

**Cross-module** — the `LeaveDirectory` adapter returning all three answers, including the two failure
modes in §5.1; an Attendance day recalculated from `absence_pending_explanation` to `applied` once
leave exists (the end-to-end proof that Phase 8's contract is now honoured).

---

## 32. Critical Edge Cases

Each gets a test; the ones with a non-obvious answer state it here.

| Case | The answer |
| --- | --- |
| Leave crossing a month boundary | Day rows are per date; the ledger entry's `effective_on` is the request's start, and the payroll view splits by period from the day rows |
| Leave crossing a **leave-year** boundary | The request is split into two entitlement periods and draws from both balances. Refused if either lacks entitlement. This, not the calendar year, is the boundary that matters |
| Leap year | 29 February is an ordinary date. The Hijri leave year is not 365 days and is never assumed to be (00B) |
| DST | Hourly leave minutes are computed by the zone solver, not by subtracting wall-clock strings. A 09:00–17:00 hourly request on a spring-forward day is seven hours, not eight |
| Half day | `first_half`/`second_half`; two halves on one date are permitted and sum to a full day |
| Hourly leave | Policy-gated; refused when the type or policy forbids it |
| **Overnight / cross-midnight hourly leave** | **Refused by name in Phase 9** (§18). Not silently truncated |
| Schedule changes after the request | The request keeps the day rows and minutes it was approved with. A schedule change does not re-charge somebody's entitlement. The *attendance* days are marked stale by Attendance's own rule |
| Employment terminated during approved leave | Leave beyond the end date is truncated by an explicit command with a decision record and a ledger reversal for the truncated portion. Never silently |
| Cancellation after attendance exists | Permitted with `leave.manage` and a reason; the affected attendance dates are marked stale so the day is recalculated from `applied` to whatever it now is. Refused with `leave.cancel` alone |
| Overlapping leave | A hard error. Enforced in the database (§33), not only in the application |
| Concurrent requests for the same dates | The database decides, as ingestion does in Attendance. The loser is refused by name |
| Concurrent approvals of one request | Optimistic concurrency on the request row; the second is refused, not merged |
| Balance exhaustion | Refused unless the policy permits a negative to a stated floor |
| Negative balance | Policy-driven, three modes (§8). Never a global rule |
| Carry-over expiry | An `expiry` ledger entry on the expiry date, produced by a command with a reconciliation query |
| Policy version change | Requests and ledger entries name the version that governed them. A June policy does not re-entitle March |
| Retroactive entitlement adjustment | A back-dated ledger entry with `effective_on` in the past and `recorded_at` now. Marks the balance stale; the as-of query re-derives correctly |
| **LeavePort unavailable** | Attendance receives `{ known: false }` and reports `absence_pending_explanation`. Tested by making the query throw |
| Missed event | Nothing depends on one. The reconciliation queries recover both projections |
| Employment with no contracted hours | Hours ⇄ days conversion refused by name. No default is invented |
| Employment with no schedule, `working_days` basis | Refused by name (`no_working_pattern`). No silent fallback to calendar days |

---

## 33. Database / Migration Plan

One migration, `prisma/migrations/<timestamp>_leave/migration.sql`, creating **fourteen** tables, each
tenant-first, audited, versioned, soft-deleted, and protected by `call app_protect_table(...)` in the
same migration (ADR-0030). No historical migration is edited. The schema is inspected first: there is
no `Leave*` model today and no name collides.

| Table | Notes |
| --- | --- |
| `leave_type` | Unique `(tenant_id, code, version_number)` where not deleted |
| `leave_policy` | Versioned; FK to type; unique `(tenant_id, code, version_number)` |
| `leave_policy_assignment` | FK to policy; scope + scope id; effective dated; overlap refused per scope |
| `leave_entitlement` | FK to `employment(id)` and type; unique `(tenant_id, employment_id, leave_type_id, leave_year_start, source, source_id)` |
| `leave_ledger_entry` | **Insert and read only.** FK to employment and type; unique `(tenant_id, source_kind, source_id, kind)` where not deleted; index `(tenant_id, employment_id, leave_type_id, leave_year_start, effective_on)` |
| `leave_balance` | Unique `(tenant_id, employment_id, leave_type_id, leave_year_start)`; **partial index** `(tenant_id, inputs_changed_at) where inputs_changed_at is not null and deleted_at is null` |
| `leave_request` | FK to employment, type, policy version; `check (decided_by is null or decided_by <> requested_by)` lives on the decision table, not here |
| `leave_request_day` | FK to request; unique `(tenant_id, request_id, on_date, portion)`; index `(tenant_id, employment_id, on_date)` — **the index `leave.approved-leave-for` uses** |
| `leave_request_decision` | Insert and read only; carries a copy of `requested_by` so `check (decided_by <> requested_by)` is enforceable in the database (§12.2); unique `(tenant_id, request_id, sequence)` |
| `leave_request_event` | Append-only history |
| `leave_adjustment` | The administrative record behind an `adjustment` ledger entry |
| `leave_accrual_run` | Idempotency and reporting for a run |
| `leave_blackout` | Periods a policy forbids, scoped like an assignment |
| `leave_year` | Closed leave years, with their carry pair and closure actor |

**Two constraints need a decision.**

*Overlap.* The correct tool is an exclusion constraint —
`exclude using gist (tenant_id with =, employment_id with =, during with &&) where (state in ('approved','taken'))` —
which needs the `btree_gist` extension. **No migration in this repository creates an extension.** The
fallback is a partial unique index on `(tenant_id, employment_id, on_date, portion)` over live states,
which refuses two full days and two identical halves but cannot express "these hourly ranges overlap".
Carried to §36 as **D-5**.

*Signed minutes.* `leave_ledger_entry.minutes` is a signed integer with a check that it is non-zero,
and a check that `kind` and sign agree (credits positive, consumption and expiry negative). A ledger
whose sign convention lives only in application code is a ledger that will eventually sum to the wrong
number.

---

## 34. Risks

| | Risk | Mitigation |
| --- | --- | --- |
| **R-1** | **Working-day duration is wrong**, because the read Leave needs does not exist. Every entitlement figure downstream is then wrong | D-2. Until approved, `working_days` refuses rather than approximates |
| **R-2** | **A balance is silently wrong.** The worst failure this module has: nobody notices until somebody is refused leave they had | Ledger authoritative, projection derived, digest, reconciliation query on the dashboard, and an as-of query that re-derives from the ledger independently |
| **R-3** | **Attendance is not recalculated after a leave change**, leaving somebody marked absent when they were on approved leave | D-3, plus the outstanding-sync reconciliation query that does not depend on the command succeeding |
| **R-4** | The `LeaveDirectory` adapter swallows an error into "no leave", silently converting an unavailable system into a confirmed absence | The rule is stated in §5.1, in the adapter's comment, and covered by a test that throws |
| **R-5** | Approval is mistaken for a real human decision | ADR-0045's pattern; `AutoApprovingPort` not consumed; no decision row where none was required |
| **R-6** | Country logic creeps into the core through a "sensible default" | Nothing seeded; every threshold nullable and inert; the two-contrived-packs test |
| **R-7** | Fourteen tables and eight aggregates is a large phase; file budgets and complexity limits bite late | Split before the limit, as Phase 8 learned the hard way. Aggregate boundaries fixed in this plan, not discovered during implementation |
| **R-8** | Hourly leave semantics leak into Attendance's day calculation | The port already carries `coverage: 'hourly'` and `minutes`; Attendance already handles it. No Attendance change |

---

## 35. Ambiguities

Recorded rather than guessed. None blocks the plan; each has a stated default.

1. **`leave_request_event` versus audit columns.** Employment keeps a status-history table and
   Onboarding keeps a task-event table. *Default: keep the history table* — "what state was this request
   in on the fourteenth" must be answerable to somebody who was not subscribed.
2. **Where a blackout period is scoped.** Policy, unit or leave type. *Default: its own table scoped
   like an assignment*, because a blackout is usually organizational (a stocktake, a month-end) rather
   than a property of a leave type.
3. **Whether `taken` is swept automatically.** *Default: it is a command, not a timer.* Phase 24 owns
   scheduling; nothing in this repository runs on a clock.
4. **Cross-midnight hourly leave.** Deferred and refused by name (§18). Supporting it requires
   attributing leave to a shift rather than a civil date.
5. **Whether Leave needs a frozen payroll snapshot** like Attendance's. *Default: no.* Phase 11 has not
   asked, and building one now is speculative.
6. **Whether the leave year is per policy or per tenant.** *Default: per policy version*, because a
   tenant with a Hijri statutory leave type and a Gregorian discretionary one needs both.
7. **Attachment requirement enforcement.** Leave can require that a reference is *present*; it cannot
   verify a document exists, because no DocumentPort adapter is wired. *Default: enforce presence,
   mark verification NOT VERIFIED.*
8. **Half-day semantics on a non-uniform shift.** `first_half` of a split shift is not obviously half
   the minutes. *Default: half the expected minutes of the date*, stated on the contract, revisited if a
   customer disagrees.

---

## 36. Decisions Requiring Approval

| | Decision | Recommendation |
| --- | --- | --- |
| **D-1** | **Fix the Phase 8 composition-root defect** (§1.3): `attendance.composition.ts` passes a civil-date string into `employment.read-employment`'s `asOf: Date`, which throws at runtime. One-line fix plus a test | **Fix it.** It is a defect, not scope creep, and Leave is about to write the same adapter. If refused, Leave's adapter will convert correctly and the Attendance one stays wrong |
| **D-2** | **Add `attendance.expected-working-days { employmentId, from, to }`** to Attendance — a new query over existing `resolveExpectation` logic, no schema change, no behaviour change | **Approve.** Without it, working-day duration cannot be computed without duplicating Attendance's schedule engine, which §14 forbids. The alternative is that Phase 9 ships only `calendar_days`, which most customers cannot use |
| **D-3** | **Add `attendance.mark-inputs-changed { employmentId, from, to, reason }`** to Attendance, opening a day where none exists; Leave calls it under a bounded grant, plus a Leave-side reconciliation query | **Approve.** There is today no mechanism by which Leave can cause an attendance recalculation, and §20/§21 of the instruction require one |
| **D-4** | **Leave records its own approval decisions and does not consume `ApprovalPort`**, publishing the chain in `ApprovalPort`'s shape — contradicting the phase specification's "It consumes the ApprovalPort defined in Phase 1" | **Approve the repository's precedent (ADR-0045).** The only adapter auto-approves as `system:auto-approval`; treating that as human approval of paid absence is the fake completeness §42 forbids. The employee still sees the chain from this phase |
| **D-5** | **Enable the `btree_gist` extension** so overlapping leave is refused by an exclusion constraint rather than by application code plus a partial index | **Approve, or accept the narrower guarantee.** Without it, "two overlapping hourly requests" is refused by the application and by a re-check inside the transaction, but not by the database — and the report will say so |
| **D-6** | **Fourteen tables in one phase.** Confirm the aggregate set before implementation rather than during it | Confirm §33's list, or name what to drop |
| **D-7** | **`leave.read` versus `leave.balance.read` as separate permissions**, so a balance can be read without reading sick-leave reason text | **Approve.** It costs one permission and it is the difference between a manager seeing a number and a manager seeing a diagnosis |
| **D-8** | **No statutory content and therefore no golden-case tests** in Phase 9, contrary to 00B's acceptance criterion — because Phase 9 ships no statutory rule | **Approve as stated**, with the completion report saying so explicitly rather than claiming the criterion is met |

---

## 37. Definition of Done

Phase 9 is complete when all of the following hold. Anything unmet is reported as unmet.

**Architecture**
- [ ] Fourteen tables, tenant-first, audited, versioned, soft-deleted, RLS applied by the creating migration
- [ ] Module layout `domain → application → infrastructure → api`, direction lint-clean
- [ ] No `person_id`, no employment status, no money column anywhere in Leave
- [ ] No Attendance table read or written by Leave; no Leave table read by Attendance
- [ ] No country-specific rule, threshold, entitlement or leave type shipped

**Behaviour**
- [ ] Ledger append-only; balance derived; digest reproducible; as-of query re-derives independently
- [ ] Accrual, leave-year close and carry-over expiry are idempotent, bounded and reconciled
- [ ] Request lifecycle exhaustive over every state pair
- [ ] Approval recorded by a named human; self-approval refused by domain and by constraint; reversal is the only correction
- [ ] Amendment supersedes; cancellation reverses; neither deletes
- [ ] Partial-day and hourly leave computed in the schedule's zone; cross-midnight refused by name
- [ ] `LeaveDirectory` adapter wired into Attendance, returning all three answers, with the unavailable case tested by a throwing query
- [ ] An Attendance day moves from `absence_pending_explanation` to `applied` once leave exists — proved end to end

**Quality gates** — all `PASS`
- [ ] `check-standards`, `check-architecture`, `check-localization`, `check-dependencies`
- [ ] `format:check`, `lint`, `typecheck`, `test`, `build` (`pnpm verify`)
- [ ] Migration applies cleanly to a real database; integration suites run against it

**Evidence**
- [ ] Tenant isolation proved as an unprivileged role with no `BYPASSRLS`, including the bulk-mark and aggregate cases
- [ ] Every permission separation covered by a refusal test
- [ ] Every edge case in §32 covered
- [ ] Performance measured at the §29 scale, as the unprivileged role, with the numbers published

**Documentation**
- [ ] ADRs for: the ledger-authoritative balance; leave attaches to employment; leave approval is a real decision (extending ADR-0045); the working-day contract; the country-pack extension points
- [ ] `docs/modules/leave.md`, `DOMAIN_OWNERSHIP.md`, `PHASES.md`, `ARCHITECTURE.md`, `RELEASE_NOTES.md`, ADR register
- [ ] `docs/verification/phase-9-report.md`, marking each claim **IMPLEMENTED** / **CONTRACT AVAILABLE** / **NOT VERIFIED**, and reporting explicitly: the absence of statutory content and golden-case tests; the state of the working-day contract; the state of the attendance-sync trigger; notification delivery; document storage; scheduled accrual; the Platform authentication boundary

**Production completeness** — none of the following counts as done: a fake balance calculation, a mock approval, a fake notification, fake document storage, a hardcoded statutory rule, a simulated payroll integration, or a fake Attendance integration.
