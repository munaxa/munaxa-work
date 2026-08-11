# Implementation ledger

Phases are implemented strictly in order. No phase begins before the previous one satisfies
its acceptance criteria, and skipping a phase is prohibited. Each phase follows
[`work prompts/27_DEVELOPMENT_PROTOCOL.md`](../work%20prompts/27_DEVELOPMENT_PROTOCOL.md) and
ends by stopping for approval.

This ledger is the record of where the product actually is. A phase moves to **Complete** only
when its definition of done is met — CI green, production build passing, documentation and
ADRs updated.

| #   | Phase                       | Specification                                                                                      | Status      |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------- | ----------- |
| —   | Engineering standards       | [`00_ENGINEERING_STANDARDS.md`](../work%20prompts/00_ENGINEERING_STANDARDS.md)                        | Adopted     |
| —   | Master instructions         | [`00_MASTER_INSTRUCTIONS.md`](../work%20prompts/00_MASTER_INSTRUCTIONS.md)                            | Adopted     |
| —   | Phase specification template| [`00A_PHASE_SPECIFICATION_TEMPLATE.md`](../work%20prompts/00A_PHASE_SPECIFICATION_TEMPLATE.md)        | Adopted     |
| —   | Localization & statutory    | [`00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md`](../work%20prompts/00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md) | Adopted |
| 0   | Repository bootstrap        | [`01_PHASE_0_WORK_BOOTSTRAP.md`](../work%20prompts/01_PHASE_0_WORK_BOOTSTRAP.md)                      | Complete    |
| 1   | Foundation                  | [`02_PHASE_1_FOUNDATION.md`](../work%20prompts/02_PHASE_1_FOUNDATION.md)                              | Complete    |
| 1.1 | Architecture verification   | [`02A_PHASE_1.1_ARCHITECTURE_VERIFICATION.md`](../work%20prompts/02A_PHASE_1.1_ARCHITECTURE_VERIFICATION.md) | Complete    |
| 2   | Workforce identity          | [`03_PHASE_2_WORKFORCE_IDENTITY.md`](../work%20prompts/03_PHASE_2_WORKFORCE_IDENTITY.md)              | Complete    |
| 3   | Organization                | [`04_PHASE_3_ORGANIZATION.md`](../work%20prompts/04_PHASE_3_ORGANIZATION.md)                          | Complete    |
| 4   | People master registry      | [`05_PHASE_4_PEOPLE_MASTER_REGISTRY.md`](../work%20prompts/05_PHASE_4_PEOPLE_MASTER_REGISTRY.md)      | Complete    |
| 4.1 | Employee documents & expiry | [`05A_PHASE_4.1_EMPLOYEE_DOCUMENTS.md`](../work%20prompts/05A_PHASE_4.1_EMPLOYEE_DOCUMENTS.md)          | Not started |
| 5   | Employment                  | [`06_PHASE_5_EMPLOYMENT.md`](../work%20prompts/06_PHASE_5_EMPLOYMENT.md)                              | Awaiting approval |
| 5.1 | Employee letters            | [`06A_PHASE_5.1_EMPLOYEE_LETTERS.md`](../work%20prompts/06A_PHASE_5.1_EMPLOYEE_LETTERS.md)            | Not started |
| 5.2 | Employee relations          | [`06B_PHASE_5.2_EMPLOYEE_RELATIONS.md`](../work%20prompts/06B_PHASE_5.2_EMPLOYEE_RELATIONS.md)        | Not started |
| 5.3 | Assets & custody            | [`06C_PHASE_5.3_ASSETS_CUSTODY.md`](../work%20prompts/06C_PHASE_5.3_ASSETS_CUSTODY.md)                | Not started |
| 6   | Recruitment                 | [`07_PHASE_6_RECRUITMENT.md`](../work%20prompts/07_PHASE_6_RECRUITMENT.md)                            | Not started |
| 7   | Onboarding                  | [`08_PHASE_7_ONBOARDING.md`](../work%20prompts/08_PHASE_7_ONBOARDING.md)                              | Not started |
| 8   | Attendance                  | [`09_PHASE_8_ATTENDANCE.md`](../work%20prompts/09_PHASE_8_ATTENDANCE.md)                              | Awaiting approval |
| 9   | Leave                       | [`10_PHASE_9_LEAVE.md`](../work%20prompts/10_PHASE_9_LEAVE.md)                                        | Not started |
| 10  | Compensation                | [`11_PHASE_10_COMPENSATION.md`](../work%20prompts/11_PHASE_10_COMPENSATION.md)                        | Not started |
| 10.1| Loans & advances            | [`11A_PHASE_10.1_LOANS_ADVANCES.md`](../work%20prompts/11A_PHASE_10.1_LOANS_ADVANCES.md)              | Not started |
| 11  | Payroll engine              | [`12_PHASE_11_PAYROLL_ENGINE.md`](../work%20prompts/12_PHASE_11_PAYROLL_ENGINE.md)                    | Not started |
| 11.1| Statutory & country packs   | [`12A_PHASE_11.1_STATUTORY_COUNTRY_PACKS.md`](../work%20prompts/12A_PHASE_11.1_STATUTORY_COUNTRY_PACKS.md) | Not started |
| 11.2| Offboarding & settlement    | [`12B_PHASE_11.2_OFFBOARDING.md`](../work%20prompts/12B_PHASE_11.2_OFFBOARDING.md)                    | Not started |
| 12  | Benefits                    | [`13_PHASE_12_BENEFITS.md`](../work%20prompts/13_PHASE_12_BENEFITS.md)                                | Not started |
| 12.1| Medical & employee claims   | [`13A_PHASE_12.1_MEDICAL_CLAIMS.md`](../work%20prompts/13A_PHASE_12.1_MEDICAL_CLAIMS.md)              | Not started |
| 13  | Performance                 | [`14_PHASE_13_PERFORMANCE.md`](../work%20prompts/14_PHASE_13_PERFORMANCE.md)                          | Not started |
| 13.1| Engagement & surveys        | [`14A_PHASE_13.1_ENGAGEMENT_SURVEYS.md`](../work%20prompts/14A_PHASE_13.1_ENGAGEMENT_SURVEYS.md)      | Not started |
| 14  | Learning                    | [`15_PHASE_14_LEARNING.md`](../work%20prompts/15_PHASE_14_LEARNING.md)                                | Not started |
| 15  | Career and succession       | [`16_PHASE_15_CAREER_SUCCESSION.md`](../work%20prompts/16_PHASE_15_CAREER_SUCCESSION.md)              | Not started |
| 16  | Workflow                    | [`17_PHASE_16_WORKFLOW.md`](../work%20prompts/17_PHASE_16_WORKFLOW.md)                                | Not started |
| 17  | Communications              | [`18_PHASE_17_COMMUNICATIONS.md`](../work%20prompts/18_PHASE_17_COMMUNICATIONS.md)                    | Not started |
| 18  | Employee self service       | [`19_PHASE_18_EMPLOYEE_SELF_SERVICE.md`](../work%20prompts/19_PHASE_18_EMPLOYEE_SELF_SERVICE.md)      | Not started |
| 19  | Manager self service        | [`20_PHASE_19_MANAGER_SELF_SERVICE.md`](../work%20prompts/20_PHASE_19_MANAGER_SELF_SERVICE.md)        | Not started |
| 19.1| Mobile applications         | [`20A_PHASE_19.1_MOBILE_APPLICATIONS.md`](../work%20prompts/20A_PHASE_19.1_MOBILE_APPLICATIONS.md)    | Not started |
| 20  | Workforce intelligence      | [`21_PHASE_20_WORKFORCE_INTELLIGENCE.md`](../work%20prompts/21_PHASE_20_WORKFORCE_INTELLIGENCE.md)    | Not started |
| 21  | Governance, risk, compliance| [`22_PHASE_21_GOVERNANCE_RISK_COMPLIANCE.md`](../work%20prompts/22_PHASE_21_GOVERNANCE_RISK_COMPLIANCE.md) | Not started |
| 22  | Enterprise integrations     | [`23_PHASE_22_ENTERPRISE_INTEGRATIONS.md`](../work%20prompts/23_PHASE_22_ENTERPRISE_INTEGRATIONS.md)  | Not started |
| 23  | AI workforce intelligence   | [`24_PHASE_23_AI_WORKFORCE_INTELLIGENCE.md`](../work%20prompts/24_PHASE_23_AI_WORKFORCE_INTELLIGENCE.md) | Not started |
| 24  | Enterprise operations       | [`25_PHASE_24_ENTERPRISE_OPERATIONS.md`](../work%20prompts/25_PHASE_24_ENTERPRISE_OPERATIONS.md)      | Not started |

