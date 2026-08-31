# Product Slice #9 — Relations as Work

Product Slice #9 opened the last complete, tested, fully localized backend that no customer could
reach: Employee Relations. It shipped two employment-scoped screens over ten published reads, eight
plain contract re-exports, and — kept deliberately separate — the repair of a shipped correctness
defect in which the workforce directory rendered an arbitrary employee's history under a heading
that named nobody.

Authorized by the owner as Product Slice #9 following
`docs/verification/next-product-slice-investigation-5.md`. Investigation commit `e156ebd`; base
`bd729c4` (Slice #8 merged).

---

## A. Objective

Why Relations became Slice #9, in the terms the investigation established:

- Relations was the last module with a complete backend — 10 published GET reads, 20 test files,
  169 localized keys per language — and **no standalone product surface**. A customer could
  configure a violation catalogue, record violations, run investigations and issue disciplinary
  actions over the API, and then had no screen on which any of it could be read as work.
- It is **Class B**: the eight views its case-file reads return were written for
  `contracts/views.ts` and never re-exported. The backend work is re-export lines, nothing else.
- It **extends a shipped product concept** rather than opening an island: the Employee Record
  already read `/relations/violations?employmentId=` and rendered the summary beside asset custody.
  This slice is the workflow behind that summary.
- Every other direction was blocked (Self-Service: Payroll publishes no employment-scoped read and
  only one `-own` grant is wired), is a dependency of a blocked one, or was a repair rather than a
  slice.

## B. Starting state

- `packages/modules/relations`: 10 published GET routes across five controllers, nine permissions
  (AD-007: independent of every other module's grants), 169/169 localized keys, immutable records,
  an access trail written inside each read's own transaction, and derived-at-read-time occurrence,
  case state and applicable-action — stored nowhere (D-5.2-16, ADR-0070).
- `contracts/index.ts` exported 4 of 12 views. The 8 unexported: `InvestigationView`,
  `InvestigationPageView`, `CaseEventView`, `CaseHistoryView`, `EscalationContextView`,
  `DisciplinaryRuleView`, `ApplicableActionView`, `DisciplinaryActionView`.
- The admin portal's only Relations surface was the Employee Record's ten-row summary, whose rows
  opened nothing.
- The workforce directory (`/employment`) fetched `page.items[0]`'s history — the shipped defect
  this slice repairs separately (section I).

One correction to investigation #5, found by re-deriving from source rather than trusting the
record: the investigation framed per-section refusals like the Assets screens'. In fact **all six
case-file reads ride on the single grant `relations.violation.read`**, so the case screen has one
withheld message repeated only where it is true, not three sentences for three grants. The real
seams are the catalogue grant (naming fallback) and the findings grant (withheld *inside* the
payload). The screens were designed to the source, not to the investigation.

## C. Product workflow

The user task: **understand one employment's disciplinary record, and work one case** — exactly
what a relations officer opens a case file for.

```text
Employee Record (/employment/[employmentId])
    │  Relations summary — ten most recent violations, each row now opens its case
    ↓
Employee relations record (/relations/employments/[employmentId])
    │  every violation, with the server's total, each opening its case
    ↓
Case (/relations/cases/[violationId])
       the violation · where the case is and every transition · the inquiries and what they
       found (where disclosable) · the repeat position with its window and contributing cases ·
       what the ladder suggests · what was actually issued
```

**There is no tenant-wide Relations register, by design.** The module's only collection read takes
an `employmentId`; its own doc comment calls a tenant-wide listing "a watchlist rather than a case
file". So this slice has **no list route, no navigation-shell entry, and assembles nothing in the
browser**: the way in is one employment's record. Contributing violations inside the repeat window
cross-link case to case, which is the only lateral navigation the contracts establish.

## D. Routes

Two routes, the minimum that separates "this employment's record" from "this case":

| Route | Why it exists |
| --- | --- |
| `/relations/employments/[employmentId]` | The full list behind the record's ten-row summary, with the server's total. Employment-scoped because the read is. Not-found only when Employment answers 404 for the identifier; a caller refused `employment.read` still gets the case list under the identifier they arrived with (AD-007 makes that caller legitimate). |
| `/relations/cases/[violationId]` | The work surface: six reads composed over one case. 404 renders the route's own not-found page, written to be true for another tenant's identifier as well (the module answers both identically so identifiers cannot probe). A refusal renders one withheld page naming the grant. |

Both routes carry `loading.tsx` (skeleton, no fake figures) and `not-found.tsx`. Both inherit the
repository-wide streaming behaviour of rendering a correct not-found page at HTTP 200 (section Q).

Rejected shapes: a route per entity (`/relations/investigations/[id]`,
`/relations/actions/[id]`) — the inquiries, history, repeat position and action are facts *about
the case* and render on it; a Relations nav entry — it would need the tenant-wide register that
does not exist; `/relations/disciplinary-rules` and catalogue screens — configuration
administration, not this workflow.

## E. Backend consumed

Eight of the module's ten published reads, plus two Employment reads:

| Read | Screen | Notes |
| --- | --- | --- |
| `GET /relations/violations?employmentId=&page=1&pageSize=50` | employment relations | bounded page; server total rendered as `N / M` |
| `GET /relations/violations/:violationId` | case (subject) | carries the derived `occurrence`; outcome kept whole (404 ≠ 403) |
| `GET /relations/cases/:violationId/history` | case | `currentState` is the module's derivation, rendered untouched |
| `GET /relations/investigations?violationId=&page=1&pageSize=50` | case | redacted-not-filtered list, preserved as such |
| `GET /relations/violations/escalation?employmentId=&violationCategoryId=&asAt=` | case | asked `asAt` the violation's own conduct date — the reference its ordinal was derived from |
| `GET /relations/cases/:violationId/applicable-action` | case | absent `action` rendered as policy silence, nothing invented |
| `GET /relations/cases/:violationId/action` | case | outcome kept whole: its 404 is the module's "nothing issued" and renders as the empty state, never as withheld |
| `GET /relations/categories` | both | naming courtesy only; refusal falls back to the frozen `categoryCode` |
| `GET /employments/:employmentId` | employment relations | names the page's subject; 404 → not-found, 403 → identifier heading |
| `GET /employments/:employmentId/history` | employee record | the history repair (section I) |

Not consumed, with reasons stated rather than left as gaps:

- `GET /relations/investigations/:investigationId` — the list returns the same fields under the
  same findings rule, and the case renders the whole chain; a per-inquiry route would duplicate it.
- `GET /relations/disciplinary-rules` — ladder configuration. The case's decision support already
  arrives through `applicable-action`; a rules screen is catalogue administration, out of scope.

Every request is `cache: 'no-store'` — a disciplinary record is the most sensitive thing this
product renders, and a cached page of one is that record sitting somewhere nobody chose.

## F. Contract exports

`packages/modules/relations/src/contracts/index.ts` — eight type re-exports added, nothing else.
Each is the response body of a published route, so each was already public in behaviour and only
unpublished in type:

| View | Published by |
| --- | --- |
| `InvestigationView`, `InvestigationPageView` | `GET /relations/investigations`, `GET /relations/investigations/:id` |
| `CaseEventView`, `CaseHistoryView` | `GET /relations/cases/:violationId/history` |
| `EscalationContextView` | `GET /relations/violations/escalation` |
| `ApplicableActionView` | `GET /relations/cases/:violationId/applicable-action` |
| `DisciplinaryActionView` | `GET /relations/cases/:violationId/action`, `POST …/action` |
| `DisciplinaryRuleView` | `GET /relations/disciplinary-rules` |

`DisciplinaryRuleView` is exported although no screen consumes it yet: it is the body of a
published route, and a contract surface that exported only what today's screens read would make
the export list a UI artifact. No view was created, altered or moved; no internal application type
was exported.

## G. Permissions

No permission added, broadened or bypassed. The screens map to the module's grants as the module
drew them:

- `relations.violation.read` answers the violation list, the case, its history, its inquiries'
  existence, the repeat position and the issued action. One grant → one honest refusal: a refused
  list and a refused case each render **withheld** ("Reading disciplinary records needs a
  permission this caller does not hold"), never the empty state — because "no violations are
  recorded" is a clean-record statement about a person and a refusal must never make it.
- `relations.category.read` only names the categories. Refused, every screen falls back to the
  `categoryCode` frozen on the violation at recording time — never an invented name.
- `relations.investigation.read-findings` is enforced *inside* payloads by the module: withheld
  findings are absent fields, indistinguishable from an inquiry still open. The screen preserves
  that exactly — no label, no dash, no "redacted" marker where findings were withheld (a marker
  would say findings exist about somebody, which in this domain is itself the disclosure). Pinned
  by test.
- The five states stay distinct per read: refused ≠ empty ≠ populated ≠ not-found, and withheld
  findings are a within-payload fifth. "Nothing issued" (the action read's 404) renders as the
  case's empty state, distinct from its refusal — pinned by test in both directions.
- Employment scope is preserved: every request carries its subject (the employment, the violation,
  or the employment-and-category pair); the one subjectless request is the catalogue, which names
  nobody. Asserted by `api.test.ts` over every URL the composition layer sends.

## H. Employee Record integration

The record's `RelationsSection` stays what it was — the module's ten most recent violations, the
same columns, withheld ≠ empty — and gained the path out:

- each row's category cell now links to `/relations/cases/{violationId}` (the row always carried
  `violationId`; it opened nothing);
- one link under the table, "Open the employee relations record", opens
  `/relations/employments/{employmentId}` — where the server's total finally appears. The summary
  itself still shows no total, because `record-api` deliberately keeps only `items`; the full
  record is now one click away instead of unreachable.

Nothing else on the record changed for Relations; nothing is duplicated. The record answers "is
there anything"; the relations screens answer "what exactly, and where does each case stand".

## I. Employee Record history repair — separate from the slice

**The defect.** `apps/admin/src/employment/api.ts` (workforce directory loader) fetched
`page.items[0]` — the first row of the tenant-wide listing — and requested
`/employments/{first.employmentId}/history`, which `TimelineSection` rendered under the heading
"History" on `/employment`. The screen displayed an arbitrary employee's status history and
placements, naming nobody. The fixture's own comment admitted it: *"The first employment's
history, so the screen can show what a timeline looks like."*

**The cause.** A Phase-13-era demo of effective dating, written before any screen had a single
employment as its subject, surviving seven slices because the section title never said whose
timeline it was.

**The repair** — smallest existing-contract composition, no new backend capability:

1. The workforce loader asks for the listing and nothing else. `WorkforceForDisplay.history` is
   gone, `TimelineSection` is gone, and the directory makes exactly one request.
2. The history moved to where an employment is *requested*: the Employee Record now reads
   `GET /employments/:id/history` — published, bounded to one employment, keyed on the identifier
   the record was opened by — and renders **only its status timeline** as a "Status history"
   section (`StatusHistorySection`). The history view's other three timelines (assignments,
   reporting lines, contracts) already render from their own dedicated reads and are not rendered
   twice.
3. `answeredNothing` counts the new read, so a fully-locked deployment still collapses to one
   sentence.

```text
Requested employment → GET /employments/:id/history → that employment's history
```

**Regression protection**, with two distinct employments so the bug class is detectable:

- `record-api.test.ts`: a stub answers a *different* history for each of two employments;
  `loadRecord` for e001 must return e001's `employmentId` and e001's `recordedBy`. The
  every-read-keyed-on-the-requested-employment test now counts 14 reads (15 with a manager) and
  still forbids any URL naming another employment.
- `record.test.tsx`: renders the section for the requested employment (SANCTION,
  membership-hr-041) and proves the other employment's history produces detectably different
  markup — so a future leak cannot render identically.
- `directory.test.tsx`: the workforce loader issues exactly **one** request and never a
  `/history` URL, with two employments on offer and the *other* one first in the page.

Rendered proof: with the stub serving both employees, Layla Haddad's record shows her three status
entries (including the SANCTION suspension) recorded by `membership-hr-041`; Omar Nasser's record
shows his single entry recorded by `membership-hr-099`. Neither shows the other's.

One localization key was added for the repair: `employment.label.reason` (EN "Reason" /
AR "السبب"), for the status change's `reasonCode` column.

## J. Assets / Custody relationship

Relations' contracts expose **no reference to assets, custody or clearance** — no view carries an
asset, a custody or a clearance field — so the Relations screens compose none. The two sections
sit beside each other on the Employee Record because both are governance facts about one
employment, and that adjacency is all the runtime establishes. AD-006's clearance relationship
belongs to offboarding reading *Assets'* contract, not to Relations, and nothing here implies
otherwise.

## K. Product findings — what rendering revealed

Found by running the product against a stub (two employees, all states), not by the tests:

1. **The case state rendered three times on one screen** — the header badge, a "State" fact in the
   violation grid, and the case history's derived-state badge. The grid's copy is gone; in its
   place the grid carries the frozen `categoryCode` (which the header, showing today's catalogue
   name, does not). The header keeps the record's state; the history keeps the module's derived
   state beside the trail it derives from. Pinned by a test that forbids the grid from repeating
   either the state badge or the header's category name.
2. **`under_investigation` rendered in the brand tone, which on this palette reads as an alarm** —
   exactly the "colouring an allegation red" the frame's own comment forbids. Every state is now
   muted except `action_issued` (warning), the one state somebody is expected to act on.
3. **"Followed the ladder / Followed the ladder"** — the `prescribedByRule` fact's label and its
   yes-value were the same sentence. The closed pair is now plain Yes/No under the label that asks
   the question.

Considered and deliberately kept:

- **Instants render whole** (`2026-05-04T09:12:00.000Z` on "Recorded" and on case-history rows).
  The trail is the record read back in a dispute; truncating the time of a transition to its date
  would discard the fact. The civil dates the module publishes as dates render as dates.
- **The violations list has no occurrence column.** The module decorates only the single read —
  an ordinal per row would cost a window query per item — and the screen does not fake one. The
  record's pre-existing summary keeps its occurrence column (dashes on list rows), unchanged.
- **The repeat section's contributing violations are bare identifier links.** The module publishes
  identifiers only; each links to its own case, where its facts are.

## L. Localization

- English and Arabic, exact key parity — `check-localization` reports 20/20 catalogue sets
  complete. All new keys nested (the flat-dotted-key defect is pinned out by the catalogue-shape
  tests, applied to Relations' catalogue).
- 20 keys added to the Relations catalogue in both languages (withheld/empty sentences,
  back-links, from/to, boundaries label, the Yes/No pair); 1 to Employment's (`label.reason`).
  Existing vocabulary reused everywhere else — states, action types, investigation states, all 11
  boundary notices — none duplicated.
- Translated: violation state, investigation state, action type, source (closed vocabularies the
  module ships bilingually). Never translated: `severity` and `categoryCode` (the tenant's own
  words), identifiers, dates.
- RTL: verified rendered at 1440 and 390 in Arabic. Every Latin run — codes, severities, dates,
  instants, identifiers, ordinals — is isolated; the `N / M` ratio is one `<bdi>`; ordinals and
  window lengths are `<bdi dir="ltr">`. The sweep's detector proves it can catch an unisolated
  value before any sweep is trusted (the blind-helper lesson from three earlier slices).
- The employment relations page renders its Arabic heading with the person's Arabic name; free
  text (descriptions, findings, reasons) renders in its own direction inside either language.

## M. Mobile

390 px and 1440 px, both languages. Facts grids collapse to one column; every table scrolls inside
its own container (the case-history table's six columns scroll; the page never scrolls sideways);
identifiers stay whole; the header badge and back-links wrap cleanly. Screenshots taken for both
screens in both widths, plus the loading skeletons.

## N. Security

- **Read-only.** The composition layer sends no POST, PUT, PATCH or DELETE — asserted
  structurally against the source, which also proves every import is a published contract and
  every path a served controller route.
- No permission added or modified; `relations-permissions.ts` untouched. Authorization outcomes are
  rendered, never re-decided: the screens display refusals, they do not infer entitlements.
- The audit property is surfaced to the reader: the module's own sentence — "Every time a
  violation is opened, that is recorded against your name" — renders under the violations list and
  in the case boundaries, because a screen that silently caused audited reads would surprise the
  people it records.
- Anti-probe semantics preserved: unknown case and other-tenant case render the same not-found
  page, written to be true for both; withheld findings stay unmarked.

## O. Tests

Workspace totals after the slice: **471 test files, 5,401 tests, 0 failed, 0 skipped** — up from
466 files and 5,345 tests at the Slice #8 baseline: 5 new files and 56 new tests, all of them this
slice's.

- `relations/api.test.ts` (11) — employment scope of every URL, outcome discrimination (404 ≠
  403 for the case; the action's 404 as empty), `asAt` = conduct date, no-store, contracts-only
  imports, no writes, served-paths.
- `relations/employment-relations.test.tsx` (7) — refused ≠ empty, server total `2 / 7`, case
  opens by identifier kept whole, catalogue naming + frozen-code fallback, no occurrence column,
  severity untranslated in both languages, audited sentence on-screen.
- `relations/case.test.tsx` (15) — employment link, derived ordinal (dash when underivable, never
  a defaulted 1), no state/name duplication in the facts grid, actor+reason on every transition,
  empty history ≠ refused, findings-withheld renders no marker, policy silence stated, "nothing
  issued" ≠ "you may not know", frozen issued action.
- `relations/rtl.test.tsx` (13) — primitives, self-checking detector, six full-section Arabic
  sweeps.
- `relations/localization.test.ts` (7) — catalogue shape, 75-key resolution in both languages,
  visible-gap fallback, bilingual naming.
- Employment-area regressions (+3 across the existing suites) — section I.

## P. Full gate

Run with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; 31 migrations
applied, 187 tables). One honesty note on mechanics: `pnpm verify --force` forwards `--force`
only to the last command in its chain, so the gate was run as the same six stages with `--force`
passed to each turbo stage explicitly — semantically `pnpm verify`, with nothing replayed. An
earlier attempt that collapsed the four turbo stages into one parallel invocation produced two
compensation-suite failures from database contention; `pnpm test` runs `--concurrency=1` for
exactly that reason, and the serial run was clean.

- `pnpm standards`: engineering standards, architecture (186 models), localization (20/20
  catalogue sets), dependencies (2028 source files, no cycles, no unused, no unreachable),
  **platform parity: 5 packages = lockfile, all `registry`, `@munaxa/platform 1.6.1`** — the
  guard active and unmodified.
- `pnpm format:check`: clean.
- `turbo run lint --force`: 51/51 tasks, 0 cached, 1m58.295s.
- `turbo run typecheck --force`: 51/51 tasks, 0 cached, 40.115s.
- `turbo run test --concurrency=1 --force`: 51/51 tasks, 0 cached, 8m47.61s — **471 test files
  passed, 5,401 tests passed, 0 failed, 0 skipped**, integration suites running against the live
  database (no `skipIf` fired).
- `turbo run build --force`: 29/29 tasks, 0 cached, 1m11.893s.
- Exit 0.

## Q. Remaining gaps — known and deliberately not fixed

- **`notFound()` at HTTP 200** on streaming detail routes — repository-wide, tracked separately,
  inherited by both new routes (out of scope by instruction).
- `GET /relations/investigations/:id` and `GET /relations/disciplinary-rules` have no consumer
  (reasons in section E). The ladder and catalogue have no administration screens; the module's
  write capabilities (record, investigate, conclude, correct, issue) have no screens — this slice
  is read-only by instruction, and the writes need the authenticated principal this repository
  deliberately lacks (ADR-0001/0032).
- The record's Relations summary still shows no server total (its API shape keeps `items` only);
  the linked relations record carries it.
- The employment relations list reads one bounded page (50); no pager UI. An employment with more
  violations than one page shows `50 / M`, honestly.
- Deep-dive rendering of `empty` and `silent` modes was verified through their unit-tested
  sentences and screenshots; the live-API walk (real NestJS, real PostgreSQL) still answers 401
  for everything, as ADR-0032 dictates — the stub walk remains the rendered evidence.

## R. Git

- Branch: `claude/munaxa-product-readiness-audit-8mr34d`, base `bd729c4`.
- One commit for the slice and the repair together in tree but separated in the message's
  narrative; working tree clean after commit; pushed to origin.
- Changed surface: Relations product composition (`apps/admin/src/relations/*`,
  `apps/admin/src/app/relations/*`), Relations contract re-exports (one file), Relations + 
  Employment locale additions, Employee Record history repair and its regression tests, this
  document. No unrelated module, no completed slice beyond the identified defect, no Platform, no
  package version, no CI, no parity guard, no migration. No `file:`, no source link, no `/tmp`
  path, no credential.
