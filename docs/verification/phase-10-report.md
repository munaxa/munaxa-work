# Phase 10 — Compensation Management — Verification Report

**Status** Complete · **Date** 2026-08-10 · **Baseline** Phase 9 at `87e293e` · **Plan**
[`phase-10-plan.md`](phase-10-plan.md)

**Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period.** Phase 10 built the middle sentence and nothing on either
side of it.

---

## 1. What was built

Fourteen tables, one migration, a module of 75 source files plus eight test suites, three ADRs,
an admin screen and a benchmark. Every approved decision D-1…D-9 was implemented as approved; none was
silently redesigned.

| | Decision | As built |
| --- | --- | --- |
| **D-1** | No deductions in Phase 10 | `COMPONENT_KINDS` is `base`, `allowance`, `one_time`. A check constraint refuses anything else. No deduction table, no assignment, no netting, no arithmetic |
| **D-2** | `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint` | On every monetary row. No `numeric`, no `double precision`, and no `number` on any path (ADR-0061) |
| **D-3** | Compensation resolves percentage components | `resolvedPercentageAmount` resolves with `Money.multipliedBy(bp, 10_000n, rounding)`; the view publishes the figure **and** the basis, basis points and rounding mode |
| **D-4** | Overlap refused by a GiST exclusion constraint | `compensation_recurring_overlap` over `daterange(effective_from, effective_to, '[)')` per `(tenant, employment, component)`. Proved with two live connections |
| **D-5** | Both `effective_from` and `recorded_at` recorded | On `compensation_recurring`, `compensation_one_time` and `compensation_adjustment`. As-of queries publish effective time only, as approved |
| **D-6** | Fourteen tables | Exactly fourteen. No table added, none dropped |
| **D-7** | No projection; payroll query set-based | `overlappingPeriod` resolves a page of employments in one statement. Measured — see §5 (ADR-0062) |
| **D-8** | Pay grade related to `position.grade` by optional label | `position_grade_label varchar(64)`, nullable, no foreign key. Organization is unchanged (ADR-0063) |
| **D-9** | Compensation records its own approval decisions | `compensation_approval_decision`, insert-and-read only, `check (decided_by <> requested_by)`, reversal instead of edit. `ApprovalPort` is not consumed |

---

## 2. Quality gates

`pnpm verify` — **PASS**, in full, at the commit this report accompanies.

| Gate | Result |
| --- | --- |
| `check-standards` | no violations |
| `check-architecture` | 95 models checked, no violations |
| `check-localization` | 10 catalogue sets complete |
| `check-dependencies` | 870 source files, no cycles, no unused dependencies, no unreachable files |
| `format:check` | all matched files use Prettier style |
| `lint` | clean across every package |
| `typecheck` | clean across every package |
| `test` | **1,309 passing**, 0 failing, 0 skipped |
| `build` | every package and both apps |

**Compensation's own tests: 122**, plus **3 cross-module tests** in `@work/api`. No test is skipped,
no assertion is commented out, and no `eslint-disable`, `@ts-ignore`, `TODO` or `FIXME` was added
anywhere.

The migration applies cleanly to a real database — it was applied to three (`work`, `work_test`,
`work_perf`) through `prisma migrate deploy`, and the integration suites run against `work_test`.

---

## 3. Tests

### Domain — 33 + 31 (two files)

Money exact on a three-decimal currency and **above 2^53**; a decimal input refused rather than
truncated; an empty amount refused rather than read as zero; all four rounding modes producing
*different* answers on the same input; plan lifecycle and publication immutability; `deduction`
refused as a component kind; percentage requiring a basis and a fixed amount refusing one; circular
basis chains detected; grade ordering and range-currency agreement; a step with two parents and one
with none both refused; most-specific-wins plan resolution and a **refused tie**; closing a period
keeping its amount; half-open boundaries not overlapping; `at(date)` half-open; partial-period
reported as a fact; zero permitted; self-approval refused; a reversed decision counting for neither
side; snapshots serialising `bigint` as an exact string; import counts refused when they exceed what
was submitted.

### Application — 12 + 13 (two files, through the dispatcher)

