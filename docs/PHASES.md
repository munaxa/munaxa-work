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
| 4.1 | Employee documents & expiry | [`05A_PHASE_4.1_EMPLOYEE_DOCUMENTS.md`](../work%20prompts/05A_PHASE_4.1_EMPLOYEE_DOCUMENTS.md)          | Complete    |
| 5   | Employment                  | [`06_PHASE_5_EMPLOYMENT.md`](../work%20prompts/06_PHASE_5_EMPLOYMENT.md)                              | Awaiting approval |
| 5.1 | Employee letters            | [`06A_PHASE_5.1_EMPLOYEE_LETTERS.md`](../work%20prompts/06A_PHASE_5.1_EMPLOYEE_LETTERS.md)            | Complete    |
| 5.2 | Employee relations          | [`06B_PHASE_5.2_EMPLOYEE_RELATIONS.md`](../work%20prompts/06B_PHASE_5.2_EMPLOYEE_RELATIONS.md)        | In progress |
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
| 15  | Career and succession       | [`16_PHASE_15_CAREER_SUCCESSION.md`](../work%20prompts/16_PHASE_15_CAREER_SUCCESSION.md)              | Complete    |
| 16  | Workflow                    | [`17_PHASE_16_WORKFLOW.md`](../work%20prompts/17_PHASE_16_WORKFLOW.md)                                | Awaiting approval |
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

Phase 13 completed on 2026-08-11: Performance, Competencies & Goals — one module, twenty-three
tables. It says what somebody was rated, what that rating was measured against, and why, for as long
as the record has to answer for itself. **Every score is a whole number of hundredths and every
weight a whole number of basis points; there is no `numeric` column in the module.** The engine
computes in `bigint` and its one division rounds explicitly, half away from zero — and a component
nobody assessed **leaves the denominator with its reason recorded** rather than being scored zero,
because scoring it zero rates somebody at the bottom of the scale for work nobody looked at
([ADR-0069](adr/0069-a-score-is-an-integer-and-an-absence-is-not-a-zero.md)). Completing a review
writes an immutable snapshot of the scale, the levels, the template, the weights, the working and
the placement, so retiring the scale, retiring the template and moving the employment to a different
manager in a different unit changes nothing the review says — proven end to end against real
PostgreSQL ([ADR-0068](adr/0068-a-rating-is-explained-from-a-snapshot.md)). Calibration records a
second number beside the first and never over it; `calibrate` and `complete` are separate
permissions, because moving a rating in a meeting and signing a review off are different decisions.
**Self and peer assessments are recorded, readable and count for nothing** — no weighting was
approved, so none was invented. **Confidential is not anonymous**: every 360° response is an
attributed row, and below a template's minimum the aggregate is withheld rather than anonymized.
D-31 required no change to Employment — `employment.search` already answers which employments report
to a manager as of a date. Two authorization defects the tests caught are now permanently covered: a
`read-team` caller who named any manager received that manager's team, and a review's own manager
became the caller's authorization scope. `read-team` remains `NOT VERIFIED` until a principal
resolves to an employment, and a `read-team` caller reads nothing whatever they name. The planning
checkpoint and the approved decisions D-1…D-31 are in
[`verification/phase-13-plan.md`](verification/phase-13-plan.md); the four layer reports, the nine
defects with their original failing evidence, the measured performance at 500, 10,000 and 100,000
employments with two budget misses found and fixed, the nine `NOT VERIFIED` capabilities and the
carried-forward debt register are in
[`verification/phase-13-final-report.md`](verification/phase-13-final-report.md).

