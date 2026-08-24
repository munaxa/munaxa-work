# Product readiness audit — Munaxa Work

**Date** 2026-08-24 · **Baseline** `4e69b5d` (`main`, immediately after Phase 5.3 merged as PR #15)
· **Branch** `claude/munaxa-product-readiness-audit-8mr34d`

**Sections 1–19 are the audit and change no production code.** They describe the product **as at
`4e69b5d`**, and they are deliberately left as written: an audit that were edited to match the work
that followed it would no longer be evidence of why that work was chosen. Section 20 is the
transition plan, and the first vertical slice it selects was implemented in the same session and the
same branch — see **PRODUCT DEVELOPMENT STARTED** at the end, and
[`employee-record-slice.md`](employee-record-slice.md) for what it changed.

Every claim below is traceable to a file, a route, a migration or a gate run in this repository.
Where a claim could not be verified in this session, it says so rather than being inferred.

---

## 1. Executive summary

Munaxa Work has an **enterprise-grade backend and almost no product**.

Eighteen modules, 186 tables, 32 migrations, **513 HTTP routes** and 285 declared permissions are
built, tested against a real PostgreSQL with row-level security, and documented to a standard that
is well above the market. The domain work through Phase 5.3 is not the problem, and the audit found
no reason to keep extending it before a product exists on top of it.

What is missing is everything between that backend and a person doing HR work:

| | |
|---|---|
| **Nobody can sign in.** | The only `PlatformAuthenticationPort` implementation in the repository is `UnauthenticatedPort`, which authenticates nobody, and the only `PermissionChecker` is constructed with an **empty grant set**. Every business route answers 401, and would answer 403 if it did not. This is by design (ADR-0001, ADR-0032) and it is an **external dependency on Platform**, not a defect here. |
| **Nothing is navigable.** | The Admin application has 15 pages and **no shell**: no sidebar, no top bar, no link from any page to any other, no home. The root page is a card with a `Continue` button that does nothing. Eighteen modules declare 32 navigation entries in the module registry; **nothing publishes or consumes them**. |
| **Nothing can be written from a screen.** | The Admin portal is deliberately read-only — 0 forms, 0 inputs, 0 client components across 83 `.tsx` files, asserted by tests that fail if one appears. Every one of the 513 routes is reachable only by `curl`. |
| **The employee is not a screen.** | There is no employee record. `people` lists people, `employment` lists employments, and the two are never joined with documents, letters, leave, attendance, performance, relations or assets. Screens render `01900000…` where an HR product renders a name. |
| **Two of the three newest modules have no UI at all.** | `relations` (Phase 5.2) and `assets` (Phase 5.3) have 19 and 14 routes respectively and **zero screens**. So does `identity`. |
| **Files do not exist.** | `StoragePort` has no adapter anywhere. The Documents module holds no bytes: upload, download, scanning and hashing are all absent. An HR system that cannot hold a copy of a passport is not an HR system. |
| **The design system is unused.** | `@munaxa/ui` ships `AppShell`, `Sidebar`, `TopBar`, `SidebarNav`, `DataGrid`, `Table`, `Tabs`, `Breadcrumb`, `Pagination`, `EmptyState`, `ErrorState`, `Skeleton`, `Dialog`, `Drawer`, `Toast`, `FilterBuilder`, `SearchBuilder`, `EntityPicker`, `Dropzone`, `Timeline`, `StatCard`, `Avatar`. The Admin app imports exactly four things from it: `Card`, `Button`, `ProductLogo`, `BrandProvider`. |

The gap is therefore **not** a domain gap and — importantly — **not a platform gap either**. The
shell, the grid, the states and the patterns already exist and are already paid for. They have
simply never been composed.

**Recommended first vertical slice: The Employee Record** — an application shell for the Admin
portal, plus a cross-module employee directory and employee profile that composes People,
Employment, Organization, Documents, Letters, Attendance, Leave, Performance, Career, Learning,
Relations and Assets into one screen. It traverses twelve existing modules, needs no migration, no
new permission, no new domain capability and no unresolved decision, and it is the single change
that turns fifteen disconnected pages into something a customer would recognise as a product.

---

## 2. Current product status

### What actually runs today

| Layer | State |
|---|---|
| Database | 186 models, 32 migrations. `pnpm db:migrate` applied all 32 cleanly against PostgreSQL 16 in this session. RLS enabled and forced on business tables. |
| API | NestJS, `/api/v1`, OpenAPI at `/api/docs`, RFC 9457 problem details, global `AuthenticatedTenantGuard`, correlation middleware, 513 routes across 18 modules. |
| Admin web | Next.js. 15 module pages + 1 bootstrap home. Read-only, server-rendered, no shell, no navigation. |
| Employee portal | Bootstrap page only — one card, one dead button. |
| Manager portal | Bootstrap page only — one card, one dead button. |
| Mobile (Flutter) | Bootstrap screen only: *"Bootstrapped. Screens arrive in Phase 19.1."* |
| Auth / authz | **Not present, by design.** `UnauthenticatedPort` + empty grant set. |
| File storage | **Not present.** `StoragePort` has no adapter. |
| Scheduling | **Not present.** `JobPort` has no adapter; assigned to Platform by D-16E-03. |
| Notifications | **Not delivered.** `RecordingNotificationPort` records intent and delivers nothing. |

### The end-to-end truth

A deployment of Munaxa Work today, with a real database and the real API:

1. serves `200` on `/health`;
2. serves `401` on all 513 business routes, because no principal can be established;
3. serves 15 Admin pages, each of which renders its own honest "unavailable" empty state, because
   its `fetch` was refused;
4. offers no way to move between those 15 pages.

That is an accurate statement of product readiness, and it is consistent with what the repository
says about itself. It is not a criticism of the engineering; it is the reason this audit exists.

### The gate, as run in this session

| Gate | Result |
|---|---|
| `check-standards.mjs` | **pass** — no violations |
| `check-architecture.mjs` | **pass** — 186 models checked, no violations |
| `check-localization.mjs` | **pass** — 19 catalogue sets complete (en + ar) |
| `check-dependencies.mjs` | **pass** — 1,890 source files, no cycles, no unused dependencies, no unreachable files |
| `pnpm typecheck` | **pass** — 51/51 tasks |
| `pnpm db:migrate` | **pass** — all 32 migrations applied |
| `pnpm test` | **pass** — 51/51 tasks, against a real PostgreSQL with all 32 migrations applied |
| `pnpm build` | **pass** — 29/29 |

**Environment note.** `@munaxa/*` is published to GitHub Packages and this session's token is not
authorized for that registry, so `pnpm install` fails as issued. The gate above was run by building
`munaxa/munaxa-platform` (public) from source and linking the seven `@munaxa/*` packages locally.
That linkage is a **local-only** arrangement: `package.json` and `pnpm-lock.yaml` are restored
before any commit, and nothing about it is pushed.

---

## 3. Existing usable capabilities

These are the things that genuinely work, verified by route, handler, schema and test rather than by
module existence.

### Verified working, API-only

| Capability | Evidence |
|---|---|
| Tenant resolution from stored membership, never from a header | `apps/api/src/tenancy/tenant.middleware.ts`, ADR-0032, `tenant.middleware.spec.ts` |
| Row-level security as defence in depth | 32 migrations enable **and force** RLS; suites prove refusal under an unprivileged role |
| Effective-dated identity — "who was this person on 3 March" | `GET /people?asOf=`, ADR-0037 |
| Duplicate prevention before a second person can be created | `GET /people/duplicates`, keyed digest, `PII_MATCH_SECRET` |
| Employment lifecycle, timeline assignment, reporting lines, contracts, probation | 18 routes, ADR-0039/0040/0042 |
| Organization structure of unlimited depth, legal entity → country, positions, establishment, calendars | 38 routes, ADR-0034/0035 |
| Recruitment end to end — requisition → vacancy → candidate → application → interview → offer → hire | 42 routes; the hire is a saga (ADR-0046) |
| Onboarding plans, immutable versions, tasks, reconciliation of missing inductions | 25 routes, ADR-0047–0050 |
| Attendance — immutable punches, shifts, schedules, rosters, calculated day, corrections, frozen payroll snapshot | 34 routes, ADR-0051–0055 |
| Leave — configured types, versioned policies, append-only ledger, derived balance, requests, accrual, year closure | 32 routes, ADR-0056–0060 |
| Compensation — versioned plans, integer minor units carrying their exponent, supersession with a GiST exclusion | 36 routes, ADR-0061–0063 |
| Payroll — snapshot-driven runs, explainable lines, approval, finalization immutable at the table, reversal, reconciliation, accounting and payment outputs | 28 routes, ADR-0064–0067 |
| Documents — types, identities, insert-only versions, verification, access trail, confidentiality applied inside the query | 13 routes |
| Letters — templates, immutable versions, requests, approval, issued letters carrying a frozen snapshot | 16 routes |
| Performance — scales, frameworks, goals, cycles, reviews, assessments, calibration, nine-box, immutable rating snapshot | 49 routes, ADR-0068/0069 |
| Learning — courses, versions, paths, mandatory rules, assignments, enrolments, assessments, certifications | 38 routes, ADR-0070/0071 |
| Career — paths, plans, pools, succession, readiness stated by a person, advisory-only mobility | 40 routes, ADR-0072–0074 |
| Workflow — definitions, versions, groups, parallel branches, quorum, conditions, delegation, manager routing, service levels, escalation, machine reminders | 23 routes, Phases 16A–16E |
| Relations — violation catalogue, immutable violations, investigations, derived case state, corrections, repeat counting, disciplinary ladder | 19 routes, Phase 5.2 |
| Assets — categories, inventory, custody lifecycle, ageing, offboarding clearance contribution | 14 routes, Phase 5.3 |

### Verified working, with a screen

Fifteen read-only screens: attendance, career, compensation, documents, employment, learning, leave,
letters, onboarding, organization, payroll, people, performance, recruitment, workflow. Each is
bilingual (en/ar) with direction following language, each renders honest empty and unavailable
states, and each carries a section naming what the product does **not** do.

That honesty section is a genuine asset and should survive the product work. It is the reason this
audit could be written from the repository at all.

### The capability the audit found that the phase reports do not credit

Phases 13, 14A, 15 and 16A each recorded `read-own` as **NOT VERIFIED** on the grounds that *"a
principal does not resolve to an employment"*. **That is no longer true.** Phase 16C added
`identity.primary-employment-for-membership` (`packages/modules/identity/src/application/identity-queries.ts:374`),
guarded by `identity.employment-link.read`, and Phase 16C's manager routing composes it with
`employment.read-employment` and `identity.active-memberships-for-employment` in
`apps/api/src/workflow/workflow-reporting-line.ts`.

So *"which employment is this signed-in person"* is an answered question with a published contract.
`read-own` across Leave, Attendance, Payroll, Performance and Learning is **architecturally
possible today** and is blocked only by authentication, not by a missing capability. That materially
changes the self-service picture in §5 and the backlog in §13.

---

## 4. UI/UX assessment

This is the weakest part of the product and, given the state of the backend, the highest-return
place to work.

### 4.1 Information architecture — **absent**

There is no information architecture. There are 15 URLs and no structure over them. There is no
home, no grouping, no hierarchy, no breadcrumb, no "where am I". A user who reaches `/leave` cannot
reach `/people` without editing the address bar.

Eighteen modules declare 32 navigation entries with keys, paths, permissions and sort order, and the
`ModuleRegistry` sorts them into a single ordered list. **No route publishes that list and no
application consumes it.** Nine of the 32 declared paths have no page behind them; four modules
declare sub-paths (`/career/paths`, `/learning/catalogue`, `/performance/reviews`,
`/workflow/approvals`) where the application has a single flat page.

### 4.2 Navigation — **absent**

`apps/admin/src/app/layout.tsx` is `<html><body><BrandProvider>{children}</BrandProvider></body></html>`.
Every page is a bare `<main>` with its own `max-w-*` and its own `p-8`. There is no shell to put a
language switch, a tenant switch, a user menu, a notification bell or a search box into — which is
why none of those exists.

`@munaxa/ui` already exports `AppShell`, `AppShellProvider`, `Sidebar`, `SidebarNav`, `TopBar`,
`NavigationDrawer`, `SkipLink`, `UserMenu`, `OrganizationSwitcher` and `NotificationMenu`. None is
imported anywhere in this repository.

### 4.3 Dashboard — **absent as a product surface**

Four modules publish a dashboard read (`attendance`, `leave`, `compensation`, `payroll`) and each is
rendered inside its own module page. There is **no cross-module dashboard**, no "what needs my
attention", no pending-approvals count, no joiners this month, no expiring documents, no outstanding
custody. The root page shows a logo and a dead button.

### 4.4 Employee profile — **absent**

The single most important screen in any HR product does not exist. `/people` is a register listing
and `/employment` is a workforce listing; neither links to a record, because there are no record
pages. Nothing anywhere composes a person with their employment, their documents, their leave, their
attendance, their reviews, their assets and their disciplinary history.

### 4.5 Tables — **raw HTML**

Every listing is a hand-rolled `<table>` inside a `Card`. No sorting, no column selection, no
sticky header, no virtualization, no row selection, no row actions, no density control, no
pagination control — although the APIs are cursor- and page-paginated and `DataGrid`, `Table` and
`Pagination` all ship in the design system.

### 4.6 Filters and search — **effectively absent**

Two query parameters exist across the whole application: `?lang=` and `?asOf=` (plus a date window
on the attendance roster). There is no filter UI anywhere, no search box, and **no global search**.
`FilterBuilder`, `SearchBuilder` and `Command` ship unused. The API supports far richer filtering
than any screen exposes.

### 4.7 Forms — **none**

Zero `<form>`, `<input>`, `<select>`, `<button>` (other than the two dead bootstrap buttons) and
zero `'use client'` components in 83 `.tsx` files. Tests assert the absence — for example
`apps/admin/src/career/honesty.test.tsx:328`. Every write in the product is `curl`-only.

This is a deliberate, defensible position taken while authentication is absent (D-16D-10), and it is
correctly documented. It is nonetheless the reason the product cannot be demonstrated.

### 4.8 Detail pages — **none**

There is no detail route in the entire application. Where a page needs a detail — a career path, a
workflow instance, a payslip, an issued letter — it fetches the **first** item of the list and
renders it inline as an example. There is no way to open the second one.

### 4.9 Empty, loading and error states

- **Empty** — good. Every section distinguishes *"no rows"* from *"the API refused"*, and says which.
  This is better than most shipped HR products.
- **Loading** — absent. Pages are server-rendered with `cache: 'no-store'` and no `loading.tsx`, no
  `Suspense` boundary and no skeleton. A slow module blocks the whole page.
- **Error** — absent as a surface. Every failure is flattened into `unavailable: boolean`. There is
  no `error.tsx`, no `not-found.tsx`, and a 403 is indistinguishable from a network failure to the
  reader.

### 4.10 Permissions and visibility

Enforced correctly at the API — confidentiality is applied *inside* the query, so a caller without
`document.read-sensitive` neither receives a confidential document nor learns one was withheld. The
UI's part is honest too: contracts carry `sensitiveWithheld`, and screens say "withheld" rather than
rendering a blank.

What is missing is the other direction: **nothing in the UI is permission-aware**, because the UI
has no notion of a signed-in user. Every screen shows every section to everyone.

### 4.11 Responsive and mobile

Pages use `max-w-*` and `flex-col`, so they do not break on a phone, but nothing is designed for one:
raw tables overflow horizontally with no scroll container, and there is no drawer, no bottom bar and
no touch target sizing. The Flutter application is a bootstrap screen.

### 4.12 Arabic, RTL and terminology

The **strongest** part of the UI work, and it should be preserved exactly as it is.

- Both languages are first-class, gated by `check-localization.mjs`, which fails CI on a missing key.
- Direction follows language (`directionOf`) and is never a separate control — the single most
  common RTL defect, designed out.
- Screens translate closed vocabularies and deliberately **do not** translate tenant codes or another
  module's subject types.
- Status is never conveyed by colour alone.

Three gaps: language is a URL parameter with no switcher, because there is no shell to put one in;
there is no Hijri rendering anywhere despite `DEFAULT_CALENDAR` and the kernel's localization
package; and the Arabic catalogues have not been reviewed by a native HR speaker for terminology.

### 4.13 Consistency, density, hierarchy, action placement

Consistent — every page follows the same header/section/Card rhythm, which is a real achievement
across 15 screens written over many phases. But it is consistently *thin*: one type scale, one
density, everything in a Card, nothing emphasised. There is no action placement to assess, because
there are no actions.

### 4.14 Workflow clarity

Approvals are visible as data (`/workflow` lists instances, steps, decisions, history, service
levels, escalation) and are **not** visible as work. There is no "waiting for me" queue on any
screen, no badge, no notification, and no way to decide anything. `GET /workflow/approvals/pending`
— the first routed and enforced `read-own` in the product — has **no screen at all**.

### 4.15 The highest-impact UX problems, ranked

1. **No application shell or navigation.** Fifteen pages that cannot see each other are not an
   application. Cheapest fix in the audit; largest single change in perceived completeness.
2. **No employee record.** The central object of an HR product has no page.
3. **Identifiers where names belong.** `01900000…` instead of a unit, a position, a manager, a
   person. `EmploymentView.personName` already exists; the composition simply was never done.
4. **No detail pages.** A list that cannot be opened is a report, not an application.
5. **No "what needs my attention".** No dashboard, no approval queue, no alerts.
6. **No forms.** Blocked by authentication, and the blocker must be named rather than worked around.
7. **No search or filtering.** The API supports it; the UI exposes two query parameters.
8. **No loading or error surfaces.** Every failure looks like emptiness.

---

## 5. Employee lifecycle assessment

```text
Employee → Employment → Onboarding → Documents → Letters → Attendance → Leave
        → Performance → Relations → Assets → Payroll → Offboarding
```

| Stage | Backend | Screen | End to end? |
|---|---|---|---|
| **Employee (Person)** | Complete — registry, names over time, identifiers, nationalities, contacts, addresses, duplicates, merge | List only | **Breaks at the UI.** No profile, no create, no edit |
| **Employment** | Complete — lifecycle, assignment timeline, manager, contracts, probation | List only | **Breaks at the UI** |
| **Onboarding** | Complete — plans, immutable versions, tasks, waivers, reconciliation | Reconciliation list only | **Breaks at the UI** |
| **Documents** | Metadata complete; **bytes absent** | Types + reconciliation only | **Breaks at the backend.** No `StoragePort` adapter — no upload, download, scan or hash |
| **Letters** | Complete — templates, versions, requests, approval, issued letters with frozen snapshots | Templates + one issued letter | **Breaks at the UI, and at output.** Nothing renders a PDF; nothing signs |
| **Attendance** | Complete — punches, schedules, rosters, calculated days, corrections, payroll snapshot | Dashboard + configuration | **Breaks at the UI.** No per-employee attendance anywhere |
| **Leave** | Complete — ledger, balances, requests, approval, accrual, year closure | Dashboard + configuration | **Breaks at the UI.** No per-employee balance or request screen |
| **Performance** | Complete — cycles, reviews, assessments, calibration, nine-box | Configuration + one review | **Breaks at the UI** |
| **Relations** | Complete for what is built — violations, investigations, disciplinary actions | **None** | **Breaks at the UI entirely** |
| **Assets** | Catalogue, custody, ageing, clearance contribution | **None** | **Breaks at the UI entirely** |
| **Payroll** | Complete — runs, snapshots, results, payslips, approval, finalization, outputs | Dashboard + one payslip | **Breaks at the UI.** No per-employee payslip route |
| **Offboarding** | **Not built.** Phase 11.2. Assets publishes a clearance contribution that nothing consumes | None | **Breaks at the backend** |

**Where the lifecycle works end to end today: nowhere.** Every stage from Employee to Payroll has a
complete or near-complete backend and no usable screen; the two ends — file storage and offboarding
— are genuinely unbuilt.

The most important structural observation: **the lifecycle is never joined**. Twelve modules each
key on `employmentId`, and no screen and no read composes them. The join is the product.

---

## 6. Module-by-module readiness

Classification: **usable** (a person can complete the task in the product) · **partially usable** ·
**backend-only** (routes exist, no screen) · **UI-only** · **placeholder** · **missing**.

*No area is classified from module existence. Routes, handlers, screens and their fetches were read.*

| # | Area | Class | Routes | Tables | Screen | Evidence and reason |
|---|---|---|---|---|---|---|
| 1 | **Authentication** | **missing** | — | — | none | `UnauthenticatedPort` is the only implementation (`packages/kernel/src/ports/authentication.ts:65`) and it is wired in `identity.module.ts:114`. Deliberate; ADR-0001 |
| 2 | **Tenant entry** | **backend-only** | — | 2 | none | Membership-based resolution works and is tested; there is no tenant picker, no switcher and no landing surface. `OrganizationSwitcher` ships unused |
| 3 | **Navigation** | **missing** | — | — | none | 32 declared entries, no publisher, no consumer, no shell |
| 4 | **Dashboard** | **partially usable** | 4 | — | 4 module-local | `attendance`, `leave`, `compensation`, `payroll` dashboards render. No cross-module dashboard exists |
| 5 | **Employee management** | **backend-only** | — | — | none | No employee record page anywhere; §4.4 |
| 6 | **People** | **partially usable** | 30 | 13 | register + duplicates | Listing works and is effective-dated. No profile page, no create, no edit, no detail route |
| 7 | **Employment** | **partially usable** | 18 | 7 | workforce list + one history | Lists employments as at a date and renders the first one's history. No detail route |
| 8 | **Organization** | **partially usable** | 38 | 9 | hierarchy tree, unit types, legal entities, settings | The best screen in the product — a real tree. Read-only; no unit detail, no position screen, no calendar screen |
| 9 | **Documents** | **partially usable** | 13 | 5 | types + reconciliation | Metadata is real; **no bytes**. No document list per person, no upload, no download, no viewer |
| 10 | **Letters** | **partially usable** | 16 | 6 | templates + one issued letter | No request screen, no approval screen, no rendered output |
| 11 | **Attendance** | **partially usable** | 34 | 13 | dashboard + shifts/schedules/roster/imports | Configuration is visible; the **day** — the thing attendance is for — has no screen |
| 12 | **Leave** | **partially usable** | 32 | 14 | dashboard + types/policies | No request list, no balance screen, no calendar, no approval screen |
| 13 | **Payroll** | **partially usable** | 28 | 14 | dashboard + one approval chain + one payslip | No run list a user can open, no result browsing, no per-employee payslip |
| 14 | **Compensation** | **partially usable** | 36 | 14 | dashboard + configuration | No per-employee compensation screen |
| 15 | **Workflow** | **partially usable** | 23 | 9 | 5 read-only sections | Instances, steps, history, service levels, escalation are visible. **`GET /workflow/approvals/pending` — the routed `read-own` queue — has no screen** |
| 16 | **Performance** | **partially usable** | 49 | 23 | configuration + one review | Largest module by tables; smallest screen relative to it |
| 17 | **Relations** | **backend-only** | 19 | 7 | **none** | Phase 5.2 shipped four checkpoints and no screen |
| 18 | **Assets** | **backend-only** | 14 | 3 | **none** | Phase 5.3 shipped four checkpoints and no screen. `/assets` is declared in navigation and does not exist |
| 19 | **Recruitment** | **partially usable** | 42 | 11 | requisitions/vacancies/candidates lists | No pipeline board, no candidate detail, no interview screen, no offer screen |
| 20 | **Onboarding** | **partially usable** | 25 | 6 | reconciliation only | No plan editor, no task list, no per-joiner view |
| 21 | **Career** | **partially usable** | 40 | 12 | paths, succession, pools, development | Relatively rich for a read-only surface |
| 22 | **Learning** | **partially usable** | 38 | 12 | catalogue, attainment, compliance, records | Same |
| 23 | **Identity** | **backend-only** | 18 | 8 | **none** | Members and invitations declared in navigation; neither page exists |
| 24 | **Reporting** | **placeholder** | 6 exports | — | none | `GET /export` on people, employment, organization, attendance, recruitment, onboarding. No report builder, no scheduling, no analytics. Phase 20 |
| 25 | **Administration** | **partially usable** | — | 1 | tenant settings (read-only) | No user administration, no role administration (no role model exists), no audit browser |
| 26 | **Settings** | **partially usable** | 2 | 1 | tenant settings (read-only) | Language, calendar, time zone are stored and displayed; nothing can change them from a screen |
| 27 | **Notifications** | **placeholder** | — | — | none | `RecordingNotificationPort` records and delivers nothing. `NotificationMenu` ships unused. Phase 17 |
| 28 | **Search** | **missing** | 2 scoped | — | none | `GET /identity/search` and `GET /people?` exist. No global search, no search UI |
| 29 | **Mobile** | **placeholder** | — | — | bootstrap | *"Screens arrive in Phase 19.1"* |
| 30 | **API** | **usable** | 513 | 186 | OpenAPI at `/api/docs` | The strongest surface in the product. Versioned, problem-details, permission-declared, tenant-guarded |

**Totals** — usable: 1 (the API). Partially usable: 16. Backend-only: 5. Placeholder: 3. Missing: 4.
UI-only: 0.

---

## 7. Horilla capability comparison

Horilla is used here as a **reference for product shape**, not as an implementation template. Its
value is that it is a complete, opinionated, working HR application with modest engineering — the
exact inverse of this repository's position, which is why the comparison is informative.

**Scope note, stated rather than glossed:** no Horilla source is present in this repository and the
session had no access to it. The Horilla column below reflects the capability set of the
open-source Horilla HRMS as generally shipped (employee, recruitment, onboarding, attendance,
leave, payroll, performance, asset, help-desk, offboarding, ESS). Where a detail could change the
recommendation, it is not relied upon. Nothing in §13 depends on a Horilla claim.

| Capability | Horilla | Munaxa Work | Gap | Kind | Priority |
|---|---|---|---|---|---|
| **Employee directory** | Grid + list, photos, filters, saved views, bulk actions | Text list of employments, no photos, no filters | Directory is a screen, not a list | **UI gap** | **P0** |
| **Employee profile** | Tabbed record: personal, work, contract, documents, assets, leave, attendance, performance, disciplinary | None | The central screen is absent | **UI gap** | **P0** |
| **Employee lifecycle** | Hire → onboard → work → offboard, in-app | Backend complete except offboarding; no screen | Not joined anywhere | **UI gap** (+ backend gap for offboarding) | **P0/P2** |
| **Onboarding** | Portal, task checklist, candidate → employee conversion | Plans, versions, tasks, reconciliation — API only | No task screen, no joiner view | **UI gap** | **P1** |
| **Recruitment** | Kanban pipeline, careers site, applicant portal | Full API pipeline; lists only | No board, no external portal | **UI gap** (+ product decision on a public careers site) | **P2** |
| **Attendance** | Clock in/out, biometric import, timesheet, per-employee view | Punches, schedules, rosters, calculated day, corrections; dashboard only | No per-employee view, no clock-in surface, no mobile capture | **UI gap** | **P1** |
| **Leave** | Request form, calendar, balances, approvals, holidays | Ledger, balances, requests, approvals, accrual; dashboard only | No request, no calendar, no approval screen | **UI gap** | **P1** |
| **Payroll** | Payslip generation, allowances/deductions, batch | Snapshot-driven runs, explainable lines, approval, finalization, outputs | Munaxa is **stronger** in engine, **weaker** in delivery: no payslip PDF, no distribution | **UI gap** + **integration gap** (no storage) | **P2** |
| **Performance** | Objectives, KPIs, feedback, 360 | Cycles, reviews, assessments, calibration, nine-box, immutable snapshots | Munaxa is **stronger** in the domain; no usable screen | **UI gap** | **P2** |
| **Documents** | Upload, request, expiry, approve | Types, versions, verification, access trail — **no bytes** | Cannot store a file | **Backend gap** (`StoragePort`) | **P1** |
| **Disciplinary** | Actions with attachments | Violations, investigations, ladder, actions — no screen, no evidence attachment | Complete backend, zero surface | **UI gap** | **P2** |
| **Assets** | Catalogue, assign, request, return, history | Catalogue, custody, ageing, clearance — no screen | Complete backend, zero surface | **UI gap** | **P1** |
| **Approvals** | Per-module approve/reject in-app | Full engine, richer than Horilla's; only Recruitment adopts it; no screen | **The engine is unwired**: `workflowApprovalPortFor` is exported and never called | **Integration gap** | **P1** |
| **Dashboards** | Role dashboards with charts and pending work | Four module-local read models | No cross-module dashboard | **UI gap** | **P1** |
| **Reporting** | Built-in reports and exports | Six CSV exports | No report surface | **Intentionally deferred** (Phase 20) | **P3** |
| **Administration** | Users, roles, permissions in-app | 285 declared permissions, **no role model, no admin screen** | Role and grant management is Platform's | **Product decision** — needs an owner answer on where roles are administered | **P1** |
| **Employee self-service** | Full ESS portal | Bootstrap page. `read-own` is now possible (§3) but unbuilt | Blocked by authentication, not by architecture | **Backend + UI gap**, gated | **P2** |
| **Help desk / tickets** | Yes | No | Not in the roadmap | **Product decision** | **P3** |
| **Offboarding** | Yes | Not built; Assets publishes a clearance contribution nothing consumes | Phase 11.2 | **Backend gap** | **P2** |
| **Multi-tenancy** | Not a design goal | Membership-resolved tenancy + forced RLS | **Munaxa is far ahead** | — | — |
| **Arabic / RTL** | Partial | First-class, gated in CI | **Munaxa is far ahead** | — | — |
| **Audit, immutability, concurrency** | Minimal | Table-level triggers, append-only history, optimistic concurrency, proven races | **Munaxa is far ahead** | — | — |

**Summary of the comparison.** Of 22 compared capabilities, Munaxa Work is *behind* on 15 — and
**13 of those 15 are UI gaps over a backend that already exists**. Only three are genuine backend
gaps (file storage, offboarding, self-service), and two are product decisions. That ratio is the
single most important number in this audit, and it is what justifies stopping domain work.

---

## 8. Menaitech / MenaME benchmark observations

Using the product direction already recorded in [`ROADMAP_ANALYSIS.md`](../ROADMAP_ANALYSIS.md),
which was verified against menaitech.com and a live MenaME-Plus+ deployment (app v3.2.30, backend
MenaHRMS v7.8.2208.08). No proprietary implementation detail is reproduced here.

| What an HR administrator expects | Munaxa Work today |
|---|---|
| One product with one shell, one navigation, one search | Fifteen unlinked pages |
| The employee record as the centre of gravity | No employee record |
| Every action as a *transaction* that routes for approval and shows its committee | Engine is richer than the benchmark's; **unwired and unsurfaced** |
| Approval visibility — named approvers, timestamps, current step | Exists in the API (`GET /workflow/instances/:id/history`), no screen |
| Loan balance, assets, certificates on the employee's own profile | Assets and certificates exist with no screen; loans are Phase 10.1, unbuilt |
| Dual Gregorian/Hijri dates on every request | Kernel has calendar support (ADR-0027); **nothing renders Hijri** |
| Fractional leave balances and a projected end-of-year balance | Both exist: `GET /leave/balances/:id/as-of` and `/projected`. **No screen** |
| Nationality carried on the transaction, statutory rules keyed by it | People owns nationalities; `country-packs` is an empty shell until Phase 11.1 |
| Geofenced mobile punch as the primary attendance interface | Not built; Phase 19.1 |
| Configuration surfaced as product, not as a database | Tenant settings are read-only on one screen |
| Modules that feel like one product | They do not |

**Where Munaxa Work already beats the benchmark** — and these should be protected, not traded away
for feature count: real multi-tenancy with forced RLS; immutability enforced at the table rather
than in application code; explainable payroll from a frozen snapshot; a genuinely richer approval
engine; disciplined bilingual content with a CI gate; and no advertising anywhere near an
application that holds salary data (ADR-0028).

**Where the benchmark's own weaknesses are the wedge** — raw decimals surfacing in the UI, dense
unstyled key-value screens, clipped labels — Munaxa Work has the design system to win on
comfortably, and currently uses four components of it.

---

## 9. Major product gaps

Ranked by what prevents the product from being usable, not by effort.

1. **No authentication or authorization in any deployment.** Everything else is downstream.
   *External dependency on Platform.* Not fixable here (ADR-0001, ADR-0032).
2. **No application shell and no navigation.** Fixable here, today, entirely from existing parts.
3. **No employee record.** The central object of an HR product has no screen.
4. **No write surface anywhere.** 513 routes, 0 forms. Gated by (1).
5. **No document storage.** `StoragePort` has no adapter — a decision about *where bytes live* that
   no phase owns.
6. **Approvals are not wired.** `workflowApprovalPortFor` is exported and never called; Leave,
   Payroll, Compensation and Attendance publish approval chains from their own tables while the
   engine that should own them sits idle.
7. **Two shipped modules have no surface at all** — `relations`, `assets` — and so does `identity`.
8. **No cross-module dashboard and no approval queue.** No screen answers "what needs me".
9. **No self-service.** Employee and manager portals are bootstrap pages, although the capability
   that was blocking `read-own` now exists (§3).
10. **No offboarding.** The last item of the stated first commercial milestone; Assets already
    publishes its clearance contribution and nothing consumes it.
11. **No statutory content.** `country-packs` exports nothing; end-of-service, GOSI/social insurance
    and WPS files are the decider in the target market. Phase 11.1.
12. **No notification delivery and no scheduling.** Both assigned outside this repository.

---

## 10. Technical gaps

| Gap | Evidence | Owner |
|---|---|---|
| `PlatformAuthenticationPort` has no real adapter | `identity.module.ts:114` | Platform |
| `PermissionChecker` is constructed with an empty grant set | `apps/api/src/identity/permission-checker.ts:21` | Platform |
| No role or grant model anywhere | 285 permissions declared, nothing grants one | Platform / owner decision |
| `StoragePort` has no adapter | `documents-ports.ts:175` | **unowned** |
| `JobPort` has no adapter | interface since Phase 0 | Platform (D-16E-03) |
| `NotificationPort` delivers nothing | `RecordingNotificationPort` | Phase 17 |
| `workflowApprovalPortFor` exported, never called | `workflow.composition.ts:108` | Work |
| `PHASES.md` status column is stale | Table says "Not started" for phases 6, 7, 9–14 whose narratives below it record completion | Work — corrected as part of this transition |
| `README.md` and `ARCHITECTURE.md` say *"No application code has been written yet"* | Both files; 1,890 source files exist | Work |
| SDK exports nothing | `packages/sdk/src/index.ts` | Work |
| `country-packs` exports nothing | `packages/country-packs/src/index.ts` | Phase 11.1 |
| No PDF rendering, no signature | Letters and payslips carry content and no artefact | **unowned** |
| No `loading.tsx`, `error.tsx` or `not-found.tsx` in any app | `apps/*/src/app` | Work |
| Admin fetches send no credentials and no tenant selector | every `apps/admin/src/*/api.ts` | Work, gated on auth |

---

## 11. UX gaps

Enumerated in §4. In backlog order:

**P0** — no shell; no navigation; no home; no employee record; no detail routes anywhere;
identifiers rendered where names belong.

**P1** — no approval queue; no cross-module dashboard; no per-employee leave, attendance, payslip or
document view; no screens at all for relations, assets and identity; no loading or error surfaces;
no language switcher.

**P2** — no forms (gated on authentication); no search; no filtering; no sorting; no bulk actions;
no photos or avatars; no data grid; no responsive tables; no Hijri rendering; no printable output.

**P3** — no saved views; no column preferences; no keyboard shortcuts; no charts; no density control.

---

## 12. Integration gaps

| Integration | State |
|---|---|
| Platform authentication | Seam present, adapter absent. **Blocks the product.** |
| Platform authorization / RBAC | Seam present, adapter absent, no roles anywhere |
| Object storage for documents | **No port adapter and no owner.** Blocks documents, letters output, payslip delivery and evidence attachment |
| Durable job runner | Assigned to Platform; blocks reminders, expiry sweeps, accrual scheduling, recurring training |
| Notification delivery (email/SMS/push) | Phase 17; intent recorded, nothing delivered |
| Workflow ↔ business modules | Only Recruitment adopts Workflow, by direct write. **The `ApprovalPort` adapter exists and is never composed.** |
| Payroll → finance/banking | By design: Payroll prepares outputs and posts nothing (ADR-0067). Correct |
| Statutory (GOSI, WPS, Mudad, Muqeem) | Nothing ships. Phase 11.1 |
| Biometric attendance devices | `AttendanceImportBatch` exists; no device adapter (ADR-0057) |
| Mobile ↔ API | Flutter app makes no request |
| SDK | Empty |

---

## 13. Backlog

Every item states: **outcome · module · UI · backend · dependencies · reuse · decision · reason**.

### P0 — product blockers

**P0-1 · Application shell and navigation for the Admin portal**
*Outcome*: a person can move between every screen the product has, in either language, and knows
where they are. *Module*: `apps/admin`. *UI*: `AppShell` + `Sidebar` + `SidebarNav` + `TopBar` +
`NavigationDrawer` + `SkipLink` from `@munaxa/ui`; a single navigation map; a language/direction
switch; breadcrumbs. *Backend*: none. *Dependencies*: none. *Reuse*: the entire shell family, already
installed and unused. *Decision*: none — presentation only. *Priority*: **P0**. *Reason*: it is the
difference between 15 pages and one application, and it costs nothing but composition.

**P0-2 · The employee record — directory and profile**
*Outcome*: an HR administrator opens a person and sees their identity, employment, assignment,
manager, contracts, documents, letters, leave, attendance, performance, career, learning,
disciplinary history and asset custody in one place. *Module*: `apps/admin`, composing twelve module
contracts. *UI*: `/employment` directory with a real table, and `/employment/[employmentId]` with
tabbed sections. *Backend*: none — every read already exists and is separately permission-checked.
*Dependencies*: P0-1 for the frame. *Reuse*: `EmploymentView.personName`, `people/:id/profile`,
`leave/balances/:id/as-of`, `career/summary/:id`, `learning/history/:id`, `assets/custody`,
`relations/violations`, `documents`, `letters/issued`, `performance/reviews`, `attendance/days`.
*Decision*: none — composing in the presentation layer follows the precedent every existing screen
sets, and each call carries its own permission. *Priority*: **P0**. *Reason*: it is the screen an HR
product is judged on, it demonstrates twelve modules at once, and it needs no new capability.

**P0-3 · Names instead of identifiers**
*Outcome*: screens show "Finance", "Senior Analyst", "Ahmed Al-Fulan" rather than `01900000…`.
*Module*: `apps/admin`. *UI*: resolve unit, position and manager names by asking the owning module.
*Backend*: none — `organization.list-positions(positionId?)` and `GET /organization/units` exist.
*Dependencies*: P0-2. *Reuse*: existing published reads. *Decision*: none. *Priority*: **P0**.
*Reason*: an HR product that shows UUIDs is not usable, whatever else is true of it.

**P0-4 · Correct the repository's own account of itself**
*Outcome*: a reader is not told the product is empty. *Module*: docs. *UI/Backend*: none.
*Dependencies*: none. *Decision*: none. *Priority*: **P0**. *Reason*: `README.md` and
`ARCHITECTURE.md` both state *"No application code has been written yet"*; `PHASES.md`'s status
column contradicts its own narrative for eight phases.

**P0-5 · Platform authentication and authorization adapters** — *blocked, external*
*Outcome*: somebody can sign in and hold a permission. *Module*: `apps/api` composition + Platform.
*Dependencies*: **munaxa-platform**. *Decision*: **owner decision required** — see §18. *Priority*:
**P0**. *Reason*: nothing in the product is reachable without it, and it must not be built here.

### P1 — core workflows

**P1-1 · Approvals as work** — the "waiting for me" queue, instance detail, decision history and
service-level state, on a screen. *Module*: `apps/admin` + `workflow`. *UI*: queue, badge, detail.
*Backend*: none — `GET /workflow/approvals/pending` is routed and enforced. *Dependencies*: P0-1,
and a decision on rendering it while `read-own` cannot resolve a caller. *Reuse*: five existing
reads. *Reason*: approvals are the spine of the benchmark product and the one place the engine's
depth becomes visible.

**P1-2 · Wire `ApprovalPort` to Workflow** — compose `workflowApprovalPortFor` so Leave, Payroll,
Compensation and Attendance route real approvals instead of publishing chains from their own tables.
*Module*: `apps/api`. *Backend*: composition, plus per-module adoption decisions. *Decision*:
**one per adopting module** — which subject types route, and what happens when a tenant has
configured no definition (the port refuses rather than auto-approving; that is correct and must be
surfaced). *Reason*: the engine is built, tested and idle.

**P1-3 · Screens for `relations` and `assets`** — disciplinary case list and case view; asset
inventory, custody and outstanding-custody views; both surfaced on the employee record. *UI* only.
*Reason*: two complete modules with no surface, and both are employee-record content.

**P1-4 · Per-employee operational views** — leave balance and requests, attendance days and
exceptions, payslips. *UI* only; all reads exist. *Reason*: the daily work of an HR administrator.

**P1-5 · Cross-module dashboard** — pending approvals, joiners, leavers, expiring documents,
outstanding custody, open disciplinary cases, payroll run state. *UI* over existing reads; one new
composition, no new domain capability. *Reason*: "what needs my attention" is the first screen of
every competing product.

**P1-6 · Document storage adapter** — an implementation for `StoragePort` behind the existing port,
in `infrastructure` only. *Decision*: **owner decision required** — where bytes live, and whether
this repository may hold an adapter for it at all (§18). *Reason*: without it, documents, letter
output, payslip delivery and disciplinary evidence are all impossible.

**P1-7 · Loading, error and not-found surfaces** — `loading.tsx`, `error.tsx`, `not-found.tsx`,
`Suspense` boundaries and skeletons per route. *UI* only. *Reason*: today every failure is rendered
as emptiness.

**P1-8 · Administration surface for members and invitations** — the two navigation entries `identity`
declares. *UI* over 18 existing routes. *Reason*: onboarding a *customer* is currently impossible.

### P2 — product completeness

Forms and write flows (gated on P0-5, sequenced employee → employment → leave → attendance
correction → disciplinary → custody); search and filtering with `SearchBuilder` and `FilterBuilder`;
`DataGrid` for large listings with sorting and pagination; recruitment pipeline board; onboarding
task board; performance review screens; employee self-service on the `read-own` capability that now
exists; manager self-service — team, approvals, team leave and attendance; offboarding (Phase 11.2)
consuming the clearance contribution Assets already publishes; payslip and letter rendering once
storage exists; Hijri rendering; avatars and photos.

### P3 — advanced capabilities

Statutory country packs (Phase 11.1 — commercially decisive in the target market, but only after
the product is usable); reporting and analytics (Phase 20); notification delivery (Phase 17);
mobile applications and geofenced punch (Phase 19.1); benefits, claims, loans, engagement surveys;
integrations (Phase 22); AI advisory (Phase 23); saved views, column preferences, keyboard
shortcuts, charts.

---

## 14. Recommended first vertical slice

### **The Employee Record**

```text
Application shell  ──►  Employee directory  ──►  Employee record
                                                  ├─ Identity            (people)
                                                  ├─ Employment          (employment)
                                                  ├─ Placement & manager (employment + organization)
                                                  ├─ Contracts           (employment)
                                                  ├─ Documents           (documents)
                                                  ├─ Letters             (letters)
                                                  ├─ Attendance          (attendance)
                                                  ├─ Leave               (leave)
                                                  ├─ Performance         (performance)
                                                  ├─ Career & learning   (career, learning)
                                                  ├─ Relations           (relations)
                                                  └─ Assets              (assets)
```

Twelve modules, one screen, keyed on **employment** — the backbone every operational module already
references.

---

## 15. Why that slice was selected

Against the seven stated criteria:

1. **Customer value** — highest available. The employee record is the screen an HR administrator
   spends the day in and the screen every competing product is judged on. Nothing else in the
   backlog is used more often.
2. **Commercial importance** — it is the demonstration. Twelve modules become visible in one
   screen; today none of them is.
3. **Implementation readiness** — total. Every read it needs already exists, is routed, is
   permission-checked and is contract-typed. **It requires no migration, no new table, no new
   permission, no new handler and no new domain capability.**
4. **UI readiness** — the design system already ships every component it needs, and the repository
   already establishes the idiom (bilingual, direction-following, honest empty states, identifiers
   never faked into names).
5. **Missing dependencies** — none that block it. It is a read surface, so it is not blocked by the
   absence of authentication in the way a form is: it fails closed to the same honest empty state
   every existing screen already renders, and it becomes fully live the moment Platform's adapters
   arrive.
6. **Ability to demonstrate the product** — decisive. Shell + directory + record is the difference
   between "fifteen pages" and "an HR product".
7. **Reuse of existing capability** — maximal. It is composition of work already done and paid for,
   and it retires two "no surface at all" findings (`relations`, `assets`) as a side effect.

**Why not the alternatives.**

- **Employee onboarding** (Employee → Employment → Documents → Onboarding → Letters → Assets →
  Workflow) is the right *second* slice. It is blocked twice today: Documents cannot hold a file
  (no `StoragePort` adapter, and no owner for one), and the workflow step needs writes, which need
  authentication. It also depends on a directory and a record that do not exist.
- **Offboarding** (Employment → Workflow → Assets clearance → Documents → Letters → Payroll → final
  clearance) is genuinely blocked: the `offboarding` module does not exist, and it requires
  Phase 11.2 plus loans (10.1) and settlement. Assets already publishes its clearance contribution,
  which is exactly the evidence that the *consumer* is missing.
- **Wiring the ApprovalPort** is high value and correctly P1, but it is a backend integration with
  no visible surface until a screen exists to show an approval on — which is the slice above.
- **The next numbered phase** (closing 5.3's open decisions, or Phase 6) would add domain capability
  to a product that cannot show the domain it already has. That is the pattern this transition
  exists to end.

---

## 16. Required implementation scope

**In scope**

1. **Shell** — `apps/admin/src/app/layout.tsx` composes `AppShellProvider`, `AppShell`, `Sidebar`,
   `SidebarNav`, `TopBar`, `NavigationDrawer` and `SkipLink`; a single navigation map for the
   product's own screens; a language and direction switch that keeps direction bound to language;
   `lang`/`dir` on `<html>` driven by the reader's choice.
2. **Directory** — `/employment` becomes a real directory: name, employment number, status, unit,
   position, manager, start date; effective-dated by `?asOf=`; every row opens.
3. **Record** — `/employment/[employmentId]`: a header identifying the person and the employment,
   and sections composed from the twelve modules listed in §14. Each section calls the owning
   module's published API, renders what it returns and nothing more, and degrades to the existing
   honest empty/unavailable state when the caller may not see it.
4. **Names, not identifiers** — resolve unit, position and manager through the owning modules'
   published reads. Where a name cannot be resolved, keep the shortened identifier and say why,
   as the product already does.
5. **Bilingual and RTL throughout**, using the modules' own catalogues — no new string store.
6. **Loading and error surfaces** for the new routes.
7. **Tests** — rendering, honesty (no fabricated capability, no invented name, no control that does
   nothing), localization in both languages, and boundary assertions that the screen composes only
   published contracts.
8. **Documentation** — this document, plus the stale-status corrections in P0-4.

**Explicitly out of scope for this slice**

Forms and any write; authentication or authorization adapters of any kind; a `StoragePort` adapter;
any migration, table, column, permission, handler, port or event; wiring `ApprovalPort`; screens for
recruitment pipeline, onboarding tasks or performance reviews; self-service; mobile; search.

---

## 17. Dependencies

| Dependency | State | Effect on the slice |
|---|---|---|
| `@munaxa/ui` shell family | **Installed, unused** | None — available now |
| Employment, People, Organization reads | **Exist** | None |
| Documents, Letters, Attendance, Leave, Performance, Career, Learning, Relations, Assets reads | **Exist** | None |
| Platform authentication | **Absent** | The screen renders honest empty states until it arrives — the same behaviour every existing screen has |
| Platform authorization | **Absent** | Sections are permission-checked server-side; with no grants, each returns its withheld state |
| `StoragePort` | **Absent** | Documents section lists metadata and states that content is unavailable — it must not imply a downloadable file |
| Registry access to `@munaxa/*` | **Absent in this session** | Worked around locally for verification; see §2 |

---

## 18. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **The product stays unusable until Platform ships auth** | Every screen and every route is gated on it | Name it as the one true blocker and stop treating it as a Work task. §19 records the exact question |
| **A composed screen invents a fact** | Joining twelve modules in the presentation layer is where a screen starts computing something a domain owns | Honesty tests: the screen renders only fields the contracts carry; no derivation, no default, no inferred name |
| **A composed screen leaks** | Twelve calls means twelve authorization decisions | Each call is separately permission-checked server-side; the screen never merges a withheld answer into a visible one, and says a section was withheld rather than rendering it empty |
| **Twelve round trips make the page slow** | Page budget is 2 s | Calls issued in parallel, per-section `Suspense`, `cache: 'no-store'` retained for personal data |
| **The document section implies files exist** | `StoragePort` has no adapter | The section states that content is not stored, exactly as the Documents module already does |
| **UI work erodes architectural discipline** | The reason this codebase is worth building on | No production module, migration, permission or contract is touched by this slice |
| **`@munaxa/*` registry access** | The gate cannot be run as CI runs it | Verified locally against a source build of the public platform repository; the linkage is never committed |
| **Domain debt grows quietly while UI work runs** | Seven Phase 5.3 decisions remain open | Recorded here; the registers are unchanged and nothing in them is closed by this work |

---

## 19. Explicitly deferred work

Deferred **deliberately**, with the reason, so none of it is later mistaken for an oversight.

| Deferred | Reason |
|---|---|
| Authentication and authorization adapters | ADR-0001 — Platform's, and *"the only implementation this repository will ever contain"* is `UnauthenticatedPort` |
| A role or grant model | Platform owns RBAC; Work declares permissions and grants none |
| All write surfaces | Would post unauthenticated and 401. Sequenced behind P0-5 |
| `StoragePort` adapter | **Owner decision required** — no phase owns object storage, and whether an adapter may live here at all is an ADR |
| PDF rendering and signatures for letters and payslips | No renderer and no signature provider; dependent on storage |
| Durable job runner | D-16E-03 assigned execution to Platform |
| Notification delivery | Phase 17 |
| Phase 5.3's seven open decisions | D-5.3-03, -05, -07, -08, -10 remain open; this work closes none of them |
| Offboarding, loans, benefits, claims, engagement, communications, integrations | Unbuilt phases, correctly sequenced after a usable product |
| Statutory country packs | Phase 11.1. Commercially decisive; deliberately after the product is usable, because a compliant payroll nobody can operate sells nothing |
| Mobile screens | Phase 19.1 |
| Global search, saved views, charts, reporting | P2/P3 |

### The one question that needs an owner

**Everything else in this audit can proceed without an owner decision.** This cannot:

> **How does a Munaxa Work deployment authenticate a user and hold a permission?**
>
> - **(a)** Platform ships `PlatformAuthenticationPort` and `PermissionChecker` adapters, and Work
>   composes them. *Matches ADR-0001 exactly. Blocks the product until Platform delivers.*
> - **(b)** Work holds a **deployment-only** adapter — configured, never bundled — that delegates to
>   an external identity provider. *Requires an ADR that narrows ADR-0001, because ADR-0001 says
>   this repository will contain no other implementation.*
> - **(c)** Work holds a **development-only** adapter behind an explicit non-production flag, so the
>   product can be demonstrated and end-to-end tested. *Requires an ADR, and must be structurally
>   impossible to enable in production — the schema gate and the `PII_MATCH_SECRET` precedent show
>   how that is enforced.*
>
> **Recommendation: (c) now, (a) as the target.** It unblocks demonstration, E2E verification and
> every write surface in P2 without weakening the production position, and it does not pre-empt (a).
> **No option here is approved, and none is implemented.** This audit implements (none of them).

A second, smaller question follows the same shape and is **not** blocking the selected slice:

> **Where do document bytes live, and may an adapter for it exist in this repository?** Deferred to
> its own decision; it blocks P1-6 and the onboarding slice, not this one.

---

## 20. Product-development transition plan

### The change in how work is chosen

| Until now | From now on |
|---|---|
| The next phase number | The highest-value user workflow the repository can actually support |
| A module is done when its domain is complete | A capability is done when a person can use it in the product |
| UI arrives at the end of a phase | UI is part of the definition of done |
| Every capability gets a planning chain | Investigate when a decision is genuinely required; otherwise implement |

### What does not change

RLS · tenant isolation · permission boundaries · immutable records · concurrency guarantees · audit
requirements · module ownership · cross-module contracts · the layer direction · the four gates ·
negative-space tests · ADRs · no speculative architecture.

### The loop

```text
select the next slice by value  →  verify no unresolved decision blocks it
   →  implement UI + API + domain + database, only as the slice requires
   →  test  →  run the gate  →  fix  →  verify the workflow end to end  →  next slice
```

### Sequence after this slice

1. **The Employee Record** — this slice.
2. **Approvals as work** (P1-1) + **wire `ApprovalPort`** (P1-2).
3. **Per-employee operational views** (P1-4) + **relations and assets screens** (P1-3).
4. **Cross-module dashboard** (P1-5).
5. **Write surfaces**, in employee → employment → leave → attendance order — *gated on the §19
   decision*.
6. **Employee onboarding** end to end — *gated on the storage decision*.
7. **Self-service**, on the `read-own` capability that already exists.
8. **Offboarding** (Phase 11.2), then **statutory packs** (Phase 11.1).

---

# AUDIT COMPLETE

Sections 1–20 are the audit deliverable required by Part 11. No production code was modified while
it was written.

The selected first vertical slice — **The Employee Record** — has **no unresolved owner decision and
no external dependency that blocks it**. Under Part 12, implementation begins immediately, in this
branch and this session.

# PRODUCT DEVELOPMENT STARTED

See [`employee-record-slice.md`](employee-record-slice.md) for the slice's scope, its
implementation record, its verification and its gate result.
