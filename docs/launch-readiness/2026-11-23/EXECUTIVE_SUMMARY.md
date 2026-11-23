# Munaxa Work launch readiness audit: executive summary

**Date:** 23 November 2026 · **Baseline:** `munaxa-work` `main` at `61c115b` (#34), `munaxa-platform`
`main` at `9a3725e`, `munaxa-identity` `main` at `0b94951` · **Scope:** audit and report only. No
application code, AWS resource, image, secret, GitHub setting or database outside this session's
local scratch PostgreSQL was changed.

The report set:

| File                                                           | What it holds                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md)                   | This page                                                                    |
| [MODULE_AUDIT.md](MODULE_AUDIT.md)                             | Module-by-module status with evidence                                        |
| [END_TO_END_WORKFLOWS.md](END_TO_END_WORKFLOWS.md)             | Workflows A to J traced through schema, API, authorization and UI            |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md)                         | Authentication, tenant isolation, authorization, privacy, headers, images    |
| [DATABASE_AUDIT.md](DATABASE_AUDIT.md)                         | Migrations, RLS, constraints, drift, operational safety                      |
| [FRONTEND_UX_AUDIT.md](FRONTEND_UX_AUDIT.md)                   | Admin, portals, mobile, localization                                         |
| [PAYROLL_JORDAN_READINESS.md](PAYROLL_JORDAN_READINESS.md)     | Payroll engine status and the Jordan Pilot Payroll Gap Assessment            |
| [AWS_TESTING_READINESS.md](AWS_TESTING_READINESS.md)           | What Work still needs before it can join a controlled Testing session        |
| [TESTING_AND_QUALITY.md](TESTING_AND_QUALITY.md)               | Checks run, CI results, coverage gaps                                        |
| [MULTI_AGENT_EXECUTION_PLAN.md](MULTI_AGENT_EXECUTION_PLAN.md) | Workstreams, ownership, sequencing and acceptance for the implementation run |
| [MASTER_REMEDIATION_BACKLOG.md](MASTER_REMEDIATION_BACKLOG.md) | Every issue, `MW-001` onwards, in priority order                             |
| [AUDIT_EVIDENCE.md](AUDIT_EVIDENCE.md)                         | Commands, files, outputs and limitations                                     |

## Verdict

| Stage                           | Verdict                         | In one sentence                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Internal Testing**         | **NOT READY, close**            | The backend is strong and testable with synthetic data through the API, but there is no publishable image (OpenSSL scan failure, not covered by the Testing exception), no Work inputs in the AWS stack, no usable Identity roles, and no way for a tester to create data without tooling. |
| **B. Jordan Pilot**             | **NOT READY, far**              | No Jordanian statutory payroll at all, no write screens, no employee or manager self-service, no file storage, no notifications, no offboarding or settlement, and no payment file.                                                                                                       |
| **C. Commercial Production**    | **NOT READY**                   | Everything in B, plus monitoring, disaster recovery drills, capacity, support tooling and legal terms for processing HR data.                                                                                                                                                            |

## What works (verified)

