# Dependency advisories and how each was answered

`pnpm audit --audit-level high` is a CI gate. This file records what tripped it, what the remedy was,
and — where an override was used — the evidence that the forced version actually works, because an
override that silently breaks a toolchain is worse than the advisory it silences.

**The rule this file exists to enforce:** never add an override merely to make the audit green. Prefer,
in order: a lockfile refresh within the declared range · a package upgrade · an override **verified
against the tool that consumes it** · documenting the exposure and leaving the gate red.

---

## GHSA-2v37-7h3g-55p8 — `nanoid` — resolved without an override

**High.** `nanoid` before 3.3.18 can loop indefinitely when a custom generator is given size zero.
Reached the tree through `apps/admin > @tailwindcss/postcss > postcss > nanoid`.

**Remedy: a lockfile refresh, nothing more.** `postcss@8.5.25` declares `nanoid ^3.3.16`, and the
patched `3.3.18` satisfies that range — so the fix was to take the patched transitive dependency in
place. No manifest changed, `postcss` stayed at 8.5.25, and Tailwind was untouched. Merged in #13
(`7c29a92`).

## GHSA-ggr8-5vv4-36mx — `deepmerge-ts` — override, verified

**High.** DeepmergeTS has stack exhaustion when merging recursive object graphs. Vulnerable `<8.0.0`,
patched `>=8.0.0`. Reached the tree through exactly one path:

```
apps__api > prisma > @prisma/config > deepmerge-ts
```

**Why the nanoid remedy could not be reused.** `@prisma/config` does not declare a range — it pins
`deepmerge-ts: "7.1.5"` **exactly**, so there is no patched version inside the range to refresh to.

**Why upgrading Prisma does not help either.** Checked rather than assumed: `@prisma/config@7.9.1` —
the latest at the time of writing, and a *major* version ahead of the repository's `6.19.3` — pins the
**same** `deepmerge-ts: 7.1.5`. So no Prisma version fixes this, and a major Prisma upgrade would have
been a large architectural change that did not even address the finding.

That leaves an override as the only mechanism. It was added **and then tested**, not added and assumed:

```jsonc
"pnpm": { "overrides": { "deepmerge-ts": "^8.0.2" } }
```

**Evidence the forced version works.** `@prisma/config` is what the Prisma CLI uses to read
configuration, so the test is the CLI itself:

| Check | Result with `deepmerge-ts@8.0.2` |
|---|---|
| `pnpm audit --audit-level high` | **No known vulnerabilities found** |
| `prisma validate` | **PASS** — schema valid |
| `prisma migrate status` | **PASS** — 25 migrations, up to date, no drift |
| `turbo run build lint typecheck test --force --concurrency=1` | **PASS** — see the commit that added this entry |

`prisma generate` cannot be exercised in the development sandbox: the CLI tries to
`pnpm add prisma@6.19.3 -D` against the registry, which the sandbox blocks. **This was proved
pre-existing rather than assumed** — stashing the override, reinstalling from the unmodified lockfile
and re-running produced the identical failure, and the error names a registry write rather than
anything to do with merging. CI runs `prisma generate` on an unrestricted network.

**Exposure, stated plainly.** `prisma` is a **devDependency** of `apps/api`; `@prisma/config` is not in
the production runtime graph, and the vulnerable code merges *configuration files the repository
itself owns*, not user input. The finding was a build-toolchain exposure rather than a reachable
runtime one — which is the reason the override was allowed to be the answer, and **not** a reason it
could have been skipped: a high advisory on a CI gate is fixed or explained, never ignored.

**Not caused by the change it blocked.** The advisory was published after #13 merged, and the branch
carrying it changed no dependency file — `git diff origin/main...HEAD -- package.json pnpm-lock.yaml
'**/package.json'` was empty. `main` carried the same exposure at the same moment.

---

## 2026-10-28 — six critical, twenty high: complete remediation

