# ADR-0036 — Tenant settings are owned by Organization and read through Identity's port

**Status** Accepted · **Date** 2026-08-06 · **Author** Phase 3 · **Approval** Pending phase approval

## Context

The Phase 2 verification report opened this item and named its owner:

> **Tenant settings are deployment-wide, not per tenant** — Every tenant in a deployment shares
> one default language, calendar, time zone and invitation validity. *Phase 3, when Organization
> can store them. The port already exists, so this is one adapter, not a redesign.*

`ConfiguredTenantSettings` resolved every tenant to the deployment's environment variables. In a
market where a Riyadh customer wants Arabic and Hijri and an Amman customer wants English and
Gregorian, a hosting arrangement containing both had to pick one — which is not a limitation
anybody sells around.

Two questions had to be answered: **which module owns the concept**, and **how does Identity read
it without Identity changing**.

## Decision

**Organization owns tenant settings.** `tenant_settings` is one row per tenant holding the
language, calendar, time zone, numerals, invitation validity and default portals, with the
`TenantSettings` aggregate enforcing the rules and `PUT /api/v1/organization/tenant-settings`
exposing it.

The reason is ownership, not convenience: these are properties of *the customer's organization*,
not of anybody's identity. Identity consumes them, as Attendance, Leave and Payroll will.

**Organization implements Identity's existing port.** `StoredTenantSettings` implements
`TenantSettingsPort`, exported from `@work/identity`'s public contracts. The composition root
substitutes it for `ConfiguredTenantSettings`, and **no identity use case changed** — which is the
evidence the port was drawn in the right place in Phase 2.

Three details are deliberate:

- **A missing row falls back to the deployment's validated configuration.** A tenant created five
  minutes ago has no settings, and refusing to invite anybody into it until an administrator had
  visited a settings screen would be a worse product. An unconfigured tenant behaves exactly as it
  did in Phase 2; configuring it is what changes that.
- **`GET /tenant-settings` returns nothing rather than the fallback.** The query answers *what has
  this tenant configured*, so a tenant that has never been configured stays distinguishable from
  one configured identically by hand.
- **The adapter reads on its own pooled connection, outside the request's tenant context.**
  Identity resolves a tenant's settings while establishing that tenant, and on the invitation path
  asks about a tenant the caller may not yet be acting in — so the Unit of Work cannot serve it.

## Consequences

- The Phase 2 debt is closed. Two tenants in one deployment and one database resolve different
  languages, calendars, time zones, numerals, validity periods and portal sets — asserted at the
  application layer and again through the real adapter against PostgreSQL.
- `@work/organization` depends on `@work/identity`, in the direction later phase → earlier phase,
  through published contracts only. That is what a contracts boundary is for; the alternative — a
  parallel interface here and a translator in the composition root between two identical shapes —
  is a seam existing only to avoid admitting the dependency.
- `PORTAL_KEYS` is now exported from Identity's contracts as a value, so a consumer narrowing an
  untyped string to a `PortalKey` uses Identity's own list rather than a second copy.
- The environment variables Phase 2 added remain, reframed from *the answer for every tenant* to
  *the fallback for a tenant that has not configured itself*.

**The exposure, stated rather than left implicit.** The adapter's query is the one read in this
module that crosses the request's tenant scope. It is narrow by construction: its only input is a
tenant identifier the caller cannot choose — it comes from a membership or an invitation the
product itself wrote — and it returns configuration (a language, a calendar, a time zone) that is
not personal data and discloses nothing about anybody. Every *other* read of `tenant_settings`,
including the administration query, goes through the repository and row-level security; a
cross-tenant read there is refused, and there is a test for it.

**Alternative considered.** *Identity owns tenant settings.* Rejected on ownership: Identity owns
the business identity of a person, and a tenant's calendar is not that. It would also have put a
settings table in the module that had no administration surface for it.
