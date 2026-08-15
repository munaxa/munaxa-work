# Phase 15 — Career & Succession Planning — Definition of Ready

**Planning only. No code, no migration, no change to any completed module.** The sole artefact is
this file.

Specification:
[`work prompts/16_PHASE_15_CAREER_SUCCESSION.md`](../../work%20prompts/16_PHASE_15_CAREER_SUCCESSION.md)
(v1.0, Approved). Read in full. Reconciled below against the repository as it actually stands at
commit `7c70757`, after Phase 14A closed.

**Status: READY FOR REVIEW.** Twenty-one decisions are recorded; **eleven block implementation**.
They are marked ⛔ in §23 and summarized immediately after it.

---

## 1. Objective

Career & Succession prepares the organization for future workforce needs. It **identifies talent and
readiness and recommends**; it executes nothing. Every output is advisory, and the modules that own
employment, pay, evaluation and training remain the only places those facts change.

The phase is worth building because three questions currently have no owner anywhere in the
repository:

- **"If this position became vacant tomorrow, who could do it, and when?"** Organization knows a
  position is `critical`; nobody records a successor for it.
- **"What is this person's plan, and is it balanced?"** Learning knows what somebody was asked to
  study; nothing records coaching, mentoring, a stretch assignment or a target date.
- **"Which people are we deliberately investing in?"** Performance places somebody in a nine-box for
  one cycle; nothing carries a standing pool membership across cycles.

## 2. Scope

One module, `career`:

**Paths** — career paths and their ordered stages, tenant-configurable.
**Plans** — an individual career plan naming a path and a target stage.
**Pools** — talent pools and their membership over time.
**Succession** — critical-position references, successors nominated against them, readiness.
**Development** — development plans, their items, and the target dates on them.
**Mobility** — internal mobility recommendations.
**Reporting** — a career summary read model, and bench-strength reads for a succession review.

Plus the layers every module in this repository carries: REST API, Admin workspace, English and
Arabic catalogues, audit, soft delete, optimistic concurrency, row-level security.

## 3. Explicit exclusions

| Excluded | Why |
| --- | --- |
| Promotions, transfers, salary changes, any employment modification | Spec Non Goals, and AD-002. Employment and Compensation own these. **Career writes nothing outside itself** |
| Workflow engine, notification engine | Spec Non Goals. Phases 16 and 17 |
| Position criticality itself | AD-004: it belongs to Organization, and `organization_position.criticality` already exists. Career **references**, never stores a second copy |
| Course and training ownership | AD-006. Learning owns courses, assignments, enrolments, certifications and their expiry (ADR-0070) |
| Nine-box placement | Phase 13 owns it. `performance_talent_placement` exists with `performanceBand`, `potentialBand` and `boxCode` |
| Competency assessment | Performance owns what a manager observed of the job |
| Vacancy and requisition | Recruitment (Phase 6) owns those |
| Bulk import / export | Deferred in every phase since Phase 2, for the same reason: a bulk path that bypasses the application service bypasses the invariants with it. → **D-19** |
| Anything scheduled | `JobPort` has no adapter. → §21 |
| Employee and manager self-service | No principal → employment resolution (ADR-0032). → §11, §21 |

## 4. Repository findings

Everything below was read, not assumed.

### 4.1 The module is greenfield

No table, type, permission or contract named `career`, `succession`, `talent_pool`, `career_path` or
`readiness` exists anywhere. The only matches are prose in Performance and Organization comments,
plus `performance_talent_placement`. **Nothing to migrate, nothing to reconcile at the row level.**

### 4.2 Position criticality already exists — and cannot be filtered

`organization_position.criticality` is a column; `POSITION_CRITICALITIES = ['standard',
'important', 'critical']` is a published vocabulary; `PositionView.criticality` is on the published
contract; `organization.list-positions` is a paged query behind `organization.position.read`.

**But `ListPositions` accepts only `status`, `family`, `term`, `page`, `size`. There is no
`criticality` filter.** A succession dashboard's first question — "list the critical positions" —
cannot be answered with one bounded request. Paging the whole position catalogue and filtering in
Career would be unbounded work over another module's data. → **D-4 ⛔**

### 4.3 The nine-box is unbounded

`performance.talent-matrix` takes a `cycleId` and returns `Listed<TalentPlacementView>` where
`total` is `views.length` — **the whole cycle in one response, unpaged**. Phase 14A's benchmark
seeded 100,000 employments per tenant; a matrix read at that scale is 100,000 rows.

Career needs "who was placed high-potential", which is a *filtered, paged* question. → **D-5 ⛔**

Separately: `potentialBand` already exists on the published view. **High-potential identification is
already answered by Performance.** Career must not compute a second one. → **D-6**

### 4.4 Employment answers the succession questions Career needs

`employment.search` accepts `positionId`, `unitId`, `managerEmploymentId`, `status` and `asOf`, and
is paged with a maximum size of 100. That answers "who holds this critical position today", "who
reports to this manager" and "is this nominee still employed" without any new contract.
`employment.read-employment` and `employment.read-history` cover the single-record cases.

### 4.5 Learning answers the development questions Career needs

`learning.read-history` returns one person's assignments, enrolments and certifications with
server-computed counts, bounded. `learning.search-assignments`, `learning.search-enrolments`,
`learning.search-certifications`, `learning.list-paths` and `learning.read-path` are all paged.

**A Learning path is already an ordered set of courses.** A Career development plan whose items are
courses would be a second copy of it. The honest split is in §5.

### 4.6 Effective dating is not consistent across the repository