Phase 14A completed on 2026-08-13: Learning and Development — one module, twelve tables. It records
what somebody was asked to do, what they sat, what an assessor observed and what they hold, and it
**evaluates nobody**: AD-002 says course completion does not imply competency, and no column here
implies it. **There is no `numeric` column, no `bigint` and no money anywhere in the module** — every
number is a small schema-constrained integer, and the one freely-typed value is `raw_mark`, a
`varchar(32)` nothing parses, so `18.50` is stored, returned and rendered as `18.50`. Two answers are
**computed rather than stored**: whether a certificate is still valid, and whether a requirement is
overdue. Both are functions of a civil date and the day somebody asked, because `JobPort` has no
adapter and a flag nothing maintains would show `valid` for a licence that lapsed in March
([ADR-0070](adr/0070-learning-owns-the-expiry-of-what-it-issues.md)). Recurring training is generated
by a **bounded, idempotent command an administrator runs**, arbitrated by a partial unique index over
a derived occurrence day rather than a read-then-write — so a retried run creates nothing and two
simultaneous runs converge ([ADR-0071](adr/0071-a-recurring-requirement-is-computed-not-scheduled.md)).
**A dependency that cannot answer is a refusal, never a zero**: if Employment cannot resolve a rule's
audience, reconciliation refuses rather than reporting that everybody is up to date about an
organization it never looked at. No scoring formula was invented — the specification defines none, so
an assessor states an outcome and nothing computes one. Every date is a `YYYY-MM-DD` string from
column to rendered HTML, with no `Date` anywhere on the path. `read-team`, `read-own` and self-service
remain `NOT VERIFIED` until a principal resolves to an employment. The planning checkpoint is in
[`verification/phase-14-plan.md`](verification/phase-14-plan.md); the seven defects with their
original failing evidence, the measured performance at 500, 10,000 and 100,000 employments with **all
twenty-five workloads within budget**, the query plans, the nine `NOT VERIFIED` capabilities and the
carried-forward debt register are in
[`verification/phase-14a-final-report.md`](verification/phase-14a-final-report.md). **Phase 14B —
sessions, capacity, waitlists and scheduling — is not started**: no column, no port, no route, no
screen.

Phase 15 completed on 2026-08-14: Career, Succession and Development — one module, twelve tables. It
records the ladders a tenant defines, who is on one, the benches it keeps, what people have been
judged ready for, what they agreed to do and where somebody suggested they move next — and it
**recommends and executes nothing**. No employment, position, assignment or salary changes because of
anything in this module, and there is no port through which one could: every cross-module adapter
takes `Asking`, which declares `ask` and no `send`, so an adapter that tried to write another
module's data would not compile
([ADR-0072](adr/0072-a-career-recommendation-is-advisory-and-writes-nothing.md)). **A decision is
Career's; an observation stays where it was made** — talent-pool membership is a standing decision an
organization took, Performance's nine-box placement is an observation of one cycle, and neither
derives the other
([ADR-0073](adr/0073-a-decision-is-careers-an-observation-stays-where-it-was-made.md)). **Readiness is
stated by a person**: the specification defines no formula, so an authorized human states a level with
a rationale and their name on it, and there is no score, no percentage and no nine-box anywhere in the
module ([ADR-0074](adr/0074-readiness-is-stated-by-a-person.md)). Assessments are immutable at the
table — one trigger refuses update and delete, so a correction is a new assessment and `latest` is a
selection of the most recent statement rather than an average of two. **There is no `numeric`, no
`double precision`, no `real`, no `bigint` and no `money` column anywhere**: every number is a small
bounded integer a human chose, and every date is a `YYYY-MM-DD` civil day with no `Date` on the path.
Two answers are derived on read against a stated day rather than stored — whether a succession review
is due and whether a mobility recommendation still stands — because `JobPort` has no adapter and a
flag nothing maintains goes stale. D-4 (critical-position enumeration) and D-5 (nine-box and
high-potential listing) were **refused and remain `NOT VERIFIED`**; the only change to a completed
module is the narrow additive `organization.list-positions(positionId?)` exact-identifier lookup,
which adds no way to discover a position by any property and no `criticality` filter. Sixteen
capabilities remain `NOT VERIFIED`, none with a placeholder anywhere in the product. The three
production defects with their original failing evidence, the fourteen test and fixture defects beside
them, the measured performance at 500, 10,000 and 100,000 employments with **all twenty-six workloads
within budget**, the query plans, the sixteen `NOT VERIFIED` capabilities and the carried-forward debt
register are in
[`verification/phase-15-final-report.md`](verification/phase-15-final-report.md).

