# Phase 15 — Career, Succession & Development

## Executive Summary

Phase 15 delivers one module: **Career**. It records the ladders a tenant defines, who is on one,
the succession benches it keeps, what people have been judged ready for, what they agreed to do, and
where somebody suggested they move next.

**It recommends and executes nothing.** No employment, position, assignment or salary changes because
of anything in this module, and there is no port through which one could
([ADR-0072](../adr/0072-a-career-recommendation-is-advisory-and-writes-nothing.md)). `accepted` on a
mobility recommendation means a human agreed with a suggestion; the move itself is another module's
act, taken elsewhere by somebody else, and Career would not know if it happened.

**It computes no readiness.** The specification defines no formula, so a named person states a level
and nothing derives one
([ADR-0074](../adr/0074-readiness-is-stated-by-a-person.md)). There is no score, no percentage and no
nine-box anywhere in the module — no column to store one, no query to produce one, no label to print
one.

**A decision is Career's; an observation stays where it was made**
([ADR-0073](../adr/0073-a-decision-is-careers-an-observation-stays-where-it-was-made.md)). Talent-pool
membership is a standing decision an organization took. Performance's nine-box placement is an
observation of one cycle. Neither derives the other.

What it deliberately does not deliver: critical-position enumeration (D-4), nine-box and
high-potential integration (D-5), employee and manager self-service, scheduled review, scheduled
expiry, notification delivery, evidence documents, 70-20-10 validation, computed readiness and
analytics. Sixteen capabilities remain `NOT VERIFIED`, each for a stated reason, and none of them has
a placeholder anywhere in the product.

**Final verification: green.** `pnpm standards` and `pnpm verify --force` both pass at the
repository's pinned concurrency, with **2,660 tests, 0 skipped**, no cycles, no unused dependencies,
and zero prohibited patterns.

---

## Scope Delivered

### Domain

Twelve aggregates: `CareerPath`, `CareerStage`, `CareerPlan`, `TalentPool`, `PoolMembership`,
`SuccessionPlan`, `Successor`, `ReadinessLevel`, `ReadinessAssessment`, `DevelopmentPlan`,
`DevelopmentItem`, `MobilityRecommendation`. Pure functions over immutable state, returning refusals
as values with a catalogue key rather than throwing.

### Schema

**12 tables**, 12 Prisma models, 26 indexes of which 9 are partial unique, one immutability trigger,
and `app_protect_table` on every table. Cross-module identifiers — an employment, a position, a unit,
a learning assignment — are bare `uuid` columns with **no foreign key**, which is what keeps one
module's migration from becoming another's outage.

### Application

**27 commands · 13 queries · 21 permissions · 3 cross-module ports**, plus in-memory stores, a test
harness and the published contracts. Every handler declares the one permission it needs.

### Persistence

**11 repository classes across 9 files**, assembled by `postgresCareerStores()` into the complete
`CareerStores` interface — no in-memory fallback anywhere in the production path. Row-level security,
immutability, partial uniqueness and optimistic concurrency are all enforced by the database rather
than only by the application.

### Cross-module

Three adapters — Employment, Organization, Learning — each inside a bounded service grant naming its
exact permissions. Two contract facts define this phase's boundary work: the narrow
`organization.list-positions(positionId?)` addition, and the Learning deviation to
`assignmentIsFor(employmentId, assignmentId)`.

### API

**12 controllers · 40 endpoints** — one per command and query, each routed once. Lifecycle
transitions are named sub-resources; there is no generic status `PATCH` anywhere.

### Admin

`/career`, server-rendered, **16 sections across 6 workspaces**, English and Arabic with `dir="rtl"`,
a request budget of **at most 13** that does not grow with data, and no mutation architecture at all.

### Performance and security

26 workloads at 500 / 10,000 / 100,000 employments per tenant, two tenants, unprivileged role,
**zero budget misses**. RLS enabled and forced on all 12 tables with exactly one policy each.

---