Assign, read as of today, and amend so the **old period keeps its amount**; a second assignment over
the same period refused; two different components at once permitted; a change before the employment
started and after it ended both refused; a future-dated change stored without affecting today; a
percentage allowance in another currency refused; two currencies kept apart with **two totals, not
one**; a retroactive correction found by *system* time and not found before it was recorded; the
payroll contract set-based, per currency, including an employment with nothing, with no computed
total and a stable digest; self-approval refused for somebody holding both permissions; a named
human decision moving the subject to approved; "no approval required" published with **no fabricated
system step**; three permission separations refused; an adjustment writing its reason and its change
together; an import writing once and reporting the retry as **skipped**; a failed row counted rather
than discarding the batch; history recording an approval that changed no value.

### Integration — real PostgreSQL, 7 + 8 + 11 + 7

**Persistence and constraints (15).** An amount above 2^53 round-tripped **exactly**; a three-decimal
currency exact; overlapping periods refused by the exclusion constraint; a period beginning where
the previous ended permitted; a self-approved decision refused by the check constraint and a
third-party decision accepted; a pay grade with a midpoint outside its range refused; a step with two
parents refused; a duplicate imported row refused by the unique index; the set-based payroll read
returning a page in one statement; a change found by system time and not by effective date; a
one-time item found inside a period; an adjustment's note and both amounts preserved; a civil date
read back as the date stored rather than a shifted instant.

**Isolation (11), as an unprivileged role with no `BYPASSRLS`.** All fourteen tables carry the
policy and **force** it; compensation hidden cross-tenant by identifier and by search; the **as-of
resolution** scoped; the **set-based payroll read** scoped; the reconciliation read scoped; the
overlap constraint scoped so one tenant cannot block another; adjustments and their written reasons
hidden; the configuration tables hidden.

**Concurrency (7), with two live connections.** Exactly one of two simultaneous assignments commits
and the other is refused; two different components both commit; the same import row submitted twice
writes one row; two concurrent decisions produce one first-sequence decision; the losing writer of
an optimistic amendment is refused rather than merged; a future-dated write and a payroll read do
not block each other and the reader sees a consistent snapshot; two one-time items on one date both
commit.

### Cross-module — 3, through the production adapters

Employment and Compensation on **one real dispatcher**, connected by
`CompensationEmploymentDirectory` and `CompensationOrganizationDirectory` — the production classes,
under real bounded service grants. A real employment is created through Employment's own command,
confirmed by Compensation **as at the effective date**, assigned, amended, read back at two dates,
and assembled into the payroll contract. A change dated before the employment started is refused.
And when Employment cannot be asked, **nothing is written**.

---

## 4. Two defects the tests caught, and what they were

Both were real, both were found by a test rather than by reading, and both are recorded here rather
than quietly fixed.

**`version` was written twice on every update.** The row-value maps included `version: state.version`
while `Repository.updateRow` appends its own `version = version + 1`, which PostgreSQL rejects with
*multiple assignments to same column*. Every update in the module would have failed. The
optimistic-concurrency race test found it — the unit tests could not, because they use in-memory
stores, and the persistence tests could not, because they only insert. Fixed by removing `version`
from the values maps: it belongs to `auditForInsert`, which is where the other modules keep it.

**The register index could not serve the register's sort.** `compensation_recurring_register_idx` was
`(tenant_id, effective_from desc, id)` while the query orders by `effective_from desc, id desc`.
PostgreSQL can walk an index backwards only when *every* key reverses, so the planner fell back to
an incremental sort over 2.88 million rows: **624 ms against a 50 ms budget**. Found by the
benchmark, reported before it was fixed, and fixed by making the index `(tenant_id, effective_from
desc, id desc)` — re-measured at **0.7 ms**.

One design rule was also corrected on evidence: the shared code pattern inherited from Leave
required at least two characters, which refused a pay grade named `c`. A one-letter band is the
normal shape in every grade structure anybody has described, so the pattern now permits a single
character — in this module only, with the reason stated where it is defined.

---

## 5. Performance — measured, at the stated scale

Seeded: **100,000 employments, 2,880,000 recurring rows, 500,000 one-time items, 2,880,000 history
rows, 400 components, 200 grades, 600 steps.** Every measurement is the **median of eleven runs**,
executed **as the unprivileged role under row-level security**, inside a transaction with
`app.tenant_id` set — the way a request runs it.

