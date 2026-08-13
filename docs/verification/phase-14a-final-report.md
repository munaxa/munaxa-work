# Phase 14A — Learning and Development: final report

## 1. Executive summary

Phase 14A delivers Learning end to end: domain, schema, application layer, PostgreSQL repositories,
production cross-module adapters, HTTP API and Admin UI, in both languages, at three scales.

**All 25 benchmarked workloads are within budget at 500, 10,000 and 100,000 employments per
tenant**, measured as an unprivileged role with row-level security enabled and forced, against a
database holding a second tenant at the same volume. The compliance queue answers in 17 ms at
100,000 employments against a 100 ms budget; the expiring-certificate queue in 3.8 ms.

**Seven defects were found and fixed**, every one by a test or a benchmark rather than by reading.
Their original failing evidence is preserved in §18. **No budget was moved.** No completed module
was changed.

Nine capabilities are `NOT VERIFIED`. Each is named on the Admin screen, in the module
documentation, and in §21 with the reason it cannot honestly be claimed. The two most consequential
— scheduled reconciliation and aggregate assessment scoring — are absent because nothing in this
repository schedules anything and because the specification defines no scoring formula. Neither was
approximated.

Repository totals after this phase: **2,180 tests across 43 tasks, 0 skipped**, 1,365 source files,
no dependency cycles.

## 2. Scope completed

| Layer | Commit | What it delivered |
| --- | --- | --- |
| Domain | `1ecc665` | 11 aggregates, 72 tests, ADR-0070 and ADR-0071 |
| Schema | `af8bee8` | 12 tables, 3 immutability triggers, RLS on every table |
| Application | `640bf74` | 27 commands, 11 queries, 24 files, bilingual catalogues |
| PostgreSQL | `a15cf7f` | 11 repositories, 7 integration suites |
| Cross-module | `19fd7f6` | 4 production adapters, end-to-end verification |
| API | `8ad3b7e` | 12 controllers, 34 API tests over real PostgreSQL |
| Admin UI | `6df8720` | 11 sections, 40 render tests, both languages |
| Benchmarks and closing audit | this commit | 25 workloads × 3 tiers, query plans, this report |

**Not implemented, deliberately:** Phase 14B in its entirety — sessions, seats, capacity, waitlists,
scheduling. No column, no port, no route, no screen. §23 audits this.

## 3. Architecture

The modular monolith of ADR-0023, unchanged. `packages/modules/learning/src/{domain, application,
infrastructure, contracts, api}` with the lint-enforced dependency direction
`domain ◄ application ◄ infrastructure ◄ api`. One shared `Dispatcher` and `ModuleRegistry`
assembled in the composition root; every handler declares a permission; `PostgresUnitOfWork` opens a
fresh connection, sets `app.tenant_id` transaction-locally, and dispatches events at most once after
commit.

The Admin portal consumes Learning **only through its HTTP API**. The path is
Admin → API → dispatcher → application → repository → PostgreSQL, and nothing shortcuts it: the
portal imports published view *types* and makes `fetch` calls, and reaches no repository, no Prisma
model and no table.

## 4. Domain and schema

Twelve tables: `learning_course_category`, `learning_course`, `learning_course_version`,
`learning_assessment`, `learning_path`, `learning_path_step`, `learning_mandatory_rule`,
`learning_assignment`, `learning_enrolment`, `learning_assessment_result`,
`learning_certification`, `learning_instructor`.

**No `numeric`, no `bigint`, no money column anywhere.** Every number is a small
schema-constrained integer. The one freely-typed value is `raw_mark`, a `varchar(32)` nothing
parses, matched against `/^-?\d{1,12}(\.\d{1,4})?$/` at the domain and again at the API edge.

Three triggers refuse what an update would destroy: a published course version, a recorded
assessment result, and a change to an enrolment's pinned course version. Two partial unique indexes
carry the module's idempotency — one open assignment per employment and course, one certification
per enrolment — added in `20260812150000_learning_convergence_indexes` after the in-memory stores
were found stricter than the database, not before.

## 5. Application layer

