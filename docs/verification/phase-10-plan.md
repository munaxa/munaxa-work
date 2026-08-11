# Phase 10 — Compensation Management — Definition of Ready

**Status** Ready for review · **Date** 2026-08-10 · **Baseline** Phase 9 at `87e293e`

**Employment says somebody is employed. Compensation says what they are entitled to receive.
Payroll says what is actually paid for a period.** Those are three sentences and three modules, and
this plan's first job is to keep them from collapsing into two.

This is a planning checkpoint. No application code, schema or migration is proposed for creation
here — only this document. Everything below is a *proposal* until approved.

---

## 1. Repository Analysis

The repository was inspected rather than assumed. What is actually there:

| Fact | Consequence for Phase 10 |
| --- | --- |
| **81 Prisma models. Not one compensation, salary, pay-grade or pay-element table exists.** | Phase 10 starts from nothing. No existing authoritative structure to duplicate or migrate |
| `Money` exists in the kernel (`money/money.ts`): **integer minor units in `bigint`**, currency exponent supplied never assumed, explicit rounding at every call site, exact `allocate` | The monetary primitive is decided. §20's "do not use floating point" is already the kernel's position |
| **`Money` is used by no module and persisted nowhere.** Phase 10 is the first | The *persistence* convention for money is genuinely open, and is decision **D-2** |
| **No `/// @global` currency table exists.** `legal_entity.currency_code` is `char(3)`, ISO 4217, on the entity rather than the tenant | Currency is a code per record. Nothing publishes a currency's **exponent**, which `Money` requires |
| `Timeline` exists (`effective/effective-dated.ts`): ordered, **overlap-refusing**, `at(instant)`, `scheduledAfter`, and a `change()` that closes rather than rewrites | Effective dating is decided and shared. Compensation must not invent a second one |
| Numeric persistence precedent: `Decimal(5,4)` for FTE, `Decimal(5,2)` for weekly hours, `Decimal(4,1)` for years of experience, `Decimal(9,6)` for coordinates | `numeric` is used for *ratios and measures*. No precedent exists for **money** |
| **`btree_gist` is installed** — created by Phase 9's migration | Exclusion constraints over `daterange` are available now, with **no new extension decision** |
| `app_protect_table(regclass)` applies `enable`/`force row level security` plus `using` and `with check` | Tenant isolation is one call per table (ADR-0030) |
| Employment publishes `read-employment`, `search`, `read-history`, `export-workforce`. `EmploymentSnapshot.statusOn` answers "then", the row answers "now" | Compensation resolves the employment **as at the effective date** |
| `AssignmentView` carries `unitId`, `positionId`, `costCenterId`, `fte` — all effective-dated | Compensation reads organizational placement from **Employment**, not from Organization |
| `PositionView.grade` is an **opaque `varchar(64)` string** Organization already holds | A real collision. Section 9 resolves it |
| Organization publishes `governing-legal-entity` → `LegalEntityView` with `countryCode` and `currencyCode` | The entity currency and the country pack anchor are both reachable, as reads |
| `recruitment_offer.proposed_compensation` is **opaque JSON**, explicitly deferred to Compensation | Phase 6 already reserved this ground. Section 26 addresses the import path |
| Approval precedent: ADR-0045 (Recruitment) and ADR-0060 (Leave) both **decline `ApprovalPort`** and record a named human's decision, with self-approval refused by a check constraint | Section 26 follows it. No third pattern |
| `Money`'s `multipliedBy` requires an explicit `Rounding` — there is no default | A percentage-of-component allowance cannot be resolved without stating who rounds. Decision **D-3** |
| Leave (Phase 9) proved the ledger/projection/digest/reconciliation shape and the GiST overlap constraint under real concurrency | Both patterns are available and tested. Section 19 argues one of them is *not* needed here |

**No compensation-adjacent table exists anywhere.** Attendance produces *candidate minutes* and holds
no money (ADR-0054). Leave holds `paidTreatmentCode` — a code it stores and never interprets — and
no money (ADR-0059/0060). Recruitment holds an opaque JSON proposal. That is the whole of the
product's current relationship with pay, and all three were built to leave this space empty.

---

## 2. Phase 0–9 Compatibility Analysis

| Phase | What Compensation must respect |
| --- | --- |
| **0–1 Foundation** | `Money`, `Timeline`, `DateRange`, the rule engine, `evaluateRule`/`versionInForce`, `runWithServiceGrant`. All reused; none reimplemented |
| **2 Workforce Identity** | The actor on every decision comes from the authenticated context, never from a command |
| **3 Organization** | ADR-0035: the **legal entity** carries the country and the currency, never the tenant. ADR-0036: tenant settings are Organization's. Compensation reads through published queries only |
| **4 People** | ADR-0038: personal data protection. Compensation attaches to Employment and holds **no `personId`** |
| **5 Employment** | ADR-0040: five statuses, no `on_leave`. ADR-0042: reference another module by identifier, read as at a date. ADR-0039: the employment number is Employment's |
| **6 Recruitment** | ADR-0045: approval is a named human's decision. `proposed_compensation` is opaque and deliberately deferred here |
| **7 Onboarding** | ADR-0047: owns no employment fact. ADR-0048: published versions are immutable — the rule Compensation applies to plans and structures |
| **8 Attendance** | ADR-0054: candidate minutes, never money. **Compensation must not compute overtime pay**, and Attendance must not learn what a minute is worth |
| **9 Leave** | ADR-0058: the dependency points one way and the consumer pulls. ADR-0059: authoritative records, derived projection, digest, reconciliation. ADR-0060: nothing statutory ships; approval is recorded, not delegated |

**Nothing in Phases 0–9 blocks this design.** Two things actively enable it: `btree_gist` (Phase 9)
and the fact that every module before this deliberately refused to hold money.

**One conflict exists and it is with the phase specification rather than the repository** — see §46,
decision **D-1**.

---

## 3. Platform Contract Analysis

| Kernel capability | Verified present | Used for |
| --- | --- | --- |
| `Money` — bigint minor units, exponent supplied, explicit rounding, exact `allocate` | ✅ `money/money.ts` | Every monetary value in the module |
| `Timeline<TValue>` — overlap-refusing, `at`, `current`, `scheduledAfter`, `change`, `close` | ✅ `effective/effective-dated.ts` | Effective dating, future changes, retroactive supersession |
| `DateRange` | ✅ `value/date-range.ts` | Period comparisons |
| `evaluateRule` / `versionInForce` — deterministic, total, sandboxed, self-explaining | ✅ `rules/rule-engine.ts` | Component eligibility as **data**, so a country pack needs no code |
| `runWithServiceGrant`, `GrantAwarePermissionChecker` | ✅ ADR-0043 | The two cross-module reads |
| `ApprovalPort` / `AutoApprovingPort` | ✅ present, and **deliberately not consumed** | See §26 |
| `RecordingNotificationPort` | ✅ present — records, does not deliver | Not consumed |
| `serviceBetween` | ✅ `time/service-period.ts` | Step-progression eligibility facts, where a rule reads service |
| Gregorian ⇄ Hijri calendar | ✅ `time/calendar.ts` | Not needed by Compensation. Noted so its absence is deliberate |

**One gap, and it matters.** `Money` requires `Currency { code, exponent }`. **Nothing in this
repository publishes a currency's exponent.** `legal_entity.currency_code` is a bare ISO 4217 code.
A module that assumed two decimal places would be wrong by a factor of ten in Kuwait, Bahrain and
Oman — three of this product's named markets. Decision **D-2**.

---

## 4. Employment Integration

**Compensation attaches to an Employment. Never to a Person.** (AD-001, ADR-0051's reasoning applied
to a fourth module.) There is no `person_id` column anywhere in the proposed schema, and no method
on any port that could return one.

| Compensation asks | Query | Why |
| --- | --- | --- |
| Is this employment real, and what was its status **on the effective date**? | `employment.read-employment` with `asOf` | A raise effective in March is checked against March's status, not today's |
| Where did it sit on that date — unit, position, cost centre, FTE? | The same call: `EmploymentSnapshot.employment.assignment` | Plan resolution and reporting scope |
| Which employments does a bulk operation cover? | `employment.search` | Bounded pages for imports and plan assignment |

