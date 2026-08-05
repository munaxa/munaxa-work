# ADR-0032 — The tenant comes from a stored membership, never from the request

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review
**Closes** the technical-debt entry "the tenant arrives as an HTTP header" in
[`verification/phase-1.1-report.md`](../verification/phase-1.1-report.md)

## Decision

An API request's tenant is resolved from a **tenant membership** — a row Munaxa Work wrote when
a tenant admitted a person — keyed on the **authenticated Platform principal**. It is never
taken from the request.

Concretely, in this order, and none of the steps is optional:

1. **Platform authenticates.** The presented credentials go to `PlatformAuthenticationPort`,
   which Platform implements. Munaxa Work verifies nothing, parses no token and holds no key
   material. No principal, no context.
2. **The directory answers which tenants that principal may act in.** `TenantMembershipDirectory`
   returns the *active* memberships of an *active* workforce user, and identifiers only.
3. **The caller may select among those, and may do nothing else.** An `x-munaxa-tenant` header
   narrows a set already computed from stored facts. Naming a tenant the person is not an active
   member of resolves to nothing. Naming none when there are several resolves to nothing.
4. **Unresolved means no context at all.** Not a default tenant, not the first membership:
   nothing. `currentTenantId()` then throws and row-level security returns no rows, so the
   request fails closed on both layers.

The audit actor becomes `user:<workforceUserId>`, replacing the `user:anonymous` placeholder.

`AuthenticatedTenantGuard` refuses any route that reached a handler without a context, so an
unauthenticated request is a 401 rather than an internal error, and — because Nest runs guards
before pipes — it is refused before its payload is validated.

## Reason

Phase 1.1 recorded this as the single largest open risk: the API believed an `x-tenant-id`
header, so any caller could act as any tenant. It had to close before any business data existed,
and it had to close in a way that could not be reopened by the next person to add an endpoint.

The distinction the design turns on is between a **claim** and a **fact**. A header is a claim
the caller makes about themselves, and a claim a caller makes about themselves is worth nothing.
A membership is a fact this product stored when a tenant admitted that person. Every later
control — row-level security, the permission checks, the audit trail — is downstream of getting
that one right, and none of them can compensate for getting it wrong.

The header survives as a *selector* because people genuinely belong to several tenants (AD-005)
and something has to choose. What matters is that it can no longer grant: at most it narrows a
set. There is deliberately no default when several match, because picking the first would work
for most people most of the time and put a consultant's work in the wrong customer's tenant the
one time it mattered.

## Consequences

- **The API serves nothing until Platform's adapter is wired in.** The only authentication
  implementation this repository contains is `UnauthenticatedPort`, which authenticates nobody.
  A deployment that forgets to supply Platform's adapter returns 401 to every request — noticed
  on the first call, unlike the alternative default, which is noticed by an auditor.
- **Every request costs one indexed lookup** on `tenant_membership (workforce_user_id, status)`,
  before anything else it does.
- **Business routes are guarded by default.** `@PublicRoute()` is the exemption and health is
  its only current use. Forgetting the decorator leaves an endpoint guarded rather than open.
- **A regression here fails loudly.** `tenant.middleware.spec.ts` asserts that a principal who
  is a member of tenant A only, asking for tenant B, resolves *nothing*. Reintroducing header
  trust makes that test fail with the forged tenant identifier in the message. This was verified
  by mutation: the check was removed, the suite was run, and the test failed as intended.

## Alternatives considered

- **Keep the header, add a check later.** Rejected: it is the same design with a hope attached,
  and it leaves the failure mode as "somebody forgets" rather than "the system refuses".
- **Put the tenant in the path (`/api/v1/tenants/:tenantId/...`).** Rejected as the mechanism,
  though not as a future convenience: a path segment is still a caller-supplied claim and would
  need exactly the same membership check behind it, while doubling the surface of every route.
- **One session per tenant, chosen at sign-in.** Rejected: session management belongs to
  Platform (AD-001), and it would make a person who works across two tenants sign in twice.
- **Derive the tenant from the Platform token's claims.** Rejected: it would make Platform the
  owner of a fact this product owns — who is a member of which tenant — and every membership
  change would then require Platform to reissue a token.
