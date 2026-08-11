# Phase 13 — Performance, Competencies & Goals — Definition of Ready

**Status** Planning · **Date** 2026-08-11 · **Baseline** Phase 12 at `c1a813b` · **Specification**
`work prompts/14_PHASE_13_PERFORMANCE.md` (v1.0, Approved)

This is a planning checkpoint. **No code, no migration, no model.** The only artefact is this file.

---

## 1. Scope

The approved specification names **seventeen aggregate roots**. Taken literally that is the largest
phase in this repository by a wide margin — Payroll, the largest so far, had fourteen tables and one
aggregate family. This plan takes the specification as the intended scope and states plainly where
it is too large to build at once (§30, D-30).

What the specification assigns to Phase 13:

| Area | Specification source |
| --- | --- |
| Goal, Goal Category, Objective, Key Result | Scope; "Goals" section (corporate/department/team/individual, weighted, SMART, OKR) |
| Competency Framework, Competency | Scope; AD-003 (tenant configurable); "Competencies" (technical, leadership, behavioural, functional, compliance, custom) |
| Review Cycle, Review Template, Reviewer Assignment | Scope; "Review Cycles" (quarterly, semiannual, annual, probation, ad-hoc) |
| Performance Review, Self Assessment, Manager Assessment, Peer Assessment | Scope; AD-006 (self, manager, peer, 360°, committee — tenant configurable) |
| Calibration Session | Scope; "Performance Lifecycle" places calibration before completion |
| Talent classification (nine-box) | "Talent Classification" — **explicitly in scope**, configurable matrix, nine-box by default |
| Feedback (continuous) | Scope; "Continuous Feedback" (recognition, coaching, constructive, private notes) |
| One-to-One Meeting | Scope; "One-to-One Meetings" |
| Performance Improvement Plan | Scope; "Performance Improvement Plans" |
| Performance Summary Projection | Scope; "High-Level Model" |
| Audit, History, Import, Export, REST API, Administration UI, Testing, Documentation | Scope |

**Nine-box and 360° are in scope.** Both were candidates for deferral, and the specification settles
both explicitly rather than by implication: "Talent Classification" is a section of its own, and
AD-006 lists 360° among the review methods a tenant may configure. §25 and §14 of the brief asked
that each be decided rather than assumed; this is the decision, and its evidence.

---

## 2. Explicit non-scope

From the specification's own "Non Goals", and from the repository's ownership register:

| Excluded | Owner | Evidence |
| --- | --- | --- |
| Salary changes, promotions, employment decisions | Compensation, Employment | Non Goals; AD-005 — "Performance publishes recommendations only" |
| Payroll | `payroll` | Non Goals |
| Learning, training, certification, accreditation | `learning`, Phase 14 | Non Goals; `person-capability.ts`: "Learning (Phase 14) owns assessment, accreditation and the evidence behind a rating" |
| Succession, career paths, nine-box *consumption* | `career`, Phase 15 | Non Goals; DOMAIN_OWNERSHIP row "Career path, succession plan → `career` → Phase 15"; the matrix is "published to Career & Succession as a recommendation" |
| Workflow engine | `workflow`, Phase 16 | Non Goals |
| Notification engine | `communications`, Phase 17 | Non Goals |
| Disciplinary actions, warnings, grievances | `relations`, Phase 5.2 | "Performance does NOT own disciplinary actions"; ROADMAP_ANALYSIS: "disciplinary actions… explicitly excluded from Performance" |
| **Engagement and satisfaction surveys** | `engagement`, **Phase 13.1** | DOMAIN_OWNERSHIP row "Survey, response, engagement score → `engagement` → Phase 13.1"; a separate specification exists at `work prompts/14A_PHASE_13.1_ENGAGEMENT_SURVEYS.md` |

§26 of the brief asked whether employee satisfaction belongs here. **It does not**, and the evidence
is a separate approved specification and a separate roadmap row. No survey, no questionnaire
infrastructure and no engagement score is built in Phase 13. The one place this needs care is 360°
feedback, which *does* need a questionnaire-shaped structure — see D-12.

---

## 3. Existing repository state

Inspected before planning, per §1 of the brief.

### 3.1 No performance domain exists

`packages/modules/` holds thirteen modules; none is `performance`, `competency`, `goal` or
`feedback`. Searching the whole source tree for `appraisal`, `competenc`, `goal`, `objective`,
`KPI` and `calibrat` returns **zero hits**. There is nothing to reconcile with and nothing to
migrate.

### 3.2 Four places already reserve Phase 13's territory — and one narrows it

| Location | What it says |
| --- | --- |
| `packages/modules/people/src/domain/person-capability.ts` | "These are self-declared claims, **not assessments**. Learning (Phase 14) owns assessment, accreditation and the evidence behind a rating; **Performance (Phase 13) owns whether somebody is good at their job**." |
| `packages/modules/organization/src/domain/organization-vocabulary.ts` | Position criticality is "consumed by Career & Succession in Phase 15" |
| `docs/DOMAIN_OWNERSHIP.md` | "Goal, review, rating → `performance` → Phase 13" |
| `docs/ROADMAP_ANALYSIS.md` | Disciplinary actions "explicitly excluded from Performance" |

