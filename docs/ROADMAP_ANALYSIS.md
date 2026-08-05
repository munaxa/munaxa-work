# Roadmap analysis — Munaxa Work

An analysis of the 30 specifications in [`work prompts/`](../work%20prompts/), read end to end. It
is the Step 2 artifact of [the development protocol](../work%20prompts/27_DEVELOPMENT_PROTOCOL.md):
what the programme is, what the specifications settle, and what must be decided before Phase 0
starts. It changes no code and commits no decision — every open question below resolves as an
ADR.

## The programme

Munaxa Work is a multi-tenant enterprise HCM SaaS, API-first, competing with Menaitech,
Workday, SAP SuccessFactors, Oracle HCM and BambooHR. Twenty-five phases, run strictly in
order: three build the technical foundation, sixteen build business domains, two build the
self-service applications, and four build intelligence, governance, integration and operational
readiness.

The specifications are consistent about the thing that matters most — **one concept, one
owner** — and they hold that line across all sixteen business domains without a single
duplicated ownership. That is the strongest property of this roadmap, and it is what makes
the modular monolith credible as a future set of services.

## Phase map

| Phases | Group | What it delivers |
| ------ | ----- | ---------------- |
| 0–1.1  | Foundation | Workspace, shared kernel, CQRS, events, tenancy, audit, effective dating, then a verification phase that must pass before any business code |
| 2–5    | Workforce core | Workforce identity (Platform user → business user), organization structure, the People master registry, Employment |
| 6–7    | Talent intake | Recruitment, then Onboarding as a pure orchestration domain |
| 8–12   | Operations | Attendance, Leave, Compensation, Payroll, Benefits |
| 13–15  | Talent development | Performance, Learning, Career & succession |
| 16–17  | Cross-cutting engines | Workflow & approvals, Communications |
| 18–19  | Applications | Employee self-service, Manager self-service |
| 20–24  | Enterprise | Workforce intelligence, GRC, Integrations, AI, Operational readiness |

## The invariants every phase repeats

These recur in nearly every specification and are the real architecture:

- **Employment is the backbone.** Every operational domain (Attendance, Leave, Compensation,
  Payroll, Benefits, Performance, Learning, Career) references *Employment*, never *Person*.
  Person owns permanent identity; Employment owns the temporary relationship.
- **Facts, then interpretation.** Attendance records what happened. Leave authorises absence.
  Compensation defines entitlement. Payroll interprets all three financially and owns no
  source data.
- **Orchestrators own nothing.** Onboarding, Workflow, Communications, GRC, Workforce
  Intelligence and AI coordinate or observe; they write through application services and read
  through projections.
- **Nothing is hardcoded.** Leave types, accrual rules, approval chains, payroll formulas,
  benefit plans, competencies, onboarding tasks, KPIs, channels — all tenant configuration.
- **History is immutable.** Effective dating, versioned child entities, soft delete,
  optimistic concurrency and audit columns on every entity; finalized payroll is never
  modified, only adjusted or re-run.
- **AI advises, never decides.** Recommendations only, through projections, permission-aware,
  fully audited.

## Decisions needed before Phase 0

Each of these is a real fork in the specifications. None is a blocker to *starting*, but each
becomes expensive after the phase that assumes an answer.

### 1. Layer-first or module-first (blocking Phase 0)

Phase 0 specifies `packages/{domain,application,infrastructure,contracts,sdk,testing,config}`
— layer-first. Phase 1 specifies `modules/<module>/{domain,application,infrastructure,contracts,api}`
— module-first. These are different repositories.

Module-first is the one that matches everything else the specifications demand: module
independence, per-module registration, and a future extraction to services. Recommendation:
`packages/modules/<module>/<layer>` with the shared kernel as its own package, decided by ADR
before Phase 0 creates directories. (The enforcement in `tooling/eslint/standards.mjs` matches
on layer segments, so it holds under either shape.)

### 2. Tenant isolation strategy

Every specification requires tenant isolation; none says how. Shared schema with `tenant_id`,
schema-per-tenant, and database-per-tenant have very different operational costs, and
enterprise and government buyers in the target market frequently require the third.