Phase 16A completed on 2026-08-15: Enterprise Workflow and Approvals — one module, seven tables. It
records the approval processes a tenant configures, raises an approval about a record another module
owns, asks one named person at a time to decide it, and writes down who answered, on whose authority
and when — and it **owns no business data**. An approval is *about* a subject, and the subject is two
opaque strings Workflow never interprets: there is no foreign key out of the module, no import of
another module's package, and no shape in which it could learn what a requisition is. **Every chain
is sequential and one named membership answers each step**: there is no role directory and no group
directory in this product, no parallel branch, no majority, quorum or first-response, and no
condition on which a chain forks. **Nothing is scheduled and nothing expires** — `JobPort` still has
no adapter anywhere, so no approval ages out, no escalation fires, and a delegation is in force only
if Identity says so *at the instant of the decision*, which is why Workflow keeps no expiry state of
its own. "The approvals waiting for me" is the **first `read-own` in this repository that is routed
and enforced**, because an approval is addressed to a membership and a membership is what the request
resolved before any handler ran; no endpoint, body or command field accepts one, so nobody can aim
the queue at somebody else. A decision records **two** memberships that never collapse into one — the
delegate who acted and the approver whose authority was used — and two check constraints make the
pair impossible to write wrongly. Decisions and timeline entries are **append-only at the table**,
with two triggers refusing update and delete and no mutation method on either repository. **There is
no `numeric`, no `real`, no `double precision`, no `bigint`, no `money` and no `date` column
anywhere**: every number is a small whole one and every moment is an instant. **Recruitment is the
single adopted business module**, by write, through a seam that was stopped on and approved before it
was built: Recruitment is asked *first*, so a refusal leaves Workflow with nothing written, and the
reverse window is closed by reconciling on the approval identifier rather than by claiming an
atomicity two transactions do not have — there is no outbox, no broker, no worker and no scheduler.
The kernel's `ApprovalPort` is **unchanged**; Workflow implements it inbound, published and unwired.
Twenty-two capabilities remain `NOT VERIFIED`, none with a placeholder anywhere in the product, and
`expired` is declared in the port's vocabulary and never produced. The planning checkpoint is in
[`verification/phase-16-plan.md`](verification/phase-16-plan.md); the three production defects and
one UI defect with their original failing evidence, the three fixture defects the closing audit found
by building a database from the migrations alone, the measured performance at 500, 10,000 and 100,000
approvals with **all eighteen workloads within budget at every tier**, the query plans, the nine
verified races, the twenty-two `NOT VERIFIED` capabilities and the carried-forward debt register are
in [`verification/phase-16a-final-report.md`](verification/phase-16a-final-report.md).

Phase 16B completed on 2026-08-16: the **routing core** — two tables, one additive migration, and the
capability to ask several people at once and choose which people to ask. An **approval group** is an
explicit list of memberships a tenant writes down, with a code unique per tenant and a bilingual
name; a step may name a list instead of a person, and the list is resolved into individual steps
**once, when the approval starts**, each recording which list it came from. **This is not a
directory**: there is still no role directory and no group directory in this product, nothing
resolves a department, a position or a membership query, and a member of a list is Identity's
identifier held as an opaque value. **Several steps may share one ordinal and are asked at the same
moment**, and how that branch ends is the tenant's choice of `unanimous`, `majority` or
`first-response`, optionally gated by a **quorum** — a whole number of responses, never a proportion,
which gates a rejection exactly as it gates an approval, approves nothing by itself, and leaves the
branch awaiting when it cannot be reached. A **majority is strictly more than half**, so a tie is not
an approval, and the denominator is the set of approvers **snapshotted at start**: a non-response is
outstanding and never subtracted. A branch may carry **conditions** in a closed `(key, operator,
value)` form with five operators combined only by `all-of`; a condition that cannot be evaluated is a
**refusal and never a silent `false`**, because the request not carrying a value is somebody's
mistake to fix rather than routing that worked. The **tally is computed from the decisions at read
time and stored nowhere**, so there is no counter to disagree with the decisions when two approvers
commit at once. Editing a list **never reaches an approval already running** — somebody removed today
still decides what they were asked yesterday — while the next approval sees the new membership. The
group tables use **composite tenant-aware foreign keys**, because PostgreSQL checks a foreign key
without consulting row-level security and a single-column reference would let one tenant's row point
at another's list. Row-level security is enabled **and forced** on all **nine** tables, one permissive
policy each. **Two permissions were added and nothing else**: `workflow.group.read` and
`workflow.group.manage`, neither implied by the other or by `workflow.definition.manage`. The Admin
screen gained five read-only sections and its honesty section **shrank**, because six capabilities it
had listed as absent are now real. **Nothing was scheduled, escalated, expired, notified, measured or
routed to a manager**: `JobPort` still has no adapter, no completed module was modified, no
cross-module contract was added, and the Recruitment seam is unchanged. Twenty-four capabilities
remain `NOT VERIFIED`, none with a placeholder anywhere. The four production defects — a localized
name accepted in one language, a branch skip overwriting recorded decisions, a vote counted outside
its own branch, and a group's members outliving the group — with their original failing evidence, the
measured performance at 500, 10,000 and 100,000 approvals with **all twenty-six workloads within
budget at every tier**, the query plans, the ten verified races, the locked tally arithmetic, the
carried-forward debt register and the twenty-four `NOT VERIFIED` capabilities are in
[`verification/phase-16b-final-report.md`](verification/phase-16b-final-report.md). The Definition of
Ready for what follows, its six contradictions and its fourteen blocking decisions are in
[`verification/phase-16c-plan.md`](verification/phase-16c-plan.md).

