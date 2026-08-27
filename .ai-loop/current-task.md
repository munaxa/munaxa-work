# CURRENT TASK

TASK_ID: NONE

OBJECTIVE:
Waiting for ChatGPT.

REQUIREMENTS:

ACCEPTANCE CRITERIA:

TESTS REQUIRED:

CONSTRAINTS:

IMPORTANT:
- This file is the authoritative task from ChatGPT.
- Claude must not invent additional requirements.
- Claude must inspect the existing repository before changing anything.

# Munaxa Work — Dependency Parity & Design-System Baseline

The seven Munaxa Work product slices are complete and merged into `main`.

Completed:

1. Employee Record
2. Approvals as Work
3. Hiring as Work
4. Payroll as Work
5. Leave as Work
6. Attendance as Work
7. Performance as Work

The latest merged PR is:

`7cf5f58`

The latest CI result was fully green:

- Standards · Architecture · Localization — PASS
- Product isolation — PASS
- Mobile — PASS
- Lint · Typecheck · Test · Build — PASS

However, the merge exposed a development-environment dependency skew that must be
investigated before further product development.

---

# OBJECTIVE

Establish reliable dependency parity between:

1. local development
2. local verification
3. CI
4. published `@munaxa/*` packages

The goal is:

> When Claude says `pnpm verify` passes locally, it must be testing against the
> same published Munaxa Platform/design-system API that CI will install.

Do NOT begin Product Slice #8.

This task is infrastructure/dependency verification only.

---

# 1. THE INCIDENT

PR #16 initially failed CI with:

```text
src/shell/workspace-shell.tsx(125,15): error TS2322

Property 'railLabel' does not exist on type
'IntrinsicAttributes & SidebarProps'.
````

The branch had used:

```text
railLabel
```

on `Sidebar`.

Local verification passed because the local environment resolved:

```text
@munaxa/ui
```

through a source/file linkage to a newer Munaxa Platform checkout.

CI installed the published:

```text
@munaxa/ui@1.1.1
```

At the published 1.1.1 API:

```text
SidebarProps =
brand
footer
collapseLabel
expandLabel
collapsible
children
className
```

There is no:

```text
railLabel
```

The branch was corrected by removing `railLabel`, and CI subsequently passed.

This proved that the local environment and CI were not using the same UI package
surface.

---

# 2. IMPORTANT CURRENT FACTS

The environment currently has a local/source linkage problem.

Previous evidence showed:

* `@munaxa/ui@1.1.1` is pinned for Work
* local `node_modules` can resolve a source build corresponding to a newer
  platform version
* the local environment has used `file:` links to the Platform source
* those links were deliberately NOT committed
* CI installs the published package
* `GITHUB_TOKEN` / `NODE_AUTH_TOKEN` are present but do not have `read:packages`
* npm.pkg.github.com therefore returns 401 for the package installation attempt
* GitHub API access works
* the published 1.1.1 source was verified at platform commit `7549319`
* platform HEAD was newer and exposed APIs unavailable in 1.1.1

Do not assume any of these are still unchanged.

Verify the current state from the repository and environment.

---

# 3. ABSOLUTE RULE

DO NOT:

* implement Product Slice #8
* modify Employee Record
* modify Approvals
* modify Hiring
* modify Payroll
* modify Leave
* modify Attendance
* modify Performance
* change business logic
* add routes
* add permissions
* add contracts
* add migrations
* change database schema
* redesign the UI
* create a new abstraction
* introduce a permanent `file:` dependency
* commit `/tmp` paths
* bypass CI
* weaken CI
* remove required checks

Do not solve dependency problems by making the application compatible only with
the local source checkout.

The published package API remains authoritative for Munaxa Work until an explicit
platform version bump is authorized.

---

# 4. FIRST — INSPECT THE CURRENT WORK REPOSITORY

Inspect:

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
turbo.json
apps/admin/package.json
apps/api/package.json
packages/*
```

Identify every:

```text
@munaxa/*
```

dependency.

For each:

* package
* version
* workspace relationship
* registry
* lockfile resolution
* whether it is published
* whether it is linked locally
* whether it can resolve to source

Pay particular attention to:

```text
@munaxa/ui
@munaxa/platform
@munaxa/design-system
```