Both run under a **bounded service grant** naming exactly `employment.employment.read`. Managing
compensation must not require a permission on the employment register.

**The Phase 8 defect is not repeated.** `employment.read-employment` takes `asOf?: Date`; a civil
date is converted to UTC midnight *in the adapter*, as Leave's does from the start.

**Historical compensation stays attached to the employment it was effective under.** A later
employment change — a transfer, a contract renewal, a status change — supersedes nothing in
Compensation. A **rehire is a new Employment** (ADR-0040), so it gets new compensation records and
the previous employment's history remains exactly as it was. Nothing is re-pointed.

---

## 5. Organization Integration

Compensation **references** organizational structure and **duplicates none of it**.

| Reference | Source | Rule |
| --- | --- | --- |
| Unit, position, cost centre | **Employment's `AssignmentView`**, not Organization | Employment already resolved the placement as at a date; asking Organization separately would be a second answer |
| Legal entity, country, entity currency | `organization.governing-legal-entity` | The country-pack anchor (ADR-0035) and the entity's currency |
| Position **grade** | `PositionView.grade` — see below | The collision, resolved |

**No Compensation table stores a unit name, a position title, a cost-centre code or an entity name.**
Identifiers only.

### 5.1 The `PositionView.grade` collision

Organization already holds `position.grade` as an opaque `varchar(64)`. Phase 10 proposes a
`compensation_pay_grade` table. Two things called "grade" in one product is exactly the ambiguity
this architecture exists to prevent.

**The proposed resolution: they are different things and are named so.**

- `position.grade` is a **job-architecture label** — a band a *position* sits in, authored by whoever
  designs the org structure. Organization owns it and it stays a string.
- `compensation_pay_grade` is a **pay range** — a minimum, a midpoint, a maximum and a currency,
  effective-dated, that a *compensation assignment* references.

They are related in practice and the relationship is **configuration, not a foreign key**: a pay
grade may carry an optional `position_grade_label` that a tenant sets to match Organization's string,
which lets a screen say "positions in band C map to pay grade C" without either module owning the
other's concept. Nothing in Compensation branches on it, and a tenant that uses one and not the
other is unaffected.

Carried to §46 as an item to confirm rather than a decision to make: it is the narrow reading, and
the alternative — a foreign key from a pay grade to a position grade — would make Compensation
unable to price anything Organization has not graded.

---

## 6. Compensation Domain Boundary

**Compensation owns**: compensation plans and their versions; salary structures, pay grades, pay
scales and salary steps; compensation component definitions; component eligibility rules; plan
assignment; recurring compensation assigned to an employment; one-time compensation; compensation
adjustments; compensation history; and the published answer to "what compensation was effective for
this employment on this date".

**Compensation does not own**: Employment, Person, organizational structure, attendance, leave,
payroll, tax, social security, bank payments, payslips, journals, statutory calculations, workflow
routing, notification delivery, document storage, benefits administration, loans.

| Tempting to build here | Where it belongs | Why |
| --- | --- | --- |
| Gross pay for a period | Payroll (11) | Compensation states entitlement; a period's gross depends on attendance, leave and proration Payroll owns |
| Any tax or social-security treatment | Payroll + country packs | §31 |
| End-of-service accrual or gratuity | Payroll/Compliance | §30 |
| Overtime pay | Payroll | Attendance produces candidate minutes (ADR-0054); multiplying them is Payroll's |
| Unpaid-leave deduction | Payroll | Leave publishes authorized absence; deducting for it is period arithmetic |
| Loan repayment schedule | Loans (10.1) | Already scoped to its own phase in `DOMAIN_OWNERSHIP.md` |
| Benefit enrolment, claims, providers | Benefits (12) | §33 |
| A currency conversion | Nowhere in this phase | §20 |

**Compensation defines entitlement. Payroll determines payment.** Every design question in this
document is settled by asking which of those two sentences it belongs to.

---

## 7. Compensation Plan

A **compensation plan** is the configuration an employment is assigned to. It is versioned and
published-immutable, like every definition in this product (ADR-0048).

A published plan version carries:

| Group | Fields |
| --- | --- |
| Identity | `code`, `name` (jsonb, en+ar), `version_number`, `status` (`draft`/`published`/`superseded`) |
| Structure | `salary_structure_id` — **optional**, because §7 forbids a mandatory hierarchy |
| Currency | `default_currency_code` — the currency an assignment takes when it names none |
| Components | Eligibility rows: which component definitions this plan permits, and on what terms |
| Approval | `approval_required`, `approvals_required` (count), `self_approval_permitted` (default false) |
| Change control | `maximum_increase_basis_points`, `maximum_decrease_basis_points` — **both nullable and inert** |
| Country pack | `country_pack_id`, `country_pack_version` — null for a tenant-defined plan |
| Audit | The standard columns |

**Nothing is seeded.** No plan, no structure, no grade, no component. A tenant that has configured
none has none, and the screen says so — the Phase 9 discipline, applied again (§31).

**A plan is not employee-specific** (§25). It is assigned, effective-dated, to a scope; the
assignment is what makes it personal.

---

## 8. Salary Structure

The four levels the specification names, and the rule that keeps them optional:

```text
salary_structure          (optional)
        │
        └── pay_grade     (optional)
                │
                └── pay_scale   (optional)
                        │
                        └── salary_step   (optional)
```

**Every level is optional and none implies another.** A compensation assignment may reference a
step, a scale, a grade, a structure, or **none of them** — carrying a bare amount instead. That is
the difference between a model that fits a 40-person company and one that only fits a ministry.

The five shapes §7 names, and how each is expressed:

| Customer shape | What the assignment references |
| --- | --- |
| Simple salary only | Nothing. `amount_minor` + `currency_code` on the assignment |
| Grades | `pay_grade_id`, amount within the grade's range |
| Grades + scales | `pay_scale_id` (which names its grade) |
| Grades + steps | `salary_step_id` (which names its grade) |
| Custom | A structure with whatever depth the tenant configured |

**A referenced level constrains but does not compute.** Where an assignment names a grade, the
amount is validated against the grade's minimum and maximum *at the effective date* and refused
outside it by name (`amount_outside_grade_range`). The grade never *supplies* the amount silently:
a system that filled in a midpoint would be deciding somebody's salary.

---

## 9. Pay Grade

`compensation_pay_grade`: `code`, `name` (jsonb), `description`, `minimum_minor`, `midpoint_minor`,
`maximum_minor`, `currency_code`, `currency_exponent`, `salary_structure_id?`,
`position_grade_label?` (§5.1), `effective_from`, `effective_to?`, status, audit.

- **Ordered by construction**: `minimum ≤ midpoint ≤ maximum`, as a check constraint. A grade whose
  midpoint is outside its own range is a configuration mistake the database can refuse for free.
- **Effective-dated**, because a grade's range is revised annually and last year's assignment must
  still be explainable against last year's range.
- **No payroll arithmetic.** A grade is reference data. Nothing computes a payment from it.

---

## 10. Pay Scale

`compensation_pay_scale`: `pay_grade_id`, `code`, `name`, `minimum_minor`, `midpoint_minor`,
`maximum_minor`, `currency_code`, `currency_exponent`, `progression_model`, `effective_from`,
`effective_to?`, status, audit.

`progression_model` is a **code**, not an enumeration this product ships — `manual`, `annual`,
`performance` and anything a tenant or a country pack names. Compensation stores it and **never acts
on it**: §10 forbids automatic promotion, and a progression model that moved somebody between steps
by itself would be exactly that.

**Currency is per scale**, not per tenant. A tenant operating two legal entities in two currencies
has two structures, and nothing sums across them (§20).

---

## 11. Salary Step

`compensation_salary_step`: `pay_scale_id` **or** `pay_grade_id` (exactly one, by check constraint),
`step_number`, `code?`, `amount_minor`, `currency_code`, `currency_exponent`, `effective_from`,
`effective_to?`, audit. Unique on `(tenant_id, scale_or_grade, step_number)` where not deleted.

**No automatic progression.** Moving an employment from step 3 to step 4 is an ordinary
effective-dated compensation change, made by a person or by an import, and recorded as one. There is
no tenure rule, no anniversary trigger and no statutory ladder in this module (§10, §31).