Phase 16C completed on 2026-08-18: **routing resolution** — one additive migration, five columns, no
new table, no new index, no new route, no new permission and no new screen. A step can now route to
**the requester's manager**, and a step can carry **a service-level target**. Nothing else was added,
and two capabilities the 16B record had named as 16C's were *decided against* rather than deferred:
approval expiry is **observed and derived, never written** (D-16C-06) and escalation is defined as a
future bounded command that adds an approver (D-16C-07), so neither adds a domain state and the phase
reduces to those two things. **The manager is resolved once, when the approval starts**, by composing
three published contracts across two modules — the requester's primary employment, the primary
reporting line in force on that day, and who actually holds the manager's employment — and the answer
is copied onto the running step. A **manager template names nobody**: whose manager it means is the
requester, fixed rather than configured, and the database enforces it — a template may say `manager`
and a running step may not, because the kind is resolved into a person before anybody is asked. So a
running approval still names a concrete membership and depends on no live organizational lookup, which
is 16B's invariant preserved rather than a happy accident: a reporting line that moves afterwards does
not move a running approval, and the *next* approval reaches the new manager. **Five outcomes fail
closed** and none silently skips a configured approver — no primary employment, no manager on the
primary line, nobody holds the manager's employment, **two or more people hold it**, or the requester
turns out to be their own manager. That fourth is kept distinct from the third deliberately: one means
nobody holds the job and the other means two do, they are opposite problems for different people to
fix, and there is **no rule for choosing between two candidates** — no ordering, no `is_primary`, no
first-of, no fallback. **This is still not a directory.** Identity gained two narrow queries on a
permission it already had, `identity.membership.read` was **not** granted, and nothing enumerates
memberships, resolves a role, reads an organization chart or traverses more than one level. A
**service level is elapsed time in whole hours or days** (D-16C-05) — never business days, because
Workflow holds no calendar and the approval declined an Organization dependency for one — configured
on the template, copied onto the step, counted from the instant **that step** became awaiting, so each
step of a parallel branch starts its own clock and nothing restarts one. **Due-ness, state and overdue
minutes are derived on every read** from the target, that instant and an explicit reading instant the
caller supplies, and **stored nowhere**: there is no `due_at`, no `expired`, no `breached` and no
escalation column, because a stored due time would be a second record able to disagree with its own
inputs and a stored `expired` would need something to write it — a scheduler this phase does not have
or a synthetic actor ADR-0045 refuses. Exactly at the target is **within** it, a step three seconds
past is overdue by **zero** minutes, and every number is a truncated integer. **Nothing was scheduled,
escalated, expired, notified, measured or routed to a role**: `JobPort` still has no adapter anywhere.
Twenty-two capabilities remain `NOT VERIFIED`, none with a placeholder anywhere, and two left that
list by delivery rather than by attrition. **No production defect was found by the closing audit** —
its findings were two benchmark defects and three test-coverage gaps, all fixed or closed within it.
The manager chain end to end, the five refusals, the boundary arithmetic, the three cross-module query
plans (which no module had ever planned), the measured performance at 500, 10,000 and 100,000
approvals with **one workload missing its budget** — the tier C unfiltered instance listing at 124 ms,
carried from 16B where it measured 91.4 ms and unaffected by this phase — the carried-forward debt
register and the twenty-two `NOT VERIFIED` capabilities are in
[`verification/phase-16c-final-report.md`](verification/phase-16c-final-report.md). The Definition of
Ready for what follows, its fourteen contradictions and its blocking decisions are in
[`verification/phase-16d-plan.md`](verification/phase-16d-plan.md).