and every other `@munaxa/*` package.

Do not assume package names.

---

# 5. INSPECT PNPM RESOLUTION

Determine exactly what this environment resolves.

Run appropriate commands such as:

```text
pnpm why @munaxa/ui
pnpm list @munaxa/ui
pnpm list --depth 0
```

Inspect:

```text
node_modules/@munaxa/ui
```

Determine:

* symlink or physical package
* target path
* package version
* package.json version
* source location
* whether it points into Platform
* whether it points to `/tmp`
* whether it points to another checkout
* whether pnpm workspace linking is involved

Do not change anything yet.

---

# 6. COMPARE LOCAL API AGAINST PUBLISHED API

For every `@munaxa/*` package that Work depends on, determine whether local
resolution differs from the version in `pnpm-lock.yaml`.

Start with:

```text
@munaxa/ui
```

Compare the local package API with the exact published version pinned in the lockfile.

For `@munaxa/ui`, specifically verify:

```text
SidebarProps
```

at the pinned published version.

Confirm whether:

```text
railLabel
```

exists or does not exist.

Do not infer.

Use repository/tag evidence where available.

---

# 7. DETERMINE THE ROOT CAUSE

Determine exactly why local verification can see:

```text
@munaxa/ui
```

from Platform HEAD while CI sees:

```text
@munaxa/ui@1.1.1
```

Potential causes include:

* local file dependency
* symlink
* workspace protocol
* pnpm linker behavior
* stale node_modules
* manually linked package
* environment-specific configuration
* package manager state
* local registry configuration

Do not assume.

Document the exact cause.

---

# 8. DETERMINE THE CORRECT ARCHITECTURAL SOLUTION

Evaluate these options:

### Option A — Published package installation

Local and CI both install the exact published versions.

### Option B — Explicit source-development mode

Source linking exists only as a clearly isolated development workflow and cannot
affect normal verification.

### Option C — Platform package version bump

Work upgrades to a newer published Platform/UI version.

### Option D — Monorepo/workspace integration

Only if the architecture actually supports it and it does not change the
intended repository boundaries.

Do NOT implement a solution merely because it is convenient.

Determine which model Munaxa actually intends.

---

# 9. GITHUB PACKAGES ACCESS

Investigate why the current environment cannot install the pinned package.

Verify:

* registry configuration
* `.npmrc`
* environment variables
* token scopes
* package visibility
* GitHub Packages permissions
* repository/org relationship

Do NOT print secrets.

Do NOT expose token values.

Do NOT modify credentials in the repository.

Determine whether the available credentials can legitimately access:

```text
npm.pkg.github.com
```

with:

```text
read:packages
```

If they cannot, state exactly what permission is missing.

Do not create a workaround that embeds credentials.

---

# 10. LOCAL VERIFICATION REQUIREMENT

The critical requirement is:

```text
pnpm verify
```

must not silently use a newer Platform source than CI.

After the investigation, establish how this can be guaranteed.

A valid solution must make it possible to answer:

> Which exact `@munaxa/*` package versions did this verification run against?

If the current repository cannot guarantee that, document the missing mechanism.

Do not build a large version-management system.

---

# 11. REGISTRY / LOCKFILE SAFETY

Inspect the current:

```text
package.json
pnpm-lock.yaml
```

for:

```text
file:
link:
workspace:
```

references involving `@munaxa/*`.

Determine whether any local-only linkage remains.

If local-only linkage exists:

* identify it
* determine whether it is committed
* determine whether it affects CI
* do NOT blindly delete anything until the source is understood

If changes are required, they must preserve the intended published dependency
model.

Never commit:

```text
/tmp/...
/home/user/...
```

or any machine-specific path.

---

# 12. DESIGN-SYSTEM VERSION DECISION

The CI fix exposed another product/platform decision.

The current published Work dependency does not expose:

```text
railLabel
```

The newer Platform source does.

Determine whether Munaxa Work should eventually receive:

```text
railLabel
```

through a new published `@munaxa/ui` version.

Do NOT bump the dependency automatically.

Instead document:

* current version
* desired API
* current published API
* newer Platform API
* why the newer API is useful
* compatibility implications
* whether the change belongs in Platform
* whether it should be a separate Platform release
* whether Work should remain on 1.1.1

