# Phase 14 — Learning & Development — Definition of Ready

**Planning only. No code, no migration, no change to any completed module.** The sole artefact is
this file.

Specification: [`work prompts/15_PHASE_14_LEARNING.md`](../../work%20prompts/15_PHASE_14_LEARNING.md)
(v1.0, Approved). Read in full. Reconciled below against the repository as it actually stands at
commit `6d5cf53`, after Phase 13 closed.

**Status: READY FOR REVIEW.** Nine decisions block implementation; they are marked in §27 and
summarized in §28.

---

## 1. Scope

Enterprise learning management, as one module `learning`:

**Catalogue** — courses, course categories, course versions, learning paths and their ordered steps.
**Delivery** — sessions (scheduled deliveries of a course), instructors, capacity.
**Participation** — learning assignments, enrolments, progress, completion.
**Evidence** — assessments and their results, certifications, expiry and recertification.
**Compliance** — mandatory training rules, and who is out of compliance with them.
**Reporting** — a learning summary read model, and the outcomes Performance and Career consume.

Plus the layers every module in this repository carries: REST API, Admin workspace, English and
Arabic catalogues, audit, soft delete, optimistic concurrency, row-level security.

## 2. Explicit non-scope

From the specification's Non Goals, and each already has an owner or a phase:

| Excluded | Where it belongs |
| --- | --- |
| Performance evaluation, competency assessment | `performance` (Phase 13 ✅) |
| Promotion decisions, succession, readiness | `career` (Phase 15) |
| Payroll, any pay consequence of training | `payroll` (Phase 11 ✅) |
| Workflow engine, approval routing | `workflow` (Phase 16) |
| Notification engine, delivery of any kind | `communications` (Phase 17) |

Added by this plan, on repository evidence rather than from the specification:

| Excluded | Why |
| --- | --- |
| Content authoring, SCORM/xAPI, video, hosting | No storage adapter exists anywhere in this repository. A course references content; it does not contain any |
| External learning-provider integration | `integration` (Phase 22). "External" is a *course type* and an *assessment result kind*, not a connector |
| Training cost, budget, chargeback | No owner exists. Inventing one here creates a second answer to a finance question |
| Training room, venue, physical location | **ADR-0041: work location has no owner in this product.** A session must not become the place one is invented |
| Skill or capability inference from completion | **AD-002**, and `person_capability` (Phase 4) already owns self-declared capability |

## 3. Existing repository state

Fourteen modules, 143 tables, 18 migrations, 43 ADRs, 12 Admin screens, 1,842 tests, `pnpm verify`
green. Everything Learning depends on is **already built**:

| Dependency | State | What Learning would consume |
| --- | --- | --- |
| `employment` | Phase 5 ✅ | `employment.read-employment`, `employment.search` (by manager or unit, as-of a date) |
| `organization` | Phase 3 ✅ | `organization.list-units`, `organization.governing-legal-entity`, `organization.tenant-settings` |
| `people` | Phase 4 ✅ | `people.read-person` — **only if** an external instructor needs a name (see D-6) |
| `documents` | Phase 12 ✅ | `documents.read-document` — to confirm an evidence document exists |
| `performance` | Phase 13 ✅ | Nothing. Performance *consumes* Learning, not the reverse |

**No unbuilt module is on Learning's path.** Note that the specification numbering and the delivered
phases have diverged: `13_PHASE_12_BENEFITS.md` was never built, and Phase 12 delivered Documents &
Letters instead. `benefits`, `claims` and `engagement` remain unbuilt, and Learning needs none of
them.

### Infrastructure Learning inherits and must not reinvent

- **RLS by `call app_protect_table(...)`** in the creating migration (ADR-0030). 143/143 tables carry
  it; `relforcerowsecurity` matters as much as `relrowsecurity`.
- **`PostgresUnitOfWork`** — fresh connection, `set_config('app.tenant_id', …, true)`, post-commit
  at-most-once in-process dispatch. **No outbox** (ADR-0064).
- **`Repository`** from `@work/persistence` — `updateRow` appends `version = version + 1` and throws
  `ConcurrencyException`, which now maps to **409** at the edge (a Phase 13 fix).
- **Bounded service grants** (ADR-0043) with `GrantAwarePermissionChecker`.
- **One shared `Dispatcher` and `ModuleRegistry`**, assembled in `identity.module.ts`.
- **Engineering budgets**: controller 150 lines, repository 250, `*.use-case.ts` 300, other 400;
  complexity ≤ 10; no `any`, no `eslint-disable`.
