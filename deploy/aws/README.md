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
| Identity               | `PLATFORM_AUTH_ISSUER=https://id.munaxa.com` (character for character), `PLATFORM_AUTH_AUDIENCE=munaxa-work`, `PLATFORM_AUTH_PUBLIC_KEYS` |
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
install and `scripts/`. Run the `work-migrate` task definition once, by hand, with a command
override, after the migrate job and before anyone signs in:

```sh
sh -c 'DATABASE_URL="$DATABASE_MIGRATION_URL" exec node ../../scripts/bootstrap-tenant.mjs \
  --platform-user-id <Identity user id, the token sub> --allow-production'
```

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
