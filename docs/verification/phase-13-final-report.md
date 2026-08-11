# Phase 13 — Final report

Performance, Competencies & Goals. The closing audit: production-scale benchmarks, the security and
architecture audits, end-to-end verification and phase closure.

This report **references** the four layer reports rather than repeating them. Each carries its own
defect evidence, and none of it is rewritten here:

- [Planning checkpoint and the 31 approved decisions](phase-13-plan.md)
- [Application layer](phase-13-application-report.md) · [PostgreSQL layer](phase-13-postgres-report.md)
- [API layer](phase-13-api-report.md) · [Admin UI](phase-13-admin-ui-report.md)

---

## Executive summary

Performance says what somebody was rated, what that rating was measured against, and why — for as
long as the record has to answer for itself.

Twenty-three tenant-scoped tables under forced row-level security, a pure domain with an
integer-only scoring engine, seventeen PostgreSQL repositories, forty-nine HTTP endpoints across
seventeen controllers, four cross-module adapters under bounded service grants, and one Admin
workspace with twelve sections in English and Arabic.

**All seventeen benchmarked workloads are within budget at 500, 10,000 and 100,000 employments per
tenant**, measured against real PostgreSQL as an unprivileged role with RLS on and a second tenant
holding the same volume. Two budget misses were found, root-caused and fixed; both before/after
measurements are preserved in §7.

Nine defects were found across the phase, every one by a test or a benchmark rather than by reading.
Nine capabilities remain `NOT VERIFIED` and none is approximated anywhere in the code.

---

## 1. Architecture

| Layer | What it holds |
| --- | --- |
| **Domain** | 15 pure modules. Aggregates, the vocabulary, the rejection catalogue, and the approved scoring engine — `bigint` throughout, one explicit rounding |
| **Application** | 17 permissions, 36 commands, 13 queries, 17 store ports, 4 cross-module ports. The authorization scope decision lives in one file |
| **Persistence** | 17 repositories over 23 tables, 4 row-mapper modules. No repository opens a transaction; each takes the one the handler holds |
| **API** | 17 controllers, 49 endpoints, 4 DTO modules, one `unwrapOrThrow`, one `search-filters` |
| **Admin UI** | 1 route, 12 workspaces, server-rendered, no client component |
| **Cross-module** | 4 adapters, each through published queries under a bounded grant. No People, Compensation or Payroll adapter exists |

Dependency direction is lint-enforced: `domain ◄ application ◄ infrastructure ◄ api`. The Admin
portal imports `@work/performance/contracts` and nothing else.

## 2. Schema

23 tables · 59 indexes · 7 immutability triggers · 84 check constraints · 3 migrations.

| Migration | What it did |
| --- | --- |
| `20260811180000_performance` | 23 tables, `call app_protect_table` on every one, 7 triggers, all check constraints |
| `20260811190000_component_score_exclusions` | `excluded_items` on the component score — the working could be computed but not stored |
| `20260811200000_goal_cycle_due_date_index` | `(tenant_id, cycle_id, due_date desc, id desc)` — added **after** the benchmark measured the sort it removes (§7) |

Every table: `relrowsecurity = t`, `relforcerowsecurity = t`, exactly one policy. `FORCE` matters as
much as `ENABLE` — without it the owning role bypasses the policy, and the owning role is what an
application connection tends to be.

## 3. Functional coverage

Cycles (create, move, close, cancel, enrol) · templates and component weights · rating scales and
levels · competency frameworks and competencies · goal categories · goals (set, amend, approve,
move, progress, close) · reviews (queue, detail, move, score, complete, archive) · self, peer and
manager assessments · the 360° panel (invite, respond, assess) · calibration (schedule, move, decide,
conclude) · nine-box placement and matrix · continuous feedback (give, read, withdraw) ·
reconciliation.

**Not built, and not partially built**: one-to-ones, PIPs, career paths, succession, learning
records, disciplinary actions. §11 audits for each.

## 4. Scoring — the approved formula

Every value is an integer. Hundredths for scores, basis points for weights.

**One component** (goals, or competencies):

```
numerator   = Σ (itemScore × itemWeightBasisPoints)   over participating items
denominator = Σ  itemWeightBasisPoints                over participating items
componentScore = divideRounded(numerator, denominator)
```

**The review**:

```
numerator   = Σ (componentScore × componentWeightBasisPoints)  over participating components
denominator = Σ  componentWeightBasisPoints                    over participating components
calculatedScore = divideRounded(numerator, denominator)
```

**The one division**, half away from zero, on `bigint`:

```ts
const negative  = numerator < 0n !== denominator < 0n;
const magnitude = (numerator < 0n ? -numerator : numerator) * 2n;
const divisor   = denominator < 0n ? -denominator : denominator;
const rounded   = (magnitude + divisor) / (divisor * 2n);
return negative ? -rounded : rounded;
```

Never `Math.round(a / b)` — that is floating-point division followed by half-to-even at the boundary.

**Participation.** An item or component participates unless it is missing, incomplete, cancelled or
not applicable. A non-participant **leaves the denominator** and its exclusion is persisted with the
reason. It is never scored zero: that would rate somebody at the bottom of the scale for work nobody
assessed.

**Self and peer assessments contribute nothing.** They are recorded, published and readable. No
weight exists for either and none was invented.

**Calibration** records a second number beside the first. It never replaces the calculated score,
and a trigger refuses an update that would change the original.

### Golden cases (§15)

All pass, in `performance-scoring.test.ts` and `performance-scoring-outcomes.test.ts` (17 tests):
weighted goals · competency aggregate · combined score · exact rounding · half-away-from-zero at the
boundary · excluded components with each of the four reasons · cancelled goals · missing components ·
incomplete components · invalid weights refused · out-of-range values refused · calibration override
preserving the original · self and peer recorded and uncounted.

## 5. Security

### Tenant isolation (§9)

23/23 tables with RLS enabled **and forced**, one policy each. Verified from
`performance_api_fixture` — a role that owns nothing and holds no `BYPASSRLS`. A superuser bypasses
every policy, so a suite run as one would report isolation without having checked it.

Both directions, at every layer:

| Test | Layer |
| --- | --- |
| hides one tenant's cycles, reviews and goals from the other, both ways | repository |
| keeps one tenant's search results out of the other's page **and out of its count** | repository |
| hides a calibration decision and a piece of feedback | repository |
| refuses a **write** into another tenant's row from inside this tenant's transaction | repository |
| does not let a **foreign key** be used to reach across the boundary | repository |
| tenant A's cycles and reviews invisible to tenant B, **items and totals both zero** | HTTP |
| tenant B naming tenant A's review by identifier → **404, not 403** | HTTP |

**A tenant cannot infer another's counts.** The count is asserted as zero, not merely the item list —
a total computed without the tenant predicate leaks how many reviews exist elsewhere even when no row
comes back. The benchmark measures the same property from the other side: every tier seeds a second
tenant at the same volume, and every read pays the cost of excluding it.

### Authorization (§10)

Seventeen permissions, each enforced by the kernel pipeline before the handler runs. Authorized
succeeds, unauthorized refuses, across cycles, templates, goals, reviews, competencies, calibration,
360, nine-box and feedback. A refusal **names the permission** (the caller is authenticated and an
administrator can act on it) and discloses nothing about the data.

`calibrate` and `complete` are separate: a caller holding `complete` cannot schedule a calibration
session — asserted.

### Manager authorization (§11) — the defect, permanently covered

```
read-team principal resolution = NOT VERIFIED
```

`reviewScopeFor` once resolved whichever manager a `read-team` caller named, directly below a comment
saying it must not. Over HTTP that is `?managerEmploymentId=<anyone>` and a whole team's reviews.

A `read-team` caller now resolves to `{ kind: 'none' }` **whatever they name**. The regression test
names the review's actual manager *and* an unrelated one, and asserts 404 for both plus an empty page
with a total of zero. `managerEmploymentId` is honoured only alongside `read-all`, where it narrows a
caller who could already read everything and therefore escalates nothing.

No principal resolver was created to make anything pass.

### Review authorization (§12) — the second defect, permanently covered

`readReviewHandler` once derived the caller's scope **from the review's own manager**. Every review
has a manager and that manager always has it among their reports, so the check passed for everybody —
a free pass wearing the shape of a check.

The scope now comes from the caller's context and Employment's published reporting line. A review
outside it answers **404, not 403**: confirming that a review exists for an employment in a cycle is
itself the disclosure.

Reviewer matrix, all asserted over HTTP against real PostgreSQL:

| Case | Result |
| --- | --- |
| assigned reviewer | **201** |
| unassigned reviewer, same permissions | **403** `Requires performance.assess-peer.` |
| reviewer from another tenant | **404** — the review is invisible |
| reviewer assigned to another review | **403** |
| completed review, any mutation | **422** |

### Service grants (§19)

| Adapter | Permits | Operations |
| --- | --- | --- |
| `PerformanceEmployment` | `employment.employment.read` | `read-employment`, `read-direct-reports`, `read-unit-employments` |
| `PerformanceOrganization` | `organization.legal-entity.read` | `read-governing-legal-entity` |
| `PerformanceDocuments` | `document.read` | `confirm-evidence-document` |
| `PerformanceNotifications` | — | records intent |

Each permits an **explicit list** — never a wildcard, never a prefix. Tenant, actor and correlation
identifier are untouched; grants cannot nest; each runs for the length of one call. The Employment
grant is `employment.employment.read` and *not* `employment.history.read` or
`employment.workforce.export`: a performance cycle has no business carrying the register out of the
product.

**No grant was broadened to make a test pass.**

### Cross-module contracts (§18)

`grep` for `from|join|into|update` against `person`, `employment`, `organization_unit`,
`legal_entity`, `document`, `payroll_*`, `compensation_*` across the module: **zero hits**. No
Prisma, no repository import, no direct SQL to another module's tables. Every cross-module fact
arrives through a published query.

## 6. Concurrency (§13)

Seven races, each on **two real connections**, not two sequential calls:

| Race | Outcome |
| --- | --- |
| Review completion | exactly one succeeds, **and exactly one snapshot exists** |
| Goal progress | one wins, the other is refused deterministically |
| Goal closure vs cancellation | closes once |
| Calibration decision | one per review per session; the original is kept |
| Reviewer assignment | assigned once |
| Reviewer response | one response per reviewer |
| Enrolment | one review per employment |

The snapshot assertion is the regression test for a real defect: completion inserted the snapshot
*before* the version-guarded update, so a loser of the race left a second snapshot behind.

At the HTTP edge, a stale version answers **409** with a localized message. Two `PATCH`es that are
both business-valid and differ only in staleness: the first writer's change stands, version is 2,
nothing silently overwritten.

## 7. Performance

`node scripts/measure-performance.mjs` — real PostgreSQL, real repositories, real row mappers,
**unprivileged role, RLS on**, and a **second tenant at the same volume at every tier** so the policy
has something to exclude.

Budgets: queue reads **100 ms**, detail reads **150 ms**, reconciliation **2 s / 10 s / 60 s**. They
do not relax as data grows, except where the work genuinely does — a bounded page costs the same
whatever the tenant's size; a scan of a whole cycle does not.

### Final measurements — all within budget

| Workload | A: 500 | B: 10,000 | C: 100,000 | Budget |
| --- | --- | --- | --- | --- |
| cycle list | 20.2 | 18.5 | 30.0 | 100 |
| cycle read | 1.8 | 1.8 | 2.4 | 150 |
| **manager review queue** | 4.3 | 5.9 | **12.8** | 100 |
| review list (cycle) | 3.9 | 5.5 | 15.4 | 100 |
| review detail | 1.8 | 1.5 | 2.9 | 150 |
| assessments for review | 2.9 | 2.6 | 3.6 | 150 |
| component scores | 2.3 | 2.2 | 3.3 | 150 |
| reviewer panel | 1.8 | 2.3 | 2.9 | 150 |
| goals by employment | 3.5 | 4.2 | 4.9 | 100 |
| **goals by cycle** | 3.8 | 10.0 | **37.2** | 100 |
| goals, scope-bounded | 5.9 | 6.4 | 5.0 | 100 |
| progress history | 2.7 | 3.2 | 3.0 | 150 |
| calibration queue | 2.3 | 2.0 | 2.1 | 100 |
| calibration decisions | 2.2 | 1.8 | 2.0 | 150 |
| nine-box population | 3.1 | 4.2 | 4.6 | 2k/10k/60k |
| feedback by subject | 2.6 | 2.4 | 2.7 | 100 |
| **reconciliation** | 32.8 | 480.9 | **7,411.6** | 2k/10k/60k |

Milliseconds. Tier C is 100,000 employments per tenant — 200,000 reviews, 600,000 goals, two tenants.

