# Phase 13 — PostgreSQL Repositories & Database Integration

Continues from the application-layer checkpoint (`5b7d0b5`). Everything below was run against a real
PostgreSQL 16 instance; no result in this document is inferred from reading code.

---

## 1. Repository inventory

Seventeen application ports, seventeen repositories, twenty-three tables. Every repository is
constructed by `postgresPerformanceStores()`
(`packages/modules/performance/src/infrastructure/performance-stores.ts`), whose return type is the
whole `PerformanceStores` interface — a missing implementation would not compile.

| Port | Repository | Table(s) | Primary query | Index used | RLS policy | Transaction boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `ratingScales` | `PostgresRatingScaleRepository` | `performance_rating_scale`, `performance_rating_level` | by tenant + code | `..._code_idx (tenant_id, code)` | `app_protect_table` | caller's `unitOfWork.execute` |
| `frameworks` | `PostgresFrameworkRepository` | `performance_competency_framework`, `performance_competency`, `performance_competency_level` | by tenant + code + version | `..._code_idx (tenant_id, code, framework_version)` | `app_protect_table` | caller's |
| `goalCategories` | `PostgresGoalCategoryRepository` | `performance_goal_category` | by tenant + code | `..._code_idx (tenant_id, code)` | `app_protect_table` | caller's |
| `templates` | `PostgresTemplateRepository` | `performance_review_template`, `performance_review_template_component` | by id, by code | `..._code_idx (tenant_id, code)` | `app_protect_table` | caller's |
| `goals` | `PostgresGoalRepository` | `performance_goal` | by employment, by cycle | `..._employment_idx (tenant_id, employment_id, due_date desc)` | `app_protect_table` | caller's |
| `goalProgress` | `PostgresGoalProgressRepository` | `performance_goal_progress` | append + read by goal | `..._goal_idx (tenant_id, goal_id, recorded_at desc)` | `app_protect_table` | caller's |
| `cycles` | `PostgresCycleRepository` | `performance_cycle` | by id, by status | `..._status_idx (tenant_id, status, period_end desc)` | `app_protect_table` | caller's |
| `reviews` | `PostgresReviewRepository` | `performance_review` | manager queue, one employment | `..._manager_idx`, `..._employment_idx` | `app_protect_table` | caller's |
| `reviewers` | `PostgresReviewerAssignmentRepository` | `performance_reviewer_assignment` | by review, by reviewer | `..._idx`, `..._reviewer_idx` | `app_protect_table` | caller's |
| `assessments` | `PostgresAssessmentRepository` | `performance_assessment`, `performance_assessment_item` | by review, by assessor | `..._assessor_idx (tenant_id, review_id, assessor_employment_id, assessment_kind)` | `app_protect_table` | caller's |
| `componentScores` | `PostgresComponentScoreRepository` | `performance_review_component_score` | by review | `..._idx (tenant_id, review_id, component)` | `app_protect_table` | caller's |
| `calibrationSessions` | `PostgresCalibrationSessionRepository` | `performance_calibration_session` | by cycle + code | `..._code_idx (tenant_id, cycle_id, code)` | `app_protect_table` | caller's |
| `calibrationDecisions` | `PostgresCalibrationDecisionRepository` | `performance_calibration_decision` | latest by review | `..._review_idx (tenant_id, review_id, decided_at desc)` | `app_protect_table` | caller's |
| `placements` | `PostgresTalentPlacementRepository` | `performance_talent_placement` | by cycle + employment, by box | `..._idx`, `..._box_idx` | `app_protect_table` | caller's |
| `feedback` | `PostgresFeedbackRepository` | `performance_feedback` | by subject, by author | `..._subject_idx`, `..._author_idx` (both `given_at desc`) | `app_protect_table` | caller's |
| `snapshots` | `PostgresSnapshotRepository` | `performance_review_snapshot` | by review | `..._review_idx (tenant_id, review_id)` | `app_protect_table` | caller's |
| `reconciliation` | `PostgresReconciliationRepository` | reads across this module's own tables only | findings | covered by the above | `app_protect_table` | caller's |

