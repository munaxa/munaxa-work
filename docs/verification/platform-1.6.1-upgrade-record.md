# Shared Design System — Platform Upgrade Investigation

Moving Munaxa Work off `@munaxa/platform@1.3.0`. Commissioned as a 1.5.1 upgrade; the evidence
changed the target to **1.6.1**.

Sections A–P are the investigation, written when this environment could not reach the package
registry and the upgrade could not be performed. **Sections Q–V are the implementation**, carried
out once `read:packages` was provisioned, against the real published package. Where the two
disagree, Q–V is the measurement and A–P is the prediction it confirmed.

No product slice was built and no completed slice was touched.

---

## A. Current baseline

Munaxa Work, `main` at `efa18ce`, verified from `pnpm-lock.yaml` rather than from history:

| Package | Range declared | Locked | Declared by |
| --- | --- | --- | --- |
| `@munaxa/platform` | `^1.3.0` | **1.3.0** | `apps/admin`, `apps/employee-portal`, `apps/manager-portal` |
| `@munaxa/theme` | `^1.1.1` | 1.1.1 | the same three |
| `@munaxa/ui` | `^1.1.1` | 1.1.1 | the same three |
| `@munaxa/config-eslint` | `^1.0.0` | 1.0.0 | all 30 workspaces |
| `@munaxa/config-typescript` | `^1.0.0` | 1.0.0 | all 30 workspaces |

The parity guard added by PR #17 is present and wired into `standards` and both CI jobs. CI
installs with `--frozen-lockfile` against `npm.pkg.github.com`.

---

## B. Target

**The brief named 1.5.1. The evidence says 1.6.1**, and the owner confirmed that target.

Nothing in the ecosystem runs 1.5.1. Read from each repository's committed lockfile:

| Product | Application | Locked `@munaxa/platform` |
| --- | --- | --- |
| **Docs** | `apps/web` | **1.6.1** |
| **School** | `apps/admin` | **1.5.2** |
| School | `landing`, `munaxademo` | 1.3.0 |
| **Work** | three applications | **1.3.0** |

Moving Work to 1.5.1 would have created a *fourth* distinct version and aligned it with nothing.
1.6.1 is the only version already proven in a shipped product, and its caret also satisfies
School's `^1.5.2`, so School's admin lands on it at its next relock. That is one baseline rather
than four.

**1.5.1 is real.** It was published from commit `61810a6` on 2026-08-15. Publication is not
inferred from the version in `package.json` — the platform's `release.yml` is `workflow_dispatch`
with `dry_run` defaulting to `true`, so a version on `main` is not evidence of a release. The
Release run for `61810a6` shows step `Publish` → **success** and `Pack only (dry run)` →
**skipped**. The same check confirms 1.5.0, 1.5.2 and **1.6.1** (`d0a29ec`, 2026-08-18).

The rule from the brief holds and is now measured: **1.4.0–1.4.3 must be skipped.** See §H.

---

## C. Compatibility investigation

Both versions were built from source with the package's own `tsc -p tsconfig.build.json`, and
their emitted declarations diffed — not read from release notes.

**Exported symbols: 516 at 1.3.0, 527 at 1.6.1. Removals: zero.**

```text
=== REMOVED in 1.6.1 ===
(none)

=== ADDED in 1.6.1 ===
EXPORT TreeView          TYPE TreeBranch        TYPE TreeNavigationOptions
EXPORT buildBranches     TYPE TreeItemContext   TYPE TreeNode
EXPORT flattenVisible    TYPE TreeItemProps     TYPE TreeViewLabels
EXPORT useTreeNavigation                        TYPE TreeViewProps
```

**Props across every exported interface: 902 at 1.3.0, 937 at 1.6.1. Removed or made required:
zero.** Excluding the new `Tree*` types, the entire prop delta is two optional additions:

```text
InspectorLayoutProps.inspectorLabel?     (1.4.0)
SidebarProps.railLabel?                  (1.5.0)
```