This is an owner/platform decision unless the repository already contains an
explicit policy authorizing the upgrade.

---

# 13. VERIFY ALL MUNAXA PACKAGES

Do not stop at `@munaxa/ui`.

Build a table:

| Package | Work version | Local resolved version | CI version | Same? | Source linked? |
| ------- | ------------ | ---------------------- | ---------- | ----- | -------------- |

Include every relevant `@munaxa/*` dependency.

The goal is to determine whether the `railLabel` incident is:

### isolated to `@munaxa/ui`

or:

### a general Munaxa dependency-resolution problem.

---

# 14. DO NOT REOPEN PRODUCT WORK

The seven completed slices are accepted.

Do not:

* redesign them
* refactor them
* change their contracts
* change their permissions
* change their routes
* change their tests

The only allowed application change is a dependency/environment correction if
the investigation proves it is necessary.

Even then, prefer no source-code changes.

---

# 15. TEST THE FINAL STATE

If you make a dependency/environment change, verify:

### Local package resolution

Confirm the resolved package versions.

### Typecheck

Ensure Work compiles against the intended published API.

### Tests

Run the relevant test suite.

### Full gate

Run:

```text
pnpm verify --force
```

with PostgreSQL available.

Requirements:

* no cached replay
* actual test execution
* actual typecheck
* actual build
* all migrations verified
* report exact numbers

The important point is that the local gate must run against the same package
versions CI uses.

---

# 16. CI VERIFICATION

If a repository change is required:

1. create a branch/commit
2. push
3. create/update PR
4. wait for CI
5. verify all required checks
6. do not merge if any required check is pending or failing

Do not merge around a failing dependency check.

If no repository change is required, do not create a meaningless commit.

---

# 17. REQUIRED DOCUMENT

Create:

```text
docs/verification/dependency-parity-investigation.md
```

Structure:

## A. Incident

Describe the `railLabel` CI failure.

## B. Current dependency inventory

Every relevant `@munaxa/*` package.

## C. Local resolution

Exact local versions and paths.

## D. CI resolution

Exact published versions CI installs.

## E. Root cause

Why local and CI differed.

## F. GitHub Packages access

Current authentication/permission state without exposing secrets.

## G. Design-system API comparison

Especially `SidebarProps` at the pinned version versus newer Platform source.

## H. Recommended dependency model

The correct long-term model for Munaxa Work.

## I. Changes made

Exact files and why.

## J. Changes deliberately NOT made

Especially product/domain/UI changes.

## K. Verification

Exact commands and results.

## L. CI

Final CI status if a PR was required.

## M. Remaining owner decisions

Especially:

* `@munaxa/ui` upgrade
* `railLabel`
* package publishing/access
* source-link development workflow

---

# 18. SUCCESS CRITERIA

This task succeeds only if we can clearly answer:

1. What exact `@munaxa/*` versions does Work depend on?
2. What exact versions does CI install?
3. What exact versions does local verification use?
4. Are local and CI now identical?
5. If not, why not?
6. Can a future Claude session accidentally typecheck against Platform HEAD?
7. Can a future Claude session accidentally commit a local `file:` dependency?
8. What permission is required to install private GitHub Packages?
9. Should Work remain on `@munaxa/ui@1.1.1`?
10. Should `railLabel` be introduced through a future Platform release?

The most important success criterion is:

> A green local gate must mean something materially equivalent to a green CI gate.

---

# 19. ABSOLUTE STOP CONDITION

Do NOT start Product Slice #8.

Do NOT select the next product slice.

Do NOT implement Assets.

Do NOT implement Self-Service.

Do NOT implement Manager Workspace.

Do NOT implement Learning.

Do NOT implement Career.

Do NOT implement Relations.

Do NOT implement Organization.

Do NOT implement Identity.

Do NOT fix:

* notFound HTTP status
* authorization consistency
* identifier consistency
* cross-module contract exports
* product coherence findings

Do not modify the seven completed slices.

Do not upgrade `@munaxa/ui` unless explicitly authorized by an existing repository
decision.

Do not invent a dependency-management architecture.

End with exactly:

# DEPENDENCY PARITY INVESTIGATION COMPLETE — AWAITING OWNER DECISION

```
```
