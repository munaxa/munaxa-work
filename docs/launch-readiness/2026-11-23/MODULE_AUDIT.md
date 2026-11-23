# Module audit

Baseline `61c115b`. Every status below was taken from the code, not from `docs/PHASES.md`. Route
counts are the `@Get/@Post/@Put/@Patch/@Delete` decorators in each module's `src/api`; "writes" are the
non-GET ones. "Screen" means a page under `apps/admin/src/app/`. Test counts are files under the
module (`*.test.ts`, of which `*.integration.test.ts` run against PostgreSQL). All of these suites
passed in CI run [44901535832](https://github.com/munaxa/munaxa-work/actions/runs/44901535832) on
`main` (21 Nov 2026); they were not re-run in this session (see TESTING_AND_QUALITY.md).

## Classification key

**Complete and verified** · **Implemented, not fully verified** · **Partially implemented** ·
**Backend only** · **Frontend only** · **Awaiting owner decision** · **Not implemented** ·
**Blocked**. A module whose API is complete but whose screens are read-only is classed **Backend
only** for anything a user must *do*, because no write can be made from a screen
(`apps/admin/src` has one client component, `shell/workspace-shell.tsx`, and no form, server action
or mutating request).

## Summary table

| #    | Module (phase)                         | Routes (writes) | Tests (integration) | Screen                                      | Actual status                                                     |
| ---- | -------------------------------------- | --------------- | ------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| 1    | Workforce identity (2)                 | 18 (14)         | 15 (3)              | **none**                                    | Backend only                                                      |
| 2    | Organization (3)                       | 38 (26)         | 14 (2)              | read-only page                              | Backend only (writes); read verified                              |
| 3    | People master registry (4)             | 30 (25)         | 12 (3)              | read-only list                              | Backend only (writes); read verified                              |
| 4    | Employee documents and expiry (4.1)    | 13 (8)          | 9 (4)               | types and reconciliation                    | Partially implemented: metadata only, no file bytes               |
| 5    | Employee letters (5.1)                 | 16 (9)          | 7 (4)               | templates, one issued letter                | Partially implemented: no rendered output                         |
| 6    | Employee relations (5.2)               | 19 (9)          | 20 (7)              | **none**                                    | Backend only                                                      |
| 7    | Assets and custody (5.3)               | 15 (8)          | 18 (5)              | list and detail                             | Partially implemented, awaiting owner decisions D-5.3-03/05/07/08/10 |
| 8    | Employment (5)                         | 18 (11)         | 9 (3)               | list and record                             | Backend only (writes); phase **awaiting owner approval**          |
| 9    | Recruitment (6)                        | 42 (30)         | 8 (3)               | lists, requisition and application detail  | Backend only (writes); hire saga verified by tests                |
| 10   | Onboarding (7)                         | 25 (17)         | 6 (2)               | reconciliation                              | Backend only                                                      |
| 11   | Attendance (8)                         | 34 (21)         | 11 (3)              | dashboard, configuration, day detail        | Backend only (writes); phase **awaiting owner approval**          |
| 12   | Leave (9)                              | 32 (17)         | 8 (3)               | dashboard, balances, request detail        | Backend only (writes)                                             |
| 13   | Compensation (10)                      | 36 (18)         | 8 (4)               | dashboard and configuration                 | Backend only (writes)                                             |
| 14   | Loans and advances (10.1)              | 0               | 0                   | none                                        | Not implemented                                                   |
| 15   | Payroll engine (11)                    | 28 (11)         | 9 (5)               | dashboard, run and result detail            | Implemented, not fully verified (generic only; see payroll file)  |
| 16   | Statutory and country packs (11.1)     | 0               | 0                   | none                                        | Not implemented (`packages/country-packs/src/index.ts` exports `{}`) |
| 17   | Offboarding and settlement (11.2)      | 0               | 0                   | none                                        | Not implemented                                                   |
| 18   | Benefits (12)                          | 0               | 0                   | none                                        | Not implemented                                                   |
| 19   | Medical and employee claims (12.1)     | 0               | 0                   | none                                        | Not implemented                                                   |
| 20   | Performance (13)                       | 49 (36)         | 17 (5)              | configuration, review and goal detail       | Backend only (writes)                                             |
| 21   | Engagement and surveys (13.1)          | 0               | 0                   | none                                        | Not implemented                                                   |
| 22   | Learning (14A; 14B not started)        | 38 (27)         | 21 (8)              | catalogue, attainment, compliance           | Backend only (writes); 14B not implemented                        |
| 23   | Career and succession (15)             | 40 (27)         | 27 (14)             | paths, succession, pools                    | Backend only (writes)                                             |
| 24   | Workflow and approvals (16A to 16E)    | 23 (13)         | 75 (42)             | approvals queue and instance, configuration | Implemented; adopted by Recruitment only; phase **awaiting owner approval** |
| 25   | Communications (17)                    | 0               | 0                   | none                                        | Not implemented (`RecordingNotificationPort` delivers nothing)    |
| 26   | Employee self-service (18)             | 0               | 0                   | bootstrap page                              | Not implemented                                                   |
| 27   | Manager self-service (19)              | 0               | 0                   | bootstrap page                              | Not implemented                                                   |
| 28   | Mobile applications (19.1)             | n/a             | 1 widget test       | bootstrap screen                            | Not implemented                                                   |
| 29   | Workforce intelligence (20)            | 0               | 0                   | module dashboards only                      | Not implemented (6 CSV-style `/export` reads exist)               |
| 30   | Governance, risk and compliance (21)   | 0               | 0                   | none                                        | Not implemented                                                   |
| 31   | Enterprise integrations (22)           | 0               | 0                   | none                                        | Not implemented                                                   |
| 32   | AI workforce intelligence (23)         | 0               | 0                   | none                                        | Not implemented (career mobility recommendations are rule-based)  |
| 33   | Enterprise operations (24)             | 0               | 0                   | none                                        | Not implemented                                                   |

No module is **Complete and verified** as a *product*: none can be operated from a screen. Ten
modules are close to complete **as APIs** and are verified by their suites.

## Cross-cutting facts behind every row

| Fact                                                                                                     | Evidence                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Authentication is Identity's; Work verifies ES256 tokens and checks the session by introspection         | `apps/api/src/identity/platform-token-authentication.ts`, `session-revocation.ts`, ADR-0080                                       |
| Permissions are exact `work:` grants, mapped one to one to 285 declared names; no wildcard               | `apps/api/src/identity/platform-grants.ts:58-135`; catalogue in sync with `munaxa-identity/artifacts/work-permissions.json` (0 differences, checked in this session) |
| 15 `*-own` permissions are declared; only `onboarding.task.complete-own` and `workflow.approval.read-own` are enforced by a handler | `grep` over `apps/api/src` and `packages/modules/*/src` (AUDIT_EVIDENCE.md §4)                                                    |
| No file storage adapter, no job scheduler, no notification delivery                                      | `apps/api/src/*/…composition.ts` comments ("no `StoragePort` adapter exists anywhere", "no `JobPort`"); `RecordingNotificationPort` |
| The admin is read-only                                                                                   | one `'use client'` file (`shell/workspace-shell.tsx`); no `<form>`, server action or non-GET request in `apps/admin/src`        |

## Module findings

Each entry gives: what the specification requires, what exists, evidence, tests, what is missing,
impact, severity, dependencies and the fix. Backlog IDs refer to MASTER_REMEDIATION_BACKLOG.md.

### 1. Workforce identity (Phase 2)

- **Spec:** tenant membership, invitations, portal access, employment links, delegation.
- **Exists:** 18 routes, 8 tables, membership resolution through a `SECURITY DEFINER` function owned by
  a non-login role (`app_bound_memberships_of`, verified in the migrated database), tenant binding to
  one Identity organisation (`tenant_platform_binding`, migration `20261112090000`).
- **Tests:** 15 files including `apps/api/src/tenancy/cross-tenant.postgres.spec.ts` and
  `token-tenant-isolation.spec.ts`.
- **Missing:** any screen (members, invitations, delegations); an invitation that results in an
  Identity account (there is no email delivery, MW-015); a tenant picker in the admin (MW-007).
- **Impact:** a tenant's members can only be added by script or API. **Severity:** Medium (MW-028).

### 2. Organization (Phase 3)

- **Spec:** structure of any depth, legal entities and country, cost centres, positions, calendars,
  tenant settings.
- **Exists:** 38 routes; legal entity carries country and currency (ADR-0035); calendars hold no
  built-in holiday ("Nothing in this file knows a single holiday",
  `packages/modules/organization/src/domain/organization-calendar.ts:27`). Tenant settings now read
  under RLS (WK-04 fixed, d3ba53b).
- **Missing:** write UI; Jordan working week and public holidays as data (MW-030).
- **Severity:** Critical as part of MW-011 (no write UI); Medium for calendars.

### 3. People master registry (Phase 4)

- **Exists:** 30 routes, effective-dated names, identifiers, duplicate detection by keyed digest
  (`PII_MATCH_SECRET`), merge, export.
- **Notes:** identifier values are stored in clear text (`person_identifier.value varchar(64)`,
  `prisma/schema.prisma:556`), protected by RLS and permissions only (MW-024). Erasure is not
  implemented (`docs/adr/0038-personal-data-protection.md:112`, MW-023).

### 4. Employee documents (Phase 4.1)

- **Exists:** types, identities, insert-only versions, verification, access trail, confidentiality
  applied in the query.
- **Missing:** the file itself. No storage adapter, no upload, download, malware scan or hash.
- **Severity:** High for Pilot (MW-014). **Dependency:** a storage decision (S3 per tenant prefix, or
  Munaxa Docs as the document store).

### 5. Employee letters (Phase 5.1)

- **Exists:** templates, immutable versions, requests, approval, issued letters with frozen snapshots.
- **Missing:** rendering to PDF, signature, delivery (MW-031).

### 6. Employee relations (Phase 5.2)

- **Exists:** violation catalogue, investigations, corrections, disciplinary ladder, 20 test files.
- **Missing:** any screen; attachments (no storage). **Severity:** Medium (MW-028).

### 7. Assets and custody (Phase 5.3)

- **Exists:** catalogue, custody lifecycle, ageing, offboarding clearance contribution (nothing consumes
  it because Offboarding does not exist).
- **Owner decisions open:** D-5.3-03, 05, 07, 08, 10 (incidents, liability, deductions, transfer,
  acknowledgement, waiver, condition scale) (MW-027).

### 8. Employment (Phase 5)

- **Exists:** lifecycle, assignment timeline, reporting lines, contracts, probation; `end_reason_code`
  on `employment` (`prisma/schema.prisma:880`).
- **Status:** ledger says **Awaiting approval** (MW-027).
- **Missing:** separation process and settlement (Offboarding, MW-019).

### 9. Recruitment (Phase 6)

- **Exists:** requisition to hire; the hire is a saga creating a Person and an Employment (ADR-0046);
  requisition approval is the only business decision routed through the Workflow engine.
- **Missing:** write UI, candidate portal, email to candidates.

### 10. Onboarding (Phase 7)

- **Exists:** plans, immutable versions, tasks, waivers, reconciliation; started by idempotent command
  (ADR-0050), so a hire does not start onboarding automatically unless someone runs it.
- **Missing:** write UI, task notifications, automatic start (needs MW-016).

### 11. Attendance (Phase 8)

- **Exists:** immutable punches, shifts, schedules, rosters, calculated day, corrections, payroll
  snapshot; overtime is published as **candidate** minutes only.
- **Status:** **Awaiting approval**. **Missing:** device or mobile punching, write UI, payable overtime
  (MW-021).

### 12. Leave (Phase 9)

- **Exists:** types, versioned policies, append-only ledger, balances, requests, self-approval refused,
  accrual and year-end as runs, `leave.payroll-period` contract consumed by Payroll.
- **Missing:** statutory entitlements (none ship, ADR-0060), employee request screen, notifications,
  scheduled accrual.

### 13. Compensation (Phase 10)

- **Exists:** plans, salary structure, components, effective-dated recurring and one-time amounts,
  GiST exclusion against overlap, integer minor units.
- **Missing:** write UI; employee view (`compensation.read-own` unenforced).

### 14. Loans and advances (Phase 10.1)

Not implemented: no table, route or screen (`grep -i loan prisma/schema.prisma` finds no model).
High for Pilot only if pilot customers lend to staff (MW-020).

### 15. Payroll engine (Phase 11)

See PAYROLL_JORDAN_READINESS.md. Generic engine implemented and tested; no statutory content, no
payslip document, no bank file, overtime unreachable.

### 16. Statutory and country packs (Phase 11.1)

Not implemented. `packages/country-packs/src/index.ts` is a bootstrap that "deliberately exports
nothing yet". `apps/api/src/payroll/payroll.composition.ts:93-95` wires `noCountryRules`, which returns
nothing for every country. A rule engine exists in `packages/kernel/src/rules/rule-engine.ts` but no
module uses it. Critical for Pilot (MW-010).

### 17. Offboarding and final settlement (Phase 11.2)

Not implemented (MW-019). The assets clearance contribution and `employment.end_reason_code` exist
with no consumer.

### 18 to 21. Benefits, medical claims, surveys, learning 14B

Not implemented. Roadmap items (MW-060 to MW-063). None blocks a pilot unless a pilot customer
contracts for it.

### 22 to 24. Performance, Learning 14A, Career

APIs complete and tested (Performance 49 routes, Career 27 test files); read-only screens. Not needed
for Internal Testing or a payroll-and-HR pilot beyond basic goals and reviews.

### 25. Workflow and approvals (Phase 16A to 16E)

- **Exists:** definitions, versions, groups, sequential and parallel steps, quorum, conditions,
  delegation, manager routing, service levels, escalation, an automatic reminder; append-only decision
  and history tables enforced by triggers; 75 test files.
- **Adoption:** only Recruitment requisitions route through it (`docs/modules/workflow.md`,
  "Recruitment is the single adopted business module"). Leave, payroll, letters and compensation keep
  their own single-step approval. The kernel `ApprovalPort` is implemented and unwired.
- **No runner:** escalation and reminders are executed only when an endpoint is called (no `JobPort`).
- **Status:** **Awaiting approval**. **Severity:** High for Pilot (MW-016, MW-017).

### 26 to 28. Communications, self-service, mobile

Not implemented. Portals are a single bootstrap card each (`apps/employee-portal/src/app/page.tsx`);
mobile is `apps/mobile/lib/main.dart` only. High for Pilot (MW-013, MW-015).

### 29 to 33. Intelligence, GRC, integrations, AI, enterprise operations

Not implemented. Roadmap (MW-064 to MW-069), except that a pilot needs at least a payroll export the
customer's bank accepts (MW-018) and an audit view (MW-026).

## Architecture overview and technical risks

```text
Browser ──► ALB work.<env> ──► /api/auth/*  Identity (sign-in, refresh, introspect)
                          ├──► /api/v1/*    work-api (NestJS, 18 modules, CQRS dispatcher)
                          └──► /*           work-admin (Next.js, server-rendered, read-only)
work-admin ──HTTP (VPC, Cloud Map)──► work-api
work-api ──► PostgreSQL work database as work_app (NOBYPASSRLS, FORCE RLS on all 188 tables)
work-api ──► Identity /api/auth/introspect (every request, 5 s cache, fail closed)
work-api ──► Control /api/v1/licensing (LICENSING_MODE=CONTROL_PLANE)
```

Strengths: module-first layout with lint-enforced layer direction (`scripts/check-architecture.mjs`,
`tooling/eslint/standards.mjs`), no dependency cycles (`check-dependencies.mjs`: 2,082 files), one
permission checker, fail-closed tenancy, bounded service grants for cross-module acts (ADR-0043).

| Risk                                                                                                                         | Backlog         |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------- |
| The product surface is far thinner than the domain: 517 routes, 0 write screens                                              | MW-011          |
| Three platform adapters every HR product needs do not exist: storage, scheduling, notification delivery                     | MW-014 to 016   |
| The Workflow engine and the per-module approvals are two parallel approval systems                                           | MW-017          |
| Authorization lives in the access token, which a browser cookie caps far below the catalogue                                 | MW-012          |
| The Prisma schema is not the source of truth (SQL migrations are), and nothing stops a tool from treating it as one          | MW-008          |
| Statutory logic has an interface but no implementation and the interface lacks the inputs Jordanian rules need              | MW-010          |
| The kernel rule engine is unused, so the specification's "rules as configuration" (12A AD-006) has no working precedent      | MW-010          |
| `@munaxa/*` packages need a GitHub Packages token; agent sessions get 401 and cannot run the gate locally                    | MW-033          |
| Redis is declared in configuration and docker-compose but no code uses it; `/health` reports it "up" whenever the URL is set | MW-050          |

No duplicate implementations of the same capability were found beyond the two approval paths above.
`check-dependencies.mjs` reports no unused dependencies and no unreachable files, so dead code is not a
material issue.