`effective_from` appears **17 times as `timestamptz(6)` and 13 times as `date`**. Organization's
`PositionView.effectiveFrom` is a `Date`; Employment's `AssignmentView.effectiveFrom` is a `Date`;
every Learning date is a `YYYY-MM-DD` **string** end to end, and Phase 14A's report states plainly
that this is why no timezone conversion can be wrong there.

Career's dates — a target date, a pool membership period, a plan's validity — are civil dates about
days, not instants. → **D-11 ⛔**

### 4.7 Kernel ports: what actually exists

| Port | Status | Evidence |
| --- | --- | --- |
| `ApprovalPort` | **ADAPTER MISSING (auto-approving stub only)** | `AutoApprovingPort` records `system:auto-approval` and its own comment says it "does not pretend a chain of approvers considered anything" |
| `NotificationPort` | **ADAPTER MISSING (recording stub only)** | `RecordingNotificationPort` appends to an array |
| `JobPort` | **CONTRACT ONLY** | Declared in the kernel; **zero implementors** |
| `StoragePort` | **CONTRACT ONLY** | Zero implementors |
| `DocumentPort` | **CONTRACT ONLY** | Zero implementors. Documents' *module* contracts are separate and real |
| `SearchPort` | **CONTRACT ONLY** | Zero implementors |
| `EmailPort` | **CONTRACT ONLY** | Zero implementors |
| `PlatformAuthenticationPort` | **CONTRACT ONLY** | Three references, all test or stub. ADR-0032 |
| `FeatureFlagPort` | Implemented | One implementor |
| Unit of work, service grants, audit columns, localization, persistence helpers | **IMPLEMENTED AND WIRED** | `PostgresUnitOfWork`, `runWithServiceGrant` + `GrantAwarePermissionChecker`, `check-localization` gate, shared `row-writer` |
| Numbering / counter facility | **NOT AVAILABLE** | The kernel's only identity facility is `uuidV7`. No sequence helper exists |

**No infrastructure will be fabricated.** Every capability that depends on a missing adapter is in
§21.

### 4.8 A "summary projection" is derived here, three times over

ADR-0008 says reporting reads projections. Phase 12, Phase 13 (D-25) and Phase 14A (D-9) each chose
**a derived read model rebuilt by query**, and Phase 14A measured it holding at 100,000 employments.
The three physical `*_snapshot` tables that do exist — `attendance_payable_snapshot`,
`payroll_input_snapshot`, `performance_review_snapshot` — are all **immutable historical evidence**
of a decision, not caches of a current state.

`CareerSummaryProjection` should follow the precedent, not the three snapshots. → **D-16**

## 5. Domain ownership

For every major concept the specification names:

| Concept | Owner | Source of truth | Consumer | Published contract | Lifecycle | Mutability | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Career path | **Career** (new) | `career_path` | Admin, plans | `CareerPathView` | draft → published → archived | Configuration; amendable while draft | Full |
| Career stage | **Career** (new) | `career_stage` | Paths, plans | `CareerStageView` | Belongs to a path | Ordered; a stage's *position* is an order, not a gate | Full |
| Career plan | **Career** (new) | `career_plan` | Development, mobility | `CareerPlanView` | draft → active → achieved / abandoned / archived | Transactional | Full |
| Talent pool | **Career** (new) | `career_talent_pool` | Succession, reporting | `TalentPoolView` | active → closed | Configuration | Full |
| Pool membership | **Career** (new) | `career_pool_membership` | Reporting | `PoolMembershipView` | added → removed (period, not delete) | Historical fact | Full |
| Critical position | **Organization** | `organization_position.criticality` | Career | `PositionView.criticality` | Organization's | **Career stores no copy** | Organization's |
| Succession plan | **Career** (new) | `career_succession_plan` | Reporting | `SuccessionPlanView` | draft → active → archived | Transactional | Full |
| Successor nomination | **Career** (new) | `career_successor` | Succession, reporting | `SuccessorView` | nominated → confirmed / withdrawn | Advisory. **Never triggers anything** (AD-005) | Full |
| Readiness assessment | **Career** (new) | `career_readiness_assessment` | Successor, plan | `ReadinessAssessmentView` | Recorded, append-only | **Immutable once recorded** | Full |
| Readiness level | **Career** (new) | `career_readiness_level` | Assessments | `ReadinessLevelView` | Configuration | Tenant-configurable, ordered | Full |
| Development plan | **Career** (new) | `career_development_plan` | Reporting | `DevelopmentPlanView` | draft → active → completed / abandoned | Transactional | Full |
| Development item | **Career** (new) | `career_development_item` | Plan | `DevelopmentItemView` | planned → in_progress → completed / cancelled | Transactional | Full |
| Development item *that is a course* | **Learning** | `learning_assignment` / `learning_enrolment` | Career | `AssignmentView`, `EnrolmentView` | Learning's | **Career stores a reference and no status of its own** | Learning's |
| Mobility recommendation | **Career** (new) | `career_mobility_recommendation` | Admin | `MobilityRecommendationView` | proposed → accepted / declined / expired | **Advisory only** | Full |
| Nine-box placement | **Performance** | `performance_talent_placement` | Career | `TalentPlacementView` | Performance's | **Career stores no copy** | Performance's |
| Employment, position held, manager | **Employment** | `employment_*` | Career | `EmploymentView` | Employment's | Reference only | Employment's |
| Person identity and name | **People** | `person` | — | — | — | **Career never references Person** (AD-001) | — |
| Career summary | **Career**, derived | Nothing — assembled on read | Admin | `CareerSummaryView` | — | **Not a table** (D-16) | n/a |