### Miss 1 — reconciliation, 10,330 ms against a 10,000 ms budget (tier B)

Original measurement, preserved:

```
  reconciliation                   10330.6 ms     10000 rows  MISSED (budget 10000ms)
```

**Root cause.** `goalWeightFindings` was `reviews.flatMap(review => goals.filter(...))` — O(reviews ×
goals). At 10,000 reviews and 30,000 goals that is three hundred million comparisons.
`placementDriftFindings` had the same shape at smaller scale.

**Fix.** Index the goals by `employmentId:cycleId` into a `Map` once, and the reviews by
`reviewId`. Identical findings, identical order; the traversal is not.

**After: 480.9 ms** — 21× faster, and the tier C figure (7.4 s against a 60 s budget) shows it now
scales linearly rather than quadratically.

### Miss 2 — goals by cycle, 670 ms against a 100 ms budget (tier C)

Original measurement, preserved:

```
  goals by cycle                     670.2 ms    300000 rows  MISSED (budget 100ms)
```

**Root cause**, from the plan — and the count was *not* the problem:

```
Limit (actual time=304.202..304.212 rows=50)
  Sort (Sort Key: due_date DESC, top-N heapsort)
    Bitmap Heap Scan on performance_goal (rows=300000)   <- every matching row, then sorted

count(*): Index Only Scan, Heap Fetches: 0 ... Execution Time: 55.076 ms
```

Three hundred thousand rows read and sorted to return fifty. `performance_goal_cycle_idx` is
`(tenant_id, cycle_id, status)` and carries no ordering column.

**First attempt failed, and is recorded because it is the instructive part.** An index on
`(tenant_id, cycle_id, due_date desc)` changed nothing — **691.4 ms**. The query orders by
`due_date desc, id desc`, the identifier being the tiebreak that makes paging deterministic, and an
index covering only the first ordering column does not avoid the sort.

**Fix.** `(tenant_id, cycle_id, due_date desc, id desc) where deleted_at is null`, in migration
`20260811200000`. The plan becomes an ordered index scan:

```
Limit (actual time=0.075..0.108 rows=50)
  Index Scan using ... on performance_goal
```

**After: 37.2 ms.** No index was added before the problem was measured (Phase 12 D-21).

### Query plans (§8)

All inspected under the unprivileged role with RLS on. Every hot read is an index scan carrying the
tenant predicate and the policy's `One-Time Filter`:

```
manager queue        Index Scan using performance_review_manager_idx   ... 1.011 ms
queue count          Index Only Scan, Heap Fetches: 0                  ... 0.128 ms
goals by employment  Index Scan using performance_goal_employment_idx  ... 0.069 ms
assessments          Index Scan using performance_assessment_review_idx... 0.032 ms
```

No unexpected sequential scan, no N+1, no cross-tenant work, and paging is bounded everywhere.

### Admin UI (§6)

The `/performance` route builds at **385 B** of route JS on the shared 223 kB shell — it ships no
client component. It makes **twelve HTTP requests, independent of data volume**: five module
listings, six scoped to one cycle, one review detail. Nothing fetches per row; the cycle-scoped reads
are made once for one cycle and the detail for one review. Every listing is `page=1&size=50` and the
server's own `total` is displayed beside it.

## 8. Exactness (§16)

**No `numeric` column exists in this module.** There is no decimal to mis-parse.

Audit across the module, the API and the Admin screen:

| Pattern | Finding |
| --- | --- |
| `parseFloat(` | **0** |
| `parseInt(` | **0** |
| `Math.round(` | **0** |
| `score /`, `score *`, `observedValue /` | **0** |
| `Number(` | 60, **all safe** — see below |

Every `Number(` is one of: `asNumber` on an **integer** column (versions, ordinals, hundredths, basis
points); a row count; a page-size parse at the edge; or `Number(bigint)` on a score bounded by
`MAX_SCORE_HUNDREDTHS` = 1,000,000, far inside 2^53.

**The one value that can exceed 2^53 is `observedValue`, and `Number` is applied to it nowhere.**
The chain, verified at every hop:

```
bigint column → driver string → asBigInt() → domain bigint
             → String(bigint) → view string → API JSON string
             → exactText() identity → Admin HTML
write: DTO /^-?\d{1,30}$/ string → BigInt() → domain bigint → String() → column
```

