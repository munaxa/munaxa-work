# Phase 15 — Career: the API layer

What the Career API exposes, what it refuses, and the three defects the suites found on the way.
Written at the point the transport became real, so the record is contemporaneous with the code.

---

## The architecture followed

The one the repository already has, with nothing new invented for Career.

- **Controllers** in `packages/modules/career/src/api/`, exported from the module's index and
  declared in `apps/api/src/career/career.module.ts` — the same split every module since Phase 5 has.
- **`CareerDispatcher`**, a thin injectable wrapper over the kernel's `Dispatcher`, generic over the
  command type so a controller needs no cast. It exposes `send` and `ask` and nothing else: no store,
  no repository and no transaction is reachable from a controller.
- **`unwrapOrThrow`**, one translation from a handler failure to an HTTP status for the whole module.
  400 for a malformed request, 403 naming the permission, 404 for a record the caller may not see,
  409 for a conflict, 422 for a refused rule carrying its catalogue key.
- **The shared `ProblemDetailsFilter`** turns every exception into RFC 9457. It already mapped
  `ConcurrencyException` to 409 — the fix Phase 13 made once, centrally — so no Career-only error
  format exists and no shared infrastructure needed changing.
- **`class-validator` DTOs** with the global `ValidationPipe` running `forbidNonWhitelisted`, so an
  undeclared property is refused rather than dropped.
- **`search-filters.ts`**, Career's copy of the bounded-pagination helpers every module has.

## The surface

**12 controllers, 40 endpoints** — exactly the 27 commands and 13 queries Checkpoint 4 declared, each
routed once. Nothing was added because it would be useful.

| Controller | Prefix | Endpoints |
| --- | --- | --- |
| `CareerPathController` | `career/paths` | 6 |
| `CareerPlanController` | `career/plans` | 4 |
| `CareerPoolController` | `career/pools` | 4 |
| `CareerMembershipController` | `career/pool-memberships` | 2 |
| `CareerSuccessionController` | `career/succession-plans` | 4 |
| `CareerSuccessionLifecycleController` | `career/succession-plans` | 3 |
| `CareerSuccessorController` | `career/successors` | 2 |
| `CareerReadinessController` | `career/readiness` | 5 |
| `CareerDevelopmentController` | `career/development-plans` | 5 |
| `CareerDevelopmentItemController` | `career/development-items` | 1 |
| `CareerMobilityController` | `career/mobility-recommendations` | 3 |
| `CareerSummaryController` | `career/summary` | 1 |

**Lifecycle transitions are named sub-resources**: `/publication`, `/archive`, `/activation`,
`/closure`, `/removal`, `/confirmation`, `/withdrawal`, `/acknowledgement`, `/deactivation`,
`/decision`. Where an aggregate has a genuine multi-target move rather than a set of distinct acts —
a career plan, a development plan, a development item — it is `POST :id/status` with the target named
and the version stated, which is the shape Performance already uses. There is no generic status
`PATCH` anywhere.

`career/succession-plans` is served by two controllers, reads first and lifecycle second, which is
the arrangement Learning uses for enrolments. A composition test asserts the declaration order rather
than trusting the comment that explains it.

## Authorization

Every endpoint maps to the exact permission its handler declares. No wildcard, no fallback.

The security suite proves each collection opens to **exactly one** permission by granting a caller
*every other Career permission* and asserting a 403 — which is what catches a route wired to a
neighbouring permission, the mistake that looks right in review because whoever tests it holds both.
The four deliberate separations (`pool.manage` ↛ `pool.assign`, `successor.nominate` ↛
`successor.confirm`, `readiness.read` ↛ `readiness.record`, `mobility.recommend` ↛ `mobility.decide`)
each have a test that would fail if somebody collapsed them.

**A client-supplied identifier is never a credential.** An `employmentId` in a body or a URL names
the person a record is *about*; the acting identity comes from the request context. A caller holding
only `plan.read-team` or `plan.read-own` is refused rather than quietly upgraded, and there is no
`/me`, `/my-team` or `/summary/me` route — asserted, not merely absent.

## Civil dates

`YYYY-MM-DD`, strings end to end. No `Date` exists anywhere on the path, so the Phase 8 defect cannot
occur on it. The DTO checks the *shape* (400 at the edge) and the domain's `isCivilDate` — which
parses and compares the result back to the string it came from — checks the *calendar* (422 by name).
Nothing normalizes: `2026-02-30`, `2025-02-29` and `2026-04-31` are refused rather than rolled
forward, and `2026-02-28`, `2024-02-29` and `2026-12-31` are accepted and returned unchanged.

## Exactness — and a deviation

**Career has no decimal to lose a trailing zero from.** The checkpoint asks for an HTTP regression on
an exact textual value such as `18.50`. There is no such value in this module and no honest way to
manufacture one: ADR-0074 states Career holds no money, no rate, no percentage and nothing computed,
the migration has no `numeric`, `double precision` or `real` column, and every number a human enters
is one of three bounded ordinals — a stage's sequence (≤ 500), a successor's rank (≤ 50), a readiness
level's ordinal (≤ 100).

So the regression asserts the property that *does* apply: a sequence of `500` is sent, stored as
`smallint`, read back through the view and serialized as the integer `500` — `Number.isInteger` on
the response value, and `"sequence":500` in the raw JSON, so neither a float that prints as 500 nor a
string would pass. Beside it, a decimal where an ordinal belongs is refused at the edge, and a
response-body scan asserts no `criticality`, `potentialBand`, `nineBox`, `score` or `rating` appears
anywhere. Fabricating an `18.50` field to satisfy the letter of the requirement would have added a
column the product does not have.