**Classification.** Master data: paths, stages, pools, readiness levels. Transactional: plans,
nominations, development plans and items, mobility recommendations. Historical facts, immutable:
readiness assessments, pool membership periods. Derived: career summary, bench strength, "is this
nominee still eligible". References to another module: critical position, nine-box placement,
employment, course assignment.

**No concept above is owned twice.**

## 6. Aggregate model

Nine aggregate roots, against the specification's ten:

| Spec aggregate | Proposal |
| --- | --- |
| `CareerPath` | **Root.** Owns its stages as an entity collection |
| `CareerStage` | **Entity of `CareerPath`**, not a root — a stage has no life outside its path |
| `CareerPlan` | **Root** |
| `TalentPool` | **Root.** Owns its memberships |
| `CriticalPositionReference` | **Not a Career aggregate.** It is Organization's `criticality`, read through `PositionView`. What Career owns is the *succession plan* for a position → renamed `SuccessionPlan`. → **D-3 ⛔** |
| `Successor` | **Entity of `SuccessionPlan`** — a nomination exists only against a plan |
| `ReadinessAssessment` | **Root.** Append-only; referenced by a successor and by a plan |
| `DevelopmentPlan` | **Root.** Owns its items |
| `MobilityRecommendation` | **Root** |
| `CareerSummaryProjection` | **Not an aggregate.** A derived read model (D-16) |

## 7. Lifecycle model

The specification gives **one flow and no state lists** — the same gap Phase 13 and Phase 14A each
had, and each raised rather than invented. The machines below are **proposed**, and every one of
them is subject to **D-7 ⛔**.

| Aggregate | States | Transitions | Reversible? | Immutable after? |
| --- | --- | --- | --- | --- |
| `CareerPath` | `draft`, `published`, `archived` | publish, archive | No | Archived is terminal; stages frozen |
| `CareerPlan` | `draft`, `active`, `achieved`, `abandoned`, `archived` | activate, achieve, abandon, archive | No | `achieved` and `abandoned` are endings |
| `TalentPool` | `active`, `closed` | close | No | Membership history retained |
| `SuccessionPlan` | `draft`, `active`, `archived` | activate, archive | No | Nominations retained |
| `Successor` | `nominated`, `confirmed`, `withdrawn` | confirm, withdraw | No | Withdrawal is a new state, never a delete |
| `ReadinessAssessment` | — (a single recorded fact) | — | **A correction is a new assessment** | Yes, at the row and by trigger (→ D-14) |
| `DevelopmentPlan` | `draft`, `active`, `completed`, `abandoned` | activate, complete, abandon | No | Items retained |
| `DevelopmentItem` | `planned`, `in_progress`, `completed`, `cancelled` | start, complete, cancel | No | — |
| `MobilityRecommendation` | `proposed`, `accepted`, `declined`, `expired` | accept, decline | No | `accepted` records that somebody agreed; **it changes no employment** |

Every transition: named command, own permission, `expectedVersion`, actor from the authenticated
context. Concurrency exactly as Phase 13/14A — `updateRow` bumps `version`, a stale write throws
`ConcurrencyException`, the edge answers **409**.

`accepted` on a mobility recommendation deserves its own sentence, because it is the one state in
this module that a reader could mistake for an action: it means *a human agreed with the
suggestion*, and nothing else happens. No transfer, no assignment, no letter.

## 8. Data model proposal

Eleven tables. Indicative, subject to §23.

| Table | Notes |
| --- | --- |
| `career_path` | code, name (jsonb), kind, status, effective dating (D-11) |
| `career_stage` | path_id, sequence, name, target position_id (nullable, references Organization by id only) |
| `career_plan` | employment_id, path_id, current_stage_id, target_stage_id, status |
| `career_talent_pool` | code, name, kind, status |
| `career_pool_membership` | pool_id, employment_id, from/to civil dates, added_by, removed_by, reason |
| `career_readiness_level` | code, name, ordinal, active — **tenant-configurable, ordered, no numeric scale published** |
| `career_succession_plan` | position_id (Organization), status, review_date |
| `career_successor` | succession_plan_id, employment_id, readiness_level_id, rank, status, nominated_by |
| `career_readiness_assessment` | employment_id, position_id or succession_plan_id, readiness_level_id, assessed_on, assessed_by, rationale — **append-only** |
| `career_development_plan` | employment_id, career_plan_id (nullable), cycle label, status, owner and manager acknowledgement |
| `career_development_item` | plan_id, category (experience / exposure / education), kind, learning_assignment_id (nullable), target_date, status |

Every table carries the repository's standard columns: `id uuid`, `tenant_id uuid not null`,
`metadata jsonb`, `created_at/by`, `updated_at/by`, `deleted_at/by`, `version integer`.

**Estimated: 11 tables, ~20 indexes, 11 RLS policies, 0–2 triggers (→ D-14), 0 projection tables,
~30 commands, ~14 queries.** That is smaller than Phase 13 (23 tables) and comparable to Phase 14A
(12). **No scope split is recommended** — see D-21.

## 9. Cross-module contracts

Every dependency, and whether a contract already exists.