The People comment is the sharpest constraint in the repository for this phase, and it cuts a line
the specification does not draw: **People owns self-declared skill claims, Learning owns assessment
of capability, and Performance owns assessment of *job performance*.** A competency assessment sits
uncomfortably between the second and the third. See D-9 — this is the single most consequential
boundary question in the phase.

### 3.3 An existing `feedback` concept, owned by Recruitment

`InterviewFeedbackState` in `packages/modules/recruitment/src/domain/interview.ts`: an interview
feedback record with an **integer 1–5 score**, a recommendation, strengths and concerns, submitted
by an `interviewerEmploymentId`. Commands `SubmitFeedbackCommand`, stores `FeedbackStore`, rows
`FeedbackRow`, views `FeedbackView`.

Two consequences. Phase 13's continuous feedback and peer feedback must not be *called* `feedback`
without qualification anywhere a reader could confuse the two, and the 1–5 integer score is an
existing in-repository precedent for a rating scale that D-7 should not contradict without reason.

### 3.4 `grade` already means two different things

§12 of the brief warned about one collision. There are **two**, and a third would be worse than
either:

| Existing | Meaning |
| --- | --- |
| `PositionView.grade` (Organization) | A job grade label on a position |
| `compensation_pay_grade` (Compensation) | A pay grade inside a salary structure, with scales and steps |

A third generic `grade` in Performance would make "what grade is this employee" ambiguous across
three modules. D-7 proposes avoiding the word entirely.

### 3.5 Ports: what exists, and what it is worth

| Port | Status | Assessment |
| --- | --- | --- |
| `ApprovalPort` | **EXISTS · ADAPTER EXISTS · NOT SUITABLE** | The only adapter is `AutoApprovingPort`, which approves everything as `system:auto-approval`. Compensation, Payroll, Recruitment, Leave and Letters each refused it for human decisions and recorded decisions in their own table. Phase 13 follows them (D-15) |
| `NotificationPort` | **EXISTS · ADAPTER EXISTS · NOT SUITABLE for delivery** | `RecordingNotificationPort` records; it does not deliver. Intent and delivery must stay separate (D-21) |
| `DocumentPort` | **EXISTS · CONTRACT ONLY · UNUSED** | No implementer anywhere. Phase 12 built against `StoragePort`'s shape instead and left `DocumentPort` alone (Phase 12 D-3) |
| `StoragePort` | **EXISTS · CONTRACT ONLY** | No implementer. Phase 12 shipped `storageUnavailable` rather than a fake |
| `JobPort` | **EXISTS · CONTRACT ONLY** | No adapter. Nothing scheduled runs in this product (D-22) |
| `SearchPort` | **EXISTS · CONTRACT ONLY · UNUSED** | Considered and rejected in Phase 12 D-21 in favour of indexed predicates |
| `DisclosurePort` | **EXISTS · ADAPTER EXISTS** | People's identifier-digest adapter. Relevant only if Performance discloses identifiers, which it should not |
| Identity / tenant context | **EXISTS · ADAPTER EXISTS** | `runInContext`, `currentTenantId`, `currentContext`, `GrantAwarePermissionChecker` |
| Bounded service grant | **EXISTS · ADAPTER EXISTS** | ADR-0043. Six adapters in Phase 12 alone |
| Localization | **EXISTS** | Per-module `locales/{en,ar}.json`, gated by `check-localization` (13 sets) |
| Audit / soft delete / optimistic concurrency | **EXISTS** | `Repository` base, `auditForInsert`/`auditForUpdate`, `version = version + 1` |
| Numbering | **EXISTS** | Per-module tenant-scoped `*_number_sequence` keyed by `series_key`. Never a PostgreSQL sequence (ADR-0039) |
| Events | **EXISTS · at-most-once, post-commit, no outbox** | ADR-0064's consequence: correctness never depends on delivery |
| Persistence | **EXISTS** | `PostgresUnitOfWork`, RLS applied by the creating migration (ADR-0030), `Repository` base, the eight-times-copied `row-writer.ts` |

**No port is usable merely because it exists.** Three of the seven have no adapter at all, and two
of the remaining four have adapters that would be dishonest to consume for a human decision.

### 3.6 Self-service routing still does not exist

Identity holds `employment_link` and an `employmentLinkManage` permission, but there is no path
from an authenticated principal to *their own* employment. Every module since Phase 8 declares a
`*.read-own` permission and enforces it nowhere (ADR-0032). Phase 13 needs this more than any module
before it — "My Goals" and "My Review" are the primary employee-facing screens — and cannot have it.
See D-23.

### 3.7 Documentation note

The brief asks for `docs/ARCHITECTURE.md`. The file is at **`docs/foundation/architecture.md`**; its
"Invariants the database enforces" section now records five business triggers (one Payroll, four
Phase 12) and the bar for adding another. `docs/PHASES.md` has no Phase 13 entry yet, as expected.

