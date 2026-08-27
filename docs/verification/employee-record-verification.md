# Employee Record — product verification and fixes

**Date** 2026-08-24 · **Baseline** `6686999` · **Branch** `claude/munaxa-product-readiness-audit-8mr34d`

The Employee Record slice was verified as a **product**, not as a code implementation: the
application was built, run against a fixture API, and inspected in both languages, at desk and
phone widths, with data present, with data absent, with every section withheld, and with the
employment unresolvable. What follows is what was checked, what was found, what was fixed and what
was deliberately left alone.

---

## 1. What was verified, and how

The Admin application was built and served on `:3001`, with `WORK_API_URL` pointed at a fixture
server that answers the record's routes with payloads shaped by each module's published contract.
The fixture lives in the session scratchpad, is **not** committed, and is not importable by the
product; it exists because a deployment with no Platform authentication adapter answers `401` to
everything, which is the correct behaviour and shows none of the layout that needed assessing.

| Check | Result |
|---|---|
| Implementation and tests read end to end | 12 source files, 6 suites |
| Application built and run | `pnpm build` then `pnpm start`, real Next.js server |
| Admin shell inspected | Sidebar, groups, active item, collapse control, drawer trigger, language switch |
| `/employment` inspected | Directory with 12 rows |
| `/employment/[employmentId]` inspected | Record with all twelve modules answering |
| English | Verified |
| Arabic / RTL | Verified — mirrored rail, right-aligned tables, translated vocabularies |
| Empty sections | Verified — every module answering with an empty list |
| Withheld sections | Verified — employment resolves, every other module refuses |
| Loading | `loading.tsx` present per route; skeleton holds the layout |
| Not found | Verified — an unresolvable employment renders `not-found.tsx` |
| Navigation destinations exist | Asserted in test against `src/app/**/page.tsx` on disk; 15/15 |
| Published contracts only | Every `@work/*` import is a `/contracts` subpath or `@work/config` |
| No unnecessary domain change | **Zero** files touched under any module's `domain`, `application`, `infrastructure`, `api` or `contracts`; `prisma/` and `apps/api/` untouched |

---

## 2. Product assessment — what was found

### Defects

| # | Finding | Severity |
|---|---|---|
| F1 | The Leave section rendered **`{minutes} min`** literally. `leave.label.minutes` is a *formatter* — `"{minutes} min"` / `"{minutes} د"` — and it was being used as a caption, so the placeholder reached the screen in both languages. | **Defect** |
| F2 | A violation's `state` rendered as raw `reported`. `relations.state.*` exists in both languages and was not used, so an Arabic reader met an English word. | **Defect** |
| F3 | Latin runs inside Arabic text were **reordered by the bidirectional algorithm**: the header read `رقم التوظيف: 417-EMP-000`. No isolation anywhere. | **Defect** |
| F4 | Duplicate `<main>` landmark on **every one of the 15 screens** — the shell added one around pages that already had their own. Introduced by this slice. | **Defect (a11y)** |
| F5 | The directory printed `As at: —` when no `?asOf=` was given, twice, though the server had resolved and echoed a date on every row. | **Defect** |
| F6 | The directory's page heading and its section heading were the same catalogue key, so "Employment" appeared twice. | **Defect** |
| F7 | `assets.label.clearance` was added by the slice and used by nothing. | Speculative addition |
| F8 | The People catalogue lost the author's blank-line grouping to a JSON round-trip. | Gratuitous diff |

### Product-quality findings