| Read | Budget | Measured | |
| --- | ---: | ---: | --- |
| Current compensation for one employment | 50 ms | **0.9 ms** | ok |
| Compensation as of a past date | 50 ms | **0.8 ms** | ok |
| **Payroll period — 500 employments, set-based** | 500 ms | **60.0 ms** | ok |
| Payroll period — one-time items, same page | 500 ms | **3.6 ms** | ok |
| Component catalogue | 50 ms | **4.7 ms** | ok |
| Adjustment history for one employment | 50 ms | **0.3 ms** | ok |
| Future changes for one employment | 50 ms | **0.3 ms** | ok |
| `changed-since` over a month | 200 ms | **6.1 ms** | ok |
| Register, paged and filtered | 50 ms | **0.7 ms** | ok |
| Compensation history for one employment | 50 ms | **0.6 ms** | ok |

Reproduce with `TEST_DATABASE_URL=… pnpm measure:compensation`.

### D-7 is confirmed by the number

The no-projection decision rested on one measurement: the payroll-period query for a page of 500
employments. It is **60 ms against a 500 ms budget**, at the full stated scale, under RLS — a factor
of eight inside the bound. **No projection was introduced, and none is justified.** Had it missed,
this report would have said so and stopped.

The one-time seed initially produced 100,000 rows rather than 500,000, because it bounded by
employment alone; that was corrected and the figures above are from the corrected dataset. The first
recurring seed also had to be re-run after the index fix, so the numbers are from one consistent
dataset rather than two.

---

## 6. Security and privacy

Compensation is the most sensitive data this product holds, and the controls are structural rather
than advisory.

- **Row-level security on all fourteen tables**, applied by the creating migration, with
  `force row level security` so even a table owner is subject to it. Asserted as an unprivileged
  role holding no `BYPASSRLS`.
- **No monetary amount in a domain event.** Events carry identifiers, dates and a change kind. A
  compensation event carrying a salary would put somebody's pay into a log nobody scoped.
- **No monetary amount in a rejection.** A refusal names the field, the component or the date — the
  bound, never the figure. Rejection detail reaches logs and error trackers.
- **No salary in any other module's published views.** Employment holds none, Attendance holds none
  (ADR-0054), Leave holds none (ADR-0059). This module is the first and only place money exists.
- **Adjustment reasons are separately permissioned.** `compensation.adjust`, not
  `compensation.read`: an adjustment's note is the sentence somebody wrote about *why* a person's
  pay changed. The masking happens in the view mapper, not on the screen.
- **Export is separately permissioned** and bounded.
- **404, not 403**, for another tenant's record. "Forbidden" on a compensation identifier confirms
  that somebody is paid something.
- **No retention rule was invented.** How long compensation history is kept is a customer and
  jurisdiction question this phase does not answer.

---

## 7. Boundaries held

| Claim | How it is enforced, not merely intended |
| --- | --- |
| No payroll calculation | No gross, net, tax, social-security, overtime or arrears field exists in any table, view or function. The contract test asserts the absence |
| No deductions | Not a kind, not a table, not a column. A check constraint refuses the kind |
| No currency conversion | No rate, no table, no function. A percentage across currencies is refused by name; totals are per currency |
| No statutory content | Nothing is seeded. Every threshold is nullable and inert. Eligibility is a `RuleDefinition` evaluated by the kernel engine |
| No end-of-service, no benefits, no loans | Absent entirely. The screen names each absence |
| No Person | No `person_id` column anywhere, and no port method that could return one |
| No Attendance or Leave fact | Neither module is imported, read or referenced. Payroll consumes all three separately |
| No Organization change | `position_grade_label` is a label on *this* module's table. Organization was not modified |
| Layer direction | `check-dependencies` clean: no cycles, `domain ◄ application ◄ infrastructure ◄ api` |

---

## 8. NOT VERIFIED

Stated plainly rather than implied.

- **Payroll — NOT IMPLEMENTED.** Phase 11. The contract is published and **has no consumer**; it is
  asserted by this module's own tests and by nothing downstream.
- **Country compliance packs — NOT VERIFIED.** None exists in this repository. The extension points
  (`statutory_source_code`, `eligibility_rule`, `payroll_treatment_code`, `country_pack_id`,
  legal-entity-scoped assignment) are present and **unexercised by any pack**. No statutory
  golden-case test exists, because no statutory rule ships.
- **Workflow engine — NOT VERIFIED.** Phase 16. Compensation records its own decisions and publishes
  the chain in `ApprovalPort`'s shape so the source can be replaced without redesigning the module.
- **Notification delivery — NOT VERIFIED.** `RecordingNotificationPort` records; it does not deliver.
  No `NotificationPort` is consumed.
