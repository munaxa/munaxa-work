# Munaxa Work: Wave 1 closure and verification report

**Date:** 24 November 2026, 03:20 to 04:30 UTC · **Follows:**
[`2026-11-23-wave1/`](../2026-11-23-wave1/) (unchanged) and the audit
[`2026-11-23/`](../2026-11-23/) (unchanged) · **Wave 2 plan:**
[01-WAVE2-EXECUTION-PLAN.md](01-WAVE2-EXECUTION-PLAN.md) · **Platform copy:**
`munaxa-platform/docs/aws-migration/agent-reports/2026-11-24-work-wave1-closure/`

Status labels: **VERIFIED** (checked in this pass against the live repositories, CI or package
repositories), **BLOCKED** (waiting on something no repository change can remove), **OWNER ACTION**
(the next step is an owner approval), **NOT VERIFIED** (could not be checked in this pass; the reason
is given).

## 1. Executive summary

- **Wave 1 verdict: CLOSED in the repositories, with MW-001 BLOCKED and MW-002 OWNER ACTION.**
  The independent re-check found the Wave 1 implementation as reported: MW-003 to MW-009 and MW-070
  to MW-075 are in `main` and their gates run in CI. Two new gaps were found and fixed (section 6).
- **OpenSSL 3.5.10: NOT AVAILABLE (BLOCKED).** At 03:21:44 UTC an `apk add` of
  `libssl3=3.5.10-r0 libcrypto3=3.5.10-r0` inside the exact pinned base
  (`node:22-alpine@sha256:1314fb30…88481a`, Alpine 3.24) failed with "unable to select packages"
  (re-run of work#35's CI, run 44908264859 attempt 2, job 138192461552). Alpine's `aports` source
  for `main/openssl` on both `3.24-stable` and `master` is still `pkgver=3.5.9`, `pkgrel=1`. The
  D-SSL exception, its expiry and the Grype gates are unchanged.
- **Work is NOT READY for AWS Testing.** Repository implementation is complete for the Testing
  scope (A), CI is green on every required job but the Images job fails on OpenSSL (B partial), no
  image is publishable (C), the AWS pin is prepared but not applied (D), and no Testing session has
  run (E).
- **Changes in this pass (repository only):** munaxa-work#53 (migration gate: shell expansion,
  `--schema`, command files, nested manifests), munaxa-platform#170 (the `@munaxa/rbac` timing
  flake), and this report with a correction to the smoke-test README. No AWS call was made (the
  read-only connector needed a new sign-in, section 9), nothing was applied, published, rotated or
  changed in GitHub settings.

## 2. Repository HEADs at the start of this pass (fetched 03:20 UTC)