| Need | Existing contract | Sufficient? | Permission | Grant |
| --- | --- | --- | --- | --- |
| Confirm a nominee's employment exists and is active | `employment.read-employment` | **Yes** | `employment.employment.read` | `career` → read-employment |
| Who holds this critical position today | `employment.search` (`positionId`, `asOf`) | **Yes** | `employment.employment.read` | same |
| Is this position real | `organization.list-positions` / `organization.describe-unit` | **Yes for existence** | `organization.position.read` | `career` → confirm-position |
| **List the critical positions** | `organization.list-positions` | **NO — no `criticality` filter** | — | → **D-4 ⛔** |
| This person's nine-box placement | `performance.talent-matrix` | **NO — unpaged, cycle-wide, no employment filter** | `performance.talent.read` | → **D-5 ⛔** |
| This person's learning record | `learning.read-history` | **Yes** | `learning.assignment.read-all` | `career` → read-learning-history |
| A development item's course status | `learning.search-assignments` / `search-enrolments` | **Yes** | `learning.assignment.read-all`, `learning.enrolment.read` | same |
| Evidence document for an assessment | `documents.read-document` | **Yes** (existence only) | `document.read` | `career` → confirm-evidence-document |
| A person's name for a screen | — | **Not needed.** Career shows employment identifiers, as every Admin screen does | — | — |

Two proposed new contracts, both **additive** to a completed module. Neither will be built without
approval.

**C-1 — `organization.list-positions` gains a `criticality` filter.**
*Why the existing contract is insufficient:* returning every position so Career can filter is
unbounded work over another module's data, and the count would be wrong.
*Exact data required:* the positions already returned, narrowed.
*Minimum response shape:* unchanged `PagedResult<PositionView>`.
*Tenant boundary:* unchanged — Organization's RLS.
*Permission:* unchanged `organization.position.read`.
*Grant:* `career` → `confirm-position`.
*Additive:* yes — one optional filter field, no shape change, no behaviour change for existing
callers.
*Module modified:* Organization (Phase 3). → **D-4 ⛔**

**C-2 — a filtered, paged talent-placement read.**
*Why the existing contract is insufficient:* `performance.talent-matrix` is unpaged and cycle-wide;
Career needs "the placement for this employment" and "placements in band N, paged".
*Exact data required:* the existing `TalentPlacementView`.
*Minimum response shape:* `PagedResult<TalentPlacementView>` with `employmentId`, `potentialBand`
and `cycleId` filters.
*Tenant boundary:* unchanged.
*Permission:* unchanged `performance.talent.read`.
*Grant:* `career` → `read-talent-placement`.
*Additive:* a **new** query name alongside the existing one, leaving `talent-matrix` untouched.
*Module modified:* Performance (Phase 13). → **D-5 ⛔**

If either is refused, the dependent capability becomes `NOT VERIFIED` rather than being approximated
with an unbounded read.

## 10. Kernel / infrastructure dependencies

Classified in §4.7. Career's own position on each:

- **`ApprovalPort` — will not be consumed.** → §10a and **D-8 ⛔**.
- **`NotificationPort` — intent only.** A nomination or a target date may record an intent; the
  module will never display a "sent" state. → §21.
- **`JobPort` — not consumed.** Nothing in Career is scheduled. Expiry of a mobility
  recommendation, and "this plan's target date has passed", are **derived on read** against a stated
  day, exactly as Learning derives certificate validity (ADR-0070). → **D-13**.
- **`StoragePort`, `DocumentPort` — not consumed.** An assessment may cite a document *identifier*
  confirmed through `documents.read-document`. No bytes, no filename, no URL.
- **`SearchPort` — not consumed.** Indexed predicates and bounded filters, measured before any index
  is added, as Phase 12 D-21 and Phase 14A established.
- **Numbering — not required.** No Career record needs a human-readable sequence number. If the
  approver wants one (a plan reference, say), it needs a facility that does not exist. → **D-20**.

### 10a. Approval semantics

The specification does not name approval, but three acts in this module plausibly need one:
confirming a successor, acknowledging a development plan, and accepting a mobility recommendation.

The repository has already settled that `system:auto-approval` is not a human decision —
`AutoApprovingPort` says so in its own comment, and Learning, Performance and Payroll each carry a
check constraint refusing that actor on the acts that matter.

**Recommendation: Career consumes no `ApprovalPort`.** Confirmation is a **named human act with its
own permission**, recorded with the actor from the authenticated context and refused for
`system:auto-approval` by a check constraint. That is what Phase 13 did with `calibrate` and
`complete`, and Phase 14A with `waive` and `revoke`. → **D-8 ⛔**

## 11. Authorization model

Permissions follow the established `career.<aggregate>.<verb>` shape, with the separations that
matter kept apart:

`career.path.read` / `.manage` · `career.plan.read` / `.manage` · `career.pool.read` / `.manage` ·
`career.pool.assign` · `career.succession.read` / `.manage` · `career.successor.nominate` /
`.confirm` · `career.readiness.read` / `.record` · `career.development.read` / `.manage` ·
`career.mobility.read` / `.recommend`

Three separations are deliberate and mirror precedent:

- **`successor.confirm` is not implied by `successor.nominate`.** Suggesting somebody could succeed
  a director is not the same act as recording that the organization agrees, and the second is the
  one an auditor asks about.
- **`pool.assign` is not implied by `pool.manage`.** Creating a "high potential" pool is
  configuration; putting a named person in it is a judgement about them.
- **`readiness.record` is separate from `readiness.read`.** Reading who is ready and stating that
  somebody is not are different capabilities.

**Succession data is more sensitive than most of this product.** A list of named successors for a
director's post, or a "not ready" assessment, is material somebody can act on against a colleague.
The default posture is `read` permissions that are **not** granted broadly, and 404-rather-than-403
for a record the caller may not see — Phase 13 and 14A both established that confirming a record
exists is itself the disclosure.

