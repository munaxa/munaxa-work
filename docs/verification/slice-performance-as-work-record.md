# Product Slice #7 — Performance as Work

Authorized after `docs/verification/next-product-direction-investigation.md` (commit `09fbb03`)
classified Performance as the only class-A product candidate. This is a product vertical slice, not
a numeric phase, and no new numeric phase was created.

**Nothing in the Performance domain, application, infrastructure or contracts changed.** No route,
migration, table, permission, contract, aggregation or event was added to the module. The slice is
composition: it consumes reads that already existed, and it consumes the one that no screen ever
had.

---

## A. What shipped

| Route | State | Backed by |
| --- | --- | --- |
| `/performance` | rewritten | the register: cycle, queue, goals, outcomes, configuration |
| `/performance/reviews/[reviewId]` | **new** | `GET /api/v1/performance/reviews/:reviewId` |
| `/performance/goals/[goalId]` | **new** | `GET /api/v1/performance/goals/:goalId` |

Each detail route carries its own `loading.tsx` and `not-found.tsx`; the register carries a
`loading.tsx`. Admin route count for Performance: **1 → 8 files across 3 routes.**

Files under `apps/admin/src/performance/`:

| File | Lines | |
| --- | ---: | --- |
| `api.ts` | 319 | rewritten — `Outcome`/`Listing`, one round of reads, no record selected for the reader |
| `frame.tsx` | 321 | new — the design language the six completed slices established |
| `exact.ts` | 64 | new — the values these screens must not alter |
| `tones.ts` | 76 | new — how each closed vocabulary reads at a glance |
| `locale.ts` | 102 | rewritten — module catalogue + portal catalogue, `personIn` added |
| `register.tsx` | 307 | new — cycle summary, review queue, goal list, cycle list |
| `configuration.tsx` | 261 | rewritten — scales, frameworks, templates, categories |
| `outcomes.tsx` | 282 | new — calibration, nine-box, feedback, reconciliation |
| `review.tsx` | 295 | new — header, rating, working |
| `assessments.tsx` | 346 | new — panel, assessments, snapshot |
| `goal.tsx` | 253 | new — header, statement, progress history |
| `scoring.ts` | 73 | kept, with one substitution removed |
| `performance.fixture.ts` | 332 | new |
| `review.fixture.ts` | 141 | new |

Removed: `overview.tsx`, `goals.tsx`, `reviews.tsx`, `panel.tsx`, `sections.tsx`, `lifecycle.ts`,
`lifecycle.test.ts`, `render.test.tsx`.

---

## B. Backend used — every read, and nothing new

**All thirteen Performance GET routes are now consumed. Before this slice, twelve were.**

| Route | Permission | Where it renders |
| --- | --- | --- |
| `GET /performance/cycles` | `performance.cycle.read` | register + both detail pages (to name a cycle) |
| `GET /performance/rating-scales` | `performance.configure.read` | register |
| `GET /performance/frameworks` | `performance.configure.read` | register |
| `GET /performance/templates` | `performance.configure.read` | register |
| `GET /performance/goal-categories` | `performance.configure.read` | register + goal page (to name a category) |
| `GET /performance/goals` | `performance.goal.read-team` | register queue |
| **`GET /performance/goals/:goalId`** | **`performance.goal.read`** | **the goal page — previously unconsumed** |
| `GET /performance/reviews` | `performance.review.read-team` | register queue |
| `GET /performance/reviews/:reviewId` | `performance.review.read-team` | the review page |
| `GET /performance/calibration-sessions` | `performance.calibrate` | register |
| `GET /performance/talent/matrix` | `performance.talent.read` | register |
| `GET /performance/feedback` | `performance.feedback.read-team` | register |
| `GET /performance/reconciliation` | `performance.reconcile` | register |

One read from outside the module: `GET /api/v1/employments/:employmentId` (Employment's own bounded
read), **at most twice per detail page** — once for the subject, once for the manager a review
names. Never on a list, and never per row.

**Requests per page render, measured in `api.test.ts`:**

| Page | Requests | Grows with rows? |
| --- | ---: | --- |
| register, cycle present | 11 | no — asserted against a 40-cycle tenant |
| register, no cycle | 5 | no — the six scoped reads are not issued at all |
| review detail | 4 | no |
| goal detail | 4 | no |

Eight permissions refuse independently and each is rendered as its own withheld state naming the
permission it needed.