- **Admin portal shape**: server components only. No client component, no form, no dialog and no
  mutation exists in any of the twelve module screens (Phase 13 Admin report §1).

### Ports that exist and have **no adapter**

`JobPort`, `StoragePort`, `SearchPort`, `NotificationPort` (only `RecordingNotificationPort`),
`PlatformAuthenticationPort`. Every one of these constrains Learning, and each is addressed below
rather than worked around.

## 4. Domain ownership — the three boundaries that decide this phase

`DOMAIN_OWNERSHIP.md` already reserves `Course, enrolment, certification → learning → Phase 14`.
Three existing owners sit close enough to collide, and **two of them already wrote Learning's name
into their own code**:

### 4.1 `people.person_capability` — what somebody *claims*

```ts
// people-vocabulary.ts:64
// It is a self-declared capability, not an assessment — Learning (Phase 14) owns assessment.
```

Table `person_capability` holds `kind ∈ {language, skill}`, a level, years of experience, last used.
Self-declared, separately permissioned. **Learning must not write to it and must not duplicate it.**

### 4.2 `performance` competency — what a manager *observed*

```ts
// competency-framework.ts:13
// The boundary with People and Learning is the most consequential line in this phase (D-9)…
// Learning (Phase 14) will hold what a person has *attained* — a certification, an assessment,
// a course completed. This module holds what a manager *observed of the job*.
```

Three questions, three owners, already agreed: **claimed** (People) · **attained** (Learning) ·
**observed** (Performance). Phase 13 shipped its side. Phase 14 must ship the matching side and must
not widen it — AD-002 says course completion does not imply competency, and Performance's competency
framework is not Learning's to write.

### 4.3 `documents` — the training certificate that already has an owner

This is the **only genuine contradiction** between the specification and the repository, and it is
recorded verbatim in `DOMAIN_OWNERSHIP.md`:

> **A document's expiry belongs to whoever owns the thing that expires.** … A document with no
> identifier behind it — a signed policy acknowledgement, **a training certificate** — carries its
> own expiry, because nothing else owns one.

"Because nothing else owns one" was true when it was written. Phase 14's **AD-005** — "Certifications
may expire. Recertification is supported." — makes it false. Two modules would then hold an expiry
date for the same certificate, which is exactly the failure the registry exists to prevent.

**Raised as D-1. It is a blocking decision and it requires an ADR either way.**

## 5. Aggregate design (proposed, subject to §27)

| Aggregate root | Owns | Notes |
| --- | --- | --- |
| `CourseCategory` | catalogue taxonomy | Tenant-defined, like `performance_goal_category` |
| `Course` | identity, type, status, current version | Stable identity; the pattern is `document` → `document_version` |
| `CourseVersion` | content reference, duration, objectives, prerequisites | **Insert-only.** AD-004: historical versions remain available |
| `LearningPath` | ordered steps, audience rule | Steps reference a *course*, not a version (see D-4) |
| `Instructor` | who may deliver | Internal (employment) or external (see D-6) |
| `Session` | a scheduled delivery of one course version, capacity | Instructor-led / virtual / classroom |
| `LearningAssignment` | who must learn what, by when, and why | The compliance record |
| `Enrolment` | one employment's participation in a course version or session | The central aggregate |
| `LearningProgress` | append-only progress entries against an enrolment | Pattern: `performance_goal_progress` |
| `Assessment` / `AssessmentResult` | evaluation definition and outcome | **Measures learning only** |
| `Certification` | issued evidence, validity, recertification chain | Subject to D-1 |
| `MandatoryTrainingRule` | policy: this audience must hold this, recurring every N | Configuration, fires nothing |

`LearningHistory` and `LearningSummaryProjection` from the specification are **not tables** in this
proposal — see D-8 and D-9.

## 6. Entity / table inventory (indicative — 17 tables)

Catalogue (5): `learning_course_category`, `learning_course`, `learning_course_version`,
`learning_path`, `learning_path_step`

Delivery (3): `learning_instructor`, `learning_session`, `learning_session_instructor`

Participation (4): `learning_assignment`, `learning_enrolment`, `learning_progress`,
`learning_attendance_record`

Evidence (3): `learning_assessment`, `learning_assessment_result`, `learning_certification`

