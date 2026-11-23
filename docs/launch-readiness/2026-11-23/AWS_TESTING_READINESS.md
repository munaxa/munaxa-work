# AWS Testing readiness for Munaxa Work

Baselines: `munaxa-work` `61c115b`, `munaxa-platform` `9a3725e` (Apply 2 applied and verified,
report `2026-11-23-docs-testing-apply1`). Read-only AWS checks on 23 Nov 2026 about 20:10 UTC through
the AWS connector on the `MunaxaReadOnly` permission set. Nothing was created, changed, published,
applied or started.

## Verdict

**Work cannot join a Testing session yet.** Identity, Control and Docs being prepared does not carry
Work with it: Work has no usable image, no stack inputs, no secret values, no database, no test roles
and no Work-specific smoke test.

## Current state (verified)

| Item                                    | State                                                                                                                         | Source                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| ECR `munaxa-work/api`, `/migrate`, `/admin` | one image each, tags `b490b25` and `sha-b490b25…`, pushed 8 Nov; **withdrawn** (CVE-2026-4738) and refused by `withdrawn-images.tf` | `ecr:DescribeImages`; `munaxa-platform/infra/aws/stack/withdrawn-images.tf:20-25` |
| A publishable image from `main`         | **None.** CI "Images" job failed on `61c115b` (OpenSSL 3.5.9-r1, 10 HIGH findings)                                             | CI run 44901535832                                   |
| D-SSL Testing exception                 | Identity, Control, Docs only; "does not cover Work or School"                                                                  | report `2026-11-22-testing-temporary-openssl-acceptance` |
| `images.work_api/work_migrate/work_admin` in `nonprod.tfvars` | not set                                                                                                    | `infra/aws/stack/envs/nonprod.tfvars:69-79`          |
| Secret `munaxa-nonprod/work-api`        | exists, **0 versions** (no value)                                                                                              | `secretsmanager:DescribeSecret` (metadata only)       |
| Secret `munaxa-nonprod/work-migrate`    | exists, **0 versions**                                                                                                         | same                                                 |
| `secret_version_ids` for Work           | none                                                                                                                           | `nonprod.tfvars:127-135`                             |
| `db_bootstrap_products`                 | `["identity", "control"]`, no `work`                                                                                           | `nonprod.tfvars:104`                                 |
| ECS task definition families `munaxa-nonprod-work*` | none                                                                                                               | `ecs:ListTaskDefinitionFamilies`                     |
| ECS services in `munaxa-nonprod`        | none (nothing running)                                                                                                         | `ecs:ListServices`                                   |
| RDS `munaxa-nonprod-pg`                 | stopped                                                                                                                        | `rds:DescribeDBInstances`                            |
| `desired_counts` work-api, work-admin   | 0                                                                                                                              | `nonprod.tfvars:43-54`                               |
| Host                                    | `work.test.munaxa.com` declared; certificate covers `*.test.munaxa.com`                                                        | `nonprod.tfvars:18-26`                               |
| Stack wiring for Work                   | present: `module.work_api` and `module.work_admin`, ALB rules (`/api/auth/*` Identity, `/api/v1/*` API, rest admin), Cloud Map name, `LICENSING_MODE=CONTROL_PLANE`, `OPENAPI_ENABLED=false`, ES256 Identity keys | `infra/aws/stack/services.tf:553-640` |
| Owner secret script                     | `scripts/aws/owner/work-testing-secrets.sh` exists (sha `183e5723…`)                                                           | platform report `2026-11-21-testing-owner-preparation` |
| Identity roles for Work                 | `work-staging-operator`, `work-staging-recruiter` only                                                                         | `munaxa-identity/apps/api/scripts/seed-work-roles.mjs:63,75` |
| Control: Work deployment and credential | not created (Control has not run a session yet)                                                                                | platform README G7 step 4                            |

## Requirement by requirement