---

## C. The product workflow, derived from the contracts

The smallest complete workflow the published reads support:

1. **Which cycle is running.** The register reads `/cycles`, picks the first open, in-progress or
   calibrating one, and shows its own published fields — code, status, period, participant count,
   manager-assessment due date, calibration due date. Six other reads are scoped to it at the
   server, and every listing says so.
2. **Which reviews are inside it, and where each has got to.** The queue shows the subject, the
   manager, the domain's status, the calculated score and the final score as two separate fields.
3. **One review, opened.** Its rating with the calibration decision beside it, its working with the
   denominator each component was scored against, its panel with each reviewer's response, every
   assessment with a sentence saying whether it contributes, and the completion snapshot.
4. **Which goals those reviews are measured against**, and **one goal, opened** — its statement, its
   target, and the appended progress history with each exact measurement.

An assessed goal on a review opens that goal. A competency does not: Performance publishes no read
for one competency, and a link to a route that does not exist is worse than an identifier.

**What the contracts do not support, and what was therefore not built.** There is no
`GET /performance/summary`: `PerformanceSummaryView` is exported and `performance.summary.read` is
declared, and **neither is backed by a query handler or a route**. So the participant, completion and
average figures that view describes cannot be read — and are not shown. See §L.

---

## D. What changed

**Two detail routes where the product had none.** This is the slice. `/performance` had been the
only Performance route in the application; there was no way to look at one review or one goal.

**Five sections stopped describing an arbitrary record.** `RatingSection`, `WorkingSection`,
`AssessmentsSection` and `PanelSection` were built from `reviews.items[0]` — the first row of the
first page of the running cycle — and `ProgressSection` from `goals[0]`. Nothing on the page named
either record. Those five sections are now on the detail routes, reached by identifier.

**Three browser-counted figures are gone.** The old overview showed, in one grid beside the server's
own totals:

```ts
const open = cycles.filter((each) => each.status === 'open' || each.status === 'in_progress').length;
const completed = reviews.filter((review) => review.status === 'completed').length;
const awaitingManager = reviews.filter((review) => review.status === 'manager_assessment').length;
const awaitingCalibration = reviews.filter(
  (review) => review.calculatedScore !== undefined && review.status !== 'completed',
).length;
```

Each counted the fifty rows the API happened to return. A tenant with 4,187 reviews was told twelve
were complete, in the same grid as the honest figure 4,187, with nothing distinguishing them. The
fourth was worse than a miscount: **`awaitingCalibration` derived a state the domain does not
publish**, from "has a score and is not completed". All four are removed. What is left is the
cycle's own `participantCount` and each listing's `PagedResult.total`.

**One substituted value is gone.** `scoring.ts` carried:

```ts
final: scoreText(review?.finalScore ?? review?.calculatedScore)
```

A review the engine had scored and nobody had completed displayed its **calculated** score in a
column headed *Final score* — on the queue and again on the rating block. That tells a reader a
rating has been settled when it has not, about a person whose rating it is. `ratingFor` is removed;
both fields render as published, and a review with no final score shows none.

**Identifiers are rendered whole.** `short()` — eight characters of a UUIDv7, which is the top 32
bits of a 48-bit millisecond timestamp — was used on seven Performance sections. A review queue is
written by one enrolment run over a cycle, so every row shares the prefix. The slice uses
`reference()`, byte-identical to the one Payroll, Hiring, Leave and Attendance already have.

**`lifecycle.ts` is removed.** It derived, in the browser, which actions a cycle's, review's or
goal's state permits — a rule that lives in the aggregate — and rendered the result for `items[0]`
under a heading that implied it described the section. The portal is read-only and offers no
control, so what a reader needs is the state the domain published: the review page now shows
`status`, `scoredAt`, `completedAt`, `calibrated` and the calibration decision itself.

**Localization.** Performance's catalogues went from 365 to 433 keys in each language, purely
additive, nested throughout. `openGoal`, `openReview`, `boundaries`, `participants`, `denominator`,
nine `withheld.*` sentences naming each permission, and four new closed vocabularies
(`categoryStatus`, `inclusion`, `itemKind`, `findingKind`).

**Navigation.** No change was needed: the shell already carried `/performance`, and `isCurrent`
matches a destination's own sub-paths, so both detail routes highlight it.

---