## Architecture

Career owns **decisions about a person's future** and nothing else.

| Career owns | Another module owns | Why |
| --- | --- | --- |
| A career path, its stages, and a person's plan against one | The position a stage names — Organization | A position's title, grade and criticality are the org structure's facts (AD-004) |
| Talent-pool membership: a standing decision | The nine-box placement: an observation of one cycle — Performance | ADR-0073. Neither derives the other |
| A development plan and its non-course items | The course, the assignment and its completion — Learning | A course item is a *reference*; Career stores no status of its own |
| A readiness statement somebody made | The employment it is about — Employment | Career confirms an identifier; it stores no employment fact |
| A mobility *recommendation* | The promotion, transfer or salary change itself — Employment, Compensation | ADR-0072. A recommendation moves nobody |

Career does not own promotion, transfer, salary, training, competency, nine-box or criticality
because each of those is another module's authoritative record, and a second copy is the staler of
two answers. The module reads what it needs at the moment it needs it, through a bounded grant, and
stores only the identifier.

---

## Decisions & ADRs

All 21 decisions are settled. The material ones:

| | Decision | Outcome |
| --- | --- | --- |
| D-1 | Standing pool vs per-cycle nine-box | Career owns **membership**; Performance owns **placement**. Neither derives the other (ADR-0073) |
| D-2 | Development plan vs Learning paths | Career owns the plan and non-course items; a course item **references** a Learning assignment |
| D-3 | `CriticalPositionReference` table | **No.** Career stores a `position_id` and no property of it |
| **D-4** | `criticality` filter on Organization | **Refused. `NOT VERIFIED`.** Only the narrow `positionId` lookup was authorized (Checkpoint 6) |
| **D-5** | Paged talent-placement query on Performance | **Refused. `NOT VERIFIED`.** No Performance adapter exists |
| D-6 | Does Career compute high-potential? | **No.** Nothing derives it from readiness, pool membership, succession status or a career stage |
| D-8 | Does confirming a successor consume `ApprovalPort`? | **No.** A named human act with its own permission; `system:auto-approval` refused by check constraint |
| **D-9** | Joint employee/manager ownership | **`NOT VERIFIED`.** An administrator records both acknowledgements as **named acts** — they are records, not signatures |
| D-10 | Readiness stated or computed | **Stated** by a person (ADR-0074) |
| D-11 | Civil dates or timestamps | **Civil dates**, `YYYY-MM-DD`, end to end |
| **D-12** | The 70-20-10 development mix | **`NOT VERIFIED`.** Categories are recorded and **counted**; there is no validation, target, tolerance or verdict, and the API returns the literal `NOT VERIFIED` |
| D-13 | Does a recommendation expire? | A `valid_until` stored; `expired` **derived on read** against a stated day |
| D-14 | Assessments immutable at the table | **Yes.** One trigger refusing update and delete |
| D-16 | `CareerSummaryProjection` table | **No.** Derived on read, six store reads |
| D-17 | Stages: gates or order | **Order.** No progression is enforced |

**ADR-0032** (no principal → employment resolution) is unchanged and is why self-service, manager
self-service, delegated access and joint ownership are all `NOT VERIFIED`. **ADR-0042** (bounded
service grants) is how every cross-module read is authorized. No decision was reinterpreted or
expanded in this phase.

---

## Cross-Module Contracts

Five operations, each naming its exact permissions. **No wildcard, no prefix, no extra permission.**

| Adapter | Operation | Permits | Contract consumed |
| --- | --- | --- | --- |
| `CareerEmployment` | `read-employment` | `employment.employment.read` | `employment.read-employment` |
| `CareerEmployment` | `read-position-employments` | `employment.employment.read` | `employment.search` |
| `CareerOrganization` | `confirm-position` | `organization.position.read` | `organization.list-positions` |
| `CareerOrganization` | `confirm-organization-unit` | `organization.hierarchy.read` | `organization.unit-ancestry` |
| `CareerLearning` | `confirm-learning-assignment` | `learning.assignment.read`, `learning.assignment.read-all` | `learning.read-history` |