**Self-service: `NOT VERIFIED`.** ADR-0032 — there is no principal → employment resolution. "My
career plan", "my team's readiness", "plans I own as a manager", delegated and reviewer access are
all unbuildable honestly. A caller-supplied `employmentId` or `managerEmploymentId` is **a filter,
never a credential**, exactly as Learning and Performance enforce. The permission names may be
declared so the contract exists; they will be enforced nowhere and stated as `NOT VERIFIED`.
→ **D-9 ⛔** (whether the development plan's "jointly owned by employee and manager" requirement can
be met at all without it — the honest answer is no).

## 12. RLS model

Every table: `tenant_id uuid not null`, `app_protect_table(...)` in the creating migration
(ADR-0030), RLS **enabled and forced**, policy `tenant_id = app_current_tenant()` for both `qual`
and `with_check`.

**A foreign key does not provide tenant isolation.** The repository has this finding already, and it
matters more here than in most modules because Career's rows reference three other modules'
identifiers. `career_succession_plan.position_id` referencing `organization_position(id)` does
**not** stop a row naming another tenant's position: PostgreSQL's referential check runs without the
policy. Containment comes from (a) the RLS policy on Career's own row, and (b) the application
confirming the reference through a published contract before writing.

Cross-module references are therefore **plain `uuid` columns with no foreign key**, following
ADR-0042 (how Employment references another module) and Learning's treatment of `employment_id`.
Within Career, foreign keys are real: a stage belongs to a path, an item to a plan.

Benchmarked both directions, with a second tenant at the same volume: rows, **detail reads by
identifier**, and **counts** — the last because a bench-strength count computed without the tenant
predicate discloses how many successors another organization has groomed.

## 13. Temporal semantics

| Kind | Present in Career? | Treatment |
| --- | --- | --- |
| Effective-dated configuration | Yes — paths, readiness levels | `effective_from` / `effective_to`, following Phase 13 D-28's restriction of effective dating to *configuration* |
| Historical facts | Yes — pool membership periods, readiness assessments | Append-only, never edited |
| Future-dated changes | **No.** A plan is amended, not scheduled | — |
| As-of reads | Yes — "who was in this pool on this date", "was this nominee employed on this date" | An `asOf` parameter echoed in the response, as Learning and Employment both do |
| Overlapping periods | Yes — a person in two pools at once is legitimate; the *same* pool twice at once is not | Partial unique index (§15) |
| Expiry | Yes — a mobility recommendation goes stale | **Derived on read**, never stored. Nothing maintains a flag |
| Recurrence | **No.** A development plan is per cycle; nothing repeats automatically | — |
| Bitemporality | **No.** Not required, and not introduced |

**Every Career date is a civil date**, stored as `date` and carried as a `YYYY-MM-DD` string end to
end. A target date, a membership period and an assessment day are days, not instants — and Phase 14A
demonstrated that the way to make timezone bugs impossible is to have no `Date` on the path at all.
This differs from Organization and Employment, which use `timestamptz`. → **D-11 ⛔** (the
inconsistency is repository-wide and predates this phase; Career should not be the module that
quietly picks a third convention).

## 14. Exact numeric semantics

Career holds **no money, no rate and no percentage that anything computes with**. That is the single
most important sentence about its data, and it should stay true.

| Value | Type | Rule |
| --- | --- | --- |
| Stage `sequence` | `smallint`, 1–500 | An order, not a gate — Learning's path-step precedent |
| Successor `rank` | `smallint`, 1–50 | An order a human stated |
| Readiness level `ordinal` | `smallint` | **Ordered, but no numeric scale is published.** Performance's `POSITION_CRITICALITIES` comment is the precedent: ordered least to most so a consumer may compare by index, without publishing a number that must then stay stable |
| Development mix weights | → **D-12 ⛔** | See below |
| Bench strength, readiness counts | Derived integers | Counted by the database, never by a page of rows |

**The 70-20-10 development mix is a formula the specification does not define.** It says a plan can
be "validated for balance", tenant-adjustable. It does not say what validation does: refuse the
plan, warn, or record a score. It does not give a tolerance. It does not say how an item's
contribution is measured — by count, by hours, by target-date span. It does not say what happens to
an item with no category.

This is precisely the case Phase 14A refused to guess at with assessment scoring, and Phase 13 with
self- and peer-assessment weighting. **The parameters must be supplied or the capability is
`NOT VERIFIED`.** → **D-12 ⛔**

## 15. Concurrency and idempotency

Every command that can be retried or run concurrently, and what actually enforces the guarantee:

| Command | Invariant | Enforced by |
| --- | --- | --- |
| Add somebody to a pool | One open membership per (pool, employment) | **Partial unique index** on `(tenant_id, pool_id, employment_id) where to_date is null and deleted_at is null`, with `insert … on conflict do nothing` returning whether it created — Learning's ADR-0071 pattern |
| Nominate a successor | One open nomination per (succession plan, employment) | Partial unique index, same shape. This is the spec's "Duplicate Successor Assignments" validation, and it belongs at the database rather than in a pre-check |
| Create a succession plan | One active plan per position | Partial unique index on `(tenant_id, position_id) where status = 'active'` |
| Create a career plan | One active plan per employment | Partial unique index |
| Confirm / withdraw / activate / archive | Last writer must have read the row | `expectedVersion` → `ConcurrencyException` → **409** |
| Record a readiness assessment | Append-only | No uniqueness — a second assessment is a new fact, and the trail is the point |

**A pre-check is never the guarantee.** Phase 14A's report records that a read-then-write is
idempotent only when nobody is watching; the same applies here, and "duplicate successor
assignments" is the exact shape of a race two managers can run at once.