**No repository opens a transaction.** Every method takes the `Transaction` the application handler
already has, so a command that writes four tables commits them together or not at all.

### Tables with no repository

`performance_objective` and `performance_key_result` exist, carry RLS and indexes, and have **no
application port and therefore no repository**. The schema is ahead of the application here: OKR
sub-structure was modelled in the migration but no use case reaches it yet. It is listed as debt in
§12 rather than quietly omitted, and the cross-module harness truncates both because the foreign key
to `performance_goal` would otherwise fail.

---

## 2. Migrations

| Migration | What it does |
| --- | --- |
| `20260811180000_performance` | 23 tables, `call app_protect_table` on every one, 7 immutability triggers, all check constraints |
| `20260811190000_component_score_exclusions` | adds `excluded_items jsonb not null default '[]'` to `performance_review_component_score` — see §11, defect 3 |

Both applied cleanly to `work`, `work_test` and `work_perf`; `prisma migrate deploy` reports no
pending migrations. `check-architecture` passes over 143 models.

---

## 3. Row mappers

`configuration-rows.ts`, `review-rows.ts`, `assessment-rows.ts`, `outcome-rows.ts`, sharing
`row-writer.ts`. Three conversions, and each exists because the driver gets it wrong by default:

- **`asBigInt`** — `bigint` columns arrive as **strings**. A key result's observed value can exceed
  2^53, and `Number()` would silently round it. Proved by the round-trip of `9007199254740993`
  (2^53 + 1), which comes back exact.
- **`civil dates`** — every `date` column is selected as `to_char(col, 'YYYY-MM-DD')`. The driver
  otherwise builds a `Date` at the *process's* local midnight, so a due date read west of UTC comes
  back as the previous day and reports a goal overdue a day early.
- **`asNumber`** — applied to counts, versions and **integer** score columns only.

`presentOf` collapses null-dropping into one helper, so `exactOptionalPropertyTypes: true` is
satisfied without a branch per nullable column.

---

## 4. Cross-module production adapters

`apps/api/src/performance/performance-sources.ts` — four adapters, each running inside a **bounded
service grant** (ADR-0043) permitting an explicit list, never a wildcard or a prefix.

| Adapter | Reads | Grant |
| --- | --- | --- |
| `PerformanceEmployment` | `employment.read-employment`, `employment.search` | `employment.employment.read` |
| `PerformanceOrganization` | `organization.governing-legal-entity` | `organization.legal-entity.read` |
| `PerformanceDocuments` | `documents.read-document` | `document.read` |
| `PerformanceNotifications` | — (records intent) | none |

**Nothing here writes.** There is no `create` and no `update` on any adapter: Performance measures
and decides nothing, and Compensation, Learning and Career pull a rating when they want one
(AD-005, ADR-0058).

**There is no People, Compensation or Payroll adapter, deliberately.** A review carries an
employment; a screen that wants a name asks People, which owns it. A performance review must not
display a salary, so there is no method that could fetch one and no grant that would permit it.

The Employment grant is `employment.employment.read` and nothing else — not `employment.*`, and not
`employment.history.read` or `employment.workforce.export`. A performance cycle has no business
carrying the register out of the product.

---

## 5. Employment contract usage (D-31)