---

## 4. Domain ownership

Performance owns **evaluation**. It owns nothing about the employment relationship, the person, the
organization, pay, or learning.

| Concept | Owner | How Performance reaches it |
| --- | --- | --- |
| Person identity | `people` | **Never directly** (AD-001). Performance references Employment |
| Employment, manager, assignment | `employment` | Published contracts under a bounded service grant |
| Unit, position, legal entity | `organization` | Published contracts |
| Pay, pay grade | `compensation` | Not read at all in this phase — a performance review must not display a salary |
| Evidence documents | `documents` | Reference only (D-24) |
| Self-declared skills | `people` | Not read. A claim is not an assessment (§3.2) |
| Capability assessment, certification | `learning` (Phase 14) | Does not exist yet (D-9) |

**Performance writes to no other module.** AD-005 is explicit, and this repository has enforced the
same rule since Phase 6: the dependency points one way, and Performance publishes outcomes that
Compensation, Learning and Career may pull.

---

## 5. Aggregate design

§3 of the brief asked that the four candidate domains be evaluated explicitly rather than merged
silently. The evaluation:

| Candidate | Verdict | Reasoning |
| --- | --- | --- |
| Goals | **Separate aggregate, same module** | A goal outlives a review cycle: an annual goal is assessed by a quarterly review and still exists afterwards. Making a goal a child of a review would make it un-referenceable between cycles |
| Competencies | **Separate aggregate, same module** | A framework is configuration with its own lifecycle, like a document type or a letter template. It is defined once and referenced by many cycles |
| Review cycle and review | **Two aggregates, same module** | A cycle is a container with its own lifecycle; a review is one employment's instance within it. Payroll's period/run pair is the exact precedent |
| Assessments (self, manager, peer) | **Separate aggregates under review** | See D-10 — this is the decision, not a foregone conclusion |
| 360° feedback | **Same module, distinct aggregate family** | See D-2 |
| Continuous feedback, one-to-ones, PIPs | **Same module, separate aggregates** | Each has its own lifecycle and none is a child of a review |

**One module, `@work/performance`.** Not because everything is one domain — it plainly is not — but
because the alternative is worse in this specific case. Phase 12 split Documents and Letters because
Letters depends on Documents' *concepts* and none of its tables. Here, goals, competencies, reviews
and calibration all read and write **the same review's score**, so a split would produce
cross-module writes, which this architecture forbids.

The internal boundaries are enforced by aggregate design and lint rules rather than by package
boundaries. **If review reaches the file-count where Payroll needed splitting, that is a signal to
revisit — recorded, not pre-empted.**

---

## 6. Entity / table inventory

Provisional and subject to the decision register. Every table tenant-scoped, every one carrying the
standard audit, soft-delete and `version` columns, every one protected by `app_protect_table`.

**Configuration (7)** — `performance_rating_scale`, `performance_rating_level`,
`performance_competency_framework`, `performance_competency`, `performance_competency_level`,
`performance_goal_category`, `performance_review_template`.

**Goals (4)** — `performance_goal`, `performance_objective`, `performance_key_result`,
`performance_goal_progress`.

**Cycle and review (5)** — `performance_cycle`, `performance_review`,
`performance_reviewer_assignment`, `performance_assessment`, `performance_assessment_item`.

**Calibration and classification (3)** — `performance_calibration_session`,
`performance_calibration_decision`, `performance_talent_placement`.

**Continuous (4)** — `performance_feedback`, `performance_one_to_one`,
`performance_one_to_one_action`, `performance_improvement_plan` (+ its milestones —
`performance_improvement_action`).

**Snapshot (1)** — `performance_review_snapshot`, holding what §15 requires.

**≈ 25 tables.** That is nearly twice Payroll's fourteen, in one phase. See D-30.

---

## 7. Lifecycle / state machines

The specification gives a *flow*, not a state list. §5 of the brief forbids inventing states, so
each machine below is derived from the specification's own words and any gap is raised as a
decision.

**Review cycle** — the specification says "Scheduled evaluation period" and lists cycle kinds, and
gives no states. **D-3 raises this.** Proposed, following Payroll's period/run precedent:
`draft → open → in_progress → calibration → closed`, with `cancelled` reachable before `closed`.

**Performance review** — derived from "Performance Lifecycle": self assessment → manager review →
peer review (optional) → calibration → completed → archived. Proposed:
`pending → self_assessment → manager_assessment → peer_assessment → calibration → completed → archived`,
with `completed` immutable (AD-004).

**Goal** — derived from "Goal Created → Goal Approved → Execution": `draft → approved → active →
achieved | missed | cancelled`. The specification's "Goal Approved" implies a human decision; D-15
covers who makes it.

**Assessment** — `draft → submitted`, and submitted is immutable (D-10, D-16).

**Calibration session** — `scheduled → in_session → concluded`.