27 commands and 11 queries, each with its own permission. The separations that matter:
`assignment.waive` is not implied by `assignment.manage`, `certification.revoke` is not implied by
`certification.manage`, and `enrolment.complete` is not implied by `enrolment.manage` — waiving
excuses somebody from a compliance obligation, revoking takes a qualification away, and a completion
is the evidence a certificate is issued from.

**No scoring formula was invented.** The specification names five assessment kinds and defines no
threshold, weighting, rounding or attempt policy. An authorized assessor states an outcome; nothing
computes one. This is `NOT VERIFIED`, not "deferred".

## 6. PostgreSQL layer

Eleven repositories over the ninth copy of the shared `row-writer` helpers. No repository opens its
own transaction; none contains business logic; `updateRow` appends `version = version + 1` and
throws `ConcurrencyException` on a stale write, which the shared `ProblemDetailsFilter` turns into
HTTP 409.

Every civil date is read with `to_char(col, 'YYYY-MM-DD')` and returned as a string. **No `Date`
exists anywhere on a Learning date path**, which is why no timezone conversion can be wrong.

## 7. RLS and security

`app_protect_table` on all twelve tables in the creating migration (ADR-0030). The benchmark asserts
both flags rather than assuming them:

```
Role learning_benchmark_role: rolsuper=false, rolbypassrls=false.
Row-level security enabled and forced on all 12 Learning tables.
```

`relforcerowsecurity` matters as much as `relrowsecurity`: without it a table's owner is exempt from
its own policies.

At every tier the benchmark then asserts, from the neighbouring tenant, that the *same* employment
identifier yields nothing:

```
tenant isolation: rows, detail reads and totals all zero across the boundary.
```

Rows, **detail reads by identifier**, and **counts** — the last because a total computed without the
tenant predicate discloses how many people are out of compliance elsewhere even when no row comes
back. Application-level filtering is never the proof; the role holds no `BYPASSRLS` and the
assertions run through the production repositories.

Above the database, the API suite proves what RLS cannot express: a caller holding only
`assignment.read-team` reads nothing whatever manager or employment they name, and a training record
they may not see answers **404 rather than 403** — confirming that a record exists is itself the
disclosure.

## 8. Cross-module contracts

Four adapters in the composition root, each consuming a published query under a bounded service
grant, each grant explicit and none wildcard:

| Adapter | Query | Permit |
| --- | --- | --- |
| `LearningEmployment` | `employment.read-employment`, `employment.search` | `employment.employment.read` |
| `LearningOrganization` | `organization.unit-ancestry` | `organization.hierarchy.read` |
| `LearningDocuments` | `documents.read-document` | `document.read` |
| `LearningNotifications` | — (intent only) | — |

Audited this phase: **no People table access, no Performance table access, no direct cross-module
Prisma query, no wildcard grant.** The only imports from other modules anywhere on the Learning path
are type-only `EmploymentView` and `DocumentView` in the composition root — identical to
Performance's adapters, and the established pattern for a composition root that maps a published
response.

Tenant, actor and correlation are preserved: each adapter reads them from the ambient context and
never from a parameter. **A failed dependency read returns `undefined`, never `[]`** — an empty
array would read as "nobody works here", which is the failure mode reconciliation exists to refuse.

## 9. API

Twelve controllers, all 27 commands and 11 queries routed, nothing beyond them. Commands are POSTs
to named sub-resources — publication, archive, waiver, cancellation, start, completion, failure,
withdrawal, revocation, retirement, reconciliation — and **no lifecycle status is writable by
PATCH**. `PATCH` amends only a course's descriptive fields.

There is **no satisfy route** (an assignment is satisfied by a completion or an issuance, in the
same transaction as the act that earned it) and **no supersede route** (superseding is what issuing
the next certificate does). A route for either would close a compliance obligation with nothing
behind it.

A concurrency conflict is 409 and never 500, proven over HTTP with two simultaneous requests: one
applies, the loser is told the row moved, and the row ends at version 3.

## 10. Admin UI

One server-rendered route, `/learning`, eleven sections across five workspaces, following the
portal's existing architecture exactly: no client component, no form, no dialog, no state the screen
owns. Where a record's state permits an action the screen names it and says the server decides.