Compliance (2): `learning_mandatory_rule`, `learning_mandatory_exemption`

Every one tenant-scoped, `call app_protect_table` in the creating migration, audit columns, soft
delete, `version`.

**Naming**: every table prefixed `learning_`. `learning_enrolment` uses the repository's spelling —
`payroll` already spells it *enrolment*, and `performance_review` uses "enrol". The specification
writes "Enrollment"; the repository's spelling wins (§1 precedence order).

## 7. Lifecycle / state machines

The specification gives **one flow and no state lists**, exactly as Phase 13's spec did. Proposed,
and each needs approval (D-3):

**Course**: `draft → published → archived`. Withdrawal is `archived`, never deletion — a completed
enrolment must still name what was completed.

**Session**: `scheduled → enrolment_open → enrolment_closed → in_progress → completed | cancelled`.

**Enrolment**: `assigned → enrolled → in_progress → completed | failed | withdrawn | expired`.

**Certification**: `issued → active → expired | revoked | superseded`. **Expiry is derived, not a
state transition** — see §14.

**Assignment**: `assigned → satisfied | waived | overdue`. `overdue` is derived, not stored (§14).

## 8. Commands (indicative, ~30)

Catalogue: `define-category` · `create-course` · `publish-course-version` · `archive-course` ·
`define-path` · `set-path-steps` · `retire-path`

Delivery: `register-instructor` · `retire-instructor` · `schedule-session` · `move-session` ·
`cancel-session` · `assign-session-instructor`

Participation: `assign-learning` · `waive-assignment` · `enrol` · `withdraw-enrolment` ·
`record-progress` · `complete-enrolment` · `fail-enrolment` · `record-attendance`

Evidence: `define-assessment` · `record-assessment-result` · `issue-certification` ·
`revoke-certification` · `recertify`

Compliance: `define-mandatory-rule` · `retire-mandatory-rule` · `grant-exemption` ·
`revoke-exemption`

## 9. Queries (indicative, ~14)

`courses` · `read-course` · `paths` · `read-path` · `sessions` · `read-session` · `instructors` ·
`enrolments` · `read-enrolment` · `assignments` · `certifications` · `expiring-certifications` ·
`compliance` (who is out of compliance with which rule) · `learning-summary` · `reconciliation`

Every collection bounded and paged; every queue an **indexed predicate, never `ILIKE`** (Phase 12
D-21, Phase 13 §22).

## 10. Permissions (indicative)

`learning.configure` / `.configure.read` (catalogue, paths, assessments, mandatory rules) ·
`learning.session.manage` / `.read` · `learning.enrol` (assign or enrol somebody) ·
`learning.enrolment.read-team` / `.read-all` · `learning.progress.record` ·
`learning.assess` (record a result) · `learning.certify` (issue, revoke, recertify) ·
`learning.compliance.read` · `learning.exempt` · `learning.reconcile`

`learning.enrolment.read-own` and `learning.certification.read-own` are **declared and route to
nothing**, exactly as `review.read-own` does — see §23.

`certify` and `assess` are separate, on Phase 13's precedent: recording that somebody passed and
issuing the credential that follows are different acts with different blast radii.

## 11. Cross-module contracts

| Direction | Contract | Grant |
| --- | --- | --- |
| Learning → Employment | `employment.read-employment` (is this employment active, as of a date), `employment.search` (a unit's or a manager's employments) | `employment.employment.read` only |
| Learning → Organization | `organization.list-units`, `organization.governing-legal-entity` | `organization.legal-entity.read` |
| Learning → Documents | `documents.read-document` — confirm an evidence document exists | `document.read` |
| Learning → People | **Only** for an external instructor's name, and only if D-6 chooses it | `people.person.read` |
| Performance → Learning | Published queries. Learning **publishes**; it does not push | — |

**No new query is required on any completed module.** Phase 13's D-31 needed one and turned out not
to; the same check has been run here and `employment.search` already answers every question Learning
asks. This is the one thing that would require changing a completed module, and it does not.

## 12. RLS strategy

Identical to Phases 12 and 13: `call app_protect_table` on every table in the creating migration;
integration suites run as an **unprivileged role holding no `BYPASSRLS`**; isolation asserted in
**both directions**, including that a tenant cannot infer another's **counts**.

## 13. Concurrency strategy

