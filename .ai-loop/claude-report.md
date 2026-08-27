# CLAUDE REPORT

TASK_ID: NONE

STATUS: NO_TASK — repository inspected, awaiting task from CTO

IMPLEMENTED:
Nothing. `.ai-loop/current-task.md` has `TASK_ID: NONE` and `OBJECTIVE: Waiting for ChatGPT`,
so there was nothing to implement. Repository inspection only, per instruction.

REPOSITORY_INSPECTION:

- Monorepo: pnpm 10.33.0 workspaces + Turborepo. Node >= 22 (engine-strict). ~2,013 TS/TSX files.
- Apps: `api`, `admin`, `employee-portal`, `manager-portal`, `mobile` (Flutter, not a workspace member).
- Packages: `kernel`, `config`, `contracts`, `sdk`, `testing`, `persistence`, `country-packs`,
  and 18 business modules under `packages/modules/`: identity, organization, people, employment,
  recruitment, onboarding, attendance, leave, compensation, payroll, documents, letters,
  performance, learning, career, workflow, relations, assets.
- Module shape (ADR-0023): `domain/ application/ infrastructure/ contracts/ api/`, one-way layer
  dependency `domain <- application <- infrastructure <- api <- presentation`, enforced by
  `tooling/eslint/standards.mjs` and `scripts/check-*.mjs`, not by review.
- Only three things cross a module boundary: application services, public contracts, domain events.
- Design system is NOT owned here — it is consumed from `@munaxa/*` (GitHub Packages,
  `npm.pkg.github.com`, needs a `read:packages` token). Rebuilding a component locally is the
  explicit anti-pattern.
- Tenancy: tenant derived from stored `tenant_membership` (ADR-0032) + Postgres RLS (ADR-0030).
- Prisma schema/migrations at `prisma/`. 186 tables, 32 migrations, 513 routes per docs/PHASES.md.
- CI (`.github/workflows/ci.yml`) has 4 jobs: `standards` (runs without install), `node`
  (format/lint/typecheck/migrate/test/build/prisma-validate/audit against a real Postgres 17
  service), `mobile` (Flutter 3.27.1 + JDK 17), `boundaries` (no cross-product imports).
- Deliberate non-features: no `PlatformAuthenticationPort` implementation beyond
  `UnauthenticatedPort`, no granting `PermissionChecker`, no `StoragePort`, no `JobPort`.
  A deployment therefore answers 401 on business routes by design (ADR-0001, ADR-0032).

FILES_CHANGED:
`.ai-loop/claude-report.md` (this report only). No source files touched.

TESTS_RUN:
`node scripts/check-standards.mjs` — attempted.

TEST_RESULTS:
FAILED to execute (environment, not code): `spawnSync git ENOENT` at
`scripts/check-standards.mjs:122` (`trackedFiles()` shells out to `git ls-files`).

KNOWN_ISSUES — ENVIRONMENT BLOCKERS (must be resolved before any task can be verified):

1. **git is not installed / not on PATH.** `.git/` exists, but there is no `git` executable
   anywhere standard. This blocks: `scripts/check-standards.mjs` (crashes immediately),
   `check-architecture.mjs` / `check-localization.mjs` / `check-dependencies.mjs` (likely the
   same `git ls-files` dependency), and all diff/commit/branch operations. This is the single
   highest-priority blocker — without it I cannot run the standards gate or commit work.
2. **Dependencies are not installed.** No `node_modules` at root or in any workspace.
   `pnpm install` requires `GITHUB_TOKEN` / an `_authToken` for `npm.pkg.github.com` with
   `read:packages` on the `tam2om` org, because `@munaxa/*` is private. Until then:
   no lint, no typecheck, no test, no build, no prisma generate.
3. **Docker is not installed / not on PATH.** `pnpm db:up` cannot start Postgres/Redis/Mailpit.
   Module integration suites assert RLS tenant isolation against a real database, so they
   cannot pass without one. Alternative: point `TEST_DATABASE_URL` at an existing Postgres 17.
4. **No `.env`.** Only `.env.example` is present. `DATABASE_URL` / `TEST_DATABASE_URL` unset.
5. **Flutter is not installed.** Anything touching `apps/mobile` cannot be verified locally.

Consequence: **at this moment I can read and edit code, but I cannot verify anything.**
Per rule 8 ("never claim something works unless verified"), any task assigned before blockers
1–4 are cleared will be reported as IMPLEMENTED_UNVERIFIED, not as passing.

QUESTIONS_FOR_CTO:

1. Can git, Docker Desktop and a `read:packages` GitHub token be provisioned on this machine?
   If not, what verification standard do you want instead of "tests pass"?
2. Is the intended next unit of work the product-development track — the audit's recommended
   first vertical slice, **the Employee Record** (shell -> directory -> record, §14/§16 of
   `docs/verification/product-readiness-audit.md`) — or the next numbered phase in
   `docs/PHASES.md`? The audit argues explicitly for the former and against the latter.
3. Task granularity: one task per loop iteration, scoped to a single reviewable change?

RECOMMENDATION_FOR_NEXT_STEP:
Clear environment blockers 1–3 first (git, `pnpm install` with a registry token, a reachable
Postgres 17), then confirm the baseline by running `pnpm verify` and recording the actual result
as the loop's starting point. Only then issue the first implementation task. Issuing code work
before that produces changes nobody — including me — can verify.
