# Munaxa Work on the shared AWS stack

Work's hosting target is the shared AWS stack in `munaxa-platform/infra/aws` (draft, not applied),
replacing the Render blueprint in `munaxa-identity/deploy/render.yaml`.

| What                   | How                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Images                 | `.github/workflows/publish-images-ecr.yml` on a tag `image/<sha>`: `munaxa-work/api`, `/migrate`, `/admin` |
| Release job            | The `migrate` target of `apps/api/Dockerfile`: `prisma migrate deploy` as `work_owner`, then `runtime-grants.sql` |
| Runtime role           | `work_app`, `NOBYPASSRLS`, data access only (`runtime-grants.sql`); created by the stack's db-admin task |
| Host                   | `work.munaxa.com`: `/api/auth/*` to Identity, `/api/v1/*` to the API, the rest to the admin (one origin, Identity ADR-0004) |
| Admin → API            | `WORK_API_URL=http://work-api.<env>.munaxa.internal:3000` (private)                                   |
| Licensing              | `LICENSING_MODE=CONTROL_PLANE`, `CONTROL_PLANE_URL=https://control-api.munaxa.com`, `CONTROL_PLANE_TOKEN` from the bundle |
| Identity               | `PLATFORM_AUTH_ISSUER=https://id.munaxa.com` (character for character), `PLATFORM_AUTH_AUDIENCE=munaxa-work`, `PLATFORM_AUTH_PUBLIC_KEYS`; every request's session is checked at `${PLATFORM_AUTH_ISSUER}/api/auth/introspect` over the existing 443 egress (ADR-0080), so Identity must be deployed with that route first |
| Secrets (bundle)       | `DATABASE_URL`, `PII_MATCH_SECRET`, `CONTROL_PLANE_TOKEN`; the owner URL is in a separate migrate bundle |

Verified locally on PostgreSQL 16 (29 Oct 2026): the migrate image applies all 34 migrations to an
empty database as a non-superuser owner and is idempotent; the runtime image then boots with the
stack's environment on a read-only root filesystem with no capabilities, reports
"connected as work_app, which cannot bypass row-level security", and answers 401 without a token.

## The first tenant on a fresh database

A migrated database has no tenant, so every authenticated request answers 401 ("No tenant
resolved") until one exists. `scripts/bootstrap-tenant.mjs` writes the Work side: a workforce user
for an existing Identity account and an active membership. The runtime image cannot run it (the
root `pg` dependency is pruned), but the migrate image can: it carries the build stage's full
install and `scripts/`. Run the `work-migrate` task definition with a command override, after the
migrate job and before anyone signs in. On Testing, run it through the platform's E-1 task guard
(`scripts/aws/connector/e1-task-guard.py`, family `munaxa-nonprod-work-migrate`), not a bare
`aws ecs run-task`.

Rehearse first with `--dry-run`, then run the same command without it. The command runs as an
argv, with no shell; the script reads the owner URL from `DATABASE_MIGRATION_URL`, which the task
already holds:

```sh
node ../../scripts/bootstrap-tenant.mjs \
  --platform-user-id <Identity user id, the token sub> \
  --platform-tenant-id <Identity organisation id, the token tid> \
  --confirm-organisation=<the same organisation id, after checking it in Identity> \
  --issuer <PLATFORM_AUTH_ISSUER, exactly> --allow-production [--dry-run]
```

The guard (MW-005) refuses before connecting when:

- `--issuer` is missing, or is not character for character the `PLATFORM_AUTH_ISSUER` of the
  environment it runs in. That variable must be set in the task; the stack sets it on
  `work-migrate` (munaxa-platform `ops.tf`). An issuer that is not `https` is refused in production.
- `--platform-tenant-id` is not an Identity organisation id (a lowercase UUID; a slug or `root` is
  refused), or `--confirm-organisation` is missing or differs from it.
- an option is unknown, repeated or has no value (a misspelt `--dry-run` never writes).

**Known gap:** the script cannot check that the organisation exists in Identity. Identity exposes no
credential-free lookup; its one product-facing route, `GET /api/auth/introspect`, needs a live
access token of an account in the organisation. So the operator checks the id in Identity
(the `identity_tenant` row the operator bootstrap created) and types it twice.

Then every read, check, write and the resolution proof run in one transaction. It commits only if
all of them pass. A refusal at any point leaves the database unchanged, including a rebind of a
bound tenant to another organisation or issuer, or an organisation already bound elsewhere.
`--dry-run` runs the same transaction and always rolls it back. It prints the planned writes.

The organisation id binds the new Work tenant to that Identity organisation (ADR-0080): only tokens
issued for it can act in the tenant, and its grants can act in no other tenant. One organisation
binds to one Work tenant, and a binding is never changed by the script.

It connects as `work_owner`, which is `NOBYPASSRLS`, and every Work table has `FORCE ROW LEVEL
SECURITY`, so the owner is held to the same policies as `work_app`. It is idempotent: a second
run reports the existing membership and writes nothing. Then:

1. **Control**: link the printed tenant id to a customer as the `work` product's `tenantRef`
   (operator portal), and give it a subscription. With `LICENSING_MODE=CONTROL_PLANE`, an unlinked
   tenant has no entitlements.
2. **Identity**: assign the account a role carrying the `work:*` permissions it needs
   (`artifacts/work-permissions.json` in munaxa-identity). The script grants no permission; a member
   without grants answers 403.

Verified locally on PostgreSQL 16 (30 Oct 2026): with the roles created by munaxa-platform's
`db-bootstrap.sh`, the 34 migrations and `runtime-grants.sql` applied as `work_owner`, the script
run as `work_owner` created the tenant; `work_app` then resolved it through `app_memberships_of`
and read zero `tenant_membership` rows with no tenant in context.