Optimistic `version` on every mutable row. Three races need real two-connection tests, and one is
new to this repository:

- **Session capacity.** Two concurrent enrolments into the last seat. This is the first
  *capacity-constrained* aggregate in the product — Payroll, Leave and Performance have nothing like
  it. See D-5.
- Duplicate enrolment of the same employment into the same course version.
- Concurrent issue of a certification for the same completion.

## 14. Derived state, never stored

The Documents precedent (`expiry.ts`) is exact and Learning should follow it verbatim:

> A materialized `expired` column needs something to move it from `valid` on the right morning.
> `JobPort` has no adapter anywhere in this repository, so nothing scheduled runs — and a stored flag
> that nothing maintains is worse than no flag.

So: **certification validity, assignment overdue-ness and mandatory-training compliance are all
derived on read** from a date and today, and each becomes an indexed predicate. Nothing sweeps, and
nothing claims to.

## 15. Immutability strategy

Following ADR-0066 and Phase 13, with the cost measured before each trigger is adopted and the
**permitted case asserted beside every refusal**:

| Record | Immutable once | Enforced |
| --- | --- | --- |
| `learning_course_version` | published | domain + trigger |
| `learning_progress` | written | domain + trigger (append-only) |
| `learning_assessment_result` | recorded | domain + trigger |
| `learning_certification` | issued — revocation sets a status, never edits the issue | domain + trigger |

## 16. Historical reproducibility

The Phase 13 guarantee (ADR-0068) applies directly: **a completed enrolment must still read the
same after the course is re-versioned, the path is re-ordered and the assessment is re-worded.**

The mechanism is cheaper here than Performance's snapshot, because `learning_course_version` is
already immutable: an enrolment references a **version**, not a course. Whether that is sufficient —
or whether completion needs its own snapshot the way a review does — is **D-7**.

## 17. Localization

Fifteenth catalogue set: `packages/modules/learning/locales/{en,ar}.json`, gated by
`check-localization.mjs`. Course titles, category names and path names are **tenant-authored
localized text** (`LocalizedTextView`), never translated by this product. Status vocabularies and
rejection reasons are this module's own and are translated.

## 18. API plan

~30 command routes and ~14 query routes under `/api/v1/learning/…`, following Phase 13 exactly:
state transitions as `POST` to a named sub-resource (`/publication`, `/completion`, `/revocation`),
never a status dropdown; `class-validator` DTOs deriving every enumeration from the domain
vocabulary; one `unwrapOrThrow`; RFC 9457 Problem Details; bounded pagination.

## 19. Admin UI plan

One route `/learning`, server-rendered, no client component — the shape all twelve existing screens
have. Workspaces: overview · catalogue · paths · sessions · enrolments · progress · assessments ·
certifications · compliance · reconciliation.

## 20. Self-service plan

**None.** `read-own` remains unroutable: there is still no principal → employment resolution
(ADR-0032). "My learning" cannot be built honestly this phase, and a client-supplied employment
identifier is an IDOR — the same position Phase 13 took, and the same one its API tests enforce.

## 21. Event / reconciliation strategy

Learning **publishes** outcomes as accelerators; consumers pull (ADR-0064, Phase 13 D-29). No
outbox, no durable delivery claimed. Reconciliation reports and repairs nothing: enrolments whose
employment is no longer active, certifications past expiry with no recertification, mandatory rules
with nobody satisfying them, sessions over capacity.

## 22. Performance strategy

Benchmarked as Phase 13 was: real PostgreSQL, unprivileged role, RLS on, **a second tenant at the
same volume**, at **500 / 10,000 / 100,000 employments**. Measured separately: the compliance queue,
expiring certifications, enrolments by employment, enrolments by session, a course's catalogue read,
progress history, the learning summary, and reconciliation. **No index added before it is measured.**

Phase 13's two misses are the warning: an O(n×m) scan in reconciliation, and an index missing the
second ordering column. Both shapes are likely here.

## 23. Security strategy

| Threat | Answer |
| --- | --- |
| Cross-tenant leakage | RLS on every table, both directions, unprivileged role |
| Employee A reads employee B's training record | **Application layer only** — RLS cannot express it. Asserted at the HTTP edge |
| IDOR via an employment identifier in a URL | `read-team` scoped to actual reports; `read-all` separate. **`read-team` remains `NOT VERIFIED`** |
| A manager reads a peer's certifications | Same scope resolution as Performance, and the same refusal |
| Certification forgery | Issue is permissioned separately from assessment; issued rows immutable at the table |
| Mandatory-training evidence tampering | Assessment results and certifications immutable; revocation is a new state, never an edit |