| # | Finding |
|---|---|
| P1 | **Thirteen equally-weighted cards, 3,090 px tall.** "Identity" and "What this record does not show" had identical visual weight. No hierarchy, no summary, nothing to scan. |
| P2 | **Weak identity header** — a name and a thin meta line. No status treatment, no key facts, no breadcrumb. |
| P3 | **The withheld state was twelve panels each repeating the same sentence** — and that is the state every real deployment is in today. |
| P4 | **Raw minutes** — `9600`, `7200`, `480` with no unit. Exactly the defect class the audit named in the benchmark product. |
| P5 | Status everywhere as plain text. No tone for `suspended`, `ended`, `expiring_soon`, `pending_verification` or outstanding custody. |
| P6 | Hand-rolled `<table>` markup, although the design system ships `Table`/`THead`/`TR`/`TH`/`TD`. |
| P7 | Quantities left-aligned, so digits did not line up. |
| P8 | The directory spent **two of five columns** on `01900000…` identifiers, and carried no row count. |
| P9 | Two leave balances in the same year rendered as **two identical rows** with different numbers: `LeaveBalanceView` carries `leaveTypeId` and no name. |
| P10 | Layout hand-assembled, although `Page`, `PageHeader` and `Section` exist to give one measure and one rhythm. |

---

## 3. What was changed

Everything below is composition of components and reads that already exist. **No module's domain,
application, infrastructure, api or contracts layer was touched; no migration, table, column,
permission, handler, port or event was added.**

### Defect fixes

- **F1** — every minute quantity now renders through the owning module's own `{minutes}` formatter,
  in that module's own word: `9600 min` / `9600 دقيقة`, `480 min` / `480 د`. Nothing is converted to
  hours or days: what a working day is belongs to Attendance's schedule engine, not to a screen.
- **F2** — the violation state is translated through `relations.state.*`. The **severity** is
  deliberately *not*: it is a word the tenant chose and is rendered as stored.
- **F3** — a `<bdi>` isolate wraps every Latin run the record places inside translated text —
  employment numbers, references, dates, codes, tags.
- **F4** — all 15 pages now render a `<div>` inside the shell's single `<main>`, and no page carries
  `min-h-screen` inside a shell that already fills the viewport.
- **F5** — the directory shows the date the server resolved the answer at, falling back to the row's
  own `asOf` rather than to a dash.
- **F6** — one heading.
- **F7** — removed.
- **F8** — the People catalogue is restored to its authored form; its whole diff is now one key.

### Product-quality changes

- **P10/P1** — the record is built on `Page`, `PageHeader` and `Section`. Thirteen cards became a
  header, a six-fact summary strip, ten labelled regions whose tables carry their own border, and a
  footnote. `Identity` and `Employment` were two panels answering *who* and *what*; the six facts a
  reader needs first are now one strip under the name, and the sections keep the rest.
- **P2** — the header carries the person's name, the date the record was resolved at, a back link in
  `PageHeader`'s own `above` slot, and the employment status as a toned badge.
- **P3** — a withheld section is one line under its heading, and when **no** module answered the
  record says so **once**, as an `EmptyState`, instead of twelve times.
- **P5** — statuses are `Badge`s with tones drawn from each owning module's meaning: Employment's
  status, Documents' verification and expiry, Leave's staleness, Learning's overdue count, Assets'
  outstanding custody. **The word is always the status** — colour is never the only signal.
- **P6/P7** — every table is the design system's, with quantities right-aligned and tabular figures.
- **P8** — the directory drops the two identifier columns for `Type` and `Start date`, which
  `EmploymentView` answers for directly, and states its count and its date.
- **P9** — each balance names its leave type, resolved from `GET /leave/types` — the tenant's own
  configuration, a handful of rows, published by Leave.
- **The manager is now a name.** `GET /employments/:id` is a bounded published read that carries
  `personName`, and it is asked **only when the employment names a manager**.

### One deliberate non-fix, and why

**A unit and a position stay identifiers.** Organization publishes `GET /organization/units` and
`GET /organization/positions` as *search by term*, and `GET /organization/units/:id/ancestry`
answers a unit's ancestors rather than the unit. There is **no bounded lookup by identifier** for
either. Fetching the whole hierarchy to name one unit would make every record view cost the tenant's
entire structure; adding a lookup route would be a change to a completed module, which is a decision
rather than ordinary product code. So the record shows the identifier and says why, and the gap is
recorded below.

---

## 4. What was deliberately not changed