## E. What was deliberately not changed

- **Performance's domain, application, infrastructure and contracts.** Not one file under
  `packages/modules/performance/src/{domain,application,infrastructure,contracts}` was touched.
- **Permissions.** None added, removed or weakened. The slice uses the eight that exist.
- **Migrations, tables, endpoints, events, aggregations.** None.
- **Writes.** No `POST`, `PUT`, `PATCH` or `DELETE`. Asserted by a test over every composed request.
- **`ApprovalPort` and the approvals integration.** Performance publishes no workflow instance
  identifier on any view this slice reads, so there is nothing to open. No link was invented.
- **Manager workspace.** `managerEmploymentId` is never sent. A test asserts no composed request
  names it, or any other identity.
- **Self-service.** No `/me`, no current-user resolver, no generic cross-module resolver.
- **The completed slices.** Approvals and the Employee Record still truncate identifiers via
  `short()`; that is §J of the direction investigation and remains separate.
- **Other modules' contracts.** Nothing exported, nothing modified.
- **The shared `notFound()` HTTP status.** Not touched. See §L.

---

## F. Product findings from rendered inspection

The application was built from this tree, served against a fixture API, and walked in a real browser
at 1440 px and 390 px in both languages. Four findings, all fixed inside the slice.

**1. Tenant-authored names were not bidi-isolated.** A cycle name commonly carries a year —
`المراجعة السنوية 2026` — which is a Latin digit run inside Arabic text. The cycle summary and four
configuration sections rendered `nameIn(...)` bare. Every one now goes through `<Wrote>`, like every
other authored value. *Found by writing the RTL assertion, which failed on `['2026']`.*

**2. A template's component weights were joined into one string.** `` `${name} ${weight}` `` put a
Latin percentage inside Arabic text; a bare `40.00%` in a right-to-left paragraph renders as
`%40.00`, because the percent sign is neutral. Each weight is now its own `<bdi dir="ltr">`.

**3. The progress table repeated the boundary footnote verbatim.** "A document reference only. There
is no upload, download or link" appeared beneath the table *and* in the footer, four lines apart.
Said once, in the footer.

**4. The panel repeated a second boundary footnote conditionally.** When the peer aggregate was
available the panel printed "Reviewer identity is confidential, not anonymous" — the same sentence
the footer carries. The panel now prints only the state-specific sentence.

Two further duplications were removed from the review page's boundary list for the same reason:
`calibrationKept` and `exactScore` are said beside the numbers they qualify.

**Not a finding:** the review page shows the same person for subject and manager. That is the
fixture API answering every `/employments/:id` with one record, not the product.

---

## G. States verified

Verified against a stub answering each condition, on all three routes.

| State | Register | Review | Goal |
| --- | --- | --- | --- |
| loading | skeleton, no text node at all | skeleton | skeleton |
| populated | ✅ | ✅ | ✅ |
| empty (API answered, nothing in it) | "No review cycle exists yet." | — | "No progress has been recorded." |
| refused (401/403) | "Nothing readable" + the boundary sentence | withheld, naming `performance.review.read-team` | withheld, naming `performance.goal.read` |
| not-found (404) | n/a | not-found page, true for absent **and** out-of-scope | not-found page, absent only |
| withheld per section | six sections each name their own permission | n/a | n/a |

**Refused ≠ empty ≠ not-found, per read.** With the cycles readable and every cycle-scoped read
refused, the register shows the cycle summary and six independently withheld sections:

```
Reviews              Withheld — reading reviews needs performance.review.read-team.
Goals                Withheld — reading goals needs performance.goal.read-team.
Calibration sessions Withheld — reading calibration sessions needs performance.calibrate.
Talent matrix        Withheld — reading the talent matrix needs performance.talent.read.
Feedback             Withheld — reading feedback needs performance.feedback.read-team.
Findings             Withheld — reading reconciliation needs performance.reconcile.
```

**The one route where 404 is deliberately also a refusal.** `GET /performance/reviews/:reviewId`
answers 404 both for a review that does not exist and for one outside the caller's scope, because —
in the module's own words — *"confirming a review exists is the disclosure, because it says somebody
is being appraised"*. The not-found page is written to be true in both cases and says so:

> No review was returned for this identifier. It may not exist, or it may not be yours to read —
> this route answers the same way for both, because confirming a review exists says somebody is
> being appraised.