Training records are **sensitive**: a failed assessment is as disclosing as a performance rating.
Confidentiality is treated at Performance's standard, not at a catalogue's.

## 24. Test strategy

The Phase 12/13 shape, which has found nine defects across two phases: pure domain suites ·
application suites through the dispatcher over in-memory stores · PostgreSQL integration suites
(persistence, isolation, immutability, concurrency) as an unprivileged role · API suites over real
PostgreSQL with every state reached over HTTP · Admin render tests against real markup · a
cross-module suite on one real dispatcher.

## 25. `NOT VERIFIED` capabilities (expected)

Carried forward, and none may be approximated:

- Principal → employment resolution; `read-own` and `read-team` self-service
- Notification delivery — enrolment confirmations, expiry reminders, overdue notices
- Scheduled execution — recurring mandatory training **does not recur by itself**
- Binary content: course material, SCORM/xAPI, video, certificate PDFs
- External learning-provider integration
- Anything requiring `SearchPort`

## 26. Technical debt carried in

Phase 13 closed with debt that touches this phase: the test-isolation deadlock at default
concurrency (repository-wide, nine fixtures); the OKR sub-structure with schema and no application;
the Admin portal's absent mutation surface. None blocks Phase 14, and none should be fixed by it.

## 27. Decision register

Every ambiguity that changes business behaviour or architecture. **None of these is decided.**
Blocking decisions are marked ⛔.

