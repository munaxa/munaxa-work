# Compensation Management

**Employment says somebody is employed. Compensation says what they are entitled to receive. Payroll
says what is actually paid for a period.** Those are three sentences and three modules, and this
module's first job is to keep them from collapsing into two.

Phase 10. Fourteen tables. Package `@work/compensation`.

---

## What it owns

Compensation plans and their versions; salary structures, pay grades, pay scales and salary steps;
compensation component definitions; component eligibility rules; plan assignment; recurring
compensation assigned to an employment; one-time compensation; compensation adjustments;
compensation history; and the published answer to *what compensation was effective for this
employment on this date*.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| Gross, net, tax, social security | Payroll (11) + country packs | A period's payment depends on attendance, leave and proration Compensation does not hold |
| **Deductions of any kind** | Payroll (statutory), Phase 10.1 (loans) | A voluntary deduction is only meaningful against a net figure this module does not compute; loan recovery already has an owner (D-1) |
| Overtime pay | Payroll | Attendance produces candidate minutes (ADR-0054); multiplying them is Payroll's |
| Unpaid-leave deduction | Payroll | Leave publishes authorized absence (ADR-0060); deducting for it is period arithmetic |
| End-of-service, gratuity, pension | Payroll / Compliance | Statutory calculation in a generic module is the failure 00B exists to prevent |
| Benefits administration | Benefits (12) | An employer contribution is representable as a component; enrolment and claims are not |
| Currency conversion | Nowhere in this phase | Not a rate, not a table, not a function |
| Person, employment status, attendance, leave | Their own modules | Referenced by identifier and read as at a date (ADR-0051) |

**Nothing statutory ships.** No minimum wage, no mandated housing or transport allowance, no tax
treatment, no social-security rule, no pension formula and no statutory progression. Basic Salary,
Housing and Transport are *examples in the specification* and appear nowhere in this module — every
one is a component a tenant or a country pack defines.

---

## The three decisions that carry the module

### Money is exact, and self-describing (ADR-0061)

Every monetary value is `amount_minor bigint` + `currency_code char(3)` + `currency_exponent
smallint`. No `numeric`, no `double precision`, and **no JavaScript `number` on any path** — a
`bigint` column arrives from the driver as a string and is parsed with `BigInt`; every published
figure crosses the boundary as an exact decimal string.

The exponent travels on every row rather than being looked up, because nothing in this repository
publishes one and two decimal places is a habit rather than a rule — KWD, BHD and OMR all have
three.

### A change supersedes; it never rewrites (ADR-0063)

An amendment writes `effective_to` on the period it supersedes — the only write ever made to a
historical row — and inserts a new one. The superseded row keeps its amount, so a payroll re-run for
a closed period produces that period's figure.

An amount assigned from a salary step is **copied onto the assignment**. Revising the step next year
must not restate what last year's payroll was run against.

**Overlap is refused by the database**: a GiST exclusion constraint over `daterange(effective_from,
effective_to, '[)')` per `(tenant, employment, component)`. Two administrators assigning the same
allowance concurrently both read before either wrote, so only the constraint can settle it; the
`23P01` is translated into `component_already_assigned`.

**Both time axes are recorded.** `effective_from` answers "what was true then"; `recorded_at`
answers "when did we learn it". A raise effective 1 March entered on 20 April has both, and
`compensation.changed-since` — how Payroll finds a retroactive correction — is a query on the
*system* axis.

### Compensation states entitlement; Payroll determines payment (ADR-0062)

`compensation.payroll-period` publishes facts and flags: amounts per currency, an uninterpreted
`payrollTreatmentCode`, a `proratable` flag, a `partialPeriod` fact, the percentage rule behind a
resolved amount, and a digest. It publishes **no computed total**, and there is no code path that
could produce one.

There is **no projection**. A current salary is one indexed row, so the payroll-period read is
answered set-based from the authoritative rows — one statement for a page of employments. See the
Phase 10 report for the measurement that decision rests on.

---

## The fourteen tables

| Table | What it is |
| --- | --- |
| `compensation_plan` | A plan version. Immutable once published |
| `compensation_plan_assignment` | Which plan governs which scope, effective-dated. Most-specific-wins; ties refused |
| `compensation_plan_component` | Which components a plan permits, and on what terms |
| `compensation_salary_structure` | The optional root of the hierarchy |
| `compensation_pay_grade` | A monetary range. `minimum ≤ midpoint ≤ maximum` by check constraint |
| `compensation_pay_scale` | A band within a grade. `progression_model` is stored and never acted on |
| `compensation_salary_step` | Under a scale **or** a grade — exactly one, by check constraint |
| `compensation_component` | What an employment can be entitled to. `deduction` is not a kind |
| `compensation_recurring` | **The authoritative record.** GiST overlap exclusion; value columns never rewritten |
| `compensation_one_time` | Bonuses and awards. No period, therefore no overlap rule |
| `compensation_adjustment` | The reason beside a change. Reason code and written note both required |
| `compensation_approval_decision` | Inserted and read. `check (decided_by <> requested_by)` |
| `compensation_change` | Append-only history, with full jsonb snapshots |
| `compensation_import_batch` | What a bulk load covered, wrote, skipped and failed |