**PIP** — `draft → active → completed | failed | cancelled`.

Every transition auditable, per the specification. Transition tables as data rather than `switch`
statements, following every module since Phase 8: a reader sees every permitted move at once, and a
move nobody listed is refused by default.

---

## 8. Commands (indicative)

`performance.define-rating-scale`, `performance.define-framework`, `performance.define-competency`,
`performance.define-template`, `performance.define-goal-category`; `performance.create-goal`,
`performance.approve-goal`, `performance.update-goal-progress`, `performance.close-goal`;
`performance.open-cycle`, `performance.move-cycle`, `performance.enrol-participants`,
`performance.assign-reviewer`; `performance.submit-assessment`, `performance.request-peer-feedback`,
`performance.submit-peer-feedback`; `performance.open-calibration`,
`performance.record-calibration-decision`, `performance.conclude-calibration`;
`performance.complete-review`, `performance.record-placement`; `performance.give-feedback`,
`performance.record-one-to-one`, `performance.open-pip`, `performance.move-pip`.

Note what is **absent**: no command changes a salary, a position, an employment status or a
learning record.

## 9. Queries (indicative)

`performance.rating-scales`, `performance.frameworks`, `performance.templates`,
`performance.goals` (bounded, filtered), `performance.read-goal`, `performance.cycles`,
`performance.read-cycle`, `performance.reviews` (the manager queue), `performance.read-review`,
`performance.my-review` (**`NOT VERIFIED`** — D-23), `performance.calibration-queue`,
`performance.talent-matrix`, `performance.feedback`, `performance.one-to-ones`, `performance.pips`,
`performance.summary`, `performance.reconciliation`.

Every collection bounded: default 50, maximum 200, as every module since Payroll.

---

## 10. Permissions

Provisional, and deliberately more granular than any module before it because performance data is
more sensitive than most:

`performance.configure` (scales, frameworks, templates, categories) ·
`performance.goal.read` · `performance.goal.manage` · `performance.goal.read-team` ·
`performance.cycle.manage` ·
`performance.review.read-own` (**declared, enforced nowhere** — D-23) ·
`performance.review.read-team` · `performance.review.read-all` ·
`performance.assess` · `performance.assess-peer` ·
`performance.calibrate` · `performance.complete` ·
`performance.feedback.give` · `performance.feedback.read-about-self` ·
`performance.pip.manage` · `performance.summary.read`.

**`read-team` and `read-all` are separate on purpose.** A manager reading their own reports is a
different capability from HR reading the organization, and one permission covering both is how a
manager comes to read a peer's review.

---

## 11. Cross-module contracts

Per §37, each dependency documented as producer / contract / consumer / grant / failure /
reconciliation.

| Producer | Contract | Grant | Failure behaviour | Reconciliation |
| --- | --- | --- | --- | --- |
| Employment | `employment.read-employment` | `employment.employment.read` | Refuse the operation. An employment that cannot be confirmed is not a participant | Cycle enrolment is re-runnable |
| Employment | `employment.read-employment` → `assignment`, `managerEmploymentId` | same | Refuse. A review with no resolvable reviewer is not assignable | Reviewer assignment is a query somebody re-runs |
| Employment | `employment.search` | same | Refuse enrolment | Bounded, cursor-paged as Payroll does |
| Organization | `organization.governing-legal-entity` | `organization.legal-entity.read` | Refuse if placement is required for the snapshot | Pull |
| Organization | `organization.list-positions` | `organization.position.read` | Only needed if competencies attach to positions (D-8) | Pull |
| People | — | — | **Not read.** AD-001. A review displays an employment, and a screen that wants a name asks People itself | — |
| Documents | `documents.create-document` / `documents.search` | `document.read`, `document.manage` | Evidence is optional; absence is not a failure | Pull |
| Compensation, Payroll | — | — | **Not read.** A performance review must not display pay | — |

**One contract does not exist and is needed.** "Who are this employment's direct reports" — the
manager review queue's central question. `ReportingLineView` exists and `EmploymentView` carries
`managerEmploymentId`, but there is no published query that takes a manager and returns their
reports. **D-31 raises it.**

---

## 12. RLS strategy

Every table `call app_protect_table(...)` in the creating migration (ADR-0030). Integration suites
connect as a role owning nothing and holding no `BYPASSRLS`, following Phase 12 exactly.

Beyond tenant isolation, this phase needs a second axis the repository has not needed before:
**employee A must not read employee B's review**, and that is *not* a tenant property. RLS cannot
express it — the policy would need to know the caller's employment, and there is no
principal-to-employment resolution (§3.6). **It is therefore an application-layer guarantee, and
the plan must say so rather than implying the database enforces it.** See §23 and D-23.

## 13. Concurrency strategy

Races to settle at the database, per §34:

| Race | Constraint |
| --- | --- |
| Two submissions of the same assessment | Unique `(tenant_id, review_id, assessor_employment_id, assessment_kind)` |
| Two managers completing one review | Optimistic `version` + a unique partial index on the completed state |
| Concurrent goal progress updates | Optimistic `version` on the goal; progress rows insert-only |
| Concurrent cycle closure | Optimistic `version` on the cycle |
| Duplicate peer-feedback submission | Unique `(tenant_id, review_id, reviewer_employment_id)` |
| Duplicate reviewer assignment | Unique `(tenant_id, review_id, reviewer_employment_id, role)` |
| Two calibration decisions on one review | Unique `(tenant_id, session_id, review_id)` |
| Duplicate participant enrolment | Unique `(tenant_id, cycle_id, employment_id)` |

Every one asserted with **two real transactions on two real connections**, as Phase 12 did.

## 14. Immutability strategy

AD-004: reviews are immutable after completion; corrections create new versions.

| Artefact | Immutable from | Enforced at |
| --- | --- | --- |
| Submitted assessment | Submission | Domain + application + **database** (D-16) |
| Peer feedback response | Submission | Domain + application + database |
| Completed review and its final rating | Completion | Domain + application + **database** |
| Calibration decision | Recording | Domain + application + database |
| Closed cycle | Closure | Domain + application |
| Goal progress entry | Insert | Insert-only store, no update method |

Phase 12's lesson applies directly and is worth stating before any trigger is written: **a trigger
that refuses too much is as much a defect as one that refuses too little**, and both are found by
asserting the permitted case alongside the refusals. See D-16.

## 15. Historical reproducibility

Per §23, what a completed review must survive: a manager change, a department move, a competency
redefinition, a rating-scale change, a goal redefinition, a position change.

**Snapshot at completion**, following ADR-0064: the reviewer identities and their roles, the
manager-at-review-time, the organizational placement (unit, position, legal entity), the rating
scale and its levels, the competency framework version and each competency's definition, each
goal's definition and weight, and every component score with its arithmetic.

**Do not snapshot**: the person's name, any pay figure, anything not used in the calculation. Phase
11's discipline applies — a snapshot is the inputs to a decision, not a copy of the database.

## 16. Scoring / calculation semantics

**The specification defines no formula.** It says goals are weighted and competencies are assessed,
and stops. §24 of the brief forbids inventing one. **D-5, D-6 and D-7 raise the whole of this**, and
until they are decided the phase cannot be built.

What the plan does commit to regardless of the formula chosen: **no floating-point arithmetic.**
Weights and scores as integers in a fixed minor unit — basis points for weights, hundredths for
scores — exactly as ADR-0061 established for money. A percentage stored as a `double` is a
percentage that does not add to 100.

## 17. Localization

`packages/modules/performance/locales/{en,ar}.json`, gated by `check-localization` (14th set).
Translated: review status, assessment status, goal status, cycle kind, competency category, rating
level *labels where the tenant has not supplied them*, feedback kind, PIP status, validation errors,
Problem Details titles. **Not translated**: tenant-authored competency names, goal titles, rating
scale labels a customer wrote, template bodies. RTL follows language, never a separate control.

## 18. API plan

`@nestjs/common` + `@nestjs/swagger` controllers inside the module's `api/` directory, registered by
an `apps/api` Nest module, dispatching through the shared pipeline — the Phase 11/12 shape exactly.
Controllers ordered so literal segments precede parameter segments, asserted by test rather than
comment. DTOs with `class-validator`; Problem Details from the global filter; 404-not-403 wherever
confirming existence is itself a disclosure. **No Prisma model is exposed.** No route accepts an
employment identifier that the caller's permission does not already cover — §28's IDOR requirement,
and the reason `read-team` and `read-all` are separate.

## 19. Admin UI plan

`/performance` in the admin workspace, consuming the API only. Sections: cycles, goals, the manager
review queue, one review, competency frameworks, rating scales, calibration, talent matrix, PIPs.
**No screen is built for a capability marked `NOT VERIFIED`** — no self-service "My Review", no
notification settings, no scheduled-reminder configuration.

## 20. Self-service plan

"My Goals" and "My Review" are the two screens an employee actually wants, and **neither can be
built honestly today**. There is no authenticated-principal-to-employment resolution, and accepting
an employment identifier from the client would let anybody read anybody's review by changing a
number in a URL. `performance.review.read-own` and `performance.goal.read` are declared; the routing
is **`NOT VERIFIED`**. See D-23.

## 21. Event / reconciliation strategy

Following ADR-0064 and every module since: **correctness never depends on an event arriving.**
Performance publishes outcome events as accelerators, and every question it needs answered is a
pull. Reconciliation queries: reviews whose assessments are incomplete past the cycle's due date,
cycles whose participants no longer hold an active employment, reviews completed without a
calibration where the template required one, placements whose ratings no longer match their review,
goals whose weights do not total the configured target. **Reconciliation reports; it repairs
nothing.** No outbox.

## 22. Performance strategy