| | Question | Repository evidence | Specification evidence | Options | Recommendation | Consequence |
| --- | --- | --- | --- | --- | --- | --- |
| **D-1** ⛔ | **Who owns a training certificate's expiry?** | `DOMAIN_OWNERSHIP.md`: "a training certificate — carries its own expiry, **because nothing else owns one**". `documents.expiry_date` exists and is queried. `person_history.kind='certification'` also carries `expires_on` for *prior/external* qualifications | AD-005: "Certifications may expire. Recertification is supported." | (a) Learning owns certifications it issues; `documents` keeps only externally-supplied certificate documents; `person_history` keeps pre-employment qualifications — three sources, one rule each, boundary written into all three guides (b) Learning references a `documentId` and stores no date (c) Documents keeps ownership; Learning holds no certification | **(a)**, with an ADR amending the `DOMAIN_OWNERSHIP.md` sentence, because its stated premise is no longer true | Without this, two modules answer "when does this certificate expire" and can disagree |
| **D-2** ⛔ | **What does a certification attach to?** | Nothing comparable exists | "Certification: Evidence of course completion" — but also listed as an independent aggregate root with renewal and history | (a) always derived from a completed enrolment (b) may also be recorded standalone, for a credential earned elsewhere (c) both, distinguished by a `source` | **(c)** — a tenant tracking a mandatory safety certificate needs to record one obtained externally, and pretending it came from a course would be false | Decides whether `learning_certification.enrolment_id` is nullable, and whether Learning duplicates `person_history` |
| **D-3** ⛔ | Lifecycle state lists | Payroll's run and Performance's cycle are the precedents | One flow, **no state lists** — identical to Phase 13's gap | The five machines proposed in §7 | Adopt, or supply the approved lists | Check constraints and every transition test depend on it |
| **D-4** | Path steps: course or course version? | `onboarding_instance.plan_version_id` pins a version; `letter_issued` pins a template version | AD-004: historical versions remain available | (a) a step names a course; the enrolment pins the version current when it started (b) a step names a version, and re-versioning a course requires re-authoring every path | **(a)** — otherwise every course update orphans every path | Decides whether a path is maintainable |
| **D-5** ⛔ | **Session capacity semantics** | **No capacity-constrained aggregate exists anywhere in this repository.** Payroll, Leave and Performance have none | "Validate … Capacity" | (a) hard limit, enforced by a unique-count check inside the transaction, last enrolment refused (b) soft limit with a waitlist (c) advisory only | **(a)** — a waitlist is a queue that needs something to promote from it, and `JobPort` has no adapter | (b) would be the first feature in the product that silently requires a scheduler |
| **D-6** ⛔ | **Is an instructor an employment?** | **AD-001 says reference Employment, never Person.** But an external trainer has no employment | Spec: "Instructor: Learning facilitator" | (a) internal only — an instructor *is* an employment (b) internal or external, external carrying a free-text name and no person reference (c) external instructors reference `person` | **(b)** — (c) would put non-employees into People, which owns *this employer's* people; (a) cannot express a vendor-delivered course | Decides whether AD-001 needs an explicit exception recorded |
| **D-7** | Completion snapshot, or is version-pinning enough? | ADR-0068: Performance snapshots the whole working. `letter_issued` snapshots substituted values | AD-004 | (a) version-pinning is sufficient — the version row is immutable (b) also snapshot the assessment definition and pass mark at completion | **(a)** unless assessments can be re-worded in place; if they can, **(b)** | Decides whether a completed enrolment needs its own frozen row |
| **D-8** | Is `LearningHistory` a table? | `person_history` exists and means something else; Employment has `employment_history`; audit columns exist on every row | Listed as an aggregate root | (a) a derived read over immutable rows already kept (b) a separate history table | **(a)** — progress, results and certifications are already append-only and immutable; a second history table would be a copy that can disagree | Avoids a table with no independent facts |
| **D-9** | Is `LearningSummaryProjection` materialized? | ADR-0008: reporting reads projections. Phase 13 D-25 chose a derived read model and it held at 100,000 | Listed as an aggregate root | (a) derived read model rebuilt by query (b) materialized table | **(a)** unless measurement says otherwise — a materialized summary needs something to maintain it | Same reasoning as Phase 12 and 13; revisit only with a benchmark |
| **D-10** ⛔ | **Recurring mandatory training** | `JobPort` has no adapter. Documents solved the same problem by deriving expiry state on read | "Recurring Training", "Mandatory Training … tenant configurable" | (a) a rule states a recurrence interval; compliance is **computed on read** from the last completion and today; nothing fires (b) generate future assignments in advance (c) build a scheduler | **(a)** — Documents' exact pattern. (b) creates rows nothing maintains | Nothing reminds anybody. Must be stated in the report and on the screen |
| **D-11** | Assessment scoring representation | ADR-0069: scores are integer hundredths, weights integer basis points, **no `numeric` column in Performance** | "Quiz, Practical, Assignment, Observation, External Result" — **no scoring formula given** | (a) integer hundredths and a pass mark in the same unit, reusing ADR-0069 (b) percentage as an integer 0–100 (c) pass/fail only | **(a)** for consistency — but note Learning needs no weighted aggregate, so this is representation only, **not** a second scoring engine | If any aggregate score across assessments is required, that formula must be supplied and cannot be invented |
| **D-12** | Does a course completion write anywhere else? | **AD-002 is explicit.** `person_capability` is self-declared; Performance's competency is manager-observed | AD-002: "Course completion does not imply competency" | (a) Learning writes nothing outside itself; Performance and Career pull (b) completion updates a capability | **(a)** — (b) would breach AD-002 and the ownership registry in one step | Learning has **no write** to any other module |
| **D-13** | Does attending a session affect Attendance? | `attendance` has an `off_site` roster kind; a training day is plausibly one | Not addressed | (a) no relationship; Attendance is not told (b) Learning publishes a session attendance event Attendance may consume later | **(a)** for this phase — (b) is a cross-module write in disguise and Attendance has no consumer for it | A training day is an attendance question nobody has asked yet |
| **D-14** | Effective dating | Phase 13 D-28 restricted it to *configuration*. 31 tables carry `effective_from` | AD-007 lists "Effective Dating" | (a) configuration only — mandatory rules and path versions (b) everything | **(a)** — an enrolment is an event at a point in time, not an effective-dated fact | Prevents a second temporal model over enrolments |
| **D-15** | Import / export | Every phase since Phase 2 has deferred bulk paths | "Import", "Export" in Scope | (a) defer (b) build | **(a)** — a bulk path that bypasses the application service bypasses the invariants | Consistent with Phases 2–13 |
| **D-16** | Search strategy | Phase 12 D-21, Phase 13 §22: indexed predicates, never `ILIKE`. `SearchPort` unused | "Advanced Search" in Scope | (a) indexed predicates and bounded filters (b) `pg_trgm` (c) `SearchPort` | **(a)**, measured before any index is added | A course *catalogue* is the most plausible place in the product for real text search; if that is required it is a separate, measured decision |
| **D-17** ⛔ | **Phase size** | Performance was ~25 tables and took schema → domain → application → PostgreSQL → API → Admin → audit, six checkpoints | 12 aggregate roots, ~17 tables proposed | (a) build as specified (b) split: catalogue + enrolment + progress first; sessions, instructors, assessments and certifications second (c) split by dropping instructor-led delivery entirely | **(b) is worth serious consideration.** Catalogue → assignment → enrolment → completion is a coherent, shippable learning product. Sessions, instructors and capacity are a scheduling sub-domain with the only genuinely new mechanic in the phase (D-5) | A scope decision only the approver can make |
| **D-18** | Prerequisites enforcement | Nothing comparable exists | "Validate … Learning Path Prerequisites" | (a) refuse enrolment when a prerequisite is unmet (b) warn and record an override with a reason (c) advisory | **(b)** — a hard refusal makes an operational exception impossible and someone will edit the database instead | Decides whether an override needs an actor and a reason |
| **D-19** | Assessment attempts | Nothing comparable exists | Not addressed | (a) one result per assessment per enrolment (b) multiple attempts, latest counts, all retained | **(b)** — retaking a failed safety quiz is the normal case, and discarding earlier attempts destroys the compliance trail | Decides the uniqueness constraint on `learning_assessment_result` |