Recommendation: shared schema with `tenant_id` plus **PostgreSQL row-level security** as
defence in depth — application-level filtering alone means one missing `where` clause is a
cross-tenant leak — with the deployment model kept pluggable for customers who require
dedicated databases. The schema gate already enforces the column.

### 3. Approval and notification ports (blocking Phase 8)

Workflow is Phase 16 and Communications is Phase 17, but Leave (9), Attendance (8),
Compensation (10), Payroll (11) and Recruitment (6) all need approvals and notifications years
earlier in the sequence. The specifications are consistent — those domains must not own an
engine — but they never say what the domains depend on in the meantime.

Recommendation: the shared kernel defines an `ApprovalPort` and a `NotificationPort` in
Phase 1, with in-process adapters until Phases 16–17 replace them. Phase 1's shared kernel
list does not currently include these; adding them is an ADR and a small addition, and skipping
it means retrofitting approvals into five domains.

### 4. ADR numbering collision

The ADR document defines ADR-0001…0020 (Platform Ownership, Deployment Agnostic, Multi-Tenant
First, Domain Ownership…). Phases 0 and 1 ask for "ADR-0001 Repository Structure", "ADR-0002
Platform Integration", "ADR-0003 Foundation Architecture", "ADR-0004 Module Boundaries" — the
same numbers, different decisions. New records in [`docs/adr/`](adr/) therefore start at 0021,
and the Phase 0/1 ADRs should be numbered from there rather than colliding.

### 5. Payroll formula engine

"No payroll calculations are hardcoded" plus "deterministic" plus "retro payroll" plus
"immutable snapshots" describes a versioned rule engine with replay — the hardest single piece
of engineering in the roadmap, and the one most likely to be underestimated. It deserves its
own design phase and its own ADR before Phase 11, and a golden-case regression suite from its
first commit: payroll defects are financial and public.

### 6. Attendance data volume

Biometric punches for a large tenant are the highest-volume table in the system by an order of
magnitude. Partitioning, retention and projection-refresh strategy should be decided when the
Attendance schema is written, not after.

## Status of this analysis

The gaps identified below were verified against menaitech.com and against a recording of
**MenaME-Plus+** (app v3.2.30, backend MenaHRMS v7.8.2208.08) running in a live deployment, and
have since been **closed in the specification set**: eight new phases (4.1, 5.1, 5.2, 5.3, 10.1,
11.1, 11.2, 12.1, 13.1, 19.1), two cross-cutting frameworks
([`00A`](../work%20prompts/00A_PHASE_SPECIFICATION_TEMPLATE.md) and
[`00B`](../work%20prompts/00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md)), and amendments to
Phases 0, 1, 3, 8, 9, 11, 12, 13, 15, 18 and 22. ADR-0023 through ADR-0028 record the decisions.

The competitor's shipped suite is CURIO® (HR and talent), MenaPAY® (payroll), MenaME® and
MenaME-Plus+® (self-service web and mobile), MenaTA® (attendance), MenaBI® (analytics),
Mena360® (feedback), MenaSME®, plus MenaLMS and MenaAI-TA. They claim 19+ countries, ISO/IEC
27001:2022, and named Saudi government integrations for wage protection, social insurance and
residency.

What the live application additionally showed, and what each finding changed:

| Observed | Changed |
| -------- | ------- |
| Dual Gregorian/Hijri date entry on every request | Calendar conversion moved into the Phase 1 Shared Kernel (ADR-0027) |
| Fractional balances, and a projected end-of-year balance beside the current one | Phase 9 now specifies fractional accrual and three balance queries |
| Nationality carried on the transaction | Statutory rules keyed by nationality in the country pack (ADR-0025) |
| Every action — including a personal data change — submitted as a transaction | Self-service is transactional (ADR-0026), Phase 18 AD-008 |
| Employee sees the named approval committee and timestamps | Approval visibility required from Phase 9, via the Phase 1 ApprovalPort (ADR-0024) |
| Loan balance, assets and certificates on the employee's own profile | Phases 10.1 and 5.3 |
| Geofenced biometric punch as the primary attendance interface | Phase 8 mobile capture, Phase 19.1 |
| An advertisers list inside the HR app's settings | Explicitly prohibited — Phase 19.1 non-goals, ADR-0028 |