Benchmarked against real PostgreSQL as an unprivileged role, at 10,000 and 100,000 employments with
a full annual cycle. Measured separately: the manager review queue, goals by employment, goals by
cycle, cycle participant enrolment, competency assessment read, calibration queue, peer-response
aggregation, and the summary projection. **No index added before it is measured** (Phase 12 D-21).
Queues are indexed predicates, never `ILIKE`.

## 23. Security strategy

Per §39. The threats and where each is answered:

| Threat | Answer |
| --- | --- |
| Cross-tenant leakage | RLS on every table, both directions, unprivileged role |
| Employee A reads employee B's review | **Application layer only** — RLS cannot express it (§12). Asserted at the HTTP edge |
| IDOR via an employment identifier in a URL | `read-team` scoped to actual reports; `read-all` a separate permission |
| Manager escalation — reading a peer's review | `read-team` resolved from Employment's reporting line, not from a client-supplied identifier |
| Assessment manipulation | Assessor from the authenticated context, never the body. Submitted assessments immutable |
| Final-rating manipulation | Completion immutable at the database; calibration overrides recorded with actor and reason, never overwriting |
| Unauthorized calibration or cycle closure | Separate permissions; self-calibration of one's own review refused |
| Peer identity leakage | See D-12 — the honest answer may be that anonymity **cannot be guaranteed** |

**One rule this architecture cannot currently guarantee**, stated plainly: an employee cannot be
prevented from reading their own review through an API they should not reach, because there is no
way to establish which employment *is* theirs. Today that is moot — every endpoint returns 401
without an authentication adapter — but it must not be forgotten when one arrives.

## 24. Test strategy

The Phase 12 shape, which found three defects: pure domain suites; application suites through the
real dispatcher over in-memory stores; **integration suites against real PostgreSQL as an
unprivileged role** for persistence, isolation (both directions), immutability (port, repository,
trigger, *and the permitted case*), and concurrency (two real connections); a cross-module suite
using the **real adapters** under real bounded service grants; and API security suites through the
real controllers asserting what each permission does *not* reach.

Two Phase 12 lessons carried forward explicitly: a plain `PermissionChecker` makes every service
grant inert, so the harness must wrap as the composition root does; and integration fixtures sharing
one database can truncate each other's rows, so any new fixture must be checked against the existing
ones before it is trusted (Phase 12 §4.3 and its debt entry).

---

## 25. `NOT VERIFIED` capabilities

Named as missing dependencies, not deferred features:

| Capability | Why |
| --- | --- |
| **Employee self-service routing** — "My Goals", "My Review" | No principal-to-employment resolution (ADR-0032) |
| **Notification delivery** — cycle opened, assessment due, overdue, finalized | `RecordingNotificationPort` records; nothing delivers |
| **Scheduled execution** — reminders, automatic cycle transitions, overdue detection, automatic closure | `JobPort` has no adapter. Overdue detection will be a *query*, not a sweep |
| **Evidence file upload/download** | `StoragePort` has no adapter (Phase 12) |
| **Generated appraisal letters as documents** | No renderer exists (Phase 12 D-15) |
| **Signed reviews** | No signature provider (Phase 12 D-16) |
| **True 360° anonymity** | See D-12 — may be architecturally impossible to guarantee, in which case it is `NOT VERIFIED` and must not be claimed |
| **Workflow-routed approval** | Workflow is Phase 16; `AutoApprovingPort` is not a substitute |

## 26. Technical debt

Carried in: the **eighth copy** of `row-writer.ts` would become the ninth; the D-25 storage-reference
inconsistency; and the pre-existing concurrent-integration-suite fragility recorded in the Phase 12
report, which a fourteenth module makes more likely to bite.

New, if the phase proceeds as specified: ≈25 tables in one phase (D-30), and `person-capability`
versus competency assessment remaining a boundary that Phase 14 will have to revisit (D-9).

## 27. ADR requirements

Expected: **performance data is not ordinary employee data** (the read-team/read-all split);
**a completed review is immutable at the table** (extending ADR-0066's reasoning, with the cost
measured before adoption); **a rating is not a grade** (the vocabulary collision, §3.4); **Performance
publishes recommendations and modifies nothing** (AD-005, mirroring ADR-0067); and, if 360° ships,
**anonymity is a property of the data model, not of the user interface**.

---

## 28. Decision register

Every ambiguity that changes business behaviour or architecture. **None of these is decided.**

