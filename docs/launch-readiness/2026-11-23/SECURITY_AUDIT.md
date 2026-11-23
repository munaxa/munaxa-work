# Security and tenant isolation audit

Baseline `61c115b`. Synthetic data only. No external system was probed; the only live test was against
a local PostgreSQL 16 created for this session and dropped afterwards.

## Summary

| Area                         | State                                                                                                   | Backlog        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Authentication               | Good: ES256/RS256 only, issuer and audience checked, Identity owns credentials                           |                |
| Session revocation           | Good: Identity introspection per request, 5 s cache, fail closed, `disabled` refused in production       | (WK-02 fixed)  |
| Tenant binding of grants     | Good: one Identity organisation to one Work tenant, `tid` required                                       | (WK-01 fixed)  |
| Tenant isolation (database)  | Good: RLS enabled and forced on 188 of 188 tables; probe passed                                          |                |
| Authorization model          | Good design, **capacity problem**: grants travel in a cookie-sized token                                | MW-003, MW-012 |
| MFA                          | Not enforced by Work for any operation                                                                   | MW-022         |
| Personal data                | Access-controlled; not encrypted at column level; no retention or erasure                                | MW-023, MW-024 |
| Audit                        | Write audit columns everywhere; read logging only for documents and relation violations                  | MW-026         |
| Rate limiting and headers    | None in the API; admin sets no CSP, frame or HSTS headers                                                | MW-025         |
| Internal transport           | Admin to API over plain HTTP inside the VPC, carrying the bearer token                                   | MW-043         |
| Key rotation                 | Static public keys; rotation needs a coordinated redeploy                                                | MW-034         |
| Images                       | All three fail the HIGH gate on OpenSSL 3.5.9-r1                                                         | MW-001         |
| Dependencies                 | `pnpm audit --audit-level high` passed on `main` (21 Nov)                                                |                |
| Secrets                      | No secret in the repository; bundle values are written by the owner; `.npmrc` holds no credential        |                |

Counts in this file: Critical 0, High 4 (MW-001, MW-012, MW-022, MW-023), Medium 6 (MW-024, MW-025,
MW-026, MW-034, MW-043, MW-009), Low 3 (MW-051, MW-052, MW-053). MW-003 is a functional blocker with a
security dimension (a test role that holds too much is the wrong fix).

## 1. Authentication and sessions

- `apps/api/src/identity/platform-token-authentication.ts` verifies the token with `@munaxa/auth`
  2.4.1 (locked). That version already refuses a missing or non-numeric `exp` and treats a string
  `aud` as a one-element list (checked in `munaxa-platform` history at the commit before the 2.5.0 bump,
  `2bf78ac~1`, `packages/platform/auth/src/tokens.ts:173,196-201`). The 11 Nov "WK-16" weakness does not
  apply.
- `packages/config/src/environment.ts:101-126`: all four `PLATFORM_AUTH_*` values or none; only
  asymmetric algorithms; private keys refused; revocation check `introspect` by default and the only
  value production accepts; cache 0 to 30 s.
- `apps/api/src/tenancy/tenant.middleware.ts`: `cache-control: no-store` and `vary` on every response;
  the tenant comes from a stored membership; `x-munaxa-tenant` only selects among the caller's own
  memberships; unresolved requests get no context and the guard answers 401.
- Password handling, MFA enrolment, lockout and reset are Identity's and outside this repository.
- **MW-022 (High, Pilot):** `amr` and `mfa` are copied onto the principal
  (`platform-token-authentication.ts:49,66-67,132`) and nothing reads them. Payroll approval and
  finalization, compensation changes, relations cases and identifier reads do not require MFA or a
  recent step-up. Identity's Testing MFA policy lists only the two Control operator roles
  (`munaxa-platform/infra/aws/stack/envs/nonprod.tfvars:89-93`).
  **Fix:** a permission-level "requires MFA" marker checked by the permission checker, plus adding the
  Work administrative roles to Identity's privileged list. **Verify:** an integration test where a
  token without `mfa=true` is refused on `POST /payroll/runs/:id/finalization`.
- **MW-034 (Medium, Pilot):** keys are static PEMs in `PLATFORM_AUTH_PUBLIC_KEYS`; there is no JWKS.
  Rotation needs both keys configured in Work before Identity switches. **Fix:** a rotation runbook with
  an overlap window, tested in Testing.

## 2. Authorization and tenant boundaries

- One checker: `PlatformPermissionChecker.has` reads the request's grant set
  (`apps/api/src/identity/permission-checker.ts:24-30`). Grants are exact; `work:*` grants nothing
  (`platform-grants.ts`). The 285-name catalogue matches Identity's artifact exactly (checked).
- Every handler declares its permission through the kernel pipeline, which authorizes before validation
  (`authenticated-tenant.guard.ts` explains the ordering).