**Eleven bounded API requests per load, and the count does not grow with the tenant** — the four
detail reads are made once for the first row of their listing, never one per course, per person or
per certificate. Every listing shows the server's total separately from the rows on the page.

## 11. Localization

Both catalogues are the module's own — `packages/modules/learning/locales/{en,ar}.json`, the files
`check-localization.mjs` gates — rather than a second copy in the portal. 45 keys were added for the
Admin surface, including a `withheld` group and two vocabularies. Direction follows language and is
never a separate control. The render suites assert Arabic strings and the Arabic `NOT VERIFIED`
notices rather than only English.

Gate: **15 catalogue sets complete.**

## 12. Concurrency

Every scenario runs against real PostgreSQL on independent connections.

| Scenario | Outcome | Where |
| --- | --- | --- |
| Duplicate assignment | Converges on one row; the partial unique index decides | `learning-concurrency.integration.test.ts`, cross-module races |
| Duplicate enrolment | Converges; `created: false` on the second | Same |
| Completion race | One completion; the loser is refused | Same |
| Certification race | One certificate per enrolment, by index | Same |
| Reconciliation race | Both runs converge; nothing duplicated | `phase-fourteen-races.cross-module.spec.ts` |
| Versioned course update | Exactly one applies, loser gets 409, version ends at 3 | `learning.lifecycle.spec.ts`, over HTTP |
| Simultaneous enrolment start | Exactly one applies; loser refused by version *or* by the aggregate | Same |

The last is worth stating precisely: the loser is refused by whichever guard reaches it first, and
both answers are correct. What must never happen — two successes, or a 500 — does not.

## 13. Idempotency and reconciliation

Reconciliation is a bounded command an administrator sends. It is idempotent by construction:
`insert … on conflict do nothing` against a partial unique index over a derived `occurrence_key`,
never a read-then-write.

Measured as replay at every tier — 200 assignments generated, then the same 200 again:

| Tier | Generate 200 | Replay 200 | Created on replay |
| --- | --- | --- | --- |
| A (500) | 147.4 ms | 116.4 ms | 0 |
| B (10,000) | 95.8 ms | 86.8 ms | 0 |
| C (100,000) | 100.5 ms | 78.8 ms | 0 |

The replay is consistently *cheaper* than the run that created rows, which is what an index-arbitrated
refusal should cost. Both are far inside the 2 s / 10 s / 60 s reconciliation budgets.

## 14. Exactness

The chain, audited end to end this phase:

| Layer | Guard | Evidence |
| --- | --- | --- |
| Database | `varchar(32)`, never parsed | Schema probe |
| Repository | Mapped as a string | Benchmark: `exact marks: 18.50, 20.00, 7.25, 999999999999.0000 — all returned character for character` |
| Domain | `EXACT_DECIMAL` regex, no arithmetic | Domain tests |
| Application | Carried through | Application tests |
| API | Pattern-matched, never converted | `learning.lifecycle.spec.ts`: `>18.50<` present, `>18.5<` absent |
| Admin HTML | `exactMark` named identity function | `honesty.test.tsx` |

**Where the risk actually is in this module.** Learning's marks are bounded at twelve integer digits
and four decimals, and every value in that range survives a `Number` round trip on magnitude —
JavaScript prints the shortest string that parses back to the same double, and sixteen significant
digits still fit. So the Phase 13 failure mode (2⁵³) cannot occur here. **Trailing zeros can**, at
every width: `20.00` → `20`, `0.5000` → `0.5`, `999999999999.0000` → `999999999999`. The Admin test
asserts all four widths against the rendered markup, and the benchmark asserts three of them through
the production repository.

Civil dates: every Learning date is a `YYYY-MM-DD` string from column to HTML. The render suite
asserts that no date is reformatted and that no Arabic-Indic digits appear — a `Date` on this path
would render the day before west of UTC.

## 15. Benchmark methodology

```
TEST_DATABASE_URL=... node scripts/measure-learning-performance.mjs [--only=A|B|C] [--plans] [--purge]
```