| Requirement                        | Ready? | What is missing                                                                                                                                   | Backlog |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| API image                          | ❌     | A `main` commit whose Images job passes, or an owner decision to cover Work under D-SSL                                                            | MW-001  |
| Migration image                    | ❌     | same release as the API image                                                                                                                      | MW-001  |
| Admin image                        | ❌     | same; admin has `readonly_root_filesystem = false` (Next.js cache) by design                                                                       | MW-001  |
| Immutable digests                  | ⚠️     | workflow publishes by digest and refuses `latest`; it does not require CI green for the SHA                                                       | MW-009  |
| ECR publishing workflow            | ✅     | `publish-images-ecr.yml`, `image-release` environment, OIDC publisher role, verify and scan before push                                            |         |
| Terraform configuration            | ⚠️     | modules exist; Work inputs absent                                                                                                                  | MW-002  |
| ECS task definitions               | ❌     | created only when images and secret pins are set and applied (services off)                                                                        | MW-002  |
| Database bootstrap                 | ❌     | add `work` to `db_bootstrap_products`, write the `work-migrate` bundle first (owner URL), run db-admin                                            | MW-002  |
| Migration execution                | ⚠️     | `work-migrate` by `aws ecs run-task` (not under the E-1 guard); must exit 0                                                                       | MW-005  |
| Secret bundles                     | ❌     | owner runs `work-testing-secrets.sh bundles` (`DATABASE_MIGRATION_URL`, `DATABASE_URL`, `PII_MATCH_SECRET`, `CONTROL_PLANE_TOKEN` or placeholder)   | MW-002  |
| Identity dependency                | ✅     | Identity image with introspection route (identity#15) is the pinned `0b94951`; `IDENTITY_AUTH_AUDIENCE` includes `munaxa-work`                    |         |
| Control licensing dependency       | ❌     | Control session, Work deployment and credential in the operator portal, `CONTROL_PLANE_TOKEN` written, then a new `work-api` secret pin and apply | MW-002, MW-005 |
| Tenant bootstrap                   | ⚠️     | `bootstrap-tenant.mjs` via a `work-migrate` command override with the Identity `sub`, organisation id and exact issuer; binding is permanent        | MW-005  |
| Work role seeding                  | ❌     | roles that let testers do HR work; assignment per test account; Identity restart                                                                   | MW-003  |
| DNS                                | ⚠️     | CNAME `work.test.munaxa.com` to the ALB at the first Work session (owner, Cloudflare, DNS only)                                                   |         |
| Health checks                      | ✅     | API `/health/ready` (database); admin `/`; container HEALTHCHECK hard-codes port 3000 (MW-054); `/health` reports cache "up" without Redis (MW-050) |         |
| Smoke tests                        | ❌     | only "sign in on work.\*" in the platform runbook                                                                                                  | MW-006  |
| Shutdown                           | ✅     | session `down`, 21:00 UTC backstop and session cleanup cover all services generically                                                              |         |

## Ordered path to a first Work Testing session

Each owner step is an approval gate under the platform's existing rules.

1. **Owner decision D-SSL-W:** extend the Testing-only OpenSSL exception to Work's api, migrate and
   admin images with the same expiry (1 Dec 2026), **or** wait for Alpine `3.5.10-r0` and merge work#35.
   Recommendation: wait if 3.5.10 lands within a few days, because Work cannot run before steps 2 to 9
   are done anyway.
2. Repository (Wave 1, no owner action): smoke script, synthetic data loader, Identity test roles, drift
   gate, CI-green check in the publish workflow, runbook for steps 6 to 9.
3. **Owner:** release tag `image/<sha>` for a green `main` commit; Claude verifies runs, digests and ECR
   scans.
4. **Owner:** `work-testing-secrets.sh bundles` in CloudShell (placeholder Control token is allowed).
5. PR: Work digests, `secret_version_ids.work-api` and `.work-migrate`, `db_bootstrap_products += work`,
   expected changes; **owner** approves plan and apply with services off.
6. Session `up` with Identity, Control and Work; db-admin; `work-migrate` (exit 0).
7. Identity: `seed-work-roles.mjs` for the test organisation (new persona roles), `bootstrap-account
--role …` per test account, restart Identity.
8. Work: `bootstrap-tenant.mjs` through a `work-migrate` command override with the operator's `sub`,
   the organisation id and the exact issuer.
9. Control: Work deployment, credential written as `CONTROL_PLANE_TOKEN` (new `work-api` secret version,
   pin PR and apply with services off, next session), tenant id linked as `tenantRef` with a
   subscription. Until then every Work request answers "Entitlements could not be confirmed".
10. Smoke (MW-006), synthetic data load, tester session, `down`.

Steps 6 to 9 need two applies because the Control credential exists only after Control has run.
Starting Work with the placeholder token first and completing licensing in a second session is the
cheapest order.

## Cost

Adding `work-api` and `work-admin` (0.25 vCPU and 0.5 GB each in `services.tf`, admin default size) adds
roughly US$0.03 an hour to a session at the platform README's Fargate prices, plus two public IPv4
addresses (US$0.01 an hour). No new always-on resource is needed: Work uses no Redis, S3 or SMTP today.
