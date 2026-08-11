# Phase 13 — application layer checkpoint

**Status: APPLICATION LAYER COMPLETE.** PostgreSQL repositories, the API, the Admin UI, production
cross-module adapters and benchmarks are the next checkpoint and are **not** claimed here.

Continues from `0b6ed7e` (schema), `73daea7` (domain) and `fa21a7b` (lockfile). No completed phase
was modified — see §5, which is the most consequential finding in this checkpoint.

---

## 1. What was implemented

The complete application layer for `@work/performance`: the module declaration, thirty-six commands,
thirteen queries, seventeen permissions, four cross-module ports, the in-memory stores, the
application harness and 90 tests.

**Nothing was seeded.** Every test builds its world through the real dispatcher, the real permission
check and the real handlers, exactly as an administrator or a manager would. A scenario that wrote
rows directly would prove the queries work against data no command could have produced.

`pnpm standards` is clean, `pnpm --filter @work/performance lint` and `typecheck` are clean, the
package builds, and every one of the 90 tests runs — none skipped.

---

## 2. Commands

Thirty-six, grouped by what they change.

| Area | Commands |
| --- | --- |
| Rating scales & categories | `define-rating-scale`, `retire-rating-scale`, `define-goal-category`, `set-goal-category-active` |
| Competencies | `define-framework`, `define-competency`, `retire-framework` |
| Templates | `define-template`, `retire-template` |
| Goals | `create-goal`, `update-goal`, `approve-goal`, `move-goal`, `record-goal-progress`, `close-goal` |
| Cycles | `create-cycle`, `move-cycle`, `close-cycle`, `cancel-cycle`, `enrol-participants` |
| Reviews & 360° | `assign-reviewer`, `respond-to-assignment`, `move-review`, `complete-review`, `archive-review` |
| Assessments | `start-assessment`, `record-assessment-item`, `submit-assessment`, `score-review` |
| Calibration & nine-box | `schedule-calibration`, `move-calibration`, `record-calibration-decision`, `conclude-calibration`, `record-placement` |
| Feedback | `give-feedback`, `withdraw-feedback` |

Four deliberate shapes:

- **A rating scale is defined whole, with its levels.** The invariant is about the *set* — the levels
  must tile the scale end to end with no gap and no overlap — so a scale assembled level by level
  would spend most of its life in a state the domain refuses. The same reasoning gives templates and
  competencies their all-at-once commands.
- **`score-review` is a command, not a query.** It returns a number but writes the review's calculated
  score and the working behind it. Routing it as a query would put a write on the read path and make
  the working look optional.
- **Closure, cancellation, completion and conclusion each have their own command**, and the generic
  `move-*` commands refuse those targets. A cycle that reached `closed` through a generic transition
  would have nobody's name against it.
- **No command for one-to-ones or PIPs**, which are outside the approved scope, and none for anything
  in Compensation, Employment, Organization or Learning. Performance measures and decides nothing.

---

## 3. Queries

Thirteen. `rating-scales`, `frameworks`, `templates`, `goal-categories`, `cycles`, `goals`,
`read-goal`, `reviews`, `read-review`, `calibration-sessions`, `talent-matrix`, `feedback`,
`reconciliation`.

Every collection is bounded — default 50, maximum 200 — and every DTO is an explicit view type in
`contracts/`. No Prisma type, no row, no domain aggregate and no `Map` crosses the boundary.

**The scope bound goes into the store call, not around its result.** Filtering afterwards would mean
the rows had already left the database, and a count of what was then removed is itself a disclosure:
"your colleague has a review in this cycle" is information.

---

## 4. Permissions

Seventeen, deliberately more granular than any module before this one.

`configure` · `configure.read` · `cycle.manage` · `cycle.read` · `goal.read` · `goal.manage` ·
`goal.read-team` · `review.read-own` · `review.read-team` · `review.read-all` · `assess` ·
`assess-peer` · `reviewer.manage` · `calibrate` · `complete` · `talent.read` · `talent.manage` ·
`feedback.give` · `feedback.read-about-self` · `feedback.read-team` · `summary.read` · `reconcile`.

Four separations carry weight:

- **`review.read-team` versus `review.read-all`.** A manager reading their own reports is a different
  capability from HR reading the organization, and one permission covering both is exactly how a
  manager comes to read a peer's review.