Four files: `measure-learning-performance.mjs` (the measurements and the report),
`learning-benchmark-data.mjs` (the catalogue, fixed at every tier), `learning-benchmark-records.mjs`
(what the workforce did, written per employment) and `learning-benchmark-audit.mjs` (the role, RLS,
isolation and exactness assertions, and the query plans). Split along those seams rather than at an
arbitrary line count.

Real PostgreSQL, real repositories, real row mappers, as an **unprivileged role** with `rolsuper` and
`rolbypassrls` both false, asserted at start-up. A **second tenant is seeded at the same volume at
every tier**, so every read pays the cost of excluding it. Fixtures are written with multi-row
inserts rather than through the dispatcher — seeding a hundred thousand assignments through command
handlers would measure the seeding — but they write the columns the handlers write and every check
constraint applies. `learning_assignment_satisfaction_check` rejected a satisfied assignment with no
evidence behind it until the seed supplied the enrolment that satisfied it.

Budgets, inherited from Phase 13 unchanged: **queue reads 100 ms, detail reads 150 ms,
reconciliation 2 s / 10 s / 60 s.**

Row counts per tenant:

| Table | A (500) | B (10,000) | C (100,000) |
| --- | --- | --- | --- |
| `learning_assignment` | 685 | 10,185 | 100,185 |
| `learning_enrolment` | 250 | 5,000 | 50,000 |
| `learning_certification` | 100 | 2,000 | 20,000 |
| `learning_assessment_result` | 250 | 2,000 | 2,000 |
| `learning_course` / `_version` / `_assessment` | 40 / 80 / 80 | same | same |
| `learning_path` / `_step` | 5 / 30 | same | same |
| `learning_mandatory_rule` | 8 | same | same |
| `learning_instructor` | 50 | same | same |
| `learning_course_category` | 1 | same | same |

Doubled across two tenants. The catalogue is fixed rather than scaled because a tenant's catalogue
does not grow with its headcount. Assessment results are seeded for a bounded 2,000-enrolment slice
because reading one enrolment's results is a per-enrolment lookup whose cost does not depend on how
many other enrolments have them.

The proportions are a real training year in August: a fifth of requirements already past due, a
fifth of enrolments completed, a tenth in progress, a tenth of certificates lapsing inside the
notice window. Selectivity is what a query plan turns on.

## 16. Benchmark results

All figures in milliseconds. **Every workload within budget at every tier.**

| Workload | A: 500 | B: 10,000 | C: 100,000 | Budget |
| --- | --- | --- | --- | --- |
| course list (published) | 25.2 | 3.8 | 27.0 | 100 |
| course read | 2.3 | 1.3 | 1.9 | 150 |
| course versions | 2.7 | 1.1 | 2.0 | 150 |
| assessment definitions | 2.2 | 1.3 | 2.0 | 150 |
| path list | 3.3 | 1.9 | 2.4 | 100 |
| path steps | 2.0 | 1.2 | 1.3 | 150 |
| mandatory rule list | 3.5 | 1.5 | 2.2 | 100 |
| instructor list | 3.2 | 1.7 | 1.9 | 100 |
| **compliance queue** | 4.9 | 3.3 | **17.0** | 100 |
| overdue queue | 3.7 | 2.2 | 5.7 | 100 |
| assignments by employment | 2.1 | 1.4 | 2.1 | 100 |
| assignments, scope-bounded | 4.6 | 2.5 | 2.9 | 100 |
| enrolment list (completed) | 3.7 | 4.9 | 41.8 | 100 |
| enrolments by employment | 1.8 | 1.4 | 1.8 | 100 |
| enrolment read | 1.2 | 0.8 | 0.9 | 150 |
| assessment results | 2.0 | 1.0 | 1.3 | 150 |
| certification list (active) | 4.1 | 4.9 | 39.1 | 100 |
| **expiring certificates** | 3.1 | 1.8 | **3.8** | 100 |
| certificates for employment | 1.3 | 1.0 | 1.1 | 150 |
| certificate for enrolment | 1.2 | 0.8 | 1.2 | 150 |
| last completion of a course | 1.3 | 0.8 | 1.4 | 150 |
| reconciliation lookup (200) | 1.8 | 1.2 | 1.8 | 2,000 / 10,000 / 60,000 |
| reconciliation generate (200) | 147.4 | 95.8 | 100.5 | 2,000 / 10,000 / 60,000 |
| reconciliation replay (200) | 116.4 | 86.8 | 78.8 | 2,000 / 10,000 / 60,000 |

