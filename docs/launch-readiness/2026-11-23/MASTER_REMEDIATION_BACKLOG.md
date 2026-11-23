# Master remediation backlog

Every issue found by this audit, in priority order within each stage. IDs are stable; later reports
should refer to them. Fields per item: severity · category · module · evidence · impact · solution ·
dependencies · complexity (S, M, L, XL) · separate agent · acceptance · verification · stage.
"WS-n" refers to the workstreams in MULTI_AGENT_EXECUTION_PLAN.md.

| Stage                         | Critical | High   | Medium | Low   | Total  |
| ----------------------------- | -------- | ------ | ------ | ----- | ------ |
| Must fix before Internal Testing | 0     | 4      | 5      | 0     | 9      |
| Must fix before Jordan Pilot  | 2        | 12     | 11     | 0     | 25     |
| Must fix before Production    | 0        | 3      | 3      | 6     | 12     |
| **All rated**                 | **2**    | **19** | **19** | **6** | **46** |
| Post-launch roadmap           |          |        |        |       | 10     |

Cumulative blockers: Internal Testing 9; Jordan Pilot 34; Production 46.

---

## A. Must fix before Internal Testing

### MW-001 · High · Release / security · all images

- **Evidence:** CI run 44901535832 on `main` (`61c115b`), job "Images (api, migrate, admin)", step "Scan
  the images" failed: HIGH CVE-2026-124709, -107494, -121482, -84786, -107493 in `libssl3`/`libcrypto3`
  3.5.9-r1. The D-SSL Testing exception (platform report `2026-11-22-testing-temporary-openssl-acceptance`)
  excludes Work. ECR holds only withdrawn `b490b25` images (`withdrawn-images.tf:20-25`).
- **Impact:** no Work image can be published or pinned; CI on `main` is red.
- **Solution:** merge work#35 (OpenSSL `3.5.10-r0`) when Alpine publishes it, or the owner extends D-SSL
  to Work's three images with the same expiry and guard (platform `dssl-exception.tf`, Work's
  `scan-image.sh` mirror of the Testing scan path).
- **Dependencies:** Alpine release, or owner decision D-SSL-W. **Complexity:** S (wait) or M (exception).
- **Separate agent:** yes (WS-1). **Owner approval:** yes.
- **Acceptance:** a `main` CI run with the Images job green, or an exception-scoped Testing scan that
  passes with only the accepted findings. **Verification:** CI run link; Grype report artifact.
- **Stage:** Internal Testing.

### MW-002 · High · AWS / DevOps · platform stack

- **Evidence:** `nonprod.tfvars`: no `images.work_*` (lines 69-79), no Work `secret_version_ids`
  (127-135), `db_bootstrap_products = ["identity", "control"]` (104). Secrets `munaxa-nonprod/work-api`
  and `/work-migrate` have 0 versions (read-only `DescribeSecret`, 23 Nov).
- **Impact:** no Work task definition, database or role can exist.
- **Solution:** owner runs `scripts/aws/owner/work-testing-secrets.sh bundles`; pin PR with digests,
  secret versions, `work` in `db_bootstrap_products`, expected changes; owner approves plan and apply
  with services off.
- **Dependencies:** MW-001. **Complexity:** M. **Separate agent:** yes (WS-1). **Owner approval:** yes.
- **Acceptance:** plan shows only the expected Work task definitions, roles, log groups and db-admin
  revision; apply verified; nothing running. **Verification:** plan and apply run links, ECS
  `DescribeTaskDefinition` read-only. **Stage:** Internal Testing.

### MW-003 · High · Identity / authorization · cross-repository

- **Evidence:** `munaxa-identity/apps/api/scripts/seed-work-roles.mjs:63,75` defines only
  `work-staging-operator` and `work-staging-recruiter`; neither holds organization, compensation,
  payroll, workflow or people-write grants.
- **Impact:** testers cannot set up an organization, run payroll or decide approvals.
- **Solution:** add Testing persona roles, each well under the measured cookie ceiling: organization
  administrator, HR records officer, time and leave officer, payroll preparer, payroll approver,
  recruiter, approver or manager, employee. Add each to Identity's token-size test.
- **Dependencies:** none (repository only). **Complexity:** M. **Separate agent:** yes (WS-2).
- **Acceptance:** every persona fits under 75% of 4,096 bytes; together they cover all 285 grants;
  `payroll.approve` and the preparer grants are in different roles. **Verification:** Identity
  `token-size.integration.test.ts` extended; a Work test that each persona can reach its key routes.