`9007199254740993` is asserted at the repository, at the API and — uniquely — **against the rendered
markup**, together with the assertion that `9007199254740992` appears nowhere on the page.

Also asserted: 370 renders `3.70` and never `369.99…`; the configured minimum and maximum round-trip
exactly; a decimal input is refused 400; a score outside the scale is refused 422 rather than clamped;
zero renders `0.00` while absent renders `—`.

## 9. Dates (§17)

All **12** `date` columns in the module are read through `to_char(col, 'YYYY-MM-DD')` aliases. The
driver otherwise builds a `Date` at the *process's* local midnight, so a due date read west of UTC
comes back as the previous day and reports a goal overdue a day early.

At the API, one conversion in one place, with an explicit `Z`:

```ts
export const civil = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
```

**The Phase 8 defect is now a compile error.** Every controller destructures its date fields out of
the body before spreading the rest, so a string reaching a command beside the `Date` meant to replace
it types as `string | Date` and does not build — which is exactly how it was caught while writing
`cycle.controller.ts`:

```
error TS2379: Types of property 'selfAssessmentDue' are incompatible.
  Type 'string | Date' is not assignable to type 'Date'.
```

Employment's `asOf` is passed as a **`Date`**, because that is what the contract declares; the
upstream stub throws a `TypeError` on anything else. An ISO instant and a `DD/MM/YYYY` string are both
refused 400 at the edge.

## 10. Historical reproducibility (§14)

The mandatory scenario, end to end against real PostgreSQL, entirely over HTTP:

configure scale → framework → competencies → weighted template → create and open cycle → enrol from
Employment's own answer → set and approve a goal → self, peer and manager assessments → score →
calibrate 400 down to 350 with a named human and a reason → complete → **retire the scale, retire the
template, move the employment to a different manager in a different unit** → re-read.

It still says: `finalScore` 350, `calculatedScore` 400, the original manager, the legal entity
resolved through Organization at completion, a frozen four-level scale, and **byte-identical**
component scores. Self and peer assessments remain readable; only the manager's was counted.

Nothing is an in-memory snapshot. See [ADR-0068](../adr/0068-a-rating-is-explained-from-a-snapshot.md).

## 11. Events and reconciliation (§20)

**Nothing publishes an event and nothing subscribes to one** — not a simplification. This module
pulls every cross-module fact at the moment it needs it, so there is no delivery to lose. No outbox
was built and no durable delivery is claimed.

The cross-module suite asserts it: reconciliation finds what it finds with no event having been
delivered, and finds the same thing on a second read. Reconciliation **reports and repairs nothing** —
a report that silently corrected what it found would hide the fact that it kept finding it.

## 12. Immutability (§21)

Seven triggers, eight tests, and **a permitted case beside every refusal** — a trigger that refused
everything would pass a refusal-only suite while breaking the product.

| Record | Permitted | Refused |
| --- | --- | --- |
| Assessment | edited while draft | frozen on submission |
| Review | moves, scores, completes | any change after completion |
| Goal progress | appended | rewritten |
| Calibration decision | recorded | original score changed |
| Snapshot | written once | rewritten |
| Feedback | withdrawn | edited **or** deleted |
| Completed review | — | completed by `system:auto-approval`, at the table |
| Completed review | — | completed with no rating, at the table |

Both mutation paths are covered: the application refuses first, the trigger is the last line rather
than the only one. No trigger was disabled and no constraint weakened. Two constraints fired while
seeding this report's benchmark — `performance_review_completed_score_check` and
`performance_calibration_decision.calibrated_rating_level_id` — and the **seed** was corrected, not
the constraint. Table resets use `truncate`, the established safe mechanism, which a row trigger does
not see.

## 13. Admin UI and accessibility (§22, §23)

`/performance` builds and renders 12 workspaces. 33 tests assert against **real rendered markup**
produced by `renderToStaticMarkup` — no DOM, no testing library, no new dependency.

Verified: exact score rendering · English · Arabic (`ar('performance.label.goals')` present,
`performance.label.` key-fallback absent) · direction tied to language · empty vs unavailable vs
withheld distinguished · `<th scope="col">` on every table · wide tables scroll inside
`overflow-x-auto` · status carried by **translated words, never colour alone** · a real heading
hierarchy · `<dl>`/`<dt>`/`<dd>` tying labels to values.