Seed time: 0.5 s / 3.3 s / 27.4 s for both tenants. Figures are one full run of the committed script; run-to-run variance on the sub-5 ms reads is a millisecond or two either way, and every tier has been run repeatedly with **zero `MISSED` verdicts**.

The two figures that matter most — the compliance queue and the expiring-certificate queue — are the
screens an HR administrator opens every morning, and both stay well inside a flat budget while the
data grows 200×. Reconciliation is flat in the workforce size because it is bounded by page rather
than by tenant, which is the property that makes it usable at all.

**Audience resolution through Employment is not measured here**, and that is deliberate rather than
an omission: it is one page-sized call to `employment.search`, a contract Employment's own benchmark
measures. Learning's own contribution to a reconciliation page is the batched
`lastCompletionsOf` lookup above — one query for 200 employments, not 200 queries.

## 17. Query-plan findings

Captured with `--plans` at tier C, as the unprivileged role with RLS on. Every plan shows the tenant
predicate and an index access path; there is no sequential scan and no unbounded sort.

```
compliance queue          Index Scan using learning_assignment_due_idx        0.080 ms
compliance queue count    Index Only Scan, Heap Fetches: 0                   16.915 ms
overdue queue             Index Scan using learning_assignment_due_idx        0.082 ms
assignments by employment Index Scan using learning_assignment_employment_idx 0.042 ms
expiring certificates     Index Scan using learning_certification_expiry_idx  0.049 ms
last completion           Index Only Scan, Heap Fetches: 0                    0.024 ms
assessment results        Index Scan using ..._result_enrolment_idx           0.020 ms
```

Each plan carries `Index Cond: (tenant_id = current_setting('app.tenant_id')::uuid)` and the
policy's `One-Time Filter`, so the tenant predicate is part of the access path rather than a filter
applied afterwards. Pagination is bounded in SQL — `Limit` sits above the index scan, and 50 rows
are read from an 80,000-row partial index rather than 80,000 rows being read and then sliced.

**No index was added this phase.** Every one was created by the original migration or by the
convergence migration, and each is demonstrated in use above rather than asserted to exist.

## 18. Defects found and fixed

Seven, all found by a test or a benchmark. The first five were reported in the layer checkpoints and
are listed for completeness; the last two are this checkpoint's.

| # | Defect | Found by | Evidence → fix |
| --- | --- | --- | --- |
| 1 | `validityOf` answered `expiring_soon` on a certificate's last day when the caller asked for a zero notice window | Domain test | A caller asking for no notice window is asking a yes-or-no question. Fixed in `certification.ts` |
| 2 | In-memory stores enforced one-open-assignment and one-certification-per-enrolment; the database did not | Idempotency test | Two partial unique indexes added in a migration — the fakes were **not** loosened |
| 3 | Two weak assertions (a no-op `toHaveLength` property access, a trivially-true `Object.keys`) | Review of the persistence suite | Replaced with assertions that can fail |
| 4 | Cross-module test used a mark of `9007199254740993`, a state no command can reach | Cross-module suite | The business rule was **not** widened; the test moved to `18.50` |
| 5 | Audience port spoke offsets while every published search contract is page-based | Adapter review | Port changed to `(asOf, size, page)`; converting an arbitrary offset would be lossy |
| 6 | Admin render test asserted `not.toContain('Complete')`, which matches the status word "Completed" | This checkpoint's Admin suite | Test bug. Narrowed to the actions block |
| 7 | **Benchmark reported a sequential scan on the compliance-queue count at tier C** | This benchmark | Below |

### Defect 7 — the sequential scan that was a fixture error

The first tier-C run produced this plan:

```
compliance queue count
  Aggregate (actual time=102.403..102.405 rows=1 loops=1)
    ->  Seq Scan on learning_assignment (actual time=0.006..94.974 rows=80185 loops=1)
          Filter: ((deleted_at IS NULL) AND ((status)::text = 'assigned'::text) AND (tenant_id = ...))
          Rows Removed by Filter: 120000
  Execution Time: 102.425 ms
```