**No change was made to Employment, and none was needed.** The earlier assumption that Employment
lacked a manager → direct-reports query was incorrect: `employment.search` already accepts
`managerEmploymentId`, resolves the reporting line as of a date, is indexed, is bounded and paged,
and carries its own integration test (`employment-search.integration.test.ts` — *"finds everybody
reporting to a manager on a date"*). `PerformanceEmployment.directReportsOf` consumes that contract
and narrows the response in the adapter, which is the correct place to narrow. No second Employment
contract was created.

`asOf` is passed as a **`Date`**, because that is what the contract declares. The upstream stub
throws a `TypeError` if it receives anything else, so the Phase 8 civil-date-as-string defect cannot
recur silently.

The bound is applied twice on purpose: `size` bounds what Employment returns and the adapter slices
what it passes on. That is not redundant — Employment clamps `size` to its own maximum, which is
*smaller* than some callers here ask for, and a caller assuming it had received everything would
enrol a fraction of a unit and report success.

---

## 6. Documents integration

One question: does this document exist. Performance stores the identifier and **no** filename, size,
hash or URL.

**Binary storage remains NOT VERIFIED.** No `StoragePort` adapter, no signed-URL generation, no
upload, no download, no malware scanning was implemented, because none exists anywhere in this
repository to integrate with. `documents.read-document` returns a view carrying a
`storageReference` that resolves to nothing, in production as in the suite.

---

## 7. Row-level security — verified

All 23 tables: `relrowsecurity = t`, `relforcerowsecurity = t`, exactly one policy each. `FORCE`
matters as much as `ENABLE` — without it the owning role bypasses the policy, which is precisely the
role an application connection tends to be.

**The integration suites run as an unprivileged role that owns nothing and holds no `BYPASSRLS`**
(`performance-database.fixture.ts`). A superuser connection would make every isolation assertion
below pass vacuously.

Eight tests in `performance-isolation.integration.test.ts`, testing **both directions**:

1. protects every table this module owns *(enumerates all 23 against `pg_class`)*
2. hides one tenant's cycles, reviews and goals from the other, **both ways**
3. keeps one tenant's search results out of the other's page **and out of its count**
4. hides a calibration decision and a piece of feedback from the other tenant
5. refuses a **write** into another tenant's row from inside this tenant's transaction
6. does not let a **foreign key** be used to reach across the tenant boundary
7. bounds a manager's reads to the employments the scope names, **in SQL**
8. bounds a feedback read to the subjects the scope names

Test 3 is the one that matters most for paging: a count computed without the tenant predicate leaks
"how many reviews exist elsewhere" even when no row is returned.

Tests 7–8 prove the authorization bound goes **into** the store call (`bound-clause.ts` emits
`column = any($n::uuid[])`), not applied after the rows have already left the database.

---

## 8. Exactness — verified

**No path uses `Number(decimal)` or `parseFloat(...)` for a performance score.** `parseFloat` appears
nowhere in the module. There is **no `numeric` column in this module at all**: every score is an
integer column of hundredths and every weight an integer column of basis points, so there is no
decimal to mis-parse.

Audit (`grep` over `packages/modules/performance/src`):

| Pattern | Result |
| --- | --- |
| `parseFloat` | none |
| `Number(<score>)` on a `numeric` column | none — no `numeric` column exists |
| floating-point arithmetic on a score | **one, fixed** — see §11, defect 7 |
| `as unknown as` / `as Query` | none |
| `eslint-disable` | none |
| `any` | none |

The single division in the engine rounds explicitly on `bigint` (`divideRounded`, half away from
zero). Since defect 7, the peer-panel mean uses that **same** function rather than
`Math.round(total / count)` — the two agreed for every value the panel can hold, but agreeing by
accident is not the same as agreeing.

Round-trip tests: scores at the bounds of the scale and at a rounding boundary; a competency's absent
weight stays absent and a present one stays exact; a measurement larger than a double can represent
survives.

---

## 9. Immutability — verified

Seven triggers, eight tests, and **a permitted case beside every refusal** — a trigger that refused
everything would pass a refusal-only suite while breaking the product.

1. lets a draft assessment be edited, and **freezes it on submission**
2. lets a review move, score and complete — and **freezes it afterwards**
3. appends progress entries and refuses to rewrite one
4. records calibration decisions and refuses to rewrite one's **original** score
5. takes a snapshot once and refuses to rewrite it
6. withdraws feedback but refuses to **edit or remove** it
7. refuses a review completed by the auto-approver, **at the table**
8. refuses a completed review with no rating, **at the table**

No trigger was disabled and no constraint weakened to make a fixture easier. Two constraints fired
during seeding for this report (`performance_review_status_check`,
`performance_cycle_template_fk`) and the seed was corrected rather than the constraint.

Test 6 covers the trigger fix from the schema checkpoint: it originally refused only `DELETE`, so a
withdrawal could be smuggled in as a content edit. It now compares `to_jsonb` of the row minus the
withdrawal, audit and version columns.

---

## 10. Concurrency — verified

Seven tests, each using **two real connections** (`onSecondConnection()`), not two sequential calls
on one.

1. completes a review exactly once when two managers race, **and takes one snapshot**
2. lets one goal progress update win and refuses the other deterministically
3. closes a goal once when a completion and a cancellation race
4. records one calibration decision per review per session, and keeps the original
5. assigns a reviewer once when two invitations race
6. accepts one response per reviewer when two submissions race
7. enrols one review per employment when two enrolments race

**Test 1 is the regression test for the application checkpoint's ordering defect.** Completion
originally inserted the snapshot *before* the version-guarded update, so a loser of the race left a
second snapshot behind after its update was rejected. The test asserts exactly one row in
`performance_review_snapshot` after both connections have raced, which fails against the old
ordering and passes against the corrected one.

`ConcurrencyException` from `Repository.updateRow` travels to the edge rather than becoming a
`Result`, as in every prior phase.

---

## 11. Defects found, with their original measurements

All seven were found by tests or by the database, not by reading.

**1. `multiple assignments to same column "version"`**

```
error: multiple assignments to same column "version"
  at PostgresAssessmentRepository.upsertItem
```

`auditForInsert` places `version` in the values map, and the `on conflict do update set` clause built
from those keys assigned it a second time. Fixed by excluding `version` (with `created_at`,
`created_by`) from the generated update list; the clause assigns
`version = performance_assessment_item.version + 1` itself. **Only the real database found this** —
the in-memory store has no `on conflict`.

**2. `cannot truncate a table referenced in a foreign key constraint`**

```
error: cannot truncate a table referenced in a foreign key constraint
  Truth: "performance_key_result" references "performance_goal"
```

The cross-module harness's `TABLES` list omitted `performance_key_result` and
`performance_objective` — the two tables with no repository (§1). Fixed by adding them. No `cascade`
was added: `truncate ... cascade` would have silently reached tables the suite does not own.

**3. Missing `excluded_items` column**

A component score could be persisted but its *working* could not: the engine records which assessment
lines left the denominator and why, and there was nowhere to put it. Rebuilding the exclusions from
the assessment items on read was considered and rejected — the working exists so a rating can be
explained years later, and deriving it from mutable rows defeats the purpose. Fixed by
`20260811190000_component_score_exclusions`.

**4. `TenantIsolationException: not a valid identifier`**

```
TenantIsolationException: "01930000-0000-7000-8000-0000000pf111" is not a valid identifier
```

Fixture tenant identifiers contained `p` and `f`, which are not hexadecimal. Changed to
`...00000000aa11` / `...00000000bb22`; the unit fixture `f0u1` became `f0d1`.

**5. Upstream facts leaked between tests**

One test moved `EMPLOYEE`'s manager and ended `PEER`'s employment; later tests inherited that world
and asserted against a state nobody had set up. Fixed: `truncate()` now resets `facts` from
`upstream()` and clears `notifications.sent`, so each test starts from the same product.

**6. Paging expectation wrong**

A paging test expected a total of 6 and got 5. The test's arithmetic was wrong — `aScoredWorld`
creates no goal. The expectation was corrected; the repository was right.

**7. Two rounding rules for one module**

`peerAggregateOf` computed `Math.round(total / scored.length)` — the module's only floating-point
expression over a score. It agrees with the engine for every value the 360 panel can hold, so no
test failed. It was still changed to call the domain's `divideRounded` on exact `bigint`s, because
two rounding rules in one module is how a displayed average comes to differ from a computed one.

**8. Turbo's default concurrency does not isolate the database**

`turbo run test --force` at default concurrency produced, across five packages:

```
error: deadlock detected
TypeError: Cannot read properties of undefined (reading 'close')
Test Files  2 failed | 6 passed (8)
     Tests  57 passed | 12 skipped (69)
```

Concurrent fixtures were creating roles and issuing `grant` statements against one PostgreSQL
instance and deadlocking on catalogue rows — after which the isolation suites *skipped*, which is the
dangerous part: a green-looking run with the security tests missing. This is not a Phase 13 defect;
the repository already pins `pnpm test` to `turbo run test --concurrency=1`, which is the isolation
mechanism, and my ad-hoc `--force` invocation had bypassed it. Recorded here because §28 asks
specifically that Turbo scheduling not be assumed to isolate — it does not, and this is the
measurement showing what happens when it is assumed.

---

## 12. Query plans

Measured on `work_perf` seeded with **100,000 reviews** across 2 tenants, 10 cycles and 2,000
managers, connected as the unprivileged `work` role with `app.tenant_id` set — so RLS is in the plan,
not bypassed for the measurement.

**Manager queue** (`read-team`, scope bound in SQL):

```
Limit (actual time=0.085..0.086 rows=5 loops=1)
  -> Sort (Sort Key: created_at DESC, quicksort Memory: 25kB)
     -> Index Scan using performance_review_manager_idx on performance_review
        Index Cond: (tenant_id = current_setting('app.tenant_id')::uuid
                     AND manager_employment_id = ... AND cycle_id = $0)
Execution Time: 0.116 ms
```

**The count that pages it:**

```
Aggregate (actual time=0.034..0.034 rows=1 loops=1)
  -> Index Only Scan using performance_review_manager_idx on performance_review
     (actual time=0.019..0.029 rows=25 loops=1)
Execution Time: 0.055 ms
```

The count returns **25**, not 50. Both tenants hold 50 reviews for that manager identifier; RLS
removed the other tenant's half inside the aggregate.

**One employment across cycles:**

```
Index Scan using performance_review_employment_idx on performance_review
Execution Time: 0.041 ms
```

No sequential scan on any hot path. Every index is `(tenant_id, ...)`-leading and partial on
`deleted_at is null`, so soft-deleted rows cost nothing to skip.

Full benchmarks are **out of scope for this checkpoint** and were not run.

---

## 13. Composition root

`apps/api/src/identity/identity.module.ts` registers `performance` in `PermissionAwareModules` and
`registry.register(permissionAware.performance)`. `performance.composition.ts` builds the module with
`postgresPerformanceStores()`, the four production adapters, `RecordingNotificationPort` and
`systemClock`.

`RecordingNotificationPort` is not a fake and not a stub. A fake would claim delivery; this records
the intent and says nothing about whether anybody was told — the difference between "the capability
is not wired" and "the capability is broken".

`systemClock` is imported from `@work/payroll` because it is the only exported system clock in the
repository. Duplicating it per module is how two clocks come to disagree.

---

## 14. Cross-module tests

`apps/api/src/performance/*.cross-module.spec.ts` — one real dispatcher, the real Performance
handlers, **real PostgreSQL repositories**, the real adapters, real bounded service grants, and
`GrantAwarePermissionChecker` wrapped exactly as the composition root wraps it. Without that wrapper
every grant is inert and every cross-module read is refused, which is what a plain checker proved the
first time Phase 12's equivalent suite ran.

Employment, Organization and Documents answer as **stub query handlers on the same dispatcher**, so a
change to any of those contracts' shapes breaks this suite. Each declares the permission the real
handler declares.

1. reads a manager's direct reports through the **existing** Employment contract
2. refuses to enrol an employment Employment no longer calls active, and names it
3. refuses a goal citing a document nobody can find
4. **does not let a review's own manager grant a `read-team` caller access to it**
5. admits an invited reviewer and refuses an uninvited one, on the real path
6. records a notification intent and delivers nothing
7. finds what reconciliation finds **without any event having been delivered**
8. **carries one employment from configuration to an unchangeable historical rating**

### The mandatory end-to-end scenario (test 8)

Configure a scale, framework, two competencies and a weighted template → create and open a cycle →
enrol from Employment's own answer → set and approve a goal → record self, peer and manager
assessments → score → calibrate 400 down to 350 with a named human and a reason → complete → then
**retire the scale, retire the template, and move the employment to a different manager in a
different unit** → read the review back.

It still says: `finalScore` 350, `calculatedScore` 400, the original manager, the original legal
entity resolved through Organization at completion, a frozen four-level scale, and byte-identical
component scores. Self and peer assessments are kept and readable; only the manager's was counted.

### Lost events

**Nothing publishes an event and nothing subscribes to one** — not a simplification. This module
pulls every cross-module fact at the moment it needs it, so there is no delivery to lose. Test 7
asserts it: reconciliation finds what it finds with no event having been delivered, and finds the
same thing on a second read.

### Authorization regressions

Test 4 is the regression test for the application checkpoint's IDOR. `readReviewHandler` originally
derived the authorization scope from **the review's own manager**, which made every review readable
by anybody holding `read-team`: the review always has a manager, and that manager always has it among
their reports. It was a free pass wearing the shape of a check. The scope now comes from the caller's
context; a review outside it answers **404, not 403**, because confirming that a review exists for an
employment in a cycle is itself the disclosure.

---

## 15. Gates

Run with `TEST_DATABASE_URL=postgresql://work:work@127.0.0.1:5432/work_test`, uncached (`--force`),
at `--concurrency=1`.

| Gate | Result |
| --- | --- |
| `check-standards` | no violations |
| `check-architecture` | 143 models, no violations |
| `check-localization` | 14 catalogue sets complete |
| `check-dependencies` | 1199 files, no cycles, no unused dependencies, no unreachable files |
| `format:check` | all files match Prettier |
| `lint` | 41/41 |
| `typecheck` | 41/41 |
| `test` | **41/41 tasks, 0 cached** |
| `build` | 24/24 |

`@work/performance`: **17 files, 127 tests, all passing.**
`@work/api`: **27 files, 192 tests, all passing.**

**No skipped tests, no disabled tests, no `.only`, no `eslint-disable`, no `any`.** The
`describe.skip` guard in the five integration files fires only when no database is configured, and
`requireDatabaseInCi` throws rather than skipping when `CI` is set.

---

## 16. NOT VERIFIED

Each of these is a missing dependency, not a broken implementation. Nothing in the code implies
otherwise.

- **`review.read-team` principal resolution.** The scope still requires a manager employment supplied
  by a trusted server-side context. There is no principal → employment resolution in this repository,
  and none was invented. A `read-team` caller with no such context reads **nothing** — it does not
  fall back to a client-supplied identifier, and the cross-module suite proves a client cannot supply
  one that works.
- **Notification delivery.** Intent is recorded; nothing delivers it. No transport exists.
- **Scheduling.** Nothing closes a cycle or opens a window on a timer. No scheduler exists.
- **Binary document storage.** No `StoragePort` adapter, no upload, no download, no signed URLs, no
  malware scanning.
- **360 anonymity.** Below a template's minimum, the aggregate is **withheld** — the field is named
  `available`, not `anonymous`. Withholding a number is the only protection this architecture can
  provide, and nothing claims more.
- **Self and peer assessment weighting.** Both are recorded and readable; **neither contributes to
  the score**. No weights were invented for them.
- **OKR sub-structure.** `performance_objective` and `performance_key_result` have tables, indexes
  and RLS but no application port and no repository.
- **API controllers and Admin UI.** Not implemented, per the checkpoint.

---

## Status

**Phase 13 — POSTGRESQL LAYER COMPLETE**

Seventeen repositories over twenty-three tables, all under forced row-level security verified from an
unprivileged role; exact integer scores with no decimal parsing anywhere; seven immutability triggers
each tested against both a refusal and a permitted case; seven concurrency races run over two real
connections; the four production cross-module adapters under bounded grants with no change to
Employment; and the mandatory end-to-end scenario surviving the retirement of the scale, the
retirement of the template and the reorganization of the employment.

Stopping here. No API controllers, no Admin UI, no benchmarks.