- **Stage:** Internal Testing.

### MW-004 · High · QA tooling · whole product

- **Evidence:** the admin has no write path (FRONTEND_UX_AUDIT.md); the Testing stack sets
  `OPENAPI_ENABLED = "false"` (`services.tf`); no seed or API collection exists in the repository.
- **Impact:** a tester cannot create the data any workflow needs.
- **Solution:** (1) an offline-generated OpenAPI JSON committed as a build artifact; (2) a synthetic data
  loader that signs in through Identity and creates an organization, 20 to 50 synthetic employees,
  leave and attendance configuration, compensation and one payroll period through the API; (3) an API
  collection for manual testing.
- **Dependencies:** MW-003. **Complexity:** L. **Separate agent:** yes (WS-3).
- **Acceptance:** one command loads the dataset into an empty tenant in Testing and is idempotent; no
  real personal data anywhere in it. **Verification:** run log in Testing; row counts by read API.
- **Stage:** Internal Testing.

### MW-005 · Medium · Operations · tenant bootstrap

- **Evidence:** `deploy/aws/README.md` "The first tenant on a fresh database"; platform README G7 step 3
  runs `work-migrate` with `aws ecs run-task`, outside the E-1 guard; the organisation binding is never
  changed by the script.
- **Impact:** a wrong `--platform-tenant-id` or issuer binds the wrong organisation permanently; a
  missing Control link leaves every request without entitlements.
- **Solution:** a guarded operator script that prints and checks the inputs (issuer equals the stack's
  `PLATFORM_AUTH_ISSUER`, organisation exists in Identity), a dry-run mode, and E-1 coverage for
  `work-migrate`.
- **Dependencies:** MW-002. **Complexity:** M. **Separate agent:** yes (WS-1).
- **Acceptance:** a mismatched issuer or organisation is refused before any write. **Verification:**
  offline tests of the guard; first Testing run log. **Stage:** Internal Testing.

### MW-006 · Medium · QA / operations · smoke test

- **Evidence:** platform README G7 step 5 has only "sign in on `work.*`".
- **Solution:** a Work smoke script: `/health/ready`; unauthenticated 401; persona read 200; forbidden
  403; logout then 401 within the revocation cache; entitlement response; admin renders signed in;
  cross-tenant request refused.
- **Dependencies:** MW-003. **Complexity:** S. **Separate agent:** yes (WS-3).
- **Acceptance:** script exits non-zero on any failed probe and prints no token. **Verification:** first
  Testing session log. **Stage:** Internal Testing.

### MW-007 · Medium · Frontend · admin session

- **Evidence:** `apps/admin/src/shell/platform-session.ts` reads the cookie and never refreshes;
  `TENANT_SELECTION_COOKIE` (line 42) is read but never written; cookie `Max-Age=900`.
- **Impact:** testers are signed out every 15 minutes; multi-tenant testers get 401.
- **Solution:** redirect to Identity's refresh when the access cookie is absent and a refresh cookie may
  exist; a tenant picker writing the selection cookie.
- **Dependencies:** Identity refresh endpoint (exists). **Complexity:** M. **Separate agent:** yes
  (WS-2 in Wave 1, before WS-5A takes over `apps/admin/src/shell`). **Acceptance:** a session survives 60 minutes of use. **Verification:** browser test.
  **Stage:** Internal Testing.

### MW-008 · Medium · Database · migrations

- **Evidence:** `prisma migrate diff` (this session): 184 tables, 255 foreign keys, 93 index additions,
  17 index removals, 128 default changes. DATABASE_AUDIT.md.
- **Impact:** `prisma migrate dev` or `db push` would drop overlap protections and rewrite constraints.
- **Solution:** document SQL as authoritative; CI gate against generated migrations and against growth of
  the drift; remove the temptation (`db:reset` local only, warn in scripts).
- **Dependencies:** none. **Complexity:** M. **Separate agent:** yes (WS-4). **Acceptance:** CI fails a
  PR that adds a Prisma-generated migration. **Verification:** a deliberate failing PR in a branch.
  **Stage:** Internal Testing (before parallel database work starts).

### MW-009 · Medium · CI/CD · image publishing

- **Evidence:** `.github/workflows/publish-images-ecr.yml` checks the tag commit is on `main` but not
  that CI passed (WK-14, still open).
