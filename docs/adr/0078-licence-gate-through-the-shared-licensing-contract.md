# ADR-0078 — Licences cap requests through the shared licensing contract

**Status** Accepted
**Date** 2026-10-26
**Author** Munaxa Work engineering
**Approval** Pending review
**Relates to** [ADR-0076](0076-cross-product-authorization-contract.md) (a licence is never a grant),
munaxa-platform ADR-0022 (`@munaxa/licensing`)

## Context

Munaxa Group sells School, Work and Docs through one control plane, and some customers run Munaxa
on their own servers without internet access. Work had no subscription or licensing concept at all.
The platform now publishes one contract every product evaluates against — one lifecycle, one
evaluation, one signed licence format (`mxl1`) — so "what does an expired licence permit" has the
same answer in every product.

## Decision

1. **`LICENSING_MODE`**, read through `@work/config` like every other variable. `NONE` (default) is
   the deployment as it has always been: nothing gated. `LICENSE_FILE` reads a signed licence from
   disk and verifies it offline with public keys only; a private key in `LICENSE_PUBLIC_KEYS`, or a
   missing input, refuses startup.
2. **One global `EntitlementGuard`, after `AuthenticatedTenantGuard`.** Reads need `READ`, everything
   else `WRITE`, so an expired licence is read-only on every route including future ones. The tenant
   it asks about is the resolved one, never a client value. Public routes are never licensed.
3. **A licence is a ceiling, never a grant** (ADR-0076): a permitted request still faces the
   permission check and tenant isolation.
4. **`402`**, not `403`. A missing, forged, foreign-installation or other-tenant licence grants
   nothing — not even reads — because there is no subscription to degrade from.

## Consequences

- Blocked on publishing `@munaxa/licensing@0.1.0`; until then `pnpm install --frozen-lockfile` fails.
- Not yet built, because each needs a product decision on what Work sells: per-module feature gates
  (a decorator in `@work/kernel` that module controllers can carry) and a headcount limit enforced
  in Employment. The contract already evaluates both; Work has to name its features and limits.
- The latest observed instant is kept per process only, so clock rollback is detected while the API
  runs and, across a restart, only against the licence's issue time.
- Hosted Work does not consult the central subscription service yet; it does not exist.

## Alternatives considered

- **Gate per use case** — every handler remembering is every handler that can forget.
- **Fall back to `NONE` when the licence cannot be read** — a deleted file would be an unlimited
  licence. Refused.
