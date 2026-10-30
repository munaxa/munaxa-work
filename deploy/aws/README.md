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