One apparent removal was checked rather than assumed: `TreeNode.children/depth/node` appear to
vanish. At 1.3.0 `TreeNode` is a **module-private** interface inside `org-chart.d.ts`, exported
from no barrel; at 1.6.1 it is a new, unrelated public type in `tree-view.d.ts`. No consumer could
have depended on the 1.3.0 shape.

**So 1.3.0 → 1.6.1 is strictly additive at the type level.** The changelog agrees: across
1.3.1–1.6.1 there is no `Removed` and no `Deprecated` section, and every `Changed` entry describes
the platform's own accessibility test matrix rather than a consumer API.

**One behavioural change is consumer-visible**, from 1.5.1, and it is the only item in this range
that can alter how an existing screen behaves:

> `DropdownMenu` and `ContextMenu` were modal (Radix's default), so an open menu set
> `aria-hidden="true"` on the rest of the document. They are now non-modal. Two behaviours go with
> modality: focus is no longer trapped in the menu (Tab leaves it, as the menu-button pattern
> expects), and the body is no longer scroll-locked while it is open. **The `modal` prop is
> unchanged and still accepted**, so a consumer wanting the old behaviour passes it explicitly.

Work imports neither `DropdownMenu` nor `ContextMenu` (§E), so this cannot affect it.

The components the brief asked to watch — `Page`, `PageHeader`, tables, forms, `Dialog`, `Tabs`,
`Avatar`, responsive behaviour, RTL, theme tokens — show **no prop change and no export change**
between the two versions. The only interface in Work's entire surface that differs at all is
`SidebarProps`, and it differs by one added optional prop.

---

## D. Shared package inventory

| Application / package | Munaxa package | Current | Target | Direct / indirect |
| --- | --- | ---: | ---: | --- |
| Work `apps/admin`, `employee-portal`, `manager-portal` | `@munaxa/platform` | 1.3.0 | **1.6.1** | direct (for its `munaxa-sync-brand` bin) |
| the same three | `@munaxa/ui` | 1.1.1 | 1.1.1 | direct — the only one Work imports |
| the same three | `@munaxa/theme` | 1.1.1 | 1.1.1 | direct |
| all 30 Work workspaces | `@munaxa/config-eslint`, `@munaxa/config-typescript` | 1.0.0 | 1.0.0 | direct, dev |
| School `apps/admin` | `@munaxa/platform` | 1.5.2 | 1.6.1 on next relock | direct |
| School `landing`, `munaxademo` | `@munaxa/platform` | 1.3.0 | owner decision | direct |
| School | `@munaxa/icons`, `@munaxa/tokens` | 1.1.1 | 1.1.1 | direct |
| Docs `apps/web` | `@munaxa/platform` | **1.6.1** | already there | direct |
| Docs | `@munaxa/icons`, `@munaxa/tokens` | 1.1.1 | 1.1.1 | direct |

**The façade relationship decides how few packages have to move.** `@munaxa/ui` is a buildless
re-export whose whole body is `export * from '@munaxa/platform'`. It has been version **1.1.1
since commit `7549319`** and is still 1.1.1 at 1.6.1 — published once, when platform was 1.3.0.
Its manifest declares `"@munaxa/platform": "workspace:^"`, which pnpm rewrites on publish to a
caret range on the version current at that moment: `^1.3.0`. **That range admits 1.6.1.**

Consequences:

- **`@munaxa/ui` does not need a new release.** Neither does `@munaxa/theme`.
- **Only `@munaxa/platform` moves**, and only in the three Work application manifests.
- The façade's own `^1.3.0` then resolves onto 1.6.1 alongside the direct dependency, so one
  instance is installed, not two.

One residual risk is named rather than assumed away: this rests on published `@munaxa/ui@1.1.1`
carrying `^1.3.0` and not a pinned `1.3.0`. The lockfile records only the resolution, not the
range, and reading the range needs the tarball — which this environment cannot fetch (§M). If it
were pinned, `@munaxa/platform@1.3.0` would install *nested under the façade* while 1.5.1+ sat
above it, and since Work imports only through the façade it would compile against 1.3.0 and the
upgrade would silently do nothing. **The parity guard already checks exactly this**: its
`@munaxa/ui (façade re-export)` row asserts that what the façade resolves equals what the lockfile
pins. A relock that hit this would fail the gate rather than pass quietly.

---

## E. Work impact

**None. Work compiles, tests and builds against 1.6.1 unchanged.**

Work imports from `@munaxa/ui` at **85 sites** and from no other Munaxa package — `grep` over
`apps/` and `packages/` finds zero `@munaxa/platform` imports. Across those sites it uses **33
distinct symbols**:

```text
AppShell  AppShellProvider  Badge  BrandProvider  Button  Card  EmptyState  Grid  Inline
KpiGrid  NavigationDrawer  NavigationGroup  Page  PageHeader  ProductLogo  Section  Sidebar
SidebarNav  SidebarTrigger  Stack  StatCard  Surface  TBody  TD  TH  THead  TR  Table
TopBar  brandIcons  brandManifest  brandOpenGraphImage  productBrands
```

All 33 exist at both versions. Diffing the props of every interface behind them yields exactly one
line — an addition:

```text
--- SidebarProps
> SidebarProps.railLabel?
```

`DropdownMenu` and `ContextMenu` are not among them, so 1.5.1's modality change cannot reach Work.

Measured, not inferred: with 1.6.1 installed, `pnpm verify` with `TURBO_FORCE=true` and PostgreSQL
live returned **exit 0** — lint 51/51, typecheck 51/51, test 51/51, build 29/29, every task a cache
miss, **462 test files, 5,306 tests, 0 failed, 0 skipped** (§N). Identical to the 1.3.0 baseline.
No Work source change was required for compatibility.

---

## F. School impact

School's `apps/admin` already runs **1.5.2** and imports **79 distinct symbols** from
`@munaxa/ui`. Every one exists at 1.6.1, so the remaining step is a relock, not a code change —
its `^1.5.2` range already admits 1.6.1.

`landing` and `munaxademo` sit at 1.3.0 and would remain behind. Both are marketing/demo surfaces
rather than the product, which is why they are called out for a decision (§P) rather than moved
here.

School uses `@munaxa/icons` and `@munaxa/tokens`, which Work does not; both are 1.1.1 across the
ecosystem and unaffected.

Not verified: School's own gate was not run. This session has no install for School and no
registry credential to make one, so its compatibility is established at the API-surface level
only, which is where the `railLabel` class of defect lives. Running School's suite belongs with
whoever relocks it.

---

## G. Docs impact

**None — Docs is already on 1.6.1.** Its `apps/web` imports **85 distinct symbols** from
`@munaxa/ui`, all present at 1.6.1, which is unsurprising since it is the version Docs ships.

Docs is the reason 1.6.1 is the recommended target rather than the newest untried release: it is
the only version in the ecosystem with a product already running on it, and 1.5.1's menu fix was
found by opening Docs' own overlays.

---

## H. Accessibility

The primary reason for the upgrade, and the section the brief insisted must rest on rendered
markup rather than source. Work's admin was built against each version and driven in Chromium at
1440 px in both languages; what follows is read from the live DOM.

**Platform 1.3.0 — what Work ships today**

```html
<aside class="sticky top-0 hidden h-screen shrink-0 self-start p-3 md:block …">
```

Landmarks, English: `aside(unnamed) · nav[Main] · header · main · header`
Landmarks, Arabic: `aside(unnamed) · nav[الرئيسية] · header · main · header`

The rail is a **`complementary` landmark with no accessible name**. It also holds the brand
lockup, so that content is inside an anonymous complementary rather than the navigation structure.

**Platform 1.6.1 — no other change**

```html
<nav aria-label="Workspace" class="sticky top-0 hidden h-screen shrink-0 self-start p-3 md:block …">
```

Landmarks, English: `nav[Workspace] · nav[Main] · header · main · header`
Landmarks, Arabic: `nav[**Workspace**] · nav[الرئيسية] · header · main · header`

The rail becomes a **named `navigation` landmark** — a real improvement, and the one the upgrade
is for.

**But the upgrade alone introduces a localization defect.** In Arabic the rail's accessible name
renders as the English string `Workspace`, because Work passes no `railLabel` and the component
falls back to its English default. An Arabic screen-reader user would hear an English landmark
name in an otherwise fully Arabic navigation tree. **The upgrade must not ship without §I's
one-line change.**

The rail element by version, measured across the range, confirms the brief's instruction to skip
1.4.x:

| Platform | Rail element | Landmark |
| --- | --- | --- |
| 1.3.0 – 1.3.1 | `<aside>` | `complementary`, unnamed — **Work today** |
| **1.4.0 – 1.4.3** | `<div>` | **none at all** — the brand sits outside the landmark tree |
| 1.5.0 – 1.6.1 | `<nav aria-label>` | `navigation`, named |

Stopping in the 1.4 range would be strictly worse than not upgrading.

At 390 px the rail is absent in both versions and both languages, which is the component's
documented behaviour — `NavigationDrawer` owns navigation below the breakpoint, and the two can
never both be showing.

---

## I. RTL / localization

**Work already has the string.** `apps/admin/locales/{en,ar}.json` both carry
`admin.shell.workspace`:

| Key | en | ar |
| --- | --- | --- |
| `admin.shell.workspace` | `Workspace` | `مساحة العمل` |

It is declared in both catalogues and referenced by no code — provisioned and never wired up. So
the fix is one line in `apps/admin/src/shell/workspace-shell.tsx`, using the existing translator
with no new string, no new mechanism, and nothing hardcoded in React:

```tsx
<Sidebar
  brand={Brand}
  collapseLabel={t('admin.shell.collapse')}
  expandLabel={t('admin.shell.expand')}
  railLabel={t('admin.shell.workspace')}
>
```

Applied against 1.6.1 and re-rendered, this produces:

| Language | Rail landmark |
| --- | --- |
| English | `<nav aria-label="Workspace">` |
| Arabic | `<nav aria-label="مساحة العمل">` |

That change was made only to verify the result and has been **reverted** — it cannot compile
against the pinned 1.3.0, so it must land in the same commit as the version bump (§K).

The wider RTL sweep found no change. Across 8 screens × 2 widths × 2 languages = **32 screen loads
at 1.6.1**: every one HTTP 200, and **zero horizontal page scroll** at 1440 px and 390 px in
English and Arabic. `collapseLabel` and `expandLabel` were already translated at 1.3.0 and remain
so. No new RTL system was introduced.

---

## J. Visual regression

The structural comparison is in §H: the rail's element and landmark change; nothing else in Work's
33-symbol surface has a different prop or export between the versions, which bounds where a visual
change could originate.

Across the 32 loads at 1.6.1 — home, Employee Record, Approvals, Hiring, Payroll, Leave,
Attendance, Performance, at 1440 px and 390 px in both languages — the landmark structure is
identical on every screen and no page scrolls horizontally.

**One route threw, and it is not a regression.** `/leave` rendered Next's server-error page under
the local rig. Diagnosed rather than assumed: the scratchpad stub API, written for an earlier
slice, serves only two of the seven endpoints that screen reads.

```text
/leave/dashboard                -> 404
/leave/requests                 -> 404
/leave/balances/reconciliation  -> 200   ← wrong shape
/leave/policies                 -> 404
/leave/accrual-runs             -> 404
/leave/types                    -> 200
```

The 404s the page handles by failing closed. The fault is the third line: the stub's
`/leave/balances` pattern also matches `/leave/balances/reconciliation` and answers 200 with a
paged-balances body where a reconciliation is expected, producing
`TypeError: Cannot read properties of undefined (reading 'map')`. That is a defect in the test
double, is version-independent, and is contradicted by Leave's own render tests passing inside the
5,306.

Pixel-level before/after diffing was **not** performed. What is claimed here is structural and
functional equivalence, measured; it is not a claim that every pixel is unchanged.

---

## K. Changes made

**To the repository: this document only.** No `package.json`, no `pnpm-lock.yaml`, no application
source, no CI configuration.

The upgrade the evidence supports is small and fully specified, and is recorded here so it can be
applied in one pass once §M is resolved:

1. `apps/admin/package.json`, `apps/employee-portal/package.json`,
   `apps/manager-portal/package.json` — `"@munaxa/platform": "^1.3.0"` → `"^1.6.1"`.
2. `pnpm install` against `npm.pkg.github.com` to relock. `@munaxa/ui` and `@munaxa/theme` stay at
   1.1.1; only platform's resolution moves.
3. `apps/admin/src/shell/workspace-shell.tsx` — add `railLabel={t('admin.shell.workspace')}` and
   replace the doc comment explaining why it was absent.

Steps 1–2 without step 3 would regress Arabic (§H). Step 3 without steps 1–2 does not compile.
They are one change.

**To the local environment, uncommitted.** The scratchpad platform checkout was built at 1.6.1 and
its `dist` swapped into the pnpm virtual store to run the measurements above, under the documented
`MUNAXA_ALLOW_PLATFORM_SOURCE=1` development mode. The container has since been **restored to the
1.3.0 content that matches the lockfile**, and the parity guard confirms every package equals its
locked version again.

---

## L. Changes deliberately NOT made

- **No dependency version, range or lockfile entry changed** — the bump is blocked (§M), and
  editing manifests without a valid lockfile would fail CI's `--frozen-lockfile` immediately.
- **No product slice.** Slice #8 was not started or selected; Assets, Self-Service, Manager
  Workspace, Learning, Career, Relations, Organization and Identity were not touched.
- **The seven completed slices are untouched** — no source, test, contract, permission, route,
  schema or migration in Employee Record, Approvals, Hiring, Payroll, Leave, Attendance or
  Performance changed.
- **`railLabel` was not committed.** It was applied to verify §I's result and reverted.
- **The parity guard was not disabled, weakened or removed**, and CI was not modified. The guard
  in fact caught this investigation's own skew, reporting `@munaxa/platform 1.6.1 ≠ lockfile
  1.3.0` and requiring the documented override to proceed.
- **No `file:`, `link:` or `workspace:` specifier was committed**, and no machine-specific path was
  written to a tracked file.
- **No credential was created, embedded or worked around**, and no repository secret was touched.
- **School and Docs were not modified.** Their relocks belong to their own repositories.
- **The known open findings stay open** — HTTP not-found semantics, authorization consistency,
  identifier consistency, cross-module contract exports, Organization and Relations.

---

## M. Dependency parity

**The dependency change cannot be made in this environment, and this is the blocker the brief's
§23 anticipates.**

Re-measured this session, not carried over: `GITHUB_TOKEN`, `NODE_AUTH_TOKEN` and `GH_TOKEN` are
all the literal 14-character non-secret sentinel `proxy-injected`. A request to
`https://npm.pkg.github.com/@munaxa%2fplatform` returns **HTTP 401**
`{"error":"unauthenticated: User cannot be authenticated with the token provided."}`. The session's
proxy substitutes a real credential for git and for `api.github.com`, and does not substitute one
for the package registry.

Why that stops the upgrade rather than merely inconveniencing it:

- `pnpm` cannot resolve `@munaxa/platform@1.6.1` without the registry, so it cannot compute the
  tarball URL or the integrity hash a lockfile entry requires.
- Hand-writing those into `pnpm-lock.yaml` is forbidden by the brief and would be fabricating an
  integrity hash regardless.
- Simulating the release with `file:` or `link:` is forbidden, and would defeat the point: the
  object under test is the *published* package.
- CI installs with `--frozen-lockfile`, so manifests bumped without a matching lockfile fail at the
  install step.

**What is missing:** a credential presented to `npm.pkg.github.com` carrying **`read:packages`** on
the `munaxa` organization. In Actions this is `secrets.GITHUB_TOKEN` with `permissions: packages:
read`, which the `node` job already declares — which is why CI installs cleanly and this container
cannot. As the owner noted, provisioning it is an operations task and deliberately not something
solved inside the repository.

Local provenance during this investigation, from the guard itself: all five `@munaxa/*` packages
resolve from path installs in the pnpm virtual store, versions equal to the lockfile. The
measurements in §C–§J were taken with platform 1.6.1 swapped in under
`MUNAXA_ALLOW_PLATFORM_SOURCE=1`, which printed `PARITY NOT ENFORCED` and named the divergence on
every run. Nothing in that state was reported as CI-equivalent.

---

## N. Verification

**`pnpm verify` against platform 1.6.1**, `TURBO_FORCE=true` (no cached replay), PostgreSQL 16
live with 31 of 31 migrations applied, under the documented source-development override:

| Stage | Result |
| --- | --- |
| `standards` | 5 gates, no violations |
| `format:check` | clean |
| `lint` | **51 successful, 51 total**, 0 cached — 1m44.162s |
| `typecheck` | **51 successful, 51 total**, 0 cached — 39.497s |
| `test` | **51 successful, 51 total**, 0 cached — 7m53.642s |
| `build` | **29 successful, 29 total**, 0 cached — 1m23.637s |
| **`pnpm verify`** | **exit 0** |

**462 test files, 5,306 tests, 0 failed, 0 skipped** — identical to the 1.3.0 baseline recorded in
`dependency-parity-investigation.md`.

An earlier run of the same gate failed at `@work/persistence#test` with
`connect ECONNREFUSED 127.0.0.1:5432`. That was PostgreSQL stopping mid-run, not a compatibility
finding; it is recorded because the run happened, and the gate was re-run from clean after
restarting the database.

Also measured: `tsc -p apps/admin/tsconfig.json --noEmit` against 1.6.1 → exit 0; the API surface
diff in §C; the rendered-markup capture in §H; the 32-load responsive sweep in §I/§J.

---

## O. CI

**No CI run for an upgrade, because no dependency change was made** (§K, §M). Opening a PR that
bumps manifests without a lockfile would fail at `pnpm install --frozen-lockfile` and prove
nothing.

This document is committed on the working branch and passes the repository's own gates. The CI
result that matters for the upgrade cannot exist until §M is resolved.

---

## P. Remaining owner decisions

**1. Confirm 1.6.1 as the ecosystem baseline.** Recommended and already selected. Docs runs it;
School's `^1.5.2` admits it; Work needs three manifest lines. The alternative — holding Work at
1.3.0 — keeps an unnamed `complementary` landmark and leaves three products on three versions.

**2. Provision `read:packages` for local environments.** Section M. Until then no session can
relock, and the parity guard will correctly refuse to call any local gate CI-equivalent.

**3. School's `landing` and `munaxademo`.** Both sit at 1.3.0. Neither is the product, so this is a
judgement about how far the "one baseline" rule reaches, and it belongs to School's owners.

**4. Whether the upgrade lands as one commit.** The recommendation is yes: the three manifest
lines, the relock and the `railLabel` line are a single change, because steps 1–2 without step 3
regress Arabic accessibility and step 3 alone does not compile.

**5. `@munaxa/icons` and `@munaxa/tokens`.** School and Docs depend on both; Work depends on
neither and needs nothing from them. Worth confirming that is intended rather than an oversight, but
nothing in this upgrade turns on it.

---

## Q. Implementation

Five files. Three of them carry one changed line each.

| File | Change |
| --- | --- |
| `apps/admin/package.json` | `"@munaxa/platform": "^1.3.0"` → `"^1.6.1"` |
| `apps/employee-portal/package.json` | the same one line |
| `apps/manager-portal/package.json` | the same one line |
| `pnpm-lock.yaml` | relocked by `pnpm install` — 11 insertions, 11 deletions, all of them the platform resolution |
| `apps/admin/src/shell/workspace-shell.tsx` | `railLabel={t('admin.shell.workspace')}` added to `Sidebar`, and the doc comment explaining its previous absence replaced |

**`@munaxa/ui` and `@munaxa/theme` did not move**, and neither needed a new release. §D predicted
this from `workspace:^` semantics; the published tarballs now confirm it directly:

```json
@munaxa/ui@1.1.1     dependencies: { "@munaxa/platform": "^1.3.0" }
@munaxa/theme@1.1.1  dependencies: { "@munaxa/platform": "^1.3.0" }
```

A caret, not a pin — so both façades resolve onto 1.6.1 rather than dragging 1.3.0 along beneath
them. That was the one residual risk §D named and could not settle without registry access. It is
settled: **the lockfile now contains zero references to `@munaxa/platform@1.3.0`**, and every
symlink in the tree — the two façades, the hoisted entry and all three applications — points at
the same 1.6.1 instance. One copy, not two.

No new translation key was created, no Arabic string was hardcoded, and no navigation was
redesigned. `admin.shell.workspace` already existed in both catalogues and had never been
referenced by any code; this consumes it.

---

## R. Registry verification

The credential was verified **before** any manifest was touched, per the brief's §1.

`GITHUB_TOKEN` is still the non-secret sentinel `proxy-injected` — that variable was never the one
that changed. `NODE_AUTH_TOKEN` now carries a real 40-character classic PAT. A probe with it:

```text
GET https://npm.pkg.github.com/@munaxa%2fplatform   →  HTTP 200
versions: 1.0.0 1.0.1 1.0.2 1.1.0 1.2.0 1.3.0 1.3.1 1.4.0 1.4.1 1.4.2 1.4.3
          1.5.0 1.5.1 1.5.2 1.6.0 1.6.1
```

The registry now answers, and 1.6.1 is present. The credential was installed at the **user** level
with `pnpm config set --location=user`, which is the mechanism the committed `.npmrc` documents;
nothing was written to the repository and the working tree stayed clean.

**A clean-room install, not an upgrade of a contaminated tree.** `node_modules` was deleted
entirely — 921 MB, including every `file:` link the earlier investigation had left behind — and
rebuilt from the registry. As a control, `pnpm install --frozen-lockfile` was run first at the
*old* lockfile, and the parity guard passed for the first time in this container's history: five
packages, all `registry`. Only then was the version bumped and `pnpm install` re-run.

The lockfile records a real resolution and a real integrity hash, neither fabricated:

```yaml
'@munaxa/platform@1.6.1':
  resolution:
    integrity: sha512-2Ls8XgoYW61uCzXoxulOGrS1+4ZwzUxjD+AnuA3Atu7OLBpcutv1phde5WpbhJqoEDYeNzj2vJKj/uDbgGqphQ==
    tarball: https://npm.pkg.github.com/download/@munaxa/platform/1.6.1/1ba432faad1eb061c591696b39789c4bcc1d4fb6
```

**Parity guard, enforced and passing** — no `MUNAXA_ALLOW_PLATFORM_SOURCE`, no override:

```text
  @munaxa/config-eslint      1.0.0 = lockfile 1.0.0  registry
  @munaxa/config-typescript  1.0.0 = lockfile 1.0.0  registry
  @munaxa/platform           1.6.1 = lockfile 1.6.1  registry
  @munaxa/theme              1.1.1 = lockfile 1.1.1  registry
  @munaxa/ui                 1.1.1 = lockfile 1.1.1  registry

Platform parity: 5 package(s) match the lockfile, all from the registry.
```

The guard was not modified to accommodate the upgrade. It caught the source-linked state during
the investigation and passes on its own terms now.

**API reconfirmed against the installed published package**, not against a local build:
`apps/admin/node_modules/@munaxa/platform/package.json` reports **1.6.1**, and
`dist/ui/shell/sidebar.d.ts` carries `railLabel?: string` — optional, in the emitted declaration
CI will typecheck against. The §C surface diff (516 → 527 exports, 902 → 937 props, zero removals,
zero made required) needs no revision: Work's full gate passing against the published package is
the same claim, tested end to end.

---

## S. Rail accessibility

Read from the live DOM of the running application, built against the published 1.6.1.

| Language | Rail |
| --- | --- |
| English | `<nav aria-label="Workspace">` |
| Arabic | `<nav aria-label="مساحة العمل">` |

Landmark structure, both languages:

```text
en:  nav[Workspace]      | nav[Main]      | header | main | header
ar:  nav[مساحة العمل]     | nav[الرئيسية]   | header | main | header
```

The rail is a **named `navigation` landmark** in both languages. Compare §H's 1.3.0 baseline:
`aside(unnamed) · nav[Main] · …` — an anonymous `complementary` holding the brand lockup outside
the navigation structure.

**Collapsed and expanded both hold**, and the toggle is translated and keyboard-operable:

| | English | Arabic |
| --- | --- | --- |
| expanded | `nav[Workspace]`, `aria-expanded=true`, toggle *"Collapse navigation"*, 17 links | `nav[مساحة العمل]`, `aria-expanded=true`, toggle *"طيّ التنقّل"*, 17 links |
| collapsed | `nav[Workspace]`, `aria-expanded=false`, toggle *"Expand navigation"*, 17 links | `nav[مساحة العمل]`, `aria-expanded=false`, toggle *"بسط التنقّل"*, 17 links |
| re-expanded by <kbd>Enter</kbd> | `aria-expanded=true` | `aria-expanded=true` |

The landmark keeps its name through the collapse, the navigation keeps all 17 destinations in both
states, and the toggle's accessible name swaps in the reader's own language. No accessibility
framework was introduced; this is the repository's existing Playwright rig reading the rendered
accessibility properties.

---

## T. Full Work verification

`pnpm verify` with `TURBO_FORCE=true`, PostgreSQL 16 live, 31 of 31 migrations applied, against
the **published** `@munaxa/platform@1.6.1` — and with the parity guard **enforced**, no override:

| Stage | Result |
| --- | --- |
| `standards` | 5 gates, no violations — including platform parity, all from the registry |
| `format:check` | clean |
| `lint` | **51 successful, 51 total**, 0 cached — 2m20.734s |
| `typecheck` | **51 successful, 51 total**, 0 cached — 1m14.807s |
| `test` | **51 successful, 51 total**, 0 cached — 10m6.559s |
| `build` | **29 successful, 29 total**, 0 cached — 1m46.132s |
| **`pnpm verify`** | **exit 0** |

**462 test files, 5,306 tests, 0 failed, 0 skipped.** Every turbo task a cache miss — nothing was
replayed. Identical counts to the 1.3.0 baseline, so no test changed behaviour under the upgrade.

Product verification, at 1440 px and 390 px in both languages across home, Employee Record,
Approvals, Hiring, Payroll, Leave, Attendance and Performance — **32 screen loads, every one HTTP
200, zero horizontal page scroll**, landmark structure identical on every screen. At 390 px the
rail is absent in both languages, which is the component's documented behaviour: `NavigationDrawer`
owns navigation below the breakpoint.

Regression classification, per the brief's §11: **no class-A finding.** Nothing failed that the
platform upgrade caused. The `/leave` rig artefact recorded in §J is class C — a scratchpad stub
that serves two of that screen's seven endpoints and returns a wrong-shaped 200 for
`balances/reconciliation`; it is version-independent and contradicted by Leave's own tests passing
inside the 5,306. No class-B or class-D issue was fixed, and no unrelated finding was touched.

---

## U. CI

_Recorded once the pull request's checks complete; see §V for the branch and pull request._

---

## V. Git

| | |
| --- | --- |
| Branch | `claude/munaxa-product-readiness-audit-8mr34d` |
| Base | `main` at `efa18ce` |
| Investigation commit | `9331ab5` — sections A–P, no dependency change |
| Implementation commit | `9c45816` — the upgrade |
| Status | awaiting review; **not merged** |

---

# PLATFORM 1.6.1 UPGRADE READY — AWAITING MERGE