- **Solution:** require a successful `CI` run for the SHA before building. **Complexity:** S. **Separate
  agent:** yes (WS-1). **Acceptance:** tagging a commit without green CI fails before any push.
  **Verification:** workflow test on a branch. **Stage:** Internal Testing.

---

## B. Must fix before Jordan Pilot

### MW-010 · Critical · Payroll / statutory · payroll, country-packs

- **Evidence:** `packages/country-packs/src/index.ts` exports nothing; `apps/api/src/payroll/payroll.composition.ts:93-95`
  wires `noCountryRules`; `CountryRuleInput` lacks year-to-date and person facts; port is synchronous;
  kernel rule engine unused. PAYROLL_JORDAN_READINESS.md.
- **Impact:** net pay, contributions and tax are wrong for any real Jordanian employee.
- **Solution:** extend the port (YTD, person facts, rule source by date); a Jordan pack as versioned
  data with sources; golden cases from specialists; parallel run.
- **Dependencies:** owner-commissioned Jordanian legal and payroll research (§4 of the payroll file);
  MW-019 for end of service. **Complexity:** XL. **Separate agent:** yes (WS-8). **Owner approval:**
  yes (research sign-off).
- **Acceptance:** all golden cases pass; every statutory line cites a source and rule version; a
  two-month parallel run is explained. **Verification:** CI golden-case job; specialist sign-off
  document. **Stage:** Jordan Pilot.

### MW-011 · Critical · Frontend · admin, all modules

- **Evidence:** no `<form>`, server action or mutating request in `apps/admin/src`; one client component.
- **Impact:** no workflow can be done by an HR user.
- **Solution:** a single form pattern, then write screens in pilot order (FRONTEND_UX_AUDIT.md).
- **Dependencies:** MW-007, MW-012 for realistic roles. **Complexity:** XL. **Separate agent:** yes
  (WS-5A and WS-5B by module group). **Acceptance:** workflows A to J complete from the browser with
  synthetic data. **Verification:** browser E2E per workflow (MW-032). **Stage:** Jordan Pilot.

### MW-012 · High · Security / architecture · Identity, Platform, Work

- **Evidence:** grants travel in the access token cookie; Identity's
  `token-size.integration.test.ts` asserts the 285-grant catalogue exceeds 4,096 bytes.
- **Impact:** a real HR director or payroll manager cannot be given the grants they need in one role.
- **Solution:** ADR: resolve grants server-side (for example returned by introspection and cached per
  session) or compact role references; no wildcards.
- **Dependencies:** Identity and Platform owners. **Complexity:** L. **Separate agent:** yes (WS-2).
  **Owner approval:** yes (ADR). **Acceptance:** a role holding all 285 grants works end to end and the
  cookie stays under the design limit. **Verification:** Identity token-size test, Work integration
  test. **Stage:** Jordan Pilot.

### MW-013 · High · Self-service · portals, mobile, all `-own` handlers

- **Evidence:** portals are bootstrap pages; 13 of 15 `-own` permissions have no enforcing handler.
- **Solution:** handlers for payslip, leave read and request, attendance record, documents, letters,
  compensation, performance and learning own reads; employee portal; manager approvals and team view.
  Mobile can follow the pilot.