The goal route is different and its page says only what is true there: *"No goal with this
identifier was returned."*

**Two permissions on one record.** `/goals` needs `goal.read-team`; `/goals/:goalId` needs
`goal.read`. A caller can see a goal in the queue and be refused when they open it. That renders as
withheld naming `performance.goal.read`, never as a goal that does not exist. Verified live.

---

## H. English / Arabic / RTL

Both languages render on all three routes with **no catalogue key reaching the markup** — asserted
across seventeen components in both languages.

Every Latin run inside Arabic is isolated. The assertion strips `<bdi>` elements and the catalogue's
own prose, then fails on any remaining Latin or digit run:

| Surface | Result |
| --- | --- |
| review queue | no bare run |
| goal list | no bare run |
| cycle summary (incl. a year inside a tenant name) | no bare run |
| all four configuration sections | no bare run |
| calibration, talent, feedback, findings | no bare run |
| rating block with a calibration decision | no bare run |
| progress history incl. `9007199254740993` | no bare run |

Two techniques, both carried forward from earlier slices and both re-justified here:

- `<bdi dir="ltr">` for scores and percentages. A decimal point and a percent sign are *neutral*, so
  in an RTL paragraph `3.70` renders `70.3` and `60.00%` renders `%60.00`.
- One isolate for the whole `shown / total` ratio. Isolating only the total leaves the page count as
  a second LTR run, and the later run comes first: `2 / 4187` would render `4187 / 2`.

`?lang=ar` switches language and direction together on the element wrapping everything; asserted on
the register route, including for a repeated `lang` parameter.

---

## I. Desktop / mobile

`document.documentElement.scrollWidth > window.innerWidth` was false on every surface:

| Surface | 1440 px | 390 px |
| --- | --- | --- |
| `/performance` (en) | no overflow | no overflow |
| `/performance` (ar) | no overflow | no overflow |
| `/performance/reviews/[reviewId]` (en) | no overflow | no overflow |
| `/performance/reviews/[reviewId]` (ar) | no overflow | no overflow |
| `/performance/goals/[goalId]` (en) | no overflow | no overflow |

At 390 px the tables scroll inside their own containers while the page does not; identifiers stay
whole and stay legible; scores and percentages stay on one line (`tabular-nums`, `whitespace-nowrap`);
dates never break mid-value; the review's facts block collapses to one column and keeps the subject,
the status and the cycle above the fold.

---

## J. Tests

**106 tests across 7 files**, all new or rewritten for this slice.

| File | Tests | What it holds |
| --- | ---: | --- |
| `register.test.tsx` | 21 | every row opens; no review detail on the register; server totals; identifiers whole; final score not substituted; refused ≠ empty; which cycle is chosen |
| `detail.test.tsx` | 25 | the subject is named or falls back to its identifier; calibration beside the original; the denominator; the recorded exclusion reason; the withheld aggregate; the exact measurement; an assessed goal opens |
| `routes.test.tsx` | 18 | all three routes end to end; 404 raises not-found, 403 does not; direction follows language; the skeleton carries no text; the shell marks the register current |
| `api.test.ts` | 15 | every read bounded; a fixed request round against a 40-cycle tenant; 404 ≠ 403 ≠ unreachable; no write; no identity named |
| `rtl.test.tsx` | 14 | the isolation primitives; no bare Latin run on any Arabic surface |
| `localization.test.ts` | 8 | no dotted key name; catalogue parity; every added key resolves in both languages |
| `scoring.test.ts` | 5 | string surgery, never division; a value past 2^53 |

Whole admin suite: **705 tests passing (was 632).**

Assertions worth naming:

- **No arbitrary `items[0]`** — the register renders none of the four detail headings.
- **No business calculation** — the four removed counters are asserted absent by label.
- **No writes** — every `fetch` call's `init.method` and `init.body` are asserted `undefined`.
- **No identity** — no composed request contains `managerEmploymentId`, `membership`,
  `workforceUser`, `platformUser`, `onBehalfOf`, `/me` or `userId`.
- **No N+1** — a 40-cycle tenant still produces exactly 11 requests.

---

## K. Full gate

`pnpm verify` — `standards && format:check && lint && typecheck && test && build` — run with
PostgreSQL 16 live and `TEST_DATABASE_URL` set, caches deleted first.

**Exit code 0. Nothing failed and nothing was skipped.**

