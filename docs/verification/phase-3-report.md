# Phase 3 — Organization

**Date** 2026-08-06 · **Verdict** Pass, with the limitations stated below

The enterprise's structure, and the closure of the tenant-settings debt Phase 2 assigned to this
phase.

Every claim here is evidenced by a command that was run. Where something could not be verified in
this environment it says so rather than being marked pass.

---

## 1. The tenant-settings debt, closed

The Phase 2 report opened it and named the owner:

> **Tenant settings are deployment-wide, not per tenant** — Every tenant in a deployment shares
> one default language, calendar, time zone and invitation validity. *Phase 3, when Organization
> can store them. The port already exists, so this is one adapter, not a redesign.*

It was the first thing built.

### What changed

| | Before | Now |
| --- | --- | --- |
| Source of a tenant's defaults | The deployment's environment variables | A `tenant_settings` row, per tenant |
| Two tenants in one deployment | One language, one calendar, for both | Each its own |
| An unconfigured tenant | The deployment's values | The deployment's values — unchanged |
| Identity's use cases | Ask `TenantSettingsPort` | Ask `TenantSettingsPort` — **unchanged** |
| Administration | None | `GET` / `PUT /api/v1/organization/tenant-settings` |

Recorded as [ADR-0036](../adr/0036-tenant-settings-owned-by-organization.md).

### Proven with two tenants, not one

A suite with a single tenant in it would pass just as happily for the implementation this
replaces, so both proofs put **two tenants in one store**.

At the application layer, through the real pipeline
(`organization-settings.test.ts`), and again through the adapter Workforce Identity actually
calls, against a real PostgreSQL (`organization-persistence.integration.test.ts`):

```
a tenant configuring its own defaults
  ✓ gives a second tenant its own, in the same deployment and the same store
  ✓ reads nothing at all for a tenant that has configured nothing
  ✓ replaces the whole set on a second submission, which is what a settings screen sends
  ✓ refuses a stale write rather than overwriting somebody else's change

a tenant reading its own settings through Identity's port
  ✓ gives each tenant its own defaults from one deployment and one database
  ✓ falls back to the deployment's configuration for a tenant configured with nothing
  ✓ keeps a portal the tenant chose that the deployment default does not list
  ✓ drops a portal this product does not ship rather than handing it to a portal switch
```

Tenant A resolves `ar` / `hijri` / `Asia/Riyadh` / arabic-indic / 14 days; tenant B resolves `en`
/ `gregorian` / `Asia/Amman` / western / 30 days. Cross-tenant reads of the table are refused by
row-level security, with a test.