No fake "My Team" — `managerEmploymentId` is never sent. No claimed anonymity — the word appears
exactly once, inside the sentence denying it, and the count is asserted.

The portal has no navigation component, no forms and no dialogs — in any of its thirteen module
screens. Performance matches the established architecture rather than becoming the only module with a
write surface. Recorded as debt in §17.

## 14. Dependency and code-quality audits (§24, §25)

`check-dependencies`: **1,241 source files, no cycles, no unused dependencies, no unreachable files.**
The Admin portal depends on `@work/performance` for its published contracts and locales only; it
carries no database dependency.

| Pattern | Count | Classification |
| --- | --- | --- |
| `any` | 0 | — |
| `as unknown as` | 1 | a doc comment explaining why it is *not* used |
| `as Query` | 0 | — |
| `eslint-disable`, `ts-ignore`, `ts-expect-error` | 0 | — |
| `.only`, `test.skip` | 0 | — |
| `describe.skip` | 10 | the `CONNECTION === undefined` guard, each paired with `requireDatabaseInCi` which **throws** rather than skipping in CI |
| `TODO`, `FIXME`, `console.log` | 0 | — |
| direct Prisma / direct SQL to another module | 0 | — |

## 15. Test isolation (§26)

The repository's safe configuration is `--concurrency=1`, and `pnpm test` pins it.

Run uncached at that setting: **41/41 tasks, 0 skipped tests.**

Run uncached at *default* concurrency, as an experiment: the deadlock reproduces.

```
FAIL  src/infrastructure/onboarding-isolation.integration.test.ts > Onboarding isolation
error: deadlock detected
  ❯ ensureApplicationRole src/infrastructure/onboarding-database.fixture.ts:125:3
```

**16 suites reported `n tests | n skipped`** — among them compensation isolation, attendance
isolation and payroll concurrency. That is the dangerous outcome: a run that looks partially green
with the security tests missing.

The configuration was **not** changed to make CI green, and no security test was allowed to stay
skipped. Concurrent fixtures create roles and issue `grant` statements against one instance and
deadlock on catalogue rows; the fix belongs in the fixtures, across all modules, and is recorded as
infrastructure debt in §17.

## 16. Final verification (§27)

`pnpm verify` with `TEST_DATABASE_URL` configured, uncached, at `--concurrency=1`:

| Gate | Result |
| --- | --- |
| standards | PASS — no violations |
| architecture | PASS — 143 models |
| localization | PASS — 14 catalogue sets complete |
| dependencies | PASS — 1,241 files, no cycles |
| format | PASS |
| lint | PASS — 41/41 |
| typecheck | PASS — 41/41 |
| tests | PASS — **41/41 tasks, 0 cached, 0 skipped** |
| build | PASS — 24/24 |

Test totals: `@work/performance` **127** · `@work/api` **219** · `@work/admin` **44** · repository
total **1,842**.

## 17. Defects, with original evidence

All nine were found by a test or a benchmark, never by reading. The layer reports carry the full
narrative; this is the register.

| # | Defect | Found by | Evidence |
| --- | --- | --- | --- |
| 1 | Scoring engine reported `not_applicable` for a component nobody assessed | domain suite | [application report](phase-13-application-report.md) |
| 2 | `readReviewHandler` derived the caller's scope from the review's own manager — a free pass for every `read-team` holder | journey suite | [application report](phase-13-application-report.md) |
| 3 | `authorizationFor` returned a string on both success and refusal, so **every invited reviewer was refused** | refusals suite | [application report](phase-13-application-report.md) |
| 4 | Completion inserted the snapshot **before** the version-guarded update, leaving a second snapshot when a race was lost | concurrency suite | [application report](phase-13-application-report.md) |
| 5 | `multiple assignments to same column "version"` in the assessment upsert — the in-memory store has no `on conflict`, so only real PostgreSQL could find it | integration suite | [PostgreSQL report](phase-13-postgres-report.md) |
| 6 | A recorded measurement could be written but never read back: `observedValue` was absent from the published view | API work | [API report](phase-13-api-report.md) |
| 7 | A lost optimistic-concurrency race answered **HTTP 500 across the whole product** — `ProblemDetailsFilter` mapped only `HttpException`, and no module had ever driven a stale version through HTTP | API suite | `expected 409 "Conflict", got 500 "Internal Server Error"` |
| 8 | `reviewScopeFor` resolved whichever manager a `read-team` caller named, directly below a comment saying it must not | API security work | [API report](phase-13-api-report.md) |
| 9 | Reconciliation was O(reviews × goals) | **this benchmark** | `reconciliation 10330.6 ms MISSED (budget 10000ms)` → 480.9 ms |

