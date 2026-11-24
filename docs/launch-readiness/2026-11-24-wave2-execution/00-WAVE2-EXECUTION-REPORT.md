# Munaxa Work Wave 2 execution report (24 Nov 2026)

Owner request of 24 Nov 2026 09:13 UTC: continue Wave 2 from the live repositories. Do all safe
repository work, then test, open PRs and merge the eligible ones. Prepare every owner-gated step
without executing it.

Scope of this pass:
- No Terraform apply, image publication, tag, secret, IAM, GitHub setting, DNS or Cloudflare
  change.
- No AWS read: the AWS connector answered as the account root user, and root must not be used
  for checks.

Status labels: **VERIFIED**, **COMPLETE**, **BLOCKED**, **OWNER ACTION**, **NOT VERIFIED**,
**DEFERRED**.

## 1. Executive summary

- **Work is NOT READY for AWS Testing.** MW-001 is **BLOCKED** because Alpine has not published
  OpenSSL 3.5.10-r0. As a result:
  - no Work image can pass the permanent Grype gate;
  - so no image can be published (P-2), and no pin PR can be made.
- **R-4 (NF-3):** platform#172 fixed the race inside one window. Review found **the same race at
  a fixed-window boundary**.
  - It is reproduced by a deterministic test and fixed in **platform#177**.
  - Over-limit requests are still refused, and the store-failure policy (fail closed) is
    unchanged.