- **`assess` versus `assess-peer`.** A reviewer invited for one review should not thereby be able to
  assess anybody.
- **`calibrate` versus `complete`.** Moving a rating in a meeting and signing a review off are
  different decisions; one permission covering both would let whoever ran the meeting finalize its
  outcomes unreviewed.
- **`reviewer.manage` versus `assess-peer`.** Inviting a 360° panel is not the same act as answering
  an invitation.

---

## 5. Cross-module contracts, and the D-31 finding

| Producer | Contract consumed | Grant the adapter will need | Failure behaviour |
| --- | --- | --- | --- |
| Employment | `employment.read-employment` | `employment.employment.read` | Refuse. An employment that cannot be confirmed is not a participant |
| Employment | `employment.search` filtered by `managerEmploymentId` | `employment.employment.read` | Refuse. A manager queue with no resolvable reports is empty, never unbounded |
| Organization | `organization.governing-legal-entity` | `organization.legal-entity.read` | Snapshot omits the legal entity; completion still succeeds |
| Documents | published document read | `document.read` | Evidence is optional; absence refuses the *reference*, not the goal |
| People, Compensation, Payroll | — | — | **Not read at all.** A review displays an employment, never a name and never a salary |

### D-31 is not needed. The capability already exists.

The Phase 13 plan recorded, in §11 and in decision D-31, that *"no published query takes a manager
and returns their reports"*, and the approved scope authorised a small additive change to Employment
to add one.

**That reading of Employment was wrong, and the additive change was not made.** `employment.search`
already accepts `managerEmploymentId`, resolves it against `employment_reporting_line` as of a date
(`employment-search.ts`, `reportsTo`), is indexed, is bounded and cursor-paged, and carries an
integration test named *"finds everybody reporting to a manager on a date"*
(`employment-search.integration.test.ts`). It is the exact question D-31 asks.

So `EmploymentPort.directReportsOf` is declared in Performance, will be adapted onto
`employment.search` in the next checkpoint, and **no completed phase was modified**. Adding a second,
redundant contract to Employment would have been a change to a finished module in order to duplicate
a capability it already publishes.

This is reported rather than assumed: if the approver intended D-31 to add a *narrower* contract than
`employment.search` — one that returns only employment identifiers rather than full employment views
— that is a defensible position, and it is a decision to take before the production adapter is
written in the next checkpoint. Nothing in this checkpoint forecloses it.

### The `DocumentReferencePort` answers one question

Whether a document identifier exists. It resolves nothing, fetches nothing, returns no URL and
stores no filename, size or hash. The default in production and in the harness is
`documentsUnavailable`, which answers `false` to everything — because `StoragePort` has no adapter
anywhere in this repository.

---

## 6. Scoring

The approved D-6 semantics live in `domain/scoring.ts` and are assembled in
`application/scoring.service.ts`. Nothing else in the module computes a score.

Three assembly rules are approved decisions rather than conveniences, and each is asserted:

- **Weights come from the goal, not from the assessment line.** An assessor rates; a tenant weights.
  A line whose weight came from whoever filled the form in would let an assessor change what a goal
  counts for by typing a different number.
- **A cancelled goal is excluded before the engine sees it**, carrying `cancelled` as its reason, so
  it cannot reach the denominator by any path a command can take.
- **The manager assessment is what a review is scored from.** Self and peer assessments are recorded,
  kept and shown; they do not enter the calculation, because nothing approved says how they would be
  weighted against the manager's, and inventing a weight is exactly what the brief forbids.

### The seventeen golden cases

All through the whole application layer, in `performance-scoring.test.ts` and
`performance-scoring-outcomes.test.ts`. Every expectation is the arithmetic written out.