Every adapter takes `Asking`, which declares `ask` and **no `send`** — so an adapter that tried to
write another module's data would not compile. No People, Performance or Documents adapter exists.

**The one completed-module change**, authorized in Checkpoint 6 and expanded no further:
`organization.list-positions` gained `positionId?: string`, an exact-identifier predicate. The
response, the permission, the tenant boundary, the pagination and the behaviour when it is absent are
all unchanged. It adds no way to *discover* a position by any property. **There is no `criticality`
filter** — the only occurrence of the word in Organization's query file is the sentence explaining
that it does not exist.

**The Learning deviation**, recorded verbatim in Checkpoint 6:

> The originally planned `assignmentExists(assignmentId)` contract was not published by Learning.
> Career instead uses `assignmentIsFor(employmentId, assignmentId)` through `learning.read-history`,
> which is narrower and additionally proves ownership by the employee.

Learning was not modified. The narrower question is the better one: `assignmentExists` would have
accepted a colleague's real assignment on this person's development plan, and `assignmentIsFor`
refuses it.

---

## Security / RLS

Verified against the live database, as an **unprivileged role** with `rolsuper = false` and
`rolbypassrls = false` asserted before anything rests on it. No security claim in this report comes
from a superuser-based test.

- **RLS enabled *and* forced on 12 of 12 tables.**
- **Exactly one policy per table**: `tenant_isolation`, `ALL` commands, permissive, applied to
  `public`, expression `(tenant_id = app_current_tenant())`. Twelve tables, twelve policies —
  asserted because PostgreSQL ORs permissive policies together, so a second well-meaning policy would
  widen the boundary silently.
- **No cross-tenant read, count, write, tenant-move or no-context leakage.** The neighbour is seeded
  at equal volume at every benchmark tier and sees zero rows **and a total of zero** across all six
  searches; an exact-identifier read of another tenant's succession plan returns nothing; its bench
  counts return `0/0`.
- **Exact-ID isolation over HTTP answers 404, never 403** — a 403 would confirm the record exists,
  and for a succession bench that is most of the disclosure.
- **11 foreign keys within Career, 0 crossing into another module.**
- **Authorization**: each collection opens to exactly one permission, proved by granting a caller
  *every other* Career permission and asserting 403. The four deliberate separations
  (`pool.manage` ↛ `pool.assign`, `successor.nominate` ↛ `successor.confirm`, `readiness.read` ↛
  `readiness.record`, `mobility.recommend` ↛ `mobility.decide`) each have a test.
- **A client-supplied identifier is never a credential.** An `employmentId` names the subject of a
  record, never the caller. There is no `/career/me` and no `/career/my-team`, asserted rather than
  merely absent.

---

## Concurrency / Immutability

Two real PostgreSQL connections, no sleeps, no disabled constraints, no serialized fake store.

- **Partial unique indexes** arbitrate: one active career plan per employment, one active succession
  plan per position, one open nomination per person per bench, one open membership per person per
  pool, unique path code, unique readiness ordinal, unique stage sequence.
- **Insert-if-absent convergence**: the same nomination issued twice at once returns 201 twice, names
  the same successor, reports `created: true` exactly once, and leaves one name on the bench.
- **Versioned amendments**: two moves from the same version leave exactly one winner; the loser gets
  `ConcurrencyException` → 409, and the persisted version increments exactly once.
- **Non-conflicting writes both succeed**: two different nominees, two different people's plans, two
  assessments about one person.
- **Immutability**: a readiness assessment cannot be updated or deleted — a trigger refuses both. A
  correction is a new assessment, and `latest` is a *selection* of the most recent statement, never an
  average of two.

Repeated at three levels: repository races (Checkpoint 5), through the production adapters
(Checkpoint 6) and over HTTP (Checkpoint 7).

---