- **R-2 VERIFIED COMPLETE (work#57).**
  - It runs the real `next build` and `next start` in the required CI job.
  - It covers the load balancer's Host and X-Forwarded-Proto headers, open redirects, redirect
    loops, cookie attributes and `no-store`.
  - No defect is left; one gap is documented (section 4).
- **OpenSSL bump PRs are ready for 3.5.10:**
  - work#35, identity#24 and docs#182 merge cleanly with `main`;
  - control#13's Dockerfile conflict (NF-4) is resolved in draft **control#17**.
- **MW-002 repository preparation VERIFIED against the current `main` (9a40f06).**
  - The mocked Work pin still plans **28 add + 1 db-admin change** (a replace in a real plan),
    with 0 destroy and no ECS service or load balancer.
  - The 29-change declaration validates.
  - Only the real digests and secret version ids are missing, and both are owner-gated.

## 2. Repository HEADs (09:50 UTC)

| Repository | `main` | Commit time (UTC) |
| --- | --- | --- |
| munaxa-work | `0134407` (work#57) | 24 Nov 08:22 |
| munaxa-platform | `20014c1` (platform#177; before it `ef96abb` #176, `9a40f06` #174) | 24 Nov 09:49 |
| munaxa-identity | `6dbf35d` | 24 Nov 08:43 |
| munaxa-control | `bf2e4b3` | 24 Nov 07:46 |
| munaxa-docs | `9348aab` | 22 Nov 15:15 |

Platform `main` CI is green at `5e58eb6` (run 45344468728) and at `93cca08` (run 45347717853).
The run for `9a40f06` (45361216678) was still in progress at 09:25 UTC.

## 3. Pull requests in this pass

| PR | Finding | State |
| --- | --- | --- |
| [munaxa-platform#177](https://github.com/munaxa/munaxa-platform/pull/177) | R-4 / NF-3 boundary variant | **MERGED** `20014c1` (09:49 UTC), standing merge rule, all required checks green |
| [munaxa-control#17](https://github.com/munaxa/munaxa-control/pull/17) | NF-4 / R-1: control#13 rebased on `main` | **Draft on purpose**: waits for 3.5.10-r0 |

The report PRs (this file in munaxa-work and munaxa-platform) are listed in section 12.

## 4. R-2: built-app browser check (work#57). VERIFIED COMPLETE

- `tooling/smoke/admin-built-app.mjs` runs inside the required job "Lint · Typecheck · Test ·
  Build", in the step "Admin built app answers signed-out visits", after `pnpm build`. That step
  starts the real admin with `next start`.
- Eight checks run against the production server:

  | Check | What it verifies |
  | --- | --- |
  | `signed-out-root`, `signed-out-deep` | 307 to `/session/refresh` with the right `returnTo`, plus `no-store` and the marker cookie `HttpOnly; Secure; SameSite=Lax; Path=/` |
  | `behind-load-balancer` | With `Host: work.test.munaxa.com` and `X-Forwarded-Proto: https`, `Location` stays on `https://work.test.munaxa.com` (NF-5) |
  | `no-open-redirect` | `//evil.example/...` stays on the origin |
  | `attempted-renders` | No redirect loop |
  | `post-passes` | POST requests are not redirected |
  | `refresh-page` | The refresh page answers 200 HTML |
  | no `x-powered-by` | The header is absent |

- **Determinism:**
  - no network, Identity or database is used;
  - it runs on an ephemeral port with a 3-minute timeout;
  - 10 `node:test` cases run stand-in servers, one per defect.
- **Evidence:** CI run 45346758173 passed. The first run (45344214262) failed on the NF-5 defect,
  which proves the check bites.
- **Gap, documented and not a defect:**
  - The tenant-selection server action (`redirect()` after a form POST) is not exercised by the
    built-app check.
  - Its targets come from `safeReturnTo`, which has unit tests.
  - `redirect()` from a server action emits a relative path, so the NF-5 class does not apply.
- **Residual risk:**
  - `publicOrigin()` trusts a well-formed `Host`. A forged `Host` only redirects the client that
    sent it, and the answer is `no-store`.
  - In Testing, the load balancer forwards to work-admin only for the portal's host name.

## 5. R-4: rate-limiter semantics (NF-3). Fix in platform#177

**What platform#172 fixed (VERIFIED):** within one fixed window, a within-limit request no longer
reads a block that a later request recorded. The block stores `{until, windowStart, current}`.

**What remained (new, reproduced deterministically).** The scenario: limit 10, window 1 minute,
adaptive block on.

1. Nine requests are admitted.
2. The tenth is counted in the window's last millisecond.
3. Before the tenth reads the block, the eleventh is counted in the next window. There the
   previous ten still weigh fully, so the eleventh is over the limit and records the block.
4. `countedBefore` compared counts only within the same window, so the tenth was refused.

The result is 9 of 10 again: fail-closed, but wrong.

**Fix:**
- `countedBefore` now orders requests by (fixed window, raw atomic count). A request from an
  earlier window is "before".
- The request's own limit check is unchanged, so an over-the-limit request is still refused. No
  limit is relaxed; only the penalty is kept to what was counted after the violation.
- Unchanged:
  - store-failure handling, including `onStoreFailure: 'deny'`, which still refuses;
  - malformed-block handling;
  - legacy bare-number blocks;
  - the token bucket.

**Tests:**
- `regression R-4`: on the code before the fix it **fails** (the tenth is refused). With the fix
  it **passes**: the tenth is admitted, later requests are refused while the block lasts, and are
  admitted after it ends.
- A request counted after the violation whose own estimate is within the limit is still refused.
- Already covered before this pass:
  - 4 limiter instances on one store share one limit and one block (multi-instance);
  - 100 concurrent requests admit exactly 10.

**Local evidence:**
- `@munaxa/security` 144 passed (4 Redis tests are skipped without Redis).
- `test/redis-server.test.ts` against a local `redis-server 7`: 4/4 passed on 10 of 10 runs.
- tsc, eslint and prettier are clean.

**CI (VERIFIED):**

- Head `c35142e`, runs 45363858088 and 45363857994. Every job passed:
  - "Lint · Typecheck · Test · Build", including the step `vitest run test/redis-server.test.ts`
    with `MUNAXA_REQUIRE_REDIS=1` against the Redis service: 4/4;
  - "Format, validate, mocked plan tests";
  - Accessibility;
  - Façades.
- The first merge attempt was refused with "3 of 3 required status checks are expected" because
  the branch was behind `main`. After `main` was merged into the branch (`8397f75`, runs
  45366397009 and 45366397022), the same jobs all passed again, and the PR merged.

**Release:**
- The patch changeset is updated. **No package is published.**
- Consumers: Identity uses `@munaxa/security` 2.5.0. The defect is fail-closed, so no consumer
  PR is needed now.
- 2.5.1 goes out with the next platform release. That needs **OWNER ACTION** (publish approval).

**Residual risk:**
- Under clock skew between instances, a request from a lagging instance is not penalised by a
  block recorded in a later window.
- That request still passes or fails its own limit check, and the exposure is bounded by the skew
  (Amazon Time Sync on ECS).

## 6. OpenSSL (MW-001 / R-1 / R-3). BLOCKED until Alpine publishes 3.5.10-r0

- **Package availability, 24 Nov 09:15 UTC: VERIFIED NOT published.** `aports`
  `main/openssl/APKBUILD` reads `pkgver=3.5.9`, `pkgrel=1` on both `3.24-stable` and `master`.
- The daily recheck belongs to the "Implement Munaxa Work Wave 1 fixes" thread. No duplicate was
  scheduled.
- **Bump PRs, trial-merged with today's `main`:**

  | PR | Head | Merge with `main` |
  | --- | --- | --- |
  | work#35 | `8dadcc9` | Clean |
  | identity#24 | `bedda9c` | Clean |
  | docs#182 | `c417953` | Clean |
  | control#13 | `80e10f9` | Conflict in `Dockerfile`: resolved in **control#17** (`9ce0a37`, main's comment kept, `3.5.10-r0` taken) |

  control#17 replaces control#13 on the day 3.5.10 ships. control#13's branch belongs to another
  thread, so it was not pushed.
- **Unchanged in this pass:**
  - no exception was widened, and Work is not covered by D-SSL;
  - the permanent Grype gate is unchanged;
  - nothing was published;
  - no substitute package was used.
- The D-SSL exception still expires at **2026-12-01T00:00:00Z**.

## 7. CODEOWNERS, rulesets and branches

| Item | State |
| --- | --- |
| `.github/CODEOWNERS` on `main` | **VERIFIED**: 19 required gate files are owned (`node scripts/check-codeowners.mjs`: ok). Covered: workflows, CI scripts, migration gates and drift baseline, bootstrap and Testing-data guards, Dockerfiles, `.npmrc`, `deploy/`, tenant and entitlement guards, and the file itself. |
| CODEOWNERS validation in CI | **VERIFIED**: it runs in the "Standards · Architecture · Localization" job (Tooling tests). |
| "Protect main" ruleset, `require_code_owner_review` | **NOT VERIFIED in this pass**: this session has no tool that reads rulesets. The last reading, by the Wave 2 repo thread at 08:23 UTC, was **false**. See owner decision D-1 below. |
| `image/*` tag ruleset | **NOT VERIFIED in this pass**, for the same reason. **OWNER ACTION** P-1 if it is not yet in place. |
| `claude/project-thread-vglde2-mw008-proof`, `-mw004b-proof` | **VERIFIED deleted**: absent from the munaxa-work branch list (30 branches, 09:14 UTC). |
| Which checks are required | **NOT VERIFIED** (ruleset not readable). The Images job is known not to be required. |

## 8. MW-002: Work Testing pin package. Repository side COMPLETE, values BLOCKED

All verification was against munaxa-platform `9a40f06`, offline, with Terraform 1.16.5 and the
mocked AWS provider 6.67.0.

- **Plan shape VERIFIED.**
  - `supporting/work-pin-mocked.tftest.hcl` run with `-var-file=envs/nonprod.tfvars` passes 2/2.
  - Result: **Plan: 28 to add, 1 to change, 0 to destroy.**
  - The addresses are the same as in the 23 Nov package.
  - There is no `aws_ecs_service`, `aws_lb*`, listener rule (rule 49 exists only with services
    and the edge on), network, database, KMS or secret resource.
  - A real plan replaces the db-admin task definition, so the declaration lists
    `["delete","create"]`.
  - There is no drift since 23 Nov. The later changes (#168 rule 49, #173 Control desired counts,
    #174 operator ranges) do not touch the Work delta.
- **Declaration VERIFIED.** `check-plan-intent.sh --validate` on the template: "Declaration valid:
  root stack-nonprod, 29 declared change(s)".
- **E-1:**
  - the `munaxa-nonprod-work-migrate` family is in the manifest as `pending` (platform#166);
  - the pin PR must un-pend it with the same digest and version, and a test enforces this.
- **Task guard, Testing task definitions, smoke configuration (8 probes) and rollback (Wave 2
  plan section 12):** present on `main`.
- **Not done, and correctly so:** the pin PR itself.
  - It needs the three real digests from one green release run of a `main` commit with 3.5.10.
  - It needs the two version ids from the owner's CloudShell bundle run (W-4).
  - Placeholder values would be wrong to merge.
  - The withdrawn `b490b25` images are never used.
  - `CONTROL_PLANE_TOKEN` remains the marked placeholder until Control issues Work's credential.
    It is not a working licence.
- **Ordering risk (new):**
  - platform#176 (`ef96abb`, merged 09:19 UTC by the Identity thread) re-pins Identity.
  - `envs/nonprod.expected-changes.json` now declares those 4 Identity task-definition
    replacements.
  - The Identity apply must happen before the Work pin PR. Otherwise the Work plan would show
    33 changes and fail the 29-change intent check.
  - The Work pin PR must be made from a `main` whose declaration has already been applied.

## 9. AWS state. NOT VERIFIED

At 09:14 UTC, `sts:GetCallerIdentity` returned `arn:aws:iam::229251310592:root`. No further call
was made.

Not verified in this pass:
- Work task definitions, services and running tasks;
- the E-1 family;
- RDS state;
- Identity and Control resources;
- the cleanup schedule.

The coordinator reports that the live Testing session was shut down at 09:05 UTC; this pass did
not verify that independently.

**OWNER ACTION:** sign the AWS connector in again as `AWSReservedSSO_MunaxaReadOnly` (the O-IAM-6
setup of 23 Nov).

## 10. Quality review of Wave 1 and Wave 2 changes

| Area | Result |
| --- | --- |
| Rate limiting | Boundary race found and fixed (section 5) |
| Admin session and redirects | Verified (section 4); one coverage gap documented |
| Smoke test | Verified: 8 probes (`health-ready`, `unauthenticated`, `persona-read`, `forbidden`, `entitlements`, `admin-signed-in`, `cross-tenant`, `logout-revocation`). `redact.mjs` redacts every secret of the run, plus token-like cookies and keys. |
| Testing-only code in production | Verified: the CI step "Check the production output carries no test-only code" is present in the required job |
| Migration safety | MW-008/008c gates are in CI and code-owned; nothing new found |
| Required-check coverage | NOT VERIFIED (ruleset not readable) |

## 11. Owner actions, in order

1. **D-1, CODEOWNERS enforcement (decision).** Turning on "Require review from Code Owners" in
   the munaxa-work "Protect main" ruleset blocks every PR that touches an owned file, because
   every PR is authored as `tam2om` and an author cannot approve their own PR. The options are:
   - a second reviewer account;
   - a ruleset bypass for the owner;
   - leave it off and rely on CI plus the validator (current state).
2. Sign the AWS connector in as **MunaxaReadOnly**. This unblocks every AWS check in section 9.
3. P-1: confirm or approve the `image/*` tag ruleset.
4. Later, with the next platform release: approve publishing `@munaxa/security` 2.5.1.
5. **On the day Alpine publishes 3.5.10-r0:** approve merging the four bump PRs after green
   Images (work#35, identity#24, control#17 in place of control#13, docs#182). Then approve
   image publication P-2 and P-3.
6. W-4: run the approved CloudShell bundle procedure for work-api and work-migrate, and send back
   the version ids only.
7. Merge the Work pin PR. Claude builds it from the real digests and ids.
8. W-6: plan. The expectation is exactly 29 changes.
9. W-7: apply. Then session 1 (Wave 2 plan section 7), Control credential and the work-api-only
    pin (section 9), session 2 and the 8-probe acceptance (section 10), and `down` plus cost
    verification.
10. **1 Dec 2026, if 3.5.10-r0 is still missing:** a new MW-001 decision. No option is
    pre-selected and the exception is not extended.

## 12. Next concrete step

platform#177 is merged. Nothing else on Work's Testing path can be done safely in the
repositories until Alpine publishes 3.5.10-r0. The other thread's daily recheck is the trigger.
On that day, the first step is to re-run CI on work#35, identity#24, control#17 and docs#182.

Report PRs: munaxa-work `docs/launch-readiness/2026-11-24-wave2-execution/` and munaxa-platform
`docs/aws-migration/agent-reports/2026-11-24-work-wave2-execution/` (same file).
