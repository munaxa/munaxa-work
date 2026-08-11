# Phase 13 — API Layer

Continues from the PostgreSQL checkpoint (`b062a88`). Every result below was produced by running the
API over real PostgreSQL as an unprivileged role; nothing is inferred from reading code.

---

## 1. Controllers

Seventeen controllers in `packages/modules/performance/src/api/`, registered by
`apps/api/src/performance/performance.module.ts`. The pattern is the one every module since Phase 6
uses: a thin `PerformanceDispatcher` wrapper so Nest can inject the kernel's dispatcher, one shared
`unwrapOrThrow`, one shared `search-filters`, and controllers that decide nothing.

| Controller | Path | Operations |
| --- | --- | --- |
| `PerformanceRatingScaleController` | `performance/rating-scales` | list, define, retire |
| `PerformanceFrameworkController` | `performance/frameworks` | list, define, define competency, retire |
| `PerformanceTemplateController` | `performance/templates` | list, define, retire |
| `PerformanceGoalCategoryController` | `performance/goal-categories` | list, define, set active |
| `PerformanceCycleController` | `performance/cycles` | list, create, move, close, cancel |
| `PerformanceEnrolmentController` | `performance/cycles` | enrol participants |
| `PerformanceGoalController` | `performance/goals` | search, create, read, amend, approve, move |
| `PerformanceGoalProgressController` | `performance/goals` | record progress, close |
| `PerformanceReviewController` | `performance/reviews` | search, read, move |
| `PerformanceReviewLifecycleController` | `performance/reviews` | score, complete, archive |
| `PerformanceAssessmentController` | `performance/reviews` | invite reviewer, start assessment |
| `PerformanceAssessmentItemController` | `performance/assessments` | record item, submit |
| `PerformanceReviewerAssignmentController` | `performance/reviewer-assignments` | respond to invitation |
| `PerformanceCalibrationController` | `performance/calibration-sessions` | list, schedule, move, decide, conclude |
| `PerformanceTalentController` | `performance/talent` | matrix, record placement |
| `PerformanceFeedbackController` | `performance/feedback` | search, give, withdraw |
| `PerformanceReconciliationController` | `performance/reconciliation` | findings |

**No controller queries Prisma, queries PostgreSQL, calls a repository, implements a domain rule,
calculates a score or decides authorization.** Audited in §11. The flow is exactly
HTTP → controller → DTO validation → command/query → handler → domain → repository.

---

## 2. Endpoints

Forty-nine operations, one for every application command and query. Prefix `/api/v1`.

**Cycles** — `GET /cycles`, `POST /cycles`, `POST /cycles/:cycleId/status`,
`POST /cycles/:cycleId/closure`, `POST /cycles/:cycleId/cancellation`,
`POST /cycles/:cycleId/participants`

**Templates** — `GET /templates`, `POST /templates`, `POST /templates/:templateId/retirement`

**Rating scales** — `GET /rating-scales`, `POST /rating-scales`,
`POST /rating-scales/:ratingScaleId/retirement`

**Competencies** — `GET /frameworks`, `POST /frameworks`,
`POST /frameworks/:frameworkId/competencies`, `POST /frameworks/:frameworkId/retirement`

**Goal categories** — `GET /goal-categories`, `POST /goal-categories`,
`PATCH /goal-categories/:goalCategoryId`

**Goals** — `GET /goals`, `POST /goals`, `GET /goals/:goalId`, `PATCH /goals/:goalId`,
`POST /goals/:goalId/approval`, `POST /goals/:goalId/status`, `POST /goals/:goalId/progress`,
`POST /goals/:goalId/closure`

**Reviews** — `GET /reviews`, `GET /reviews/:reviewId`, `POST /reviews/:reviewId/status`,
`POST /reviews/:reviewId/score`, `POST /reviews/:reviewId/completion`,
`POST /reviews/:reviewId/archival`

**360** — `POST /reviews/:reviewId/reviewers`,
`POST /reviewer-assignments/:reviewerAssignmentId/response`,
`POST /reviews/:reviewId/assessments`, `POST /assessments/:assessmentId/items`,
`POST /assessments/:assessmentId/submission`

**Calibration** — `GET /calibration-sessions`, `POST /calibration-sessions`,
`POST /calibration-sessions/:id/status`, `POST /calibration-sessions/:id/decisions`,
`POST /calibration-sessions/:id/conclusion`

