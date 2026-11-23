# 01. Execution report

One section per MW-ID. "Reviewed head" is the commit the independent verifier approved. Where the
branch was later brought up to date with `main` before merging, the "final head" and its CI run are
given too; the lead checked each such delta before merging. Every `munaxa-work` CI run below has
the same five jobs: Standards · Architecture · Localization, Product isolation, Mobile,
Lint · Typecheck · Test · Build, and Images (api, migrate, admin). **Images fails on every
`munaxa-work` run because of MW-001**; it is not a required check. "CI green" below means the four
other jobs passed.

Branch names all follow `claude/project-thread-vglde2-<id>`.

## MW-001: publishable Work images

- **Status:** blocked outside the repositories. No pull request in this wave, by the owner's
  decision (see [00-README.md](00-README.md)).
- **Evidence (23 Nov 2026, about 20:52 UTC):**
  - pkgs.alpinelinux.org: edge `libssl3` and `libcrypto3` are `3.5.9-r1` (built 2026-11-11); v3.23
    and v3.22 `openssl` are `3.5.9-r0`.
  - The OpenSSL 3.5 release notes list 3.5.9 (29 Sep 2026) as the newest release.
  - Every Work CI run in this wave fails the Images scan on `libssl3`/`libcrypto3` `3.5.9-r1`:
    CVE-2026-124709, -107494, -121482, -107493 and -84786 (HIGH).
- **Recheck:** 24 Nov 2026, 09:07 UTC: `<<MW-001-RECHECK-24NOV>>`.
- **Nothing changed:** work#35 (the 3.5.10 bump), the D-SSL exception, its expiry and the Grype
  gates are untouched.

## MW-002: Work Testing pin package