## Exactness / Civil Dates

Career holds **no money, no rate, no percentage and nothing computed** (ADR-0074), so its exactness
argument rests on two properties it actually has.

- **Every number is a bounded integer.** The schema has **no `numeric`, no `double precision`, no
  `real`, no `bigint` and no `money`** column anywhere — asserted across all twelve tables at once.
  The three values a human enters are a stage sequence (≤ 500), a successor rank (≤ 50) and a
  readiness ordinal (≤ 100).
- **Every civil date is a `date` in the column and a `YYYY-MM-DD` string everywhere above it.** No
  `Date` exists on the path. Every instant is a `timestamptz`, and the two are never confused —
  asserted by column type across all twelve tables.
- **The boundaries survive end to end**: sequence `500`, rank `50` and ordinal `100` come back as the
  integers they were sent as, `Number.isInteger` true, through the repository, the API and into the
  rendered markup as exact cells — with no separator and no localized digit in either language.
- **`2026-02-28` is `2026-02-28`** in the database, the response and the HTML, in English and Arabic.
  Never the 27th a `Date` round trip produces west of UTC.
- **Impossible dates are refused, not normalized**: `2026-02-30`, `2025-02-29` and `2026-04-31` each
  earn a named 422; six malformed shapes earn a 400 at the edge.

No decimal exactness example appears in this phase, because Career has no decimal field. Fabricating
one would have meant adding a column the product does not have.

---

## Performance

`scripts/measure-career-performance.mjs`. Real PostgreSQL, real repositories, unprivileged role,
**a second tenant seeded at the same volume at every tier**, `vacuum analyze` after seeding. Budgets
inherited from Phases 13 and 14A **unchanged**: queue 100 ms, detail 150 ms, cohort 2 s / 10 s / 60 s.

Milliseconds. A = 500, B = 10,000, C = 100,000 employments **per tenant**, two tenants.

| Workload | Budget | A | B | C |
| --- | --- | --- | --- | --- |
| path list (published) | queue | 21.0 | 54.6 | 18.0 |
| path stages | detail | 1.9 | 2.0 | 2.2 |
| pool list (active) | queue | 2.1 | 2.2 | 2.4 |
| readiness levels | detail | 1.4 | 1.6 | 2.1 |
| career plans by path | queue | 3.0 | 4.7 | 13.1 |
| pool membership listing | queue | 2.6 | 4.8 | 6.5 |
| pool membership as-of a day | queue | 2.7 | 5.5 | 11.1 |
| succession listing (active) | queue | 3.1 | 5.2 | 3.5 |
| succession, review due by a day | queue | 2.7 | 4.1 | 2.8 |
| succession plan read | detail | 1.5 | 1.7 | 1.5 |
| successors for one plan | detail | 2.1 | 3.7 | 2.3 |
| bench strength, one position | detail | 1.3 | 1.6 | 1.3 |
| **bench strength, 40 positions** | cohort | **19.3** | **13.4** | **15.0** |
| career plans by employment | queue | 1.7 | 2.5 | 2.1 |
| readiness history, one person | detail | 2.4 | 2.6 | 2.5 |
| readiness by level *(unrouted)* | queue | 2.3 | 4.0 | 11.1 |
| development plans by employment *(unrouted)* | queue | 2.2 | 2.8 | 3.0 |
| open development items due *(unrouted)* | queue | 4.0 | 4.3 | 14.8 |
| mobility listing (proposed) | queue | 3.6 | 4.4 | 9.1 |
| career summary (6 reads) | detail | 7.7 | 5.6 | 5.0 |
| cohort: career plans (200) | cohort | 7.7 | 4.7 | 3.2 |
| cohort: memberships (200) | cohort | 5.2 | 3.3 | 4.0 |
| cohort: successors (200) | cohort | 5.1 | 3.2 | 4.1 |
| cohort: assessments (200) | cohort | 5.2 | 3.8 | 4.5 |
| cohort: development plans (200) | cohort | 5.1 | 3.7 | 4.0 |
| cohort: recommendations (200) | cohort | 4.7 | 3.1 | 4.8 |