**Nine-box** — `GET /talent/matrix`, `POST /talent/placements/:reviewId`

**Feedback** — `GET /feedback`, `POST /feedback`, `POST /feedback/:feedbackId/withdrawal`

**Reconciliation** — `GET /reconciliation`

### Deliberately absent

- **No One-to-One and no PIP routes.** Both are excluded from this phase's scope.
- **No OKR routes.** `performance_objective` and `performance_key_result` have tables, indexes and
  RLS but **no application port and no repository**, so there is no contract to expose. Marked
  `NOT VERIFIED` rather than given an endpoint.
- **No document upload, download or signed-URL route.** See §9.
- **No route that edits a calculated score.** A calibration records a new number beside the
  engine's; there is no field for the original in any DTO, and a trigger refuses an update to it.
- **No bulk endpoint** beyond `POST /cycles/:cycleId/participants`, which is the application's own
  bounded batch command (max 500, re-runnable, each employment confirmed through Employment).
- **No "My Team" route.** See §7.

State transitions are `POST` to a named sub-resource (`/closure`, `/completion`, `/approval`)
rather than a `PATCH` of a status field, matching Onboarding, Documents and Employment.

---

## 3. DTOs

Four files: `performance.dto.ts` (shared primitives + rating scale, framework, goal category),
`template.dto.ts`, `goal.dto.ts` (cycles + goals), `review.dto.ts` (reviews, assessments,
calibration, nine-box, feedback).

**No Prisma model, database row type, domain aggregate or repository object is exposed.** Responses
are the application's published views; a column rename is not an API change.

Every enumeration is **derived from the domain vocabulary rather than retyped** —
`IsIn(CYCLE_KINDS)`, `IsIn(REVIEWER_ROLES)`, `IsIn(FEEDBACK_VISIBILITIES)`. A status the domain adds
is one the API offers; one it removes is a compile error here rather than a route that accepts a
value and answers 422.

Two exclusions are computed rather than hand-listed, so they cannot drift:

```ts
const MOVEABLE_CYCLE_STATUSES = CYCLE_STATUSES.filter(
  (status) => status !== 'closed' && status !== 'cancelled',
);
const MOVEABLE_REVIEW_STATUSES = REVIEW_STATUSES.filter(
  (status) => status !== 'completed' && status !== 'archived',
);
```

Each excluded status carries something the generic move has nowhere to put — a closing actor, a
cancellation reason — so each has its own route.

**No body carries an actor.** No `userId`, no `principalId`, no "submitted by". The acting identity
comes from the authenticated request context and nowhere else.

---

## 4. Validation

`class-validator` at the edge with the global `ValidationPipe`
(`whitelist`, `forbidNonWhitelisted`, `transform`). Every input boundary validates required fields,
UUIDs, enums, civil dates, pagination, numeric ranges, weights, version numbers, string lengths and
collection sizes.

The division of labour is kept: **the API validates shape, the domain validates semantics.** A `kind`
of `fortnightly` is a 400; a duplicate cycle code is a 409; a score outside the configured scale is a
422. All three are asserted.

`forbidNonWhitelisted` is tested rather than assumed — sending `tenantId` alongside a valid body is
refused with the field named, which is what stops a client smuggling a field the API never declared.

---

## 5. Exact decimal handling

**A score is a whole number of hundredths and a weight a whole number of basis points, at every
layer.** `@IsInt` everywhere, never `@IsNumber`. There is no `numeric` column in this module, so
there is no decimal to serialize as a string and none is invented — `370` on the wire is the integer
the engine computed, and `JSON.stringify` of an integer that small is lossless.

One value **is** a string, and for the repository's established reason: `observedValue` on a goal
progress entry is a `bigint`, and a JSON number above 2^53 is not the number that was sent. It is
matched as `/^-?\d{1,30}$/`, parsed with `BigInt` and never with `Number`, and returned as a string.
Payroll carries monetary amounts the same way.

Regression tests (§10 in `performance.lifecycle.spec.ts`):

| Case | Asserted |
| --- | --- |
| normal score | 350 goals @60% + 400 competencies @40% = **370**, and `Number.isInteger` |
| rounding boundary | 375 @60% + 400 @40% = **385**, a whole hundredth |
| configured minimum | **100** round-trips; review scores **220** |
| configured maximum | **500** round-trips; review scores **460** |
| zero | **refused 422** — zero is not a score on a scale whose minimum is 100, and it is refused rather than clamped |
| large exact value | **`9007199254740993`** round-trips, and is explicitly asserted *not* to be `…992` |
| decimal input | `45.5` refused **400** |
| weight above one whole | `10001` refused **400** |

