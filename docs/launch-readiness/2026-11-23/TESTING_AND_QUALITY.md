# Testing and quality

Only results that were run in this session or read from a verified CI run are reported as passed.

## Executed in this session (23 Nov 2026, `61c115b`)

| Check                                                            | Result                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `node scripts/check-standards.mjs`                               | **pass** — "Engineering Standards: no violations."                                           |
| `node scripts/check-architecture.mjs`                            | **pass** — "188 model(s) checked, no violations."                                            |
| `node scripts/check-localization.mjs`                            | **pass** — "20 catalogue set(s) complete."                                                   |
| `node scripts/check-dependencies.mjs`                            | **pass** — "2082 source file(s), no cycles, no unused dependencies, no unreachable files."    |
| `node scripts/check-platform-parity.mjs`                         | **not meaningful** — refused because `@munaxa/*` was not installed from the registry         |
| All 35 migrations on empty PostgreSQL 16 (`psql -v ON_ERROR_STOP=1`) | **pass** — 35 applied, 188 tables, RLS enabled and forced on 188                          |
| RLS probe as a `NOBYPASSRLS` role (synthetic rows)               | **pass** — 0 rows without tenant; 1 with own tenant; cross-tenant update 0 rows; cross-tenant insert refused |
| `prisma validate` (Prisma 6.19.0)                                | **pass**                                                                                     |
| `prisma migrate diff` migrations vs schema                       | **fail (drift)** — 184 tables differ (MW-008)                                                |
| Permission catalogue vs Identity artifact                        | **pass** — 285 and 285, 0 differences                                                       |
| `pnpm install --frozen-lockfile`                                 | **failed** — 401 from `npm.pkg.github.com` for `@munaxa/platform` 1.6.1 (no Packages grant for this session) |

Because the install failed, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, image builds and
the admin were **not** run in this session.

## Verified CI results

CI run [44901535832](https://github.com/munaxa/munaxa-work/actions/runs/44901535832), push to `main`,
commit `61c115b`, 21 Nov 2026 11:57 to 12:08 UTC. Overall: **failure**.

| Job                                    | Result      | Steps                                                                                                       |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| Standards · Architecture · Localization | success     | standards, architecture, localization, dependencies, platform parity                                         |
| Lint · Typecheck · Test · Build        | success     | install, parity, format check, lint, typecheck, apply migrations (PostgreSQL 17), test, build, production-output check, Prisma validate, `pnpm audit --audit-level high` |
| Product isolation                      | success     | no cross-product dependencies                                                                               |
| Mobile                                 | success     | `flutter analyze`, `flutter test`, `flutter build apk --debug`                                              |
| Images (api, migrate, admin)           | **failure** | digest pinning, build and verify passed; **scan failed**: HIGH CVE-2026-124709, -107494, -121482, -84786, -107493 in `libssl3`/`libcrypto3` 3.5.9-r1 (reported for `work-admin`; same base for api and migrate) |

The last fully green `main` run is [44835583159](https://github.com/munaxa/munaxa-work/actions/runs/44835583159)
(`a93c642`, 20 Nov); the OpenSSL advisories were published on 17 Nov and reached the Grype database
afterwards. Open drafts: work#35 (OpenSSL 3.5.10, fails by design until Alpine ships it), work#32
(package token, waits for the owner's Packages grant).

## Test inventory (counted in this session)

| Kind                                                   | Count                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Test files (`*.test.ts`, `*.spec.ts`, `*.test.tsx`)     | 489                                                           |
| Integration files against PostgreSQL                   | 129 (`*.integration.test.ts`, `*.postgres.spec.ts`)           |
| Test cases (`it(` / `test(` occurrences)               | about 5,140                                                   |
| Admin UI tests                                         | present (`apps/admin/src/**.test.tsx`), server-rendered output assertions |
| Mobile tests                                           | 1 (`apps/mobile/test/bootstrap_test.dart`)                    |
| Browser end-to-end tests                               | **0**                                                         |
| Tests against a deployed environment                   | **0**                                                         |
| Performance scripts                                    | 10 (`scripts/measure-*.mjs`), not in CI                       |
| Statutory golden cases                                 | **0**                                                         |

Assertions are meaningful: suites run as an unprivileged role against real RLS, assert refusals and
check constraints, and several tests assert the *absence* of capabilities (for example that no form
exists) so the honesty sections cannot drift.

## Coverage of critical areas

| Area                         | Coverage                                                                                                  | Gap                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Tenant isolation             | strong: cross-tenant suites per module, token isolation, membership resolution role                       | none found                                                 |
| Authorization                | strong: grant mapping over all 285 names, permission checker, token authorization                         | MFA requirements (none exist, MW-022)                      |
| Session revocation           | `session-revocation.spec.ts`, `.instances.spec.ts`                                                        | no test against a real Identity                            |
| Payroll calculation          | engine, proration, money, approval, finalization, concurrency, isolation                                  | statutory golden cases (MW-010)                            |
| Workflows end to end         | cross-module harnesses (hire, workflow, payroll inputs)                                                   | no UI path exists to test (MW-011); no browser E2E (MW-032)|
| Migrations                   | applied fresh in CI every run                                                                             | no upgrade test from the previous release; drift gate (MW-008) |
| Images                       | pinning, verify, SBOM, Grype scan in CI and before push                                                   | none                                                       |
| Deployed smoke               | none                                                                                                      | MW-006                                                     |

## Quality risks

1. **CI on `main` is red** until OpenSSL 3.5.10 (MW-001). If the Images job is a required check, every
   PR in this repository is blocked by it, including documentation PRs.
2. **Agents cannot run the gate locally** without a GitHub Packages grant (MW-033). In a multi-agent
   operation every agent would depend on CI for every check, which slows iteration and hides failures
   until push.
3. **No browser or deployed-environment tests.** Once write screens exist, this becomes the largest test
   gap (MW-032).
4. **Performance numbers are from local measurement scripts**, not from the AWS shapes (MW-042).