| # | Case | Assertion |
| --- | --- | --- |
| 1 | Normal weighted goals | `(400×7000 + 200×3000)÷10000 = 340`; final `(340×6000 + 300×4000)÷10000 = 324` |
| 2 | Weighted goal boundary | One goal at full weight reaches the scale maximum, 500, unclamped |
| 3 | Competency average | `(100 + 500)÷2 = 300`, unweighted |
| 4 | Combined components | `(500×6000 + 100×4000)÷10000 = 340`; an unweighted mean would be 300 |
| 5 | Rounding boundary | `300.6 → 301` |
| 6 | Half away from zero | `301.5 → 302`, then `300.8 → 301` |
| 7 | Missing component | `400`, not `240` — the unassessed component leaves the denominator |
| 8 | Incomplete component | `included: false`, `exclusionReason: 'missing'`, persisted as the working |
| 9 | Cancelled goal | `400`, not `240` — no score and no denominator weight, despite a live weight on the row |
| 10 | Zero-weight goal | Scored, and counts for nothing |
| 11 | Empty scored-goal denominator | An assessment with no lines cannot be submitted at all |
| 12 | Empty competency denominator | Every component excluded → `scoring-nothing-assessed`, never zero |
| 13 | Invalid component weights | `review-template-component-weights-not-total`, refused at definition |
| 14 | Out-of-range assessed item | `assessment-item-score-out-of-range`; a clamp would have produced 500 |
| 15 | Out-of-range calibration | `calibration-score-out-of-range` |
| 16 | Calibration override | The calibrated value becomes effective |
| 17 | Original preserved | `calculatedScore` stays 300; the decision carries `originalScore: 300` and `calibratedScore: 450` |

### Where the component weights are enforced

Three places, because a rule enforced in one is a rule some later bulk path will bypass: the domain
when a template is defined, the engine before a review is scored, and the reconciliation query.

---

## 7. Immutability at the application layer

The database triggers are the final protection; nothing here depends on them.

| Artefact | Refused by the application |
| --- | --- |
| Submitted assessment | `recordItem` and `submitAssessment` refuse; the in-memory store refuses an item write against a submitted parent |
| Completed review | `recordScore`, `applyCalibration`, `startAssessment` and a second `completeReview` all refuse |
| Calibration decision | The store offers insert and read only; a second decision on the same review in the same session is refused |
| Goal progress | Insert-only store; no update method exists |
| Completion snapshot | Insert-only; one per review |
| Feedback | Insert and withdraw; no edit path, and withdrawal leaves every word in place |

**The vacuous "unique partial index on the completed review" from the old plan was not added**, per
the checkpoint instruction and for the reason the migration already records: one row cannot collide
with itself.

---

## 8. Concurrency at the application layer

`performance-refusals.test.ts` runs two completions of one review concurrently, both holding the
version they read. **Exactly one succeeds and exactly one is refused**, deterministically, by the
optimistic version. A third sequential attempt is refused by the aggregate.

The refusal travels as `ConcurrencyException` rather than as a `Result`, which is what every module
since Phase 2 does and what the edge turns into a 409. The in-memory stores raise the same exception
the real `Repository.updateRow` raises on a version mismatch, so the race is a race here too.

**Database-level concurrency is not claimed.** Two real PostgreSQL connections against real
constraints belong to the next checkpoint.

---

## 9. Historical reproducibility

`performance-journey.test.ts` completes a review, then retires the rating scale, retires the
competency framework, retires the template and moves the employment to a different manager and unit.

**Not one number moved.** The final score, the manager at completion, the organizational placement,
the four rating levels, the framework version and every component score read exactly as before.

The snapshot is written in the same transaction as completion — a completed review with no snapshot
is a rating that stops being explainable the moment somebody reorganizes a department, so the two are
not separable operations. It carries no person's name, no pay figure and no identifier; the domain
exports `carriesForbiddenData`, and the domain suite asserts an empty result against a real snapshot.

---

## 10. 360° confidentiality

**True 360° anonymity: `NOT VERIFIED`.**

What is implemented is reviewer *confidentiality and access control*: a multi-rater aggregate is
withheld below the template's `minimumPeerResponses`, and the view says `available: false` with no
scores rather than presenting one person's opinion as the group's.

What is **not** implemented, and cannot be with this architecture:

- every row carries `created_by`;
- every reviewer assignment names the reviewer's employment;
- every assessment names its assessor;
- row-level security is tenant-scoped, and the correlation identifier records the request.

Nothing was removed to fake anonymity. `created_by` is intact, RLS is untouched, and the vocabulary
has **no `anonymous` feedback visibility and no anonymous reviewer role** — the domain suite asserts
that `visibility: 'anonymous'` is refused as an unknown value. Hiding a name in a screen is not
anonymity, and this module does not claim it is.

---

## 11. Defects found and fixed

Four, all found by tests rather than by reading.