`Number(...)` and `parseFloat(...)` appear **nowhere** in the API layer on a Performance value.
Audited in §11.

---

## 6. Date handling

A civil date is `YYYY-MM-DD` on the wire, matched as a pattern rather than parsed as a `Date` — a
start date is the same date in every time zone and an ISO instant is not. One conversion, in one
place:

```ts
export const civil = (value: string): Date => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Not a civil date: ${value}.`);
  return parsed;
};
```

The `Z` is explicit and never inferred. `new Date('2026-01-01T00:00:00')` is the *server's* local
midnight, which west of UTC is the 31st of December — a cycle that started a day early because of
where a container happened to run.

**The Phase 8 defect is now a compile error.** Every controller destructures each date field out of
the body *before* spreading the rest, so a string reaching a command beside the `Date` meant to
replace it types as `string | Date` and does not build. That is precisely how it was caught while
writing `cycle.controller.ts`:

```
error TS2379: Types of property 'selfAssessmentDue' are incompatible.
  Type 'string | Date' is not assignable to type 'Date'.
```

Tested: goal start date, goal due date, cycle period start and end all round-trip as the same civil
date through the wire, the `date` column and the `to_char` read. An ISO instant (`2026-06-30T00:00:00Z`)
and a non-date (`30/06/2026`) are both refused 400.

---

## 7. Authentication and authorization

**Authentication is the existing platform mechanism.** `AuthenticatedTenantGuard` runs as
`APP_GUARD`; the acting identity comes from the established request context. No route trusts a
`userId`, `employeeId` or `managerEmploymentId` in a body as proof of identity. A request with no
principal is **401** — asserted, because without the guard it would surface a
`TenantIsolationException` from somewhere deep as a 500.

**Authorization is the kernel's pipeline and nothing else.** Each application handler declares the
permission it requires and the pipeline enforces it before the handler runs, so a controller cannot
widen access by forgetting a guard and cannot narrow it either. There is no second authorization
layer in the API.

### `read-team` remains NOT VERIFIED

```
read-team principal resolution = NOT VERIFIED
```

A caller holding `review.read-team` (or `goal.read-team`) and nothing else reads **nothing**,
whatever they supply. `managerEmploymentId` is honoured only alongside `review.read-all`, where it
narrows a caller who could already read everything and therefore escalates nothing.

There is no "My Team" endpoint, no impersonation, and no derivation of manager identity from a target
record. The query parameter exists as a **filter**, and the empty result is exposed honestly rather
than the capability being faked.

### Security test matrix

`performance.security.spec.ts`, over real PostgreSQL as an unprivileged role — 9 tests:

1. no authenticated principal → **401**, not 500
2. tenant A's cycles and reviews invisible to tenant B, **items and totals both zero**
3. tenant B naming tenant A's review by identifier → **404, not 403**
4. caller with no permission → **403**, naming the permission
5. **a review's own manager does not grant a `read-team` caller access to it**
6. invited reviewer succeeds; uninvited refused **403** naming `assess-peer`
7. reviewer invited to one review cannot assess another
8. a caller holding `complete` but not `calibrate` cannot schedule calibration
9. Problem Details carries no stack trace, SQL, table name or `.ts:line`

Test 2 asserts the **total** as well as the items: a count computed without the tenant predicate
leaks how many reviews exist elsewhere even when no row comes back.

### The review-authorization regression (§12 of the checkpoint)

Mandatory scenario, asserted in test 5:

```
Caller A (read-team only) → GET /reviews/{B} → Review B belongs to Manager B → 404
```

and the same for the collection read, which returns an empty page with a total of zero. The target
review never establishes the caller's authority.

### Reviewer authorization (§13)

| Case | Result |
| --- | --- |
| assigned reviewer | **201** |
| unassigned reviewer, same permission | **403** `Requires performance.assess-peer.` |
| reviewer from another tenant | **404** (the review is invisible) |
| reviewer assigned to another review | **403** |
| completed review, mutation | **422** |

The application-layer defect where `authorizationFor` returned a string on both paths — so **every**
invited reviewer was refused — stays fixed, and test 6 is its regression test at the HTTP boundary.

---

## 8. Problem Details

RFC 9457 through the existing global `ProblemDetailsFilter`. Mapping, written once in
`api/handler-result.ts`:

| Failure | Status |
| --- | --- |
| `validation` | 400 |
| `forbidden` | 403 (names the permission; discloses nothing about data) |
| `not_found` | 404 (also the answer for a record the caller may not see) |
| `conflict` | 409 |
| `rejected` | 422 (a catalogue key, so the portal renders it in the reader's language) |
| stale version (`ConcurrencyException`) | **409** — see §12, defect 1 |

400 versus 422 is the distinction that matters: a malformed request is the client's mistake and it
can fix it by sending different bytes; a refused rule is a well-formed request the domain declined,
and a client that saw 400 would retry with a different payload forever.

Asserted: no response body contains a stack trace, SQL, a table name, a Prisma internal or a
`file.ts:line`. Correlation and request identifiers are included, as in every other module.

---

## 9. Documents

One question — does this document exist — and the response carries **the identifier and nothing
else**. Asserted: the goal view has no `url`, no `downloadUrl` and no `storageReference`. Citing a
document that does not exist is refused 422.

```
Binary document upload / download / signed URLs = NOT VERIFIED
```

No upload route, no download route, no signed-URL generation, no malware-scan status. `StoragePort`
has no adapter anywhere in this repository, and no field here implies otherwise.

---

## 10. 360 confidentiality

```
true 360° anonymity = NOT VERIFIED
```

Every row carries `created_by`, the correlation identifier records the request, and row-level
security is tenant-scoped. Below a template's minimum the panel aggregate is **withheld** — the field
is named `available`, and the response is asserted to contain `available` and **not** `anonymous`.
Withholding a number is the only protection this architecture provides; the API does not claim more.

Self and peer assessments are recorded, readable and **contribute nothing to the score**. Asserted:
a submitted self assessment is readable in full with its score, and the view carries no
`weightBasisPoints`, no `contribution` and no `countedTowards`. No weight was invented for either.

---

## 11. Regression audit (§31)

`grep` over `packages/modules/performance/src/api` and `apps/api/src/performance`:

| Pattern | Result |
| --- | --- |
| direct Prisma | none |
| direct SQL | none |
| import from `infrastructure/` in a controller | none |
| `Number(<score>)` / `parseFloat` | none |
| floating-point arithmetic on a score | none |
| `as unknown as` / `as Query` | none (one occurrence is a doc comment explaining why it is not used) |
| `system:auto-approval` | only in doc comments stating it is refused |
| client-controlled authorization | none — §7 |
| target-record-derived authorization | none — §7 |
| unbounded `findMany` / unbounded collection | none — every collection is paged |
| `.only(` | none |
| `it.skip` / `describe.skip` | only the established `CONNECTION === undefined` guard, with `requireDatabaseInCi` throwing rather than skipping in CI |
| `eslint-disable` | none |
| `any` | none |

---

## 12. Defects found and fixed

**1. A lost optimistic-concurrency race answered HTTP 500.**

Original evidence:

```
× refuses a stale version with 409 rather than silently overwriting or answering 500
  → expected 409 "Conflict", got 500 "Internal Server Error"
```

`ProblemDetailsFilter` mapped only `HttpException`; a `ConcurrencyException` thrown by
`Repository.updateRow` escaped as an unhandled error. **This affected the whole product, not only
Performance** — no module had a test that drove a stale version through HTTP, so nothing had looked.
It is a genuine compatibility defect and is documented here as one.

Fixed in `apps/api/src/errors/problem-details.filter.ts`, which is the single place that turns an
escaped exception into a response; a copy per module is a copy that goes missing. A stale write now
answers **409** with `The record changed since it was read. Read it again and resend.`, and the
regression test asserts the first writer's change stands and the version is 2.

**2. `read-team` accepted a client-supplied manager identifier as proof.**

`reviewScopeFor` carried a comment saying the scope must be empty, directly above code that resolved
whichever manager the caller named:

```ts
// Refusing the claim outright is the only position that is not an IDOR, so the scope is empty
return request.managerEmploymentId === undefined
  ? { kind: 'none' }
  : teamOf(dependencies, request.managerEmploymentId);   // ← did the opposite
```

Over HTTP this is `GET /reviews?managerEmploymentId=<anyone>` and a whole team's reviews. No test
had covered it: the existing visibility test exercised `read-team` **without** a manager identifier,
and the succeeding case ran on a `read-all` harness. Fixed in `authorization.ts` — a `read-team`
caller resolves to `{ kind: 'none' }` whatever they name — and the same for `goalScopeFor`. Test 5 of
the security suite is the regression test.

**3. A recorded measurement could be written but never read back.**

`record-goal-progress` accepts `observedValue` as a `bigint` and persists it, but `GoalProgressView`
had no such field, so nothing could read it. Building the API is what surfaced it: §7 of the
checkpoint asks for a large-exact-value regression test, and there was no route by which the value
could come back. Added to the view as an exact decimal **string**, mapped with `String(bigint)` and
never `Number(bigint)`.

**4–7. Four wrong assumptions in my own tests, corrected against the code.** Preserved because each
records a real property of the module:

- Component scores come back in no contracted order; the test now looks components up by name rather
  than by position.
- Approving an already-approved goal is a **422** (business refusal), not a 409 — so the concurrency
  test was rewritten around two `PATCH`es that are both business-valid and differ only in staleness.
- A review is completed from `manager_assessment`; scoring does not imply the manager has finished,
  and the transition is refused rather than inferred.
- Enrolment records **no** notification intent — nobody is told they are being reviewed, because
  nothing can tell them. Inviting a reviewer records one. The test now asserts both.

**8. An asymmetry that was investigated and deliberately not changed.**

Writing a peer assessment is gated by `performance.assess`; `performance.assess-peer` gates
*responding to an invitation*. So an external peer reviewer must hold `assess`, whose documentation
describes it as "writing an assessment of somebody one manages". What actually narrows the peer path
is the invitation lookup, not a distinct permission — and that lookup is tested in both directions.
Changing it would mean a handler declaring two acceptable permissions, which the kernel pipeline does
not support; that is a kernel change beyond this checkpoint. Recorded as technical debt in §15.

---

## 13. Real-database API tests

There is **no in-memory Performance API harness**. This module's two most consequential properties —
tenant A cannot reach tenant B, and a completed review cannot be edited — are both properties of the
database, and a suite over a `Map` would report them without having checked either.

`performance-api.fixture.ts` runs the real controllers, the real global filter and validation pipe,
the real dispatcher, the real application handlers, the **real PostgreSQL repositories** and the real
cross-module adapters under real bounded service grants, connected as
`performance_api_fixture` — a role that **owns nothing and holds no `BYPASSRLS`**. Employment,
Organization and Documents answer as stub query handlers on the same dispatcher, so a change to any
of their published contracts breaks the suite.

**Every state the suites reach was reached over HTTP.** Nothing is seeded directly: `configure()`
defines the scale, framework, competencies and template and opens the cycle through real requests, so
a security test never passes against a database state no client could have produced.

The complete path is proved end to end:

```
HTTP → controller → DTO validation → application handler → domain → PostgreSQL repository → database
```

| Suite | Tests |
| --- | --- |
| `performance.security.spec.ts` | 9 |
| `performance.lifecycle.spec.ts` | 11 |
| `performance.contract.spec.ts` | 7 |
| `phase-thirteen.cross-module.spec.ts` | 1 |
| `phase-thirteen-boundaries.cross-module.spec.ts` | 7 |

`@work/api`: **30 files, 219 tests, all passing.**

### Pagination

Every collection is bounded (default 50, maximum 200), clamped at the edge as well as in the handler
because a page size arrives as a string and `Number('abc')` is `NaN`, which compares false against
every bound. Asserted: first page, middle page, final page, empty page, `size=100000` clamped,
`size=abc&page=-4` falling back to the default, and — across two pages of three reviews — that
**nothing appears twice and nothing is missing**.

### Route resolution

Three prefixes are shared between controllers. Asserted rather than commented: `talent/matrix`,
`reconciliation` and `calibration-sessions` each resolve to their own listing rather than being
swallowed by a `:id` route, and `reviews/:reviewId` still answers 404 for an identifier that is
genuinely an identifier.

---

## 14. Composition root

`PerformanceModule` is registered in `apps/api/src/app.module.ts`, dispatching through the shared
`Dispatcher` the identity module assembles. It uses the already-verified production wiring:
`postgresPerformanceStores()`, the four production cross-module adapters, the real application
handlers, the platform guard and `GrantAwarePermissionChecker`.

**No parallel service instance and no in-memory store reaches the production composition.**
`performance.composition.ts` constructs `postgresPerformanceStores()`; `inMemoryPerformanceStores` is
imported by no file under `apps/api`.

---

## 15. Performance observations

No benchmark was run — out of scope for this checkpoint. What was looked for:

- **N+1 queries.** `readReviewHandler` fetches reviewers, assessments, component scores, decisions,
  snapshot and cycle in one `Promise.all`; the per-assessment item reads are a genuine fan-out
  bounded by the number of assessments on one review (three in the worst realistic case).
- **Unbounded collection reads.** None. Every collection route pages.
- **Repeated cross-module lookups.** `reviewScopeFor` calls Employment once per request, not per row.
  A `read-all` caller with no manager filter makes **no** cross-module call at all.
- **Large payloads.** The review detail read is the largest response and is bounded by one review's
  own assessments; the collection reads return summary views without working.

The query plans from the PostgreSQL checkpoint still apply: the manager queue and the paging count
are index scans at 100,000 reviews, sub-millisecond, with RLS in the plan.

### Technical debt

- Writing a peer assessment requires `performance.assess` rather than `performance.assess-peer`; the
  narrowing is done by the invitation lookup. See §12, defect 8.
- `performance_objective` and `performance_key_result` have tables, indexes and RLS but no
  application port, no repository and no route.
- `RecordingNotificationPort` records intent that nothing delivers, in production as in test.

---

## 16. Localization

Refusals travel as **catalogue keys**, not sentences — `performance.rejection.review-transition-refused`
— so the portal renders them in the reader's language. No English or Arabic string is hardcoded in a
controller or DTO. The 140 rejection keys plus conflict, title and vocabulary keys were completed at
the application checkpoint and needed no additions: the API introduces no new refusal.

`check-localization`: **14 catalogue sets complete.**

---

## 17. Gates

Run with `TEST_DATABASE_URL=postgresql://work:work@127.0.0.1:5432/work_test`, uncached
(`--force`), at `--concurrency=1` — which is the repository's isolation mechanism and is **not**
assumed to be provided by Turbo scheduling.

| Gate | Result |
| --- | --- |
| `check-standards` | no violations |
| `check-architecture` | 143 models, no violations |
| `check-localization` | 14 catalogue sets complete |
| `check-dependencies` | 1226 files, no cycles, no unused dependencies, no unreachable files |
| `format:check` | all files match Prettier |
| `lint` | 41/41 |
| `typecheck` | 41/41 |
| `test` | **41/41 tasks, 0 cached** |
| `build` | 24/24 |

`@work/performance`: 17 files, 127 tests. `@work/api`: 30 files, 219 tests.

**No skipped tests, no disabled tests, no `.only`, no hidden failures.**

---

## 18. NOT VERIFIED

Unchanged from the PostgreSQL checkpoint. Each is a missing dependency, not a broken implementation,
and none is faked by any route.

- **`read-team` without a trusted manager employment.** No principal → employment resolution exists.
  A `read-team` caller reads nothing; the API exposes that honestly.
- **Principal → employment self-service routing.** `review.read-own` and
  `feedback.read-about-self` are declared and route to nothing.
- **Notification delivery.** Intent is recorded; nothing delivers it.
- **Scheduled execution.** Nothing closes a cycle or opens a window on a timer.
- **Binary document upload, download and signed URLs.**
- **True 360° anonymity.** Confidentiality, not anonymity.
- **Self and peer assessment weighting.** Both recorded and readable; neither counted.
- **OKR sub-structure.** Tables and RLS; no application contract, so no route.

---

## Status

**Phase 13 — API LAYER COMPLETE**

Forty-nine endpoints across seventeen controllers over the complete approved application capability;
DTOs derived from the domain vocabulary; validation at the edge and semantics in the domain; exact
integer scores and one exact decimal string, each regression-tested at its boundaries; civil dates
that survive the wire, the column and the read, with the Phase 8 defect now a compile error; RFC 9457
Problem Details that leak nothing; bounded, deterministic pagination; optimistic concurrency that
answers 409 rather than 500; and a security matrix — tenant, permission, ownership, manager,
reviewer, calibration, immutability, concurrency, validation — run over real PostgreSQL with
row-level security on, as a role holding no `BYPASSRLS`.

Stopping here. No Admin UI, no frontend, no benchmarks, no next phase.