- **Document storage — NOT VERIFIED.** No adapter exists anywhere. Nothing here references a
  document.
- **Benefits, Loans — NOT IMPLEMENTED.** Phases 12 and 10.1.
- **Authentication — NOT VERIFIED.** Every business endpoint returns 401 until Platform's adapter is
  supplied (ADR-0032). The admin screen reads against the real contract and fails closed.
- **Employee and manager self-service — NOT IMPLEMENTED.** Phase 18. `compensation.read-own` is
  declared and wired to nobody.
- **Recruitment offer import — NOT WIRED.** `recruitment_offer.proposed_compensation` is opaque JSON
  deferred to this module. The import shape an accepted offer would arrive through exists; wiring
  Recruitment to it would reopen a completed phase and was not done.
- **Scheduled execution — NOT AVAILABLE.** Nothing in this product runs on a timer. This module needs
  none: it has no accrual and no periodic run.

---

## 9. Technical debt carried forward

| | Item | Why it is debt rather than a defect |
| --- | --- | --- |
| **D-1** | **A foreign key does not enforce the tenant.** PostgreSQL runs referential checks as the table owner with RLS suspended, so a compensation row in tenant B referencing an employment in tenant A **is accepted by the database**. The application refuses it — the employment port reads as the current tenant and an employment it cannot see is one it will not price — and the isolation suite asserts both halves rather than claiming the FK refuses it. Carried forward from Phase 9, where it was first found |
| **D-2** | **`row-writer.ts` is a near-copy in five modules.** Hoisting it into `@work/persistence` is a change to a package every phase depends on, and is recorded as debt rather than made inside a business phase |
| **D-3** | **No currency catalogue exists.** The exponent is supplied per record and validated for plausibility, not against a list of real currencies. `JPY` with exponent 3 would be accepted. A `/// @global` currency table is Platform's to own (ADR-0061) |
| **D-4** | **The dashboard's "employments without compensation" is bounded, not exact.** It compares a page of active employments against a page of records. An exact figure needs a full scan of both, which a dashboard is not worth |
| **D-5** | **An outage propagates as a fault, not a refusal.** When Employment cannot be asked, the adapter does not convert that into `employment_not_found` — which would be a false statement — so the caller sees a server error. Nothing is written. A richer "dependency unavailable" failure kind belongs to the pipeline rather than to this module |
| **D-6** | **Plan increase/decrease bounds are stored and inert.** `maximum_increase_basis_points` and `maximum_decrease_basis_points` are persisted and not yet enforced by the amendment path. They are nullable and nothing depends on them; enforcing them is a small, additive change |

---

## 10. Definition of Done

| | Criterion | |
| --- | --- | --- |
| ✅ | Fourteen tables, tenant-scoped, audited, versioned, soft-deleted, RLS by the creating migration | |
| ✅ | Module layout `domain → application → infrastructure → api`, direction lint-clean | |
| ✅ | No `person_id`, no employment status stored, no attendance or leave fact | |
| ✅ | No `double precision` column and no `number` carrying money anywhere | |
| ✅ | No deductions | |
| ✅ | No payroll calculation | |
| ✅ | No country-specific statutory rule, threshold or treatment | |
| ✅ | Money exact — proved above 2^53 and on a three-decimal currency, through a real database | |
| ✅ | Effective dating: current, historical, future, retroactive, gaps, termination closure | |
| ✅ | Retroactive correction works, with both time axes and `changed-since` | |
| ✅ | Overlap refused by a database constraint, proved with two live connections | |
| ✅ | Concurrency proven — seven races, real PostgreSQL | |
| ✅ | Approvals human and auditable; self-approval refused in three layers; reversal, never edit | |
| ✅ | Imports idempotent, bounded, deduplicated, validated by the same domain rules as a manual write | |
| ✅ | Payroll contract published, set-based, per currency, no computed total | |
| ✅ | No projection — and the measurement that decides it, taken and published | |
| ✅ | Security tests pass, as an unprivileged role with no `BYPASSRLS` | |
| ✅ | Performance measured at the stated scale, numbers published whatever they said | |
| ✅ | UI works in English and Arabic, direction switching with language | |
| ✅ | `pnpm verify` passes | |
| ✅ | Real PostgreSQL integration tests pass | |
| ✅ | Documentation updated: module guide, three ADRs, register, phase registry, ownership, release notes | |
| ✅ | This report exists | |

**Phase 11: NOT STARTED.**