**Zero misses at any tier. No budget was redefined and no index was added.** The slowest read at
100,000 employments per tenant is 15.0 ms against a 100 ms budget.

### The two conclusions worth stating

**1 — Bench strength across many positions stayed flat, on an index-only scan.** The plan named this
as an O(n×m) risk of the kind Phase 13 hit. Forty benches counted in sequence cost 19.3 ms at 500
employments and 15.0 ms at 100,000 — no slope. Each count is an `Index Only Scan` on
`career_successor_plan_idx` with zero heap fetches, and the fixture gives every tier four hundred
positions rather than a handful precisely so a slope would have shown.

**2 — The open-items-due workload was corrected, not the index.** Measured first without a status, it
took 28.6 ms behind a `Seq Scan` over 60,000 rows. `career_development_item_due_idx` is **partial** on
`status in ('planned','in_progress')`, so a query omitting the status cannot reach it. The index was
**not** changed: the omission was the benchmark's, and re-measured against the shape the index serves
it is an `Index Scan` at 14.8 ms. Adding an index to make a synthetic query faster is precisely what
the plan forbids.

### Query plans

Captured from the repositories rather than rewritten — the transaction is wrapped, the repository does
its work, and every statement is explained **exactly as issued**. Verified across eight reads: the
tenant predicate is visible twice (the policy and the repository's own `tenant_id = $n`); `LIMIT` is
pushed into the query as a `Limit` node over a `top-N heapsort`; every `Sort Key` ends in `id`, so
paging is deterministic; every count uses the same clause as the listing it labels; every declared
index is reachable. **No query fetches an upstream dataset to filter it in Career** — there is none to
fetch, because every cross-module read is a single confirmation of an identifier the caller already
holds. **No N+1 exists**: the adapters are called during commands to confirm an identifier, never once
per row, and the Admin screen's budget is fixed at 13 requests regardless of volume.

### Two plan workloads that were not invented

The plan's §19 names **"readiness distribution"** and **"the reconciliation queries"**. Neither exists
as a query, and neither was built for this phase:

- A readiness *distribution* is an aggregate over a population — that is analytics, and analytics is
  `NOT VERIFIED`. The bounded per-level search was measured in its place, labelled *(unrouted)*.
- §16 describes reconciliation as questions answered live and bounded. What was built is the
  `employmentIdsIn` cohort filter on every search: one query for two hundred people, never one per
  person. That is what the cohort rows above measure.

---

## Defects

Seventeen defects across the phase. **Three were production defects**; the fourteen others were in tests,
fixtures or the benchmark, and are listed because a register that hid them would be less useful.

### Production defects

**P1 — an impossible civil date reached PostgreSQL as a 500** *(Checkpoint 7)*
*Symptom*: `POST /career/paths` with `effectiveFrom: '2026-02-30'` returned 500.
*Root cause*: `createPath` was the only Career domain constructor with **no `isCivilDate` call** —
every other aggregate validates its dates. Two strings order fine whether or not either names a real
day, so the period comparison passed, the value reached a `date` column, and PostgreSQL's `22P02`
escaped as an internal error.
*Fix*: the two checks, in the domain constructor — not at the edge — with two rejection keys added to
both catalogues.
*Regression*: three impossible days and six malformed shapes, asserted at the HTTP level.

**P2 — a malformed path identifier was a 500** *(Checkpoint 7)*
*Symptom*: `GET /career/paths/not-a-uuid` returned 500, telling a caller with a typo to report a bug.
*Root cause*: the identifier reached `where id = $1` unvalidated.
*Fix*: `ParseUUIDPipe` on every identifier parameter across all twelve controllers.
*Regression*: the problem-details test asserts 400.

**P3 — Organization's in-memory position store ignored the new filter** *(Checkpoint 6)*
*Symptom*: two of five cases failed in `organization-position-lookup.test.ts`.
*Root cause*: the predicate was added to the contract and the PostgreSQL repository but not the fake,
so the two disagreed and **the fake was the more permissive** — a test using it would have passed
while production refused.
*Fix*: the same predicate in the in-memory store.
*Regression*: that suite, which exercises both stores.

### Test, fixture and benchmark defects

| | Checkpoint | Classification | Symptom → root cause → fix |
| --- | --- | --- | --- |
| T1 | 3 | Test | Two probes named the wrong constraint → an unknown status legitimately trips a second check, and evaluation order is not promised → supply the other columns so only the field under test can refuse |
| T2 | 3 | Test | Parity suite counted 9 unique indexes but queried all → primary keys included → filter on partial indexes only |
| T3 | 6 | Test | Row count read through `CareerSummaryView`, whose plan is the *active* one, while `create-plan` writes a **draft** → reported 0 after a successful write, so "nothing was written" passed for the wrong reason → count through the search queries |
| T4 | 6 | Fixture | Cross-module suites connected as a **superuser**, which bypasses every policy → every tenant assertion was proving only that Career's SQL filters on a tenant → connect as a role with neither `SUPERUSER` nor `BYPASSRLS`, and assert that first |
| T5 | 6 | Fixture | A failed raw probe returned its client to the pool inside an aborted transaction → the *following* test failed → rollback moved into a `finally` |
| T6 | 7 | Test | Four helper errors: readiness with no subject, activation of an empty bench, an illegal item transition, and three `supertest` requests built up front racing the listener |
| T7 | 8 | Test | Two negative assertions matched the **refusal notices themselves** → narrowed to headings, column headers and figure labels |
| T8 | 8 | Test | Request-count test used `localhost` where `WORK_API_URL` defaults to `127.0.0.1` → no path matched → corrected the base |
| T9 | 9 | Fixture | Seed omitted `career_readiness_assessment.recorded_at` (not-null) → added |
| T10 | 9 | Fixture | Seed marked course items `completed`; `career_development_item_course_status_check` refused them — the constraint enforcing ADR-0073 doing its job → only Career-owned kinds move on |
| T11 | 9 | Benchmark | Items-due measured without a status, 28.6 ms behind a `Seq Scan` → the index is partial on open statuses → **re-measured against the shape the index serves; the index was not changed** |
| T12 | 9 | Test | `_` is a single-character wildcard in SQL `LIKE`, so `%_on` matched `version` → escaped the underscores |
| T13 | 9 | Test | The new scope audit misclassified `phase-fifteen-*` scaffolding as production, and matched `as any` in prose → aligned the scaffolding rule; suppressions searched raw, everything else in stripped code |
| T14 | 9 | Test | The scope audit failed against **itself** for listing the markers it searches for → directives matched as comment forms, markers assembled from halves |

---

## NOT VERIFIED

Sixteen capabilities. For each: what was expected, what exists, why it is not verified, and its kind.

| Capability | What was expected | What actually exists | Why not verified | Kind |
| --- | --- | --- | --- | --- |
| **Employee self-service** | An employee reads their own career plan | `career.plan.read-own` declared; routed nowhere; scope resolves to nothing | No principal → employment resolution (ADR-0032) | Missing infrastructure |
| **Manager self-service** | A manager reads their team's plans | `career.plan.read-team` declared; routed nowhere | Same. A caller-supplied `managerEmploymentId` is a filter, never proof of identity | Missing infrastructure |
| **Delegated access** | A delegate acts for somebody | Nothing | No delegation model exists in this repository | Missing infrastructure |
| **Principal → employment resolution** | The signed-in person resolves to an employment | Nothing | ADR-0032; no authentication adapter is supplied | Missing infrastructure |
| **Joint employee/manager ownership** | Both parties own a development plan | An administrator records **both acknowledgements as named acts**, with the day and who recorded them | Neither party can be identified. These are records, **not signatures** (D-9) | Refused by decision |
| **Scheduled succession review** | A review comes due by itself | A `review_on` date stored; `reviewDue` **derived on read** against a stated day | `JobPort` has zero implementors. Nothing fires, nothing is queued, nobody is notified (D-16) | Missing infrastructure |
| **Scheduled mobility expiry** | A recommendation expires by itself | A `valid_until` stored; `standing` **derived on read**. The same row reads as current if asked about an earlier day | Same. Nothing expires it (D-13) | Missing infrastructure |
| **Notification delivery** | Somebody is told | Nothing. Career composes **no** notification port at all | `NotificationPort` has a recording stub only, and a recorded intent nobody reads is a "sent" state waiting to be misread | Refused by decision |
| **Evidence document on a readiness assessment** | An assessment cites a document | Nothing. The column was **removed** in Checkpoint 4 rather than confirmed and discarded | Career's schema has nowhere to persist the identifier; confirming one and dropping it is validation theatre | Refused by decision |
| **Document upload / download** | A file is stored and served | Nothing | `StoragePort` has zero implementors | Missing infrastructure |
| **Signed URLs** | A time-limited link | Nothing | Same | Missing infrastructure |
| **70-20-10 validation** | A balance verdict | Three category **counts**, and the literal `NOT VERIFIED` as the verdict the API returns and the screen prints | No balance rule, target or tolerance was ever specified (D-12). A computed verdict would invent the rule and the judgement in one step | Refused by decision |
| **Computed readiness** | A level derived from performance and learning | A level **stated** by an authorized human, with a rationale and their name | No formula exists in the specification (ADR-0074) | Refused by decision |
| **Critical-position enumeration (D-4)** | "List this tenant's critical positions" | The succession plans Career itself holds, and an exact-identifier confirmation | Organization publishes **no `criticality` filter**, and the additive change authorized in Checkpoint 6 was deliberately narrower | Blocked by a missing contract; refused by decision |
| **Nine-box / high-potential listing (D-5)** | A high-potential list from Performance | Pool membership Career itself holds | `performance.talent-matrix` is unpaged, so the read would be unbounded. **No Performance adapter exists** | Blocked by a missing contract; refused by decision |
| **Analytics** | Predictive or aggregate workforce intelligence | Bounded reads other systems may consume | Named in the specification's "Future Consumers"; nothing predictive was built. A readiness *distribution* is analytics and was not invented | Explicitly deferred |

**Reconciliation queries** and **readiness distribution** are covered above: neither exists, and
neither was fabricated for a benchmark. The bounded cohort filter is a different shape and is what
was measured.

None of these has a placeholder success state anywhere in the product. Proved rather than asserted:
the schema has no column any of them could be stored in; a phase-wide audit finds none of their
machinery in the code of any layer, with comments and string literals stripped so prose cannot pass
for implementation; the three self-service permissions are routed by no handler; and the Admin status
section states all of them in both languages.

---

## Technical Debt

**Carried forward from earlier phases:**

- **Test fixtures deadlock at default concurrency.** Reproduced again in Checkpoint 9, exactly as
  Phases 13 and 14A recorded: two packages running `create role … if not exists` against `pg_authid`
  at once. Payroll and compensation fail; 36 suites skip. **Career is not the failing package**,
  though its fixture uses the same pattern and is susceptible in principle. The pinned configuration
  is preserved and was not weakened.
- The `effective_from` type split across modules (plan §4.6).
- Five kernel ports with no adapter: `JobPort`, `NotificationPort`, `StoragePort`, `ApprovalPort`, and
  the identity resolution ADR-0032 describes.
- No human-readable numbering facility (D-20).
- Five `isCivilDate` copies in completed modules accept `2026-02-30`. Found by a Career domain test in
  Checkpoint 2 and recorded rather than fixed, because those modules are complete. **Career's own
  implementation is correct**, and the one gap inside Career was fixed as P1.

**Created by this phase:**

- **Three store searches are unreached by any published query**: `assessments.search`,
  `developmentPlans.search` and `developmentItems.search` are declared, indexed and called by nothing
  in the application layer. They are measured and labelled *(unrouted)* in the benchmark, because a
  fast number against a read no screen makes would otherwise read as evidence a screen is fast.

The Learning contract gap is **not** debt: `assignmentExists` was never needed once
`assignmentIsFor` proved to be the better question.

---

## Scope Exclusions

Explicitly not implemented, and not started:

D-4 critical-position listing · D-5 nine-box and high-potential listing · employee self-service ·
manager self-service · delegated access · principal → employment resolution · joint ownership ·
scheduled succession review · scheduled mobility expiry · notification delivery · evidence documents ·
document upload/download · signed URLs · 70-20-10 validation · computed readiness · analytics ·
reconciliation queries · readiness distribution · promotions · transfers · salary changes ·
vacancy/requisition · workflow routing · **Phase 16**.

No completed module was modified beyond the single authorized `organization.list-positions(positionId?)`
addition.

---

## Verification

Commands actually run, on the final tree:

```
pnpm standards
TEST_DATABASE_URL=… pnpm verify --force --concurrency=1
TEST_DATABASE_URL=… node scripts/measure-career-performance.mjs --only=A|B|C [--plans]
TEST_DATABASE_URL=… pnpm exec turbo run test --force        # the isolation experiment
```

| | Result |
| --- | --- |
| `pnpm standards` | **green** — no violations |
| Architecture | **green** — 167 models checked |
| Localization | **green** — 16 catalogue sets complete |
| Dependencies | **green** — 1,509 files, no cycles, no unused dependencies, no unreachable files |
| Format · lint · typecheck · build | **green** |
| Tests | **2,660 passed**, uncached, at the pinned concurrency |
| Skipped | **0** |
| `.only` · lint suppressions · `any` | **0 · 0 · 0** |

**Test counts.** Phase 14A closed at 2,180. Phase 15 adds **480**: 294 in the Career module package,
135 Career suites under the API, 46 Career suites in Admin — 475 — plus the 5-test Organization
position-lookup suite that accompanies the authorized contract change. 2,180 + 480 = **2,660**.

**Test-isolation experiment**, both configurations reported. Safe pinned (`--concurrency=1`): green,
2,660 tests, 0 skipped, twice. Default concurrency: **reproduces the known deadlock** and was **not**
declared green. Evidence, packages and skipped counts are in
[`phase-15-performance-report.md`](phase-15-performance-report.md).

**Supporting evidence:** [`phase-15-plan.md`](phase-15-plan.md) ·
[`phase-15-decisions.md`](phase-15-decisions.md) ·
[`phase-15-cross-module-report.md`](phase-15-cross-module-report.md) ·
[`phase-15-api-report.md`](phase-15-api-report.md) ·
[`phase-15-performance-report.md`](phase-15-performance-report.md).

---

## Conclusion

**Phase 15 is complete.**

Every gate passes on the final tree: standards, architecture, localization, dependencies, format,
lint, typecheck, 2,660 tests with none skipped, and build. The twelve aggregates, twelve tables,
twenty-seven commands, thirteen queries, twenty-one permissions, eleven repositories, three adapters,
forty endpoints and sixteen Admin sections all exist and are exercised. Twenty-six workloads were
measured at three tiers against unchanged budgets with zero misses, and the two shapes the plan
flagged as suspect were both investigated rather than accepted on their numbers.

Sixteen capabilities remain `NOT VERIFIED`. Each is named, each has a stated reason, and none of them
has a placeholder anywhere in the product — which is the difference between a phase that finished and
a phase that claimed to.

Three production defects were found and fixed, each reproduced before it was touched and each with a
regression that would catch it again. Fourteen test, fixture and benchmark defects are recorded beside
them rather than quietly corrected.

**Phase 16 is not started**: no column, no port, no route, no screen.
