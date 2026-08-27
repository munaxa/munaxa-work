# Vertical slice 1 — The Employee Record

**Date** 2026-08-24 · **Baseline** `4e69b5d` · **Branch** `claude/munaxa-product-readiness-audit-8mr34d`
· **Selected by** [`product-readiness-audit.md`](product-readiness-audit.md) §14–15

This is the first slice of product-driven development, delivered in the same session as the audit
that selected it, under Part 12 of the instruction that opened it.

---

## 1. What it delivers

Two things the product did not have, and one it had only in pieces.

**An application shell.** The Admin portal had fifteen screens and no way to reach any of them from
any other: each page was a bare `<main>`, the root route was a card with a `Continue` button that
continued to nothing, and the only navigation was the address bar. It now has a sidebar with grouped
navigation, a drawer at phone widths, a top bar, a skip link, and a language switch that moves
direction with it. Every part comes from `@munaxa/ui`, which has shipped `AppShell`, `Sidebar`,
`SidebarNav`, `TopBar`, `NavigationDrawer` and `SkipLink` all along and which this product had never
imported.

**An employee record.** `/employment/[employmentId]` composes eleven modules into one screen:

| Section | Module | Read |
|---|---|---|
| Identity | `people` | `GET /people/:personId/profile` |
| Employment | `employment` | `GET /employments/:employmentId` |
| Placement and manager | `employment` | `/assignments`, `/reporting-lines` |
| Contracts | `employment` | `/contracts` |
| Documents | `documents` | `GET /documents?ownerType=employment&ownerId=` |
| Letters | `letters` | `GET /letters/issued?employmentId=` |
| Leave | `leave` | `GET /leave/balances?employmentId=` |
| Attendance | `attendance` | `GET /attendance/days?employmentId=` |
| Career | `career` | `GET /career/summary/:employmentId` |
| Learning | `learning` | `GET /learning/history/:employmentId` |
| Employee relations | `relations` | `GET /relations/violations?employmentId=` |
| Assets in custody | `assets` | `GET /assets/custody/clearance?employmentId=` |

`relations` and `assets` — the two most recent phases, four checkpoints each, complete backends —
had **no screen anywhere in the product** before this. They do now.

**A directory that opens.** `/employment` listed employments and led nowhere. Every row now opens the
record, carrying the reader's language and the `asOf` the list was resolved at, so the record shows
the same day the list was showing.

---

## 2. What it deliberately does not do

| Not done | Why |
|---|---|
| Any form, any write | Would post unauthenticated and answer 401. Gated on the §19 authentication decision in the audit, which is the owner's |
| Any authentication or authorization adapter | ADR-0001. `UnauthenticatedPort` is the only implementation this repository contains |
| A `StoragePort` adapter | No phase owns object storage; the audit records it as an owner decision. The documents section says content is not stored rather than offering a link that cannot work |
| Salary or payslip on the record | Compensation publishes per-employment reads. Putting them on the screen everybody opens is a product decision nobody has taken, so the record states its absence instead of taking it |
| A performance section | `performance.reviews` filters by cycle, status and manager and by nothing else, because the module holds that confirming a review exists for a named employment is itself a disclosure. Adding an `employmentId` filter is a change to that module's authorization reasoning, not ordinary product code |
| Any migration, table, column, permission, handler, port or event | The slice needed none. Nothing in `prisma/`, nothing in any module's `domain/`, `application/` or `infrastructure/` was touched |
| `next/link` | Its default export is named `Link`, which the workspace's naming rule refuses; a rule is changed by an ADR, never worked around, and a soft navigation between server-rendered `no-store` pages is not worth one. Plain anchors, and one file to change when the rule is revisited |

---

## 3. What changed, file by file

### New