**A step supplies an amount; it does not lock one.** An assignment referencing a step takes the
step's amount at the effective date and **stores it on the assignment**. That copy is deliberate and
is the single most important storage decision in this section: when the step's amount is revised next
year, last year's payroll re-run must still produce last year's figure. A join to a mutable
reference table would silently rewrite history.

---

## 12. Compensation Components

`compensation_component` is the configurable definition of *a thing an employment can be entitled
to*. Nothing is seeded.

| Column | Purpose |
| --- | --- |
| `code`, `name` (jsonb en+ar) | The tenant's or a country pack's, never ours |
| `kind` | `base` \| `allowance` \| `one_time` \| *(`deduction` — pending D-1)* |
| `calculation_basis` | `fixed_amount` \| `percentage_of_component` |
| `basis_component_id?` | Which component a percentage is of. Required when the basis is a percentage |
| `percentage_basis_points?` | Integer basis points. **Not a float** |
| `rounding_mode` | `half-up` \| `half-even` \| `down` \| `up` — stated, never defaulted (§20) |
| `recurrence` | `recurring` \| `one_time` |
| `payroll_treatment_code` | A tenant/country-pack code. **Stored, never interpreted** — the discipline `paidTreatmentCode` follows in Leave and `overtimeCandidateMinutes` in Attendance |
| `proratable` | Whether Payroll may prorate it. A *flag Compensation stores*, not arithmetic it performs |
| `eligibility_rule?` | A `RuleDefinition` evaluated by the kernel engine, with its trace kept on refusal |
| `statutory_source_code?` | Null for a tenant-defined component; set by a country pack |
| `status`, `version_number` | Draft / published / superseded |

**`payroll_treatment_code` is the whole tax boundary.** §12 permits storing a
"taxable/subject-to-payroll flag … consumed later by Payroll" and forbids implementing tax. A code
Compensation never reads satisfies the first and cannot violate the second.

**Basic Salary, Housing, Transport, Meal and Phone are examples in the specification and appear
nowhere in this module.** They are components a tenant defines.

---

## 13. Allowances

An allowance is a component of kind `allowance`, and the two calculation bases behave differently:

**Fixed amount.** The assignment carries `amount_minor` and a currency. Nothing is computed.

**Percentage of another component.** The assignment carries no amount; the component carries
`percentage_basis_points` and `basis_component_id`. Resolving it — 40% of a basic salary — is
`Money.multipliedBy(bp, 10000n, rounding)`, exact integer arithmetic with the rounding mode stated on
the component.

**Who resolves it is decision D-3**, and the recommendation is *Compensation does*, published as
both the rule and the resolved amount. The reason is not convenience: "what is this person's housing
allowance" is a question an HR screen must answer, and if Compensation published only a rule then the
screen and Payroll would each resolve it and could differ by a rounding mode. One resolver, one
answer, and Payroll receives both the figure and the rule that produced it so it can show its
working.

**Circularity is refused.** A percentage component whose basis chain returns to itself is refused at
definition time (`component_basis_is_circular`), because a self-referential allowance has no value
and would loop at resolution.

**Compensation implements no tax calculation** (§12). Not one line.

---

## 14. Recurring Compensation

`compensation_recurring` is the authoritative record of what an employment is entitled to receive
repeatedly.

| Column | |
| --- | --- |
| `employment_id`, `component_id` | The subject |
| `compensation_plan_id` | Which plan version governed it — recorded, never re-resolved |
| `pay_grade_id?`, `pay_scale_id?`, `salary_step_id?` | The structural reference, where one was used |
| `amount_minor`, `currency_code`, `currency_exponent` | **Copied at assignment**, never joined from a mutable reference (§11) |
| `percentage_basis_points?`, `basis_component_id?` | For a percentage assignment |
| `effective_from`, `effective_to?` | Business time |
| `recorded_at`, `recorded_by` | **System time** — when we learned it, distinct from when it took effect (§21) |
| `source` | `manual` \| `import` \| `adjustment` \| `plan_assignment` \| `offer` |
| `source_id?`, `reason_code?`, `note?` | Explanation |
| `approval_state`, `approved_at?` | Where the plan requires approval (§26) |
| `supersedes_id?` | The period this one replaced |
| Audit, `version` | The standard columns |

**Value columns are never updated.** A change closes the previous period by writing its
`effective_to` and inserts a new row — `Timeline.change` semantics, exactly what Employment already
does for assignments and contracts. Closing a period records *when it ended*; it does not rewrite
what it was. Nothing else on a historical row is ever written.

**Overlap is refused by the database** — §22.

---

## 15. One-Time Compensation

`compensation_one_time`: `employment_id`, `component_id`, `amount_minor`, `currency_code`,
`currency_exponent`, `payable_on` (civil date), `reason_code`, `note?`, `source`, `source_id?`,
`approval_state`, audit.

Bonuses, commissions and awards. **Compensation records that it is owed and on what date it becomes
payable. Payroll decides which period it falls into and what it grosses to.** A one-time item has no
effective period and therefore no overlap rule — two bonuses on one date is ordinary.

**No expense or reimbursement workflow** (§14). A reimbursement-shaped component may be *defined* by
a tenant, but there is no claim, no receipt, no approval chain of its own and no document. Those
belong to a domain that does not exist yet.

**Idempotency**: unique on `(tenant_id, source, source_id, component_id)` where `source_id` is not
null, so an import retried writes once — the Phase 9 pattern.

---

## 16. Compensation Adjustments

An adjustment is the **reason record beside a change**, not a second way to change something.

```text
current recurring period
        │
        ├── compensation_adjustment   (why, who, when, from → to)
        │
        └── new recurring period effective from D
```

`compensation_adjustment`: `employment_id`, `component_id?`, `adjustment_type` (a code —
`merit`, `promotion`, `correction`, `market`, whatever a tenant names), `previous_amount_minor?`,
`new_amount_minor?`, `currency_code`, `effective_from`, `reason_code` **required**, `note`
**required**, `requested_by`, `recorded_at`, `approval_state`, audit.

Both a reason code and a written note are required, for the reason Leave requires them on a balance
adjustment: it is the movement no rule produced, which makes it the one an auditor reads first.

**An adjustment never mutates a historical row.** It records the intent; the effective-dated
supersession records the effect. Both are written in one transaction.

---

## 17. Effective Dating

The core requirement, and the one every other section leans on.

**Two time axes are recorded on every compensation record:**

| Axis | Column | Answers |
| --- | --- | --- |
| Business time | `effective_from` / `effective_to` | "What was their salary on 2026-03-15?" |
| System time | `recorded_at` | "When did we learn that?" |

Recording both is what makes a **retroactive correction** explainable: a raise effective 1 March,
entered on 20 April, has `effective_from = 2026-03-01` and `recorded_at = 2026-04-20`. Without the
second column, a payroll dispute cannot distinguish a back-dated raise from a raise we always knew
about.

**Precedence, stated deterministically:**

1. Periods for one `(employment, component)` **may not overlap** — enforced by an exclusion
   constraint (§22), not by application code.
2. `at(date)` therefore returns **exactly one or none**. There is no tie to break, by construction.
3. A **future-dated** change is stored immediately and is visible through
   `compensation.future-changes` before it takes effect. It does not affect `at(today)`.
4. A **retroactive** change supersedes: it closes the period it lands in at its own
   `effective_from` and inserts a new one. The superseded row keeps its value and gains an end date.
5. A change effective *before* the earliest existing period is permitted and opens a period before
   it. A gap is permitted — an employment may genuinely have had no assignment of a component for a
   time — and `at(date)` returns nothing for it, which is a real answer rather than a zero.

**`asOf` is required to answer a historical question, and the API makes ignoring it a visible
choice** — the discipline `EmploymentView` established.

---

## 18. Compensation History

**Historical compensation is append-only in every sense that matters.**

- No value column on a superseded row is ever written. Only `effective_to` closes, and `version`
  increments — the same operation Employment performs on an assignment.