### That this was a run and not a cache replay

`.turbo/cache` and `node_modules/.cache/turbo` were deleted before the command started.

| Stage | Tasks | Cached | Wall clock |
| --- | ---: | ---: | ---: |
| `lint` | 51 | **0** | 1m43.9s |
| `typecheck` | 51 | 22 | 26.7s |
| `test` | 51 | 22 | **7m18.3s** |
| `build` | 29 | 22 | 44.6s |

`standards` and `format:check` are plain node and prettier invocations and report no turbo summary;
both ran and both passed. The "22 cached" entries are **this same run's own outputs** — a stage's 51
tasks include the dependency `build` tasks an earlier stage in this run already executed.

For the stage that matters most this was checked task by task rather than inferred from the summary:
**29 `test` tasks executed, 29 cache misses, 0 cache hits.**

### Actual counts

| | |
| --- | --- |
| Packages running `test` | 29 |
| Packages with test files | 24 |
| **Test files** | **462 passed (462)** — was 458 |
| **Tests** | **5,306 passed (5,306)** — was 5,233 |
| Failed | 0 |
| Skipped | 0 (the string `skipped` appears zero times in the whole log) |

`@work/performance` 17 files / 127 tests. `@work/admin` 54 files / **705 tests** (was 632).
`@work/api` 88 files / 827 tests.

PostgreSQL 16 was live and `TEST_DATABASE_URL` set, so the integration suites executed: every
`*.integration.test.ts` and `*.cross-module.spec.ts` reports real per-file timings in the hundreds of
milliseconds to seconds, which is what a database-backed test costs.

### Build

The three Performance routes are in the admin bundle:

```
├ ƒ /performance                                        513 B         226 kB
├ ƒ /performance/goals/[goalId]                         513 B         226 kB
├ ƒ /performance/reviews/[reviewId]                     513 B         226 kB
```

---

## L. Remaining findings

Recorded, not fixed. None blocks the authorized workflow.

**1. `PerformanceSummaryView` is a published contract with no handler and no route.**
`packages/modules/performance/src/contracts/review-views.ts:240` exports a view carrying
`participants`, `completed`, `calibrated`, `averageFinalScore` and `byRatingLevel`;
`performance-permissions.ts:66` declares `performance.summary.read`. Neither name appears anywhere
else in the module. Those are exactly the figures the old overview counted in a browser. **This is
the owner decision the direction investigation flagged**: either the summary is intended and
unbuilt, or the view and the permission are orphans. A slice should not decide it, and this one did
not — it removed the browser-side counters rather than replacing them.

**2. `GET /performance/reviews/:reviewId` renders its not-found page with HTTP 200.** The eighth
instance of the finding in §H of the direction investigation, now the ninth and tenth with the two
routes this slice adds. Not fixed here: it is one shared Next.js behaviour, not a Performance
defect, and it is its own piece of work.

**3. `/performance/feedback` accepts no `cycleId`.** Every other cycle-scoped read does. The
register therefore shows the tenant's feedback beside cycle-scoped listings. The section is labelled
plainly and no cycle is claimed for it; adding the filter would be a module change and is out of
scope.

**4. Performance publishes no read for one competency.** An assessment item naming a `competencyId`
stays an identifier while one naming a `goalId` opens. Recorded as an asymmetry, not a defect: the
framework read returns competencies in bulk, and inventing a per-competency lookup would be an N+1.

**5. No workflow instance is published on any Performance view.** Goal approval and review
completion are named human acts in the domain, but no view carries an approval instance identifier,
so there is nothing for a screen to open. Recorded for the Approvals-integration question; nothing
was wired.

---

## M. Git

| | |
| --- | --- |
| Branch | `claude/munaxa-product-readiness-audit-8mr34d` |
| Commit | `COMMIT_HASH` |
| Working tree after commit | clean |
| Registry workaround in `package.json` | none — `pnpm.overrides` holds only `sharp`, `postcss`, `js-yaml`, `deepmerge-ts` |
| Files changed | 40 (5,524 insertions, 2,028 deletions) |

The local verification rig — the source-built platform packages, the fixture API stub, the browser
screenshots — lives entirely in the session scratchpad and is not committed. `package.json` was
checked for a `file:` override before committing; there is none.

---

# PRODUCT SLICE #7 — PERFORMANCE AS WORK — COMPLETE