Plus the index miss in §7, and the instructive failed first attempt at it.

Defect 7 is the only one that reached outside Phase 13. It was fixed in the shared
`ProblemDetailsFilter` — the one place that turns an escaped exception into a response — and is
documented as a genuine compatibility defect in the API report.

## 18. Scope audit (§30)

Confirmed absent, by `grep` across the module, the API, the Admin screen and all three migrations:

| Checked for | Hits |
| --- | --- |
| one-to-one | 0 |
| PIP / improvement plan | 0 |
| career path / succession | 0 |
| accreditation / certification / training records | 0 |
| disciplinary | 0 |
| payroll calculation / net pay / gross pay | 0 |
| notification transport (smtp, nodemailer, twilio) | 0 |
| scheduling infrastructure (cron, setInterval, scheduler) | 0 |
| document storage (s3, blob, multipart, presigned, signedUrl) | 0 |
| principal → employment resolution | 0 |

Phase 13 introduced none of them.

## 19. NOT VERIFIED

Each is a missing dependency, not a broken implementation. **None is approximated anywhere**, and the
Admin screen states each in both languages so nothing later is built on top of a capability that is
not there.

| Capability | State |
| --- | --- |
| Principal → employment resolution | No adapter exists (ADR-0032) |
| `review.read-team` without a trusted manager employment | A `read-team` caller reads **nothing**, whatever they name |
| Notification delivery | Intent recorded; nothing delivers it |
| Scheduled execution | Nothing opens or closes on a timer |
| Binary document upload / download | No `StoragePort` adapter |
| Signed document URLs | Same |
| True 360° anonymity | Confidentiality only; every response is attributed |
| Self / peer weighting | Recorded and readable; counted by nothing |
| OKR application / API functionality | Tables and RLS; no application contract |

None became "implemented" because a screen mentions it.

## 20. Technical debt

| Item | Why it remains outside Phase 13 |
| --- | --- |
| **Test-isolation deadlock at default concurrency** | The fixtures across *all* modules create roles and grant concurrently. Fixing it is a repository-wide change to nine fixtures; the safe configuration is pinned and enforced meanwhile (§15) |
| **`performance.assess-peer` gates responding, not writing** | Writing a peer assessment requires `performance.assess`; the invitation lookup is what narrows the path, and it is tested both ways. Separating them needs a handler to declare two acceptable permissions, which the kernel pipeline does not support — a kernel change |
| **OKR sub-structure** | `performance_objective` and `performance_key_result` have tables, indexes and RLS but no port, repository, route or screen. Schema ahead of application, recorded rather than removed |
| **Admin portal has no navigation, forms or dialogs** | True of all thirteen module screens. Building them for Performance alone would be a second UI architecture |
| **`CompetencyView` publishes no behavioural levels** | A framework editor would need them; the listing publishes what a reader needs to know a competency *is* |
| **Admin overview counts are page-scoped** | Counting a tenant's whole review set in a browser is what bounded pagination exists to prevent |
| **Storage-reference pattern inconsistency** | Inherited from Phase 12; a cross-phase refactor (D-25) |

---

## Status

**PHASE 13 — COMPLETE**

Every §31 criterion is verified:

Final benchmarks executed at 500, 10,000 and 100,000 · query plans inspected · RLS final audit passed
on 23/23 tables from an unprivileged role · permission matrix passed · both authorization regressions
permanently covered · seven concurrency races on two real connections · historical reproducibility
proven against real PostgreSQL · all scoring golden cases pass · exact-number audit clean with the
2^53 + 1 chain verified database → API → HTML · date audit clean with the Phase 8 defect now a
compile error · cross-module contract audit clean · service-grant audit clean · immutability audit
passed on both paths · Admin UI and accessibility audits passed · dependency audit clean ·
code-quality audit clean · test-isolation experiment completed and its evidence preserved ·
`pnpm verify` passes with 0 skipped tests · documentation updated · this report created.

Two budget misses were found and both were fixed, with before and after preserved. No budget was
moved, and no failure was rounded down.