- `compensation_change` is an **append-only history table**: `employment_id`, `component_id?`,
  `change_kind` (`assigned`/`amended`/`superseded`/`ended`/`adjusted`/`imported`/`approved`/
  `approval_reversed`), `previous_state` and `new_state` as jsonb snapshots, `effective_from`,
  `recorded_at`, `actor`, `reason_code?`, `source`. Inserted and read; no update, no delete.
- Every adjustment, every approval and every import writes one.

Why a history table rather than reconstruction from the periods: the periods answer "what was the
salary"; the history answers "what happened, who did it and why" — including the events that changed
*nothing* to a value, such as an approval or a reversal. Leave keeps `leave_request_event` for the
same reason (§35.1 of the Phase 9 plan), and Employment keeps a status history.

---

## 19. Compensation Projection — **and the recommendation not to build one**

§18 and §46 both permit documenting why a projection is unnecessary rather than adding one. **This
plan recommends no projection, and here is the reasoning.**

Leave needed one because a balance is a **sum over an unbounded, growing set** — a million ledger
entries — and summing them on every read is a cost that grows for ever. Compensation is not that
shape. "What is this employment's current basic salary" is **one row**, found by an index on
`(tenant_id, employment_id, component_id, effective_from desc)`. The set does not grow with time
spent employed; it grows with the number of *changes*, which is a handful per year.

A projection would therefore add:

- a staleness class of bug that does not currently exist;
- a digest, a stale mark, a reconciliation query and a recalculation command to maintain;
- a second place a salary figure can be found, and therefore a second place it can be wrong.

**The one read that could justify one is the payroll-period query over a whole workforce**, and §28
solves that differently: a **set-based** query resolving the effective row for a page of employments
in one statement (`distinct on (employment_id, component_id) … order by effective_from desc`), rather
than one timeline read per employment. That removes the N+1 without introducing a projection.

**What would overturn this.** Measured evidence: if the payroll-period query for a page of 500
employments exceeds its budget at the volumes in §39, a projection becomes justified. That
measurement is in the Definition of Done, and the decision is recorded here so it is made on numbers
rather than on habit. If a projection is later added it must be **rebuildable, digest-versioned,
stale-detectable, tenant-scoped, bounded and idempotent** (§46) and must never become authoritative.

---

## 20. Currency and Precision

### 20.1 No floating point, anywhere

`Money` is integer minor units in `bigint`. §20's prohibition is already the kernel's position, and
the reason is stated there: binary floating point cannot represent 0.1, so accumulating allowances in
`number` produces payslips that are wrong by fractions.

### 20.2 The persistence question — decision **D-2**

`Money` needs `{ code, exponent }`. The repository publishes codes and **not exponents**. Three
options, and the recommendation:

| | Approach | Assessment |
| --- | --- | --- |
| **A** | `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint`, **on every monetary row** | **Recommended.** Exact, self-describing, and a historical row stays parseable with no lookup. Costs two bytes |
| **B** | `amount numeric(18,4)` | Exact in the database and **lossy at the boundary**: `numeric` arrives in the driver as a *string*, and every read would re-derive minor units. It also invites a `Number()` somewhere, which is the failure mode being avoided |
| **C** | `amount_minor bigint` + a currency table supplying the exponent | Cleanest normalisation and the wrong trade. It makes an old row unreadable without a join, and a currency table is `/// @global` territory that belongs to Platform rather than to Compensation |

**Recommendation: A.** Denormalising the exponent is unusual and is defensible for the same reason
Attendance authors `expectedMinutes` rather than deriving it: a value that must reproduce years later
should not depend on a lookup that can move.

### 20.3 Rounding

Rounding happens in exactly one place: resolving a percentage component (§13), with the mode stated
on the component definition. **There is no other rounding in this module**, no hidden truncation, and
no default mode — `Money.multipliedBy` has no default and that is deliberate.

### 20.4 Multi-currency

- Currency is **per compensation record**, not per tenant and not per employment.
- An employment may hold components in **different currencies** — a local salary and a
  foreign-currency allowance is a real arrangement.
- **No conversion happens in Compensation.** Not a rate, not a table, not a function (§19 of the
  instruction). The payroll contract **groups by currency** and never sums across currencies; a
  consumer asking for a single total gets one figure per currency.
- A **currency change** is an ordinary effective-dated supersession: the old period keeps its
  currency, the new period carries the new one. Nothing is restated.
- A percentage component whose basis is in a different currency is **refused**
  (`percentage_basis_currency_mismatch`), because 40% of an amount in another currency is not a
  quantity this module can produce without converting.

---

## 21. Retroactive Changes

Retroactive changes are ordinary and are handled by §17's supersession rules. What matters is what
Compensation does **not** do:

**It does not compute the financial impact.** A raise from 1,000 to 1,100 effective two months ago
means Payroll owes two months of difference. Calculating that is a payroll question — it depends on
what was actually paid, which periods were closed, and how the jurisdiction treats an arrears
payment. Compensation states the corrected truth and publishes both timestamps so Payroll can find
what changed since it last ran.

**How Payroll finds it**: `compensation.changed-since(recordedAfter, from, to)` — a read, narrow, and
the ADR-0058 shape. Payroll pulls; Compensation does not push, and Payroll's correctness does not
depend on an event having been delivered.

**The specification's worked example** (§21 of the instruction) resolves as: the row recorded as
1,000 keeps its value and gains `effective_to`; a new row carries 1,100 with the same
`effective_from` and a later `recorded_at`; the history table records the correction with its actor
and reason. An as-of query for any date after the effective date returns 1,100. A query asking what
we *believed* before the correction is answerable from `recorded_at`.

---

## 22. Overlap Rules

The business invariant, stated before the constraint:

> **One employment may hold at most one active assignment of the same compensation component at the
> same time.**

Two simultaneous housing allowances is not a arrangement anybody means; it is a data-entry mistake
with no correct answer, and picking one silently would put a figure on a payslip nobody chose.

What is **permitted**:

- Many *different* components at once — that is the normal case.
- The same component again after the previous period closes.
- Any number of one-time items on any date.
- A gap with no assignment at all.

**Enforced by the database**, using the `btree_gist` extension Phase 9 already installed:

```sql
alter table compensation_recurring
  add constraint compensation_recurring_overlap
  exclude using gist (
    tenant_id with =, employment_id with =, component_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  ) where (deleted_at is null);
```

`'[)'` — half-open — so a period ending on the day the next begins does **not** overlap it, which is
exactly how `Timeline.change` closes a period.

**Why a constraint and not an application check**: two administrators assigning the same allowance
concurrently both read, both find nothing, and both write. The read happened before either wrote.
Only the database can settle it, and Phase 9 proved this class of race with two live connections —
the same methodology applies here (§40).

The `23P01` is translated into a business refusal naming the component and the date
(`component_already_assigned`), because a concurrent assignment is an ordinary mistake rather than a
500.

**Source-distinguished overlaps are refused, not permitted.** §22 of the instruction asks whether
overlaps should be allowed for separate sources. They should not: a component assigned once by an
import and once by hand is the same entitlement recorded twice, and paying it twice is the failure
mode. The import path deduplicates on `(source, source_id)` instead (§25).

---

## 23. Employment Lifecycle

Compensation **creates no lifecycle of its own** and invents no `on_leave` state (ADR-0040).

| Employment event | Compensation behaviour |
| --- | --- |
| **New hire** | No compensation exists until assigned. An employment with none is a real state, reported as such, not as zero |
| **Probation** | Nothing special. A plan may make a component's eligibility rule read `onProbation`; the rule is data |
| **Active** | Ordinary |
| **Suspended** | Compensation records are **untouched**. Whether a suspended employee is paid is a payroll and jurisdictional question, and deciding it here would be a statutory rule |
| **Ended** | Open periods are **closed at the termination date**, not deleted. Future-dated changes beyond the termination are **refused by name** (`change_after_employment_end`) and existing ones are closed at the same date, visibly, with a history row |
| **Rehire** | A new Employment (ADR-0040), therefore new compensation. The previous employment's records stay exactly as they were and are never re-pointed |

**Compensation does not read the employment status to decide whether to pay.** It reads it to decide
whether a *change* is permissible, which is a different and much narrower question.

---

## 24. Plan Assignment

`compensation_plan_assignment` binds a published plan version to a scope, effective-dated:

`compensation_plan_id`, `scope` (`tenant` | `legal_entity` | `unit` | `employment`), `scope_id?`,
`effective_from`, `effective_to?`, `reason_code?`, audit.

- **Most-specific-wins**, resolved as at the effective date — the Leave pattern.
- **Ties are refused, not broken**: two plans claiming the same unit on the same date is a
  configuration mistake with no correct answer.
- **The resolved plan version is recorded on the compensation record** and never re-resolved. A plan
  reassigned in June does not change what a March assignment was governed by.
- A `legal_entity` scope is what a country pack resolves from (ADR-0035).
- **Only a published version may be assigned.**

---

## 25. Imports

`compensation_import_batch`: `source` (a code — `legacy`, `csv`, `api`, `bulk_adjustment`),
`source_label?`, `submitted_at`, `submitted_by`, `rows_submitted`, `rows_created`, `rows_skipped`,
`rows_failed`, audit.

- **Tenant-scoped**, validated through the same domain rules as a manual assignment. An import is not
  a back door.
- **Retry-safe and deduplicated**: unique on `(tenant_id, source, source_id)` for the produced rows,
  so a resubmitted file writes once — the pattern Attendance's ingestion and Leave's runs both use.
- **Bounded**: a batch takes a page and reports what it covered. `rows_skipped` is the count that
  demonstrates idempotency rather than merely claiming it.
- **No vendor-specific importer.** A normalized row shape reaches the module; the adapter that
  produces it lives outside, exactly as a device adapter does for Attendance (ADR-0057).
- The **Recruitment offer** is a natural first source: `recruitment_offer.proposed_compensation` is
  opaque JSON deliberately deferred here. Phase 10 publishes the shape an accepted offer would be
  imported through; **wiring Recruitment to it is not in this phase** and would reopen a completed one.

---

## 26. Approval

**Compensation records its own decision and does not consume `ApprovalPort`.**

This is the third module to reach this conclusion and the reasoning has not changed. The only adapter
is `AutoApprovingPort`, which approves everything immediately as `system:auto-approval`. A salary
change is a control over money. ADR-0045 established the precedent for headcount spending; ADR-0060
applied it to paid absence; compensation is the same class, and §27 of the instruction is explicit:
*do not use fake `system:auto-approval` to represent a human compensation decision.*

`compensation_approval_decision`: `subject_kind` (`recurring` | `one_time` | `adjustment`),
`subject_id`, `sequence`, `decision` (`approved` | `rejected`), `decided_by` (from the authenticated
context — a caller cannot supply it), `decided_at`, `comment?`, **`requested_by` copied onto the
row**, `reverses_decision_id?`, audit.

- The copy of `requested_by` is what makes `check (decided_by <> requested_by)` enforceable, since a
  check constraint cannot reach another table — the mechanism Leave proved.
- `compensation.approve` is a **separate permission** from `compensation.manage`.
- **Self-approval is refused by the domain, by the permission separation and by the constraint.**
- Decisions are **inserted and read**. A wrong decision is corrected by a **reversal** — a new row
  naming the one it reverses — never by an edit.
- A plan with `approval_required = false` produces a change that takes effect with **no decision
  row**, and the published chain says "no approval was required" rather than naming a system
  approver.
- `approval_id` is present and null, as Recruitment's, Attendance's and Leave's are.
- The chain is published as `CompensationApprovalChainView`, matching `ApprovalStatus`/`ApprovalStep`
  field for field, so Phase 16 changes the **source** and not the contract.

**Approval reversal after the change took effect** is refused where a payroll period has consumed it
— Compensation cannot know that, so the refusal is expressed as: a reversal is permitted while the
change's `effective_from` is in the future, and beyond that the correction mechanism is a new
effective-dated change rather than an unmaking. Carried as an edge case (§43).

---

## 27. Attendance and Leave Boundary

**No reverse dependency is created.** Compensation does not read Attendance and does not read Leave.

Payroll will consume all three **separately**:

```text
Attendance ──► candidate minutes ──┐
Leave      ──► authorized absence ─┼──► Payroll
Compensation ──► entitlement ──────┘
```

Phase 10 calculates **no** overtime pay, **no** unpaid-leave deduction and **no** absence deduction.
Attendance's `overtimeCandidateMinutes` stays a candidate (ADR-0054) and Leave's `paidTreatmentCode`
stays uninterpreted (ADR-0060). Multiplying either by a rate is Payroll's, and doing it here would
make Compensation depend on two modules it has no reason to know about.

---

## 28. Payroll Contract

The contract Payroll consumes in Phase 11, published now and backed by a **query**, never by table
access.

```ts
interface CompensationPeriodView {
  employmentId: string;
  periodStart: string;              // civil dates
  periodEnd: string;
  /** One block per currency. Nothing is ever summed across currencies. */
  currencies: readonly {
    currencyCode: string;
    currencyExponent: number;
    recurring: readonly {
      componentId: string;
      componentCode: string;
      kind: string;
      payrollTreatmentCode: string;   // uninterpreted
      proratable: boolean;
      amountMinor: string;            // decimal string, exact
      /** Present where the amount was resolved from a percentage. Payroll can show its working. */
      resolvedFrom?: { basisComponentId: string; percentageBasisPoints: number; rounding: string };
      effectiveFrom: string;
      effectiveTo?: string;
      /** True where the period does not span the whole payroll period. Payroll decides proration. */
      partialPeriod: boolean;
    }[];
    oneTime: readonly {
      componentId: string;
      componentCode: string;
      payrollTreatmentCode: string;
      amountMinor: string;
      payableOn: string;
    }[];
  }[];
  planId: string;
  planVersion: number;
  /** Reproducibility: the same inputs give the same digest, and a disputed figure is explainable. */
  inputsDigest: string;
  calculationVersion: number;
}
```

Three rules:

1. **`amountMinor` is a decimal string**, not a `number`. A JSON number would lose precision above
   2^53 and would invite a `Number()` at the far end.
2. **`payrollTreatmentCode` travels uninterpreted.** Compensation stores it and never reads it.
3. **`partialPeriod` states a fact; it does not prorate.** Whether a mid-period change is prorated by
   calendar days, working days or a statutory formula is a payroll and jurisdictional question.

**No Compensation table is exposed as the contract** (§29). The view is assembled by a query handler
from the authoritative rows.

**It is set-based.** `compensation.payroll-period { employmentIds[], periodStart, periodEnd }` takes
a bounded page of employments and resolves them in one statement, because the alternative is one
timeline read per employment — 100,000 round trips per payroll run (§19, §39).

---

## 29. Country Compliance Boundary

**No statutory rule, figure or treatment ships in Phase 10.** Not a minimum wage, not a mandated
housing allowance, not a transport requirement, not a tax treatment, not a social-security rule, not
an end-of-service formula, not a pension calculation.

The extension points, each concrete:

| Point | How a country pack uses it |
| --- | --- |
| `compensation_component.statutory_source_code` | Marks a component as supplied by a pack |
| `compensation_component.eligibility_rule` | A `RuleDefinition`, evaluated by the kernel engine, versioned by `versionInForce` |
| `compensation_component.payroll_treatment_code` | The classification Payroll's country pack interprets |
| `compensation_plan.country_pack_id` / `country_pack_version` | Which pack authored this plan version |
| Plan assignment scoped to `legal_entity` | The pack resolves from the legal entity, never the tenant (ADR-0035) |
| `compensation_pay_grade` ranges | A pack may publish statutory bands as ordinary configuration |

**If a new country requires a change to this module, that is an architecture defect** (00B).

**No statutory golden-case tests exist in Phase 10**, because Phase 10 ships no statutory rule to
test — the position ADR-0060 took for Leave and the completion report will state it rather than
claim the criterion met.

---

## 30. End-of-Service Boundary

**Not implemented, and no part of it is started.** No accrual, no gratuity, no service-band formula,
no final-settlement arithmetic.

What Compensation provides — and it is provided by §17's effective dating rather than by anything
end-of-service-specific — is the **historical salary facts** such a calculation will need: what each
component was worth on any date, in which currency, under which plan. That is `compensation.as-of`
and `compensation.history`, both of which exist for their own reasons.

Duplicating a statutory calculation here would put a jurisdiction's law inside a generic module,
which is the failure 00B exists to prevent.

