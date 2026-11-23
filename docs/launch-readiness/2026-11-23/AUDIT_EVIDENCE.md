# Audit evidence

Session date: 23 November 2026, about 19:30 to 21:30 UTC. Cloud session container; local PostgreSQL 16
cluster created for this audit only. No secret value was read; no personal data is recorded here.

## 1. Repository state

| Repository        | Branch checked out | Commit                                   | Working tree                |
| ----------------- | ------------------ | ---------------------------------------- | --------------------------- |
| `munaxa-work`     | `main` equivalent  | `61c115b77a284c2c1fa6181a9c8791c6edcf8508` (#34, 21 Nov) | clean before the report files |
| `munaxa-platform` | `main` equivalent  | `9a3725e` (#164, 23 Nov)                 | clean (read only)           |
| `munaxa-identity` | `main` equivalent  | `0b94951` (#26, 22 Nov)                  | clean (read only)           |

`git fetch origin main` confirmed `HEAD == origin/main` for `munaxa-work` (210 commits). Open
`munaxa-work` PRs: #35 draft "build(images): OpenSSL 3.5.10-r0 (D-SSL)" (CI failure by design), #32
draft "ci(security): read @munaxa packages with the per-run token" (CI failure, waits for a Packages
grant). Branch `main` is protected.

## 2. Commands run (in order, abbreviated)

```text
git log --oneline / git status / git fetch origin main                  (munaxa-work)
GitHub: list_pull_requests, actions list_workflow_runs, list_workflow_jobs 44901535832,
        get_job_logs 136838287541 (Images), 136838287488 (Lint · Typecheck · Test · Build)
pnpm install --frozen-lockfile                                          → ERR_PNPM_FETCH_401 @munaxa/platform 1.6.1
node scripts/check-standards.mjs | check-architecture.mjs | check-localization.mjs
     | check-dependencies.mjs | check-platform-parity.mjs
pg_ctlcluster 16 main start; create role work (local superuser); create database work
for d in prisma/migrations/*/: psql -v ON_ERROR_STOP=1 -f $d/migration.sql   → 35 applied
psql catalogue queries: tables, relrowsecurity, relforcerowsecurity, pg_policies, pg_roles,
     SECURITY DEFINER functions, audit columns, FK delete actions, tenant_id-leading indexes, triggers
RLS probe (synthetic rows, role rls_probe NOBYPASSRLS), then rows deleted and role dropped
npm i prisma@6.19.0 (scratch directory); prisma validate; prisma migrate diff --from-url --to-schema-datamodel --exit-code
grep / sed / find over apps, packages, prisma, scripts, deploy, docs, work prompts (selected below)
Python comparison of permission names: packages/modules/*/src/**/*-permissions.ts vs munaxa-identity artifacts/work-permissions.json
AWS connector (MunaxaReadOnly): sts GetCallerIdentity; ecr DescribeImages x3; secretsmanager DescribeSecret x2 (metadata);
     ecs ListTaskDefinitionFamilies, ListServices; rds DescribeDBInstances
```

## 3. Outputs that support findings

### Standards gates (this session)

```text
Engineering Standards: no violations.
Architecture: 188 model(s) checked, no violations.
Localization: 20 catalogue set(s) complete.
Dependencies: 2082 source file(s), no cycles, no unused dependencies, no unreachable files.
check-platform-parity: "What is installed here is not what CI installs …" (not meaningful without the registry install)
```

### Database (this session)

```text
applied=35
tables in public: 188; relrowsecurity: 188; relforcerowsecurity: 188
tables without tenant_id: workforce_user
tables without any policy: (none)
policy shapes: (tenant_id = app_current_tenant()) x187; true x3 (membership_resolution, role work_membership_resolver);
               workforce_user tenant_reachability (EXISTS membership in current tenant) WITH CHECK true
SECURITY DEFINER: app_memberships_of, app_bound_memberships_of (owner work_membership_resolver)
tables without created_by/recorded_by/decided_by/actor: 0
foreign keys: 255, confdeltype 'a' (NO ACTION) for all
tables with tenant_id but no tenant_id-leading index: 0
user triggers: 29
no table named "tenant"
```

RLS probe (synthetic tenants `…000a` and `…000b`, role `rls_probe NOBYPASSRLS`):

```text
no-context count = 0
tenant-a count = 1 (language en)
UPDATE of tenant b's row inside tenant a's context: UPDATE 0
INSERT for tenant b inside tenant a's context: ERROR new row violates row-level security policy for table "tenant_settings"
```

### Prisma (this session)

```text
prisma validate: The schema at prisma/schema.prisma is valid
prisma migrate diff: exit 2; 184 "[*] Changed the … table" entries;
  255 "Removed foreign key", 93 "Added index", 128 "default changed", 17 "Removed index"/table add-remove lines
```

### Permission catalogue (this session)

```text
Work declared permissions: 285; Identity artifact: 285
in identity not work: []   in work not identity: []
-own permissions declared: 15; enforced by a handler: onboarding.task.complete-own, workflow.approval.read-own
```

### CI (GitHub, verified)

Run 44901535832 (`main`, `61c115b`, 21 Nov 11:57 to 12:08 UTC): Mobile success; Lint · Typecheck · Test
· Build success (format, lint, typecheck, migrations, test, build, production output, Prisma validate,
dependency audit); Product isolation success; Standards success; **Images failure** at "Scan the images":

```text
work-admin: High libcrypto3@3.5.9-r1 CVE-2026-107493 / -107494 / -121482 / -124709 / -84786
work-admin: High libssl3@3.5.9-r1    CVE-2026-107493 / -107494 / -121482 / -124709 / -84786
##[error]munaxa-work-admin:ci: findings of severity high or above (grype exit 2)
grype db built 2026-11-21T06:20:06Z
```

Last green `main` run: 44835583159 (`a93c642`, 20 Nov).

### AWS read-only (23 Nov, MunaxaReadOnly permission set, account 229251310592, eu-central-1)

```text
ecr munaxa-work/api:     1 image, tags b490b25, sha-b490b25…, digest sha256:39a89a6fa02c…, pushed 2026-11-08T10:05:54Z
ecr munaxa-work/migrate: 1 image, b490b25, sha256:ca8c02d9e67c…, pushed 2026-11-08T10:06:07Z
ecr munaxa-work/admin:   1 image, b490b25, sha256:c06bb7ef50f2…, pushed 2026-11-08T10:06:49Z
   (all three listed in munaxa-platform infra/aws/stack/withdrawn-images.tf:20-25)
secretsmanager munaxa-nonprod/work-api:     DescribeSecret, 0 versions (last changed 2026-11-05)
secretsmanager munaxa-nonprod/work-migrate: DescribeSecret, 0 versions (last changed 2026-11-05)
ecs task definition families munaxa-nonprod-work*: none
ecs services in munaxa-nonprod: none
rds munaxa-nonprod-pg: stopped
```

## 4. Files inspected (with the lines relied on)

| File                                                                                   | Lines / what                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `README.md`, `ARCHITECTURE.md`, `docs/PHASES.md`                                        | claims and ledger statuses                                                   |
| `docs/verification/product-readiness-audit.md`                                         | August baseline, compared                                                    |
| `apps/api/src/main.ts`, `application.setup.ts`                                          | validation pipe 22-24, prefix, OpenAPI                                       |
| `apps/api/src/tenancy/tenant.middleware.ts`, `authenticated-tenant.guard.ts`, `tenant-resolution.ts` | tenant resolution, `runWithGrants` 106                           |
| `apps/api/src/identity/platform-grants.ts`, `permission-checker.ts:24-30`, `platform-token-authentication.ts:49,66-67,132,162` | grants, MFA claims unused             |
| `apps/api/src/identity/work-permission-catalogue.ts`                                    | 18 modules' permissions                                                       |
| `apps/api/src/health/health.controller.ts:88`                                           | cache status                                                                 |
| `apps/api/src/payroll/payroll.composition.ts:93-95`                                     | `noCountryRules`                                                             |
| `apps/api/src/relations/relations.composition.ts:16-19`, `assets.composition.ts:27`, `career.composition.ts:25-32`, `performance.composition.ts:23-41` | no storage, scheduler, delivery |
| `apps/api/Dockerfile:28,93-110,173-214`, `apps/admin/Dockerfile`                        | base pin, migrate target, healthcheck                                        |
| `packages/config/src/environment.ts:30-151`                                             | configuration contract, `OPENAPI_ENABLED` 88                                  |
| `packages/persistence/src/postgres-unit-of-work.ts:17,41-44`                            | transaction-local tenant                                                     |
| `packages/country-packs/src/index.ts`                                                   | exports nothing                                                              |
| `packages/kernel/src/rules/rule-engine.ts`, `ports/*`                                    | rule engine unused; ports                                                    |
| `packages/modules/payroll/src/domain/country-rule.ts`, `country-rule-application.ts`, `payroll-snapshot.ts:20-35,123-148`, `earnings.ts:23-50`, `payroll-approval.ts:54`, `payroll-outputs.ts:9-16`, `api/result.controller.ts:80` | payroll findings |
| `packages/modules/organization/src/domain/organization-calendar.ts:27`                  | no holidays                                                                  |
| `packages/modules/leave/src/application/leave-permissions.ts`                           | `-own` permissions                                                           |
| `packages/modules/workflow/**`, `docs/modules/workflow.md:70-170`                       | adoption by Recruitment only                                                 |
| `prisma/schema.prisma:551-557,857-880`, `prisma/migrations/*`                           | identifiers, employment end reason, migrations                               |
| `docs/adr/0038-personal-data-protection.md:112`                                         | erasure not implemented                                                      |
| `apps/admin/src/**` (all pages, `shell/*`, `next.config.mjs:16`)                        | read-only, navigation, headers                                               |
| `apps/employee-portal/src/app/page.tsx`, `apps/manager-portal/src/app/page.tsx`, `apps/mobile/lib/main.dart` | bootstrap only                                          |
| `.github/workflows/ci.yml`, `publish-images-ecr.yml`, `.github/scripts/*`               | gates, publish                                                               |
| `deploy/aws/README.md`, `runtime-grants.sql`, `scripts/bootstrap-tenant.mjs:274-393`    | tenant bootstrap                                                             |
| `work prompts/12A_PHASE_11.1_STATUTORY_COUNTRY_PACKS.md`                                | statutory specification                                                      |
| `munaxa-platform/infra/aws/README.md`, `stack/services.tf:553-640`, `stack/envs/nonprod.tfvars`, `stack/withdrawn-images.tf`, `stack/scripts/db-bootstrap.sh:67-72`, `modules/service/variables.tf` | stack inputs and wiring |
| `munaxa-platform/docs/aws-migration/agent-reports/2026-11-11-cross-repository-deployment-readiness/supporting/work.md` | WK-01 to WK-16 |
| `munaxa-platform/docs/aws-migration/agent-reports/2026-11-22-testing-temporary-openssl-acceptance/`, `2026-11-23-docs-testing-apply1/`, `2026-11-21-testing-owner-preparation/` | Testing state |
| `munaxa-platform/packages/platform/auth/src/tokens.ts` at `2bf78ac~1` (2.4.1)            | `exp` and `aud` checks present                                               |
| `munaxa-identity/README.md`, `apps/api/scripts/seed-work-roles.mjs`, `artifacts/work-permissions.json`, `packages/testing/src/token-size.integration.test.ts`, `apps/api/src/auth/auth.service.ts` | roles, cookie ceiling |

## 5. Status of the 11 November findings (WK-01 to WK-16)

| ID    | Then   | Now                                                                    |
| ----- | ------ | ---------------------------------------------------------------------- |
| WK-01 | High   | Fixed (work#31, `tenant_platform_binding`, `resolveForPrincipal`)       |
| WK-02 | High   | Fixed (introspection, `session-revocation.ts`)                          |
| WK-03 | Medium | Open → MW-034                                                          |
| WK-04 | Medium | Fixed (d3ba53b)                                                         |
| WK-05 | Medium | Open → MW-007, MW-011                                                  |
| WK-06 | Medium | Open → MW-050 (rated Low: cosmetic)                                     |
| WK-07 | Medium | Fixed (CI runs on `main`)                                               |
| WK-08 | Low    | Fixed                                                                  |
| WK-09 | Low    | Fixed                                                                  |
| WK-10 | Low    | Fixed then drifted again (188 tables, 35 migrations) → MW-055          |
| WK-11 | Low    | Mitigated in the stack; code default open → MW-051                     |
| WK-12 | Low    | Open, re-measured → MW-008 (raised to Medium because parallel agents)  |
| WK-13 | Low    | Open → MW-025, MW-043                                                  |
| WK-14 | Low    | Open → MW-009                                                          |
| WK-15 | Low    | Open → MW-054                                                          |
| WK-16 | Info   | Not applicable to Work's `@munaxa/auth` 2.4.1                          |

## 6. Limitations

1. **`@munaxa/*` packages could not be installed** (GitHub Packages 401 for this session). So lint,
   typecheck, the test suite, the build, image builds and running the API or admin were **not** done
   here. Their results are taken from CI run 44901535832 on the same commit. Building the platform from
   source was not attempted because the locked versions (`@munaxa/platform` 1.6.1, `@munaxa/auth` 2.4.1)
   differ from the platform repository's current sources (1.7.0, 2.5.0), so a local result would not
   prove the CI result.
2. **No live API workflow was executed.** Workflow statements rely on code reading and on the suites
   that passed in CI. A first Testing session with the synthetic data loader (MW-004) should confirm
   them.
3. **The admin was not rendered.** UI statements come from source; the August audit's screenshots are
   not reused.
4. **No legal research was performed.** The payroll file names what must be verified and by whom; it
   asserts no Jordanian rate or rule.
5. **AWS checks were metadata only** (no secret value, no log content); the connector's permission set
   denies secret values and log reads by design.
6. **Test counts are approximate** (`grep` for `it(` and `test(`), not runner output.

## 7. Clean-up

The local database cluster held only synthetic rows, which were deleted; the probe role was dropped.
No file outside `docs/launch-readiness/2026-11-23/` was changed in `munaxa-work`; the report copy and
index line are the only changes in `munaxa-platform`.
