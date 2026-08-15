# Phase 15 — Career: production cross-module adapters

What Career asks other modules, what it is permitted to ask while asking, and what it still cannot
answer. Written at the point the adapters became real, so the record is contemporaneous with the
code rather than reconstructed from it at the end of the phase.

---

## The change to a completed module, and its authorization

Checkpoint 6 began by stopping. The approved plan assumed `organization.list-positions` could
confirm a single position; reading the repository's SQL showed its `term` filter matches
`code ilike $4 or title->>'en' ilike $4 or title->>'ar' ilike $4` and never `id`, and that none of
Organization's eight published queries answers *"is this identifier a position in my tenant"*. The
plan's claim — "Yes for existence" — was wrong. It was reported before anything was changed, and the
change below was explicitly authorized in response.

**The change.** `organization.list-positions` gained an optional `positionId?: string`. The
`PagedResult<PositionView>` response, the `organization.position.read` permission, the tenant and
row-level-security boundaries, the pagination semantics and the behaviour of every existing caller
are unchanged. The PostgreSQL repository applies it as an exact identifier predicate; the in-memory
store applies the same predicate, which is a correction described under *defects* below.

**Why it does not authorize D-4.** D-4 is *"list this tenant's critical positions"*. That needs a
`criticality` filter, and none was added — there is no argument to pass and no method on Career's
Organization adapter that omits the identifier. Confirming an identifier the caller already holds
returns strictly less than the same `organization.position.read` permission already allowed; asking
which positions an organization considers critical is a different question, and it is still
unanswerable through any contract Career can reach. **D-4 remains NOT VERIFIED.**

## The deviation from the approved plan

> The originally planned `assignmentExists(assignmentId)` contract was not published by Learning.
> Career instead uses `assignmentIsFor(employmentId, assignmentId)` through `learning.read-history`,
> which is narrower and additionally proves ownership by the employee.

Learning was not modified. The narrower question is also the better one: `assignmentExists` would
have accepted a colleague's assignment attached to this person's development plan, and
`assignmentIsFor` refuses it — asserted in the mandatory scenario, where a real assignment belonging
to `PEER_ID` is rejected with `career.rejection.learning-assignment-not-found`.

`learning.read-history` resolves scope per learner, and Career's grant therefore names
`learning.assignment.read-all` alongside `learning.assignment.read`: without it the scope resolver
returns an empty page and every confirmation would answer *no*.

## The production grants

Five operations, each with an explicit permission list. No wildcard, no prefix, and no permission
that is not needed by the query it accompanies. A source audit in
`phase-fifteen-boundaries.cross-module.spec.ts` pins the exact set, so adding a sixth permission
fails a test rather than passing review.

| Adapter | Operation | Permits | Asks |
| --- | --- | --- | --- |
| `CareerEmployment` | `read-employment` | `employment.employment.read` | `employment.read-employment` |
| `CareerEmployment` | `read-position-employments` | `employment.employment.read` | `employment.search` |
| `CareerOrganization` | `confirm-position` | `organization.position.read` | `organization.list-positions` |
| `CareerOrganization` | `confirm-organization-unit` | `organization.hierarchy.read` | `organization.unit-ancestry` |
| `CareerLearning` | `confirm-learning-assignment` | `learning.assignment.read`, `learning.assignment.read-all` | `learning.read-history` |

Every adapter takes `Asking`, not `Dispatcher`: the interface has `ask` and no `send`, so an adapter
that tried to write another module's data would not compile. The audit also asserts that none of
them holds a driver, an ORM or a repository — there is nothing to issue a query *through* except the
dispatcher — and that no upstream table name appears where SQL would put one.

## What remains NOT VERIFIED

- **D-4 — critical-position enumeration.** No `criticality` filter exists on any contract Career can
  reach, and none was added. Unchanged by this checkpoint.
- **D-12 — the development mix.** `DevelopmentMixView.mixVerdict` is the literal `'NOT VERIFIED'`.
  Career records what a development item *is*; the 70-20-10 proportion it would be judged against was
  never approved as a rule, and a computed verdict would invent one.
- **Bounded talent-placement performance.** Deferred with the rest of the benchmark work; no
  workload is claimed here.

## Defects found and fixed

**Organization's in-memory position store ignored the new filter.** The predicate was added to the
contract and to the PostgreSQL repository but not to the fake, so the two disagreed and the fake was
the more permissive of them — a test using it would have passed while production refused. Found by
`organization-position-lookup.test.ts`, which failed on two of five cases; that suite is now the
regression test, and it exercises both stores.

**The cross-module suites connected as a superuser.** The test database belongs to `work`, which is
a superuser, and a superuser bypasses every row-level-security policy there is. Every tenant
assertion in the suite was therefore proving only that Career's own SQL filters on a tenant, while
reporting that row-level security held. The harness now connects as `career_cross_module` — no
superuser, no `BYPASSRLS` — and asserts that fact before asserting anything that depends on it. One
probe read a row without setting `app.tenant_id` and correctly returned nothing once the policies
were live; it now reads inside the tenant's context.

**A failed raw probe poisoned the next test.** The harness returned its client to the pool while the
transaction was still aborted, so a statement with a typo in it failed the *following* test. The
rollback moved into a `finally`.

**A row count was measured through a view that could not see drafts.** A dependency test counted
Career rows through `CareerSummaryView`, whose plan is the *active* one — but `career.create-plan`
writes a draft, so it reported zero after a successful write and the accompanying "nothing was
written" assertions passed for the wrong reason. Counting now goes through the search queries, which
return every status.

## Evidence

| Suite | Tests | What it proves |
| --- | --- | --- |
| `phase-fifteen.cross-module.spec.ts` | 4 | The mandatory scenario end to end, plus derived expiry, derived review dates, and history preserved after an upstream employment ends. |
| `phase-fifteen-dependencies.cross-module.spec.ts` | 18 | Per dependency: permitted, absent, wrong tenant, unreachable, recovered — and a malformed identifier. Unavailable and absent stay different facts. |
| `phase-fifteen-boundaries.cross-module.spec.ts` | 16 | Two tenants holding deliberately identical upstream identifiers; counts that do not leak; a client-supplied identifier that is never a credential; the source audit. |
| `phase-fifteen-concurrency.cross-module.spec.ts` | 5 | Convergence and conflict on two real connections: a retried nomination converges, two nominees both survive, a stale version is refused. |

All four run against real PostgreSQL, the real repositories, the real dispatcher and the production
adapter classes. No adapter is replaced by a fake, an auto-approving port, a recording-only notifier
or a fabricated identity resolver in any of them.

**There is no second composition path.** The harness builds the module from the same
`postgresCareerStores()` and the same `CareerEmployment` / `CareerOrganization` / `CareerLearning`
classes that `careerModuleFor` builds it from, and differs in exactly one argument: the clock is
pinned to a fixed instant, because a suite that asserted what is overdue against the real time of
day would assert something different tomorrow. The audit reads `career.composition.ts` and asserts
that the production wiring contains those constructors and none of `inMemoryCareerStores`,
`Recording`, `AutoApproving` or `Fake` — so the two cannot drift apart without a test failing.

The upstream modules answer as **stub query handlers on the same dispatcher**, which is what makes
the shapes of the contracts Career consumes part of this suite: a change to `PositionView`,
`EmploymentView` or `LearningHistoryView` breaks it. What the stubs cannot prove is that the real
handlers behave as the stubs do; that is what the end-to-end API suites are for.