**Request-level idempotency is not claimed.** No idempotency-key facility exists in the kernel and
none will be invented. What is claimed is *convergence*: a retried nomination returns the nomination
that already exists with `created: false`.

## 16. Projection and reconciliation strategy

`CareerSummaryView` is **derived on read**, assembled from Career's own authoritative rows plus
bounded cross-module reads — following ADR-0008 as Phases 12, 13 and 14A each read it, and
Phase 14A's measurement of the same shape holding at 100,000 employments.

No physical projection table. A materialized summary needs something to maintain it, and nothing in
this repository runs.

**One reconciliation query, no reconciliation job**: "successors whose employment has ended", "career
plans naming an archived path", "development items whose learning assignment was cancelled". Each is
a *question somebody asks*, answered live and bounded — Documents' and Payroll's pattern. Where a
derived answer could be mistaken for a maintained one, the response carries the day it was computed
against and the screen displays it.

## 17. API scope

~30 commands and ~14 queries, following Phase 14A's shape exactly: commands are `POST`s to named
sub-resources (`/publication`, `/archive`, `/confirmation`, `/withdrawal`, `/acceptance`), and
**no lifecycle status is writable by `PATCH`**. `PATCH` amends descriptive fields only.

Every collection paged with the module's own bounds and the server's `total` returned separately.
Failures map through the shared `ProblemDetailsFilter`: 400 shape, 403 permission, 404 not-found
(including "may not see"), 409 concurrency, 422 refused rule.

**No route will exist for**: promotion, transfer, salary change, employment modification, scheduled
review, notification delivery, document upload or download, self-service.

## 18. Admin UI scope

One server-rendered route, `/career`, following the portal's actual architecture — **no client
component, no form, no dialog, no state the screen owns**, which is what all fourteen module screens
are. Where a record's state permits an action the screen names it and says the server decides.

Sections: overview · career paths and stages · career plans · talent pools and membership ·
succession plans and their nominated successors with readiness · readiness assessments ·
development plans and items · mobility recommendations · what this product does not do.

Bounded: a fixed number of requests per load, detail reads made once for the first row of a listing,
never one per position or per person. Both languages from the module's own catalogues, direction
following language.

The screen must state plainly that **a nomination is advisory**, that **nothing here changes an
employment**, and that self-service and scheduling are `NOT VERIFIED`.

## 19. Benchmark plan

`scripts/measure-career-performance.mjs`, following Phase 14A's four-file structure: measurements,
fixture catalogue, fixture records, audit assertions.

Real PostgreSQL, real repositories, **unprivileged role with `rolsuper` and `rolbypassrls` asserted
false**, RLS asserted enabled *and forced*, **a second tenant seeded at the same volume**, at
**500 / 10,000 / 100,000 employments**.

Workloads: succession plan listing · successors for one plan · bench strength by position ·
readiness distribution · pool membership listing · pool membership as-of a date · career plans by
path · development plans by employment · development items due before a date · mobility
recommendations · career summary for one employment · the reconciliation queries.

Budgets inherited unchanged: **queue reads 100 ms, detail reads 150 ms, reconciliation
2 s / 10 s / 60 s.** No budget will be promised as met before it is measured, and **no index will be
added before a measurement asks for one**.

Two shapes are already suspect and will be watched: bench strength across many positions (an O(n×m)
risk of exactly the kind Phase 13 hit), and any per-position cross-module read (an N+1).

`vacuum analyze` after seeding, not `analyze` — Phase 14A's fixture defect, recorded so it is not
repeated.

## 20. Verification strategy

Domain tests · application tests over in-memory stores · integration tests over real PostgreSQL for
isolation, immutability and concurrency · cross-module tests using **production adapters and stub
query handlers on the same dispatcher**, never fake ports · API tests over real PostgreSQL as an
unprivileged role · Admin render tests with `renderToStaticMarkup`.

Gates: `pnpm standards` then `pnpm verify --force` with `TEST_DATABASE_URL`, uncached, 0 skipped,
0 `.only`, 0 `eslint-disable`, 0 `any`.

## 21. `NOT VERIFIED` matrix

| Capability | Dependency | Why unavailable | What can be built honestly | What cannot be claimed |
| --- | --- | --- | --- | --- |
| Employee self-service ("my career plan") | Principal → employment resolution | ADR-0032. No authentication adapter | Permission names declared; scope resolves to nothing | That an employee can see their own plan |
| Manager self-service, direct-report visibility | Same | Same | A caller-supplied identifier treated as a **filter** | That it proves who is asking |
| Development plan "jointly owned by employee and manager" | Same | Neither party can be identified | An administrator recording both acknowledgements as named acts | That the employee acknowledged it themselves |
| Delegated and reviewer access | Same | No delegation model exists | — | Any of it |
| Scheduled succession review | `JobPort` | Zero implementors | A review date stored; "reviews due" **derived on read** against a stated day | That anything reminds anybody |
| Mobility recommendation expiry | `JobPort` | Same | Expiry **derived** from the recommendation's own date | That anything expires it |
| Notification delivery | `NotificationPort` | Recording stub only | An intent recorded | Any "sent" state |
| Document upload / download / signed URL | `StoragePort` | Zero implementors | A document identifier confirmed via `documents.read-document` | That a file exists or can be fetched |
| Readiness **computed** from performance and learning | — | **No formula in the specification** | Readiness **stated** by an authorized human, with a rationale | Any derived readiness score |
| Development mix (70-20-10) validation | — | **Parameters undefined** (D-12) | Item categories recorded and counted | Any balance verdict |
| Workflow routing of a confirmation | `ApprovalPort` | Auto-approving stub only | A named human act with its own permission | That an approval chain considered it |
| Critical-position listing | Organization contract | No `criticality` filter (D-4) | Succession plans Career itself holds | A complete list of the tenant's critical positions |
| High-potential listing | Performance contract | `talent-matrix` unpaged (D-5) | Pool membership Career itself holds | A nine-box-derived high-potential list |
| Analytics, AI workforce intelligence | — | Named in the spec's "Future Consumers" | Bounded reads other systems may consume | Anything predictive |

