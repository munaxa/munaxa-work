# ADR-0030 — Tenant isolation: shared schema, `tenant_id`, and row-level security

**Status** Accepted
**Date** 2026-08-05
**Author** Munaxa Work engineering
**Approval** Pending review

## Decision

Munaxa Work runs a **shared schema**. Every business table carries `tenant_id`, and
**PostgreSQL row-level security** enforces the boundary in the database, underneath the
application.

Three mechanisms, deliberately layered:

1. **The column.** Every model carries `tenant_id`, enforced by `scripts/check-architecture.mjs`
   from the first model written.
2. **The policy.** Every business table has RLS enabled and forced, with a policy comparing
   `tenant_id` to `current_setting('app.tenant_id')`. The application connects as a role that
   is *not* the table owner and does *not* have `BYPASSRLS`.
3. **The context.** The application sets `app.tenant_id` for the duration of each transaction,
   from the authenticated request's tenant, and repositories additionally filter by tenant so
   the intent is visible in the query.

A deployment that requires a dedicated database — some government and enterprise buyers do —
gets one by pointing its connection string at a separate database. No business code changes,
because nothing above the connection knows which arrangement it is in.

## Reason

"No cross-tenant data leakage" is the single rule in `00_MASTER_INSTRUCTIONS.md` whose breach
cannot be walked back. Every other defect can be fixed and re-run; a customer seeing another
customer's payroll is a disclosure that has already happened.

Application-level filtering alone makes that outcome one missing `where` clause away, in any
one of hundreds of queries written over years by people who were not present for this decision.
A reviewer must catch every omission; RLS must be defeated deliberately. Those are not
comparable risk profiles, and the cost of RLS — a session variable per transaction — is trivial
against them.

The layering is not redundancy for its own sake. The column makes the data model correct, the
policy makes the database refuse, and the repository filter keeps the intent legible in the
query and the plan. If any one of the three is wrong, the other two still hold.

## Consequences

- The migration that creates a business table also enables and forces RLS and creates its
  policy. A table without a policy is a table without isolation, so this is a gate rather than a
  convention, and `scripts/check-architecture.mjs` will enforce it once models exist.
- The application role must not own the tables and must not hold `BYPASSRLS`. Migrations run as
  a separate, privileged role. `FORCE ROW LEVEL SECURITY` closes the case where the application
  role is also the owner.
- Every unit of work sets `app.tenant_id` transactionally with `set_config(..., true)`, so the
  setting cannot leak across pooled connections — the failure mode that would make RLS *worse*
  than no RLS.
- Background jobs, migrations and integrations carry an explicit tenant context. Work that is
  genuinely cross-tenant — a platform-wide report, a maintenance job — runs under a distinct
  role and states so in code.
- Tenant isolation tests are mandatory per entity: the same query, run under the wrong tenant,
  must return nothing.

## Alternatives considered

- **Schema per tenant.** Rejected: strong isolation, but migrations become O(tenants), the
  connection pool fragments, and cross-tenant platform queries turn into unions over thousands
  of schemas. It also does not remove the need for a tenant column in shared reference data.
- **Database per tenant, always.** Rejected as the default for the same reasons, at greater
  operational cost. Retained as a deployment option for buyers who require it, which the shared
  schema does not preclude.
- **Application filtering only.** Rejected: it is exactly one forgotten predicate from a
  disclosure, and no amount of review reliably prevents that across a product this size.
- **A Prisma middleware that injects the filter.** Kept as a convenience, not as the control. It
  runs inside the process it is meant to protect, and raw SQL — which payroll and reporting will
  need — bypasses it entirely.