**Identity's use cases did not change.** The diff to `packages/modules/identity/src/application`
is empty; the only change to the module is one additive export (`PORTAL_KEYS`, so a consumer
narrows a string against Identity's own list rather than a second copy). That is the evidence the
port was drawn in the right place in Phase 2.

**A bug this caught.** The first version of the adapter intersected the tenant's chosen portals
with the deployment's defaults, so a tenant opening the manager portal while the deployment
defaulted to `employee` would have got nothing. The test named above is the one that failed.

---

## 2. What the module implements

Nine aggregates and eleven tables. The two decisions worth challenging are these:

### There is no table per level (ADR-0034)

The specification names nine organizational entities and draws them as a ladder. AD-003 requires
unlimited depth. **Nine tables is nine levels**, so the levels are tenant data: a
`organization_unit_type` row each, with every node an `organization_unit`.

The nine ship as `STANDARD_UNIT_TYPES`, served from `GET /organization/standard-unit-types`.
Nothing installs them.

Asserted rather than argued (`organization-depth.test.ts`):

```
a structure of arbitrary depth
  ✓ nests as deep as the tenant needs, with no level count anywhere      (12 levels, one type)
  ✓ lets a tenant use only the levels it has, without inventing the ones it does not
```

The first builds twelve levels of a single repeated type — which a fixed ladder cannot express at
all. The second is a retail group of company / region / store, none of whose levels the
specification names.

### The country is on the legal entity (ADR-0035)

00B: *an employment resolves its country pack from its legal entity, not from the tenant, and a
tenant may operate in multiple countries at once.* Phase 11.1 is built on this.

The test builds **one tenant with a Saudi company and a Jordanian one**, each with a team three
levels down (`organization-country.test.ts`):

```
the country an employment would be governed by
  ✓ comes from the nearest legal entity above the unit, not from the tenant
  ✓ reports the chain it walked, so the answer can be checked rather than trusted
  ✓ is the unit's own registration when the unit carries one
  ✓ follows the structure, so a unit moved between countries changes the law it answers to
  ✓ answers nothing rather than defaulting, when no registration governs the unit
  ✓ stops answering for dates after a registration is closed
  ✓ refuses a registration on a level the tenant says does not carry one
  ✓ refuses a second registration on the same unit
```

The fifth is the one that matters most. A tenant-level fallback would compute somebody's end of
service under a country nobody chose and produce a number that looks entirely right. There is no
fallback: the answer is *nothing*.

The country is also not amendable — the domain has no parameter for it and the repository does
not assign it. An entity that changed country is a different registration under a different law.

### The aggregates

| Aggregate | Owns | Notable invariant |
| --------- | ---- | ----------------- |
| `OrganizationUnitType` | One level of this tenant's hierarchy | Which types may parent it; empty means any (ADR-0034) |
| `OrganizationUnit` | A node, of any level | A name in **both** first-class languages, or it is refused |
| `UnitPlacement` | Where a unit sat, and from when | Exactly one period in force on any date, enforced by the kernel's `Timeline` |
| `LegalEntity` | A registration and its country | One per unit; the country cannot be changed (ADR-0035) |
| `FinancialCenter` | A cost or profit centre | Reference data — no budget, no actuals (AD-007) |
| `Position` | A reusable role | No occupant field, ever (AD-006) |
| `Establishment` | Budgeted headcount per position per unit | Approved records who approved it and when |
| `OrganizationCalendar` | A working week and its exception days | At least one working day; no default week anywhere |
| `TenantSettings` | One tenant's own defaults | One row per tenant |

---

## 3. Effective dating, which Phase 2 did not exercise

The kernel's `Timeline` is used rather than reimplemented. A move closes the period a unit had and
opens a new one; nothing is edited and nothing is deleted.

```
a reorganization
  ✓ keeps the old answer and gains a new one, rather than rewriting history
  ✓ leaves exactly one answer at the instant of the move itself
  ✓ records both periods, so the history itself is readable and not merely implied
  ✓ supersedes the period in force at a back-dated move, not merely the open one
  ✓ is a no-op when a unit is placed exactly where it already is, so an import can be re-run
  ✓ refuses a move that would put a unit beneath itself
  ✓ refuses a unit as its own parent before the handler even runs
  ✓ refuses a placement the tenant's own level rules forbid
  ✓ reports a unit that exists but sits nowhere, rather than dropping it from the chart
  ✓ omits a unit that had not yet come into existence on the date asked about
```

**Two real bugs the tests found**, both worth recording:

*A back-dated move failed outright.* Correcting the record for March on a unit that had also
moved in June refused with `placement_already_closed`: the code closed "the open period" when the
period *in force at the effective date* was an already-closed one. The fix is that a bounded
period may be **shortened but never extended**, and the new period is bounded by the next one
rather than running through it — so a correction splits the history instead of discarding a move
somebody recorded. The kernel's own `Timeline.change` drops later entries, which is right for a
salary and wrong for a structure; this is why the module supersedes explicitly rather than
delegating.

*`pagedResult` was called with its arguments transposed* — `(items, total, page, size)` instead of
`(items, page, pageSize, total)`. Four numbers, and the compiler cannot tell them apart. It
surfaced as a 500 on an empty list in the tenant-isolation test.

The database keeps at most one *open* placement per unit with a partial unique index, verified by
constraint name against a real PostgreSQL.

**What is not effective dated: a rename.** A unit renamed is the same unit in the same place, so a
rename raises an event carrying the old name rather than opening a period. The consequence is
stated in the debt register rather than implied.

---

## 4. Verification

### Repository and architecture

```
Engineering Standards: no violations.
Architecture: 18 model(s) checked, no violations.
Localization: 3 catalogue set(s) complete.
Dependencies: 261 source file(s), no cycles, no unused dependencies, no unreachable files.
```

Module-first per ADR-0023: `packages/modules/organization/{domain,application,infrastructure,
contracts,api}`. The layer rules applied without configuration and caught real violations during
the phase — the domain and application layers import no framework, no ORM and no transport.

**Three architectural findings the gates caught, not the author:**

- A **circular import** between the API's identity and organization modules. Organization's
  composition is registered by identity's, and organization's Nest module imports identity's for
  the dispatcher. Fixed by splitting `organization.composition.ts` from `organization.module.ts`.
- A **second cycle** between the import handler and its passes, over shared types. Fixed with
  `import-contract.ts`, which imports neither.
- **Nine file-budget breaches**, each split rather than waived.

The kernel was *not* modified. An early draft added a `permissionFor` hook to `CommandHandler` so
one handler could guard cost and profit centres with different permissions; the protocol forbids
modifying completed architecture, so the module has four handlers built from two factories
instead — one implementation, each kind separately guarded.

### Persistence

Eleven tables applied to a fresh database, then inspected:

```
            table            | rls | forced | policies
-----------------------------+-----+--------+----------
 financial_center            | t   | t      |        1
 job_position                | t   | t      |        1
 legal_entity                | t   | t      |        1
 organization_calendar       | t   | t      |        1
 organization_calendar_day   | t   | t      |        1
 organization_unit           | t   | t      |        1
 organization_unit_placement | t   | t      |        1
 organization_unit_type      | t   | t      |        1
 position_establishment      | t   | t      |        1
 tenant_settings             | t   | t      |        1
```

Every one carries `tenant_id`, the audit columns, `deleted_at` / `deleted_by`, `version` and a
UUIDv7 identifier. There is no tenant-less table in this module — `workforce_user` remains the
only one in the product (ADR-0033).

Constraints the database enforces rather than the application, each with a test:

```
✓ refuses a unit whose name is missing a first-class language
✓ refuses two open placement periods for one unit
✓ refuses a placement period that ends before it begins
✓ refuses the same unit code twice in a tenant, case-insensitively
✓ permits the same code in a different tenant, because codes are the customer's own
✓ refuses a legal entity whose country code is not a country code
✓ refuses a second registration on one unit
✓ refuses an approved establishment with nobody named as the approver
✓ keeps one fact per calendar date, replacing rather than duplicating
✓ refuses a stale write, so two administrators cannot silently overwrite each other
```

### Tenant isolation, per entity

Against a real PostgreSQL, as an unprivileged role that cannot bypass row-level security:

```
another tenant's unit type and unit, by exact identifier      → not found ✓
placement, legal entity, centre, position, establishment,     → not found ✓
  calendar, calendar day, by exact identifier
every placement in the tenant (what a structure query loads)  → empty ✓
every unit in the tenant                                      → empty ✓
insert into another tenant                                    → policy violation ✓
no tenant set                                                 → 0 rows (fails closed) ✓
another tenant's settings                                     → not found ✓
```

The placement assertion is the one that would matter most if it were wrong: the ancestor walk
reads every placement in the tenant, so a policy missing that table would hand another customer's
entire structure to a single query.

### Tests

**531 tests**, up from 379.

| Suite | Tests |
| ----- | ----- |
| `@work/identity` | 151 (unchanged) |
| `@work/kernel` | 139 (unchanged) |
| `@work/organization` | **136** (13 files) |
| `@work/api` | 46 (was 30) |
| `@work/testing` | 23 |
| `@work/persistence` | 20 |
| `@work/config` | 16 |

Covering the matrix `00A_PHASE_SPECIFICATION_TEMPLATE.md` requires: domain invariants and state
machines; every command and query through the real pipeline; repositories including tenant
scoping; every endpoint including authorization failures; permissions granted and denied; tenant
isolation per entity; effective dating and history; concurrency; and localization.

The module's own tests run with **Arabic names on every entity** and a Riyadh working week
(Sunday–Thursday) supplied as data. Testing in English against a Monday–Friday week would let a
hardcoded default pass every test in the suite and fail on the first customer.

The integration suites refuse to skip in CI and run serially against one database, matching the
convention Phase 2 established.

### Quality gates

| Gate | Result |
| ---- | ------ |
| Standards, architecture, localization, dependencies | Pass |
| Format, lint, typecheck | Pass |
| Tests (531) | Pass |
| Production build (13 packages) | Pass |
| Migration validation | Pass — applied to a fresh database |
| Prisma schema validation | Pass |
| Flutter analyze, test, APK build | **Not verifiable here** — no Flutter toolchain on this machine. Unchanged by this phase |

`pnpm verify` passes end to end.

### API

**33 organization paths** published in OpenAPI, all under `/api/v1`, verified against the running
application:

```
$ curl -s http://127.0.0.1:3997/api/v1/organization/hierarchy
401  application/problem+json
{"type":"about:blank","title":"Unauthorized","status":401,
 "detail":"Not authenticated.","instance":"/api/v1/organization/hierarchy",
 "requestId":"4b62a591-…","correlationId":"4b62a591-…"}
```

Refused before anything else, as every business endpoint is until Platform's adapter lands.

The application also refused to start at all when pointed at the database as a superuser:

```
Failed to start: IsolationNotEnforcedError: Refusing to start: the database role "work" can
bypass row-level security because it is a superuser. Tenant isolation would not be enforced.
```

That is Phase 1's guard doing its job, and it is worth recording that it fired for real.

### Administration UI

The admin portal gains `/organization`, rendered server-side and verified running:

```
$ curl -s "http://127.0.0.1:3996/organization"          → dir="ltr"  "Structure"  "Units"  "Levels"
$ curl -s "http://127.0.0.1:3996/organization?lang=ar"  → dir="rtl"  "الهيكل التنظيمي"  "الوحدات"  "المستويات"
```

Language and direction switch together — direction follows language and is never a separate
control, which is how the two drift apart. The org chart is a nested `<ul>` with logical
properties (`ps-*`, `border-s`), so it indents from the right in Arabic without a coordinate being
recomputed, announces as a hierarchy to a screen reader, and reflows on a phone.

The screens read through the API, which returns 401 today, so they render their empty states.
That is the expected condition rather than a fault, and the same code shows real data the moment
Platform's adapter is supplied.

### Performance

Measured on this machine against a real database seeded with **2,000 units, 20 levels deep** —
far larger than any real organization chart:

| Operation | Median | Worst of 10 | Budget |
| --------- | ------ | ----------- | ------ |
| Read every placement (what a structure query loads) | 11.9 ms | 29.2 ms | — |
| Read every unit | 22.6 ms | 26.3 ms | — |
| Search units by **Arabic** name | 4.9 ms | 7.9 ms | < 500 ms |
| Placements in force on a date | 12.1 ms | 24.4 ms | — |
| Legal entities for an ancestor chain | 1.5 ms | 2.5 ms | — |

The hierarchy walk is in the application layer over one read of the tenant's placements, rather
than a recursive CTE, because an ancestor chain is a *rule* and a rule in a repository is a rule
that cannot be tested without a database. The cost of that choice is the 12 ms above, and it is
the honest number rather than an argument.

The **authenticated request path remains unmeasured**, for the same reason as in Phase 2: it
requires Platform's authentication adapter. Carried in the debt register.

### Localization

Both catalogues complete, checked by gate. Every rejection the domain can produce carries a
catalogue key rather than a sentence, so an Arabic-speaking administrator reads a refusal in
Arabic.

Organization names are **`LocalizedText`, not catalogue keys** — "Riyadh Operations" is the
customer's word, not a string this product ships. Both languages are required by the domain *and*
by the database (`check (name ? 'en' and name ? 'ar')`) on units, unit types, legal entities,
centres, positions, calendars and calendar days.

Nothing in this module knows a country, a currency, a holiday or a weekend. `country_code` and
`currency_code` are validated by shape and never against a list; the working week is tenant data
with no default anywhere; holidays are rows a tenant or a country pack loads.

### Security

| Check | Result |
| ----- | ------ |
| Authentication | Platform's, through a port. This repository authenticates nobody |
| Authorization | 21 permissions, declared by every handler, checked centrally, refused by default |
| Separation of duties | Reading the chart ≠ reorganizing; proposing a budget ≠ approving it; cost centres ≠ profit centres |
| Tenant validation | RLS-enforced and proven per entity |
| Order of checks | Authorization before validation, in the pipeline and at the transport |
| PII | **None.** This module holds structure. No name of a person appears in any table |
| Problem Details | Every error path; no stack trace, SQL or environment detail |
| Audit | Actor written by infrastructure from the context; a caller cannot supply or omit it |

The approver on an establishment is taken from the authenticated context, never from the command:
a caller who could name their own approver could approve their own budget as somebody else.

A caller holding only the cost-centre permission cannot reach a profit centre by identifier — the
handler re-checks the kind and answers *not found* rather than *forbidden*, since the caller has
no business knowing that identifier names anything.

**The known residual from Phase 2 is unchanged and re-asserted here:** an *authenticated member of
the tenant* who lacks a specific permission and sends a malformed body still gets 400 rather than
403, because Nest runs the global `ValidationPipe` before the CQRS pipeline's permission check.
An unauthenticated caller gets 401 regardless. Both are covered by test.

---

## 5. Technical debt

The Phase 2 register, carried forward and updated. Nothing has been quietly dropped.

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| ~~Tenant settings are deployment-wide~~ | ~~Every tenant shares one language and calendar~~ | **Closed in Phase 3** — ADR-0036 |
| No projection store | Queries read the transactional tables | Phase 20, or the first module needing a read model. Measured above at 2,000 units; reporting is what needs projections |
| The rule engine has no arithmetic | It decides, it does not compute | Phase 11.1 |
| `@work/contracts`, `@work/sdk`, `@work/country-packs` are empty | Placeholders | The phases that own them. Organization publishes its contracts from its own package, per ADR-0023 |
| Cache health is `not-configured` | Redis declared, unused | Whenever the first cache consumer arrives |
| No rate limiting | An unauthenticated endpoint could be hammered | Before production exposure, Phase 24 at the latest |
| The Android release build signs with debug keys | A release artefact is not distributable | Phase 19.1 |
| The authenticated request path is unmeasured | The < 300 ms budget is argued structurally for that path | When Platform's authentication adapter lands |
| No scheduled sweep for invitation and delegation expiry | An elapsed invitation still reads `pending` | Phase 24 (background jobs). The *behaviour* is already correct |
| Portal screens for Workforce Identity are not built | The admin portal does not render the member register | Phase 18/19 |

New in this phase:

| Item | Impact | When it must be addressed |
| ---- | ------ | ------------------------- |
| **A unit's *attributes* are not queryable as at a past date** | A structure query for last March shows *today's* names on *that date's* structure. The structure itself is fully historical; the names are not | Phase 21 (governance, risk, compliance), which owns temporal audit generally. The rename event carries the old name, so the history is reconstructible from the event log today — it is simply not a query. Deliberately not built: an effective-dated revision per attribute doubles the write path for every rename, and a rename is a correction rather than a reorganization |
| **Bulk import is not atomic** | A file with one bad row leaves everything before it written | Phase 24, when a background job can own the whole operation. Mitigated rather than ignored: the import is *resumable* — an existing code is reused and an unchanged placement is a no-op — so a corrected file can simply be run again, and there is a test for exactly that. Making it atomic today would require writing rows directly, bypassing every invariant it exists to enforce |
| **Import and export are synchronous and bounded** | Beyond `IMPORT_LIMIT` (2,000 rows) the command refuses | Phase 24 (background jobs). The bound is enforced and named in the refusal rather than discovered at a timeout |
| **The admin portal's document shell is still `lang="en" dir="ltr"`** | The organization *section* mirrors correctly (`<main dir="rtl">`), but the `<html>` element carries the Phase 0 placeholder, so page-level chrome such as scrollbar side does not mirror | Phase 18/19, which own the portal shell and locale resolution. Stated rather than smoothed over: the screens themselves are correct in both directions and verified so |
| **The establishment's `filled` count is always zero** | Vacancy figures equal budgeted figures | Phase 5, which owns employment assignments. This is arithmetic on an empty set rather than a placeholder — there genuinely are no assignments — and the projection is tested against a stubbed count so the arithmetic is proven for when a real one arrives |
| **No administration screens for writes** | The organization screens read; every mutation goes through the API | Phase 18/19, which own the portals. The API, contracts, permissions and localization they need are complete |

---

## 6. Risks

1. **Platform's authentication adapter still does not exist.** The API serves 401 to every
   business endpoint, including all 33 added here. That is the correct failure direction, and it
   also means the authenticated path has never run outside a test.
2. **`STANDARD_UNIT_TYPES` is a judgement call that customers will disagree with.** The parent
   rules in it are suggestions inside a suggestion — a tenant that adopts the set may then edit
   it — but the first customer to adopt it unedited and hit a shape it forbids will experience it
   as a product opinion. It is offered rather than installed for exactly this reason.
3. **The hierarchy walk loads a tenant's whole placement history per structure query.** Measured
   at 12 ms for 2,000 units and 20 levels. It is linear in tenant size, and the answer if it ever
   matters is the Phase 20 projection store rather than a rule pushed into SQL.

---

## 7. Recommendations

1. **Wire Platform's authentication adapter.** It was Phase 2's first recommendation and it is
   now blocking two measurements and every screen in two portals.
2. **Do not add a `depth` or `level` column, ever.** It is the natural thing to reach for the
   first time somebody wants to indent a report, and it reintroduces the fixed ladder ADR-0034
   exists to remove. Depth is computed from placements.
3. **Read a unit's country through `organization.governing-legal-entity`, never from a join.**
   The walk is effective-dated and stops at closed registrations; a join to `legal_entity` on the
   unit misses both, and the number it produces will look right.

---

## 8. Production readiness

**Ready for the next phase to build on. Not ready for production exposure**, for the same single
reason as Phase 2: there is no authentication implementation. Everything else the
production-readiness criteria ask for is in place — invariants in the domain, transactional writes
with events after commit, optimistic concurrency on every mutable aggregate, tenant isolation
proven per entity, Problem Details throughout, structured logs, OpenAPI current, ER diagram
current in the module document, ADRs written for every decision, and the limitations above stated
rather than omitted.

**Rollback path.** The phase is additive: eleven new tables, one new package, one new portal
route, and one substituted provider. Rolling back means reverting the commit and dropping the
tables — no existing data is migrated or reshaped, and no Phase 2 table is altered. The one
behavioural change to an existing path is `ConfiguredTenantSettings` → `StoredTenantSettings`,
and reverting it returns every tenant to the deployment's defaults, which is where they were
before this phase. No data is lost by that: the `tenant_settings` rows survive and are re-read if
the change is re-applied.

---

## 9. Acceptance criteria

✓ Company, legal entity, business unit, branch, division, department, section, team — as
configurable levels rather than a fixed ladder (AD-003, ADR-0034)
✓ Unlimited depth, proven at twelve levels with no level count in schema, domain or contracts
✓ Multiple companies, and multiple countries in one tenant
✓ Legal entity carrying the country every later statutory calculation resolves from (00B, ADR-0035)
✓ Historical reorganizations preserved; "what did this look like on this date" has exactly one answer
✓ Effective dating on the kernel's `Timeline`, not reimplemented
✓ Cost centres and profit centres as reference data, with no financial ownership (AD-007)
✓ Position catalogue holding no people (AD-006), with an effective-dated establishment
✓ Organization calendars, with no holiday or working week known to this product
✓ Organization metadata, search, import, export
✓ REST API — 33 paths, all in OpenAPI, all guarded
✓ Administration UI, bilingual and bidirectional
✓ Audit, soft delete, effective dating, optimistic concurrency and metadata on every entity (AD-005)
✓ Every table tenant-first, audited, versioned, soft-deleted, UUIDv7, snake_case (AD-004)
✓ Row-level security on every new table, applied by the migration that creates it (ADR-0030)
✓ No people, employment, attendance, leave, payroll, recruitment, performance or workflow
✓ No employee assignments and no reporting hierarchy (AD-001, AD-002)
✓ Arabic and English complete; both directions verified against the running portal
✓ 531 tests including tenant isolation per entity, permissions, effective dating, concurrency and localization
✓ Production build passing, `pnpm verify` green
✓ Documentation, module guide, ADRs and the debt register updated
✓ The tenant-settings debt struck off the register

**Phase 3 passes.** Awaiting approval before Phase 4.
