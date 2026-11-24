# Wave 2 execution plan: Munaxa Work to its first controlled internal Testing session

**Date:** 24 November 2026 · **Goal:** a first Work session in the existing AWS Testing stack
(`munaxa-nonprod`, eu-central-1) that passes the MW-006 smoke test, then `down`. Not Pilot, not
Production.

This plan uses only approved architecture and runbooks: the Testing stack and gates in
`munaxa-platform/infra/aws/README.md`, the MW-002 pin package
(`agent-reports/2026-11-23-work-testing-pin-package/`), the audit's ordered path
(`agent-reports/2026-11-23-work-launch-readiness-audit/AWS_TESTING_READINESS.md`, steps 3 to 10), the
E-1 task guard and the session `up`/`down` workflows. Nothing here changes an approved decision.
Every AWS, Terraform, image, secret, GitHub environment, DNS or IAM step is **owner-gated** and marked
**[O]**; Claude verifies each one afterwards with read-only access only (**[V]**). The owner is never
asked to type a command beyond the existing CloudShell procedure already approved for secrets.

## 1. Remaining repository blockers

| #   | Item                                                                  | Blocks Testing? | Owner of the work |
| --- | --------------------------------------------------------------------- | --------------- | ----------------- |
| R-1 | MW-001 bump PRs (work#35, identity#24, control#13 with its conflict resolved, docs#182) re-run and merged once 3.5.10-r0 exists | **Yes** | Claude, then [O] merge under the standing rule if green |
| R-2 | Built-app browser test for the Work admin in CI (`next build` + `next start` + the existing browser test) | No (hand-checked) | Claude |
| R-3 | D-SSL exception removal PRs (identity, control, docs, platform `image-exception-guard`) after every Testing image runs on 3.5.10 | No for Work (Work is not covered); yes for closing D-SSL | Claude, [O] merges |
| R-4 | NF-3: `@munaxa/security` burst-boundary refusal (9 of 10) and platform CI red on `main` | No | Claude; a fix needs a platform release [O] |
| R-5 | work-api-only pin PR after Control issues Work's credential (1 replacement) | Yes, for licensed requests | Claude, [O] merge |

## 2. CI and security evidence required before any publish

- `munaxa-work` `main` CI fully green **including Images** for the exact commit to publish (MW-009
  enforces it; the `CI` push run must be the latest for that SHA).
- Grype: 0 HIGH and 0 CRITICAL on api, migrate and admin with the permanent gate (no exception; Work
  is not in D-SSL). SBOMs kept in the run artifact.
- `verify-image.sh`: zlib and OpenSSL versions exact, non-root user, Prisma engine loads, no
  credential in layers, RDS CA bundle present.
- For Identity, Control and Docs: the same on 3.5.10 before the exception is removed.

## 3. OpenSSL remediation sequence (the day Alpine publishes 3.5.10-r0)

1. Claude re-runs work#35's CI (and #24, #13, #182). The `apk add` must succeed and the scan must
   show 0 HIGH. control#13 is first merged with `main` (keep `main`'s comment, take `3.5.10-r0`).
2. Claude rebases each bump on `main`, marks it ready, and merges under the standing merge rule
   when every required check, Images included, is green.
3. Claude confirms the `main` CI run of munaxa-work is fully green (this is MW-001's acceptance).
4. Exception removal (R-3) only after every Identity, Control and Docs Testing image has been
   republished on 3.5.10 and scans clean; until then the exception stays exactly as merged and
   expires at 2026-12-01T00:00:00Z.
5. If 3.5.10-r0 is still unavailable on 1 Dec 2026 00:00 UTC: image-dependent steps stop and the
   owner is asked for a new MW-001 decision. No option is pre-selected; the exception is not extended.

## 4. Image publication owner actions

| Step | Who | Action | Verification |
| ---- | --- | ------ | ------------ |
| P-1 | [O] | Approve the `image/*` tag ruleset (if not done) | [V] ruleset listed |
| P-2 | [O] | Create the pre-release tag `image/<40-hex sha>` on the green `main` commit (Claude sends the exact link) and approve the `image-release` environment for the run | [V] the gate step accepts the SHA, the three Push summaries give digests, ECR scan on push shows 0 HIGH/CRITICAL |
| P-3 | [O] | Same for Identity, Control and Docs if their bump merged (they are already in Testing on 3.5.9-r1 under D-SSL) | [V] as above |

The withdrawn `b490b25` Work images are never pinned.

## 5. Work Testing pin PR (MW-002 W-3 to W-5a)

Claude prepares the pin PR exactly as in `01-PIN-PR.md`: `images.work_api`, `images.work_admin`,
`images.work_migrate` by digest; `secret_version_ids.work-api` and `.work-migrate`;
`db_bootstrap_products += work`; `desired_counts` unchanged at 0; `services_enabled` unchanged; the
E-1 `munaxa-nonprod-work-migrate` family un-pended with the same image and version; the expected-changes
declaration of 29 changes. Requirements before it can merge: real digests from P-2, the two version
ids from **W-4 [O]** (owner's CloudShell procedure, checksum `183e5723…3a02`, `CONTROL_PLANE_TOKEN`
left as the marked placeholder), stack tests green, `check-plan-intent.sh --validate` green.

## 6. Terraform plan and apply gates

| Gate | Who | What must be true |
| ---- | --- | ----------------- |
| W-6 plan | [O] dispatch `aws-terraform.yml` plan `nonprod` with the session down | "The plan matches the declared changes exactly (29)": 28 add, 1 replace (db-admin), 0 destroy; no `aws_ecs_service`, no `aws_lb*` |
| W-7 apply | [O] approve the apply and the `aws-nonprod` environment | [V] post-apply plan "No changes"; three Work task definitions with pinned digests and `::<version>` secrets; `LICENSING_MODE=CONTROL_PLANE`, `PLATFORM_AUTH_ISSUER=https://id.test.munaxa.com`; nothing running |

## 7. First controlled Testing session sequence (session 1)

Every step is one owner approval card; Claude runs nothing outside approved workflows and E-1.

1. [O] Session `up` with Identity, Control and Work services (services off again at `down`).
2. [O] db-admin run that creates Work's roles and database (`db_bootstrap_products` includes `work`).
3. [O] E-1 `munaxa-nonprod-work-migrate` default command: SQL migrations, exit 0 [V logs metadata].
4. [O] Identity: seed the Work roles and the eight Testing personas
   (`seed-work-roles.mjs --testing-personas --environment testing`), create persona accounts, restart
   Identity. The operator account is only ever `IDENTITY_OPERATOR_EMAIL`.
5. [O] E-1 `bootstrap-tenant-dry-run` with the organisation id confirmed in Identity; Claude reads the
   output; then [O] `bootstrap-tenant`.
6. Smoke test MW-006 (readiness through rule 49). In session 1 licensing is not yet issued, so the
   `entitlements` probe is expected to fail with "Entitlements could not be confirmed"; the run is
   recorded as **partial**, not green.
7. [O] Control: create Work's deployment and issue its licensing credential.
8. [O] `down`. [V] no task running, scheduled cleanup idle.

## 8. Identity and Control dependencies

- Identity must already run in Testing on its pinned image (Stage E done 21 Nov) with MFA key and
  `IDENTITY_PASSWORD_RESET` configuration as pinned; persona seeding needs the identity bootstrap E-1
  family. If Identity is republished on 3.5.10, its pin PR comes first.
- Control must be deployed in Testing (Apply 2 pin, C-2 licence key) to issue Work's credential;
  Control's own session follows its runbook.

## 9. Licensing credential issuance and replacement (between sessions)

1. [O] In the owner's CloudShell procedure: `work-testing-secrets.sh replace-key CONTROL_PLANE_TOKEN`
   with the credential Control issued; paste back only the new version id.
2. Claude: work-api-only pin PR (R-5): one replacement of the work-api task definition. [O] merge.
3. [O] plan (1 replace) and apply, services off. [V] task definition reads the new version.
4. Control: link the Work tenant id as `tenantRef` with a subscription.

## 10. Session 2 and smoke-test acceptance

Session 2: [O] `up`; smoke test; [O] approve the MW-004 loader run against
`https://work.test.munaxa.com`; one payroll calculation with the loader's data (MW-072 evidence);
recruiter persona document upload and verify (open Low); [O] `down`.

**Acceptance (all required):** smoke exit **0** with all eight probes PASS (readiness, unauthenticated
401, persona read, forbidden 403, entitlements, admin signed in, cross-tenant refusal, logout
revocation); no token or secret in the log; loader log shows creates on the first run and 0 creates
on a rerun; ALB target groups healthy for work-api and work-admin; no 5xx in the session beyond the
expected entitlements refusals of session 1.

## 11. Shutdown and cost-control verification

- `down` after every session; [V] `ListTasks` empty, services at 0, RDS stopped as configured.
- The 21:00 UTC backstop and the scheduled cleanup stay on; [V] their next run succeeds.
- Expected extra cost: about US$0.04 an hour per session for Work (two Fargate tasks and two public
  IPv4). Task definitions, roles, log groups and secrets cost nothing at rest (secrets about US$0.40
  each per month). The monthly budget alarms stay as configured.

## 12. Rollback and recovery

| Situation | Response |
| --------- | -------- |
| Migration fails | `down`; nothing is served. Fix forward with a new migration (merged migrations are immutable); re-run E-1 in the next session. RDS snapshots follow the stack's existing policy. |
| Bootstrap guard refuses | Nothing was written (the guard runs before any write). Correct the input, re-run the dry run. |
| Smoke fails | `down`; record the probe and status only; fix in a PR; next session. |
| Bad image | Revert the pin PR to the previous `images` (none for Work: remove the Work pins), plan and apply with services off. Never pin `b490b25`. |
| Wrong secret version | `replace-key` with the correct value, version-only pin PR, plan and apply. |
| Unexpected cost or anything left running | `down`, then the scheduled cleanup; [V] by read-only listing. |

## 13. Proposed order and timing

| Day | Work |
| --- | ---- |
| Before 3.5.10 | R-2, R-4 in the repositories; owner GitHub settings (ruleset, CODEOWNERS, branch deletions); AWS connector sign-in |
| 3.5.10 day | Section 3, then P-1 to P-3 |
| Same or next day | W-4, pin PR, W-6, W-7 |
| Session 1 | Section 7 |
| Between | Section 9 |
| Session 2 | Section 10; Work's Testing verdict becomes READY only if the acceptance holds |