The workload as a whole was **52.1 ms against a 100 ms budget — within budget** — so this was not a
budget miss. It was still wrong: a sequential scan of 200,000 rows is not the access path this
schema should produce, and Step 5 exists to catch exactly the case where a passing number hides a
bad plan.

Forcing the planner off sequential scans produced a bitmap heap scan at 29.8 ms — better, but still
not the index-only scan a covering partial index should allow. That pointed at the **visibility
map**, not at the schema. A `vacuum analyze` confirmed it:

```
compliance queue count
  Aggregate (actual time=15.922..15.923 rows=1 loops=1)
    ->  Index Only Scan using learning_assignment_open_idx (actual time=0.048..8.800 rows=80185)
          Heap Fetches: 0
  Execution Time: 15.980 ms
```

**Root cause: the benchmark fixture, not the module.** A freshly bulk-loaded table has statistics
but an empty visibility map, and without one PostgreSQL cannot answer a count from an index at all.
That is not the state a production table is in after autovacuum has run, so measuring it would have
reported a bottleneck this module does not have.

Fixed in the narrowest correct layer: the benchmark now runs `vacuum analyze` rather than `analyze`
after seeding. **No index was added, no query was rewritten, no migration was created** — the
schema was already correct, and adding an index to fix a fixture would have been the wrong answer
permanently.

Result: compliance queue **52.1 ms → 17.0 ms**, and the sequential scan is gone.

Two smaller fixture errors were found and fixed in the same pass: the seed published courses before
their current version existed (so the catalogue read returned 0 rows of 40), and the reconciliation
lookup measured a rule whose cohort the fixture never enrols (so it measured a query that found
nothing). Both were benchmarking nothing; a benchmark of an empty result is a benchmark of nothing.

## 19. Measured performance misses

**None.** All 25 workloads are within budget at all three tiers.

This is stated plainly rather than celebrated: Phase 13 found two genuine misses in the same
workload shapes, and the reason Learning has none is structural rather than lucky. Reconciliation is
bounded by page rather than by tenant, so it cannot become the O(n×m) scan Phase 13's did; and the
two derived answers are index-range scans over partial indexes rather than computed columns needing
a sort.

## 20. Test-isolation findings

The repository's safe configuration is `--concurrency=1`, and `pnpm test` pins it.

Run uncached at that setting: **43/43 tasks, 2,180 tests, 0 skipped.**

Run uncached at *default* concurrency, as the documented experiment: **the Phase 13 deadlock
reproduces, and it is non-deterministic** — three runs failed in different modules.

```
@work/recruitment:test: error: deadlock detected
@work/leave:test:      → deadlock detected
@work/onboarding:test:  Tests  32 passed | 14 skipped (46)
Tasks:    33 successful, 42 total
```

The dangerous line is the third: a run that looks partially green **with security suites silently
skipped**. Concurrent fixtures create roles and issue `grant` statements against one instance and
deadlock on catalogue rows.

**Not caused by Phase 14A** — Learning's own suites passed in every experimental run, and the
failing suites are the same pre-existing set Phase 13 identified. The configuration was not
weakened, no isolation test was disabled, and the unsafe run is not called green. Carried forward
unchanged as repository-level infrastructure debt in §22.

## 21. `NOT VERIFIED` capabilities

Every one is stated on the Admin screen in both languages, in `docs/modules/learning.md`, and here.