## 28. The blocking decisions, in one place

Implementation cannot start until these nine are settled:

| | What is needed |
| --- | --- |
| **D-1** | Who owns a training certificate's expiry. Contradicts a written ownership rule; needs an ADR either way |
| **D-2** | Whether a certification can exist without a completed enrolment |
| **D-3** | The five lifecycle state lists (or approval of §7's proposal) |
| **D-5** | Session capacity semantics — hard limit, waitlist, or advisory |
| **D-6** | Whether an instructor may be external, and therefore whether AD-001 needs an exception |
| **D-10** | Whether recurring mandatory training is computed on read or requires a scheduler this product does not have |
| **D-17** | Phase size — one phase or two |

D-11 becomes blocking **if** an aggregate score across assessments is required: no formula is given,
and Phase 13 established that a scoring formula cannot be invented.

D-4, D-7, D-8, D-9, D-12 to D-16, D-18 and D-19 carry recommendations that follow existing precedent
and can be approved as a block.

## 29. Contradictions found, stated rather than reconciled

Per §1 of the instruction, these are reported and **not** silently resolved:

1. **AD-005 versus `DOMAIN_OWNERSHIP.md`.** The registry says a training certificate carries its own
   expiry in `documents` "because nothing else owns one". AD-005 gives Learning expiring
   certifications. → **D-1.**
2. **AD-001 versus external instructors.** "Never reference Person directly" cannot express a
   vendor's trainer, who has no employment either. → **D-6.**
3. **AD-007 "Effective Dating" versus Phase 13 D-28.** Phase 13 restricted effective dating to
   configuration on the grounds that a review is an event, not an effective-dated fact. The same
   reasoning applies to an enrolment. → **D-14.**
4. **"Recurring Training" versus the absence of `JobPort`.** The specification describes recurrence;
   nothing in this product can make anything recur. → **D-10.**
5. **`LearningHistory` and `LearningSummaryProjection` as aggregate roots.** Both are read models by
   nature, and ADR-0008 says reporting reads projections. → **D-8, D-9.**
6. **Spelling.** The specification writes "Enrollment"; the repository writes "enrolment"
   (`payroll`, `performance`). The repository wins under the precedence order.

## 30. What is *not* required, and is worth stating

- **No change to any completed module.** `employment.search` already answers every question Learning
  asks about employments; unlike Phase 13's D-31, no new published query is needed.
- **No new kernel port.** Learning needs nothing that does not already exist.
- **No new infrastructure.** RLS, unit of work, repository base, service grants, Problem Details,
  pagination and the Admin shape are all in place and unchanged.

## 31. Stop condition

Planning only. No migration, no Prisma model, no aggregate, no controller, no UI, and no change to
any completed module. The sole artefact is this file.

**D-1, D-2, D-3, D-5, D-6, D-10 and D-17 block implementation.** D-1 is the most consequential: it
contradicts a written ownership rule, and resolving it wrongly duplicates a domain — which is the one
failure `DOMAIN_OWNERSHIP.md` exists to prevent.

Awaiting explicit approval.
