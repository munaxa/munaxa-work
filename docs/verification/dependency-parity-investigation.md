# Dependency Parity & Design-System Baseline

An investigation into why a green local gate did not mean a green CI gate, and what it takes to
make it mean one. No product slice was built and no completed slice was touched.

---

## A. Incident

PR #16 passed every local gate — `pnpm standards`, `format:check`, `lint`, `typecheck`, `test`,
`build` — and failed CI typecheck on one line:

```text
src/shell/workspace-shell.tsx(125,15): error TS2322
Property 'railLabel' does not exist on type 'IntrinsicAttributes & SidebarProps'.
```

The branch was corrected by removing the prop, and CI went green. That fix was right, but the
explanation given at the time was wrong in two ways, and both matter:

- **It named the wrong package.** The report said the skew was in `@munaxa/ui`, local **1.6.1**
  against a pinned **1.1.1**. `@munaxa/ui` was 1.1.1 in both places. The package that had moved
  was `@munaxa/platform`: **1.6.1** locally against **1.3.0** pinned.
- **It cited the wrong evidence.** The prop list quoted as "`SidebarProps` at `@munaxa/ui@1.1.1`"
  was read from `@munaxa/platform`'s source. `@munaxa/ui` has no `sidebar.tsx` and never did.

The prop list itself was correct, and the fix it justified was correct. Sections C and G restate
both from evidence.

---

## B. Current dependency inventory

Work depends on five `@munaxa/*` packages. There is no `@munaxa/design-system`; that name does
not exist in this ecosystem.

| Package | Declared range | Declared by | Purpose |
| --- | --- | --- | --- |
| `@munaxa/platform` | `^1.3.0` | `apps/admin`, `apps/employee-portal`, `apps/manager-portal` | the implementation: every component, hook and token |
| `@munaxa/theme` | `^1.1.1` | the same three applications | façade re-exporting `@munaxa/platform/theme` |
| `@munaxa/ui` | `^1.1.1` | the same three applications | façade re-exporting `@munaxa/platform` |
| `@munaxa/config-eslint` | `^1.0.0` | all 30 workspaces | shared ESLint configuration |
| `@munaxa/config-typescript` | `^1.0.0` | all 30 workspaces | shared TypeScript configuration |

All five are published from `munaxa/munaxa-platform` to GitHub Packages. The committed `.npmrc`
maps the scope and deliberately holds no credential:

```ini
@munaxa:registry=https://npm.pkg.github.com
```

**`@munaxa/ui` is a buildless façade.** Its entire type surface is one line:

```ts
// @munaxa/ui — re-exports @munaxa/platform.
// Buildless façade: edit the implementation in packages/platform, never here.
export * from '@munaxa/platform';
```

Work imports `@munaxa/ui` and nothing else — `grep` finds **zero** direct imports of
`@munaxa/platform` anywhere in `apps/` or `packages/`. The direct `@munaxa/platform` dependency
exists only so pnpm links its `munaxa-sync-brand` bin, which copies approved product artwork into
each application's `public/` on `predev` and `prebuild`. `scripts/check-dependencies.mjs` already
documents this, and it is load-bearing: dropping the declaration would leave every application
serving no logo.

That façade is the whole reason nothing warned. `@munaxa/ui`'s version says nothing about its API.

---

## C. Local resolution

Every `@munaxa/*` package in this container is a **`file:` install pointing into a scratchpad
directory outside the repository**. None came from the registry. Recorded by pnpm in
`node_modules/.modules.yaml`:

```text
@munaxa/platform@file:../../../tmp/.../scratchpad/munaxa-platform/packages/platform
@munaxa/theme@file:../../../tmp/.../scratchpad/munaxa-platform/packages/theme
@munaxa/ui@file:../../../tmp/.../scratchpad/munaxa-platform/packages/ui
```

`@munaxa/config-eslint` and `@munaxa/config-typescript` are the same, from that checkout's
`tooling/` directory.