1. **The scoring engine reported `not_applicable` for a component nobody assessed.** Three genuinely
   different situations were collapsing into one: no lines at all (nobody assessed it), all lines
   excluded (their reason), and lines that were assessed but weigh nothing (the arithmetic has
   nothing to divide by). A review where the whole competency section was skipped therefore read as
   "competencies do not apply", which sounds like a configuration choice rather than work nobody did.
   Fixed by `absentReason`; found by application golden case 8.

2. **`readReviewHandler` derived the caller's scope from the review's own manager.** That was a free
   pass wearing the shape of a check: a review always has a manager, and that manager always has it
   among their reports, so *any* `read-team` caller could read *any* review. The scope now comes from
   the caller. Found by the journey suite, which moved an employment to another manager and could no
   longer read a completed review.

3. **`authorizationFor` conflated success with refusal.** It returned the reviewer-assignment
   identifier on success and a permission name on refusal — both strings — so the caller's
   `typeof … === 'string'` check refused every invited reviewer. Replaced with a discriminated
   verdict. Found by the refusals suite.

4. **Completion inserted the snapshot before the version-guarded update.** The loser of a completion
   race therefore met the snapshot's unique index rather than the optimistic version, and failed with
   a constraint violation naming a table nobody had asked about. Same outcome, unreadable reason.
   Reordered. Found by the concurrency test.

---

## 12. `NOT VERIFIED`

Named as missing dependencies, not as deferred features.

| Capability | Why |
| --- | --- |
| **Employee self-service routing** — "My Goals", "My Review" | No principal-to-employment resolution (ADR-0032). `review.read-own` and `feedback.read-about-self` are declared and route nowhere |
| **`read-team` bound to the caller's own employment** | Same cause. A `read-team` caller must name the manager they claim to be, and nothing can check the claim. The scope is empty without one, and refusing to verify it is the only position that is not an IDOR |
| **Notification delivery** | The port records intent; nothing delivers. No screen may imply anybody was told |
| **Scheduled execution** | `JobPort` has no adapter. Overdue is a query somebody runs, not a sweep. Nothing fires |
| **Evidence upload and download** | `StoragePort` has no adapter. Performance stores an identifier and no bytes |
| **True 360° anonymity** | §10 |
| **Generated appraisal letters, signed reviews** | No renderer and no signature provider (Phase 12 D-15, D-16) |
| **Workflow-routed approval** | Workflow is Phase 16. `AutoApprovingPort` is not a substitute, and `system:auto-approval` is refused for every decision somebody is accountable for |
| **Cross-tenant isolation** | Row-level security's, and proved against a real database as an unprivileged role in the next checkpoint. `InMemoryUnitOfWork` ignores the ambient tenant, so no test here claims otherwise |
| **Database-level concurrency** | §8 |

---

## 13. Technical debt

- **`employment.search` returns a full `EmploymentView` where the port wants three fields.** The
  adapter will narrow it, but the *grant* still reaches the whole view. A narrower published contract
  would be better; see §5.
- **Self and peer assessments do not enter the score.** Correct under the approved decisions, and
  it will look like an omission to anybody who has not read them. It is stated in the code and here.
- **The application layer cannot bind a caller to an employment**, so three commands accept an
  employment identifier and check it (`start-assessment`, `give-feedback`,
  `record-calibration-decision`). Each check makes the identifier buy nothing the reporting line or
  the invitation did not already grant, but the shape disappears the day ADR-0032 is answered.
- **The ninth copy of a paged-result helper** will arrive with the PostgreSQL repositories, as Phase
  12's report predicted.
- The **pre-existing concurrent-integration-suite fragility** recorded in the Phase 12 report now has
  a fifteenth module to collide with.

---

## 14. What remains

- PostgreSQL repositories and row mappers
- Integration suites: RLS as an unprivileged role, concurrency on two real connections, immutability
  against the seven triggers including their permitted cases, historical reproducibility
- Production cross-module adapters and composition-root wiring, under bounded service grants
- API controllers, DTOs and the authorization suite at the HTTP edge
- Admin UI — no screen for anything in §12
- Benchmarks under RLS at 10,000 and 100,000 employments
- `docs/verification/phase-13-report.md` and the documentation updates

**Phase 13 — APPLICATION LAYER COMPLETE**