| Repository      | Default branch | HEAD        | Committed (UTC)  | Subject                                              |
| --------------- | -------------- | ----------- | ---------------- | ---------------------------------------------------- |
| munaxa-work     | `main`         | `22ba70e`   | 24 Nov 01:10     | Wave 1 execution report (#51)                        |
| munaxa-platform | `main`         | `cd83cf3`   | 24 Nov 01:07     | Wave 1 execution report (#169)                       |
| munaxa-identity | `main`         | `55def2c`   | 23 Nov 22:31     | MW-003 Testing persona roles (#27)                   |
| munaxa-control  | `main`         | `744765d`   | 22 Nov 14:50     | pin actions to commit SHAs (#12)                     |
| munaxa-docs     | `main`         | `9348aab`   | 22 Nov 15:15     | go-live runbook correction (#178)                    |

work#51 (`22ba70e`) and platform#169 (`cd83cf3`) are **merged (VERIFIED)**. No code change landed in
any of the five repositories after those report commits and before this pass.

## 3. Pull requests inspected

| PR                    | State at 03:20 UTC | Finding                                                                                                                          |
| --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| munaxa-work#35        | Draft, open        | Still relevant: pins `libssl3`/`libcrypto3` `3.5.10-r0` in api and admin and the verifier. 17 commits behind `main`, merges cleanly. CI fails at `apk add` (not published). |
| munaxa-identity#24    | Draft, open        | Still relevant; 3 behind `main`, merges cleanly.                                                                                  |
| munaxa-control#13     | Draft, open        | Still relevant but **conflicts** with `main` in `Dockerfile` (control#15 rewrote the same comment and `apk add` line). Resolution is mechanical: keep `main`'s comment, take #13's `3.5.10-r0` versions. To do on the day 3.5.10 ships. |
| munaxa-docs#182       | Draft, open        | Still relevant; 3 behind `main`, merges cleanly.                                                                                  |
| munaxa-work#32        | Draft, open        | Packages token hardening; waits on the GitHub Packages read grant (owner). Not on the Testing path.                               |
| work #37 to #52       | Merged             | Wave 1 merges as listed in the Wave 1 report; merge SHAs match `git log` of `main`.                                              |
| identity#27           | Merged `55def2c`   | MW-003.                                                                                                                           |
| platform #166 to #169 | Merged             | MW-005 E-1 family, MW-002 pin package, MW-075 rule 49, Wave 1 report.                                                             |

None of the bump PRs removes the D-SSL exception; that removal is a separate step after every
affected Testing image is rebuilt and scans clean (Wave 2 plan, step 3).

## 4. CI evidence (GitHub Actions runs read through the API, not the Checks summary)

| Repository / commit           | Run          | Result                                                                                                     |
| ----------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| work `22ba70e` (main)         | 45302962009  | Standards, Product isolation, Mobile, Lint · Typecheck · Test · Build: **success**. Images: **failure** at the Grype scan only (OpenSSL 3.5.9-r1). |
| work#35 `8dadcc9` (re-run)    | 44908264859 #2 | Images: **failure** at `apk add` (3.5.10-r0 not in the Alpine repository), 03:21:44 UTC                 |
| identity `55def2c` (main)     | 45280567610  | **success**                                                                                                |
| control `744765d` (main)      | 45034965914  | **success**                                                                                                |
| docs `d1d10af` (main, code)   | 45035771577  | **success** (`9348aab` is documentation only over it)                                                      |
| platform `a57c54f` (main)     | 45280523530  | **failure**: `@munaxa/security` `redis-server.test.ts` "holds one limit across four instances" allowed 9 of 10 (new finding NF-3) |
| platform `cd83cf3` (main)     | none         | Documentation-only commit; the CI workflow did not run on it.                                              |

Grype on work `22ba70e` (DB built 2026-11-23T06:28:32Z): every Work image (api, migrate, admin)
reports exactly five HIGH CVEs on each of `libssl3` and `libcrypto3` `3.5.9-r1`
(CVE-2026-107493, CVE-2026-107494, CVE-2026-121482, CVE-2026-124709, CVE-2026-84786), no CRITICAL,
and Medium findings (busybox CVE-2025-60876, OpenSSL CVE-2026-95690, CVE-2026-35190) that the gate
does not fail on. Nothing else is HIGH or CRITICAL. The SBOMs and reports are in the run's
`image-reports` artifact (id 14880127105).

Local checks in this pass: `node scripts/run-node-tests.mjs` in munaxa-work 96/96; migration gate on
the tree passes; Prettier 3.9.6 clean; munaxa-platform `infra/aws/stack` `terraform test` with
Terraform 1.16.5 and the locked AWS provider 6.67.0 (checksums verified): **102 passed, 0 failed**;
`check-plan-intent.sh --validate` on the MW-002 declaration: valid, 29 changes;
`@munaxa/rbac` performance suite 7/7, `tsc`, `eslint` clean.

## 5. Findings MW-001 to MW-009 and MW-070 to MW-075

| ID     | Status                     | What was checked in this pass                                                                                                                                                                                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MW-001 | **BLOCKED**                | 3.5.10-r0 not installable in the pinned base (run above); `aports` 3.24-stable and master at 3.5.9-r1. Exception unchanged; Work and School still excluded; permanent gate unchanged (fails on HIGH and CRITICAL). Next check: the other thread's 09:07 UTC trigger, then daily. |
| MW-002 | **OWNER ACTION** (after MW-001) | Pin package present; declaration valid (29 changes); `work-testing-pin.tftest.hcl` passes locally and in CI; E-1 `munaxa-nonprod-work-migrate` family still `pending` with empty image and version, so `discover`/`run` refuse it. No repository work remains before real digests exist. AWS state NOT VERIFIED in this pass (section 9). |
| MW-003 | **VERIFIED**               | `seed-work-roles.mjs` provisions the eight `work-testing-*` roles only with `--testing-personas --environment <non-production>`, a non-production `IDENTITY_BASE_URL`, and a database target that `database-target.mjs` reads with pg's own parser and refuses for production names. Production Identity is a separate database; the roles cannot reach it through this script. Seeding in Testing is OWNER ACTION. |
| MW-004 | **VERIFIED**               | OpenAPI `--check` runs in the required job ("OpenAPI document is current", success on `22ba70e`); loader refuses `munaxa.com` outside `.test.munaxa.com` unconditionally; synthetic names and `example.test` addresses only. Open Low: a `+966` example in a decorator (cosmetic, deferred). |
| MW-005 | **VERIFIED**               | Guard refuses a wrong issuer, unconfirmed or malformed organisation, `NODE_ENV=production` without `--allow-production`; the E-1 family pins the issuer to `https://id.test.munaxa.com` and runs only in the `munaxa-nonprod` network, so Testing tooling cannot target production. |
| MW-006 | **VERIFIED**               | Eight probes; exit 0/1/2/3; every line redacted. The README's "known gap" note was stale after MW-075 and is corrected in this PR. |
| MW-007 | **VERIFIED** with open items | Refresh, expiry, tenant picker and forged-cookie refusal tested in CI (real middleware, headless Chrome). Built-app test still manual; cross-organisation switching not wired (section 7). |
| MW-008 | **VERIFIED**, hardened     | Three open Lows fixed and a fourth gap found and fixed in munaxa-work#53 (section 6). Historical migrations untouched. |
| MW-009 | **VERIFIED**, OWNER ACTION remains | Gate accepts only the latest `ci.yml` push run on `main` for the exact SHA with conclusion success; fails closed. The old-green-commit Medium still needs the owner's `image/*` tag ruleset. |
| MW-070 | **VERIFIED**               | Integration test in the required job. |
| MW-071 | **VERIFIED**               | As above. |
| MW-072 | **VERIFIED**               | Real Organization module test. |
| MW-073 | **VERIFIED**               | No recurrence in the five `main` runs read. |
| MW-074 | **VERIFIED**               | Real Organization module test. |
| MW-075 | **VERIFIED** in code       | Rule 49 (`GET /health/ready`, Work host) in `services.tf`; stack tests pass. Live behaviour needs a session. |

## 6. New findings

| ID   | Severity | Finding                                                                                                                                                                                                                                                                                                 | Disposition                                  |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| NF-1 | Medium   | The migration gate read `package.json` only one level under `apps/` and `packages/`, so the 18 manifests under `packages/modules/*` (a workspace member) were never checked for `migrate dev`, `db push` or an unguarded reset.                                                                         | **Fixed**, munaxa-work#53                    |
| NF-2 | Low      | `tooling/smoke/README.md` still told operators that readiness could not be read in Testing and to use `WORK_HEALTH_URL=skip`, which since MW-075 would leave the run at exit 3 for no reason.                                                                                                             | **Fixed** in this report's PR                |
| NF-3 | Low      | platform `main` CI is red at `a57c54f`: in `@munaxa/security`, when a burst crosses the login limit, a request whose own count is within the limit can read the block that a concurrent over-limit request just set and is refused (9 allowed instead of 10). It fails closed (one extra refusal), so it is not a security weakness, but it makes platform CI flaky. A fix changes rate-limiter semantics in a published package and needs a release. | **Requires repository implementation**, Wave 2 R-4; no test was relaxed |
| NF-4 | Info     | control#13 conflicts with `main` (section 3).                                                                                                                                                                                                                                                         | Resolve when 3.5.10 ships (Wave 2 step 3)    |

## 7. Changes implemented in this pass

1. **munaxa-work#53, MW-008c (migration gate).** A package script may not use `$`, backticks, `eval`
   or `sh -c` (none does); the allowed reset accepts only `[../../]prisma/schema.prisma`; tracked
   shell scripts, Dockerfiles, workflows and compose files are read and `db push`, `migrate dev` and
   `migrate reset` are refused there; every tracked `package.json` at any depth is read. 13 new
   `node:test` cases; every previously refused case is still refused.
2. **munaxa-platform#170 (`@munaxa/rbac` flake).** The large-grant-set test runs the same 100,000
   checks as five batches and compares the fastest with the same per-check budget (75 µs), and now
   also asserts the answers. Test only.
3. **This PR:** the corrected smoke README and this report and plan.

## 8. Wave 1 disclosures, classified

| Item                                          | Classification                          | Reason / next step                                                                                                                                      |
| --------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@munaxa/rbac` timing flake                   | **Fixed and verified** (platform#170)   | Locally 7/7 and CI on the PR.                                                                                                                          |
| Migration checker edge cases                  | **Fixed and verified** (work#53)        | Shell expansion, `--schema`, `.sh` and other command files, nested manifests. Reset protection and generated-migration and immutability checks re-read and unchanged. |
| Built-app browser test in CI                  | **Requires repository implementation**  | Needs a CI step that runs `next build` and `next start` with a fake Identity and drives the existing browser test against it. Wave 2 R-2. Not done here: it changes the required job's runtime and needs its own review. |
| Cross-organisation tenant switching           | **Deferred, documented**                | The picker lists only memberships of the signed-in Identity organisation; switching organisation needs an Identity session change. Testing uses one organisation (`munaxa-group`), so it does not block Testing. Pilot backlog. |
| Image-release tag protection (`image/*`)      | **Requires owner action**               | A ruleset is a repository setting.                                                                                                                      |
| CODEOWNERS for gate files                     | **Requires owner action**               | Adding the file and "require review from code owners" changes who must approve merges.                                                                 |
| Recruiter persona document grants (Low)       | **Deferred**                            | Confirmed in the first Testing session with the loader's data (Wave 2 step 9).                                                                         |
| `+966` example number in a decorator (Low)    | **Deferred**                            | Cosmetic; changes the OpenAPI document, so it rides with the next API change.                                                                         |
| No rate limit on rule 49 (Low)                | **Deferred**                            | Same as Identity, Control and School readiness rules; covered by the ALB and the session's short life.                                                 |

## 9. Limitations and items NOT VERIFIED

- **AWS read-only state: NOT VERIFIED in this pass.** The AWS connector (MunaxaReadOnly) answered
  "needs you to sign in again" twice at about 03:35 UTC. The last read-only facts are those of
  23 Nov (Work secrets 0 versions, no Work task definition, no service running). Nothing in this pass
  changed AWS.
- **Local install of private `@munaxa` packages** is still refused in this environment, so Work's
  lint, typecheck and vitest suites are taken from CI.
- **Alpine package index** (`dl-cdn.alpinelinux.org`) is not reachable from this environment; the
  availability check is the `apk` probe inside the pinned base in GitHub Actions, plus the `aports`
  source on GitHub.
- **MW-009 on a real tag** remains untested: creating an `image/*` tag would start a publish.

## 10. Owner actions (no command to type; each is an approval)

1. Approve the `image/*` tag ruleset on munaxa-work (MW-009 Medium).
2. Approve CODEOWNERS for the gate files and "require review from code owners" (MW-008, MW-009, MW-005).
3. Approve deleting the proof branches `claude/project-thread-vglde2-mw008-proof` and `-mw004b-proof`.
4. Sign the AWS connector in again as MunaxaReadOnly, so read-only verification can resume.
5. When Alpine ships 3.5.10-r0: approve the bump merges and image publication (Wave 2 steps 3 to 5).
6. If 3.5.10 is not shipped by 1 Dec 2026 00:00 UTC: a new decision on MW-001 (no option is proposed here; the exception expires then and is not extended).
7. Then MW-002 W-3 to W-7 and the first Work session approvals as in the Wave 2 plan.

## 11. Internal Testing readiness verdict

**Work is NOT READY for AWS Testing.**

| Level | Meaning                                       | Status                                                                                       |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A     | Repository implementation complete            | **VERIFIED** for the Testing scope (MW-002 to MW-009, MW-070 to MW-075)                      |
| B     | CI verification complete                      | **Partly**: every required job green; Images red on OpenSSL only (**BLOCKED**, MW-001)       |
| C     | Image publication approved and completed      | **BLOCKED**: no publishable image; MW-009 refuses every commit until `main` CI is fully green |
| D     | AWS infrastructure prepared                   | **OWNER ACTION**: pin package ready; nothing pinned or applied; secrets empty (23 Nov)        |
| E     | AWS Testing session operational               | **NOT STARTED**                                                                               |

Recommended next step: wait for Alpine 3.5.10-r0, then run Wave 2 steps 3 to 5 the same day.