As found at the start of this investigation:

| Package | Local version | Lockfile | Same version? | Same content? |
| --- | --- | --- | --- | --- |
| `@munaxa/platform` | **1.6.1** | **1.3.0** | **no** | **no** |
| `@munaxa/theme` | 1.1.1 | 1.1.1 | yes | yes |
| `@munaxa/ui` | 1.1.1 | 1.1.1 | yes | yes |
| `@munaxa/config-eslint` | 1.0.0 | 1.0.0 | yes | yes |
| `@munaxa/config-typescript` | 1.0.0 | 1.0.0 | yes | yes |

The four "yes, yes" rows are not an assumption. The scratchpad checkout was `munaxa-platform`
at `d0a29ec` (HEAD); the commit that published Work's pinned set is `7549319`. Between them,
`git diff 7549319 d0a29ec -- packages/ui packages/theme tooling` is **empty**. Those four
packages are byte-identical across the range. Exactly one package was wrong, and it was the one
nothing imports by name.

**How the wrong one reached the compiler.** The façade resolves its own dependency from beside
itself in the virtual store, not from the application that imported it:

```text
node_modules/.pnpm/@munaxa+ui@file+…/node_modules/@munaxa/
  ├── platform -> ../../../@munaxa+platform@file+…/node_modules/@munaxa/platform   ← 1.6.1
  └── ui/                                                                          ← 1.1.1
```

So `apps/admin` imported `@munaxa/ui@1.1.1` — the pinned version, correct — and TypeScript
followed `export * from '@munaxa/platform'` into 1.6.1. Repointing the application-level symlink
alone would not have fixed it; this is the link that decides.

---

## D. CI resolution

CI is fully determined and needs no inference. `.github/workflows/ci.yml`:

```yaml
- uses: actions/setup-node@v6
  with:
    registry-url: 'https://npm.pkg.github.com'
    scope: '@munaxa'

- name: Install dependencies
  run: pnpm install --frozen-lockfile
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`--frozen-lockfile` means CI installs exactly what `pnpm-lock.yaml` pins, and the lockfile pins
all five to registry tarballs on `npm.pkg.github.com` — no `file:`, no `link:`:

| Package | CI installs | Resolution |
| --- | --- | --- |
| `@munaxa/platform` | **1.3.0** | `npm.pkg.github.com/download/@munaxa/platform/1.3.0/…` |
| `@munaxa/theme` | 1.1.1 | `…/@munaxa/theme/1.1.1/…` |
| `@munaxa/ui` | 1.1.1 | `…/@munaxa/ui/1.1.1/…` |
| `@munaxa/config-eslint` | 1.0.0 | `…/@munaxa/config-eslint/1.0.0/…` |
| `@munaxa/config-typescript` | 1.0.0 | `…/@munaxa/config-typescript/1.0.0/…` |

The lockfile also pins the façades' own dependency: both `@munaxa/ui@1.1.1` and
`@munaxa/theme@1.1.1` depend on `@munaxa/platform: 1.3.0` exactly. Every `link:` in the lockfile
is a `@work/*` workspace package. **The committed repository was never wrong.**

---

## E. Root cause

Four facts compose into the failure. Each is ordinary; together they are silent.

1. **The applications declare `@munaxa/platform: ^1.3.0`.** A caret admits 1.6.1. The lockfile
   narrows it to 1.3.0, but only for an install that reads the lockfile.
2. **Somebody ran an install that did not.** At some point `@munaxa/*` was added as `file:`
   dependencies pointing at a local `munaxa-platform` checkout — the standard way to work on
   platform and product together. `package.json` was afterwards restored to the published
   ranges, and it is clean today: `git grep '"file:' -- '*.json'` finds nothing. But
   `node_modules` was never reinstalled, so the file-linked tree survived the revert. Every
   local gate from that point on ran against it.
3. **That checkout sat at platform HEAD**, `d0a29ec` = 1.6.1, three minor versions past the pin.
4. **The façade hid it.** `@munaxa/ui` — the only name Work imports — reported 1.1.1, matching
   the lockfile. So did `@munaxa/theme`. Two of the three design-system packages agreed with the
   lockfile perfectly, and the third was never named in a single import statement.

**Version equality is not API equality here.** `@munaxa/ui@1.1.1` was published once, at
`7549319`, and its content has not changed since — but the API it re-exports is whatever
`@munaxa/platform` it resolves against. Comparing version numbers alone, in a repository that
uses buildless façades, cannot detect this class of skew. Only comparing *provenance* can.

Nothing about the environment was uniquely at fault. Any developer who source-links platform,
reverts the manifest and does not reinstall lands in exactly this state, on any machine.

---

## F. GitHub Packages access

This environment **cannot** install the pinned packages, and the reason previously reported was
wrong. The earlier claim was that `GITHUB_TOKEN` / `NODE_AUTH_TOKEN` exist but lack the
`read:packages` scope. There is no scope to lack.

Measured, without exposing any value:

- `GITHUB_TOKEN`, `NODE_AUTH_TOKEN` and `GH_TOKEN` are all set to the same **14-character
  non-secret sentinel**, the literal string `proxy-injected`. It is a placeholder, not a
  credential.
- `/root/.npmrc` sets `//npm.pkg.github.com/:_authToken` to that same sentinel.
- `GET https://npm.pkg.github.com/@munaxa%2fplatform` returns **HTTP 401**
  `{"error":"unauthenticated: User cannot be authenticated with the token provided."}` under
  both the `Bearer` and `token` schemes. The request reaches GitHub; the sentinel is rejected.
- `GET https://api.github.com/user` returns **200** with `X-Oauth-Scopes:` empty and a
  15,000/hour rate limit — the signature of a GitHub App installation token, not a PAT.
- `git ls-remote https://github.com/munaxa/munaxa-work.git` succeeds against a private
  repository.

So the session's egress proxy substitutes a real credential for `github.com` (git) and
`api.github.com` (REST), and does **not** substitute one for `npm.pkg.github.com`. The sentinel
is forwarded verbatim and refused. This is not an organization egress denial: the proxy status
endpoint reports no relay failures, and the 401 is GitHub's own application-level answer.

**What is missing.** To install these packages, an environment needs a credential presented to
`npm.pkg.github.com` that carries **`read:packages`** on the `munaxa` organization — a classic
PAT with `read:packages`, a fine-grained token with **Packages: Read**, or, in Actions, the
job's `secrets.GITHUB_TOKEN` with `permissions: packages: read`, which the `node` job already
declares and which is why CI installs cleanly. No such credential exists in this container, and
none was created: embedding one in the repository would be a far worse outcome than the skew.

**How the published API was read without the registry.** `munaxa/munaxa-platform` is reachable
over git through the proxy. Cloning it and walking `packages/platform/package.json`'s version
history identifies the publishing commit for every pinned version exactly — including
`7549319`, the single commit carrying all five of Work's pinned versions at once. That is
primary evidence, and it is what Section G rests on.

---

## G. Design-system API comparison

`SidebarProps` at `@munaxa/platform@1.3.0` — commit `828a089`, verified two ways: read from
source at that commit, and read from `dist/ui/shell/sidebar.d.ts` after building that commit
with the package's own `tsc -p tsconfig.build.json`:

```ts
export interface SidebarProps {
  brand?: ReactNode | ((collapsed: boolean) => ReactNode);
  footer?: ReactNode;
  collapseLabel?: string;
  expandLabel?: string;
  collapsible?: boolean;
  children: ReactNode;
  className?: string;
}
```

Seven props. No `railLabel`. Removing it from `workspace-shell.tsx` was correct.

`railLabel` was introduced in **`@munaxa/platform@1.5.0`**, commit `fc6a8e2`,
*"fix(a11y): make the navigation rail a named landmark, not a bare div (#14)"*. It is not a
cosmetic addition. The rail element has had three shapes:

| Platform | Rail element | Accessibility consequence |
| --- | --- | --- |
| 1.3.0 – 1.3.1 | `<aside>` | an **unnamed `complementary`** landmark |
| 1.4.0 – 1.4.3 | `<div>` | **no landmark at all** — the brand lockup sits outside the landmark tree; axe `region`, one node on every route, in both themes |
| 1.5.0 and later | `<nav aria-label={railLabel}>` | a named `navigation` landmark; a landmark list reads "Workspace › Main" |

**Work runs 1.3.0, so it ships the `<aside>` shape.** That is an unnamed complementary landmark —
a real but minor finding, and only an axe `landmark-unique` violation when a second unnamed
complementary shares the page, which Work's admin shell does not currently render.

The important consequence is for any upgrade: **1.4.0 through 1.4.3 are strictly worse than
1.3.0** for this element. An upgrade that stops in the 1.4 range would introduce the `region`
violation Work does not currently have.

---

## H. Recommended dependency model

The four options in the brief, judged against what this repository already does:

- **Option A — published package installation.** Already the intended model, already correctly
  committed, and the model CI enforces. What was missing is any check that a *local* install
  obeys it.
- **Option B — explicit source-development mode.** Needed. Developing Work against unreleased
  platform is a real workflow and the one legitimate reason to break parity. It has to be
  deliberate, visible, and incapable of being mistaken for a verified run.
- **Option C — platform version bump.** A separate decision, on its own evidence. Section M.
  Not a fix for this problem.
- **Option D — monorepo/workspace integration.** Rejected. Work is deliberately an independent
  repository consuming a published platform — the root `package.json` says so, CI enforces a
  "Product isolation" gate against cross-product imports, and `docs/adr` treats the boundary as
  settled. Dissolving it to make dependency management easier would trade an architectural
  decision for a tooling convenience.

**Recommendation: A as the rule, B as the named exception, enforced by a gate.** That is what
was built, and nothing else about the dependency model changed.

`scripts/check-platform-parity.mjs` asks the two questions the lockfile cannot answer alone:

- **Declaration** — does any tracked manifest, or the lockfile, resolve an `@munaxa/*` package
  from a path? Needs no `node_modules`, so it runs on a bare checkout in CI's standards job.
- **Installation** — for every workspace that declares one, does the package Node actually
  resolves carry the version the lockfile pins, **from the registry's virtual store**? And does
  the `@munaxa/ui` façade re-export the pinned `@munaxa/platform`, rather than whichever one sits
  higher up the tree? That last row is checked explicitly, because it is the link that decided
  the incident and the one a per-workspace check misses.

It reports what it resolved on **every** run, which is what makes "`pnpm verify` passed" a
statement about known versions rather than a hope:

```text
Platform parity: the @munaxa/* this run resolved.

  @munaxa/config-eslint      1.0.0 = lockfile 1.0.0  registry
  @munaxa/config-typescript  1.0.0 = lockfile 1.0.0  registry
  @munaxa/platform           1.3.0 = lockfile 1.3.0  registry
  @munaxa/theme              1.1.1 = lockfile 1.1.1  registry
  @munaxa/ui                 1.1.1 = lockfile 1.1.1  registry
```

The two finding classes are kept apart because they are answered differently. A **declared** path
is committed: it reaches every consumer, no reinstall fixes it, and nothing may wave it through.
A **resolved** path is one machine's `node_modules`, fixed by reinstalling, and is precisely what
Option B wants. So `MUNAXA_ALLOW_PLATFORM_SOURCE=1` downgrades the second to a banner and has no
effect at all on the first. It is an environment variable rather than a setting on purpose:
nothing committed can turn this gate off for somebody who did not choose it.

---

## I. Changes made

Four files. No application source, no domain logic, no contract, no route, no migration.

| File | Change |
| --- | --- |
| `scripts/check-platform-parity.mjs` | **new** — the gate described in H |
| `package.json` | appended `node scripts/check-platform-parity.mjs` to the `standards` script, so `pnpm verify` runs it |
| `.github/workflows/ci.yml` | ran it in the `standards` job (declarations, no install) and in the `node` job after install (full, and a record of the versions CI compiled) |
| `docs/verification/dependency-parity-investigation.md` | this document |

No dependency version changed. No `package.json` range changed. `pnpm-lock.yaml` is untouched —
it was already correct.

**Local environment, uncommitted.** The scratchpad `munaxa-platform` checkout was moved from HEAD
(`d0a29ec`, platform 1.6.1) to `7549319`, the commit carrying all five of Work's pinned versions,
and `packages/platform` was rebuilt there with its own `tsc -p tsconfig.build.json`. Its `dist`
and `package.json` were then swapped into the virtual store entry pnpm had already created. This
restores **content** parity with published 1.3.0 without a registry; it does not restore
**provenance** parity, and the gate correctly still says so. Nothing about it leaves the
container.

The first attempt did this by pointing the store entry at the checkout directly, and it is worth
recording why that failed: 253 admin tests died on
`Cannot read properties of null (reading 'useId')` — two copies of React. A symlink out of the
tree takes the target's `node_modules` with it, so the platform components rendered against the
platform checkout's React while the tests ran on Work's. Swapping only `dist` into the entry pnpm
built keeps pnpm's `react` and `react-dom` links intact, and both now resolve to the same
`react@19.2.8`. It is a small illustration of the same lesson: a source link is not a substitute
for an install, and the ways it differs are not confined to the type surface.

---

## J. Changes deliberately NOT made

- **No product work.** Slice #8 was not started or selected. Assets, Self-Service, Manager
  Workspace, Learning, Career, Relations, Organization and Identity were not touched.
- **The seven completed slices are untouched** — no source, test, contract, permission or route
  in Employee Record, Approvals, Hiring, Payroll, Leave, Attendance or Performance changed.
- **`@munaxa/ui` was not upgraded.** No range moved and the lockfile was not relocked. Section M
  puts that decision to the owner with the evidence for it.
- **`railLabel` was not restored.** It does not exist at the pinned version; restoring it requires
  a platform upgrade that is not authorized here.
- **No `file:` dependency was committed**, and no machine-specific path was written to any tracked
  file. The gate now proves this on every run, including on a bare checkout.
- **No credential was created, embedded or worked around.** The registry stays unreachable from
  this container, and Section F says exactly what would fix that.
- **CI was not weakened.** No check was removed, relaxed or made non-required; two steps were
  added.
- **The known open findings stay open** — HTTP not-found semantics, authorization consistency,
  identifier consistency, cross-module contract exports and the product-coherence findings are
  all untouched.
- **No dependency-management architecture was invented.** One script, in the directory where the
  other four gates live, wired into the script that already chains them.

---

## K. Verification

Commands and results, in order.

**The gate's own behaviour**, exercised in all four states. The bare-checkout cases used a real
`git worktree` with no `node_modules`, which is what CI's standards job runs:

| State | Expected | Exit |
| --- | --- | --- |
| Bare checkout, clean manifests | pass, nothing resolved | **0** ✅ |
| Bare checkout, a `file:` injected into `apps/admin/package.json` | fail, declaration | **1** ✅ |
| Same, **with** `MUNAXA_ALLOW_PLATFORM_SOURCE=1` | still fail — the override must not cover a committed path | **1** ✅ |
| This container: path installs, versions correct | fail, installation, 5 findings | **1** ✅ |
| Same, with the override | warn, banner, proceed | **0** ✅ |

The injected-`file:` case reproduced the exact defect the gate exists to prevent:

```text
apps/admin/package.json declares "@munaxa/ui": "file:../../../platform/packages/ui"
  — a path, not a published range.
```

**Published API, verified from source.** `@munaxa/platform@1.3.0` = commit `828a089`; built with
the package's own build script; `dist/ui/shell/sidebar.d.ts` carries seven props and no
`railLabel`. `railLabel` first appears at `fc6a8e2` = 1.5.0.

**Full gate.** `pnpm verify` with `TURBO_FORCE=true` (no cached replay), PostgreSQL 16 live with
31 of 31 migrations applied, and `MUNAXA_ALLOW_PLATFORM_SOURCE=1` — because this container cannot
install from the registry, and the gate correctly refuses to certify a path install without it.

```text
Engineering Standards: no violations.
Architecture: 186 model(s) checked, no violations.
Localization: 20 catalogue set(s) complete.
Dependencies: 2013 source file(s), no cycles, no unused dependencies, no unreachable files.
Platform parity: @munaxa/platform 1.3.0, theme 1.1.1, ui 1.1.1, config-* 1.0.0
                 — all equal to the lockfile, all reported as path installs
```

| Stage | Result |
| --- | --- |
| `standards` | 5 gates, no violations |
| `format:check` | clean |
| `lint` | **51 successful, 51 total**, 0 cached — 1m41.556s |
| `typecheck` | **51 successful, 51 total**, 0 cached — 42.515s |
| `test` | **51 successful, 51 total**, 0 cached — 8m16.017s |
| `build` | **29 successful, 29 total**, 0 cached — 1m30.358s |
| **`pnpm verify`** | **exit 0** |

**462 test files, 5,306 tests, 0 failed, 0 skipped.** Every turbo task was a cache miss, so
nothing was replayed. The only three lines in the log matching `failed` or `skipped` are the
parity gate's own warning text, a test *named* "…and nothing skipped", and a fixture that asserts
a connection error — no test failed.

This is the run the incident's fix needed and never got: Work's committed source compiling,
linting, testing and building against the API of published `@munaxa/platform@1.3.0`.

**What a local run in this container can and cannot prove.** It proves Work's committed source
compiles, lints, tests and builds against the **content** of published `@munaxa/platform@1.3.0`,
because that is now what is on disk. It does not prove provenance, and the gate says so on every
run rather than letting a reader assume otherwise. CI remains the authority.

---

## L. CI

PR #17, head `377b476`. All four required checks green:

| Check | Result |
| --- | --- |
| Standards · Architecture · Localization | ✅ success |
| Product isolation | ✅ success |
| Mobile | ✅ success |
| Lint · Typecheck · Test · Build | ✅ success |

The standards job runs the gate on a bare checkout with no `pnpm install` at all, which is the
declaration half — it passed, so the gate does not depend on the registry being reachable, exactly
like the four gates beside it.

The `node` job runs it after `pnpm install --frozen-lockfile` against `npm.pkg.github.com`, and
that run is the positive proof this container cannot produce:

```text
Platform parity: the @munaxa/* this run resolved.

  @munaxa/config-eslint      1.0.0 = lockfile 1.0.0  registry
  @munaxa/config-typescript  1.0.0 = lockfile 1.0.0  registry
  @munaxa/platform           1.3.0 = lockfile 1.3.0  registry
  @munaxa/theme              1.1.1 = lockfile 1.1.1  registry
  @munaxa/ui                 1.1.1 = lockfile 1.1.1  registry

Platform parity: 5 package(s) match the lockfile, all from the registry.
```

Two things are settled by those nine lines. The gate goes green on a genuine registry install
rather than only failing on a bad one — so it is a gate and not a permanent red. And the exact
versions CI compiled, linted, tested and built are now printed in the CI log itself, next to a
local run that prints the same table. Comparing the two is the whole mechanism.

---

## M. Remaining owner decisions

**1. Should Work stay on `@munaxa/platform@1.3.0`?**

Staying is safe and is the default until someone decides otherwise. Three things argue for
moving, and they are accessibility fixes rather than features — 1.4.0 through 1.5.1 are almost
entirely `fix(a11y)` releases:

- 1.5.0 makes the navigation rail a named `navigation` landmark. Work currently ships an unnamed
  `complementary`.
- 1.5.1 stops menus hiding the whole application from assistive technology.
- 1.4.3 makes `Switch` and `Checkbox` honour the `Field` labelling contract.

Work is a bilingual product with a screen-reader audience, and this is the layer those users
meet first.

**If Work upgrades, it must not stop between 1.4.0 and 1.4.3.** In that range the rail is a bare
`<div>` with no landmark at all — strictly worse than the `<aside>` Work ships today. The
meaningful targets are **1.5.1** (the accessibility fixes, nothing else) or **1.6.1** (those plus
`TreeView`, a feature Work does not use). 1.5.1 is the smaller, better-justified step.

Not a decision to take inside this task: an upgrade relocks the design system under all three
applications and needs its own verification pass.

**2. Should `railLabel` be introduced?**

It arrives with the 1.5.0 upgrade — it is not separable. If Work upgrades, it should be passed
with a translated string, because the rail's accessible name would otherwise be the component's
English default `'Workspace'` in Arabic too. Two translation keys are needed, one per language.
`collapseLabel` and `expandLabel` already exist at 1.3.0 and are already translated.

**3. Package publishing and access.**

Any environment expected to run a meaningful local gate needs a credential for
`npm.pkg.github.com` carrying `read:packages` on the `munaxa` organization (Section F). Without
one, `pnpm install --frozen-lockfile` cannot succeed and the parity gate will fail every local
run — correctly, because such a run genuinely proves nothing about CI. This is an environment
provisioning decision, not a repository one, and no workaround belongs in the repository.

**4. The source-link development workflow.**

`MUNAXA_ALLOW_PLATFORM_SOURCE=1` is now the sanctioned way to develop Work against unreleased
platform. Worth confirming as policy, together with the rule the gate encodes: a run under that
variable is never reported as equivalent to a green CI gate.

---

## Success criteria

| # | Question | Answer |
| --- | --- | --- |
| 1 | What exact `@munaxa/*` versions does Work depend on? | platform 1.3.0, theme 1.1.1, ui 1.1.1, config-eslint 1.0.0, config-typescript 1.0.0 |
| 2 | What does CI install? | Those five, from `npm.pkg.github.com`, via `--frozen-lockfile` |
| 3 | What does local verification use? | The same five versions, but as `file:` installs from a source checkout — content-identical, provenance different |
| 4 | Are local and CI now identical? | **No.** Content matches; provenance does not |
| 5 | If not, why not? | This container has no credential for `npm.pkg.github.com` — `GITHUB_TOKEN` is the sentinel `proxy-injected` (Section F) |
| 6 | Can a future session accidentally typecheck against Platform HEAD? | **No.** The gate fails on a version or provenance mismatch. Only deliberately, under `MUNAXA_ALLOW_PLATFORM_SOURCE=1`, which prints that the run proves nothing about CI |
| 7 | Can a future session accidentally commit a `file:` dependency? | **No.** The declaration half fails on any path specifier in a tracked manifest or in the lockfile, runs without an install, and the override cannot suppress it |
| 8 | What permission installs private GitHub Packages? | `read:packages` on the `munaxa` organization, presented to `npm.pkg.github.com` |
| 9 | Should Work stay on the pinned version? | Owner decision. Staying is safe; 1.5.1 is the better-justified move; 1.4.x is a regression (Section M) |
| 10 | Should `railLabel` arrive via a platform release? | It already did — platform 1.5.0. It reaches Work only through an authorized upgrade |

The criterion that matters: **a green local gate must mean something materially equivalent to a
green CI gate.** It now does, on any machine that can install the pinned packages. On a machine
that cannot, the gate says so instead of going green — which is the same guarantee, honestly
stated.

---

# DEPENDENCY PARITY INVESTIGATION COMPLETE — AWAITING OWNER DECISION
