# ADR-0080 — A token's grants apply only in the tenant bound to its organisation, and its session is checked with Identity

**Status** Accepted
**Date** 2026-11-12
**Author** Munaxa Work engineering
**Approval** Independent security review (munaxa-platform agent report 2026-11-12-work-tenant-authorization-and-revocation)
**Refines** [ADR-0032](0032-tenant-resolution-from-membership.md) and [ADR-0076](0076-cross-product-authorization-contract.md)
**Relates to** [ADR-0077](0077-membership-resolution-role.md), munaxa-identity `GET /api/auth/introspect`

## Context

Two findings of the 11 Nov 2026 deployment-readiness audit (WK-01, WK-02), both re-verified on
`main` at `d3ba53b` before this change:

- **WK-01, grants crossed tenants.** Identity computes a token's `perms` from the roles the account
  holds in the organisation named by `tid`. Work ignored `tid` (ADR-0032 deliberately did not
  declare it) and chose the tenant from the caller's memberships, narrowed by `x-munaxa-tenant`.
  Nothing tied a Work tenant to an organisation. A person with active memberships in two Work
  tenants therefore carried one organisation's grants into both: an organisation-A payroll
  administrator who was an ordinary member of tenant B was a payroll administrator in B. Proved live
  in the audit.
- **WK-02, revoked sessions kept working.** Work verified the JWT signature and expiry and nothing
  else. Logout, revoking a session, revoking the others, a password reset or change, an MFA removal
  and an account lockdown are all state Identity holds; Work never asked, so a signed-out token was
  honoured until it expired, about 15.5 minutes.

## Decision

1. **Binding.** `tenant_platform_binding` records, for each Work tenant, the one Platform
   organisation `(platform_issuer, platform_tenant_id)` it belongs to. It is unique in both
   directions — one organisation per tenant, and **one tenant per organisation**, which is the
   property WK-01 needs. It has forced row-level security like every table, the runtime role may
   read but not write it (`deploy/aws/runtime-grants.sql`), and `scripts/bootstrap-tenant.mjs`
   writes it (`--platform-tenant-id`, required) and refuses to re-bind.
2. **Bound resolution.** Requests resolve memberships with
   `app_bound_memberships_of(sub, issuer, tid)`, a security-definer function owned by the NOLOGIN
   `work_membership_resolver` (as ADR-0077), which returns only memberships of the tenant bound to
   the token's organisation. The predicate is in SQL so a second caller cannot forget it.
3. **`tid` is a filter, never a selector.** The adapter now reads `tid`, but a Work tenant still
   comes only from a stored membership (ADR-0032 stands); `tid` only removes ineligible ones. A
   token without `tid`, `sid` or `exp` is not a principal. An organisation bound to no tenant
   resolves nobody. The header still only selects among eligible memberships.
4. **Session check.** After local verification, `IdentitySessionStatus` asks Identity's
   `GET /api/auth/introspect` (Bearer), which decides with Identity's own `resolvePrincipal`. It
   requires `active: true` with the token's own `sub`, `tid` and `sid`. A positive answer is reused
   for at most `PLATFORM_AUTH_REVOCATION_CACHE_MS` (default 5000, maximum 30000), measured from when
   it was asked and never past `exp`; a negative answer is kept until the token expires and is never
   replaced; concurrent checks of one token share one call. Every failure — timeout
   (`PLATFORM_AUTH_INTROSPECTION_TIMEOUT_MS`, default 2000), network, any non-200, a malformed body,
   an answer about another subject, organisation or session — refuses the request and is not cached.
5. **Configuration.** The URL defaults to `${PLATFORM_AUTH_ISSUER}/api/auth/introspect` (the issuer
   is Identity's base URL), override `PLATFORM_AUTH_INTROSPECTION_URL`. Production requires `https`.
   `PLATFORM_AUTH_REVOCATION_CHECK=disabled` skips the check for a laptop without Identity and is
   refused at startup when `NODE_ENV=production`.
6. **Caches.** Authenticated API responses carry `Cache-Control: no-store` and
   `Vary: Authorization, X-Munaxa-Tenant`.
7. **Assurance.** The principal carries `platformTenantId`, `sessionId`, `authenticationMethods`
   (`amr`) and `mfaSatisfied` (`mfa`). Nothing in Work requires MFA yet.

## The exact guarantees

- **Tenant.** With a token issued for organisation O, a request can act only in the Work tenant
  bound to O, and only if the subject holds an active membership there. The token's grants are
  therefore exercised only in the organisation they were computed in.
- **Revocation.** Once Identity has committed a revocation of a session (by any route) at time R, no
  Work API instance accepts a request carrying an access token of that session that it receives
  after **R + `PLATFORM_AUTH_REVOCATION_CACHE_MS`** (5 s by default). Each instance asks Identity
  independently, so this needs no coordination and holds across any number of instances. The bound
  is measured on each Work instance's own clock from when it sent the question, so it does not
  depend on clock agreement between services.
- **Availability.** If Identity cannot answer, Work refuses (401) rather than guess.

## Consequences

- An existing Work tenant has no binding until bootstrap is run for it again with
  `--platform-tenant-id`; until then nobody can act in it. Work has never been deployed to AWS, so
  no live tenant is affected.
- Every authenticated Work request now depends on Identity being reachable. Identity's edge applies
  `api-per-ip` (300 per minute) to the introspection route, keyed by the Work task's address; with a
  5 s cache that is roughly 25 continuously active users per Work task before Work's requests are
  throttled and refused. This is ample for non-production. Production needs either a higher Identity
  limit for authenticated product callers or a longer cache, and is tracked as a production
  readiness item.
- A person who genuinely works for two organisations needs an Identity account in each (Identity
  accounts belong to one organisation), and uses the token of the organisation they are acting for.
- The "15 minutes" note in ADR-0076's consequences is superseded by the revocation guarantee above.

## Alternatives considered

- **Identity issues per-Work-tenant grants.** Would put Work's tenancy into Identity; rejected for
  ownership.
- **One membership per person.** Hides the defect rather than fixing it; rejected.
- **A shared Redis denylist.** Work has no Redis client and Identity's Valkey is per task in the AWS
  stack, so it is not shared; it would add a service. Rejected.
- **Work reads Identity's database.** Duplicates Identity's responsibility; rejected.
- **A shorter access-token lifetime only.** Changes every product and still leaves the lifetime as
  the window; rejected as the sole control.