`pnpm audit --audit-level high` on `main` reported **6 critical and 20 high** (26 advisories across 11
packages). Every one is resolved; the audit now reports **one low and nothing above it**. Each remedy
follows this file's order of preference.

**Lockfile refresh within the declared range** — the parent already accepts the patched version:

| Package | Path | From → to |
| --- | --- | --- |
| `proxy-addr` (critical) | `@nestjs/platform-express > express@5.2.1` (`^2.0.7`) | 2.0.7 → 2.0.8 |
| `body-parser` | `express@5.2.1` (`^2.2.1`) | 2.3.0 → 2.4.0 |
| `fast-uri` (5 advisories) | `@nestjs/cli > @angular-devkit/core > ajv` (`^3.0.1`) | 3.1.5 → 3.1.9 |
| `source-map-js` | `@tailwindcss/node` (`^1.2.1`) | 1.2.1 → 1.2.2 |
| `brace-expansion` (1.x and 5.x) | `minimatch` 3 (`^1.1.7`) and 10 (`^5.0.x`) | 1.1.18 → 1.1.21, 5.0.9 → 5.0.12 |
| `qs`, `fast-copy`, `js-yaml` (moderate) | `supertest`, `pino-pretty`, `@eslint/eslintrc` | to their patched releases |

**Upgrades:**

| Package | Advisory | Remedy |
| --- | --- | --- |
| `next` (2 critical, 2 high) | RCE in image optimisation and on Windows hosts; `<15.5.24`/`<15.5.28` | `^15.1.0` → `^15.5.28` in the three apps. Same major; the floor is raised so a fresh resolution cannot fall back |
| `tinypool` (2 critical) | prototype-pollution RCE, `<2.1.2` | **Vitest 3 → 4** (`^4.1.12`) in all 29 packages. Every Vitest 3 release pins `tinypool ^1`; Vitest 4 does not use it. Vitest 4 supports Node `^20 \|\| ^22 \|\| >=24`. No configuration change: `fileParallelism`, `globals`, `setupFiles` and the Admin portal's `esbuild.jsx` are unchanged in meaning |
| `zod` (high) | memory exhaustion on oversized constrained collections, `<4.6.6` | **Zod 3 → 4** (`^4.6.7`) in `packages/config`. No 3.x release is fixed. Every `.default()` in the environment schemas precedes its `.transform()`, so Zod 4's changed default semantics do not apply; the 62 configuration tests pass unchanged |

**Overrides, each the only remedy for an exact pin:**

| Override | Why | Verified by |
| --- | --- | --- |
| `multer: ^2.5.0` (high, 4 advisories) | `@nestjs/platform-express@11.2.8`, the latest release, pins `multer` **exactly** at 2.4.0 | the API's full suite on `@nestjs/platform-express` with multer 2.5.0 |
| `vite: ^7.3.7` (high and moderate, launch-editor and `server.fs.allow`) | Vitest 4 takes `vite` as an auto-installed peer (`^6 \|\| ^7 \|\| ^8`), so a refresh keeps the locked 7.3.6. The override stays on Vite 7 rather than letting the range jump to 8 | every package's test suite runs on vite 7.3.7 |
| `sharp: ^0.35.3` → `^0.35.5` (existing override raised) | `next@15.5.28` requires `^0.35.5` | `next build` of all three apps |

**Remaining, below the gate:** `deepmerge` ≤ 4.3.1, low — prototype poisoning of merged objects. No
fixed version exists (the advisory's patched range is empty). Reached only through
`@nestjs/cli > fork-ts-checker-webpack-plugin`, the Nest CLI's build-time type checker; not in the
API's runtime or image.

**Verification, on the remediated lockfile:** `pnpm install --frozen-lockfile` from an empty
`node_modules`; format, lint and typecheck; every migration on a fresh database; **5 607 tests in 24
packages** against PostgreSQL; build; `check:production-output`; `prisma validate`; standards,
architecture, localisation, dependencies and platform parity; `pnpm audit --audit-level high` clean.