| File | What |
|---|---|
| `apps/admin/locales/{en,ar}.json` | The portal's own chrome — navigation, section titles, the boundaries the record states. Gated by `check-localization.mjs` like every other catalogue |
| `apps/admin/src/shell/locale.ts` | The chrome's translator; direction bound to language |
| `apps/admin/src/shell/navigation.ts` | Which screens the portal has, and which one is current |
| `apps/admin/src/shell/workspace-shell.tsx` | The frame. The portal's only client component |
| `apps/admin/src/employment/record-api.ts` | The twelve reads, in one round of parallel requests, failing closed |
| `apps/admin/src/employment/record-locale.ts` | Eleven module catalogues merged, plus the portal's |
| `apps/admin/src/employment/record-frame.tsx` | Section, Withheld, Empty, Facts, Rows |
| `apps/admin/src/employment/record-identity.tsx` | Identity · Employment · Placement · Contracts |
| `apps/admin/src/employment/record-operations.tsx` | Documents · Letters · Leave · Attendance · Learning |
| `apps/admin/src/employment/record-governance.tsx` | Relations · Assets · Career · Boundaries |
| `apps/admin/src/app/employment/[employmentId]/{page,loading,not-found}.tsx` | The route, its skeleton and its 404 |
| `apps/admin/src/{shell/navigation,employment/record,employment/record-api,employment/directory,app/home}.test.*` | 35 assertions across five suites |
| `apps/admin/src/employment/record.fixture.ts` | A whole employee, shaped by the published contracts |
| `docs/adr/0075-next-route-segment-naming.md` | The one rule change the slice required |

### Changed

| File | What |
|---|---|
| `apps/admin/src/app/layout.tsx` | Wraps every screen in the shell, and marks the portal `force-dynamic` |
| `apps/admin/src/app/page.tsx` | The dead `Continue` button became the screens, as links |
| `apps/admin/src/employment/sections.tsx` | Every directory row opens the record |
| `apps/admin/package.json` | `@work/assets` and `@work/relations`, for their contracts |
| `packages/modules/employment/locales/{en,ar}.json` | Eight labels and three vocabularies the module never had a screen to need |
| `packages/modules/people/locales/{en,ar}.json` | `people.label.status` |
| `packages/modules/assets/locales/{en,ar}.json` | Three custody labels |
| `scripts/check-standards.mjs` | Accepts a Next.js route segment, per ADR-0075 |
| `docs/ENGINEERING_STANDARDS.md`, `docs/adr/README.md` | Record ADR-0075 |

**No module's `domain/`, `application/`, `infrastructure/`, `api/` or `contracts/` was touched.** The
only module files changed are locale catalogues — the owning module's own vocabulary, extended by
the owner rather than copied into the portal.

---

### One build-time change, and why it is a correction rather than a workaround

`apps/admin/src/app/layout.tsx` now declares `export const dynamic = 'force-dynamic'`. Next was
prerendering most Admin routes at build time, which means it was **fetching one tenant's data during
the build and committing the rendered HTML into the deployment artefact** — for pages that already
declare `cache: 'no-store'` precisely because they hold personal data. Nothing in this portal is
publishable, so nothing in it should be static; the shell's `?lang=` reading is the second reason,
not the first.

## 4. The one rule change, and why it is not a workaround

The Next.js App Router reads directory names as routing syntax: `[employmentId]` is how the framework
is told a segment is a parameter. The standards gate required `kebab-case` for every folder, so the
product could not have a detail route at all — which is exactly why it had none.

[ADR-0075](../adr/0075-next-route-segment-naming.md) resolves it the way [ADR-0029](../adr/0029-ecosystem-file-naming.md)
already resolved the same situation twice: enforce **each ecosystem's** convention rather than impose
one on another's toolchain. Dart is checked as `snake_case`, Prisma migrations as `snake_case`, the
Android host by the Android toolchain's rules, and a Next.js route segment by the router's grammar —
with the identifier inside the brackets still checked as `camelCase`. `[Employment_Id]` and `MyRoute`
still fail, and every file inside a dynamic segment is checked exactly as before.

This was implemented rather than escalated because the audit's Part 8 rule applies: it is safely
determined from an existing ADR and existing precedent, and stopping to ask would have been a
decision gate over a question already answered.