## 22. Technical debt expectations

Carried in, not created here: test fixtures deadlocking at default concurrency (repository-wide,
Phase 13 and 14A both reproduced it); the `effective_from` type split (§4.6); five kernel ports with
no adapter; no numbering facility.

Expected to be created: none, if the blocking decisions are settled. If D-4 or D-5 is refused, two
`NOT VERIFIED` entries become permanent debt rather than a phase gap.

## 23. Decision register

**None of these is decided.** Blocking decisions are marked ⛔.

| | Question | Why it matters | Repository evidence | Recommendation | Alternative | Impact if changed |
| --- | --- | --- | --- | --- | --- | --- |
| **D-1** ⛔ | Does Career own a **standing** talent pool, when Performance already places people in a nine-box per cycle? | Two answers to "is this person high potential" | `performance_talent_placement.potentialBand` exists and is published | Career owns **membership**, a deliberate standing decision by a named human. Performance owns **placement**, an observation in one cycle. Neither derives the other | Career derives pools from placements — no standing pool exists | Decides whether `career_talent_pool` exists at all |
| **D-2** ⛔ | Does Career own a **development plan** when Learning already owns paths and assignments? | Two answers to "what should this person do next" | `learning_path` is an ordered course set; `learning_assignment` is what somebody was asked to do | Career owns the plan and the **non-course** items — coaching, mentoring, projects, stretch assignments. A course item is a **reference** to a `learning_assignment` with no status of its own | Career stores its own course items | Without this, a completed course reads differently in two modules |
| **D-3** ⛔ | Is `CriticalPositionReference` a Career table? | The spec lists it as an aggregate root; AD-004 says Organization owns it | `organization_position.criticality` exists | **No.** Career owns `career_succession_plan` *for* a position and stores no criticality | Career stores a copy | A second, staler answer to "is this position critical" |
| **D-4** ⛔ | Add a `criticality` filter to `organization.list-positions`? | Without it, "list the critical positions" is unbounded | `ListPositions` accepts only status, family, term, page, size | **Yes** — one optional additive filter, Organization (Phase 3) modified | Refuse; the listing becomes `NOT VERIFIED` | Decides whether a succession dashboard can exist |
| **D-5** ⛔ | Add a filtered, paged talent-placement query to Performance? | `talent-matrix` returns a whole cycle unpaged | `Listed<>`, `total = views.length` | **Yes** — a new query name beside the existing one, Performance (Phase 13) modified | Refuse; Career never reads a placement | Decides whether Career can show a nine-box beside a nomination |
| **D-6** | Does Career compute high-potential? | Would be a second judgement about a person | `potentialBand` is Performance's | **No.** Career records a deliberate pool membership; Performance's band is displayed beside it, never merged | Career derives a flag | A person could be "high potential" in one screen and not another |
| **D-7** ⛔ | Lifecycle state lists | Check constraints and every transition test depend on them | Payroll's run, Performance's cycle, Learning's enrolment are the precedents | Adopt §7, or supply the approved lists | Supply different ones | Nothing can be built until these are fixed |
| **D-8** ⛔ | Does confirming a successor consume `ApprovalPort`? | `system:auto-approval` is not a human decision | `AutoApprovingPort` says so itself; four modules refuse that actor by check constraint | **No.** A named human act with its own permission, refused for `system:auto-approval` | Consume the port and record an auto-approval | Would put a fake approval on a succession record |
| **D-9** ⛔ | Can the development plan be "jointly owned by employee and manager"? | The spec requires it; the platform cannot identify either | ADR-0032 | **No** — an administrator records both acknowledgements as named acts, and joint ownership is `NOT VERIFIED` | Accept a client-supplied employment identifier as identity | An IDOR wearing a feature's name |
| **D-10** ⛔ | Is readiness **stated** or **computed**? | It decides who is put forward for a director's post | No formula in the spec. Learning refused to invent scoring; Performance refused to invent weighting | **Stated** by an authorized human with a rationale, against a tenant-configured level | Compute from performance band + learning completion | A computed readiness with no approved formula is a rule nobody wrote |
| **D-11** ⛔ | Civil dates or timestamps? | The repository is split 17/13 | Learning is civil-date strings end to end; Organization and Employment use `timestamptz` | **Civil dates**, `date` columns and `YYYY-MM-DD` strings — Career's dates are days | Follow Organization | Decides whether a target date can shift by one either side of UTC |
| **D-12** ⛔ | The 70-20-10 development mix | Affects whether a plan is accepted | No comparable validated-mix model exists | **Supply the parameters or mark it `NOT VERIFIED`**: what validation does, the tolerance, how contribution is measured, uncategorized items | Invent a rule | A balance verdict nobody specified |
| **D-13** | Does a mobility recommendation expire? | A stale suggestion read as current | ADR-0070: Learning derives expiry rather than storing it | Store a `valid_until` civil date; derive `expired` on read against a stated day | Store a status something must maintain | Nothing maintains it — the Learning lesson exactly |
| **D-14** | Are readiness assessments immutable **at the table**? | Triggers are architecturally significant here | Learning has three immutability triggers; Payroll and Performance have their own | **Yes**, one trigger refusing update and delete | Application-level only | An edited assessment destroys the trail; raised rather than introduced silently |
| **D-15** | Can somebody be a successor for more than one position? | Common in practice, and a real uniqueness question | Nothing comparable | **Yes** — uniqueness is per (succession plan, employment), not per employment | One position each | Decides the index shape |
| **D-16** | Is `CareerSummaryProjection` a table? | Spec lists it as an aggregate root | ADR-0008; Phases 12, 13 (D-25) and 14A (D-9) all chose derived | **Derived read model**, unless a benchmark says otherwise | A materialized table | A summary needing maintenance, with nothing to maintain it |
| **D-17** | Career path stages: gates or order? | Whether a plan can be refused | Learning's path steps are "an order, not a gate" — prerequisites were never specified | **Order.** No progression is enforced | Enforce stage progression | Enforcing an unspecified rule blocks real careers |
| **D-18** | Does a career plan require a path? | Ad-hoc plans are common | Nothing comparable | **Optional** — a plan may name a target stage without a full path | Mandatory | Decides nullability of `path_id` |
| **D-19** | Import / export | Named in the spec's Scope | Deferred in every phase since Phase 2 | **Defer** | Build | Consistent with eleven prior phases |
| **D-20** | Does any Career record need a human-readable number? | No numbering facility exists in the kernel | Only `uuidV7` | **No** | Yes — and a counter facility must then be built | Would add kernel work to a business phase |
| **D-21** | Phase size | Whether to split | 11 tables vs Phase 13's 23 and Phase 14A's 12 | **Do not split.** Paths → plans → pools → succession → development is one coherent, shippable product, and each part is nearly useless without the others | Split succession from development | A split here would ship two half-features rather than one whole one |

