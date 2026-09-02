# ADR-0077 — Membership resolution runs as a role that cannot log in

**Status** Accepted
**Date** 2026-09-01
**Author** Munaxa Work engineering
**Approval** Pending review
**Refines** [ADR-0033](0033-tenant-less-workforce-user.md), which made `app_memberships_of` the one
cross-tenant read
**Relates to** [ADR-0030](0030-tenant-isolation.md), which requires `force row level security`

## Context

ADR-0033 made `app_memberships_of` `security definer` so that the request pipeline could answer
"which tenants may this person act in?" before any tenant is in context. It rejected the
alternative explicitly:

> The alternative was a second connection holding `BYPASSRLS`, which would open a general hole to
> solve one specific problem and would then be available to every query written afterwards by
> somebody not present for this decision.

`security definer` was not sufficient, and the way it failed is worse than an error.

ADR-0030 requires `force row level security`, and **FORCE applies row-level security to the table
owner as well**. The function therefore ran as a role that was still subject to `tenant_isolation`,
with no tenant in context: `app_current_tenant()` was null, the policy matched nothing, and the
function returned **zero rows**. Tenant resolution then found no membership, and every
authenticated request answered 401 — with nothing in any log to say why, because from the
application's point of view the person genuinely was a member of nothing.

Reproduced from a clean database at `e17a4b9`, with the role model a staging deployment has:

| Migration role | `app_memberships_of('alice')` |
| --- | --- |
| not superuser, no `BYPASSRLS` | **0 rows** |
| the same, with `BYPASSRLS` granted | 1 row |

CI never sees this: its migrations run as the superuser `work`, whom FORCE does not apply to. So
the defect was invisible in every gate and would have surfaced only in staging, as a total
authentication outage with a misleading symptom.

The obvious remedy — grant `BYPASSRLS` to the migration role — is precisely what ADR-0033 rejected,
moved to a different role. It would make that role able to read every row of every table in the
schema, forever, to satisfy one function's need to read two.

## Decision

`app_memberships_of` is owned by **`work_membership_resolver`**, a role whose entire purpose is to
own that function, and whose reach is granted by policy rather than by privilege.

```text
role   work_membership_resolver   NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
owns   app_memberships_of(varchar)   — and nothing else
holds  select on tenant_membership, workforce_user   — and nothing else
policy membership_resolution  for select  to work_membership_resolver  using (true)
         on tenant_membership
         on workforce_user
```

Four properties make this narrow, and each is one of the ways the alternative was wide:

1. **It cannot be connected as.** `NOLOGIN` means no credential exists and none can be made to
   exist without a deliberate `ALTER ROLE`. The only way to exercise this reach is to call the
   function, whose body is fixed and whose single argument is a Platform identifier.
2. **The reach is table-scoped, not role-scoped.** `BYPASSRLS` is an attribute that applies to
   every table. A policy names two. Adding a third would be a migration somebody reviews.
3. **It is visible where security is inspected.** `pg_policies` shows exactly which role may read
   what. A role attribute shows only that a role may read everything.
4. **The migration role does not inherit it.** Ownership transfer needs `SET ROLE`, so the
   migration is granted membership `with inherit false, set true`. Without `inherit false` the
   migration role would silently acquire unrestricted read on both tables — which was observed
   while developing this, and is the trap the explicit clause exists to avoid.

No role in the deployment holds `BYPASSRLS`. `force row level security` stays on every protected
table. `work_app` is unchanged, is not a member of the resolver, and remains unable to bypass
isolation.

## Options considered

| Option | Why not |
| --- | --- |
| **A. `BYPASSRLS` on the function owner** | Works, and is what ADR-0033 rejected. The owner is the migration role, which owns every table: the grant would let it read every row of all 186, permanently, to serve one function reading two. It is also invisible in the schema — nothing in a migration diff shows it. |
| **B. A policy naming the table owner** | No new role and no `CREATEROLE`, but the migration role can already `ALTER POLICY`, so the added reach is small — except in one case that matters: an application misconfigured to connect *as the owner* is caught today by FORCE, and this would uncover every membership to it. |
| **C. A policy naming a dedicated `NOLOGIN` role** | **Chosen.** See above. |
| **D. Move resolution out of the database** | The query would run as `work_app`, which is subject to the same policies, so it would need its own bypass — strictly worse. A second connection with elevated rights is option A with more moving parts. |
| **E. Relax the predicate, e.g. permit reads when no tenant is set** | Fails open catastrophically: `work_app` could read every membership in the cluster simply by not setting a tenant. |
| **F. Drop FORCE on the two tables** | Forbidden by ADR-0030, and it would exempt the owner from `tenant_isolation` everywhere those tables are read, not only inside the function. |

## Consequences

- **The migration role needs `CREATEROLE`.** Stated rather than assumed: the migration creates
  `work_membership_resolver` if it is absent. This is a smaller and more auditable ask than
  `BYPASSRLS`, and it is a property of the *migration* role, never of the application's.
- **Roles are cluster-wide.** A second Work database in the same cluster reuses the role. If it was
  created by a different migration role, the new one holds no `ADMIN` option on it and the
  migration stops with a message naming the exact grant required, rather than failing obscurely.
- **The migration role can no longer `GRANT` on the function.** It does not own it any more.
  Nothing needed that grant: `EXECUTE` is `PUBLIC` by default and stays so, which is what
  ADR-0033 already relied on.
- **`db:bootstrap` verifies this rather than assuming it.** It resolves the membership it just
  created through `app_memberships_of` and fails with this ADR's name if it cannot, so a
  misconfigured deployment is caught at provisioning time instead of appearing later as a 401.
- **CI's blind spot is now covered by a test that does not share it.**
  `membership-resolution.integration.test.ts` connects as a non-superuser application role and
  asserts the whole matrix, so the condition that hid this defect cannot hide it again.

## Security invariants, and the evidence for each

Every one is asserted in `packages/testing/src/membership-resolution.integration.test.ts`, against
a real PostgreSQL, as roles that are not superusers.

| Invariant | Evidence |
| --- | --- |
| A person resolves to their own active memberships, and only those | resolves tenant A for a member of A; both for a member of A and B |
| A suspended person resolves to nothing | asserted |
| A suspended membership resolves to nothing | asserted |
| Somebody no tenant admitted resolves to nothing | asserted |
| One person cannot discover another's membership | every returned row carries the identity asked for |
| No tenant can be supplied to the function | its signature takes `p_platform_user_id` and nothing else |
| The resolver holds no privilege attribute | `rolsuper`, `rolbypassrls`, `rolcreaterole`, `rolcreatedb`, `rolcanlogin`, `rolreplication` all false |
| Its reach is exactly `select` on two tables | `information_schema.table_privileges` |
| That reach comes from a policy naming it | `pg_policies` shows both policies `to work_membership_resolver` |
| The application role is not a member of it | `pg_has_role` is false |
| The application role cannot bypass isolation | `app_isolation_diagnostics()` reports false/false |
| Every protected table still forces RLS | no table has RLS enabled without FORCE |
| Cross-tenant reads stay refused | acting as A, tenant B's memberships count zero; with no tenant, zero |
| A workforce user stays unreachable from a tenant that never admitted them | asserted |