Phase 16D completed on 2026-08-19: **escalation** — one additive migration, one nullable column, one
partial unique index, one history event, one command, one route, one permission and one column on one
screen. It is a much smaller phase than its name promised, and deliberately so: 16D opened as *Time in
Workflow* — escalation, expiry, business days, scheduled execution — and its Definition of Ready found
that most of that was **already delivered by 16C, decided against, or blocked on infrastructure nobody
owns**, and stopped on three conditions before any code was written. What survived approval is one
capability: **a person adds an approver to a branch that is stuck**. **Nothing escalates by itself** —
there is no scheduler, no timer, no `JobPort` consumer and no automatic trigger of any kind, and the
command exists only at the end of a request somebody made. **Escalation adds; it never replaces.**
Nobody is removed, no recorded decision is touched, no clock restarts, and the target the branch was
given is the target it keeps — which is why the locked 16B denominator survives untouched: the
snapshotted assigned set is filtered by a marker on the row, so a branch of three that gains a fourth
approver still needs two approvals and not three (D-16D-08, never reopened). **`unanimous` refuses
escalation by name**, because for that rule the threshold *is* the denominator and the only two ways
to proceed were to let a branch complete while an assigned approver had never answered, or to move
the denominator; the approval rejected both. **Eight refusals, each its own name** — three about the
branch and five about the person — because each sends a different person to fix a different thing.
Two of the five were found by asking whether rules the module already held applied here: **the
requester may not be asked to approve their own request** (D-16D-13) and **an approver already
terminal on the same instance may not be asked again** (D-16D-14, where `skipped` is deliberately
*not* terminal — a skipped step means the person never had a say). Neither needed a query: the
command already loads every step of the instance. The seventh rule did need one, and it is the only
fact in the phase that Workflow does not own: **a membership must be able to act**. Identity gained
**one narrow query** on a permission it already had — `identity.membership-standing`, one identifier
in, `{ active: boolean }` out — reached through a bounded service grant (ADR-0043) that names exactly
`identity.membership.read`, which **no user holds**. It publishes the predicate rather than the status
on purpose: Identity owns what "acting" means, and returning the raw status would have put a second
definition of it in another module. A membership belonging to another tenant is **indistinguishable
from one that never existed**, so an identifier is not a probe. **What a step now publishes is that it
was escalated, never when, by whom or why**: `escalated: boolean` and nothing else, with the timestamp
staying in the database and the actor staying in the timeline where a permission decides who reads it.
The Admin screen gained **one column** and remains read-only. **Escalation is reachable through the
API and not from the portal**, and that is a decision rather than an omission: Admin authentication is
Platform's under ADR-0001 and ADR-0019 and was confirmed **outside this phase** (D-16D-10), and no
candidate list exists to pick from because none was approved (D-16D-16). Twenty-three capabilities
remain `NOT VERIFIED`, none with a placeholder anywhere. **No production defect was found** by the
closing audit; its one finding was a stale sentence in a comment, carried as debt. The eight refusals,
the eleven approved decisions and the four that remain open, the bounded Identity contract, the
concurrency protection, the tenancy proofs under an unprivileged role, the recomputed scope and the
twenty-three `NOT VERIFIED` capabilities are in
[`verification/phase-16d-final-report.md`](verification/phase-16d-final-report.md).