## Pagination

Every collection is bounded, at the edge and again in the application. The API's `paged()` clamps
size to 200 — the kernel's own maximum, which *throws* rather than clamping, so a passed-through
`?size=99999` would be a 500 — and falls back on `NaN`, negatives, zero, decimals and empty values
rather than letting `offset NaN` reach a driver.

Career's paged contract is `{ items, total }`, established in Checkpoint 4, so the bounds are
asserted by **effect** rather than by an echoed `page`/`size`: three rows across two pages return 2
then 1 then 0 while `total` stays 3 every time — a total computed from the returned rows would tell a
client the collection shrank as they walked it.

## Concurrency

Two requests, one version, over HTTP. Both read version 1 and both move the same plan: exactly one
answers 201, the other 409 with *"The record changed since it was read"*, and the persisted version
is 2 rather than 3. Nothing is seeded — the plan was created over HTTP and the final state read back
the same way.

Beside it, the distinction that matters: the same nomination issued twice **converges**. Both answer
201, both name the same successor, exactly one reports `created: true`, and the bench has one name on
it. Two *different* nominees issued at once both survive.

## Tenant isolation

Two tenants holding deliberately identical upstream identifiers — the same employment, position and
assignment — so only the tenant can be doing the separating. Over HTTP, as a role that is neither
SUPERUSER nor BYPASSRLS, with RLS enabled and forced on all twelve tables (asserted before anything
rests on it):

- Six collections return no items **and a total of zero**.
- An exact-identifier read of a path, a succession plan or a development plan answers **404, never
  403** — a 403 would confirm the record exists.
- A readiness history and a career summary for the *same employment identifier* are empty.
- A mutation naming a foreign succession plan answers 404 and leaves it at `draft`, version 1.
- An upstream position that is real only in the other tenant is refused, while the tenant that
  genuinely has it still succeeds.

## Defects found and fixed

**An impossible civil date reached PostgreSQL as a 500.** `createPath` was the only domain
constructor in Career with no `isCivilDate` call — every other aggregate validates its dates — so
`effectiveFrom: '2026-02-30'` passed the period comparison (two strings order fine whether or not
either names a real day), reached a `date` column and came back as driver error `22P02`. Reproduced
at the HTTP level first, fixed in the domain constructor rather than at the edge, with the two new
rejection keys added to both catalogues. Both the impossible-date and the malformed-shape cases are
now regressions.

**A malformed identifier in a path segment was a 500.** `GET /career/paths/not-a-uuid` reached
`where id = $1` and PostgreSQL's `22P02` escaped as an internal error — telling a caller with a typo
to report a bug. Fixed at the edge with `ParseUUIDPipe` on every identifier parameter across all
twelve controllers; it is now a 400.

**The API suite's problem details carried no correlation identifier.** The fixture omitted the
`CorrelationMiddleware` that `app.module.ts` applies to every route. Rather than drop the assertion
to match the fixture — which would have reported the harness's shape as the product's — the real
middleware was wired in, and the assertion stands.

Four test defects were also found and corrected, none of them production issues: a readiness
assessment that named no subject, an activation attempted on an empty bench, a development item moved
from `planned` straight to `completed`, and three `supertest` requests built up front and awaited
afterwards, which races the ephemeral listener.

## An observation, not a change

`record-readiness` refuses a **deactivated** readiness level; `nominate-successor` checks only that
the level *exists*. Both cite a level as a claim about a named person, so the asymmetry looks
unintended — but it is an application rule settled in Checkpoint 4, not a transport one, and changing
it under an API checkpoint would alter behaviour three checkpoints have already verified. Recorded
here for the phase review to settle. The lifecycle suite tests the rule where it exists.

## What remains NOT VERIFIED

No endpoint implies any of these exists, and the concurrency suite asserts that the routes which
*would* imply them answer a refusal:

employee self-service · manager self-service · delegated access · principal → employment resolution ·
scheduled succession review · scheduled mobility expiry · notification delivery · evidence document
storage · document upload/download · signed URLs · 70-20-10 validation · computed readiness ·
critical-position enumeration (D-4) · nine-box and high-potential integration (D-5) · analytics.

`career.plan.read-own`, `career.plan.read-team` and `career.development.read-own` remain declared and
routed nowhere; a composition test asserts no controller mentions them.

## Evidence

| Suite | Tests | What it proves |
| --- | --- | --- |
| `career.contract.spec.ts` | 34 | Civil dates, exact integers, bounded pagination, problem details, undeclared properties, dependency refusal. |
| `career.security.spec.ts` | 19 | The RLS role, 401 with no principal, the permission matrix, the four separations, and identifiers that are not credentials. |
| `career.tenancy.spec.ts` | 5 | Two tenants with identical upstream identifiers: items, totals, exact reads, mutations. |
| `career.lifecycle.spec.ts` | 11 | Ten terminal-state rules, each surfacing the application's own named refusal. |
| `career.concurrency.spec.ts` | 13 | Optimistic concurrency, convergence, and the routes that do not exist. |
| `career.composition.spec.ts` | 4 | Controller declaration order, prefix resolution, the full command path, unrouted permissions. |

**86 API tests**, all against real PostgreSQL through the real controllers, the real global filter
and validation pipe, the real dispatcher, the real repositories and the production cross-module
adapters. There is no in-memory Career HTTP harness: the properties that matter most here are
properties of the database and the wire.