- **Dependencies:** MW-011 pattern, MW-018 payslip, MW-014 documents. **Complexity:** XL. **Separate
  agent:** yes (WS-9). **Acceptance:** an employee persona can see only their own records (tested
  against another employee's ids). **Verification:** integration and browser tests. **Stage:** Jordan
  Pilot.

### MW-014 · High · Platform adapter · documents, letters, relations, recruitment

- **Evidence:** "no `StoragePort` adapter exists anywhere in this repository"
  (`apps/api/src/relations/relations.composition.ts:16`).
- **Solution:** an S3 adapter (per-tenant prefix, KMS, presigned URLs, malware scan) or reuse Munaxa Docs
  as the store; decide first.
- **Dependencies:** owner decision; platform stack bucket. **Complexity:** L. **Separate agent:** yes
  (WS-6). **Owner approval:** yes (AWS resources). **Acceptance:** upload, scan, download and delete
  with tenant isolation tests. **Verification:** integration tests with LocalStack or a Testing bucket.
  **Stage:** Jordan Pilot.

### MW-015 · High · Platform adapter · notifications

- **Evidence:** `RecordingNotificationPort` records intent and delivers nothing
  (`apps/api/src/performance/performance.composition.ts:23-41`).
- **Solution:** an email adapter (SES or the provider Docs uses) with templates in English and Arabic;
  notification preferences later.
- **Dependencies:** owner choice of provider and sending domain. **Complexity:** L. **Separate agent:**
  yes (WS-6). **Owner approval:** yes. **Acceptance:** approval requests and decisions send email in
  Testing to a test mailbox. **Verification:** integration test with a fake transport; Testing mailbox.
  **Stage:** Jordan Pilot.

### MW-016 · High · Platform adapter · scheduling

- **Evidence:** no `JobPort` adapter (D-16E-03 assigned it to Platform); compositions state "nothing
  here is scheduled".
- **Solution:** a scheduled ECS task or EventBridge rule calling idempotent run endpoints (workflow
  escalation and reminders, leave accrual and year-end, document expiry, onboarding reconciliation,
  attendance-leave reconciliation).
- **Dependencies:** MW-015 for reminders. **Complexity:** M. **Separate agent:** yes (WS-6). **Owner
  approval:** yes (AWS). **Acceptance:** each job runs once per schedule, is idempotent and logs its
  result. **Verification:** Testing run evidence. **Stage:** Jordan Pilot.

### MW-017 · High · Workflow / approvals · leave, payroll, letters, compensation, recruitment offers

- **Evidence:** `docs/modules/workflow.md`: "Recruitment is the single adopted business module"; the
  kernel `ApprovalPort` is "published and unwired".
- **Solution:** adopt the Workflow engine for leave requests, payroll approval, letters and compensation
  changes through the same approval-id seam Recruitment uses.
- **Dependencies:** MW-015, MW-016. **Complexity:** L. **Separate agent:** yes (WS-7). **Acceptance:**
  a leave request routes to the employee's manager, supports delegation and escalates on its service
  level. **Verification:** cross-module integration tests. **Stage:** Jordan Pilot.

### MW-018 · High · Payroll outputs · payroll

- **Evidence:** payment instructions carry no account identifier; no bank model; payslip is data only
  (`domain/payroll-outputs.ts:9-12`, `result.controller.ts:80`).
- **Solution:** employee bank details (sensitive, permissioned, audited), bank file formats for the
  pilot customers' banks, payslip PDF in Arabic and English.
- **Dependencies:** MW-010 research on payment of wages; MW-014 storage for documents. **Complexity:** L.
  **Separate agent:** yes (WS-8). **Acceptance:** the pilot banks accept a test file. **Verification:**
  bank test upload; golden payslip snapshots. **Stage:** Jordan Pilot.

### MW-019 · High · Offboarding · new module

- **Evidence:** Phase 11.2 not started; no table or route.
- **Solution:** separation request and approval, clearance (consumes assets' contribution), final
  settlement with end of service from the Jordan pack.
- **Dependencies:** MW-010. **Complexity:** L. **Separate agent:** yes (WS-8). **Acceptance:** golden
  cases for each termination reason. **Verification:** CI. **Stage:** Jordan Pilot.

### MW-020 · High · Loans and advances · new module

- **Evidence:** Phase 10.1 not started.
- **Solution:** loans, schedules and payroll recovery within the legal deduction limits from research.
- **Dependencies:** MW-010 research. **Complexity:** M. **Separate agent:** yes (WS-8). **Acceptance:**
  recovery lines in payroll; early settlement and settlement on leaving. **Verification:** tests.
  **Stage:** Jordan Pilot (can be deferred if no pilot customer needs it; owner decides).

### MW-021 · High · Attendance / payroll · overtime

- **Evidence:** `packages/modules/payroll/src/domain/earnings.ts:23-25`, ADR-0065.
- **Solution:** an overtime approval step that turns candidate minutes into approved overtime, rated by
  the Jordan pack.
- **Dependencies:** MW-010, MW-017. **Complexity:** M. **Separate agent:** yes (WS-8). **Owner
  approval:** yes (reverses an ADR). **Acceptance:** approved overtime appears as an earning with its
  rule. **Verification:** golden cases. **Stage:** Jordan Pilot.

### MW-022 · High · Security · MFA

- **Evidence:** `platform-token-authentication.ts:49,66-67,132` carries `amr` and `mfa`; nothing reads
  them. Identity MFA policy lists only Control roles (`nonprod.tfvars:89-93`).
- **Solution:** permission-level MFA requirement for payroll, compensation, relations, identifiers and
  exports; add Work admin roles to Identity's privileged list.
- **Dependencies:** MW-012. **Complexity:** M. **Separate agent:** yes (WS-2, which owns the permission
  checker). **Acceptance:** a non-MFA token is refused on every marked operation. **Verification:** integration tests. **Stage:**
  Jordan Pilot.

### MW-023 · High · Privacy · all modules

- **Evidence:** `docs/adr/0038-personal-data-protection.md:112` "Erasure is not implemented"; no
  retention configuration or purge.
- **Solution:** retention policy per record class (from legal research), per-person export,
  anonymisation after retention, privacy notice support.
- **Dependencies:** legal research. **Complexity:** L. **Separate agent:** yes (WS-10). **Owner
  approval:** yes. **Acceptance:** documented policy; tested export and anonymisation. **Verification:**
  integration tests; legal sign-off. **Stage:** Jordan Pilot.

### MW-024 · Medium · Security · people, compensation, relations

- **Evidence:** `person_identifier.value varchar(64)` in clear text (`prisma/schema.prisma:556`).
- **Solution:** decide with legal review; if required, envelope encryption for identifiers and health
  data with KMS, keeping the keyed digest for matching.
- **Complexity:** M. **Separate agent:** yes (WS-10). **Stage:** Jordan Pilot.

### MW-025 · Medium · Security · API and admin

- **Evidence:** no rate limiting or security headers in the API; admin sets only
  `poweredByHeader: false`.
- **Solution:** WAF rate rules at the ALB (platform), `helmet`-equivalent headers, admin CSP and
  `frame-ancestors 'none'`, body size limits.
- **Complexity:** S to M. **Separate agent:** yes (WS-10). **Acceptance:** headers present in a
  deployed response; rate rule tested. **Stage:** Jordan Pilot.

### MW-026 · Medium · Audit · cross-cutting

- **Evidence:** read access logged only for documents and relation violations.
- **Solution:** read-access events for payroll results, compensation, identifiers and exports; an audit
  browser and export per employee.
- **Complexity:** M. **Separate agent:** yes (WS-10). **Stage:** Jordan Pilot.

### MW-027 · Medium · Owner decisions · employment, attendance, workflow, assets

- **Evidence:** `docs/PHASES.md` rows 5, 8 and 16 "Awaiting approval"; Phase 5.3 decisions D-5.3-03,
  05, 07, 08, 10 open.
- **Solution:** owner yes/no per phase and decision (the lead prepares a one-page card).
- **Complexity:** S. **Separate agent:** no (lead). **Owner approval:** yes. **Stage:** Jordan Pilot.

### MW-028 · Medium · Frontend · relations, identity, organization

- **Evidence:** no `apps/admin/src/relations` or identity screens; no settings editor.
- **Solution:** add those screens with MW-011. **Complexity:** M. **Separate agent:** yes (WS-5A).
  **Stage:** Jordan Pilot.

### MW-029 · Medium · Frontend UX · admin

- **Evidence:** no `error.tsx`/`not-found.tsx`; no pagination, sorting, search; `?lang=` only; no Hijri.
- **Complexity:** M. **Separate agent:** yes (WS-5A). **Stage:** Jordan Pilot.

### MW-030 · Medium · Localization / statutory content · organization, leave

- **Evidence:** no built-in calendars or entitlements (`organization-calendar.ts:27`, ADR-0060); Arabic
  terminology unreviewed.
- **Solution:** Jordan working week, public holidays and leave entitlements as pack data from research;
  native-speaker review of the Arabic catalogues.
- **Dependencies:** MW-010 research. **Complexity:** M. **Separate agent:** yes (WS-8 for data, WS-5A
  for review fixes). **Stage:** Jordan Pilot.

### MW-031 · Medium · Letters · output

- **Evidence:** issued letters are data; no rendering.
- **Solution:** PDF rendering in Arabic and English, stored through MW-014.
- **Complexity:** M. **Separate agent:** yes (WS-6). **Stage:** Jordan Pilot.

### MW-032 · Medium · QA · end-to-end

- **Evidence:** 0 browser tests, 0 deployed-environment tests.
- **Solution:** Playwright suites per workflow A to J against a local stack and against Testing.
- **Dependencies:** MW-011. **Complexity:** L. **Separate agent:** yes (WS-3, then the QA verifier).
  **Stage:** Jordan Pilot.

### MW-033 · Medium · Developer environment · CI and agents

- **Evidence:** `pnpm install` 401 in this session; work#32 waits for the owner's GitHub Packages Read
  grant.
- **Solution:** owner grants read access to the `@munaxa` packages for agent sessions (or publishes them
  where sessions can read), then merge work#32.
- **Complexity:** S. **Separate agent:** no (owner). **Owner approval:** yes. **Stage:** before Wave 2
  (practically needed for Wave 1 speed).

### MW-034 · Medium · Security / operations · key rotation

- **Evidence:** static `PLATFORM_AUTH_PUBLIC_KEYS` (WK-03).
- **Solution:** rotation runbook with overlap, rehearsed in Testing; optional JWKS with pinning.
- **Complexity:** S. **Separate agent:** yes (WS-2). **Stage:** Jordan Pilot.

---

## C. Must fix before Production

### MW-040 · High · Operations · monitoring

No metrics, alarms or SLOs for Work; logs only. Add 5xx, latency and task-health alarms, log-based
alerts for authorization failures and payroll errors, an on-call runbook. Complexity L. WS-1. Owner
approval yes (AWS).

### MW-041 · High · Operations · backup and DR

No rehearsed restore of the Work database; forward-only migrations. Rehearse a point-in-time restore
and a failed-migration recovery in Testing; write recovery objectives. Complexity M. WS-1 and WS-4.
Owner approval yes.

### MW-045 · High · Support and legal · product

No support tooling, user or tenant administration screens for Munaxa staff, service levels, data
processing agreement or terms for HR data. Complexity L. Lead with owner. Owner approval yes.

### MW-042 · Medium · Performance · API

`work-api` runs one 0.25 vCPU, 512 MB task with no autoscaling; measurement scripts are local only. Load
test on the AWS shapes; size and autoscale. Complexity M. WS-1.

### MW-043 · Medium · Security · internal transport

Admin to API over plain HTTP in the VPC with the bearer token (`WORK_API_URL`). TLS or co-location.
Complexity M. WS-1.

### MW-044 · Medium · Tenancy · lifecycle

No tenant registry, suspension, export or closure (DATABASE_AUDIT.md). Complexity M. WS-4 with Control.

### MW-050 · Low · Health

`/health` reports `cache: up` whenever `REDIS_URL` is set and no code uses Redis
(`apps/api/src/health/health.controller.ts:88`, WK-06). Report `not-used`. S. WS-1.

### MW-051 · Low · Configuration

`OPENAPI_ENABLED` defaults to `true` (`packages/config/src/environment.ts:88`, WK-11). Default to false
in production. S. WS-10.

### MW-052 · Low · Database / RLS

`workforce_user` insert check is `true`. Tighten. S. WS-4.

### MW-053 · Low · Dependencies

`@munaxa/platform` 1.6.1 and `@munaxa/auth` 2.4.1 behind 1.7.0 and 2.5.0. Upgrade with platform parity
gate. S. WS-1.

### MW-054 · Low · Images

API container HEALTHCHECK hard-codes port 3000 (`apps/api/Dockerfile:211-212`, WK-15). Read `PORT`. S.
WS-1.

### MW-055 · Low · Documentation

README and ARCHITECTURE say 187 tables and 34 migrations; there are 188 and 35. `docs/verification/product-readiness-audit.md`
(August) is superseded in part by this audit and should say so. S. WS-11 (documentation).

---

## D. Post-launch roadmap (not blockers)

| ID     | Item                                                    | Phase   |
| ------ | ------------------------------------------------------- | ------- |
| MW-060 | Benefits                                                | 12      |
| MW-061 | Medical and employee claims                             | 12.1    |
| MW-062 | Engagement and surveys                                  | 13.1    |
| MW-063 | Learning sessions, capacity and waitlists               | 14B     |
| MW-064 | Mobile applications (after web self-service)            | 19.1    |
| MW-065 | Workforce intelligence and report builder               | 20      |
| MW-066 | Governance, risk and compliance                         | 21      |
| MW-067 | Enterprise integrations (government portals, ERP, SSO)  | 22      |
| MW-068 | AI workforce intelligence                               | 23      |
| MW-069 | Enterprise operations                                   | 24      |

A pilot customer contract that includes any of these moves it into section B.