- **PR:** [munaxa-platform#167](https://github.com/munaxa/munaxa-platform/pull/167), branch `-mw002`.
- **Reviewed head:** `c301d6f` (round 2). **Merged:** `59011da`.
- **CI:** runs 45266645708 (Format, validate, mocked plan tests: success) and 45266645661 (Lint,
  Façades, Accessibility: success).
- **What it is:** documentation only, plus one CI test. It does not change `nonprod.tfvars`.
  - `docs/aws-migration/agent-reports/2026-11-23-work-testing-pin-package/`: the exact pin diff, a
    29-change expected-changes template that passes `check-plan-intent.sh --validate`, and owner
    steps W-1 to W-7.
  - A mocked plan of the pin on top of `envs/nonprod.tfvars`: 28 to add, 1 to change (db-admin), 0
    to destroy, no ECS service.
- **Tests added:** `infra/aws/stack/tests/work-testing-pin.tftest.hcl` (2 runs): the three Work task
  definitions exist and no Work service does; each Work task reads its own bundle at the pinned
  version (with non-empty secret lists); db-admin reads `WORK_APP_URL` and `WORK_OWNER_URL`;
  work-api keeps `LICENSING_MODE=CONTROL_PLANE` and the Identity issuer.
- **Verifier rounds:**
  - Round 1, **High** (fixed): the package offered widening D-SSL to Work, against the owner's
    decision. Removed; W-1 now records the WAIT decision and the only scan basis is the permanent
    Grype gate.
  - Round 1, Low (fixed): the withdrawn `b490b25` digests are now stated as never pinned; the test
    asserts the secret lists are not empty.
- **Open:** the pin itself waits for MW-001 and the owner steps in
  [03-OWNER-ACTIONS.md](03-OWNER-ACTIONS.md).

## MW-003: Testing persona roles

- **PRs:** [munaxa-identity#27](https://github.com/munaxa/munaxa-identity/pull/27) (the roles) and
  [munaxa-work#40](https://github.com/munaxa/munaxa-work/pull/40) (the Work tests), branch `-mw003`.
- **Reviewed heads:** identity `5a7edaf` (round 3), work `9fdf79a` (round 2).
- **Merged:** identity `55def2c`; work `<<SHA-#40>>`.
- **CI:** identity run 45279785416 (verify: success, Images: success); work `<<CI-#40>>`.
- **What it does:**
  - Eight roles, `work-testing-org-admin`, `-hr-officer`, `-time-leave-officer`,
    `-payroll-preparer`, `-payroll-approver`, `-recruiter`, `-manager` and `-employee`, marked
    "Testing only". Together they hold all 285 grants; each fits under 75% of a 4,096-byte cookie.
  - One separation-of-duties rule for every persona: a role holding a decision in a module holds
    nothing else in that module except reads and own-record grants. Payroll decisions are held only
    by the payroll approver.
  - `seed-work-roles.mjs` seeds the personas only with `--testing-personas --environment <name>`
    and refuses a production target before connecting.
- **Tests added:**
  - Identity `token-size.integration.test.ts`: size, keys, marking, coverage, separation, and 18
    seed-script refusals run as the real script.
  - Work `testing-personas.spec.ts` (each persona reaches its key operations and is refused the rest,
    through the real authentication port, tenant middleware and permission checker) and
    `testing-personas.payroll.spec.ts` (the preparer is refused approval, finalization, payment and
    reversal on the real payroll pipeline; the approver is refused definition and calculation).
- **Verifier rounds:**
  - M1, Medium (fixed in round 3): the seed script did not check the database it writes to. It now
    parses the connection string with pg's own parser and refuses production hosts, `host=` and
    `hostaddr=` overrides, sockets, empty hosts, non-loopback addresses, `PGHOST`/`PGDATABASE` and
    production-named databases.
  - M2, Medium (fixed): the manager could both nominate and confirm a successor, and both recommend
    and decide a move. Confirm and decide moved to the HR records officer.
  - L1 to L3, Low: L1 answered in the PR (the org admin's delegation grant cannot exercise an
    approver's authority). **Open, Low:** confirm that the recruiter persona's document grants
    cover verify and upload in practice.
- **Finding not changed:** 49 of the 285 permissions are declared but not enforced by any handler
  (mostly `*-own` grants), so the employee persona reaches only the self-service operations that
  exist today.

## MW-004: OpenAPI artifact, synthetic data loader, API collection

- **PR:** [munaxa-work#44](https://github.com/munaxa/munaxa-work/pull/44), branch `-mw004`.
- **Reviewed head:** `1a42951` (round 3, delta check by the lead). **Merged:** `<<SHA-#44>>`.
- **CI:** `<<CI-#44>>`.
- **What it does:**
  - `docs/api/openapi.json` generated offline by `scripts/generate-openapi.mjs` from the built
    application, with `--check` to detect drift. Regenerated after MW-071.
  - `tooling/testing-data/load-synthetic.mjs`: signs in through Identity, then creates one
    organisation with 20 to 50 synthetic employees, leave, attendance, compensation and one open
    payroll period through the Work API. Idempotent (every record looked up by a deterministic key
    first), `--dry-run` sends only GET requests, no real personal data. Refuses any production
    `*.munaxa.com` target that is not a Testing host.
  - `tooling/testing-data/work-api.http`: workflows A to J for manual testing.
- **Tests added:** 11 `node:test` cases against a fake Work API (no second-run writes, append-only
  growth, completion after an interrupted run, dry run, determinism, no token or password in
  output), plus the target guard tests added in round 2. The loader was also run against a locally
  built API on PostgreSQL 16 with the production role split: 255 created, then 0 created on rerun.
- **Verifier rounds:**
  - Round 1, Medium (fixed in round 2): no guard against a production URL.
  - Round 1, Lows: attendance crash window (fixed: policy 409 recovery), password only from the
    environment (fixed: password file), `openapi --check` not in CI (open, see below), a `+966`
    example number in a decorator (open, Low).
  - Round 2, Lows (fixed in round 3): every 409 was counted as "already present" (now only the
    known conflict details), and other production `*.munaxa.com` hosts were accepted after
    confirmation (now refused).
- **Open:** `node scripts/generate-openapi.mjs --check` is not yet a CI step; Agent D adds it to
  `ci.yml` after this merge: `<<PR-CI-OPENAPI-CHECK>>`. The tooling tests already run in CI through
  the "Tooling tests" step that MW-008 added.
- **Defects found and fixed separately:** MW-070, MW-071, MW-072.

## MW-005: guarded tenant bootstrap

- **PRs:** [munaxa-work#41](https://github.com/munaxa/munaxa-work/pull/41) and
  [munaxa-platform#166](https://github.com/munaxa/munaxa-platform/pull/166), branch `-mw005`.
- **Reviewed heads:** work `8aa3269`, platform `45016ae`. **Merged:** work `4f19498`, platform
  `f6a3edd`.
- **CI:** work run 45264138891 (green; Images failed on MW-001); platform runs 45262592162 and
  45262592168 (all success).
- **What it does:**
  - `scripts/bootstrap-tenant-guard.mjs` refuses before any connection: `--issuer` missing or not
    equal, character for character, to `PLATFORM_AUTH_ISSUER`; plain http in production; an
    organisation id that is not a lowercase UUID (slugs and `root` refused); a
    `--confirm-organisation` that does not repeat it; unknown, repeated or value-less options (so
    `--dryrun` cannot become a write).
  - `scripts/bootstrap-tenant.mjs` plans, verifies and commits in one transaction, never re-binds a
    tenant to another organisation or issuer, and `--dry-run` prints the planned writes and rolls
    back.
  - Platform: the `work-migrate` task gets `PLATFORM_AUTH_ISSUER`; the E-1 task guard gains a
    pending `munaxa-nonprod-work-migrate` family with `bootstrap-tenant-dry-run` and
    `bootstrap-tenant` commands and UUID and confirmation input checks.
- **Tests added:** `packages/testing/src/bootstrap-guard.integration.test.ts` (about 20 cases, each
  refusal asserts nothing was written), updated bootstrap and binding suites; platform: 12 E-1 guard
  tests (155 in total) and a Terraform test of the pending manifest family.
- **Verifier rounds:** approved in round 1 with Low findings only.
- **Known gap:** Identity has no credential-free way to confirm an organisation exists. The
  operator confirms it in Identity; the confirmation echo catches a pasted wrong field.

## MW-006: Work smoke test

- **PR:** [munaxa-work#39](https://github.com/munaxa/munaxa-work/pull/39), branch `-mw006`.
- **Reviewed head:** `210fc38` (round 2). **Final head:** `0cda74d`. **Merged:** `b6547ba`.
- **CI:** run 45280068186 (green; Images failed on MW-001).
- **What it does:** `tooling/smoke/work-smoke.mjs` runs eight probes (readiness, unauthenticated
  401, persona read, forbidden 403, entitlements, admin signed in, cross-tenant refusal, logout
  revocation). Exit 0, 1 or 2; every output line passes through a redactor.
- **Tests added:** 23 `node:test` cases against a fake Work host, including each broken behaviour,
  exit codes, token-file mode and a hostile server echoing a token.
- **Verifier rounds:** round 1 findings fixed in round 2. The readiness probe could not reach the
  API in Testing, which became MW-075.
- **Open, Low:** the PR's "Known limits" note still tells the operator to point `WORK_HEALTH_URL`
  elsewhere; since MW-075, `https://work.test.munaxa.com/health/ready` reaches work-api.

## MW-007: admin session refresh and tenant picker

- **PR:** [munaxa-work#42](https://github.com/munaxa/munaxa-work/pull/42), branch `-mw007`.
- **Reviewed head:** `8b0dd78` (round 2). **Merged:** `<<SHA-#42>>`.
- **CI:** run 45276255461 on `8b0dd78` (green); final `<<CI-#42>>`.
- **What it does:** the admin middleware redirects to `/session/refresh` when the access cookie is
  absent or about to expire, refreshes through Identity's `POST /api/auth/refresh` on the same
  origin, and guards against loops with a 60-second marker. A tenant picker writes
  `munaxa_work_tenant` only for a tenant the API lists for the verified principal.
- **Tests added:** `middleware.test.ts` (the real middleware), `session-continuity.test.ts`,
  `session-continuity.browser.test.ts` (headless Chrome: 5 cookie lapses and refreshes over at
  least 60 simulated minutes, forged tenant cookie and form post refused, revoked session ends at
  sign-in), `tenant-selection.test.ts`, `session-tenants.controller.spec.ts`.
- **Verifier rounds:** round 1, **High** (fixed): a relative `Location` in the middleware made
  Next 15.5 answer 500 to every signed-out visit. Round 2 verified a real `next build` and
  `next start`.
- **Open:** no CI test runs the built app (checked by hand); switching to a tenant in another
  Identity organisation is not wired up.

## MW-008: migration safety and drift gates

- **PRs:** [munaxa-work#38](https://github.com/munaxa/munaxa-work/pull/38) and the follow-up
  [munaxa-work#43](https://github.com/munaxa/munaxa-work/pull/43), branches `-mw008` and `-mw008b`.
- **Reviewed heads:** `e73e3e0` and `4c5cc7e` (round 2; final head `4a8c7a2`). **Merged:**
  `f12bd05` and `770fa2f`.
- **CI:** runs 45260326986 and 45273129770 (green; Images failed on MW-001).
- **Acceptance proof:** CI run 45260369090 on the proof branch
  `claude/project-thread-vglde2-mw008-proof`, which adds a Prisma-generated migration, **failed as
  intended**. The branch was never proposed for merge.
- **What it does:** SQL migrations documented as authoritative; `check-migration-safety.mjs`
  rejects Prisma-generated migrations, edits to merged migrations and unguarded reset scripts; a
  drift ratchet fails CI if `prisma migrate diff` grows past `prisma/drift-baseline.json`;
  `pnpm db:reset` works only against a local database with `WORK_ALLOW_DB_RESET=1`; a "Tooling
  tests" CI step runs every `*.test.mjs` under `scripts/` and `tooling/`.
- **Tests added:** 27 then 34 `node:test` cases, with Prisma-generated and hand-written fixtures.
- **Verifier rounds:** #38 approved with a **Medium** (no CODEOWNERS for the gate files; owner
  action) and Lows. #43 fixed them (fail-closed base, reset-script allow-list, case-insensitive
  `host=` check) and was approved in round 2 with Lows still open: shell-expansion obfuscation,
  `--schema` accepting any path, and `.sh` files not scanned.

## MW-009: image publishing requires green CI

- **PR:** [munaxa-work#37](https://github.com/munaxa/munaxa-work/pull/37), branch `-mw009`.
- **Reviewed head:** `c365fae`. **Merged:** `7da2a88`.
- **CI:** run 45259633553 (green; Images failed on MW-001); Release gate run 45259633562 (success).
- **What it does:** `.github/scripts/require-green-ci.mjs` accepts a commit only if the latest
  `ci.yml` push run on `main` for that exact SHA, in this repository, completed with success. It
  fails closed on any error. Both publish workflows run its tests and then the gate before any build
  or push; a path-filtered `release-gate.yml` runs the tests on pull requests.
- **Tests added:** `require-green-ci.test.mjs`, 20 cases. Checked against real data: `8a975f6` (CI
  failed) refused, `a93c642` (CI succeeded) accepted.
- **Verifier rounds:** approved with a **Medium**: a tag on an old commit whose CI was green then
  would pass. Mitigation is an owner tag ruleset for `image/*`. Not tested on a real tag (no publish
  is allowed).
- **Consequence:** with MW-001 open, `main` CI is never fully green, so no image can be published.

## MW-070: organization lists answered 500

- **PR:** [munaxa-work#45](https://github.com/munaxa/munaxa-work/pull/45), branch `-mw070`.
- **Reviewed head:** `23958e5`. **Merged:** `<<SHA-#45>>`. **CI:** `<<CI-#45>>`.
- **Fix:** every filter parameter is referenced and typed in the unit, position and financial
  center list statements; counts no longer receive limit and offset.
- **Tests added:** `organization-lists.integration.test.ts`, 13 cases (all fail without the fix).
- **Verifier:** approved; Low open: ILIKE wildcards in search terms are not escaped (pre-existing).

## MW-071: 500 instead of 400 or 409

- **PR:** [munaxa-work#46](https://github.com/munaxa/munaxa-work/pull/46), branch `-mw071`.
- **Reviewed head:** `217456f`. **Final head:** `75504af`. **Merged:** `1bd705a`.
- **CI:** run 45275672191 (green; Images failed on MW-001).
- **Fix:** `ParseUUIDPipe` on all 263 identifier path parameters; a repeated attendance policy code
  answers 409 `policy_code_taken`.
- **Tests added:** `refusals.postgres.spec.ts` enumerates every registered route with an identifier
  parameter and expects 400 for `not-a-uuid`; 409 for repeated policy and unit codes.
- **Verifier:** approved with Lows.

## MW-072: payroll organization source

- **PR:** [munaxa-work#47](https://github.com/munaxa/munaxa-work/pull/47), branch `-mw072`.
- **Reviewed head:** `1dd848f`. **Merged:** `<<SHA-#47>>`. **CI:** `<<CI-#47>>`.
- **Fix:** the adapter finds the group's legal entity among the registrations and asks about the
  unit it is registered on; the test harness stub no longer hides the defect.
- **Tests added:** `payroll-organization-source.postgres.spec.ts` (real Organization module, no
  user permission); the old adapter fails 10 tests with the corrected harness.
- **Verifier:** approved; Low open: the list query returns the full legal entity view (data
  minimisation).

## MW-073: flaky career concurrency test

- **PR:** [munaxa-work#48](https://github.com/munaxa/munaxa-work/pull/48), branch `-mw073`.
- **Reviewed head:** `93a7362`. **Final head:** `0060d09`. **Merged:** `bf4eb4d`.
- **CI:** run 45277987567 (green; Images failed on MW-001).
- **Root cause:** the test's assertion, not the product. A second move from the same version is
  refused either by the version check or by the domain, depending on the interleaving.
- **Tests:** the race test asserts the invariant; two new deterministic tests force each path. Test
  only, no production change.
- **Verifier:** approved with Lows.

## MW-074: performance organization source

- **PR:** [munaxa-work#49](https://github.com/munaxa/munaxa-work/pull/49), branch `-mw074`.
- **Reviewed head:** `426b2b1`. **Merged:** `<<SHA-#49>>`. **CI:** `<<CI-#49>>`.
- **Fix:** the adapter reads `legalEntity?.id` from the published answer; the harness stub now
  answers the published shape.
- **Tests added:** `performance-organization.postgres.spec.ts` (fails without the fix).
- **Verifier:** approved; Low open: one stub is typed `unknown`.

## MW-075: Work API readiness reachable in Testing

- **PR:** [munaxa-platform#168](https://github.com/munaxa/munaxa-platform/pull/168), branch `-mw075`.
- **Reviewed head:** `1669a8f`; follow-ups at `6d2b39c` (tests and a comment only, lead delta
  check). **Merged:** `a57c54f`.
- **CI:** runs 45278247056 and 45278246663 on `6d2b39c` (all success).
- **Fix:** ALB rule 49 on the Work host forwards exactly `GET /health/ready` to work-api, following
  how Identity, Control and School expose readiness. `/health` and `/health/live` stay unrouted. The
  rule exists only while the Work services and the edge do, so the MW-002 pin is unchanged.
- **Tests added:** `work-readiness-route.tftest.hcl` (4 runs: rule 49 renders the work host, path
  and GET; other hosts unchanged; no rule without services or edge) and the service module's
  `routes.tftest.hcl` (method condition rendered or absent; lower-case and unknown methods refused).
- **Verifier:** approved with a Medium (test gaps on the rendered host and method condition) and
  Lows (503 comment, a negative test), all fixed at `6d2b39c`. **Open, Low:** no rate limit on the
  route; the 2026-11-05 Testing runbook still says the path is not reachable.