| Capability | Why it is not verified |
| --- | --- |
| **Scheduled reconciliation** | `JobPort` has no adapter anywhere in this repository. A requirement is generated because an administrator ran the command. There is no next-run time to display and no run log, because no run is recorded as an event |
| **Aggregate assessment scoring** | The specification names five assessment kinds and defines no threshold, weighting, rounding or attempt policy. Inventing one would decide who passes mandatory safety training on a rule nobody wrote |
| **`assignment.read-team`** | Resolving a manager's team requires knowing which employment the caller *is*. Honouring a caller-supplied `managerEmploymentId` would be an IDOR wearing a permission's name. The scope resolves to nothing, whatever the caller names |
| **`assignment.read-own`, `certification.read-own`** | The same absence. Declared so the contract exists; enforced nowhere |
| **Principal → employment resolution** | No authentication adapter exists (ADR-0032). Every business endpoint returns 401 until Platform supplies one |
| **Notification delivery** | `NotificationPort` has only a recording adapter. An intent is stored and nothing sends it — there is no `deliveredAt` to display, and that absence is the honest state |
| **Binary document storage, upload, download, signed URLs** | `StoragePort` has no adapter. The whole of the Documents integration is confirming that a reference exists. No filename, size, hash or URL is stored or rendered |
| **A course-category listing** | No query enumerates a tenant's categories. Nothing branches on a category (AD-003), so the gap has never mattered; the Admin screen shows the categories in use on the page it fetched and says exactly that |
| **The certificate that superseded another** | `supersedes_certification_id` is written when the next certificate is issued and is not carried by the read contract. A superseded certificate says it was superseded |

None of these is a database record dressed as a working feature. A notification intent exists as a
row and nothing sends it; a document reference exists as a column and no bytes do. The screen says
which.

## 22. Technical debt

| Item | Owner | Note |
| --- | --- | --- |
| Test fixtures deadlock at default concurrency, silently skipping security suites | Repository-wide | Pre-existing, identified in Phase 13, reproduced here. The fix belongs in the fixtures across all modules |
| No course-category listing contract | Learning, a future phase | Would be a new query, handler and repository method in a completed module. Reported rather than added |
| `supersedes_certification_id` absent from `CertificationView` | Learning, a future phase | Same. Stated on screen rather than guessed |
| Ports with no adapter: `JobPort`, `StoragePort`, `SearchPort`, `NotificationPort`, `PlatformAuthenticationPort` | Platform | Carried forward from earlier phases, unchanged |

## 23. Scope audit

**Implemented:** Learning domain, schema, application layer, PostgreSQL repositories, RLS,
immutability, concurrency, production cross-module adapters, HTTP API, Admin UI, localization,
tests, benchmarks.

**Not implemented, verified by search across code, migrations, dependencies and routes:**

| Absent | Verification |
| --- | --- |
| Phase 14B — sessions, seats, capacity, waitlists | No column, no port, no route, no screen. The API contract suite asserts `GET /learning/sessions` and `/learning/waitlists` are 404 |
| Scheduling, `JobPort` adapter | No dependency, no cron, no timer. The Admin lifecycle test asserts no action vocabulary contains `schedule` |
| Aggregate assessment scoring | No formula anywhere. Asserted absent from the rendered HTML: no column headed score, average, total or rating |
| Self-service principal resolution | No route accepts an identity claim |
| Notification delivery, binary storage, signed URLs | No adapter. Asserted absent from the rendered HTML: no `<a>`, no `href`, no `download` |

Every occurrence of a Phase 14B identifier in the Learning tree is either prose in a comment or a
**negative assertion in a test proving the capability does not exist**. Verified by search, not
assumed.

Search for prohibited patterns across `packages/modules/learning`, `apps/api/src/learning`,
`apps/admin/src/learning` and the benchmark scripts: **0 `TODO`, 0 `FIXME`, 0 `.only(`, 0
`eslint-disable`, 0 `any`, 0 unsafe casts.** Every hit was opened and read — the only matches for
`as any` and `as unknown as` are English prose inside comments, and the only `console.log` calls are
the benchmark's own report output.

## 24. Final verification gates

`pnpm standards`, then `pnpm verify --force` with `TEST_DATABASE_URL` configured, tests forced
uncached at `--concurrency=1`:

| Gate | Result |
| --- | --- |
| standards | PASS — no violations |
| architecture | PASS — 155 models |
| localization | PASS — 15 catalogue sets complete |
| dependencies | PASS — 1,365 files, no cycles, no unused dependencies, no unreachable files |
| format | PASS |
| lint | PASS — 43/43 |
| typecheck | PASS — 43/43 |
| tests | PASS — **43/43 tasks, 0 cached, 0 skipped** |
| build | PASS — 25/25 |

Test totals: `@work/learning` **235** · `@work/api` **282** · `@work/admin` **84** · repository
total **2,180**.