**Status values** — Not started · In progress · Awaiting approval · Complete.

The four governance documents are marked *Adopted*: they are not phases, they are the rules
every phase is measured against. They are in force from now on, and they are enforced by the
gates listed in [`MASTER_INSTRUCTIONS.md`](MASTER_INSTRUCTIONS.md).

Decimal phases are phases, not options. They close the gaps identified in
[`ROADMAP_ANALYSIS.md`](ROADMAP_ANALYSIS.md) between the original specification set and the
capability an enterprise HCM must ship in this market. They run in numeric order alongside the
whole numbers.

**Verification** — Phase 1.1 passed on 2026-08-05. The report, the technical debt register and
the production-readiness assessment are in
[`verification/phase-1.1-report.md`](verification/phase-1.1-report.md).

Phases 0, 1 and 1.1 were approved on 2026-08-05, having merged in #2.

Phase 2 completed on 2026-08-05 and was approved and merged the same day (#3): the first business
module, and the closure of the tenant-header risk Phase 1.1 named as the largest one open. Its
report, the carried-forward debt register and its production-readiness assessment are in
[`verification/phase-2-report.md`](verification/phase-2-report.md).

Phase 3 completed on 2026-08-06: the Organization domain — structure of unlimited depth, the
legal entity that carries the country every later statutory calculation resolves from, the
position catalogue and its establishment, organizational calendars, and the closure of the
tenant-settings debt Phase 2 recorded. Its report, the carried-forward debt register and its
production-readiness assessment are in
[`verification/phase-3-report.md`](verification/phase-3-report.md).

Phase 4 completed on 2026-08-06 and merged as #7: the master registry of human identity, one
permanent Person per human being, with duplicate prevention before a second record can be created.
Its report is in [`verification/phase-4-report.md`](verification/phase-4-report.md).

Phase 5 completed on 2026-08-09: the Employment domain — the relationship between a person and the
workforce, its lifecycle, organizational assignment on a timeline, the managerial relationship,
contracts and probation, and the closure of the always-zero filled headcount Phase 3 left for it. The
planning checkpoint and the decisions it stopped on are in
[`verification/phase-5-plan.md`](verification/phase-5-plan.md); the report, the carried-forward debt
register and the production-readiness assessment are in
[`verification/phase-5-report.md`](verification/phase-5-report.md).

Phase 6 completed on 2026-08-09: Recruitment — requisitions and their approval, vacancies,
candidates, applications and their pipeline, interviews and feedback, offers, and the transition that
turns an accepted offer into a Person and an Employment. It introduces the bounded service grant that
lets one module act inside another without widening a user's role
([ADR-0043](adr/0043-bounded-service-grant.md)). The planning checkpoint and the approved decisions
are in [`verification/phase-6-plan.md`](verification/phase-6-plan.md); the report, the carried-forward
debt register and the production-readiness assessment are in
[`verification/phase-6-report.md`](verification/phase-6-report.md).

Phase 7 completed on 2026-08-10: Onboarding — configurable plans and their immutable versions, the
onboarding instance for one employment, tasks with owners and due dates, completion and cancellation,
and the reconciliation that guarantees a joiner has an induction even when the hire event that should
have started one was never delivered. It creates no Person and no Employment
([ADR-0047](adr/0047-onboarding-owns-no-employment-fact.md)) and starts by idempotent command rather
than by event ([ADR-0050](adr/0050-onboarding-starts-by-command-not-by-event.md)). The planning
checkpoint and the approved decisions are in
[`verification/phase-7-plan.md`](verification/phase-7-plan.md); the report, the carried-forward debt
register and the production-readiness assessment are in
[`verification/phase-7-report.md`](verification/phase-7-report.md).

Phase 8 completed on 2026-08-11: Attendance — raw time events, shifts, schedules and their cycles,
rosters, attendance policies, the calculated working day with its exceptions, corrections that never
rewrite a punch, and the frozen snapshot Payroll reads. A raw event is immutable
([ADR-0052](adr/0052-a-raw-time-event-is-immutable.md)); recalculation is found by asking rather than
by being told ([ADR-0053](adr/0053-recalculation-is-found-by-asking.md)); the schedule owns the time
zone, and no work location is invented
([ADR-0055](adr/0055-the-schedule-owns-the-time-zone.md)); and "leave unknown" is not "no leave"
([ADR-0056](adr/0056-leave-unknown-is-not-leave-none.md)). The planning checkpoint and the approved
decisions are in [`verification/phase-8-plan.md`](verification/phase-8-plan.md); the report, the
carried-forward debt register and the production-readiness assessment are in
[`verification/phase-8-report.md`](verification/phase-8-report.md).

Phase 9 completed on 2026-08-10: Leave & Absence Management — tenant-configured leave types and
versioned policies, entitlement, an append-only ledger with a derived balance projection, requests
with a per-date breakdown, approval by a named human, cancellation and amendment that reverse rather
than delete, accrual, leave-year closure and carry-over expiry as bounded restartable runs. Leave
never writes to Attendance: Attendance pulls leave changes on its own reconciliation run
([ADR-0058](adr/0058-attendance-pulls-leave-changes.md)). The ledger is authoritative and the balance
is a projection ([ADR-0059](adr/0059-the-leave-ledger-is-authoritative.md)). Nothing statutory ships,
and approval is recorded rather than delegated to an auto-approving port
([ADR-0060](adr/0060-leave-ships-no-statutory-content.md)). Attendance gained one published read —
`attendance.expected-working-days` — so Leave counts working days against the schedule engine that
already owns them rather than duplicating it. The planning checkpoint and the approved decisions are
in [`verification/phase-9-plan.md`](verification/phase-9-plan.md); the report, the carried-forward
debt register and the production-readiness assessment are in
[`verification/phase-9-report.md`](verification/phase-9-report.md).

Phase 10 completed on 2026-08-10: Compensation Management — versioned compensation plans, an
optional four-level salary hierarchy, tenant-configured components, effective-dated recurring and
one-time compensation, adjustments with a written reason, an append-only history, and the set-based
contract Payroll will consume. Money is integer minor units carrying its own currency exponent, with
no `number` anywhere on the path
([ADR-0061](adr/0061-money-carries-its-currency-exponent.md)). Compensation states entitlement and
Payroll determines payment, so the contract publishes facts and flags and no computed total — and no
projection was built, because the authoritative rows answer the payroll-period question set-based
([ADR-0062](adr/0062-compensation-states-entitlement.md)). A change supersedes rather than rewrites,
overlap is refused by a GiST exclusion constraint, both time axes are recorded, and a pay grade is
deliberately not Organization's job grade
([ADR-0063](adr/0063-a-compensation-change-supersedes.md)). Deductions are excluded from this phase
entirely: statutory deductions are Payroll's and loan recovery is Phase 10.1's. Nothing statutory
ships. The planning checkpoint and the approved decisions are in
[`verification/phase-10-plan.md`](verification/phase-10-plan.md); the report, the carried-forward
debt register and the production-readiness assessment are in
[`verification/phase-10-report.md`](verification/phase-10-report.md).

Phase 11 completed on 2026-08-10: Payroll — payroll groups and pay calendars, deduction
definitions, periods, runs with a resumable cursor, an immutable input snapshot per employment,
results with earning and deduction lines that each explain their own arithmetic, exceptions,
manual adjustments with a written reason, named-human approval, finalization, reversal,
reconciliation, and the two outputs this system prepares and nothing consumes. A run calculates
from its snapshot rather than from live sources, which is what makes a payslip explainable eight
months later ([ADR-0064](adr/0064-payroll-calculates-from-a-snapshot.md)). Attendance publishes
**candidate** overtime minutes and Payroll will not promote one into pay: the classification is
reserved, unreachable, and asserted so
([ADR-0065](adr/0065-a-candidate-is-not-an-approved-fact.md)). Finalized payroll is immutable at
the table — a trigger refuses any update or delete of a frozen row from any path, at a measured
+8% on single-row updates ([ADR-0066](adr/0066-finalized-payroll-is-immutable-at-the-table.md)).
Payroll prepares balanced accounting lines against opaque tenant codes and payment instructions
carrying no account identifier, and posts and executes nothing
([ADR-0067](adr/0067-payroll-publishes-outputs-and-posts-nothing.md)). Reconciliation is a pull, so
correctness never depends on an event having been delivered. Leave gained one published read —
`leave.payroll-period` — so Payroll consumes authorized absence through a contract rather than by
interpreting Leave's tables. Nothing statutory ships: no tax, no social security, no GOSI, no WPS,
no Mudad, no Muqeem, and no country pack. The planning checkpoint and the approved decisions are in
[`verification/phase-11-plan.md`](verification/phase-11-plan.md); the report, the defects the tests
caught, the measured performance at 500, 10,000 and 100,000 employees, the carried-forward debt
register and the production-readiness assessment are in
[`verification/phase-11-report.md`](verification/phase-11-report.md).

Phase 12 completed on 2026-08-11: Employee Documents and Letters — two modules, eleven tables.
**Documents** holds document types a tenant configures, stable document identities filed against a
person, an employment or a legal entity, insert-only versions, verification decisions attached to a
*version*, and a queryable access trail. It holds **no bytes**: `StoragePort` has no adapter in this
repository, so upload, download, content inspection, malware scanning and hash verification are all
`NOT VERIFIED` — recorded as absent rather than approximated, and the download authorization answers
`available: false` rather than fabricating a URL. Where a document evidences a People identifier,
**People owns the expiry** and Documents stores none of its own; a check constraint refuses a row
carrying both. Confidentiality is applied in the query rather than after it, so a caller without
`document.read-sensitive` neither receives a confidential document nor learns how many were
withheld — a count is itself a disclosure. **Letters** holds tenant-authored templates, immutable
template versions, requests, named-human approval decisions and issued letters carrying a frozen
snapshot of every substituted value and the version of each source it came from, so a March salary
certificate still reads March's salary after April's raise. A variable is a name and substitution is
a lookup: there is no expression language, no operator and no way for template text to reach code. A
letter that states pay needs two gates — the template's own allow-list and the issuer's
`letter.include-salary` — because otherwise a letter is a way to read a salary the caller could not
read directly. Nothing renders a file and nothing claims a signature: no PDF library and no
signature provider exist, so an issued letter carries its content and no artefact. Four database
triggers were added and two were narrowed after the tests found them wrong in opposite directions —
one refused a stamp the design required, the other left a supersession pointer repointable. Neither
module publishes or subscribes to an event, so there is no lost-event scenario: every cross-module
fact is pulled at the moment it is needed. The planning checkpoint and the approved decisions
D-1…D-29 are in [`verification/phase-12-plan.md`](verification/phase-12-plan.md); the report, the
two defects the tests caught before the fix, the measured performance at 10,000 and 100,000
documents, the ten `NOT VERIFIED` capabilities and the carried-forward debt register are in
[`verification/phase-12-report.md`](verification/phase-12-report.md).

**First commercial milestone** — Phases 0 through 11.2 deliver a sellable product: core HR,
documents, letters, employee relations, assets, recruitment, onboarding, attendance, leave,
compensation, loans, payroll with statutory country packs, and offboarding with final
settlement. Phases 12 onward are increments on a product that already runs a compliant payroll.