---

## 31. Benefits Boundary

**No Benefits domain is created.** No enrolment, no provider, no claim, no medical administration, no
eligibility engine.

A benefit that has a *compensation side* — an employer contribution paid as part of remuneration — is
representable as an ordinary component, and that is the whole of it. Compensation records the
monetary fact; the administration of the benefit belongs to Phase 12.

---

## 32. Authorization

Following repository convention (`module.noun.verb`, with `-own` for the self-service variant):

| Permission | Held by |
| --- | --- |
| `compensation.read` | Reads compensation across the tenant. **The most sensitive read in the product** |
| `compensation.read-own` | An employee's own compensation. Phase 18 |
| `compensation.manage` | Assigns and amends recurring compensation, records one-time items |
| `compensation.adjust` | Records an adjustment. Separate, because it is the change no rule produced |
| `compensation.approve` | **Decides.** Never the same permission as managing |
| `compensation.plan.manage` | Drafts plans, structures, grades, scales and steps |
| `compensation.plan.publish` | Freezes them. Separate, because a published plan governs everybody |
| `compensation.component.manage` | Defines components |
| `compensation.import` | Bulk load |
| `compensation.export` | The register. Held by fewer people than read |

Separations that matter, each with a refusal test: managing is not approving (and the domain refuses
self-approval regardless of grants); drafting a plan is not publishing it; importing is not
approving; **reading somebody's assignment is not reading the adjustment reason behind it**.

**No broad People or Organization permission is required to manage compensation.** The two
cross-module reads run under bounded service grants naming exactly `employment.employment.read` and
one Organization read — non-nesting, tenant and actor untouched, every elevation logged (ADR-0043).

---

## 33. Tenant Isolation

Every Compensation entity is tenant-scoped, with row-level security applied by the creating
migration (ADR-0030): `call app_protect_table(...)` with `force row level security`, `using` and
`with check`.

The integration suite connects as a role that **owns nothing and holds no `BYPASSRLS`**, following
Phases 5–9. Assertions required before the phase is done — one per table plus four that are
specifically dangerous:

1. Every Compensation table carries the policy (one assertion over `pg_tables`).
2. Plans, structures, grades, scales, steps, components, assignments, recurring compensation,
   one-time compensation, adjustments, history and imports each hidden cross-tenant, by identifier
   and by search.
3. **The as-of resolution is tenant-scoped.** A leak here puts one tenant's salary on another
   tenant's payroll input, which is the worst disclosure this module can make.
4. **The payroll-period query is tenant-scoped.** It is set-based over a page of employments, and a
   set-based query that lost its tenant clause fails silently rather than loudly.
5. **The overlap constraint is tenant-scoped**, so one tenant's assignment cannot block another's.
6. A compensation record refused for an employment that does not exist (the foreign key) — with the
   Phase 9 finding noted: PostgreSQL suspends RLS for referential checks, so the *application* is
   what refuses a cross-tenant employment reference, and both halves are asserted.

---

## 34. Audit

The existing infrastructure, not a second one. Audit columns on every table
(`created_at/by`, `updated_at/by`, `deleted_at/by`, `version`), written by
`auditForInsert`/`auditForUpdate`; the actor comes from the authenticated context and a caller cannot
supply it.

Beyond the columns, three tables are **append-only by design** and are the audit for the things that
matter: `compensation_change` (every change, with before and after), `compensation_approval_decision`
(every decision and reversal) and `compensation_adjustment` (every manual movement with its actor
and written reason).

Audited: creation, plan assignment, salary change, allowance change, recurring change, one-time
compensation, adjustment, approval, reversal, import, and administrative override.

---

## 35. Events

Internal only. `compensation.assigned`, `compensation.changed`, `compensation.approved`,
`compensation.adjusted` — raised through `transaction.collect(...)` and dispatched post-commit,
in-process, at-most-once.

**No correctness-critical effect depends on one**, and this is the ADR-0058 discipline applied
before the consumer exists: **Payroll must reconcile by asking**, through
`compensation.changed-since`, and not by having been told. If every event were dropped, a payroll run
would still find every change.

**No event carries a monetary amount.** Events fan out to consumers this module does not know and end
up in logs; a compensation event carrying a salary would put somebody's pay into a log nobody scoped
(§41). Identifiers, dates and a change kind — nothing else.

No published event contract, no outbox, no subscription across a module boundary, no general event
bus.

---

## 36. Database / Migration Plan

One migration, `prisma/migrations/<timestamp>_compensation/migration.sql`, creating **thirteen**
tables, each tenant-first, audited, versioned, soft-deleted, and protected by `call
app_protect_table(...)` in the same migration. **No historical migration is edited.** The schema was
inspected: there is no compensation model today and no name collides.

| Table | Notes |
| --- | --- |
| `compensation_plan` | Versioned; unique `(tenant_id, code, version_number)` where not deleted |
| `compensation_plan_assignment` | Scope + scope id; effective-dated; overlap refused per scope |
| `compensation_salary_structure` | Optional root of the hierarchy |
| `compensation_pay_grade` | `check (minimum <= midpoint and midpoint <= maximum)`; effective-dated |
| `compensation_pay_scale` | FK to grade; same ordering check |
| `compensation_salary_step` | Exactly one of scale or grade, by check; unique `(tenant, parent, step_number)` |
| `compensation_component` | Definition; `check` that a percentage basis names a basis component |
| `compensation_plan_component` | Which components a plan version permits, and on what terms |
| `compensation_recurring` | **The authoritative record.** GiST exclusion on `(tenant, employment, component, daterange)`; index `(tenant_id, employment_id, component_id, effective_from desc)` |
| `compensation_one_time` | Unique `(tenant, source, source_id, component_id)` where source_id not null |
| `compensation_adjustment` | Reason record; `reason_code` and `note` both `not null` |
| `compensation_approval_decision` | Insert and read only; carries a copy of `requested_by` so `check (decided_by <> requested_by)` is enforceable |
| `compensation_change` | Append-only history |
| `compensation_import_batch` | Idempotency and reporting for a batch |

*(Thirteen tables plus `compensation_import_batch` is fourteen rows above; the count is confirmed in
§46 as **D-6** rather than assumed.)*

**Every monetary column is `amount_minor bigint` + `currency_code char(3)` + `currency_exponent
smallint`** (pending D-2). **No `double precision` column exists anywhere in this migration.**

`btree_gist` is already installed by Phase 9's migration; the exclusion constraint needs no new
extension.

---

## 37. API

`/api/v1/compensation/...`, every collection paginated, Problem Details on every failure, the 400/422
distinction the other modules use, 404 rather than 403 for another tenant's record.

| Group | Endpoints |
| --- | --- |
| Plans | `GET /plans` · `GET /plans/:id` · `POST /plans` · `POST /plans/:id/publication` · `POST /plans/:id/assignments` |
| Structures | `GET /structures` · `POST /structures` · `GET /grades` · `POST /grades` · `GET /scales` · `POST /scales` · `GET /steps` · `POST /steps` |
| Components | `GET /components` · `POST /components` · `POST /components/:id/publication` |
| Employment compensation | `GET /employments/:employmentId` (current) · `GET /employments/:employmentId/as-of?date=` · `GET /employments/:employmentId/history` · `GET /employments/:employmentId/future` |
| Recurring | `GET /recurring` · `POST /recurring` · `POST /recurring/:id/amendment` · `POST /recurring/:id/end` |
| One-time | `GET /one-time` · `POST /one-time` |
| Adjustments | `GET /adjustments` · `POST /adjustments` |
| Approvals | `GET /:subjectKind/:id/approval-chain` · `POST /:subjectKind/:id/decision` · `POST /:subjectKind/:id/decision-reversal` |
| Payroll | `GET /payroll-period?from=&to=&employmentIds=` — **the Phase 11 contract**, bounded |
| Reconciliation | `GET /changed-since?recordedAfter=&from=&to=` |
| Imports | `POST /imports` · `GET /imports` |
| Export | `GET /export?from=&to=` — bounded, refuses beyond the bound |

Route ordering is load-bearing (Phase 8 proved it, Phase 9 repeated it): literal segments before
parameterised ones, with an API test asserting the resolution rather than trusting declaration order.

