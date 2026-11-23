# Multi-agent execution plan

Built from the findings in MASTER_REMEDIATION_BACKLOG.md, not from a fixed number of agents. The plan
has two implementation waves, a set of owner decisions that gate them, and a strict file ownership
matrix so no two agents edit the same file without knowing it.

## 1. Recommendation in brief

| Wave                                  | Goal                                       | Implementation agents | Plus                                   |
| ------------------------------------- | ------------------------------------------ | --------------------- | -------------------------------------- |
| Wave 0 (owner, in parallel with Wave 1) | Decisions and research that gate the rest | 0                     | Lead prepares one decision card each   |
| Wave 1                                | Internal Testing (MW-001 to MW-009)        | **3**                 | Lead, independent QA/security verifier |
| Wave 2                                | Jordan Pilot (MW-010 to MW-034)            | **7 at peak**         | Lead, integration agent, verifier      |
| Wave 3                                | Production (MW-040 to MW-055)              | 2 to 3                | Lead, verifier                         |

Peak concurrency is 10 sessions (lead, integration, verifier, 7 implementers). More agents than this
would mostly collide on the same module folders.

## 2. Coordination model

| Role                         | Owns                                                                                                                                                                                                                                         | Never does                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Lead (orchestrator)**      | Task assignment by MW-ID, dependency tracking, interface contracts (§6), the migration slot register (§5), owner decision cards, conflict resolution, final acceptance of each MW-ID, the progress report in `munaxa-platform` agent-reports | Writes feature code                                |
| **Implementation agents**    | Exactly the files in their row of §4; one PR per MW-ID (or per tightly coupled pair); tests with the change                                                                                                                                  | Edits a file owned by another workstream           |
| **Integration agent (WS-11)** | Merge order, rebases, `pnpm-lock.yaml`, root `package.json`, `apps/api/src/app.module.ts`, `docs/PHASES.md`, README, ARCHITECTURE, release notes, full CI after each merge                                                                     | Changes behaviour to make a merge pass             |
| **QA/security verifier (WS-12)** | Independent review of each PR's exact head against its acceptance criteria; security review of auth, tenancy, payroll and privacy PRs; runs E2E and smoke in Testing when sessions exist                                              | Reviews its own code (it writes none)              |

Rules for every agent:

1. Work from `main`; one branch and one PR per MW-ID; title starts with the ID.
2. A PR is mergeable only with all required checks green, verifier APPROVE on the exact head, and no
   Critical or High finding open in the PR itself (the owner's standing merge rule). PRs that touch AWS,
   secrets, images, Terraform apply or production need the owner's explicit approval.
3. No suppression (`eslint-disable`, `@ts-ignore`, `any`): the repository's standards gate refuses them.
4. Never run `prisma migrate dev`, `db push` or `migrate reset` against anything shared (MW-008).
5. Never invent a statutory value; payroll rules come only from the signed research (WS-8).
6. No real personal data in tests, fixtures, seeds, logs or reports.

## 3. Owner decisions (Wave 0)

| ID      | Decision                                                                                       | Blocks                    | Lead's recommendation                                              |
| ------- | ---------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| D-W1    | Extend the Testing-only OpenSSL exception to Work, or wait for 3.5.10 (MW-001)                 | Work image                | Wait if Alpine ships within days; otherwise extend (Testing only)  |
| D-W2    | GitHub Packages read grant for agent sessions (MW-033)                                         | Local gates for all agents | Grant before Wave 1                                                |
| D-W3    | Approve or reject Phases 5, 8, 16 and decisions D-5.3-03/05/07/08/10 (MW-027)                  | WS-5, WS-7                | Approve phases as built; decide D-5.3 items per pilot need         |
| D-W4    | Commission Jordanian payroll, labour and data protection research (PAYROLL file §4)            | WS-8, MW-023, MW-030      | Start now; it is the longest lead time                             |
| D-W5    | Storage: S3 adapter or Munaxa Docs as the store (MW-014)                                       | WS-6 storage              | S3 adapter with per-tenant prefix (simplest, no cross-product call) |
| D-W6    | Email provider and sending domain (MW-015)                                                     | WS-6 notifications        | The provider Docs already uses, to avoid a second one              |
| D-W7    | Authorization ADR: server-side grant resolution (MW-012)                                       | WS-2 Wave 2               | Approve server-side resolution through introspection               |
| D-W8    | Overtime: reverse ADR-0065 with an approval step (MW-021)                                      | WS-8                      | Approve                                                            |
| D-W9    | Pilot scope: loans (MW-020) and mobile (MW-064) in or out                                      | WS-8, WS-9                | Loans in only if a pilot customer needs them; mobile out            |

## 4. Workstreams

### WS-1 · Release, AWS and operations

- **Mission:** make Work deployable and observable on the shared stack.
- **Scope:** MW-001, MW-002, MW-005, MW-009 (Wave 1); MW-040, MW-041, MW-042, MW-043, MW-050, MW-053,
  MW-054 (Wave 3).
- **Files owned:** `.github/workflows/*`, `.github/scripts/*`, `apps/api/Dockerfile`,
  `apps/admin/Dockerfile`, `deploy/aws/*`, `scripts/bootstrap-tenant.mjs`, `apps/api/src/health/*`;
  in `munaxa-platform`: `infra/aws/stack/envs/nonprod.*`, `infra/aws/stack/dssl-exception.tf` (Work
  entries only), `scripts/aws/owner/work-*`, `scripts/aws/connector/e1-task-guard.py` (Work families).
- **Deliverables:** green Images job or scoped exception; pin PR; guarded bootstrap; CI-green check in
  publish; runbook for the first Work session; Wave 3 alarms, restore drill, load test.
- **Depends on:** D-W1. **Shares:** `deploy/aws/README.md` with WS-3 (smoke section, WS-3 writes it by
  PR to WS-1's branch or after it merges).
- **Acceptance:** AWS_TESTING_READINESS.md steps 1 to 10 complete; first session smoke green; nothing
  left running.
- **Tests:** workflow dry runs on a branch; Terraform `test` (mocked) in platform CI; guard unit tests.
- **Parallel:** yes. **Separate PRs:** yes, per repository. **Owner approval:** yes for every publish,
  secret and apply.

### WS-2 · Identity and authorization (cross-repository)

- **Mission:** usable roles now, a scalable authorization model for the pilot.
- **Scope:** MW-003, MW-007 (Wave 1); MW-012, MW-022, MW-034 (Wave 2).
- **Files owned:** `munaxa-identity/apps/api/scripts/seed-work-roles.mjs`,
  `munaxa-identity/packages/testing/src/token-size.integration.test.ts`, `munaxa-identity/artifacts/*`;
  `munaxa-work/apps/api/src/identity/*`, `apps/api/src/tenancy/*`,
  `packages/config/src/platform-authentication.ts`, `packages/config/src/platform-revocation*.ts`,
  `apps/admin/src/shell/platform-session.ts` (Wave 1 only, then handed to WS-5A).
- **Interface published:** the permission catalogue (§6.1) and the MFA requirement marker (§6.2).
- **Acceptance:** persona roles fit under 75% of the cookie limit and cover all 285 grants; session
  survives 60 minutes; after D-W7, a role with every grant works.
- **Tests:** Identity token-size test; Work authorization and tenancy suites; new MFA refusal tests.
- **Parallel:** yes. **Owner approval:** ADR D-W7.

### WS-3 · QA tooling, test data and end-to-end tests

- **Mission:** let people and agents test Work without a write UI, then cover the UI end to end.
- **Scope:** MW-004, MW-006 (Wave 1); MW-032 (Wave 2, then handed to the verifier to run).
- **Files owned:** new `tooling/testing-data/**`, `tooling/smoke/**`, `tooling/e2e/**`, a generated
  `docs/api/openapi.json` with its generator script under `scripts/`.
- **Acceptance:** dataset loads idempotently; smoke exits non-zero on failure and prints no token;
  E2E covers workflows A to J once their screens exist.
- **Parallel:** yes. **Owner approval:** no (repository only); running in Testing rides on a session.

### WS-4 · Database and migrations

- **Mission:** keep the schema safe while several agents add tables.
- **Scope:** MW-008 (Wave 1, combined with WS-3 in one agent); MW-044, MW-052 (Wave 3); the migration
  slot register for everybody.
- **Files owned:** `prisma/schema.prisma` structure and conventions, `prisma/README`, the drift gate
  script, `deploy/aws/runtime-grants.sql`. Each module's new migration directory is written by the
  module's owner using a slot the lead allocates (§5).
- **Acceptance:** CI fails a Prisma-generated migration; drift report can only shrink.
- **Parallel:** yes.

### WS-5A · Admin UI: patterns and workforce modules

- **Mission:** the form pattern every screen uses, then workforce write screens.
- **Scope:** MW-011 (part), MW-028, MW-029, Arabic review fixes from MW-030.
- **Files owned:** `apps/admin/src/shell/**` (from Wave 2), `apps/admin/src/app/layout.tsx`, new
  `apps/admin/src/forms/**`, `apps/admin/locales/*`, and `apps/admin/src/{people,employment,organization,recruitment,onboarding,documents,letters,workflow}/**`
  plus new `relations/` and `identity/` folders and their `app/` routes.
- **First deliverable (blocks WS-5B and WS-9):** the form pattern PR (server action or route handler
  forwarding the session, problem details mapped to fields, 401, 403 and 409 handling, CSRF-safe).
- **Acceptance:** workflows A to D completable in the browser.
- **Parallel:** yes after the first PR.

### WS-5B · Admin UI: operations and talent modules

- **Scope:** MW-011 (part).
- **Files owned:** `apps/admin/src/{approvals,attendance,leave,compensation,payroll,assets,performance,career,learning}/**`
  and their `app/` routes, and the matching `packages/modules/*/locales/*` entries for UI strings.
- **Depends on:** WS-5A form pattern; WS-7 for approval decide screens; WS-8 for payroll statutory
  display.
- **Acceptance:** workflows E to I completable in the browser.

### WS-6 · Platform adapters

- **Scope:** MW-014 storage, MW-015 notifications, MW-016 scheduler, MW-031 letter rendering.
- **Files owned:** new `apps/api/src/adapters/**` (one folder per adapter), adapter ports in
  `packages/kernel/src/ports/*` (additive only), `packages/config/src/environment.ts` (new variables,
  coordinated through §6.4), Terraform for the bucket, queue or schedule (through WS-1 by PR).
- **Interface:** each adapter exported as a Nest provider under an existing kernel token; compositions
  consume the token. WS-6 edits compositions only for modules not owned by WS-7 or WS-8 (documents,
  letters, performance, learning, onboarding, recruitment notifications).
- **Depends on:** D-W5, D-W6. **Owner approval:** yes for AWS resources.
- **Acceptance:** upload/scan/download with tenant isolation; email in Testing; jobs idempotent.

### WS-7 · Approvals adoption

- **Scope:** MW-017.
- **Files owned:** `packages/modules/workflow/**`, `apps/api/src/workflow/**`, and the approval seam
  files in `packages/modules/{leave,letters,compensation}/src/application/*approval*` and
  `*decide*`, plus `apps/api/src/{leave,letters,compensation}/*.composition.ts`.
- **Interface published:** the approval-id seam pattern (§6.3), which WS-8 then applies to payroll.
- **Depends on:** WS-6 notifications and scheduler for reminders and escalation (can merge without
  them and switch on later).
- **Acceptance:** leave, letters and compensation decisions route through Workflow with delegation and
  service levels.

### WS-8 · Payroll and Jordan statutory

- **Scope:** MW-010, MW-018, MW-019, MW-020, MW-021, MW-030 (statutory data).
- **Files owned:** `packages/country-packs/**`, `packages/modules/payroll/**`,
  `apps/api/src/payroll/**`, new modules `packages/modules/offboarding/**` and
  `packages/modules/loans/**` with their `apps/api/src/*` folders; overtime approval in
  `packages/modules/attendance/src/application/*overtime*` (new files only).
- **Gate:** may build the port extensions, data model and test harness before research arrives; may
  **not** encode any Jordanian value until D-W4 delivers signed sources.
- **Acceptance:** PAYROLL_JORDAN_READINESS.md §5.
- **Owner approval:** research sign-off; ADR-0065 reversal (D-W8).

### WS-9 · Employee and manager self-service

- **Scope:** MW-013.
- **Files owned:** `apps/employee-portal/**`, `apps/manager-portal/**`, and **new files only** in modules:
  `packages/modules/*/src/application/*self-service*.ts`, `packages/modules/*/src/api/*self-service*.controller.ts`.
  Registration of those files in each module's `index.ts` or module class is a one-line change that
  the module's owning workstream reviews.
- **Depends on:** WS-5A pattern, WS-8 payslip document, WS-6 storage. Adds a Dockerfile and stack
  entries for the employee portal through WS-1.
- **Acceptance:** an employee sees only their own payslips, balances, requests and documents; a
  manager decides their team's approvals.

### WS-10 · Security and privacy

- **Scope:** MW-023, MW-024, MW-025, MW-026, MW-051.
- **Files owned:** `apps/api/src/application.setup.ts`, `apps/api/src/main.ts`,
  `apps/api/src/observability/**`, `apps/admin/next.config.mjs`, new `packages/modules/*/src/**/*access-event*`
  files for read logging, new `apps/api/src/privacy/**`.
- **Depends on:** D-W4 legal research for retention and encryption decisions.
- **Acceptance:** headers and rate limits verified on a deployed response; read events for payroll,
  compensation and identifiers; per-person export and anonymisation tested.

### WS-11 · Integration (also documentation)

Owns the shared files in §5, MW-055, `docs/PHASES.md`, `docs/RELEASE_NOTES.md`, README and
ARCHITECTURE. Merges in dependency order, reruns the full gate after each merge, and reports conflicts
to the lead.

### WS-12 · Independent QA and security verification

Reviews every PR's exact head against its MW acceptance criteria, writes a short verdict
(APPROVE or CHANGES), and re-runs smoke and E2E in each Testing session. Holds veto on auth, tenancy,
payroll and privacy changes.

## 5. Shared files and conflict rules

| Shared file or area                                     | Single owner                 | Rule for everyone else                                                                                 |
| ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` | WS-11            | Ask the lead; dependency changes land as their own small PR first                                      |
| `prisma/schema.prisma`                                  | WS-4 (conventions)           | Each workstream edits only its own module's models; one PR at a time per module                        |
| `prisma/migrations/<timestamp>_*`                       | lead's slot register         | Use the allocated timestamp; never renumber; never edit a merged migration                             |
| `apps/api/src/app.module.ts`                            | WS-11                        | New modules (offboarding, loans, adapters) registered by the integration agent on merge                 |
| `apps/api/src/<module>/*.composition.ts`                | WS-7 (leave, letters, compensation), WS-8 (payroll, attendance overtime), WS-6 (others) | Others propose by PR comment                                                     |
| `apps/api/src/identity/work-permission-catalogue.ts` and Identity's `artifacts/work-permissions.json` | WS-2 | New permissions are requested from WS-2, which regenerates the artifact and the persona roles      |
| `packages/config/src/environment.ts`                    | WS-6 for adapter variables, WS-2 for auth variables | Append-only; WS-11 resolves conflicts                                                 |
| `packages/kernel/**`                                    | lead approval required       | Additive changes only                                                                                  |
| `apps/admin/src/shell/**`, `apps/admin/locales/*`        | WS-5A                        | Navigation entries requested from WS-5A                                                                |
| `packages/modules/*/locales/*`                          | the UI workstream for that module | Server-side vocabulary changes by the module's backend owner, coordinated in the same PR              |
| `.github/workflows/*`                                   | WS-1                         |                                                                                                        |
| `docs/PHASES.md`, README, ARCHITECTURE, `docs/adr/*`     | WS-11 (ADRs written by the deciding workstream, numbered by the lead) |                                                              |
| `munaxa-platform/infra/**`                              | WS-1                         |                                                                                                        |
| `munaxa-identity/**`                                    | WS-2                         |                                                                                                        |

## 6. Interface contracts the lead fixes before Wave 2

1. **Permission catalogue:** every new permission name follows the module's existing pattern, is added
   to the module's `*-permissions.ts`, and appears in Identity's artifact in the same release.
2. **MFA marker:** a declarative list of permissions that require `mfa=true`, checked by the single
   permission checker; no per-handler checks.
3. **Approval seam:** a module's decide command accepts an optional `approvalId`, refuses a different
   approval, and Workflow asks the module first (as Recruitment does today).
4. **Configuration:** new variables are optional with a refusing default in production where a missing
   value would be unsafe (the existing `refineEnvironment` pattern).
5. **Statutory port:** `CountryRuleInput` gains `yearToDate`, `person` and a rule-source handle; the
   change ships with `noCountryRules` still passing every existing test.

## 7. Execution order

```text
Wave 0 (owner)   D-W1 D-W2 D-W3 D-W4 D-W5 D-W6 D-W7 D-W8 D-W9  ─────────────────────────────►
Wave 1           A: WS-1  MW-009 → MW-001 → MW-002 → MW-005 → first Work Testing session
                 B: WS-2  MW-003 → MW-007
                 C: WS-3+4 MW-008 → MW-006 → MW-004
                 verifier: reviews each; runs smoke in the first session
Wave 2           WS-5A form pattern ─┬─► WS-5A workforce screens
                                     ├─► WS-5B operations screens
                                     └─► WS-9 self-service (after WS-8 payslip, WS-6 storage)
                 WS-6 storage, notifications, scheduler ─► WS-7 approvals adoption
                 WS-2 MW-012 (after D-W7) ─► MW-022 MFA ─► MW-034
                 WS-8 port extensions now; Jordan pack after D-W4 ─► MW-019, MW-018, MW-021, MW-020
                 WS-10 headers, audit, privacy (privacy after D-W4)
Wave 3           WS-1 monitoring, DR, load; WS-4 tenant lifecycle; lows
```

Wave 1 has no internal blocking except MW-002 after MW-001. The first Work Testing session needs all
nine Wave 1 items plus the owner steps in AWS_TESTING_READINESS.md.

## 8. Acceptance for the whole operation

| Stage            | Measurable exit criteria                                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal Testing | `main` CI green including Images; Work running in a Testing session; smoke script green; synthetic dataset loaded; each persona reaches its key routes; session down and verified    |
| Jordan Pilot     | Workflows A to J pass as browser E2E; Jordan golden cases pass and are signed off; two-month parallel run explained; MFA enforced on marked permissions; privacy policy and tooling signed off; email, storage and scheduler running in Testing |
| Production       | Alarms and on-call runbook; restore drill passed with recorded times; load test at target size; support tooling and legal terms in place                                              |

## 9. Ambiguities resolved in this plan

- MW-007 sits with WS-2 in Wave 1 (it is session plumbing) and `apps/admin/src/shell` moves to WS-5A
  at the start of Wave 2.
- MW-022 sits with WS-2 because the permission checker is in its files; WS-10 does not touch
  `apps/api/src/identity`.
- Payroll's approval adoption is done by WS-8 using WS-7's published seam, so WS-7 never edits the
  payroll package.
- Self-service handlers are new files owned by WS-9; module owners review the one-line registration.