| | Question | Repository evidence | Specification evidence | Options | Recommendation | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| **D-1** | One module or several? | Phase 12 split two modules successfully; all share one dispatcher | Spec names 17 aggregate roots under one domain | (a) one `performance` module (b) `performance` + `feedback` (c) three modules | **(a)** — goals, competencies and calibration all write the same review's score, and a split would need cross-module writes | A large module; internal boundaries by aggregate, not package |
| **D-2** | Does 360° belong here? | Recruitment already owns an `InterviewFeedback` concept | AD-006 lists 360° among tenant-configurable review methods | (a) in Phase 13 as a review method (b) separate phase | **(a)**, as a *reviewer role* on a review rather than a parallel system | Peer assessment is an assessment kind, not a new aggregate family |
| **D-3** | Review cycle lifecycle states | Payroll's period/run is the precedent | Spec gives a flow, **not states** | Proposed `draft → open → in_progress → calibration → closed` | Adopt, or supply the approved list | Schema check constraints and every transition test depend on it |
| **D-4** | Goal hierarchy representation | Organization uses parent references with an ancestry walk | "Corporate / Department / Team / Individual" goals | (a) explicit parent reference (b) materialized path (c) projection | **(a)** — depth is shallow and Organization's precedent exists | A deep hierarchy would need re-visiting |
| **D-5** | Goal weighting | ADR-0061: money carries its exponent; nothing uses floats | "Weighted Goals"; no arithmetic given | (a) integer basis points, must total 10,000 (b) decimal, need not total (c) unweighted allowed | **(a)** with "must total" **tenant-configurable** | Determines whether an incomplete goal set can be scored at all |
| **D-6** | Scoring formula | Payroll's lines each explain their own arithmetic | **None given** | Must be supplied | **Cannot be invented.** Needs: component weights, rounding, missing/incomplete/cancelled goal behaviour, zero-weight behaviour, override rules | The phase cannot be built without it |
| **D-7** | Rating scale, and the `grade` collision | `PositionView.grade` *and* `compensation_pay_grade` already exist; Recruitment uses an integer 1–5 | "Ratings" implied throughout | (a) tenant-defined scale with ordered levels and integer values (b) fixed 1–5 | **(a)**, and **never use the word `grade`** — use `rating_scale` / `rating_level` | A third `grade` would make the term meaningless across three modules |
| **D-8** | Competency ownership | `PositionView` carries `family` and `grade`; Organization owns positions | AD-003: tenant configurable | (a) framework → competency → level, assigned to positions by reference (b) per job family (c) per employee | **(a)** — and **do not add competency ownership to Organization** | Avoids duplicating position information |
| **D-9** | Competency assessment versus People and Learning | `person-capability.ts` reserves assessment for **Learning (Phase 14)** and job performance for Performance | Spec puts competency evaluation in Performance | (a) Performance assesses competency *demonstrated in the job*; Learning assesses *capability attained* (b) Performance defers competencies to Phase 14 | **(a)**, with the boundary written into both modules' guides | The single most consequential boundary in the phase; getting it wrong duplicates a domain |
| **D-10** | Self / manager / final: records or states? | Compensation and Payroll keep decisions as separate immutable rows | Spec names SelfAssessment, ManagerAssessment, PeerAssessment as **separate aggregate roots** | (a) separate rows, one per assessor and kind (b) states of one record | **(a)** — the spec says so, and it is the only shape where one actor cannot overwrite another's | A final rating is then *derived*, not a fourth assessment |
| **D-11** | Calibration in scope? | — | Named in Scope *and* in the lifecycle | (a) in scope (b) defer | **(a)** — the specification places it before completion | A manager may not change a rating after submission except through a recorded calibration decision |
| **D-12** | 360° anonymity | Nothing in the repository provides anonymous write. Every row carries `created_by`; RLS is tenant-scoped; the access-trail pattern records every actor | Spec says "Peer Assessment" and "360°"; **says nothing about anonymity** | (a) attributed peer feedback, no anonymity claimed (b) aggregate-only display with a minimum respondent count (c) true anonymity | **(a) or (b)**. **(c) cannot be guaranteed** — audit columns, RLS and the correlation identifier all record the author, and hiding a name in the UI is not anonymity | If anonymity is required, it is **`NOT VERIFIED`** and must be stated as such |
| **D-13** | Manager-at-review-time | Employment owns reporting lines; `EmploymentView.managerEmploymentId` is resolved `asOf` | Not addressed | (a) snapshot at completion (b) query current state | **(a)** — a completed review that re-reads current state changes when somebody transfers | Snapshot table, per §15 |
| **D-14** | Organizational placement snapshot | Employment resolves assignment `asOf`; Organization walks up for the legal entity | Not addressed | (a) snapshot unit/position/entity at completion (b) do not record | **(a)** for completed reviews only | Needed for any historical performance report by department |
| **D-15** | Approval of goals and reviews | Five modules refused `AutoApprovingPort` for human decisions | "Goal Approved" in the lifecycle; Workflow is a Non Goal | (a) record decisions in-module, shaped to `ApprovalPort`'s view (b) consume `ApprovalPort` | **(a)** — the established pattern. **`system:auto-approval` appears nowhere** | Phase 16 changes the source, not the contract |
| **D-16** | Where immutability is enforced | ADR-0066; Phase 12 added four triggers and had to narrow two | AD-004 | (a) domain + application only (b) + database trigger | **(b)** for the completed review and submitted assessments, **with the cost measured before adoption** and the permitted case asserted alongside the refusals | A trigger too broad is as much a defect as one too narrow |
| **D-17** | Nine-box | Organization reserves position criticality for Phase 15 | **"Talent Classification" is a spec section**; the matrix is *published to* Career & Succession | (a) in scope, published as a recommendation (b) defer to Phase 15 | **(a)** — the spec is explicit, and placement is derived from ratings this phase already computes | Performance never modifies Employment and never triggers a promotion |
| **D-18** | PIP scope | `relations` (Phase 5.2) owns disciplinary action | PIPs are in Scope; disciplinary action is a Non Goal | (a) in scope, strictly non-disciplinary (b) defer | **(a)**, with the boundary stated: a PIP is a development plan, not a warning | Must not become a disciplinary record by another name |
| **D-19** | One-to-one meetings | Nothing similar exists | In Scope | (a) in scope (b) defer as low-value-per-table | **(b) is worth considering** — three tables for a meeting-notes feature, in the largest phase in the repository | See D-30 |
| **D-20** | Continuous feedback | Recruitment owns `InterviewFeedback` | In Scope | (a) in scope (b) defer | **(a)**, named `performance_feedback` and never bare `feedback` | Avoids a vocabulary collision |
| **D-21** | Notifications | `RecordingNotificationPort` records only | Notification engine is a Non Goal | (a) record intent, mark delivery `NOT VERIFIED` (b) omit entirely | **(a)** — intent is a real record; delivery is a missing dependency | The UI must not imply anybody was told |
| **D-22** | Scheduling | `JobPort` has no adapter | Not addressed | (a) overdue as a *query*; operator commands for transitions (b) build a scheduler | **(a)** — Phase 12 D-26's exact reasoning | Nothing fires. Stated in the report and on the screen |
| **D-23** | Self-service routing | ADR-0032; `read-own` enforced nowhere in five modules | Employee Portal is a Future Consumer | (a) declare the permission, mark routing `NOT VERIFIED` (b) accept a client-supplied employment identifier | **(a)**. **(b) is an IDOR** and must not ship | "My Review" cannot be built honestly this phase |
| **D-24** | Evidence documents | Documents exists; `StoragePort` does not | "Evidence" implied by goals and PIPs | (a) reference a `documentId` only (b) store nothing (c) store bytes | **(a)** — reference only. **No binary in Performance**, and upload remains `NOT VERIFIED` | A screen shows that evidence exists and cannot fetch it |
| **D-25** | Performance summary projection | Reporting reads projections, never transactional tables (ADR-0008) | "PerformanceSummaryProjection" is an aggregate root | (a) a derived read model rebuilt by query (b) a materialized table | **(a)** unless measurement says otherwise — a materialized summary needs something to maintain it, and nothing scheduled runs | Same reasoning as Phase 12's derived expiry state |
| **D-26** | Import / export | Every module has deferred bulk paths | In Scope | (a) defer (b) build | **(a)** — a bulk path that bypasses the application service bypasses the invariants | Consistent with Phases 2–12 |
| **D-27** | Search strategy | Phase 12 D-21: indexed predicates, never `ILIKE`; `SearchPort` unused | "Advanced Search" in Scope | (a) indexed predicates + bounded filters (b) `pg_trgm` (c) `SearchPort` | **(a)**, measured before any index is added | Queues must not go through `ILIKE` |
| **D-28** | Effective dating | Employment and Organization are effective-dated; Payroll is not | AD-007 lists "Effective Dating" | (a) effective-date configuration (frameworks, scales) only (b) everything | **(a)** — a review is an event at a point in time, not an effective-dated fact | Prevents a second temporal model over reviews |
| **D-29** | Publishing outcomes | ADR-0064: at-most-once, no outbox | "Compensation, Learning and Succession consume approved outcomes" | (a) publish events as accelerators; consumers pull (b) rely on delivery | **(a)** | A lost event costs nothing |
| **D-30** | **Phase size** | Payroll (14 tables) was the largest phase and took a full phase; Phase 12 built two modules and 11 tables | 17 aggregate roots, ≈25 tables | (a) build as specified (b) split: core (goals, competencies, cycles, reviews, calibration, nine-box) then continuous (feedback, one-to-ones, PIPs) | **(b) is the honest recommendation.** The core is a coherent, shippable performance-management product; feedback, one-to-ones and PIPs are three independent features that do not gate it | This is a scope decision only the approver can make, and it is the most important entry in this register |
| **D-31** | "Who reports to this manager?" | `ReportingLineView` exists; `EmploymentView.managerEmploymentId` exists; **no published query takes a manager and returns reports** | The manager review queue requires it | (a) add a published read to Employment (b) filter `employment.search` client-side (c) snapshot reports at enrolment | **(a)** — Phase 11 added `leave.payroll-period` to Leave for exactly this reason | Requires a small, additive change to a completed module — which needs explicit approval |

---

## 29. Stop condition

Planning only. No migration, no Prisma model, no aggregate, no controller, no UI, and no change to
any completed module. The sole artefact is this file.

**D-6 (the scoring formula), D-3 (the cycle lifecycle) and D-30 (phase size) block implementation.**
The first two cannot be invented; the third determines what is being built at all.