**No persistence model is exposed.** Every response is a published view.

---

## 38. UI

`apps/admin`, **read-only**, consistent with every module before it. `@munaxa/ui` only. `?lang=ar`
switches language and direction together.

| Screen | Shows |
| --- | --- |
| Dashboard | Awaiting approval, changes effective this month, future-dated changes, employments with no compensation |
| Plans | Plan versions, their status and their assignments |
| Structures | Structures, grades, scales and steps, with their ranges and effective dates |
| Components | Configured components, their basis, their rounding and their treatment code |
| Employee compensation | Current compensation per employment, by component and currency |
| Recurring | The register, filterable |
| One-time | Bonuses and awards, with their payable dates |
| Adjustments | Every manual change, with actor and written reason |
| History | The change log for one employment — the screen that answers "why is it this number" |
| Future changes | What is scheduled and not yet effective |
| Imports | What each batch covered, wrote, skipped and failed |
| Approvals | The queue, with the chain visible |
| Boundaries | What Compensation does not hold — no payroll, no tax, no benefits, no conversion |

**No Payroll UI. No Employee Self-Service. No Manager Self-Service.** The portals stay shells.

**Salary is masked by permission, not by convention.** A caller holding `compensation.read` but not
`compensation.adjust` sees figures and not adjustment reasons, and the screen renders what the API
returned rather than deciding for itself.

---

## 39. Performance

Representative scale to seed and measure, as Phase 8 and Phase 9 did, **as the unprivileged role
under RLS**:

- 100,000 employments
- 60,000 with compensation, 8 components each, 6 changes each over three years
- ~2,900,000 recurring rows
- ~500,000 one-time items
- ~3,000,000 history rows
- 400 component definitions, 200 grades, 600 steps

| Read | Budget |
| --- | ---: |
| Current compensation for one employment (all components) | 50 ms |
| Compensation **as of** a past date for one employment | 50 ms |
| **Payroll-period query for a page of 500 employments** | 500 ms |
| Component catalogue | 50 ms |
| Adjustment history for one employment | 50 ms |
| Future changes for one employment | 50 ms |
| `changed-since` reconciliation over a month | 200 ms |
| Register, paged and filtered | 50 ms |

**The payroll-period query gets the most attention**, because it is the one another module runs over
the whole workforce and the one §19's "no projection" recommendation rests on. Its budget is
deliberately the loosest and its measurement is the evidence that decides §19.

Avoided by construction: no N+1 (the payroll query is set-based with `distinct on`; a page of
employments resolves in one statement); no unbounded history query (every list paginated, export
refuses beyond its bound); no full-tenant recalculation (there is nothing to recalculate); no scan of
all historical compensation to answer a current question (the index leads with
`(tenant_id, employment_id, component_id, effective_from desc)`).

**The Phase 9 lesson is carried**: the first measurement is reported whatever it says, and a
benchmark whose seed makes a query degenerate is a benchmark to fix rather than a result to quote.

---

## 40. Concurrency

Real PostgreSQL, two live connections, bounded by `statement_timeout` so a contended index produces a
failure rather than a hang.

| Race | Expected |
| --- | --- |
| Two administrators assigning the same component to one employment, overlapping | Exactly one commits; the other gets `component_already_assigned` |
| Two adjustments to one employment at once | Both recorded; the effective-dated supersession is serialized by the exclusion constraint |
| The same import submitted twice concurrently | One batch's rows are written; the other's are skipped by the source uniqueness |
| Two approvers deciding one subject at once | Both decisions recorded in sequence; the second finds the first and does not re-approve |
| A future-dated change written while a payroll-period query reads | The query sees a consistent snapshot; a future period does not affect a past range |
| Optimistic concurrency on an amendment | The losing writer is refused, not merged |

---

## 41. Security and Privacy

**Compensation is the most sensitive data this product holds.** More sensitive than a leave reason,
because it is universally interesting and permanently damaging to disclose.

- **`compensation.read` is a narrow permission**, and no other module's endpoint returns a salary.
  Employment holds none; Attendance holds none (ADR-0054); Leave holds none (ADR-0059). That
  discipline is what makes a single permission sufficient, and it is checked by a test asserting no
  monetary field appears in any other module's published views.
- **No monetary amount appears in a domain event** (§35), or in a log line, or in a rejection's
  `detail` map.
- **Adjustment reasons are separately permissioned** from the figures.
- **The export is bounded and separately permissioned**, because it is the highest-volume disclosure
  the module can make.
- **No retention rule is invented.** Compensation history is retained because payroll disputes and
  statutory record-keeping require it; how long is a customer and jurisdiction question, and this
  phase does not answer it.

---

## 42. Testing

**Domain** — plan versioning and publication immutability; grade ordering; scale and step
resolution; optional hierarchy at every level; component definition including the circular-basis
refusal; percentage resolution with each rounding mode; effective dating (`at`, `scheduledAfter`,
`change`, `close`); future-dated change; retroactive supersession; gap; history reconstruction;
adjustment requiring reason and note; overlap refusal; multi-currency; **decimal precision, including
a three-decimal currency and an amount above 2^53**.

**Integration (real PostgreSQL)** — the exclusion constraint; the source uniqueness; the
self-approval check constraint; foreign keys to Employment; RLS on every table; the as-of resolution;
the set-based payroll-period query; the append-only guarantees.

**Cross-module** — Employment resolved as at the effective date through the real adapter;
Organization's governing legal entity; the payroll contract assembled end to end and asserted to
contain no interpreted treatment code and no cross-currency sum.

**Reliability** — duplicate assignment; concurrent assignment; concurrent adjustment; import retry;
a missed downstream event proving `changed-since` still finds the change; as-of reconstruction after
a retroactive correction.

**Security** — RLS as an unprivileged role; every permission separation with a refusal test;
cross-tenant access; **an assertion that no other module's published view exposes a monetary field**;
self-approval refused in all three layers.

**Performance** — the eight reads in §39 at the stated scale, as the unprivileged role, with the
numbers published whatever they say.

**No country-specific statutory tests**, because no country pack is part of this phase (§29).

---

## 43. Critical Edge Cases

Each must be covered explicitly:

Future salary increase (stored, visible, not yet effective). Retroactive salary correction (both
timestamps, superseded row intact). Salary reduction (permitted; a plan's decrease bound refuses
beyond it where configured). Termination with a future-dated change pending (the change is closed at
the termination date, visibly). Rehire (new Employment, new records, old history untouched).
Overlapping components (permitted — different components). Overlapping effective dates for one
component (refused by the database). One-time bonus (no period, no overlap rule). Recurring allowance
(ordinary). Allowance as a percentage of basic (resolved with the stated rounding, both rule and
figure published). Zero-value component (permitted and meaningful — an entitlement recorded at zero
is different from no entitlement, and `at(date)` returning nothing is different again). Currency
difference between an allowance and its percentage basis (refused). Decimal precision on a
three-decimal currency. Concurrent compensation changes (exactly one commits). Duplicate import
(second writes nothing, reports `rowsSkipped`). A compensation change entered after a payroll period
closed (permitted; Compensation states the truth and `changed-since` is how Payroll finds it).
Historical as-of query. Future as-of query. Missing compensation (a real answer, not zero). Inactive
plan (assignment refused). Expired component (assignment refused; existing periods untouched).
Approval reversal (permitted while the change is future-dated; refused afterwards, with a new
effective-dated change as the remedy).

---

## 44. Risks

