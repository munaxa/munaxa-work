# Release notes

Newest first. Each entry states what changed, what it means for somebody operating the product,
and what is still missing.

---

## Phase 3 — Organization

**2026-08-06** · [Verification report](verification/phase-3-report.md)

The enterprise's structure, and the closure of the tenant-settings limitation Phase 2 shipped
with.

### Every customer gets its own language and calendar

Before this release a deployment had one default language, one calendar, one time zone and one
invitation validity, shared by every tenant in it — so a hosting arrangement containing a Riyadh
customer and an Amman customer had to pick one of them.

Tenants now configure themselves, through `PUT /api/v1/organization/tenant-settings`. A tenant
that has configured nothing behaves exactly as it did before, falling back to the deployment's
values, so nothing changes until somebody chooses to change it.

**Operators should know:** the `DEFAULT_LOCALE`, `DEFAULT_CALENDAR`, `DEFAULT_TIME_ZONE`,
`DEFAULT_NUMERALS`, `INVITATION_VALIDITY_DAYS` and `DEFAULT_PORTALS` variables are unchanged and
still required — they are now the *fallback* for an unconfigured tenant rather than the answer
for every tenant.

### Organization

Eleven tables, thirty-three endpoints, and the structure beneath them:

- **Units of any depth.** The levels of the hierarchy — company, branch, department, or whatever
  a customer calls them — are the tenant's own data rather than a fixed ladder in the schema. A
  retail group with company / region / store defines those three and nothing else; a franchise
  nesting twelve deep simply does. The nine levels the specification names are offered as a
  starting set from `GET /organization/standard-unit-types`, and nothing installs them.
- **Reorganizations that keep their history.** Moving a department records a new period rather
  than overwriting the old one, so "which division was this under last March" keeps its answer
  forever. Every structure endpoint takes `?asOf=` and defaults it to now.
- **Legal entities, each with its country.** A tenant may operate in several countries at once,
  and an employment will resolve its statutory rules from its legal entity rather than from the
  tenant — which is what makes end of service, social insurance and wage protection correct for a
  group operating across borders. `GET /organization/units/{id}/governing-legal-entity` answers
  which one governs a unit on a date.
- **Cost and profit centres**, as reference data finance recognizes. No budgets: financial
  ownership stays with the finance system this product integrates with.
- **A position catalogue** of reusable roles, holding no people, and an **establishment** of
  budgeted headcount per position per unit, effective dated and separately approved.
- **Organizational calendars** — the working week and the dates that are exceptions to it. This
  product knows no country's holidays; they are data a tenant or a country pack loads.
- **Import and export** of a whole structure. Import applies every rule an administrator would
  meet one unit at a time, and can be re-run after a correction without duplicating anything.

### Administration screens

The admin portal gains an organization section: the org chart as at any date, the levels defined,
the legal entities and their countries, and the tenant's settings. Bilingual and bidirectional —
`?lang=ar` switches language and direction together.

**Operators should know:** the portal reads through the API, which returns 401 until Platform's
authentication adapter is supplied. Until then the screens render their empty states, which is
the expected condition rather than a fault.

### Configuration

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `WORK_API_URL` | `http://127.0.0.1:3000` | Where the portals reach the API |

---

## Phase 2 — Workforce Identity

**2026-08-05** · [Verification report](verification/phase-2-report.md)

The first business module, and the closure of the security risk Phase 1.1 named as the largest
one open.

### The tenant no longer comes from a header

Before this release the API believed an `x-tenant-id` header, which meant any caller could act as
any tenant, and every audit row recorded `user:anonymous`. Both are gone.

A request's tenant is now resolved from a **tenant membership** — a row this product wrote when a
tenant admitted a person — keyed on the principal Platform authenticated. A caller may still say
*which* of their tenants they mean, using `x-munaxa-tenant`, because people genuinely belong to
several; naming one they are not an active member of resolves to nothing, and nothing means the
request runs with no tenant and every tenant-scoped operation refuses.

**Operators should know:** the API now returns 401 to every business endpoint until Platform's
authentication adapter is supplied. This repository contains no authentication implementation and
will not acquire one. Health probes are unaffected.

### Workforce Identity

Eight aggregates, an API, and the persistence beneath them:

- **Workforce user** — one per Platform account, spanning every tenant that person belongs to.
- **Tenant membership** — admission, suspension, reinstatement, departure and rejoining.
- **Invitations** — issued, withdrawn, accepted or lapsed. They carry no token: the invited
  person signs into Platform first, and accepts as an authenticated principal whose address must
  match the one invited.
- **Portal access** — which of the employee, manager and admin applications a tenant has opened
  to a member. Business configuration, not permission.
- **Employment links** — the jobs a member holds, several at once, with exactly one marked as
  their main job. Detaching a job never removes the person.
- **Delegation** — who acts for whom, for a stated period and scope. Recorded now; Workflow
  consumes it from Phase 16.
- **Business profile** — the member's name and title in both first-class languages. A profile
  missing one is refused by the domain *and* by the database.
- **User preferences** — language, calendar, time zone and numerals, seeded from the tenant's
  defaults and changed by the member themselves.

### Configuration

New environment variables, all with defaults, all applying deployment-wide until Phase 3 can
store them per tenant:

| Variable | Default | What it sets |
| -------- | ------- | ------------ |
| `DEFAULT_NUMERALS` | `western` | Western or Arabic-Indic digits |
| `INVITATION_VALIDITY_DAYS` | `14` | How long an invitation stays open |
| `DEFAULT_PORTALS` | `employee` | Which portals open when somebody joins |

`DEFAULT_LOCALE`, `DEFAULT_CALENDAR` and `DEFAULT_TIME_ZONE` already existed and now have a
consumer.

### Migration

One forward-only migration adds eight tables, each with row-level security enabled and forced by
the same migration that creates it. It also installs `app_uuid_v7()`, so rows written by a script
or a data fix carry time-ordered identifiers like the ones the application mints.

There is no data to migrate: this is the first business module.

### Known limitations

Stated here as well as in the report, because a release note that omits them is worse than none:

- Tenant settings are deployment-wide, not per tenant. Phase 3 owns that.
- Nothing sweeps elapsed invitations or delegations yet, so an invitation past its expiry still
  reads `pending`. Behaviour is already correct — acceptance refuses it, and delegation is
  computed from its period — but the register looks stale.
- No bulk import or export. Deferred deliberately rather than half-built: a bulk path that
  bypassed the application service would bypass the invariants with it.
- The portal screens are not built. The API, contracts and translations they need are complete.
- The authenticated request path has never run outside a test, because there is no authentication
  adapter to run it with.

### Tests

379, up from 208, including tenant isolation proven per entity against a real PostgreSQL.

---

## Phases 0, 1 and 1.1 — Foundation

**2026-08-05** · [Verification report](verification/phase-1.1-report.md)

Engineering standards enforced by tooling, the pnpm/turbo workspace, the NestJS API, both
portals, the Flutter application with its Android host, the shared kernel, and tenant isolation
enforced by PostgreSQL row-level security. No business functionality.