- **MW-012 (High, Pilot):** grants are carried in the access token, which travels in the
  `__Host-mx_session` cookie (4,096-byte browser limit). Identity's own test
  (`munaxa-identity/packages/testing/src/token-size.integration.test.ts`) asserts that the full
  285-grant catalogue does **not** fit and measures the ceiling. The 285 grant strings alone are 8,694
  bytes before base64 encoding. A real HR director or payroll manager role therefore cannot be issued as
  one token. **Fix (needs an ADR across Identity, Platform and Work):** resolve grants server-side
  (Work asks Identity for the role's grants with the introspection call, cached per session) or issue
  compact role references. **Do not** work around it with wildcards (Work refuses them by design).
- **Cross-tenant leakage:** covered by `apps/api/src/tenancy/cross-tenant.postgres.spec.ts`,
  `token-tenant-isolation.spec.ts`, `token-authorization.spec.ts` and per-module
  `*-isolation.integration.test.ts` files (for example `payroll-isolation.integration.test.ts`). In this
  session a direct database probe confirmed the policy behaviour (AUDIT_EVIDENCE.md §5).
- **MW-052 (Low):** `workforce_user` is the one table without `tenant_id` (a person may belong to
  several tenants, ADR-0033). Its `tenant_reachability` policy has `WITH CHECK (true)`, so any request
  in any tenant context can insert a global `workforce_user` row. Reading and updating are limited to
  users with a membership in the current tenant. Risk is low (a row is inert without a membership), but
  the check should require the insert path that also creates the membership. **Verify:** a test as
  `work_app` that a bare insert is refused.

## 3. Personal and sensitive data

- Confidential documents and withheld counts are filtered inside the query, so a caller without
  `document.read-sensitive` does not learn a document exists.
- Logs: `apps/api/src/observability/logging.ts` redacts `authorization`, `cookie` and `set-cookie`.
- **MW-024 (Medium, Pilot):** national identifiers are stored in clear text
  (`person_identifier.value`, `prisma/schema.prisma:556`); only the duplicate check uses a keyed
  digest. Salaries, health-adjacent leave reasons and disciplinary records are also plain columns.
  Protection relies on RDS storage encryption, RLS and permissions. A legal reviewer should decide
  whether Jordan's personal data protection law or customer contracts require field-level encryption
  for identifiers and health data.
- **MW-023 (High, Pilot):** no retention schedule, no purge, no per-person export and no erasure
  (`docs/adr/0038-personal-data-protection.md:112`: "Erasure is not implemented"). A pilot with real
  employees needs at least a documented retention policy and a supported export and anonymisation path
  reviewed against Jordanian law.
- **Exports:** six `/export` reads (people, employment, organization, attendance, recruitment,
  onboarding) are guarded by their own `*.export` permissions. Their use is not logged (MW-026).

## 4. Audit logging

- Every table has creation audit columns (`created_by` or equivalent present on 188 of 188; checked).
- Append-only enforcement: 29 user triggers, including `workflow_decision` and `workflow_history`
  refusing update and delete, and finalized payroll rows frozen (ADR-0066).
- **MW-026 (Medium, Pilot):** read-access events exist only for documents and relation violations
  (`document_access_event`, `relation_violation_access_event`). Who viewed a payslip, a salary or an
  identifier is not recorded, and there is no audit browser or export for a customer's auditor.

## 5. Input validation, errors, rate limiting, headers

- Global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`
  (`apps/api/src/application.setup.ts:22-24`); RFC 9457 problem details; domain-level validation and
  database check constraints throughout.
- **MW-025 (Medium, Pilot):** no rate limiting, no `helmet` or security headers and no explicit body
  size limit in the API (`grep -i "helmet|throttl|rate.limit|enableCors"` finds nothing). The admin sets
  only `poweredByHeader: false` (`apps/admin/next.config.mjs:16`): no Content-Security-Policy,
  `frame-ancestors`, `X-Content-Type-Options` or HSTS. CORS is not configured, which is correct for the
  single-origin design. **Fix:** WAF rate rules at the ALB plus application headers; a CSP for the
  admin.
- **MW-051 (Low):** `OPENAPI_ENABLED` defaults to `true` in code (`environment.ts:88`). The AWS stack
  sets it to `false`, so this only matters for other deployments.

## 6. Transport and infrastructure

- **MW-043 (Medium, Production):** `WORK_API_URL=http://work-api.<env>.munaxa.internal:3000`. The admin
  forwards the user's bearer token over plain HTTP within the VPC. Acceptable for Testing; for
  production use TLS or a service mesh, or keep the call on the same task.
- Database: `work_app` is `NOBYPASSRLS` and has data access only (`deploy/aws/runtime-grants.sql`);
  the migration owner is in a separate bundle; RDS uses the Amazon root bundle
  (`deploy/aws/rds-ca-eu-central-1.crt`, `rds-certificate-trust.spec.ts`).

## 7. Images and dependencies

- **MW-001 (High, Testing):** CI job "Images (api, migrate, admin)" on `main` failed on 21 Nov: Grype
  reported HIGH CVE-2026-124709, -107494, -121482, -84786 and -107493 in `libssl3` and `libcrypto3`
  3.5.9-r1 (`/lib/apk/db/installed`). The fix is OpenSSL 3.5.10 (work#35, draft, fails by design until
  Alpine ships `3.5.10-r0`). The D-SSL Testing exception explicitly excludes Work.
- **MW-009 (Medium, Testing):** `publish-images-ecr.yml` checks that the tag's commit is on `main` but
  not that CI passed for it (WK-14). The publish job does run its own verify and scan, so a vulnerable
  image would still be refused; an image of a commit whose tests failed would not.
- **MW-053 (Low):** `@munaxa/platform` 1.6.1 and `@munaxa/auth` 2.4.1 are locked while 1.7.0 and 2.5.0
  are published. No security fix relevant to Work was found in the gap; upgrade with the next platform
  change.
- `pnpm audit --audit-level high` passed in CI on `main` (step "Dependency audit", 21 Nov).

## 8. Backup and recovery assumptions

Work relies on the shared RDS instance (automated backups, point-in-time restore per the platform
README "Rollback" table) and on forward-only migrations. No restore of the Work database has been
rehearsed, and no recovery point or time objective is written down (MW-041).

## 9. Administrative access

There is no Work super-administrator. The operator path is Identity plus Control (AWS-native operator
access, `munaxa-platform/infra/aws/OPERATOR-ACCESS.md`). Tenant bootstrap needs the migration owner's
database credential through a one-off ECS task (MW-005). That is appropriately narrow; it also means
customer support has no tooling (MW-045).
