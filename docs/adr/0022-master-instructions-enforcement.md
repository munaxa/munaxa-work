# ADR-0022 — Master instructions enforcement

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review

## Decision

The permanent architectural rules are recorded in `docs/MASTER_INSTRUCTIONS.md` and enforced
by tooling, on the same principle as ADR-0021. Three rules that ADR-0021 left to review are
now machine-checked:

- **Module independence.** Repositories and `@prisma/client` are importable only from the
  infrastructure layer. Every other layer reaches a module through its application services,
  public contracts or domain events. Presentation applications may import neither business
  layers nor persistence — they consume the SDK and the contracts.
- **Deployment agnosticism.** Cloud and infrastructure SDKs (AWS, GCP, Azure, Redis, Kafka,
  queues, mail) are confined to the infrastructure layer. Business code depends on ports.
- **Externalized configuration.** `process.env` is readable only inside the configuration
  package. Elsewhere it is a lint error.

Two registries become part of the repository and are updated by the phase that changes them:
`docs/DOMAIN_OWNERSHIP.md` (one concept, one owner) and `docs/PHASES.md` (the implementation
ledger, since phases run strictly in order).

`scripts/check-architecture.mjs` checks the Prisma schema against the rules that outlive every
phase: PostgreSQL, `tenant_id` on every model, UUID identifiers, the audit columns, soft
delete, `version` for optimistic concurrency and `snake_case` mapping. A genuinely global
model opts out with a `/// @global <reason>` doc comment.

## Reason

Tenant isolation, module independence and deployment agnosticism are the three rules whose
violation is cheapest to commit and most expensive to undo. A missing `tenant_id` is a
cross-tenant data leak that no later test discovers cheaply; a repository imported across a
module boundary is a coupling that a migration to microservices then cannot unpick.

The schema gate exists before `prisma/schema.prisma` does, and no-ops until the file appears.
Writing it now means the first model is checked by the commit that introduces it, rather than
by the commit that later remembers to turn the check on — and a model is far cheaper to fix
before its migration ships than after.

The `/// @global` opt-out is a doc comment rather than a list in the checker because the
justification then lives next to the model it justifies, and it appears in the schema diff a
reviewer is already reading.

## Consequences

- The environment is read in exactly one package. Every other package receives typed
  configuration by injection, which is also what makes the app deployment agnostic.
- Adding a persistence-backed module means adding its port to the application layer; there is
  no shortcut through a direct repository import.
- A new concept must claim ownership in `docs/DOMAIN_OWNERSHIP.md` in the same change, and a
  concept already owned cannot be silently re-owned.
- The `no-restricted-imports` groups are composed per file group and de-duplicated, because
  flat config merges by rule name: the last matching config object replaces the earlier one
  rather than adding to it, and a duplicated pattern makes the whole config fail to load.

## Alternatives considered

- **Enforcing tenancy in Prisma middleware only.** Rejected as the sole control: middleware
  scopes queries but cannot make a column exist. The two are complementary, and the column is
  the part that must be right before the first migration ships.
- **A tenant-exempt allowlist inside the checker.** Rejected: the justification would live far
  from the model, and the checker would need editing to add a lookup table.
- **Waiting for Phase 1 to add the schema gate.** Rejected: the rule applies to the first
  model, so the check must precede it.
- **A dependency-cruiser configuration for module boundaries.** Rejected for the same reason
  as `eslint-plugin-boundaries` in ADR-0021 — another dependency and another configuration
  language for what `no-restricted-imports` already expresses.
