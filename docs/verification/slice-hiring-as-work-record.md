# Product Slice — Hiring as Work

**Date:** 2026-08-24
**Branch:** `claude/munaxa-product-readiness-audit-8mr34d`
**Definition of Ready:** [`next-product-slice-investigation.md`](./next-product-slice-investigation.md) §G
**Kind:** product vertical slice. Not a phase, and not a continuation of the numeric phase sequence.

Recruitment had forty-two published routes, twelve of them reads, and a screen that called three of
them: `requisitions`, `vacancies` and `candidates`, rendered as three unrelated lists in 261 lines,
with no row that opened, no application anywhere, and nothing that said how many people were in a
pipeline. This slice turns that backend into a workflow a recruiter can actually work in —
requisition → vacancy → pipeline → application → interview → feedback → hire state — and it does so
with **no backend change of any kind**.

---

## A. What shipped

Three routes in `apps/admin`, all read-only.

| Route | Files | What it is |
|---|---|---|
| `/recruitment` | `page.tsx` (reworked), `loading.tsx` | The hiring workspace: four server totals, then requisitions with headcount, vacancies, the pipeline board, applications and candidates |
| `/recruitment/requisitions/[requisitionId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One requisition: requested / filled / remaining headcount, who requested it, who decided it, its decision history including reversals, and each of its vacancies with that vacancy's pipeline |
| `/recruitment/applications/[applicationId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One application: the candidate, the status and stage, the full movement history, the interviews, the panel's verdicts where permitted, the offers' states, and how far a hire got |

Dynamic segments follow **ADR-0075**. Links are plain `<a>` elements, as in both previous slices —
`import Link from 'next/link'` is rejected by `@typescript-eslint/naming-convention`, and that reason
is recorded in the code rather than by adding a second standards ADR.

**Before and after, measured.** Recruitment's published GET routes consumed by the product went from
**3 of 12** to **10 of 12**. The two not consumed are `/recruitment/export` (a permissioned export,
not a screen) and `/recruitment/applications/:id/interviews`, which is deliberately unused because
`ApplicationSnapshot` already carries the interviews and asking twice is what the module's own
handler comment warns against.

---

## B. Existing backend capability used

Every request below already existed, was already registered in `apps/api/src/recruitment/`, and was
already behind a declared permission. **Nothing was added to the API.**

| Request | Returns | Permission | New to the product? |
|---|---|---|---|
| `GET /recruitment/requisitions?page=1&size=25` | `PagedResult<RequisitionView>` | `recruitment.requisition.read` | no |
| `GET /recruitment/requisitions/:requisitionId` | `RequisitionSnapshot` | `recruitment.requisition.read` | **yes** |
| `GET /recruitment/vacancies?page=1&size=25` | `PagedResult<VacancyView>` | `recruitment.vacancy.read` | no |
| `GET /recruitment/vacancies/:vacancyId/pipeline` | `PipelineView` | `recruitment.application.read` | **yes** |
| `GET /recruitment/applications?page=1&size=25` | `PagedResult<ApplicationView>` | `recruitment.application.read` | **yes** |
| `GET /recruitment/applications/:applicationId` | `ApplicationSnapshot` | `recruitment.application.read` | **yes** |
| `GET /recruitment/candidates?page=1&size=25` | `PagedResult<CandidateView>` | `recruitment.candidate.read` | no |
| `GET /recruitment/candidates/:candidateId` | `CandidateSnapshot` | `recruitment.candidate.read` | **yes** |
| `GET /recruitment/interviews/:interviewId/feedback` | `readonly FeedbackView[]` | `recruitment.interview.feedback.read` | **yes** |
| `GET /employments/:employmentId` | `EmploymentView` | employment read | no (slice 1 already made it) |

Contracts consumed, all from `@work/recruitment/contracts` and `@work/employment/contracts`:
`RequisitionView`, `RequisitionDecisionView`, `RequisitionSnapshot`, `VacancyView`, `PipelineView`,
`CandidateView`, `CandidateSnapshot`, `ApplicationView`, `ApplicationEventView`,
`ApplicationSnapshot`, `InterviewView`, `FeedbackView`, `OfferView`, `EmploymentView`.

Three properties of that read model made this slice possible without touching the backend, and each
was a decision the module took for a screen that did not exist yet:

- **`ApplicationSnapshot` returns the application, its history, its interviews and its offers in one
  bounded read** — the handler's comment says why: *"answering it in four round trips is four
  chances for a screen to show an interview from one state beside a status from another."* This
  slice makes exactly one request for all four.
- **`PipelineView` counts in the database.** *"A vacancy with forty thousand applications has a
  pipeline summary that is an aggregate query, not forty thousand rows the API filters."* The board
  renders `countsByStatus` and `total` and adds nothing to either.
- **`FeedbackView` is published per interviewer and never aggregated.** *"Whether three fours beat
  one five is a hiring policy this module has no business inventing."* Neither does the screen.

---

## C. What changed

### Composition — `apps/admin/src/recruitment/`

| File | Lines | What it holds |
|---|---:|---|
| `api.ts` (rewritten) | 240 | `loadHiring`, `loadRequisition`/`loadRequisitionDetail`, `loadApplication`/`loadApplicationDetail`. One `read` that fails closed; `Listing<T>` carrying items **and** the server's total together |
| `frame.tsx` | 232 | `Term`, `Fact`, `Facts`, `HiringSection`, `Refused`, `Clear`, `Rows`, `Cell`, `Identifier`, `Reference`, `Isolated`, `shownOf`, `Boundaries` |
| `exact.ts` | 76 | `day` (a civil date, unreformatted), `instant` (UTC-pinned), `count` (`String`, never `toLocaleString`), `reference` (whole, never shortened) |
| `tones.ts` | 74 | The seven status vocabularies' tone maps |
| `workspace.tsx` | 246 | The overview, the requisitions table, the vacancies table, `answeredNothing`/`NothingReadable`, the boundaries |
| `pipeline.tsx` | 280 | The pipeline board, the applications table, the candidates table |
| `requisition.tsx` | 234 | Headcount, the requisition summary, the decisions table |
| `application.tsx` | 277 | The candidate block, the application summary, the history table |
| `panel.tsx` | 293 | Interviews, panel feedback, offers |
| `hiring.fixture.ts` | 301 | The tenant's hiring as Recruitment would answer it |
| `locale.ts` (rewritten) | 105 | Merges the portal's catalogue with Recruitment's; `textIn`, `nameIn`, `orderedStatuses` |

`sections.tsx` (141 lines) was deleted; everything it did is in `workspace.tsx` and `pipeline.tsx`,
in the design language.

### Navigation

**Unchanged.** `/recruitment` is already in the shell's Workforce group, and the two new routes are
records opened from it — the same shape as `/employment/[employmentId]`, which the shell also does
not list separately. A standing test asserts the destination is still there.

### Localization

`packages/modules/recruitment/locales/{en,ar}.json` — the module's own catalogues, gated by
`scripts/check-localization.mjs`, kept in step:

- **98 label keys**, up from 20. Everything the three screens name.
- **A new closed vocabulary**, `status.decisionOutcome` (`approved`, `rejected`, `reversed`) — the
  three values `RequisitionDecisionView.decision` publishes, which had no translation because no
  screen had ever shown a decision.
- **Two keys removed**: `label.unavailable` and `label.empty`. Both belonged to the two-state
  `unavailable` model this slice replaced, and nothing references them.
- The six status vocabularies, the five recommendations and the hire states were **already there in
  both languages** and are used unchanged.

### Tests

Recruitment had none. It now has **75 tests and 184 assertions** across four suites, each anchored
to a rule the authorization stated rather than to coverage:

| Suite | Tests | What it proves |
|---|---:|---|
| `api.test.ts` | 17 | The exact request literals; that none names a caller; explicit paging; refused ≠ empty on every read; one pipeline per vacancy; one candidate read and one feedback read per interview; that the snapshot is never taken apart |
| `workspace.test.tsx` | 19 | Refused ≠ empty ≠ populated; the refusal said once; server totals; no candidate name in the applications list; stage order from the module's own vocabulary; no percentage anywhere; `<bdi>` isolation; no control |
| `record.test.tsx` | 21 | No offer figure though the fixture carries one; three verdicts stay three rows with no average, sum or majority; a wholly withheld panel says so once; a stopped hire stays visible; contact details render nowhere; an approval identifier is not a link; organizational references stay whole |
| `routes.test.tsx` | 18 | All three routes end to end; the subject is resolved first; not-found rather than a page of refusals; Arabic direction; a loading skeleton that carries no text at all; the navigation destination; that no write is composed anywhere |

---

## D. What was deliberately not changed

**No file under `packages/modules/recruitment/src/` was touched.** `git diff --name-only` confirms
the only module files in this commit are the two locale catalogues.

Not added, not modified, not wired:

- No route, query handler, command, permission, contract view, domain event or port.
- No Prisma model, column, migration or index.
- `workflowApprovalPortFor` — still composed nowhere. The requisition record shows `approvalId` when
  it is present and offers **no link**, because there is no approval instance in this deployment for
  a link to open.
- `ListPositions.positionId`, `DescribeUnit`, any unit or cost-centre lookup — the Organization
  bounded-read investigation stays future work, untouched.
- `recruitment.offer.read` — declared and enforced nowhere. Recorded in K, not fixed: narrowing who
  may see offer data is an owner decision, not a side effect of a UI slice.
- No other module's screen was re-laid-out "for consistency".
- No write of any kind: no stage move, screening, interview scheduling or conclusion, feedback
  submission, offer draft/issue/decision, requisition submission or decision, vacancy opening or
  publication, hire, import or export. **513 routes, 0 forms** remains true.

---

## E. Product findings

Found by running the product and looking at it, not by reading the code. All six were fixed inside
this slice.

**P1 — The stage chips ran the word into the number.** `Received118`, `مستلم118`. JSX collapses the
whitespace between a translated word and an isolated number, so the two became one token and the
pipeline read as a set of nonsense words. *Fixed:* an explicit `·` separator, and `whitespace-nowrap`
so a chip stays one line and the table scrolls rather than towering on a phone.

**P2 — `5 / 26` rendered as `26 / 5` in Arabic.** Only the total was `<bdi>`-isolated, leaving the
page count as a second left-to-right run; the bidirectional algorithm puts the later run first, so
every section header claimed a page larger than its own total. *Fixed:* the whole ratio is one
isolated run. This is the kind of defect that is invisible until somebody reads the Arabic.

**P3 — Four KPI tiles and five section headings each carried the same apology.** When nothing
answered — the ordinary state of this deployment — the workspace was nine repetitions of *"This
section was withheld"*. That is exactly the "screen of repeated apology" the Employee Record's
verification named and settled. *Fixed:* a tile shows a dash and no sentence, and when not one of the
four reads answered the whole workspace is replaced by one `EmptyState` saying it once — the same
shape `RecordBody` uses.

**P4 — A wholly withheld panel repeated its sentence per interview round.**
`recruitment.interview.feedback.read` is held by a caller, not by an interview, so every round is
always refused together. *Fixed:* when every round is withheld the section is one line; a mixed case
(possible if one interview 404s) still says so per row.

**P5 — The requisitions list carried a column of position identifiers.** Unresolvable, all alike at a
glance, and wide enough to push the three headcount figures — the numbers the screen exists for —
toward the edge. *Fixed:* dropped from the list and kept on the requisition record, where there is
one of it. The same call the employee directory made.

**P6 — The vacancy's status appeared twice on the workspace**, once in Vacancies and again in
Pipeline. *Fixed:* the pipeline table carries status only on the requisition record, where it is the
only list of that requisition's vacancies.

One more change came from reading the rendered record rather than from a defect: **the application's
row `version` was removed from the summary.** A concurrency token is not something a recruiter acts
on. The offer's `offerVersion` stays, because "this is the second offer we made" is a business fact.

---

## F. States verified

Each was produced against a fixture API answering the real contract shapes, and inspected as
rendered HTML.

| State | How it was produced | What the product does |
|---|---|---|
| **Populated** | every read answers | Four server totals, five sections, every status as a word |
| **Empty** | every read answers `{items: [], total: 0}` | Five *different* sentences — "No headcount has been requested", "Nothing is open for applications", "Nobody has applied", "No candidate has been recorded" — and totals of 0 |
| **Refused** | every read answers 401 | One sentence, once: *"Nothing on this screen could be read"* over *"No principal is authenticated…"*. No section heading repeats it, no tile carries it, and no figure is invented |
| **Partially refused** | one read answers 403, the rest answer | That section says it was withheld in its own place; its neighbours render normally |
| **Withheld** | the application answers, the candidate and the feedback answer 403 | The candidate fact says withheld and shows the reference it does have; Panel feedback says withheld once — never that nobody gave feedback |
| **Loading** | `loading.tsx` rendered directly | A skeleton whose text content is empty, asserted by test: no placeholder figure, ever |
| **Not found** | the subject read answers 401/404 | The record's own page: *"No requisition with this identifier was returned"*, the reason it is probably not absent, and a way back. Nothing else is asked for once the subject fails |

---

## G. English / Arabic / RTL

- Both routes and the workspace render in `en` and `ar`; `?lang=` switches **language and direction
  together** via `directionOf`. There is no separate direction control.
- Arabic renders from Recruitment's own catalogue throughout — asserted by a test that the markup
  contains no untranslated `recruitment.label.` key.
- Every Latin run inside translated text is `<bdi>`-isolated: requisition, application, candidate and
  offer numbers, civil dates, instants, source and reason codes, stage codes, publication channels,
  and every identifier. Verified in the rendered Arabic page, not only in tests.
- The ratio defect (P2) was found and fixed in Arabic specifically.
- Codes are never translated. `careers_site`, `walk_in`, `on_site`, `panel_scheduled` are tenant and
  country-pack values, and looking them up in a list this product ships would invent meanings the
  domain refuses to hold.

---

## H. Desktop / mobile

Verified at **1440 px** and **390 px** with rendered screenshots of all three routes.

- The four totals sit in one row at desk width and stack two-by-two on a phone (`KpiGrid`'s own
  breakpoints).
- Every table scrolls inside its own `overflow-x` container; the page body never scrolls
  horizontally at 390 px.
- No identifier is truncated to make a column fit — the table scrolls instead, which is what the
  design system's `Table` is for.
- The `Facts` blocks fall from three columns to one; the requisition's three headcount figures stay
  in one row, because three short numbers are legible on a phone and are the reason that record
  exists.

---

## I. Tests

**75 tests, 184 assertions**, all passing, none skipped. The admin application's suite as a whole:
**36 files, 438 tests**, up from 32 files and 363 before this slice.

```
✓ src/recruitment/api.test.ts        (17 tests)
✓ src/recruitment/workspace.test.tsx (19 tests)
✓ src/recruitment/record.test.tsx    (21 tests)
✓ src/recruitment/routes.test.tsx    (18 tests)

Test Files  37 passed (37)
     Tests  438 passed (438)
```

Two assertions are worth naming because they guard properties no rendered output would reveal:

- **The request literals are extracted and asserted as a list.** Every path this composition can
  construct is compared against the exact set the authorization approved, and each is checked to
  name no membership, principal, actor or `me`. A composed request that named a caller would let
  anybody holding the permission read as somebody else.
- **No write is composed anywhere.** Nine source files — the three routes and the six composition
  modules — are read and asserted to contain no `method: 'POST'`, no form, button or input, and no
  `'use client'`.

---

## J. Full gate

`pnpm verify` = `standards && format:check && lint && typecheck && test && build`.

**Passed — exit 0, 29 tasks successful.**

```
Engineering Standards: no violations.
Architecture: 186 model(s) checked, no violations.
Localization: 20 catalogue set(s) complete.
Dependencies: 1945 source file(s), no cycles, no unused dependencies, no unreachable files.
prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"  — all matched files use Prettier code style
eslint .  — clean across every package
tsc --noEmit  — clean across every package
vitest run  — 3415 passed, 1624 skipped, 0 failed
next build / tsc -p tsconfig.build.json  — every app and package built

 Tasks:    29 successful, 29 total
  Time:    50.509s
```

The 1,624 skipped tests are the repository's standing behaviour: the integration suites skip
themselves when `DATABASE_URL` is not set for the test run. None of them is in this slice, and none
was skipped, disabled or quarantined by it — the admin suite runs **36 files, 438 tests, 0 skipped**.

PostgreSQL 16 was started locally and all **32 migrations** applied cleanly with the repository's own
pinned Prisma (`prisma migrate deploy` → *"All migrations have been successfully applied"*). This
slice adds no migration; the run confirms the schema this branch carries is still deployable.

---

## K. Remaining findings, recorded and not fixed

1. **`recruitment.offer.read` is declared and enforced nowhere.** Its only occurrence in the module
   is the constant at `recruitment-permissions.ts:56`. Offers — including `proposedCompensation` —
   reach any caller holding `recruitment.application.read` inside `ApplicationSnapshot`, while the
   module's own doc comment states that offers are read behind their own permission. This slice
   works around it by rendering no offer figure at all. **Owner decision**: narrowing who may see
   offer data changes who can see what, and is not a side effect of a UI slice.
2. **`ApplicationView` carries no candidate name.** The applications list therefore shows none, and
   says so. Adding one would be a contract change; resolving one per row would be the unbounded read
   the module's handlers warn about. Left as it is.
3. **The Organization bounded-read findings stand**, untouched and unchanged from the investigation:
   `ListUnits` has no `unitId` filter, `DescribeUnit`/`UnitDetail` are declared with no handler or
   route, and `ListPositions.positionId` is not forwarded by its controller. A position, a unit and a
   cost centre render as identifiers on the requisition record, and the boundaries note says why.
4. **An approvals boundary string is now known to be inaccurate.** `admin.approvals.membershipsAreIdentifiers`
   says *"no module publishes a lookup from a membership to a person"*; the investigation established
   that `GET /identity/members/:membershipId` (`identity.describe-member`) returns the membership's
   business profile including a display name. The claim is wrong at the HTTP level, though correct at
   the module-contract level. It belongs to the approvals slice, not this one, and changing another
   slice's shipped text is outside this authorization.
5. **`/recruitment/export` and `/recruitment/applications/:id/interviews` remain unconsumed.** The
   first is a permissioned export rather than a screen; the second is redundant with the snapshot and
   is left unused on purpose.

---

## L. Git state

- **Commit:** `12f0edf` — *Product Slice — Hiring as Work*, which carries every file listed above.
  This document's own hash line is filled in by the small follow-up commit directly after it, since
  a commit cannot record its own identifier.
- **Branch:** `claude/munaxa-product-readiness-audit-8mr34d`, pushed to `origin`
- **26 files changed**: 24 under `apps/admin`, 2 locale catalogues. `sections.tsx` deleted.

- Working tree clean.
- **No local registry workaround is committed.** The `@munaxa/*` packages are published to GitHub
  Packages and this session's token carries no `read:packages` scope, so the platform packages were
  built from public source in the scratchpad and linked through nine `pnpm.overrides` entries in the
  root `package.json` for the duration of the work. Those entries were **reverted before the commit**
  — committing them would break CI's `--frozen-lockfile` install. `git diff HEAD -- package.json`
  is empty.