Phase 16E completed on 2026-08-21: **automatic execution** — one additive migration, one history
event, one command, one query, one permission, one kernel context and **no scheduler**. It answers the
question 16D left open: may Workflow act with no human at the other end of a request? The answer is
one action, named by the owner and nothing wider — **an automatic service-level reminder**. Automatic
escalation was evaluated first and **declined as structurally impossible**: `escalateBranch` takes the
approver to add as an input, so a machine could only supply one by choosing a person, and there is no
rule anywhere in the module for choosing one. The phase opened with **nine decisions `OPEN` and zero
production changes**, and they stayed `OPEN` across three separate instructions that described them
without approving them — recorded as `OPEN` rather than read as approval. Implementation then stopped
on **eight contract gaps** before any code was written, of which two are still withheld: **no expiry
action has been named** (G-6), and business days were never required so the Organization calendar
contract **stays unopened** (G-7). **Nothing schedules anything.** There is no cron, worker, polling
loop, queue consumer, broker, outbox or timer in this repository, and no `JobPort` adapter — the
interface has existed since Phase 0 and still has none. Execution ownership is **Platform's**
(D-16E-03), and the contract Platform must satisfy is written down rather than negotiable:
[`verification/phase-16e-platform-runner-contract.md`](verification/phase-16e-platform-runner-contract.md).
**No synthetic actor was invented to make any of it work.** A machine runs under a third
`ExecutionContext` member — `MachineContext`, carrying the tenant the platform set, an execution
identity, a correlation and no membership at all — and `currentMembershipId()` returns `undefined`
under it *structurally*, so an automatic entry cannot name a human even by mistake: both actor columns
are null and a check constraint refuses a row that names both an approver and an execution.
**Idempotency is the database's**, not a preceding read's: `workflow_history_reminder_idx` is a partial
unique index and the history row **is** the claim, because a `select` followed by an `insert` is not
idempotent under concurrency (ADR-0071) — proved with two real connections overlapping in time, no
sleeps, exactly one commit. **Identity gained one narrow query**, `identity.membership-recipient`, on
the permission it already had and reached through the same bounded service grant 16D used; **no new
Identity permission was created**. The reminder emits **notification intent and delivers nothing** —
delivery is Phase 17's. The phase's last discovery was that the reminder was **executable and not
discoverable**: nothing published could tell a runner *which* steps were due, so `workflow.remind-step`
could be invoked and had nothing to invoke it with. That gap was opened as D-16E-14, approved, and
closed by **`workflow.due-reminders`** — two identifiers per row, no tenant field, no person, no HTTP
route, clamped and cursor-paged, declaring the same machine-only permission the command holds so that
discovering the work and doing it are one capability held by one principal. A discovered row is a
**candidate, not a claim**. **Nothing is operational**: every part of the capability is built, verified
and merged, and nothing invokes it, because the durable job runner is Platform's and does not exist.
The closure audit, the fourteen approved decisions, the two that remain withheld, the tenancy and
concurrency proofs and the precise Platform handover are in
[`verification/phase-16e-final-report.md`](verification/phase-16e-final-report.md).

Notification delivery is Phase 17's and analytics is Phase 20's, by those phases' own
specifications; a durable job runner for the kernel's `JobPort` — which has existed as an interface
since Phase 0 and has never had an adapter — **is owned by no phase in this repository**, and
Phase 16E assigned it to Platform rather than building one here.