| Left alone | Why |
|---|---|
| Any write, form or control | Would post unauthenticated and answer 401. Gated on the authentication decision in the audit's §19 |
| Authentication or authorization | ADR-0001. `UnauthenticatedPort` is the only implementation this repository contains |
| The theme's white-on-white surfaces | `--background` and `--card` are both `#ffffff` in the Work light palette. The palette is authored in the platform and is not this repository's to change |
| `Tabs`, `Avatar`, `Breadcrumb`, `Accordion` | All are client components. Tabs would hide half the record from a print or a link; an avatar with no image is ornament, since there is no storage to fetch a photo from. The record stays server-only |
| The other 13 screens' internals | Only the duplicate `<main>` was fixed. Redesigning screens this slice does not own is not this task |
| The home screen | It lists the screens because there is no dashboard yet. A cross-module dashboard is P1-5 in the audit |
| Phase 5.3's open decisions | Untouched, and none was required |

---

## 5. Tests

The suite grew from 27 to **44 assertions across six files**, every new one anchored to a finding
above so it cannot come back:

- every minute quantity carries its unit, and `{minutes}` never reaches the page — in both languages;
- the violation state is translated and the tenant severity is not;
- every balance names its leave type;
- the manager is named where a bounded read answered, and the unit and position are still identifiers;
- every Latin run inside Arabic text is `<bdi>`-isolated;
- when no module answers, the record says so once and the withheld sentence appears **zero** times;
- the directory contains no shortened identifier and states its count and date;
- the manager is asked for only when the employment names one, and is the only name resolved.

Plus everything the slice already asserted: withheld ≠ empty, no leaked disciplinary content on a
refusal, contracts-only imports, no writes, only paths a controller serves, navigation destinations
that exist on disk, and no control anywhere.

**312 tests pass in the Admin application; 51/51 turbo tasks pass across the workspace.**

---

## 6. Gate

Run against real PostgreSQL 16 with all 32 migrations applied.

| Gate | Result |
|---|---|
| `check-standards.mjs` | pass |
| `check-architecture.mjs` | pass — 186 models |
| `check-localization.mjs` | pass — 20 catalogue sets, both languages |
| `check-dependencies.mjs` | pass — 1,910 files, no cycles, no unused dependencies, no unreachable files |
| `pnpm format:check` | pass |
| `pnpm lint` | pass — 51/51 |
| `pnpm typecheck` | pass — 51/51 |
| `pnpm test` | pass — 51/51 |
| `pnpm build` | pass — 29/29, every Admin route server-rendered on demand |
| **`pnpm verify`** | **pass, end to end** |

The registry caveat from the slice record still applies: `@munaxa/*` is served from GitHub Packages
and this session's token is not authorized for it, so the gate was run against a source build of the
public `munaxa/munaxa-platform`. `package.json` is byte-identical to the commit and nothing about
the local linkage is committed.

---

## 7. The record as the reference for later screens

What a later screen should copy:

1. `Page` + `PageHeader` for the frame; `Section` for each region. One measure, one rhythm.
2. A **summary strip** of the facts a reader needs before anything else, then sections.
3. The design system's `Table` for every listing. Quantities right-aligned; identifiers monospaced
   and muted.
4. `Badge` for status, with a tone drawn from the **owning module's** meaning — and the word always
   present, never colour alone.
5. **Withheld ≠ empty ≠ absent**, said in one line each, and said once for the whole screen when
   nothing answered.
6. Quantities in the unit the module publishes, formatted with the module's own string.
7. `<bdi>` around every Latin run placed inside translated text.
8. Boundaries as a footnote, never as a panel competing with data.
9. No control that does nothing.

---

## 8. Contract gaps this verification found

Recorded, not acted on. Neither blocks anything today.

1. **No bounded lookup by identifier for an organizational unit or a position.** Every screen that
   shows a placement will meet this. Resolving it is a change to Organization and therefore a
   decision.
2. **`performance.reviews` cannot be filtered by employment**, by the module's own reasoning that
   confirming a review exists for a named employment is itself a disclosure. The record states the
   absence rather than widening the filter.