### The blocking decisions, in one place

Implementation cannot start until these eleven are settled:

| | What is needed |
| --- | --- |
| **D-1** | Confirmation that Career owns standing pool membership and Performance keeps per-cycle placement |
| **D-2** | Confirmation that a course-shaped development item is a *reference* to a Learning assignment |
| **D-3** | Confirmation that `CriticalPositionReference` is not a Career table |
| **D-4** | Approval (or refusal) to add a `criticality` filter to Organization's `list-positions` |
| **D-5** | Approval (or refusal) to add a filtered, paged talent-placement query to Performance |
| **D-7** | The approved lifecycle state lists |
| **D-8** | Confirmation that confirmation is a named human act, not an `ApprovalPort` call |
| **D-9** | Confirmation that joint employee/manager ownership is `NOT VERIFIED` |
| **D-10** | Confirmation that readiness is stated, not computed |
| **D-11** | The date convention |
| **D-12** | The development-mix parameters, or agreement to mark the capability `NOT VERIFIED` |

Three of them (**D-1**, **D-2**, **D-3**) decide whether a table exists at all, so they block the
migration. Two (**D-4**, **D-5**) require a completed module to be modified and are the only
decisions in this phase that touch code outside `career`. The remaining six decide business
semantics this plan refuses to invent.

## 24. Contradictions found, stated rather than reconciled

1. **The spec lists `CriticalPositionReference` as a Career aggregate root while AD-004 says
   critical positions belong to Organization.** Both cannot be true. → D-3.
2. **The spec says "Support high-potential identification" while Performance already publishes
   `potentialBand`.** → D-1, D-6.
3. **The spec says "Development Plans reference Learning. Learning remains the owner of training" and
   then lists "Learning Activities" as a development-plan item type.** A reference and an item are
   not the same thing. → D-2.
4. **The spec requires a development plan "jointly owned by the employee and the manager" in a
   product that cannot identify either.** → D-9.
5. **The spec gives a 70-20-10 weighting and a "validated for balance" requirement with no
   validation rule.** → D-12.
6. **The spec lists "Readiness Assessment" with configurable levels but no derivation.** → D-10.
7. **`organization.list-positions` cannot answer the specification's own "Critical Position
   Search".** → D-4.
8. **`performance.talent-matrix` cannot answer a paged talent question at 100,000 employments.**
   → D-5.

None of these has been silently reconciled.

## 25. Definition of Done checklist

- [ ] All eleven blocking decisions settled and recorded
- [ ] Domain aggregates with tests, no infrastructure
- [ ] Migration: 11 tables, RLS enabled and forced on each, indexes justified by a measurement
- [ ] Application layer: commands and queries, each with its own permission, in-memory stores
- [ ] PostgreSQL repositories with integration tests: isolation, immutability, concurrency
- [ ] Production cross-module adapters under bounded service grants, verified end to end against
      real handlers rather than fakes
- [ ] REST API over real PostgreSQL as an unprivileged role; 409 for concurrency, 404 for
      may-not-see
- [ ] Admin workspace, server-rendered, bounded, both languages, render-tested
- [ ] `NOT VERIFIED` capabilities stated on screen, in the module doc and in the report
- [ ] Benchmarks at 500 / 10,000 / 100,000 with a second tenant, query plans captured, every miss
      reported with its original measurement
- [ ] `pnpm standards` and `pnpm verify --force` green uncached, 0 skipped
- [ ] `docs/modules/career.md`, ADR register, PHASES, DOMAIN_OWNERSHIP and release notes updated
- [ ] Final report at `docs/verification/phase-15-final-report.md`

## 26. Stop condition

**This plan is not an approval to build.** Implementation starts when the blocking decisions in §23
are settled and this document is explicitly approved. Nothing in Phase 15 may modify a completed
module without the specific approval recorded against D-4 and D-5.