Every one is tenant-scoped with row-level security applied by the creating migration (ADR-0030).

---

## Every level of the hierarchy is optional

```text
salary_structure          (optional)
        └── pay_grade     (optional)
                └── pay_scale   (optional)
                        └── salary_step   (optional)
```

None implies another. An assignment may reference a step, a scale, a grade, a structure, or **none
of them** — carrying a bare amount instead. That is the difference between a model that fits a
forty-person company and one that only fits a ministry.

A referenced level **constrains** and never computes: an assignment naming a grade is checked
against that grade's range at the effective date and refused outside it by name. A grade never
supplies a midpoint silently, because a system that filled one in would be deciding somebody's
salary.

**A pay grade is not a job grade** (ADR-0063). Organization's `position.grade` is an opaque
job-architecture band; a pay grade is a monetary range. They are related by an optional
`position_grade_label`, not by a foreign key — a foreign key would make Compensation unable to price
anything Organization had not graded.

---

## Percentage components

`percentage_of_component`, in integer basis points — 40% is `4000`. Resolved with
`Money.multipliedBy(bp, 10_000n, rounding)`, exact integer arithmetic with the rounding mode **stated
on the component definition**; there is no default.

**Compensation resolves it and publishes both the figure and the rule.** Publishing only the rule
would mean an HR screen and Payroll each resolve it, and the two disagree by a fil the first time
their rounding differs.

Refused rather than guessed: a basis that is not assigned on the date; a basis in a different
currency (nothing here converts); and a chain that returns to itself, refused at *definition* time.

---

## Approval

**Compensation records its own decisions and does not consume `ApprovalPort`.** The only adapter is
`AutoApprovingPort`, which approves everything as `system:auto-approval`; recording that as though a
human decided would be a false statement in an audit trail. This is the third module to reach that
conclusion (ADR-0045, ADR-0060).

- `decided_by` comes from the authenticated context, never from a command.
- `requested_by` is **copied onto the decision row**, which is what makes `check (decided_by <>
  requested_by)` enforceable — a check constraint cannot reach another table.
- `compensation.approve` is a separate permission from `compensation.manage`, and the domain refuses
  self-approval even for somebody holding both.
- A wrong decision is corrected by a **reversal**, never an edit. Both rows stay in the chain and
  neither counts toward the approvals a plan requires.
- A plan requiring no approval produces a change with **no decision row**, and the chain says "no
  approval was required" rather than naming a system approver.

A reversal is permitted while the change is still future-dated. Beyond that, Compensation cannot
know whether a payroll period consumed it, so the remedy is a new effective-dated change rather than
unmaking an approval.

---

## Cross-module reads

Two, both under bounded service grants (ADR-0043), both read-only:

| Port | Query | Grant permits |
| --- | --- | --- |
| `EmploymentDirectoryPort` | `employment.read-employment` (with `asOf`), `employment.search` | `employment.employment.read` |
| `OrganizationDirectoryPort` | `organization.governing-legal-entity` | `organization.legal-entity.read` |

Managing compensation does not require a permission on the employment register or on the
organizational structure. The employment is read **as at the effective date**, so a raise effective
in March is checked against March's status.

`known: false` from Organization means "could not be asked" and is never collapsed into "no legal
entity".

---

## Permissions

`compensation.read` · `compensation.read-own` · `compensation.manage` · `compensation.adjust` ·
`compensation.approve` · `compensation.plan.manage` · `compensation.plan.publish` ·
`compensation.component.manage` · `compensation.import` · `compensation.export`

Managing is not approving. **Reading a figure is not reading the reason behind it** — an
adjustment's note is the sentence somebody wrote about why a person's pay changed, and it sits
behind `compensation.adjust`. Drafting a plan is not publishing it. Exporting is held by fewer people
than reading.

---

## API

`/api/v1/compensation/...`

`GET|POST /plans` · `POST /plans/:id/publication` · `POST /plans/:id/components` ·
`POST /plans/:id/assignments` · `GET|POST /structures` · `GET|POST /grades` · `GET|POST /scales` ·
`GET|POST /steps` · `GET|POST /components` · `POST /components/:id/publication` ·
`GET /employments/:id` · `GET /employments/:id/as-of?date=` · `GET /employments/:id/future` ·
`GET /employments/:id/history` · `GET|POST /recurring` · `POST /recurring/:id/amendment` ·
`POST /recurring/:id/end` · `GET|POST /one-time` · `GET|POST /adjustments` ·
`GET /approvals/:subjectKind/:subjectId` · `POST /approvals/decision` ·
`POST /approvals/decision-reversal` · `GET /payroll-period` · `GET /changed-since` ·
`GET|POST /imports` · `GET /dashboard`

Route ordering is load-bearing: the payroll controller declares only literal segments and is
registered first, before the controllers carrying `:parameter` segments at the same depth.

---

## What is not verified

Payroll does not exist, so the contract is published and **not consumed**. No country pack exists,
so no statutory behaviour is exercised. Nothing authenticates in this repository (ADR-0032), so the
screens read against the real contract and fail closed. Employee and manager self-service are Phase
18's; `compensation.read-own` is declared and wired to nobody.