| | Risk | Mitigation |
| --- | --- | --- |
| **R-1** | **A salary is silently wrong** — the worst failure this module has, because unlike a leave balance nobody can recompute it from evidence | Append-only history; value columns never updated; both time axes recorded; the exclusion constraint making two answers impossible |
| **R-2** | **Money loses precision** at a boundary — a `Number()`, a `numeric` round-trip, a JSON number | `bigint` minor units end to end; decimal **strings** on the wire; a test with an amount above 2^53 and a three-decimal currency |
| **R-3** | **The payroll contract becomes payroll** — proration, tax, a "convenience" gross | The contract publishes facts and flags (`proratable`, `partialPeriod`) and no computed total; the treatment code travels uninterpreted |
| **R-4** | **A percentage allowance is resolved twice, differently** — once by a screen, once by Payroll | One resolver (D-3), with the rule published alongside the figure so the working is checkable |
| **R-5** | **Country logic creeps in through a "sensible default"** — a minimum wage, a mandated allowance | Nothing seeded; every threshold nullable and inert; eligibility as `RuleDefinition` data |
| **R-6** | **Salary leaks through an unrelated endpoint** | No other module holds money; a test asserts it stays that way |
| **R-7** | Thirteen tables and a four-level optional hierarchy is a large phase; file budgets and complexity limits bite late | Aggregate boundaries fixed in this plan rather than discovered during implementation — the Phase 8 lesson |
| **R-8** | The `grade` collision with Organization confuses a customer or a developer | §5.1 names them differently and relates them by optional label rather than by foreign key |

---

## 45. Ambiguities

Recorded rather than guessed. None blocks the plan; each has a stated default.

1. **Whether a compensation change may be entered for a date before the employment started.**
   *Default: refused* (`change_before_employment_start`). A salary effective before somebody was
   employed is a data-entry mistake in every case anybody has described.
2. **Whether a plan's increase/decrease bounds are enforced or advisory.** *Default: enforced when
   set, inert when null* — the Phase 9 discipline for every threshold.
3. **Whether a zero-amount recurring assignment is permitted.** *Default: permitted.* "Entitled to
   this component, currently at zero" and "not entitled to it" are different facts, and only the
   first is expressible any other way.
4. **Whether one-time compensation requires approval.** *Default: governed by the plan*, the same
   flag that governs a recurring change. A tenant that wants bonuses approved and raises not can
   express it with two plans.
5. **Whether `compensation_change` stores full jsonb snapshots or column deltas.** *Default: full
   snapshots.* A delta needs the schema it was written against to be interpretable years later.
6. **Whether the payroll contract should include employments with no compensation.** *Default: yes,
   with empty blocks.* A silently shorter list makes Payroll guess whether somebody was omitted or
   has nothing.
7. **Whether a step change is an adjustment or an ordinary amendment.** *Default: an amendment, with
   an adjustment row where a reason is recorded.* The two are not alternatives; the adjustment is the
   reason beside the change (§16).

---

## 46. Decisions Requiring Approval

| | Decision | Recommendation |
| --- | --- | --- |
| **D-1** | **Deduction definitions: in scope or not?** The phase *specification* (`11_PHASE_10_COMPENSATION.md`) lists `DeductionDefinition` as an aggregate root and names union fees, insurance contributions, voluntary savings and charitable donations, while assigning *statutory* deductions to Payroll. The instruction for this checkpoint (§5) lists "Deductions" under Payroll without that qualification. **These conflict.** | **Recommend deferring deductions entirely from Phase 10**, and saying so rather than splitting the difference. Two reasons: loan recovery — the specification's first example — is already scoped to **Phase 10.1 Loans & Advances** in `DOMAIN_OWNERSHIP.md`, and building a competing recovery concept here would create the second owner this architecture forbids; and a voluntary deduction is only meaningful against a *net* figure Compensation does not compute. If instead deductions are wanted here, the narrow version is **non-statutory recurring deduction definitions and assignments only** — same table shape as a recurring allowance with `kind = 'deduction'`, no arithmetic, no netting, no statutory codes — and I will implement exactly that and nothing more |
| **D-2** | **Monetary persistence.** `amount_minor bigint` + `currency_code char(3)` + **`currency_exponent smallint` on every monetary row**, because nothing in the repository publishes a currency's exponent and `Money` requires it | **Approve A** (§20.2). The alternative that normalises the exponent into a currency table makes a historical row unreadable without a join, and a currency table is Platform's to own rather than Compensation's |
| **D-3** | **Who resolves a percentage-of-component allowance.** Compensation resolves it and publishes **both** the resolved amount and the rule that produced it; or Compensation publishes only the rule and Payroll resolves | **Approve: Compensation resolves.** An HR screen must be able to answer "what is their housing allowance", and two resolvers with two rounding modes is exactly the class of disagreement that ends up on a payslip |
| **D-4** | **The overlap invariant**: at most one active assignment per `(employment, component)`, enforced by a GiST exclusion constraint over `daterange(effective_from, effective_to, '[)')`. Overlaps are **not** permitted for different sources | **Approve.** `btree_gist` is already installed by Phase 9, so this costs no new extension. Permitting source-distinguished overlaps would mean paying the same entitlement twice |
| **D-5** | **Bitemporality.** Record both `effective_from` (business time) and `recorded_at` (system time) on every compensation record, but publish only **effective-time** as-of queries in Phase 10, with system time available on the history read and on `changed-since` | **Approve as stated.** Recording both costs a column and makes a retroactive correction explainable; publishing a full as-of-knowledge query is a Payroll-audit requirement nobody has yet stated, and building it speculatively is the wrong order |
| **D-6** | **Thirteen tables** (fourteen counting the import batch). Confirm the aggregate set before implementation rather than during it | Confirm §36's list, or name what to drop |
| **D-7** | **No compensation projection.** §19 argues one is unnecessary and would add a staleness bug class for a read that is already one indexed row; the payroll-period query is solved set-based instead | **Approve, with the measurement in the Definition of Done as the thing that could overturn it.** If the payroll-period query misses its budget at the §39 scale, a projection becomes justified and I will report the number rather than quietly adding one |
| **D-8** | **The `grade` collision.** `position.grade` (Organization, an opaque job-architecture label) and `compensation_pay_grade` (a pay range) are different things, related by an **optional label on the pay grade** rather than by a foreign key | **Approve** (§5.1). A foreign key would make Compensation unable to price anything Organization has not graded |
| **D-9** | **Compensation records its own approval decisions and does not consume `ApprovalPort`**, publishing the chain in `ApprovalPort`'s shape — the third module to reach this conclusion | **Approve the repository's precedent** (ADR-0045, ADR-0060). §27 of the instruction already forbids `system:auto-approval` for a compensation decision; this is that instruction expressed in the architecture |

---

## 47. Definition of Done

Phase 10 is complete when all of the following hold. **Anything unmet is reported as unmet.**

**Architecture**
- [ ] Thirteen (or the approved number of) tables, tenant-first, audited, versioned, soft-deleted, RLS applied by the creating migration
- [ ] Module layout `domain → application → infrastructure → api`, direction lint-clean
- [ ] No `person_id`, no employment status stored, no attendance or leave fact anywhere in Compensation
- [ ] **No `double precision` column and no `number` carrying money anywhere in the module**
- [ ] No country-specific rule, threshold, allowance or tax treatment shipped
- [ ] No Organization or Employment table read directly; both reached through published queries under bounded service grants

**Behaviour**
- [ ] Every level of the salary hierarchy optional; all five customer shapes in §8 expressible
- [ ] Effective dating: `at`, future-dated, retroactive supersession, gaps — with value columns never updated
- [ ] Overlap refused by a database constraint, proved with **two live connections**
- [ ] Percentage components resolved exactly, with the rounding mode stated and the rule published
- [ ] Multi-currency held without conversion; nothing summed across currencies
- [ ] Approval recorded by a named human; self-approval refused by domain, permission and constraint; reversal the only correction
- [ ] Imports idempotent, bounded, deduplicated, and validated through the same domain rules as a manual write
- [ ] The payroll contract assembled from a **set-based** query and containing no computed total, no interpreted treatment code and no cross-currency sum

**Quality gates** — all `PASS`
- [ ] `check-standards`, `check-architecture`, `check-localization`, `check-dependencies`
- [ ] `format:check`, `lint`, `typecheck`, `test`, `build` (`pnpm verify`)
- [ ] Migration applies cleanly to a real database; integration suites run against it

**Evidence**
- [ ] Tenant isolation proved as an unprivileged role with no `BYPASSRLS`, including the as-of and payroll-period cases
- [ ] Every permission separation covered by a refusal test
- [ ] A test asserting **no other module's published view exposes a monetary field**
- [ ] Every edge case in §43 covered
- [ ] Performance measured at the §39 scale, as the unprivileged role, **with the numbers published whatever they say** — and §19's no-projection decision either confirmed or overturned by them