Phase 5.2 planning opened on 2026-08-22, the first phase after Workflow and a deliberate return from
cross-cutting infrastructure to core product. Its Definition of Ready is in
[`verification/phase-5.2-plan.md`](verification/phase-5.2-plan.md) and its decision register — fourteen
entries, **all `OPEN`** — in [`verification/phase-5.2-register.md`](verification/phase-5.2-register.md).
**No code, schema, migration, permission or route was written.** Its prerequisites (*"Phases 0 through
5, plus Phases 4.1 and 5.1"*) were each verified against the modules rather than against this ledger.
Two of the specification's acceptance criteria **cannot be fully met in this repository today** and are
recorded as such rather than approximated: categories *"constrained by the country pack"* — the
`country-packs` package is a bootstrapped shell that *"deliberately exports nothing yet"* until Phase
11.1 — and the `WarningExpired` event, which would need the durable job runner Phase 16E assigned to
Platform. Neither is worked around: the first follows the `source`-discriminator precedent Attendance
and Leave already set, and the second keeps expiry **derived at read time**, with no `expired` column
and nothing that fires. Six decisions block the first checkpoint, all six are Work-owned, and each is a
choice between options this repository has already exercised.

Phase 5.2 Checkpoint 1 landed on 2026-08-22: **Employee Relations** — one new module, three tables,
one additive migration, three commands, three queries and **four** permissions. It is the first
capability of the domain and deliberately the smallest real one: a tenant defines the violation types
its disciplinary policy recognises, and an authorized user records that one occurred, against an
**employment** and never a person (AD-001). **The record is immutable at the database** — update and
delete both raise, from any path including a direct `psql` session, because AD-003 says these records
are evidence in a labour dispute and a guard that lives only in TypeScript holds until somebody opens
a shell. **Every read of a violation is audited** and every read of the *catalogue* is not: a
disciplinary record names somebody, a catalogue names nobody, and auditing both would be the
audit-every-query mechanism the approval forbade. The trail carries who looked at which record and
**nothing about the matter** — no employment, no category, no description — because copying those in
would make the audit table a second, less-guarded copy of what it audits. **The category is referenced
*and* frozen**: a violation keeps the code and severity the catalogue carried at the moment of
recording, so renaming or re-grading an entry two years later cannot rewrite what an old record meant.
**`severity` is a word the tenant chooses**, deliberately not a closed set, and nothing orders by it —
ordering is a persisted integer. **Nothing statutory ships**, for any jurisdiction: the country-pack
boundary is recorded with the same `source` discriminator and nullable pack columns Attendance and
Leave already carry, and **legal enforcement is `NOT VERIFIED` until Phase 11.1**, which means a tenant
can today configure a ladder its country's law would not permit and nothing will stop it. Expiry stays
**derived** — no `expired` column, no sweep, no timer — and the specification's `WarningExpired` event
is not emitted, because the durable job runner is Platform's. **Nothing else in the phase was built**:
no investigations, actions, warnings, grievances, appeals, evidence, penalties or Admin screens, and a
sixty-three-assertion negative-space suite proves each absence against the module's own source rather
than promising it. Three defects the tests caught before the gate, and two assertions narrowed from
substrings to concepts, are recorded in
[`verification/phase-5.2-checkpoint-1.md`](verification/phase-5.2-checkpoint-1.md) alongside the
schema, the RLS proofs under an unprivileged role, the concurrency proof and the eight decisions that
remain `OPEN`.

Phase 5.2 Checkpoint 2 landed on 2026-08-23: **investigations and the Relations case lifecycle** —
two tables, two commands, three reads, and no new permission. The Checkpoint 2 investigation had
found that the lifecycle *cannot* advance by updating `relation_violation`, because Checkpoint 1 made
that row trigger-immutable with its `state` CHECK locked to `'reported'`; the owner resolved it
(D-5.2-15) by keeping the violation exactly as it was and putting the case's movement in its own
append-only table. **Where a case is, is derived and stored nowhere** (D-5.2-16) — the latest
transition's destination, with no `current_state` column, no projection and no state-machine engine;
the whole state machine is nine lines of data. Transitions are validated against the state the
**server** derives from persisted history rather than one a caller supplies, every transition carries
actor, server timestamp and a required reason, the history is unconditionally immutable and an
investigation becomes immutable the moment it concludes — the conditional trigger `letter_template_version`
established, asserted in **both** directions. Concurrency is settled by a unique sequence per case and
a partial unique index for the one open inquiry, both proved with **two real PostgreSQL connections
contending**, no sleeps and no timing assumptions. The one new cross-module dependency reuses
Identity's existing `membership-standing` predicate under a bounded grant, so an investigator is
verified without this module learning a name. Two decisions the implementation surfaced — separate
investigation permissions, and how a concluded investigation is corrected — were **recorded as open,
not taken**. [`verification/phase-5.2-checkpoint-2.md`](verification/phase-5.2-checkpoint-2.md)
carries the schema, the proofs, the five Checkpoint 1 assertions that were updated and why none was
weakened, and four stated limitations.

**First commercial milestone** — Phases 0 through 11.2 deliver a sellable product: core HR,
documents, letters, employee relations, assets, recruitment, onboarding, attendance, leave,
compensation, loans, payroll with statutory country packs, and offboarding with final
settlement. Phases 12 onward are increments on a product that already runs a compliant payroll.