---

## 5. What the tests prove

35 assertions across five suites, none of which mocks a component or a catalogue.

**The seam that matters most** — a *withheld* section and an *empty* section must never render the
same markup. An empty disciplinary section reads as "this person has a clean record"; if a refusal
produced one, the screen would make that statement about somebody the caller was not allowed to look
at. Asserted in both directions, and separately asserted that a refused relations section carries
none of the words a populated one carries.

**Fail-closed composition** — every module refusing leaves every section absent and the page
standing; one module answering while eleven refuse leaves eleven withheld and one rendered.

**No invented facts** — no name is fabricated for an identifier the screen did not ask for; the
notice saying so is on the page; no salary, payslip or rating appears anywhere.

**The boundary is structural, not stylistic** — the composition layer imports only from `/contracts`
subpaths, sends no write of any kind, and asks only for paths a `@Controller` in this repository
actually serves. That last one was mutation-checked: renaming `/career/summary` to `/careers/summary`
fails the suite with the bad path named.

**Navigation cannot promise a screen that does not exist** — every declared destination is checked
against `src/app/**/page.tsx` on disk, and every group and destination against both catalogues.

**Both languages reach every section**, including the Arabic legal name rather than the English one
falling through — and the route suite asserts `dir="rtl"` and `lang="ar"` on the rendered document.

**The whole route works, not just its parts** — a request in, twelve module responses, and one value
from each of eleven modules on the page; an employment the API refuses answers not-found rather than
rendering an employee whose every section is withheld; and when it refuses, the eleven other reads
are never issued.

**Still no controls** — the record, the directory and the home screen each assert the absence of
`<form>`, `<button>`, `<input>`, `<select>`, `<dialog>` and any handler. The portal's read-only
posture is unchanged, and now proven on three more surfaces.

---

## 6. Verification

Run in this session, against real PostgreSQL 16 with all 32 migrations applied.

| Gate | Result |
|---|---|
| `check-standards.mjs` | pass |
| `check-architecture.mjs` | pass — 186 models |
| `check-localization.mjs` | pass — 20 catalogue sets, both languages |
| `check-dependencies.mjs` | pass — 1,908 files, no cycles, no unused dependencies, no unreachable files |
| `pnpm format:check` | pass |
| `pnpm lint` | pass — 51/51 |
| `pnpm typecheck` | pass — 51/51 |
| `pnpm db:migrate` | pass — 32/32 |
| `pnpm test` | pass — 51/51 tasks; the Admin portal's own suites are 28 files / 301 tests |
| `pnpm build` | pass — 29/29; every Admin route server-rendered on demand |
| `pnpm verify` | pass — the whole gate end to end |

**Environment note.** `@munaxa/*` is published to GitHub Packages and this session's token is not
authorized for that registry, so `pnpm install` fails as issued. Every gate above was run by
building `munaxa/munaxa-platform` (public) from source and linking the seven `@munaxa/*` packages
locally through a `pnpm.overrides` block. That block and the lockfile it produced are **restored
before the commit**: nothing about the local linkage is pushed, and CI installs from the registry
exactly as before. The one consequence worth naming is that the gates ran against platform `1.6.1`
rather than the `^1.1.1`/`^1.3.0` the manifests pin; the shell API used here is unchanged between
them, and CI is the authority.

---

## 7. What this makes possible next

The audit's P1 items now have a surface to appear on, which they did not before:

1. **Approvals as work** (P1-1) — `GET /workflow/approvals/pending` is routed and enforced and has
   no screen. The shell has a place for the count and the record has a place for the instance.
2. **Wire `ApprovalPort`** (P1-2) — `workflowApprovalPortFor` is exported and never called.
3. **Per-employee operational views** (P1-4) — each record section is the summary; the drill-down is
   the next screen.
4. **A cross-module dashboard** (P1-5) — the record proves the composition pattern the dashboard
   needs.

Nothing in this slice blocks any of them, and nothing in it needs revisiting first.