- **The domain backend is real and well tested.** 18 business modules, 517 HTTP route handlers
  (514 in the modules and 3 health probes), 188 tables and 35 migrations. All 35
  migrations applied cleanly to an empty PostgreSQL 16 in this session. CI on `main` (run
  [44901535832](https://github.com/munaxa/munaxa-work/actions/runs/44901535832)) passed format, lint,
  typecheck, migrations, the full test suite against a real PostgreSQL, build, production-output
  check, Prisma validate and `pnpm audit --audit-level high`. The repository has 489 test files and
  about 5,100 test cases, 129 of them integration files against PostgreSQL.
- **Tenant isolation is enforced twice.** Every one of the 188 tables has row-level security enabled
  **and forced**; 187 use `tenant_id = app_current_tenant()` and the tenant is set transaction-locally.
  A probe in this session as a `NOBYPASSRLS` role saw 0 rows with no tenant, 1 row with its own tenant,
  updated 0 rows of the other tenant and was refused when inserting into it.
- **Authentication and session revocation are fixed.** WK-01 (grants carried across tenants) and
  WK-02 (revoked tokens accepted for about 15 minutes) are fixed on `main` (work#31 `eabcc47`,
  identity#15). Tokens are bound to one Identity organisation through `tenant_platform_binding`, and
  every request's session is checked with Identity's introspection endpoint (5 s cache, fail closed).
- **Payroll mechanics are sound for synthetic testing.** Snapshot-based runs, explainable lines,
  integer minor units with the currency exponent (JOD with 3 decimals is in the tests), self-approval
  refused in code and in the database, finalized results immutable at the table, reversal and
  reconciliation.
- **The admin portal now has a shell and detail pages** (30 pages, navigation, loading states,
  English and Arabic with direction following the language), but it is still entirely read-only.

## What blocks Internal Testing (9 issues: 4 High, 5 Medium)

1. **MW-001:** No deployable Work image. CI on `main` fails the image scan with 10 HIGH findings
   (five OpenSSL CVEs in `libssl3`/`libcrypto3` 3.5.9-r1). The Testing-only OpenSSL exception
   (D-SSL) covers Identity, Control and Docs, **not Work**. ECR holds only the withdrawn `b490b25`
   images. Either wait for OpenSSL 3.5.10 in Alpine (work#35, expected around 1 December) or the owner
   widens D-SSL to Work.
2. **MW-002:** The AWS stack has no Work inputs: no image digests, no `work-api`/`work-migrate`
   secret versions (both secrets exist with **zero versions**, verified read-only), `work` is not in
   `db_bootstrap_products`.
3. **MW-003:** Identity defines only two Work roles (staging operator, staging recruiter). Nobody can
   set up an organization, run payroll, configure leave policies or decide approvals.
4. **MW-004:** Testers cannot create data. The admin is read-only, the Testing stack turns OpenAPI off,
   and there is no synthetic data loader or API collection.
5. **MW-005 to MW-009 (Medium):** the manual tenant bootstrap and Control linkage chain, no
   Work-specific smoke test, no admin session refresh, Prisma schema drift that makes `prisma migrate
dev` destructive, and an image publish workflow that does not require a green CI run.

## What blocks the Jordan Pilot (25 more issues: 2 Critical, 12 High, 11 Medium)

- **MW-010 Critical:** No Jordanian statutory payroll. `packages/country-packs` exports nothing; the
  only `CountryRulePort` wired is `noCountryRules`. Social security, income tax and end of service are
  absent, and the port cannot see year-to-date figures or personal facts such as nationality. **The
  payroll engine must not be used for real Jordanian payroll** until a pack is built from verified
  sources and signed off by qualified Jordanian payroll specialists.
- **MW-011 Critical:** No write screens. All ten workflows in this audit need direct API calls.
- **High:** a token-size ceiling that prevents a full HR or payroll administrator role (MW-012), no
  self-service (MW-013), no document storage (MW-014), no notifications (MW-015), no scheduler
  (MW-016), approvals outside Recruitment never use the workflow engine (MW-017), no payslip document
  or bank file (MW-018), no offboarding or final settlement (MW-019), no loans (MW-020), overtime never
  payable (MW-021), no MFA enforcement in Work (MW-022), no privacy retention or erasure (MW-023).

## What blocks Production (6 more issues: 3 High, 3 Medium, plus 6 Low)

Monitoring and alerting, a rehearsed restore and disaster recovery, capacity and load testing,
internal TLS between admin and API, tenant lifecycle, and support tooling and legal terms
(MW-040 to MW-045), plus six Low items (MW-050 to MW-055).

## Totals

| Severity  | Count  |
| --------- | ------ |
| Critical  | 2      |
| High      | 19     |
| Medium    | 19     |
| Low       | 6      |
| **Rated** | **46** |
| Roadmap   | 10     |

Blocking Internal Testing: **9**. Blocking Jordan Pilot: **34** (the 9 plus 25). Blocking Production:
**46** (everything rated). The ten roadmap items (MW-060 to MW-069) block no stage.

## Recommended next steps

1. **Owner decision now:** widen the Testing-only OpenSSL exception to Work, or wait for OpenSSL 3.5.10
   (MW-001). Everything else for Testing can be prepared in parallel.
2. **Wave 1 (Internal Testing), 3 implementation agents plus a lead and a QA verifier:** release and
   AWS inputs, Identity test roles, synthetic data and smoke tests, the schema drift gate.
3. **Owner commissions Jordanian payroll and legal research** (social security, income tax, end of
   service, overtime, leave, payment of wages, personal data protection). Wave 2 payroll work cannot
   start without it.
4. **Wave 2 (Jordan Pilot build):** up to 7 implementation agents plus lead, integration and QA. See
   [MULTI_AGENT_EXECUTION_PLAN.md](MULTI_AGENT_EXECUTION_PLAN.md).

## Corrections to earlier context

- "Work images have never been published" is not quite right: `munaxa-work/api`, `/migrate` and
  `/admin` each hold one image from `b490b25` (pushed 8 November). All three are withdrawn in
  `munaxa-platform` `infra/aws/stack/withdrawn-images.tf` (CVE-2026-4738) and must never be pinned.
  There is **no usable** Work image.
- The 11 November audit (WK-01 to WK-16): WK-01, WK-02, WK-04, WK-07, WK-08, WK-09 and WK-10 are fixed
  on `main`. WK-11 is mitigated by the stack (`OPENAPI_ENABLED=false`). WK-16 does not apply to Work's
  locked `@munaxa/auth` 2.4.1, which already checks `exp` and normalises `aud`. WK-03, WK-05, WK-06,
  WK-12, WK-13, WK-14 and WK-15 are still open and are carried into the backlog.
