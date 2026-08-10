# Phase 11 — Payroll — Definition of Ready

**Status** Ready for review · **Date** 2026-08-10 · **Baseline** Phase 10 at `b0c82b5`

**Compensation says what a person is entitled to receive. Payroll says what is actually paid for a
period, and can still say why, five years later, after every source record has moved on.** That
second half is the whole difficulty of this phase, and almost every decision below exists to serve
it.

This is a planning checkpoint. No application code, schema or migration is proposed for creation
here — only this document. Everything below is a *proposal* until approved.

---

## 1. Repository Analysis

The repository was inspected rather than assumed. Every row below was verified against the working
tree at `b0c82b5`.

| Fact | Consequence for Phase 11 |
| --- | --- |
| **95 Prisma models. Not one payroll, payslip, journal, ledger, bank-account or exchange-rate table exists.** The string `payroll` appears in the schema only inside comments | Phase 11 starts from nothing. §63's instruction not to assume an empty schema was checked, and the schema is in fact empty here |
| `packages/modules/` contains attendance, compensation, employment, identity, leave, onboarding, organization, people, recruitment. **There is no `finance` module, no `accounting` module and no `payroll` module** | §5's "analyze the existing Finance/accounting architecture" resolves to: **there is none**. Marked `NOT VERIFIED` throughout, and it is decision **D-6** |
| `packages/contracts/src/index.ts` is a bootstrapped stub: `export {};` with the comment "Filled by the phase that owns each module" | There is no shared published-contract package in use. Every module publishes through its own `contracts/` directory, and Payroll must follow that |
| `packages/country-packs/src/index.ts` is a bootstrapped stub: `export {};` with the comment "Filled in Phase 11.1" | **The country-pack package exists and is empty.** Phase 11 defines the interface; Phase 11.1 fills it. This is decision **D-4**, and it is why no statutory rule may ship here |
| **No exchange-rate table, service, port or function exists anywhere in the repository** | §25 applies literally: conversion has no authoritative owner. Decision **D-5**, and the honest answer is `NOT VERIFIED` |
| `Money` (kernel `money/money.ts`): integer minor units in `bigint`, `Currency { code, exponent }` supplied never assumed, explicit `Rounding` at every call site with **no default**, exact `allocate`, `parse` that refuses excess precision | The arithmetic primitive is settled. §23/§24/§26 are already the kernel's position |
| Phase 10 established the persistence convention: `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint` (ADR-0061) | Payroll persists money the same way. No second convention |
| `PostgresUnitOfWork.execute` opens a fresh connection, `begin`, `set_config('app.tenant_id', …, true)`, work, `commit`, then dispatches in-process post-commit. **No outbox, no durable subscription, at-most-once** | §12/§47 confirmed against the code, not against a document. Payroll correctness must be pull-based |
| `app_protect_table(regclass)` applies `enable`/`force row level security` plus `using` and `with check` (ADR-0030) | Tenant isolation is one call per table. No new mechanism needed |
| `btree_gist` is installed (Phase 9's migration) | Period-overlap exclusion is available now with no new extension decision (§8) |
| **No `create trigger` statement exists in any migration.** The only server-side code is `app_current_tenant()`, `app_protect_table()`, `app_isolation_diagnostics()`, `app_uuid_v7()`, `app_memberships_of()` | A trigger enforcing finalized immutability would be the **first trigger in the repository**. That is architecturally significant and is raised as part of **D-9** |
| `auditForInsert` supplies `created_at/by`, `updated_at/by`, `deleted_at/by`, `version: 1`; `Repository.updateRow` appends `version = version + 1` | The audit and optimistic-concurrency conventions are fixed. Payroll reuses them (§46) |
| Compensation publishes `compensation.payroll-period` and `compensation.changed-since`, with `inputsDigest` and `calculationVersion` on the period view | The Compensation half of the input contract **already exists and was built for this** (ADR-0062) |
| Attendance publishes `attendance.read-snapshots` → `PayableSnapshotView[]`, carrying `regularCandidateMinutes`, `overtimeCandidateMinutes`, `unpaidMinutes`, `leaveMinutes`, `blockingExceptions`, `calculationVersion`, `inputsDigest`. Produced by the command `attendance.freeze-period` | The Attendance half exists, is frozen and is digested. **It carries candidate minutes, never an approved overtime result** — see §19 and decision **D-16** |
| Leave declares and exports `LeavePayrollPeriodView`, but **none of Leave's 17 published queries returns it.** Leave's published reads are `leave.approved-leave-for` and `leave.approved-leave-affecting`, both returning `ApprovedLeaveView` (day coverage, minutes, request id, leave type id) | **A real gap.** The type Payroll was meant to consume has no handler. Decision **D-15**; §15 forbids reaching into Leave persistence |
| Employment publishes `employment.read-employment` (with `asOf`, returning `EmploymentSnapshot` with `statusOn`), `employment.search`, `employment.read-history`, `employment.export-workforce`. `AssignmentView` carries `unitId`, `positionId`, `costCenterId`, `fte` | Employment's contract is sufficient for identity, status-as-at-a-date, placement and cost centre. **It carries no payroll-eligibility flag** — decision **D-18** |
| `EMPLOYMENT_STATUSES` are `draft`, `pending_approval`, `active`, `suspended`, `ended` (ADR-0040). A suspended employee is still employed | Payroll population cannot be "status = active". Whether a suspended employment is paid is configuration, not a constant |
| Organization publishes `organization.governing-legal-entity` → `LegalEntityView` with `countryCode` and `currencyCode`, plus `describe-unit`, `hierarchy`, `list-units`, `list-positions`, `tenant-settings`, `export-structure` | The country anchor and the entity currency are both reachable as reads |
| `FinancialCenterView` exists and Organization has `open-cost-center`/`close-cost-center` commands, but **the only query that returns centres is `organization.export-structure`** (the whole `OrganizationSnapshot`). There is no `organization.list-centers` | Cost allocation (§37) cannot resolve a cost-centre label without exporting the entire structure. Decision **D-17** |
| Approval precedent is unanimous across three phases: ADR-0045 (Recruitment), ADR-0060 (Leave), ADR-0062/§26 (Compensation) all **decline `ApprovalPort`**, record a named human's decision, and refuse self-approval by check constraint | §34 is already settled by precedent. Decision **D-12** confirms rather than reopens |
| Compensation ships **no deductions at all** (Phase 10 D-1), and `COMPONENT_KINDS` is `['base', 'allowance', 'one_time']` — `deduction` is deliberately not a kind | Phase 11 is genuinely the first place a deduction can exist, exactly as §21 says. There is nothing to migrate |
| Compensation ships **no projection** and answers `compensation.payroll-period` set-based from authoritative rows, measured within budget at 100,000 employments | The precedent for "benchmark before projecting" is established and should be repeated (§65) |

**What is not in the repository is as load-bearing as what is.** No Finance, no country pack, no
exchange rate, no bank account, no document port, no workflow engine, no loan, no benefit. Six of
the fourteen mandated decisions are therefore decisions taken against genuinely empty ground, and
this plan marks them `NOT VERIFIED` rather than describing an integration that does not exist.

---

## 2. Phase 0–10 Compatibility Analysis

| Phase | What Payroll must respect |
| --- | --- |
| **0–1 Foundation** | `Money`, `Timeline`, `DateRange`, `evaluateRule`/`versionInForce`, `runWithServiceGrant`, `serviceBetween`. All reused; none reimplemented. The Hijri calendar exists and Payroll does not need it — noted so its absence is deliberate |
| **2 Workforce Identity** | The actor on every decision comes from the authenticated context, never from a command. Applies to calculation, approval, finalization and reversal alike |
| **3 Organization** | ADR-0035: the **legal entity** carries the country and the currency, never the tenant. This is why payroll scope is anchored on the legal entity (**D-1**) and why the country-pack lookup key comes from `governing-legal-entity` |
| **4 People** | ADR-0038: personal data protection. Payroll attaches to Employment and holds **no `personId`**, no name, no bank detail, no national identifier |
| **5 Employment** | ADR-0040: five statuses, no `on_leave`. ADR-0042: reference by identifier, read as at a date. Payroll resolves its population through `employment.search`, never a join |
| **6 Recruitment** | ADR-0045: approval is a named human's decision |
| **7 Onboarding** | ADR-0048: published versions are immutable — the rule Payroll applies to a finalized run |
| **8 Attendance** | ADR-0054: **candidate minutes, never money.** Payroll multiplies them; Attendance must never learn what a minute is worth. ADR-0052: a raw time event is immutable. ADR-0053: recalculation is found by *asking* — the pull pattern Payroll inherits wholesale |
| **9 Leave** | ADR-0056: `leaveUnavailable` / `known: false` — unknown is not none. ADR-0058: the dependency points one way and the **consumer pulls**. ADR-0059: authoritative records, digest, reconciliation. ADR-0060: nothing statutory ships |
| **10 Compensation** | ADR-0061: money carries its exponent. ADR-0062: **Compensation states entitlement, Payroll determines payment** — the sentence this whole phase is the other half of. ADR-0063: a change supersedes and never rewrites, which is what makes a re-run of a closed period produce that period's figure |

**Nothing in Phases 0–10 blocks this design, and three things actively enable it**: the digest and
`changed-since` reconciliation shape (Phase 9/10), the frozen `PayableSnapshotView` (Phase 8), and
the deliberate absence of money in every module before Compensation.

**Two conflicts exist with the repository rather than with the specification** — the missing Leave
payroll query (**D-15**) and the absence of an approved-overtime result (**D-16**). Both are raised
rather than worked around, as §14/§15/§65 require.

---

## 3. Platform Contract Analysis

| Kernel capability | Verified present | Used for |
| --- | --- | --- |
| `Money` — bigint minor units, exponent supplied, explicit rounding, exact `allocate` | ✅ `money/money.ts` | Every monetary value: earnings, deductions, gross, net, accounting lines |
| `Money.multipliedBy(num, den, rounding)` — exact integer arithmetic, no default rounding | ✅ | Proration (§18), overtime multipliers, percentage deductions |
| `Money.allocate` — exact remainder distribution | ✅ | Cost allocation splits (§31), where a split must sum back to the whole |
| `Timeline<TValue>` — overlap-refusing, `at`, `change`, `close` | ✅ `effective/effective-dated.ts` | Not needed by Payroll: a payroll period is a closed interval, not an effective-dated fact. Noted so its absence is deliberate |
| `DateRange` | ✅ `value/date-range.ts` | Period arithmetic, proration denominators, overlap checks |
| `evaluateRule` / `versionInForce` — deterministic, total, sandboxed, self-explaining | ✅ `rules/rule-engine.ts` | Population selection rules and deduction eligibility **as data**, so a country pack needs no code (§40) |
| `runWithServiceGrant`, `GrantAwarePermissionChecker` (ADR-0043) | ✅ | All five cross-module reads. Running payroll must not require a permission on the leave ledger |
| `ApprovalPort` / `AutoApprovingPort` | ✅ present, and **deliberately not consumed** | See §27. `AutoApprovingPort` approves as `system:auto-approval`, which §34 forbids as a human decision |
| `RecordingNotificationPort` | ✅ present — records, does not deliver | Not consumed. A payslip notification is Phase 17's |
| `serviceBetween` | ✅ `time/service-period.ts` | Available to a future country pack's EOS rule. Not used by the generic engine |
| `Dispatcher` / `ModuleRegistry` / `WorkModule` | ✅ | Payroll registers as one more module in `apps/api/src/identity/identity.module.ts` |
| `PostgresUnitOfWork` — tenant-scoped transaction, post-commit in-process dispatch | ✅ | Every command. **The at-most-once dispatch is why §12 exists** |
| **`DocumentPort` — rendering or storage of a document** | ❌ **absent** | Payslip rendering and storage: `NOT VERIFIED` (§33, **D-8**) |
| **`ExchangeRatePort` or any rate source** | ❌ **absent** | Currency conversion: `NOT VERIFIED` (§21, **D-5**) |
| **Any Finance / ledger / journal contract** | ❌ **absent** | Accounting posting: `NOT VERIFIED` (§30, **D-6**) |
| **Any bank-account or payment-instrument contract** | ❌ **absent** | Payment execution: `NOT VERIFIED` (§32, **D-7**) |
| **Any workflow engine** | ❌ **absent**, Phase 16 | Approval orchestration: the three-phase precedent applies (**D-12**) |

**Five genuine gaps, all of them at the module's outward edges rather than in its core.** None
prevents Payroll from calculating, finalizing and explaining a payroll. All five are recorded as
`NOT VERIFIED` and none is filled with a fake.

---

## 4. Employment Integration

Payroll reads Employment through published queries only, under a bounded service grant permitting
`employment.employment.read`. Nothing in Payroll writes to Employment, and no method could.

| Need | Query | What Payroll takes |
| --- | --- | --- |
| Population of a run | `employment.search` | Employment ids, paginated, filtered by legal entity and status |
| Per-employment facts | `employment.read-employment` with `asOf` | `statusOn`, `startDate`, `endDate`, `endReasonCode`, `assignment.unitId`, `assignment.positionId`, `assignment.costCenterId`, `assignment.fte`, `version` |
| Mid-period status change | `employment.read-history` | The dates a status changed inside the period, which is what makes proration by status possible |

**The employment is read as at a date, never as "now".** A payroll period that closed in March is
snapshotted against March's employment, so re-running it after an April transfer produces March's
cost centre. This is ADR-0042 and ADR-0051 applied to the one place where getting it wrong changes
somebody's payslip.

**`EmploymentView.version` is snapshotted**, giving §17's "Employment version" a real value rather
than a timestamp.

**Payroll eligibility is not an Employment fact.** `EmploymentView` has no such field, and adding
one would modify a completed module (§65). The population rule therefore lives in Payroll, over
facts Employment already publishes — status, dates, employment type code, legal entity. See
decision **D-18**.

---

## 5. Attendance Integration

Payroll reads `attendance.read-snapshots` under a grant permitting `attendance.read`. It never
reads an attendance table, never touches a raw time event, and never recomputes a minute.

`PayableSnapshotView` carries, per employment and period: `workedMinutes`,
`regularCandidateMinutes`, `overtimeCandidateMinutes`, `unpaidMinutes`, `absenceMinutes`,
`leaveMinutes`, `leaveState`, `daysTotal`, `daysApproved`, `daysUnapproved`, `blockingExceptions`,
`sequence`, `frozenAt`, `frozenBy`, `calculationVersion`, `inputsDigest`.

Four properties of this contract matter to the design:

1. **It is frozen.** `attendance.freeze-period` produced it; `sequence` and `frozenAt` identify
   which freeze. That is a stronger input than a live query and Payroll should require it.
2. **`blockingExceptions` is a refusal signal, not a warning.** A snapshot with unresolved blocking
   exceptions means the attendance facts are known to be incomplete. Payroll should refuse to
   calculate that employment rather than pay against a number Attendance itself distrusts.
3. **`inputsDigest` and `calculationVersion` make staleness detectable by comparison** — the
   mechanism §55 requires, already present.
4. **`overtimeCandidateMinutes` is candidate, not approved** (ADR-0054). Nothing in Attendance
   publishes an *approved* overtime quantity. See §19 and decision **D-16**.

`leaveState` on the snapshot is Attendance's record of whether it could reach Leave. `unknown` must
not be read as "no leave" (ADR-0056) — a snapshot whose leave state is unknown is not a payable
input.

---

## 6. Leave Integration

**This is the one place where the repository does not yet support the phase, and it is raised rather
than worked around.**

Leave publishes exactly two directory reads: `leave.approved-leave-for` and
`leave.approved-leave-affecting`, both returning `ApprovedLeaveView` — a list of covered days with
`onDate`, `coverage`, `minutes`, `leaveRequestId`, `leaveTypeId`. Both were built for Attendance
(ADR-0058) and both are on Attendance's recalculation path.

Leave also **declares and exports** `LeavePayrollPeriodView`, whose doc comment reads "What Payroll
(Phase 11) will read, published now so it never reads a Leave table", carrying `paidTreatmentCode`,
`minutes`, `days`, `conversionBasisHoursPerWeek`, `encashableMinutes`, `calculationVersion` and
`inputsDigest`. **No query handler returns it.** The type exists; the contract does not.

Three consequences:

- Payroll cannot obtain `paidTreatmentCode` from `ApprovedLeaveView` — it carries `leaveTypeId` and
  not the treatment code, and resolving the code would mean Payroll interpreting Leave's types.
- Payroll cannot obtain `encashableMinutes` at all.
- Payroll cannot obtain a Leave digest, so §55's stale detection has no Leave axis.

**Reaching into Leave persistence is forbidden (§15) and reading `leave.types` to map type to
treatment would be Payroll deciding what Leave means.** The plan therefore raises decision **D-15**:
Leave must publish a `leave.payroll-period` query returning the view it already declares. This is a
*new query over an existing view type* — additive, no schema change, no behaviour change. Under §65
it is nonetheless "Leave modified beyond a published contract" and is not undertaken silently.

**If D-15 is declined**, Payroll's leave inputs degrade to covered days and minutes without paid
treatment, unpaid-leave deduction becomes unimplementable, and that must be marked `NOT VERIFIED`
rather than approximated.

---

## 7. Compensation Integration

Payroll reads `compensation.payroll-period` and `compensation.changed-since` under a grant
permitting `compensation.read`. It never reads a compensation table, never re-resolves a percentage
component, and never introduces a projection (§16).

`CompensationPeriodView` gives, per employment: one block per currency, each carrying recurring
components (`componentCode`, `kind`, `payrollTreatmentCode`, `proratable`, `amount`, `resolvedFrom`,
`effectiveFrom`, `effectiveTo`, `partialPeriod`) and one-time components (`payableOn`), plus
`compensationPlanId`, `planVersion`, `inputsDigest` and `calculationVersion`.

The contract was designed for this consumer and three of its properties carry the design:

- **`payrollTreatmentCode` travels uninterpreted through Compensation and is *interpreted here*.**
  This is the single seam between a generic engine and a country pack: the code maps to an earning
  treatment, and the mapping is tenant or pack configuration, never a constant in Payroll.
- **`proratable` and `partialPeriod` are facts, not formulas.** Compensation states that a component
  may be prorated and that its period does not span the whole payroll period; deciding the
  denominator is Payroll's (§18).
- **`resolvedFrom` publishes the rule behind a resolved percentage.** Payroll persists it into the
  snapshot and does not re-derive it — that is exactly the disagreement-by-a-fil ADR-0062 exists to
  prevent.

`compensation.changed-since` is the reconciliation axis: a system-time query returning recurring and
one-time records recorded after an instant, with a `truncated` flag for paging. **Nothing is
pushed.** This is what makes a retroactive raise entered in April detectable against a March run
that was already calculated.

`compensation.for-employment` is *not* consumed — it is the HR screen's read. Payroll consumes the
period contract, which is the one that publishes no computed total.

---

## 8. Organization Integration

Two reads, both under a grant permitting `organization.legal-entity.read`:

| Need | Query | Why |
| --- | --- | --- |
| The country a payroll scope belongs to | `organization.governing-legal-entity` | ADR-0035: the legal entity carries the country and the currency. This is the country-pack lookup key (§34) |
| Unit ancestry for cost allocation | `organization.describe-unit` | `ancestorUnitIds` is what makes allocation to a parent unit possible without Payroll walking a hierarchy it does not own |

**Cost centre is read from Employment, not Organization.** `AssignmentView.costCenterId` is the
authoritative placement fact and is already effective-dated, so a March run allocates to March's
centre. Organization is asked only for what a centre *is*.

**And that is the gap.** `FinancialCenterView` is returned by exactly one query —
`organization.export-structure`, which returns the entire `OrganizationSnapshot`. Resolving a
cost-centre code for an accounting line would mean exporting the whole organization per run, which
is an unbounded read on a hot path. Decision **D-17** proposes a bounded
`organization.list-centers`. Until then, accounting lines carry the **cost centre identifier only**,
which is sufficient for a reproducible output and is not a fake.

---

## 9. Payroll Domain Boundary

**Payroll owns** payroll groups, payroll periods, payroll runs, payroll input snapshots, payroll
calculation, employee payroll results, earning lines, deduction lines, payroll adjustments, payroll
approval decisions, finalization, reversal, payroll reconciliation state, accounting output lines,
payment instruction lines, and the payslip data contract.

**Payroll does not own** — and holds no table for — person, employment, attendance event, attendance
result, leave request, leave ledger, leave balance, compensation record, compensation plan, country
compliance pack, bank account, bank transfer, general ledger, chart of accounts, accounts payable,
expense claim, benefit, loan, workflow, document, notification.

The one-sentence test applied to every proposed table: *if this row were deleted, would a fact owned
by another module be lost?* If yes, the table is duplication and does not ship.

**The snapshot is the deliberate exception, and it is not duplication.** A snapshot row is not a
copy of Compensation's truth; it is Payroll's record of *what it consumed*, which is a fact only
Payroll can hold. Deleting a compensation row does not make the snapshot wrong — it makes the
snapshot the only remaining explanation of a payslip. That distinction is the whole justification
for §11.

---

## 10. Payroll Scope

A payroll run's population is defined by a **payroll group**: a named, tenant-owned entity carrying
a mandatory legal entity, a pay frequency, and a currency policy.

Population is **resolved by rule at snapshot time, not stored as membership.** A stored membership
list is a fourth copy of the workforce that goes stale the moment somebody transfers. The rule is
data (`evaluateRule`), evaluated against facts Employment publishes: status on the period end date,
employment type code, start and end dates, and the legal entity governing the assignment's unit.

Resolution is therefore: `employment.search` for the legal entity, paginated; then the group's rule
applied to each employment's snapshot; then the surviving set persisted **into the input snapshot**
as the run's population. The population is frozen with the snapshot, so a re-run of the same run
covers the same people even if somebody was hired since.

**Not every tenant has one payroll.** A tenant may have several groups in one legal entity
(monthly staff, weekly labourers), and several legal entities each with their own. Nothing in the
model assumes one, and nothing assumes a cadence.

See decision **D-1** for the alternatives considered.

---

## 11. Payroll Period

A period belongs to exactly one payroll group and carries: tenant, payroll group, period code,
`period_start`, `period_end`, `payment_date`, status, currency policy, `opened_at`/`opened_by`,
`closed_at`/`closed_by`, and the standard audit columns.

Lifecycle — **seven states, each with an invariant, and no state that is not backed by real
functionality** (§57):

| Status | Invariant | Entered by |
| --- | --- | --- |
| `draft` | No run exists | Period created |
| `open` | Runs may be created and calculated | Period opened |
| `calculating` | Exactly one run is executing | Calculation started |
| `calculated` | Every population member has a result or a recorded exception | Calculation completed |
| `approved` | An approval decision by a named human exists | Approval recorded |
| `finalized` | Results immutable; snapshot frozen; outputs reproducible | Finalization |
| `reversed` | A reversal run exists; the original results are intact | Reversal |

**`paid` is not a status.** Nothing in this repository executes a payment (§6, §32), and a status
saying otherwise would be the false statement §57 warns against. Payment progress is represented
only as far as it is real: an `accounting_prepared_at` and a `payment_prepared_at` timestamp on the
run, with **no `posted` and no `executed`** until a Finance module and a payment integration exist.

Illegal transitions are refused by the domain and the permitted set is stated as **data**, following
`EMPLOYMENT_TRANSITIONS` — a machine that can be read in one glance rather than a chain of
conditionals.

### Period overlap (§8)

For the same payroll group, periods must not overlap. Enforced by the database, not by a read:

```sql
exclude using gist (
  tenant_id with =, payroll_group_id with =,
  daterange(period_start, period_end, '[]') with &&
) where (deleted_at is null)
```

`btree_gist` is already installed. Two administrators creating January concurrently both read before
either wrote, so only the constraint can settle it; `23P01` is translated into a named refusal, as
Phase 10 did for `compensation_recurring`. **Proved with two real PostgreSQL connections** (§29).

---

## 12. Pay Frequency

Frequency is configuration on the payroll group: `monthly`, `semi_monthly`, `biweekly`, `weekly`,
`custom`. It determines **how a period's default dates are proposed** and nothing else. It is never
a calculation input, never a proration denominator, and carries no country rule.

`custom` means the dates are supplied and no default is proposed. That is the honest representation
of a tenant whose cadence the system does not model, and it is cheaper than pretending to model
every cadence.

**A frequency does not imply a proration basis.** Whether a biweekly period prorates by 14 calendar
days or 10 working days is §18's question and a jurisdictional one; conflating the two is exactly
the country rule §4 forbids.

---

## 13. Payroll Input Snapshot

**The most important design decision in the phase**, and the one §11, §17, §46, §52 and §53 all
converge on.

At calculation time Payroll captures, per employment, an immutable record of **the facts it actually
consumed** — not a copy of the source domains (§52).

```text
Employment ──► statusOn, dates, assignment (unit, position, costCentre, fte), version
Attendance ──► PayableSnapshotView, verbatim, incl. sequence/frozenAt/digest/version
Leave      ──► LeavePayrollPeriodView, verbatim, incl. digest/version   [pending D-15]
Compensation► CompensationPeriodView, verbatim, incl. plan/version/digest/version
                                  │
                                  ▼
                    payroll_input_snapshot  (one row per run × employment)
                                  │
                                  ▼
                        payroll calculation
```

Structure: one row per `(run, employment)` carrying a `jsonb` payload of the four consumed views, a
per-source digest and version column set, a `snapshot_digest` over the payload, and `captured_at`.
The run carries a `population_digest` over the sorted employment ids.

**Verbatim, not remodelled.** Storing Payroll's *interpretation* of a compensation view would make
the snapshot unable to answer "what did Compensation tell us", which is the question a dispute
actually asks. The interpretation lives in the earning lines, where it is explained.

**What is snapshotted and what is referenced** (decision **D-2**):

| Fact | Snapshotted | Why |
| --- | --- | --- |
| Compensation period view | ✅ verbatim | Mutable at source; the primary determinant of pay |
| Attendance payable snapshot | ✅ verbatim | Already frozen at source, but the freeze can be superseded by a later `sequence` |
| Leave payroll period view | ✅ verbatim | Mutable at source; approved leave can be cancelled after calculation |
| Employment status/dates/assignment | ✅ verbatim | Determines proration and cost allocation |
| Payroll group rule and its version | ✅ | Population must be reproducible |
| Country pack identifier and version | ✅ | Which statutory rules applied (§47) |
| Person name, national id, bank detail | ❌ never held | ADR-0038. A payslip renderer resolves them at render time |
| Organization hierarchy | ❌ referenced by id | Stable enough, and Employment already snapshots the placement |
| Leave ledger, attendance events, compensation history | ❌ never | Duplication of a completed domain (§9) |

**A finalized payroll never re-reads a source.** §53's chain is answerable entirely from
`payroll_run → payroll_input_snapshot → payroll_earning_line / payroll_deduction_line → result`,
with no live query in the path.

---

## 14. Source Versioning

Every source contributes a version *and* a digest to the snapshot, because they answer different
questions: a version says which record, a digest says which content.

| Source | Version recorded | Digest recorded | Availability |
| --- | --- | --- | --- |
| Employment | `EmploymentView.version` | — | ✅ present |
| Attendance | `calculationVersion` + `sequence` | `inputsDigest` | ✅ present |
| Compensation | `calculationVersion` + `planVersion` | `inputsDigest` | ✅ present |
| Leave | `calculationVersion` | `inputsDigest` | ⚠️ **pending D-15** |
| Payroll itself | `calculation_version` (§47) | `rule_set_digest` | proposed |

Employment publishes no digest. A version is sufficient there, because an employment change that
matters to payroll always increments it.

**A finalized payroll must not silently change because a source record was later edited** (§17). It
cannot: the calculation reads the snapshot, not the source. A later edit is *detected* (§15) and
produces a stale marker and an explicit correction, never a mutated figure.

---

## 15. Source Reconciliation

**Pull, bounded, and never dependent on an event** (§12, §47). The event system is post-commit,
in-process, at-most-once, with no outbox — verified in `PostgresUnitOfWork`, not assumed from a
document. Payroll's correctness must survive every event being lost, so the design assumes they are.

Reconciliation re-asks each source for the same period and compares against the snapshot:

| Source | Reconciliation read | Comparison |
| --- | --- | --- |
| Compensation | `compensation.changed-since(recordedAfter, employmentIds)` | Any row returned ⇒ stale. Also compares `inputsDigest` for the period |
| Attendance | `attendance.read-snapshots(period, employmentId?)` | `sequence` or `inputsDigest` differs ⇒ stale |
| Leave | `leave.payroll-period` **[pending D-15]** — fallback `leave.approved-leave-affecting(changedSince)` | Any change ⇒ stale |
| Employment | `employment.read-employment(asOf)` | `version` differs ⇒ stale |

`compensation.changed-since` is the cheap axis — one system-time query for a page of employments,
which is why Compensation built it. Attendance and Leave require a per-period read; both are
bounded by the run's population and are paged.

Reconciliation is a **command that records a result**, not a background job: it writes a
`payroll_reconciliation` row per run naming which employments went stale and why, and moves the run
to `stale`. It never mutates a result (§35) and never touches a finalized run automatically.

**What reconciliation must also detect** (§35): missing compensation, missing attendance snapshot,
missing leave answer, `leaveState: unknown` on an attendance snapshot, blocking attendance
exceptions, employment ended mid-period, duplicate one-time compensation in overlapping periods, and
a currency present in Compensation that the group's policy does not permit. Each is a recorded
exception with a code, not a silent skip.

---

## 16. Earnings

A generic earning line, with **no country-specific category**:

| Column group | Content |
| --- | --- |
| Identity | run, employment, result, line sequence |
| Classification | `earning_source` (`compensation_recurring`, `compensation_one_time`, `attendance_overtime`, `leave_paid`, `payroll_adjustment`), `payroll_treatment_code` (from Compensation, uninterpreted at source), `component_code` |
| Money | `amount_minor`, `currency_code`, `currency_exponent` |
| Explanation | `calculation_reason` (a code), `calculation_detail` (jsonb: basis, quantity, multiplier, denominator, rounding mode) |
| Provenance | `source_reference` (the compensation recurring id, one-time id, or attendance snapshot id), `snapshot_id` |
| Time | `effective_from`, `effective_to`, payroll period |
| Audit | actor and timestamps via `auditForInsert` |

**`calculation_detail` is what makes §53 answerable.** A line that says "127.500 JOD" explains
nothing; a line that says "1500.000 × 17/30 calendar days, half-up" explains itself without the
reader re-running anything.

Categories such as base salary, allowance, bonus and commission are not enum values — they arrive as
`payroll_treatment_code` from a component the tenant defined. **Nothing named "housing", "transport"
or "basic" appears anywhere in Payroll.**

---

## 17. Deductions

Phase 11 is the first place a deduction may exist (§21), and Compensation deliberately left the
ground empty (Phase 10 D-1).

A generic deduction line mirrors the earning line, plus a `deduction_source`:

| Source | Phase 11 status |
| --- | --- |
| `unpaid_leave` | ✅ Implemented generically — from the snapshot's leave and attendance unpaid minutes, at a rate and denominator the group configures |
| `voluntary` | ✅ Implemented — a tenant-defined `payroll_deduction_definition` with a fixed amount or basis-point rate over a stated basis |
| `manual_adjustment` | ✅ Implemented — an explicit adjustment (§26) |
| `statutory` | 🔌 **Extension point only.** Produced by a country pack. No pack exists ⇒ `NOT VERIFIED` |
| `benefit` | 🔌 **Input contract only.** No Benefits domain (§36) ⇒ `NOT VERIFIED` |
| `loan_advance` | 🔌 **Input contract only.** No Loans domain (§37) ⇒ `NOT VERIFIED` |

The three extension points are a **published input contract** — a port shape Payroll would call and
a line shape it would accept — and **no table, no entity, no fake**. Defining the shape is not
implementing the domain; creating a `payroll_loan` table would be.

`payroll_deduction_definition` is a small tenant-owned configuration: code, localized name,
treatment code, calculation basis (fixed amount or basis points over a named basis), rounding mode,
priority, and an optional floor expressed as a net-pay minimum. **Priority and the floor are
generic**; which deductions a jurisdiction protects is a country rule and does not ship (**D-13**).

---

## 18. Proration

**No universal formula, and no default.** Every proration states its basis explicitly and the basis
is configuration on the payroll group.

| Cause | Trigger in the snapshot |
| --- | --- |
| Hire mid-period | `employment.startDate` inside the period |
| Termination mid-period | `employment.endDate` inside the period |
| Compensation change mid-period | `partialPeriod: true` on a component (Compensation states the fact, ADR-0062) |
| Unpaid leave | `unpaidMinutes` on the attendance snapshot; unpaid treatment on the leave view |
| Status change mid-period | `employment.read-history` shows a transition inside the period |

Each proration records, on the line's `calculation_detail`: the **numerator** (payable units), the
**denominator** (period units), the **basis** (`calendar_days`, `working_days`, `scheduled_minutes`),
the **rounding mode**, and the **precedence** when two causes overlap.

Arithmetic is `Money.multipliedBy(numerator, denominator, rounding)` — exact integer arithmetic, no
floating point, rounding stated at the call site because the kernel provides no default.

**Only `proratable: true` components prorate.** Compensation states that flag and Payroll obeys it;
a fixed monthly allowance that a tenant marked non-proratable is paid whole for a partial month, and
deciding otherwise would be Payroll overruling the entitlement.

**Precedence when causes overlap** (hired on the 10th *and* four unpaid days): proration by presence
is applied first, unpaid-leave deduction second against the already-prorated amount — and both are
recorded as separate, individually explained lines rather than one blended figure. A country pack
may later override the denominator; it may not silently change the order.

---

## 19. Gross Pay

```text
gross(currency) = Σ earning lines in that currency
```

**Summed per currency and never across currencies** (§23). A result carrying two currencies carries
two gross figures and no total, exactly as `EmploymentCompensationView.totalsByCurrency` does.

`Money.plus` refuses a mismatched currency at the type level, so "do not sum incompatible
currencies" is enforced by the kernel rather than by a review comment. No floating point appears on
any path: `bigint` in the column, `BigInt` on parse, decimal string on the wire.

Gross is **persisted on the result** rather than recomputed on read, and an invariant test asserts
that the persisted gross equals the sum of the persisted lines. A stored total that can drift from
its lines is a reconciliation bug waiting to be found by an employee.

---

## 20. Net Pay

```text
net(currency) = gross(currency) − Σ deduction lines in that currency
```

**And the engine must not assume this is universally sufficient** (§24). Two extension points are
built in and both are inert in Phase 11:

- A country pack may contribute additional deduction lines *and* additional statutory earning lines
  before net is computed.
- A country pack may declare a **net floor** (a statutory minimum take-home), which the generic
  engine applies by reducing lower-priority deductions in priority order using `Money.allocate` so
  the reduction sums back exactly.

Net may be zero. Net may not be negative: a calculation that would produce a negative net records a
**blocking exception** on the result rather than a negative figure, because a negative payslip is
almost always a data error and paying it silently is worse than refusing.

---

## 21. Currency

| Layer | Rule |
| --- | --- |
| Payroll group currency policy | Names the currencies the group pays in. A group may permit exactly one, which is the common case |
| Compensation currency | Arrives per block on `CompensationPeriodView`. Payroll does not choose it |
| Result | One gross, one net and one line set **per currency**. Nothing is totalled across currencies anywhere in the module |
| Accounting output | Lines carry their own currency. No consolidated total |
| Conversion | **Not implemented. `NOT VERIFIED`** |

**There is no exchange-rate service, table, port or function in this repository.** §25 is explicit
that one must not be invented, and inventing one is also the single most dangerous thing this phase
could do: a wrong rate applied silently to a hundred thousand payslips is unrecoverable in a way a
wrong allowance is not.

So Payroll converts nothing. A compensation block in a currency the group does not permit produces a
recorded **currency conflict exception** (§35) and that employment is not calculated. That is a real
answer; a converted figure would be a fabricated one. See decision **D-5**.

---

## 22. Rounding

| Question | Answer |
| --- | --- |
| Scale | The currency's own exponent, carried on every amount (ADR-0061). Never assumed to be 2 |
| Mode | Stated at every call site. `Money.multipliedBy` has **no default rounding** and the kernel will not compile without one |
| Stage | **Component level.** Each earning and deduction line is rounded to the currency's minor unit as it is produced; gross and net are exact sums of already-rounded lines |
| Why component level | A payslip shows lines and a total. If the total is rounded independently, the lines do not add up to it, and an employee who adds them up is right and the system is wrong |
| Allocation | `Money.allocate` for any split (cost allocation, net-floor reduction), which distributes the remainder exactly so the parts sum to the whole |
| Statutory override | A country pack may declare a different rounding mode for the lines it produces. It may not change the stage |

No floating point anywhere. No hidden rounding: every rounding that occurs is recorded in the line's
`calculation_detail` with the mode that produced it.

---

## 23. Payroll Calculation

A deterministic pipeline, each stage with a named owner:

| # | Stage | Owner | Refuses when |
| --- | --- | --- | --- |
| 1 | Validate period | Payroll domain | Period not `open`; group inactive; period overlaps |
| 2 | Resolve population | Payroll application + `employment.search` | Employment unreachable — the run refuses rather than paying a partial workforce |
| 3 | Snapshot inputs | Payroll application + four source contracts | Any source unreachable; blocking attendance exceptions; `leaveState: unknown` |
| 4 | Validate inputs | Payroll domain | Missing compensation; currency conflict; employment ended before period start |
| 5 | Calculate earnings | Payroll domain (pure) | — |
| 6 | Calculate deductions | Payroll domain (pure) | — |
| 7 | Apply compliance rules | **Country pack port — inert in Phase 11** | Pack declared on the group but unavailable |
| 8 | Calculate gross | Payroll domain (pure) | — |
| 9 | Calculate net | Payroll domain (pure) | Net would be negative |
| 10 | Validate invariants | Payroll domain | Gross ≠ Σ earnings; net ≠ gross − Σ deductions; a line in an unexpected currency |
| 11 | Persist results | Payroll infrastructure | — |

**Stages 5–10 are pure functions of the snapshot.** Given the same snapshot and the same calculation
version they produce the same result, with no clock read, no database read and no source call. That
purity is what makes §53 provable rather than asserted: reproducibility can be tested by replaying a
persisted snapshot and comparing to the persisted result, byte for byte.

### Idempotency (§28)

The calculation key is `(tenant, run, employment, calculation_version)`, enforced by a partial unique
index. A retried calculation for the same key either finds the existing result and returns it or
loses the race and is refused — never inserts a second one. The run itself is keyed
`(tenant, period, run_sequence)` so a retried run creation cannot silently fork the period.

A run in `calculating` is protected by a partial unique index permitting **one non-terminal run per
period**, so two concurrent calculation commands cannot both proceed.

---

## 24. Payroll Run

The run is an auditable execution, not a batch identifier (§30). It carries: payroll period, payroll
group, run sequence, run kind (`regular`, `correction`, `reversal`), status, calculation version,
rule-set digest, population digest, snapshot digest, country pack id and version,
`created_at`/`created_by`, `calculated_at`/`calculated_by`, `approved_at`/`approved_by`,
`finalized_at`/`finalized_by`, `reversal_of_run_id`, `reversed_at`/`reversed_by`,
`stale_detected_at`, counts of results, exceptions and stale employments, and
`accounting_prepared_at` / `payment_prepared_at`.

Run statuses: `draft` → `calculating` → `calculated` → `stale` → `approved` → `finalized` →
`reversed`, with `failed` as a terminal state for a run that could not complete. `stale` is
reachable from `calculated` and from `approved` and is **not** reachable from `finalized` — a
finalized run whose sources moved needs a correction run, not a status change (§56).

---

## 25. Employee Payroll Result

One row per `(run, employment, currency)`, carrying: employment, currency code and exponent, gross,
total deductions, net, line counts, snapshot reference, calculation version, exception count, and
`finalized_at`. Earning and deduction lines are separate tables referencing the result.

**Immutability is enforced, not documented.** After the run is finalized:

- every repository update statement carries `where finalized_at is null`, so a finalized row cannot
  be updated by the ordinary path even by a caller holding every permission;
- and the plan proposes a **`before update or delete` trigger** on the result and line tables raising
  on any attempt to modify a finalized row.

The trigger would be **the first trigger in this repository** — nothing but
`app_protect_table`, `app_current_tenant`, `app_uuid_v7`, `app_memberships_of` and
`app_isolation_diagnostics` exists as server-side code today. That is architecturally significant
under §65 and is raised as part of decision **D-9** rather than introduced quietly. The argument for
it: a `where` clause protects the code path that remembers to write it, while a trigger protects the
table. For finalized payroll — the one dataset in this product where a silent edit is close to
fraud — the table is the right place.

---

## 26. Adjustments

| Kind | When | Effect |
| --- | --- | --- |
| Pre-finalization adjustment | Run is `calculated` or `stale` | An explicit adjustment row producing an earning or deduction line, recalculated into the result. The original lines are regenerated; nothing historical is overwritten because nothing is yet historical |
| Post-finalization correction | Run is `finalized` | A **new correction run** against the same period. The original run and its results are untouched |
| Retroactive adjustment | A prior period's facts changed | A correction line in the *current* period, referencing the prior period and run. The closed period's figures never move |
| Manual adjustment | Any pre-finalization state | An explicit, permissioned, reason-coded line with the actor recorded |
| Reversal | §29 | A reversal run |

**A finalized result is never overwritten** (§32, §56). Every adjustment row carries a reason code
and a written note, both required — the Phase 10 precedent, for the same reason: a figure changed on
somebody's pay without a sentence explaining why is an audit finding.

Retroactive correction in the current period rather than restatement of the closed one is the
deliberate choice. Restating a closed period invalidates an accounting output that may already have
left the system; a current-period correction line is visible on a payslip the employee can question.

---

## 27. Approval

**Payroll records its own decisions and does not consume `ApprovalPort`** — the fourth module to
reach this conclusion (ADR-0045, ADR-0060, Phase 10 §26). The only adapter available is
`AutoApprovingPort`, which approves everything as `system:auto-approval`, and §34 forbids recording
that as a human decision.

- `decided_by` comes from the authenticated context, never from a command.
- `requested_by` is **copied onto the decision row**, which is what makes
  `check (decided_by <> requested_by)` enforceable — a check constraint cannot reach another table.
- `payroll.approve` is a separate permission from `payroll.manage`, and `payroll.finalize` is
  separate from both.
- A wrong decision is corrected by an explicit **reversal decision**; both rows stay in the chain and
  neither counts toward a required approval.
- The chain is published in the same shape Recruitment, Leave and Compensation publish, so Phase 16
  Workflow changes the *source* of a decision without changing this contract.

**No second workflow engine is built** (§34). Approval here is a decision record with an invariant,
not an orchestrator.

---

## 28. Finalization

Finalization is the strong boundary of the module (§33). On finalization, in one transaction:

1. the run's status moves to `finalized` and `finalized_at`/`finalized_by` are stamped;
2. every result and line for the run is stamped `finalized_at`;
3. the input snapshot is marked frozen and becomes non-deletable;
4. accounting output lines and payment instruction lines are generated and persisted;
5. an audit record is written.

After it: **no normal update path exists.** The `where finalized_at is null` predicate and the
proposed trigger (§25) both refuse. The only permitted paths are an explicit reversal, an explicit
correction run, an adjustment run, or a controlled recalculation — all of which preserve the original
(§56).

**Finalization requires `payroll.finalize`, which is a stronger permission than viewing and separate
from approving** (§44). A period cannot be finalized while any employment in its population has an
unresolved blocking exception, and cannot be finalized while the run is `stale`.

---

## 29. Reversal

A reversal creates a **new run** of kind `reversal` referencing the original, whose results carry the
negated lines of the original. The original run, its results, its lines and its snapshot are all
untouched.

Reversal requires `payroll.reverse` and a reason code with a written note. A reversal cannot be
reversed; correcting an incorrect reversal is a new correction run, for the same reason Compensation
refuses to unmake an approval it cannot prove was unconsumed.

**Accounting and payment outputs of a reversed run are not deleted.** They are marked reversed and
the reversal run publishes its own contra lines, because an output that may already have left the
system cannot be retracted by deleting a row here.

---

## 30. Accounting Contract

**There is no Finance module, no ledger, no chart of accounts and no published Finance contract in
this repository.** Verified by inspecting `packages/modules/`, the Prisma schema and
`packages/contracts` (which is `export {};`).

Therefore (§5, §36):

- Payroll **publishes** `payroll.accounting-output` — a bounded, paginated read returning balanced
  debit/credit lines for a finalized run.
- Payroll **persists** those lines in a payroll-owned `payroll_accounting_line` table, so the output
  is reproducible without recomputation and a later Finance module consumes a stable record.
- Payroll **writes into no Finance table**, because there is none, and §36 forbids it even when
  there is one absent an explicit permitting contract.
- **`Accounting Posted` is not a state.** Only `accounting_prepared_at` exists. Marking a payroll
  financially posted because an output row was generated is precisely the false state §57 names.

Each line carries: run, period, legal entity, `direction` (`debit`/`credit`), account reference (an
opaque tenant-configured code — Payroll does not own a chart of accounts), cost centre id, unit id,
amount in minor units with currency and exponent, source line reference, and a journal reference
generated by Payroll for idempotent downstream consumption.

**The lines balance, and an invariant test asserts it**: for each run and currency, Σ debits =
Σ credits. An unbalanced accounting export is worse than none.

Posting itself: **`NOT VERIFIED`.** See decision **D-6**.

---

## 31. Cost Allocation

Allocation reads from the snapshot, so a closed period allocates to the placement in force then:
legal entity (from the governing entity of the assignment's unit), unit, position, cost centre, and
employment.

**Split allocation is supported** rather than assumed away (§37): an allocation is a set of
`(cost centre, basis points)` pairs summing to 10,000, defaulting to a single 100% pair when the
employment has one cost centre. Splitting uses `Money.allocate`, which distributes the remainder
exactly so the parts sum to the whole — a split that loses a fil to rounding produces an unbalanced
journal.

**The allocation source is Employment's `AssignmentView.costCenterId`**, which is authoritative and
effective-dated. Organization is not duplicated. A multi-centre split beyond what Employment
publishes would require a new Employment fact and is therefore **out of scope for Phase 11**: the
generic split machinery ships, and the only input available populates it with one pair.

Resolving a cost centre's *code and name* for a human-readable export is blocked on **D-17**.

---

## 32. Payment Contract

Payroll publishes `payroll.payment-instructions` and persists `payroll_payment_instruction`, one row
per finalized result: run, period, employment, net amount with currency and exponent, payment date,
`payment_method_code` (a tenant-configured code), a Payroll-generated `payment_reference` for
idempotent downstream consumption, and status `prepared`.

**What it does not carry, and cannot**: no account number, no IBAN, no sort code, no card token, no
credential of any kind (§38). There is no bank-account domain in this repository, so there is
nothing to reference; the row carries an optional opaque `payee_account_ref` which is **null in
Phase 11** and which a future payment domain would populate with its own identifier.

**No transfer is executed, no WPS file is produced, no gateway is called, no bank API is
integrated** (§6). `Payment Executed` is not a state. Execution: **`NOT VERIFIED`.** See decision
**D-7**.

---

## 33. Payslip Contract

Payroll owns the **payslip data**: a per-result read assembling the employment reference, period,
run, gross, deductions, net, every earning and deduction line with its `calculation_detail`, the
snapshot reference and the calculation version. It is reproducible from persisted rows alone and
reads no live source.

Payroll does **not** own rendering, storage, delivery or a document identifier. **No `DocumentPort`
exists in this repository** — verified against the kernel. Document rendering and storage are
therefore marked **`NOT VERIFIED`**, and no PDF is faked, no file is stored, no blob column is
created (§39).

**No personal data on the payslip data contract.** Name, national identifier and address are
People's and are resolved by whatever renders the payslip, under its own permissions (ADR-0038).

See decision **D-8**.

---

## 34. Country Compliance Boundary

```text
Payroll Engine  (generic, ships in Phase 11)
        ↓  CountryRulePort
Country Compliance Pack  (Phase 11.1 — packages/country-packs is an empty stub)
        ↓
Statutory calculation  (tax, social security, pension, statutory deductions,
                        statutory allowances, minimum wage, EOS, statutory
                        rounding, filing requirements)
```

The interface, defined in Phase 11 and implemented by nobody:

- **Resolved by** `(countryCode, packVersion)` where the country comes from
  `organization.governing-legal-entity` (ADR-0035) and the version is pinned on the run.
- **Input**: the immutable input snapshot plus the generic earning lines, gross per currency, and
  the employment facts already snapshotted. Nothing else — a pack cannot query the database.
- **Output**: additional earning lines, additional deduction lines, an optional net floor, and an
  optional rounding-mode override for its own lines. Every line carries a `statutory_source_code` so
  a statutory figure is distinguishable from a tenant one on a payslip and in an audit.
- **Pure and deterministic**: same snapshot, same version, same output. This is what lets a
  five-year-old payroll be reproduced under the rules that were in force.

**No pack ships. No rate, threshold, bracket, formula or authority name appears anywhere in Phase
11.** Not Jordanian, Saudi or UAE law; not GOSI, not a tax rate, not a social-security rate, not a
pension rate, not a minimum wage, not an EOS formula. A tenant with no pack gets a payroll with no
statutory lines — which is a correct generic payroll, not a broken one.

Statutory calculation: **`NOT VERIFIED`.** See decision **D-4**.

---

## 35. Government Integration Boundary

**Nothing is implemented**: no Mudad, no Muqeem, no WPS, no GOSI, no tax-authority integration
(§41). No table, no port, no adapter, no file format, no credential.

The accounting output (§30) and payment instruction (§32) contracts are the surfaces a Phase 22
integration would consume, and they were designed to be consumable without changing Payroll. That is
the whole of the relationship in this phase.

All government integrations: **`NOT VERIFIED`.**

---

## 36. Benefits Boundary

**No Benefits domain is implemented and no Benefits table is created** (§42). Payroll defines a
`benefit` deduction source and an input contract shape a future Benefits module would satisfy —
a line with an amount, a currency, a treatment code and a source reference.

Defining the shape is not implementing the domain. Benefits enrolment, plans, claims and eligibility
are Phase 12's and appear nowhere here.

Benefits deductions: **`NOT VERIFIED`.**

---

## 37. Loans / Advances Boundary

**No Loans domain is implemented and no loan entity is created** (§43). Payroll defines a
`loan_advance` deduction source and the input contract shape — instalment amount, currency,
outstanding reference, source reference — and creates nothing that schedules, tracks or amortizes a
loan.

Recording a loan balance in Payroll would make Payroll the owner of a domain it must not own (§9),
and it is exactly the premature-domain failure Phase 10's D-1 avoided by refusing deductions
outright.

Loan deductions: **`NOT VERIFIED`.**

---

## 38. Authorization

Following repository naming conventions (`<module>.<capability>`), with sensitive operations
separated:

| Permission | Grants |
| --- | --- |
| `payroll.read` | Periods, runs, aggregate results |
| `payroll.read-result` | An individual employee's gross, net and lines. **Separate from `payroll.read`** |
| `payroll.manage` | Payroll groups, periods, deduction definitions |
| `payroll.calculate` | Run creation, snapshot, calculation, recalculation |
| `payroll.approve` | Approval decisions and their reversal |
| `payroll.finalize` | Finalization. Stronger than viewing, separate from approving |
| `payroll.reverse` | Reversal runs |
| `payroll.adjust` | Adjustments, and the reason and note behind them |
| `payroll.export` | Bulk export of results |
| `payroll.accounting` | The accounting output |
| `payroll.payment` | The payment instruction output |
| `payroll.read-own` | An employee's own payslip data. Declared and wired to nobody until Phase 18 |

**Reading a payroll is not reading a salary.** `payroll.read` sees that a run covered 1,400 people
and totalled a figure; `payroll.read-result` sees what a named person was paid. Collapsing the two
would make every payroll administrator a reader of every salary, which is the leakage §50 names.

**Reading a figure is not reading the reason behind it** — an adjustment's note sits behind
`payroll.adjust`, following Phase 10.

Every cross-module read runs under a bounded service grant (ADR-0043): running payroll requires no
permission on the employment register, the attendance log, the leave ledger or the compensation
record, and every elevation is logged.

---

## 39. Tenant Isolation

Every Payroll table is tenant-scoped with `tenant_id` first in the primary key and in every index,
and is protected by `call app_protect_table(...)` **in the migration that creates it** (ADR-0030).

RLS is tested as an **unprivileged PostgreSQL role** under the methodology established in Phases
8–10: a role with no `BYPASSRLS`, a real connection, `set_config('app.tenant_id', …)`, and an
assertion that another tenant's rows are invisible to `select`, `update` and `delete` alike.

Tested for every table (§45): payroll groups, periods, runs, input snapshots, results, earning lines,
deduction lines, adjustments, approval decisions, reconciliations, accounting lines, payment
instructions, deduction definitions.

**And the foreign-key caveat is carried forward from Phase 10**: referential checks run as the table
owner with RLS suspended, so a foreign key does not enforce the tenant. Every cross-table reference
in Payroll therefore also carries `tenant_id` and is constrained on the composite, not on the id
alone.

---

## 40. Audit

The existing infrastructure is reused and no second audit system is created (§46): `auditForInsert`
supplies `created_at/by`, `updated_at/by`, `deleted_at/by` and `version`; `Repository.updateRow`
appends `version = version + 1`.

Beyond row audit, these are recorded as **first-class rows** rather than log lines, because each is
a business event somebody may need to defend: period creation, period opening, run creation,
calculation, recalculation, reconciliation, approval, approval reversal, finalization, reversal,
adjustment, export, accounting output generation, payment output generation.

Each records the authenticated actor, the correlation id, the timestamp and a reason code where one
applies. **No monetary amount appears in any log line** (Phase 10 §32, carried forward): a salary in
a log file is a salary outside every permission the module enforces.

---

## 41. Events

The event system remains post-commit, in-process, at-most-once, with no outbox and no durable
subscription. **No payroll correctness depends on an event** (§47) — every source relationship is a
pull, and §59's test proves it by deliberately losing one.

Payroll publishes internal events (`payroll.run-calculated`, `payroll.run-finalized`,
`payroll.run-reversed`) carrying **identifiers and no money** (Phase 10 §32). They may accelerate a
dashboard refresh. Nothing subscribes to them for correctness and no general event bus is created.

---

## 42. API

`/api/v1/payroll/...`, all collections paginated, no persistence model exposed:

```text
GET|POST   /groups                        GET|POST  /periods
POST       /periods/:id/opening           POST      /periods/:id/closure
GET|POST   /runs                          GET       /runs/:id
POST       /runs/:id/calculation          POST      /runs/:id/recalculation
POST       /runs/:id/reconciliation       GET       /runs/:id/reconciliation
POST       /runs/:id/approval             POST      /runs/:id/approval-reversal
POST       /runs/:id/finalization         POST      /runs/:id/reversal
GET        /runs/:id/results              GET       /results/:id
GET        /results/:id/earnings          GET       /results/:id/deductions
GET        /results/:id/payslip           GET       /runs/:id/exceptions
GET|POST   /adjustments                   GET|POST  /deduction-definitions
GET        /runs/:id/accounting-output    GET       /runs/:id/payment-instructions
GET        /runs/:id/snapshot/:employmentId
GET        /dashboard
```

Sensitive endpoints carry their own permission: `/results/*` requires `payroll.read-result`,
`/accounting-output` requires `payroll.accounting`, `/payment-instructions` requires
`payroll.payment`, `/finalization` requires `payroll.finalize`.

**Route ordering is load-bearing** — the literal-segment controllers register before those carrying
`:parameter` segments at the same depth, the Phase 10 lesson.

**Export is separately authorized and bounded**, with a stated maximum page size and no unbounded
result set anywhere.

---

## 43. UI

The Phase 11 Admin Payroll workspace, at `/payroll`: Dashboard, Periods, Runs, Calculation,
Exceptions, Employee Results, Earnings, Deductions, Approvals, Finalization, Adjustments,
Reconciliation, Accounting Output, Payment Output, Payslip Data, Reports.

Following the established pattern: reads against the real contract, fails closed, fully localized in
`en` and `ar` with no hardcoded string, RTL-correct, and **no fabricated number anywhere** — an
unavailable figure is reported as unavailable rather than shown as zero, which is why the dashboard
carries stale-run and exception counts as first-class numbers a human can watch grow.

**Not built** (§49): employee self-service, manager self-service, mobile payroll, bank integration
screens, government integration screens.

Nothing authenticates in this repository (ADR-0032), so the screens fail closed — stated so it is not
mistaken for a defect.

---

## 44. Calculation Strategy

**Application-side arithmetic, set-oriented retrieval and persistence.** Recommended over both
alternatives, and the reasons are stated rather than assumed (§51):

| Strategy | Rejected because |
| --- | --- |
| **In-database** (PL/pgSQL calculation) | A country pack would have to be SQL, versioned in migrations, untestable by the existing test infrastructure, and unable to use `Money`. The repository has **no trigger and no business logic in SQL at all** — this would be a new architectural layer (§65) |
| **Naive application-side** (one query per employee) | N+1 across four source contracts × 100,000 employments. Fails §50 on its face |
| **Set-oriented application-side** ✅ | Source reads are paged and batched (`compensation.payroll-period` already takes an array of employment ids and answers set-based); arithmetic is pure `Money` in TypeScript; persistence is multi-row insert per batch |

What the choice must support, and how:

- **Deterministic and reproducible** — stages 5–10 are pure functions of the snapshot (§23).
- **Concurrency** — protected by database constraints, not by application locks (§45).
- **Auditability** — every line carries its own explanation.
- **Country-rule extension** — a pack is a TypeScript module implementing a pure port, testable with
  the existing infrastructure.
- **Performance** — measured, not asserted (§48).

**The strategy is benchmarked before it is trusted**, and the benchmark is the deciding evidence, as
Phase 10's projection decision was. See decision **D-3**.

### Large-tenant strategy (§14, D-14)

The tenant is never loaded into application memory. A run is processed in **bounded batches of N
employments** (proposed N = 500, tuned by benchmark), each batch being: one paged source read per
contract, one calculation pass, one multi-row snapshot insert, one multi-row result insert, one
multi-row line insert — **in its own transaction**, with the run carrying a resumable cursor.

Consequences, all deliberate: a 100,000-employee run is 200 transactions rather than one, so a
failure at employee 60,000 resumes rather than restarts; peak memory is a function of N and not of
tenant size; and the run is only `calculated` when the cursor reaches the end, so a partial run
cannot be approved.

**Recalculation is scoped to affected employments.** Reconciliation names which went stale, and a
recalculation recomputes those, leaving unaffected results untouched (§50).

---

## 45. Snapshot Strategy

Per §52, the snapshot is minimal and bounded: **four view payloads per employment**, each already
scoped to the period by its own contract. It is not a copy of Attendance, Leave or Compensation.

Estimated size per employment: the compensation view (a handful of components), the attendance view
(~18 scalar fields), the leave view (a few lines), the employment facts (~15 fields). Call it 2–6 KB
of `jsonb` per employment per run. At 100,000 employments × 12 periods that is roughly 2.4–7.2 GB
per year per large tenant — **a real cost, stated here rather than discovered later**, and the reason
snapshot retention is called out as a risk (§53).

**`jsonb` rather than normalized columns**, deliberately: the snapshot's job is to preserve *what a
contract said*, and a contract that gains a field later must not make an old snapshot unreadable or
force a migration of historical payroll. The calculated interpretation is normalized — it lives in
the earning and deduction lines, where it is queried.

Compression: `jsonb` is TOAST-compressed by PostgreSQL automatically at this size. No custom
encoding, no external store.

---

## 46. Reproducibility

The question §53 requires the system to answer — *why did Employee X receive this amount?* — is
answered entirely from persisted rows, with **no live source read in the path**:

```text
payroll_run  (calculation version, rule-set digest, country pack + version)
     ↓
payroll_input_snapshot  (the four source views, verbatim, with digests and versions)
     ↓
payroll_earning_line / payroll_deduction_line  (amount + calculation_detail: basis,
                                                quantity, multiplier, denominator, rounding)
     ↓
payroll_result  (gross, total deductions, net, per currency)
```

**Proved by a replay test, not asserted**: a finalized run's snapshot is re-fed to the pure
calculation stages at the recorded calculation version, and the output is compared to the persisted
result line for line. If a later refactor breaks reproducibility, that test fails.

---

## 47. Calculation Versioning

`CALCULATION_VERSION` is an integer constant in the Payroll domain, persisted on every run and every
result, alongside a `rule_set_digest` over the active deduction definitions and payroll-group
configuration, and the country pack id and version where one applies.

**Historical payroll is never recalculated with today's algorithm without an explicit correction
process** (§54). A recalculation command must state which version it intends; recalculating a run at
a newer version is a *correction run*, is separately permissioned, and preserves the original.

The digest is what catches the subtler case: the code version did not change, but a tenant edited a
deduction definition between the first calculation and the second. Without a digest that difference
is invisible; with one it is a stale marker.

See decision **D-10**.

---

## 48. Performance

Budgets, at the three mandated populations, measured as an **unprivileged PostgreSQL role under
RLS** (§64) with representative compensation, attendance and leave inputs, and reported **per stage**
— never as a single wall-clock number (§64).

| Stage | 500 | 10,000 | 100,000 |
| --- | --- | --- | --- |
| Population resolution | ≤ 150 ms | ≤ 1.5 s | ≤ 15 s |
| Source retrieval (4 contracts, batched) | ≤ 400 ms | ≤ 8 s | ≤ 80 s |
| Snapshot creation and persistence | ≤ 300 ms | ≤ 6 s | ≤ 60 s |
| Calculation (pure, in memory, batched) | ≤ 200 ms | ≤ 4 s | ≤ 40 s |
| Result and line persistence | ≤ 400 ms | ≤ 8 s | ≤ 80 s |
| **Total run** | **≤ 90 s** | **≤ 8 min** | **≤ 45 min** |
| Finalization | ≤ 200 ms | ≤ 2 s | ≤ 20 s |
| Reconciliation (unchanged sources) | ≤ 300 ms | ≤ 4 s | ≤ 40 s |
| Single employee result lookup | ≤ 20 ms | ≤ 20 ms | ≤ 20 ms |
| Payroll-period query (one page) | ≤ 50 ms | ≤ 50 ms | ≤ 50 ms |
| Accounting export (one page) | ≤ 100 ms | ≤ 100 ms | ≤ 100 ms |

Representative volumes at the largest scale: 100,000 employments, 12 periods, ~8 earning lines and
~3 deduction lines per employment per period ⇒ **~9.6M earning lines and ~3.6M deduction lines per
year**, plus 1.2M snapshot rows.

Explicitly avoided and asserted against: N+1 source calls, one query per employee, recalculating
unaffected employees, loading a tenant into memory, and any unbounded result set.

**Reporting discipline, carried forward from Phase 10**: a failing number is reported before it is
fixed. The benchmark is not adjusted to produce a desired result, totals are not rounded down, and a
stage that misses its budget is stated as missed.

---

## 49. Concurrency

Every race is settled by the database, and every one is proved with **two real PostgreSQL
connections** (§29) — the Phase 9/10 methodology, which is the only thing that has ever caught these.

| Race | Protection |
| --- | --- |
| Two overlapping periods for one group | GiST exclusion over `daterange` per `(tenant, group)` (§11) |
| Two runs calculating one period | Partial unique index: one non-terminal run per `(tenant, period)` |
| Two calculations for one employee in one run | Partial unique index on `(tenant, run, employment, currency)` |
| Simultaneous finalization | Optimistic version on the run; the loser is refused, not silently ignored |
| Approval race | Optimistic version plus the self-approval check constraint |
| Reversal race | Unique index: one reversal run per original run |
| Source change during calculation | Snapshot taken inside the batch transaction; reconciliation detects post-hoc change and marks stale (§15) |
| Recalculation after source change | Correction run, never an in-place update |

---

## 50. Security

Carried forward from Phase 10 §32, extended for a module that holds net pay:

- **RLS on every table**, tenant-first schema, unprivileged-role integration tests, no `BYPASSRLS`
  test role.
- **No salary or net pay leaks through another module's view.** Payroll publishes nothing back into
  Employment, Attendance, Leave or Organization.
- **No money in domain events.** Identifiers only.
- **No money in logs.** Not in an error message, not in a debug line, not in an exception.
- **No salary in an unrelated DTO.** Result reads are behind `payroll.read-result`.
- **Adjustment reasons and notes are separately protected**, behind `payroll.adjust`.
- **Export is separately authorized and bounded**, with a stated maximum.
- **No personal data held** — no name, no national identifier, no address, no date of birth
  (ADR-0038).
- **No bank credential of any kind**, ever (§38). The payment instruction carries an opaque
  reference that is null in this phase.
- Accounting and payment outputs are behind their own permissions, because a full payroll accounting
  export is a full salary list by another name.

---

## 51. Testing

**Domain** (§58): period lifecycle; period overlap; illegal transitions; population selection;
snapshot capture and immutability; compensation consumption including a resolved percentage
component; attendance consumption including blocking exceptions and unknown leave state; leave
consumption; earning calculation; deduction calculation; proration by each cause and by each basis;
proration precedence when two causes overlap; gross; net; net floor; negative-net refusal; rounding
at component level; multi-currency separation; currency conflict refusal; adjustments of all four
kinds; approval; self-approval refusal; approval reversal; finalization; finalized immutability;
reversal; stale detection; calculation versioning; replay reproducibility.

**Integration** (real PostgreSQL): Employment, Attendance, Leave, Compensation, Organization —
each through the production adapter under a real bounded service grant. **Finance/accounting: no
contract exists ⇒ `NOT VERIFIED`**, and the accounting output is instead tested for balance and
reproducibility against itself.

**Security**: RLS per table as an unprivileged role; authorization per endpoint; self-approval;
finalized-payroll mutation attempts through every write path; cross-tenant access; sensitive result
access with `payroll.read` but not `payroll.read-result`.

**Concurrency** (two real connections): every row of §49.

**Reliability**: a missed event; a source outage mid-run; a partial source response; a retried
calculation command; a duplicate request; reconciliation after each of the three sources moves.

**Money exactness**: a round trip above 2^53 through the real driver, asserting no precision is lost
— the Phase 10 test, repeated because Payroll is where a lost fil becomes a payslip.

---

## 52. Critical Edge Cases

| Case | Required behaviour |
| --- | --- |
| Employment hired mid-period | Prorated by the group's stated basis, explained on the line |
| Employment ended mid-period | Prorated; one-time compensation payable after the end date is refused, not paid |
| Employment ended before period start | Not in the population; recorded, not silently dropped |
| Employment suspended mid-period | Configuration decides; there is no default, because "suspended is unpaid" is a country and contract question |
| No compensation at all | A recorded exception, never a zero result |
| Compensation in a currency the group does not permit | Currency conflict exception; **not converted** (§21) |
| Attendance snapshot absent | Refusal to calculate that employment; recorded |
| Attendance snapshot with blocking exceptions | Refusal; the numbers are known to be incomplete |
| Attendance snapshot with `leaveState: unknown` | Refusal (ADR-0056): unknown is not none |
| Attendance re-frozen after snapshot (new `sequence`) | Stale, on reconciliation |
| Leave cancelled after calculation | Stale, on reconciliation |
| Retroactive raise entered after finalization | Detected via `changed-since`; corrected in the current period, never by restating the closed one |
| Net would be negative | Blocking exception; no negative payslip |
| Two currencies for one employment | Two results, two gross figures, two net figures, no total |
| One-time compensation payable in two overlapping periods | Duplicate-input exception on reconciliation |
| Calculation retried after a crash mid-batch | Resumes from the cursor; the idempotency key prevents a duplicate result |
| Finalization attempted with unresolved exceptions | Refused |
| Finalization attempted on a stale run | Refused |
| Reversal of a run whose accounting output already left | Contra lines published; the original output not deleted |
| A tenant with no country pack | A correct generic payroll with no statutory lines |
| Period with zero population | A valid, finalizable, empty run — reported as empty, not as a failure |

---

## 53. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Leave publishes no payroll query (D-15)** | **High** — unpaid-leave deduction is unimplementable without it | Raise as a decision. If declined, mark leave-driven deductions `NOT VERIFIED` rather than approximating from day coverage |
| **No approved-overtime contract (D-16)** | **High** — overtime pay is a headline payroll feature | Raise. Do **not** build a second overtime engine (§19). If declined, overtime is `NOT VERIFIED` |
| Snapshot storage growth (§45) | Medium | Sized in the plan; retention policy raised as an open question rather than assumed |
| 100,000-employee run duration | Medium | Batched and resumable; benchmarked before the strategy is trusted; a missed budget is reported |
| Finalized-immutability trigger is the repository's first (D-9) | Medium | Raised explicitly; the `where finalized_at is null` predicate ships regardless, so declining the trigger weakens but does not break the guarantee |
| Accounting output with no consumer | Medium | Persisted and balanced, so it is reproducible when Finance exists. No posted state is claimed |
| Country-pack interface designed with no implementation | Medium | Kept minimal and pure. Phase 11.1 will find gaps; a narrow interface is cheaper to widen than a speculative one is to narrow |
| Cost-centre codes unresolvable (D-17) | Low | Lines carry identifiers, which are sufficient and honest |
| Multi-currency tenants blocked by no conversion | Low–Medium | Correct behaviour; a converted figure would be worse than a refusal |
| Table count is large | Low | Each earns its place under the §9 test. Proposed set is in §55 for approval |

---

## 54. Ambiguities

Stated rather than resolved unilaterally:

1. **Is a suspended employment paid?** Contract and jurisdiction decide. Proposed: group
   configuration, with no default.
2. **Snapshot retention.** Reproducibility argues forever; storage argues otherwise. Proposed:
   retained indefinitely in Phase 11, with a retention policy deferred to a phase that owns data
   lifecycle.
3. **Does a correction run re-snapshot?** Proposed: yes — it is a new calculation against current
   sources, with the original snapshot preserved.
4. **Is `payment_date` per period or per run?** Proposed: per period, overridable per run.
5. **Semi-monthly period generation.** Proposed: dates are supplied; only monthly and weekly cadences
   propose defaults, because a "15th and last day" rule is closer to a country convention than a
   frequency.
6. **Whether a payroll group may span legal entities.** Proposed: no. ADR-0035 puts country and
   currency on the entity, and a group spanning two countries has no single statutory answer.
7. **Which unit's cost centre applies when an employment has none.** Proposed: a recorded exception,
   not a silent fallback to the parent.

---

## 55. Decisions Requiring Approval

### D-1 — Payroll scope model

**Recommend**: a **payroll group** owning `legal_entity_id` (mandatory), `pay_frequency`, and a
currency policy; population resolved by rule at snapshot time and frozen into the snapshot, never
stored as membership.

Rejected: tenant-scoped (assumes one payroll per tenant — false for any group with two entities);
country-scoped (country is a property of the entity, ADR-0035, not an independent axis);
currency-scoped (currency is an outcome, not a population); a fully configurable N-dimensional
combination (unbounded configuration nobody can reason about). The group is the smallest model that
supports monthly staff and weekly labourers in two legal entities without overbuilding.

### D-2 — Input snapshot architecture

**Recommend**: snapshot **verbatim** the four consumed contract views per employment, plus each
source's version and digest, plus the population rule and its version, plus the country pack
identifier and version. Reference — never copy — organization structure, person data, leave ledger,
attendance events and compensation history. See §13's table.

### D-3 — Calculation engine

**Recommend**: **application-side arithmetic with set-oriented retrieval and persistence**, batched
at ~500 employments per transaction with a resumable cursor. In-database calculation is rejected
because a country pack would have to be SQL and because the repository contains no business logic in
SQL at all. **Benchmarked before it is trusted** (§48).

### D-4 — Country compliance interface

**Recommend**: a pure `CountryRulePort` resolved by `(countryCode, packVersion)`, taking the
immutable snapshot plus generic lines and returning additional earning lines, additional deduction
lines, an optional net floor and an optional rounding override, every line carrying a
`statutory_source_code`. **No pack ships in Phase 11.** `packages/country-packs` remains a stub.
Statutory calculation: **`NOT VERIFIED`**.

### D-5 — Currency conversion

**Recommend**: **no conversion in Phase 11.** No exchange-rate service, table, port or function
exists in this repository and §25 forbids inventing one. Results are per currency; a compensation
currency the group does not permit is a recorded exception. Conversion: **`NOT VERIFIED`**. If
multi-currency conversion is required, it needs an authoritative rate owner, which is a separate
architectural decision and not this phase's.

### D-6 — Accounting contract

**There is no Finance module, ledger, chart of accounts or published Finance contract.**
**Recommend**: Payroll publishes and persists balanced debit/credit accounting lines in a
payroll-owned table, exposed as a bounded read, writing into no Finance table. `accounting_prepared`
is a real state; **`accounting_posted` is not created**, because nothing posts. Posting:
**`NOT VERIFIED`**.

### D-7 — Payment contract

**Recommend**: Payroll publishes and persists payment instructions carrying run, employment, net
amount, currency, payment date, method code and a Payroll-generated reference, with an opaque
`payee_account_ref` that is **null in Phase 11**. No account number, no credential, no transfer, no
WPS, no gateway. Execution: **`NOT VERIFIED`**.

### D-8 — Payslip ownership

**Recommend**: Payroll owns the payslip **data** — reproducible from persisted rows with no live
source read. Rendering, storage and delivery belong to a future Document domain. **No `DocumentPort`
exists**; rendering and storage: **`NOT VERIFIED`**. No PDF is faked and no blob is stored.

### D-9 — Finalization and reversal model

**Recommend**: finalization freezes run, results, lines and snapshot in one transaction and
generates the accounting and payment outputs. After it, the only paths are an explicit reversal run,
an explicit correction run, an adjustment run, or a controlled recalculation at a stated version —
all preserving the original.

**Enforcement requires approval on one point**: alongside `where finalized_at is null` on every
update path, the plan proposes a **`before update or delete` trigger** on the result and line tables.
This would be **the first trigger in this repository** and is therefore raised rather than
introduced. Declining it leaves the predicate, which is weaker but not nothing.

### D-10 — Calculation versioning

**Recommend**: an integer `CALCULATION_VERSION` constant persisted on run and result, plus a
`rule_set_digest` over the active deduction definitions and group configuration, plus the country
pack id and version. Recalculating at a newer version is a correction run, separately permissioned,
preserving the original.

### D-11 — Source-change reconciliation

**Recommend**: pull-based, bounded, event-independent. `compensation.changed-since` on the system
axis; `attendance.read-snapshots` compared on `sequence` and digest; Leave compared on digest
(**pending D-15**); Employment compared on `version`. Reconciliation writes a result row naming which
employments went stale and why, and moves the run to `stale`. **It never mutates a result and never
touches a finalized run automatically.**

### D-12 — Approval pattern

**Recommend**: the same pattern as Recruitment (ADR-0045), Leave (ADR-0060) and Compensation — a
named human's decision from the authenticated context, `requested_by` copied onto the decision row,
`check (decided_by <> requested_by)`, separate `payroll.approve` permission, correction by explicit
reversal. **`ApprovalPort` is not consumed** and `system:auto-approval` is never recorded as a human
decision (§34). Phase 16 Workflow later changes the source of a decision without changing the
contract.

### D-13 — Payroll deductions framework

**Recommend**: a generic `payroll_deduction_line` with a `deduction_source` discriminator, and a
tenant-owned `payroll_deduction_definition` carrying code, treatment code, calculation basis (fixed
or basis points over a named basis), rounding mode, priority and an optional net floor. Implemented
generically: unpaid leave, voluntary, manual adjustment. **Input contract only, no table, no
entity**: statutory, benefit, loan/advance — all **`NOT VERIFIED`**.

### D-14 — Large-tenant calculation strategy

**Recommend**: bounded batches of ~500 employments, each a full retrieve-calculate-persist cycle in
its own transaction, with a resumable cursor on the run and a partial run that cannot be approved.
Recalculation scoped to the employments reconciliation named. **The tenant is never loaded into
application memory.** Batch size tuned by benchmark.

### D-15 — Leave publishes no payroll query *(repository gap, §65)*

`LeavePayrollPeriodView` is declared and exported by Leave and **no query handler returns it**.
Leave's only published reads are the two day-coverage queries built for Attendance.

**Recommend**: Leave adds a `leave.payroll-period` query returning the view it already declares —
additive, no schema change, no behaviour change to Leave. Under §65 this is still "Leave modified
beyond a published contract" and is raised for explicit approval. **If declined**, unpaid-leave
deduction and leave encashment are marked **`NOT VERIFIED`**, and Payroll does **not** approximate
them from day coverage.

### D-16 — Attendance publishes no approved-overtime result *(repository gap, §19, §65)*

`PayableSnapshotView` carries `overtimeCandidateMinutes` — **candidate** minutes by design
(ADR-0054). Nothing in Attendance publishes an approved overtime quantity or an overtime approval
decision.

**Recommend**: overtime is paid from `overtimeCandidateMinutes` **only where the payroll group
explicitly configures it as approved-by-policy**, with the line recording that basis; otherwise
overtime is `NOT VERIFIED` pending an Attendance overtime-approval contract. **Payroll does not build
a second overtime engine** (§19) and does not read an attendance table.

### D-17 — Cost centres are readable only via full structure export *(repository gap, §37)*

`FinancialCenterView` is returned only by `organization.export-structure`, which returns the entire
`OrganizationSnapshot`. There is no bounded centre read.

**Recommend**: Organization adds a bounded `organization.list-centers` — additive, no schema change.
**If declined**, accounting lines carry the cost centre **identifier** without a code or name, which
is reproducible and honest, and no full-structure export runs on a payroll path.

### D-18 — Employment publishes no payroll-eligibility fact *(§13)*

`EmploymentView` has no payroll-eligibility flag, and adding one would modify a completed module
(§65).

**Recommend**: eligibility is a **Payroll-owned rule** over facts Employment already publishes —
status on the period end date, employment type code, start and end dates, governing legal entity —
expressed as data via `evaluateRule` and versioned with the payroll group. **Employment is not
modified.**

---

## 56. Definition of Done

Phase 11 is complete when all of the following hold and are demonstrated, not asserted:

**Correctness**

- [ ] A payroll period, run, snapshot, calculation, result, earning lines and deduction lines exist
      and are exercised end to end against real PostgreSQL.
- [ ] Gross equals the sum of persisted earning lines; net equals gross minus persisted deduction
      lines; both asserted per currency by invariant test.
- [ ] No monetary value touches a float, a `number`, or an implicit two-decimal assumption on any
      path; exactness proved above 2^53 through the real driver.
- [ ] Nothing is summed across currencies anywhere in the module.
- [ ] Every proration states its numerator, denominator, basis and rounding mode on the line.
- [ ] A replay of a finalized run's snapshot at its recorded calculation version reproduces the
      persisted result line for line.

**Boundaries**

- [ ] Payroll reads Employment, Attendance, Leave, Compensation and Organization **only** through
      published queries, under bounded service grants; no Payroll SQL names another module's table.
- [ ] No country-specific rule, rate, threshold, bracket, formula or authority name appears anywhere.
- [ ] No Benefits, Loans, Country Pack, Workflow, Document, bank or government integration is
      implemented; each is marked `NOT VERIFIED`.
- [ ] Payroll writes into no Finance table, and no `posted` or `executed` state exists.

**Immutability and audit**

- [ ] A finalized result cannot be modified through any write path, proved by attempting each.
- [ ] Correction, adjustment, reversal and recalculation all preserve the original result.
- [ ] Every business decision — creation, calculation, reconciliation, approval, finalization,
      reversal, adjustment, export — is recorded with its authenticated actor.
- [ ] No monetary amount appears in any log line or domain event.

**The critical cross-module test (§59)** — one suite, on one dispatcher, with the production
adapters:

- [ ] 1. Compensation provides salary. 2. Leave provides approved leave. 3. Attendance provides
      payable facts. 4. Payroll snapshots all three. 5. Payroll calculates. 6. **An event is
      deliberately lost.** 7. One source changes. 8. Reconciliation detects it. 9. The run is marked
      stale. 10. **The previous result is not mutated.** 11. Recalculation creates a new
      authoritative calculation state. 12. Finalization freezes the snapshot and calculation version.

**Security**

- [ ] RLS proved on every Payroll table as an unprivileged PostgreSQL role with no `BYPASSRLS`.
- [ ] `payroll.read` does not grant `payroll.read-result`; finalization requires a stronger
      permission than viewing; export is separately authorized and bounded.
- [ ] No personal data and no bank credential is held anywhere in the module.

**Concurrency** — every row of §49 proved with two real PostgreSQL connections.

**Performance** — every budget in §48 measured as an unprivileged role under RLS at 500, 10,000 and
100,000 employees, reported **per stage**, with any missed budget stated as missed and not rounded
down.

**Engineering**

- [ ] `pnpm verify` passes: standards, architecture, localization, dependencies, format, lint,
      typecheck, test, build.
- [ ] No `any`, no `eslint-disable`, no `TODO`, no `FIXME`; every file within its budget and every
      function within complexity and length limits, with no rule weakened to achieve it.
- [ ] Every user-facing string localized in `en` and `ar`.
- [ ] ADRs recorded for the decisions this phase settles, and the register updated.
- [ ] `docs/verification/phase-11-report.md` records what was measured, what failed before it was
      fixed, and everything marked `NOT VERIFIED`.

---

**Nothing in this plan has been implemented.** No application code, no Prisma model, no migration,
no endpoint and no screen was created or modified in producing it.