Their weaknesses are worth naming because they are the wedge: raw decimals surfacing in the UI
("Age 42.752", "Period 1.000"), dense unstyled key-value screens, clipped labels, a 2022-era
backend build, and advertising shown to employees inside an application that holds their salary
and medical claims.

## Competitive gaps against Menaitech

The specifications describe a well-architected global HCM. Menaitech's advantage in its home
market is not architecture — it is localized statutory compliance, and a buyer's shortlist is
usually decided on it. The roadmap's principle of "no hardcoded countries, currencies or labor
laws" is the right foundation, but no phase delivers the country pack that sits on it.

**Not covered by any phase, and needed to win against Menaitech:**

- **A country/statutory pack** — end-of-service gratuity, social insurance contributions
  (GOSI and equivalents), wage-protection-system payment files, statutory leave entitlements
  and end-of-service settlement rules. Payroll assigns "statutory deductions" to itself but
  never scopes them. This is the single largest gap.
- **Employee documents and permit expiry** — residence permits, visas, work permits, contract
  and certificate expiry with escalating reminders. Learning owns certification expiry;
  nothing owns document expiry.
- **Offboarding** — Employment has a `Terminated` state and Payroll has a final settlement,
  but there is no orchestration domain mirroring Onboarding: clearance, asset return, exit
  interview, settlement coordination.
- **Employee relations** — disciplinary actions, warnings and grievances are explicitly
  excluded from Performance and are owned by nothing.
- **Loans and advances** — Compensation lists "Loan Recovery" as a deduction, but no domain
  owns the loan, its schedule or its balance.
- **Asset custody, travel and expenses, timesheets/project costing, HSE** — common in
  enterprise HCM tenders in this market, absent here.
- **Mobile applications** — Phase 0 bootstraps a Flutter app; no later phase gives it any
  functionality. ESS and MSS are specified as web applications, yet the product is stated to be
  mobile-first. Attendance in particular is a mobile-first feature (punch, geofence, roster).
- **Arabic-first and Hijri calendar** — the internationalization rules require multiple
  languages, calendars and RTL, which is the right architecture, but no phase produces the
  Arabic content, Hijri conversions or Arabic payslip and report layouts that a regional buyer
  evaluates on day one.

None of these breaks the architecture — each is a domain or a country pack that fits the
existing pattern. They belong in the roadmap as explicitly numbered phases so they are not
discovered during a tender.

## Risks worth naming now

| Risk | Why it matters | Mitigation |
| ---- | -------------- | ---------- |
| Sequence length | Twenty-five sequential phases with no business value until Phase 5 at the earliest | Define a sellable milestone (core HR + attendance + leave + payroll, Phases 0–11) and treat later phases as increments |
| Approvals retrofit | Five domains need approvals before Workflow exists | Ports in Phase 1 (decision 3) |
| Configuration surface | Everything configurable means every domain ships a rules engine | One shared rule/expression engine in the foundation, consumed by all — not one per domain |
| Projection drift | Every domain publishes projections consumed by Intelligence, GRC and AI | Rebuild-from-events must be a foundation capability, not a per-domain script |
| Verification cost | Phase 1.1 verifies the architecture manually | Already partly automated: the standards, architecture and boundary gates run in CI on every pull request |

## What already exists

The two governance documents are adopted and enforced —
[`MASTER_INSTRUCTIONS.md`](MASTER_INSTRUCTIONS.md),
[`ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md), the ESLint and TypeScript standards
layers, the standards and architecture gates, and the CI jobs that run them. The schema gate
enforces the tenant, audit, soft-delete and concurrency columns from the first model written,
which is a large part of Phase 1.1's checklist automated before Phase 0 begins.

Nothing else exists. The next step is Phase 0, and the decisions above are what it needs
settled first.
