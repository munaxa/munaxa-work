# Phase 13 — Admin UI

Continues from the API checkpoint (`87dc8a1`). Everything below was produced by running the code;
nothing is inferred from reading it.

---

## 1. The architecture this had to match, and what that decided

Before writing anything I read all twelve existing Admin screens — Employment, Recruitment,
Onboarding, Attendance, Leave, Compensation, Payroll, Documents, Letters, Organization, People and
the root. The established shape is uniform and narrower than it might appear:

| Convention | What the repository actually does |
| --- | --- |
| Page structure | one `src/app/<module>/page.tsx`, a server component |
| Routing | flat, one route per module; **no navigation component exists anywhere** |
| Server/client boundary | **zero client components.** `grep -rl "'use client'" apps/admin/src` returns nothing |
| API client | `src/<module>/api.ts`, server-side `fetch`, published contract types only |
| Localization | `src/<module>/locale.ts` reading the module's own `locales/{en,ar}.json` |
| RTL | `dir={directionOf(language)}` on `<main>`; direction follows `?lang` and is never separate |
| Tables | plain `<table>` in a `Card` from `@munaxa/ui` |
| Lifecycle | a pure, unit-tested module (`payroll/lifecycle.ts`) computing which actions a state permits |
| Design system | `Card` and `Button` from `@munaxa/ui`; Tailwind utilities; no colours in any module screen |
| Testing | vitest on pure logic. No jsdom, no testing-library, no `@testing-library/*` in any package |

**There are no forms, no dialogs, no drawers, no confirmations, no mutations and no state anywhere in
the Admin portal.** Not in Payroll, which finalizes payroll runs; not in Documents, which verifies
documents. Every screen reads and reports.

That is load-bearing for this checkpoint. §1 says *"Do NOT introduce a second UI architecture"* and
§23 says to use the existing design system and conventions. Several later sections — forms (§17),
confirmations (§19), concurrency UX (§20), duplicate-submission prevention — describe interactions
that **do not exist in this product at all**. Building them for Performance alone would have made
Performance the only module with a write surface, a second architecture by definition, and would
have required inventing form, dialog and confirmation components the design system does not ship.

**What I did instead**: delivered the complete read, observability and lifecycle-transparency surface
in the established shape, and recorded the mutation-UX items honestly in §12 as not-applicable-yet
with the reason. Nothing was quietly skipped and nothing was faked.

---

## 2. Workspace and route inventory

One route, following the convention every other module uses:

```
/performance            (server component, ƒ dynamic, 385 B route JS)
/performance?lang=ar    same page, Arabic and RTL
```

Twelve workspaces on it, in the order an administrator reads them:

| Workspace | Section | Source |
| --- | --- | --- |
| Overview | `OverviewSection` | counts over the cycle's own listings + server totals |
| Cycles | `CyclesSection` | `GET /cycles` |
| Rating scales | `ScalesSection` | `GET /rating-scales` |
| Competency frameworks | `FrameworksSection` | `GET /frameworks` |
| Review templates | `TemplatesSection` | `GET /templates` |
| Goal categories | `CategoriesSection` | `GET /goal-categories` |
| Goals | `GoalsSection` | `GET /goals?cycleId=` |
| Goal progress | `ProgressSection` | the goal detail carried by the listing |
| Review queue | `ReviewQueueSection` | `GET /reviews?cycleId=` |
| Rating | `RatingSection` | `GET /reviews/:id` |
| Working | `WorkingSection` | `GET /reviews/:id` component scores |
| Assessments | `AssessmentsSection` | `GET /reviews/:id` assessments |
| 360 panel | `PanelSection` | `GET /reviews/:id` reviewers + `peerAggregate` |
| Calibration | `CalibrationSection` | `GET /calibration-sessions?cycleId=` |
| Nine-box | `TalentSection` | `GET /talent/matrix?cycleId=` |
| Feedback | `FeedbackSection` | `GET /feedback` |
| Reconciliation | `FindingsSection` | `GET /reconciliation?cycleId=` |
| Unavailable capabilities | `UnavailableSection` | none — a statement of what does not exist |

Files: `api.ts`, `locale.ts`, `lifecycle.ts`, `scoring.ts`, `sections.tsx`, `configuration.tsx`,
`goals.tsx`, `reviews.tsx`, `panel.tsx`, `overview.tsx`, and the page.

### Not built

- **No One-to-One and no PIP screens.** Out of scope for this phase.
- **No OKR screens.** `performance_objective` and `performance_key_result` have tables and RLS but no
  application port, no API route and therefore nothing to show. The screen says so.
- **No "My Team".** See §6.
- **No document upload, download or link.** See §10.
- **No navigation entry**, because the Admin portal has no navigation component. See §12.

---

## 3. API usage

Every value on the screen came down an HTTP response from `/api/v1/performance/*`. Audited in §11:
no Prisma, no database, no repository, no application handler, no domain import.

**Twelve requests, and the number does not grow with the data.** Five module-level listings, six
scoped to one cycle, and one review detail. A workspace that fetched the calibration sessions of
every cycle in the list, or the detail of every review in the queue, would be the N+1 this is written
to avoid.

**Every request is bounded**: `page=1&size=50` on all eleven listings. Nothing fetches a collection in
order to count or filter it in the browser — the server's own `total` is displayed beside the page
size, so an administrator looking at fifty goals in a cycle of four thousand is told so.

**Failure is closed and distinguished.** The cheapest read is made first; if it fails, the page
renders the unauthenticated state rather than eleven more failed requests. A read that fails while
others succeed — the talent matrix, reconciliation — renders "withheld", because that difference is a
permission boundary rather than an outage, and an empty table would imply neither.

---

## 4. Score presentation and exactness

**Nothing on this screen computes a score.** The engine decided; the screen renders.

The one formatting operation is **string surgery, never arithmetic**:

```ts
const pointed = (digits: string, places: number): string => { … };   // insert a decimal point
export const scoreText = (score) => pointed(String(score), 2);       // 370 → "3.70"
export const weightText = (weight) => `${pointed(String(weight), 2)}%`; // 6000 → "60.00%"
export const exactText = (value) => value ?? '—';                    // identity, with a name
```

`score / 100` and `(score / 100).toFixed(2)` are both division on a value the database holds exactly.
For a rating scale's magnitudes they agree with the string form; agreeing by accident is not the same
as agreeing, and the string cannot drift.

`exactText` is deliberately the identity function **with a name**, so a future reader reaching for
`Number(observedValue)` to "format" it meets the explanation instead.

### The mandatory exactness regression (§31)

Asserted twice — once on the helper, once on the **rendered markup**:

```ts
expect(markup).toContain('9007199254740993');
expect(markup).not.toContain('9007199254740992');
```

`9007199254740992` is what `Number('9007199254740993')` produces: the last digit simply gone, with
nothing to indicate it. The API suite proved the server sends the value; this is the only test in the
repository that proves a browser puts those digits on a page.

Also asserted: `370` renders `3.70` and never `369.99…`; `0` renders `0.00` while absent renders `—`
(a screen showing `0.00` for an unscored review would tell somebody they were rated at the bottom of
the scale); `5` renders `0.05` rather than losing its leading zero; a whole template's components
total `100.00%`.

**No `Number(...)`, no `parseFloat(...)` and no arithmetic on any Performance value.** The `grep` hits
for those patterns are all inside comments explaining why they are not used — §11.

### Calibration

The calculated and calibrated scores are **separate fields, both rendered**, with the reason, the
actor and the timestamp. A single "score" field would have made a moderated rating indistinguishable
from an engine-produced one, which is exactly what the module refuses to do in the database.

A calibration that **examined a rating and confirmed the engine's figure is not labelled an
override**. `wasModerated` requires the two numbers to differ; calling agreement an override would
misrepresent what the panel decided to the person whose rating it is. And a review nobody calibrated
renders no original at all rather than an empty one implying a decision was taken.

---

## 5. Lifecycle presentation

`lifecycle.ts` computes which actions a cycle, review or goal state permits — the pattern
`payroll/lifecycle.ts` established. Eleven tests.

**This is usability, not authorization**, and the module says so in its own text and on the screen
(`performance.notice.actionsAreUsability`). The API refuses every one of these independently; a
caller with `curl` gets 403, 409 and 422 regardless of what any screen rendered.

| State | Named | Withheld, and why |
| --- | --- | --- |
| Draft cycle | open, cancel | enrol — nothing to enrol into yet |
| Open cycle | enrol, close, cancel | — |
| Closed / cancelled cycle | nothing | `cycleClosed` / `cycleCancelled` |
| Unscored review | assignReviewer, assess, score | complete, calibrate — `notScored` |
| Scored review | + calibrate, complete | — |
| Completed review | archive only | `reviewCompleted` — immutable |
| Archived review | nothing | `reviewArchived` |
| Draft goal | amend, approve | recordProgress — nobody approved it |
| Active goal | amend, recordProgress, closeGoal | — |
| Closed goal | nothing | `goalClosed` |

There is **no status dropdown**. Actions are named operations matching the API's own route names,
and a withheld action says why rather than leaving a gap somebody refreshes the page over.

---

## 6. `read-team` — NOT VERIFIED, and not faked

```
read-team principal resolution = NOT VERIFIED
```

**`managerEmploymentId` is never sent by this screen.** There is no manager picker, no "My Team" tab
and no impersonation. The API honours the parameter only for a caller holding `review.read-all`,
where it narrows somebody who could already read everything — so a control here would be an
administrator's filter wearing an employee's identity.

The screen states the position in both languages
(`performance.notice.readTeamUnavailable`): a manager's own queue is unavailable because this product
cannot yet resolve a signed-in person to their employment, so nothing can prove a caller is the
manager they name.

The one place `managerEmploymentId` appears in the UI is a **table column showing a review's own
manager** — data the API returned about the record, not a filter and not a credential.

---

## 7. Self, peer and manager assessments

Stated **next to each assessment**, not once in a footnote:

- manager → `performance.notice.managerCounted` — "The assessment the calculated score is derived
  from."
- self → `performance.notice.selfNotCounted` — "Recorded and readable. It does not contribute to the
  calculated score."
- peer → the same.

Asserted in the render tests: both notices appear, and the self assessment's own `5.00` is still
readable — it is recorded, not hidden. No column is headed "contribution" for a self or peer row, no
weight is shown against one, and no field implies either was counted. No weighting was invented.

---

## 8. 360 confidentiality

```
true 360° anonymity = NOT VERIFIED
```

The word "anonymous" appears **exactly once** in the rendered page, inside the sentence that denies
it: *"Reviewer identity is confidential, not anonymous. Every response records who wrote it."* The
render test asserts the count is one and that the denial is present.

That assertion started as `expect(markup).not.toContain('anonymous')` and **failed**, correctly — the
honest screen is the one that says the word in order to refuse it. The test was wrong, not the
screen; the corrected assertion is stronger.

Every reviewer row is attributed: the author's employment identifier is on the page, never a
placeholder. Below the configured minimum the panel aggregate shows **no score at all** and says
`aggregateWithheld` — that withholds a number, and the field is called `available` rather than
`anonymous` for exactly that reason.

Arabic asserted too: `ليست مجهولة` — "is not anonymous".

---

## 9. Localization, RTL and accessibility

**Complete English and Arabic.** 152 new keys added to the module's own catalogues
(`performance.label`, `.notice`, `.action`, `.withheld`) — the same files
`check-localization.mjs` gates, not a second copy in the portal. `check-localization`: 14 catalogue
sets complete.

**No hardcoded English or Arabic anywhere.** A `grep` for prose in JSX returns nothing; every string
is a catalogue key. A missing key renders as the key itself, which the Arabic render test asserts is
absent (`expect(markup).not.toContain('performance.label.')`).

**Direction follows language.** `dir={directionOf(language)}` on `<main>`; `?lang=ar` switches both
together and there is no separate toggle — separating them is how a page ends up left-aligned in
Arabic. Asserted.

**Accessibility**, verified against the rendered markup:

- header cells are real `<th scope="col">` — asserted
- **status is never colour alone**: every status renders its translated word, and no module screen in
  this repository sets a colour
- wide tables scroll inside `overflow-x-auto` rather than pushing the page sideways — asserted
- headings are a real hierarchy: `h1` for the page, `h2` per section, `h3` per framework/template
- figures are `<dl>`/`<dt>`/`<dd>` pairs, so a label is programmatically tied to its value

There is no keyboard-interaction or focus-management surface to verify: the page has no interactive
control. That is a fact about the page, not an untested claim.

**Responsive**: grids are `grid-cols-2 sm:grid-cols-3`, tables scroll in their own container, and the
page uses no fixed widths.

---

## 10. Documents

A goal's `evidenceDocumentId` renders as a shortened **identifier and nothing else**. No filename, no
size, no hash, no URL, no download control.

```
binary document upload / download / signed URLs = NOT VERIFIED
```

Stated on the screen (`performance.notice.noDocumentBytes`) and asserted absent by the API contract
suite, which checks the goal view carries no `url`, `downloadUrl` or `storageReference`.

---

## 11. UI audit (§35)

`grep` over `apps/admin/src/performance` and `apps/admin/src/app/performance`:

| Pattern | Result |
| --- | --- |
| Prisma / `PrismaClient` | none |
| direct database / SQL | none |
| domain, application or infrastructure import | none — contracts only |
| `Number(score)` | **4 hits, all inside comments explaining why it is not done** |
| `parseFloat` | none |
| `score * …` / `score / …` | **2 hits, both in comments** naming what the code avoids |
| client-side authorization | none — `lifecycle.ts` states it is usability, and the page repeats it |
| client-controlled manager identity | none — `managerEmploymentId` is never sent |
| fake "My Team" | none — one comment saying there is not one |
| fake 360 anonymity | none — the word appears once, denying itself |
| fake notification delivery / scheduling / upload | none — each is stated as unavailable |
| hardcoded English or Arabic | none |
| arbitrary colours (`#rgb`, `rgb(`) | none |
| `any` | none |
| `as unknown as` | none |
| `eslint-disable` | none |
| `.only` / `.skip` | none |

---

## 12. Defects found, and what was deliberately not built

**1. A render assertion that was wrong about the right thing.**

```
× never uses the word anonymous, in either language
  → expected '<div class="rounded-xl border border-…' not to contain 'anonymous'
```

The markup contains "anonymous" because the notice *denies* anonymity. The property I meant is that
the screen never **claims** it. Corrected to assert the word appears exactly once, inside the denial,
and that every row is attributed. The screen was right; the test was crude.

**2. React escapes apostrophes, and a test compared against unescaped text.**

```
× lists every capability this product does not have
  → expected '<div class="rounded-xl border border-…' to contain 'A manager\'s own queue is unavailable…'
```

`'` renders as `&#x27;`. Asserting against the raw catalogue string fails on text that rendered
perfectly — a test bug wearing the shape of a defect. Fixed with an `escaped()` helper that applies
React's own text-node escaping.

**3. `ReferenceError: React is not defined` in every `.tsx` test.**

Next compiles this app with `jsx: "preserve"` and applies the automatic runtime itself; vitest
transforms with esbuild, which defaults to the *classic* runtime. Fixed with a five-line
`vitest.config.ts` naming the automatic runtime. No DOM environment and no testing library was
added — `renderToStaticMarkup` produces the HTML a browser receives, and `react-dom` was already a
dependency.

**4. The published `CompetencyView` carries no behavioural levels.** The listing publishes what a
reader needs to know a competency *is*; levels are configuration a framework editor would need. The
column was replaced with the competency's active state rather than rendering an empty one that would
imply the framework had no levels. Recorded as debt below, not worked around.

### Deliberately not built, with reasons

| §  | Item | Why not |
| --- | --- | --- |
| 17 | Forms | No form exists anywhere in the Admin portal, and the design system ships no form control. Building one here makes Performance the only module with a write surface — a second UI architecture, which §1 forbids. |
| 19 | Confirmation dialogs | Same: no dialog component, no dialog in any screen. A confirmation guarding an action that cannot be taken guards nothing. |
| 20 | Concurrency conflict UX | The API returns a deterministic 409 with a localized message and the API suite asserts it. There is no mutation from this screen to conflict, so there is no stale-write state to render. The catalogue key (`performance.notice.conflict`) is in place for the phase that adds writes. |
| 34 | Navigation entry | **The Admin portal has no navigation component.** Twelve module screens are standalone routes with no links between them. Adding a shell means editing `layout.tsx` and every existing page — a cross-phase change to completed work, which this checkpoint forbids. |

Each of these is a gap in the *portal*, not in Performance, and each would be resolved for all twelve
modules at once by whichever phase introduces the write surface.

---

## 13. Performance observations

Not benchmarked — out of scope for this checkpoint. What was looked for:

- **Repeated or duplicate fetches**: none. Each endpoint is read once per page render.
- **N+1**: none. Cycle-scoped reads are made once for one cycle, never per row; the review detail is
  read for one review, never per queue entry. Twelve requests total, independent of data volume.
- **Fetching entire collections**: none. Every read is `page=1&size=50`; totals come from the server.
- **Polling**: none. The page is server-rendered per request with `cache: 'no-store'`.
- **Giant payloads**: the review detail is the largest response and is bounded by one review's own
  assessments.
- **Client bundle**: the route adds **385 B** of route JS on a 223 kB shared shell — the same shell
  every other Admin route loads, because the page ships no client component.

The overview's counts are over the **returned page**, not the tenant. That is a real limitation and
the better trade: counting a tenant's whole review set in a browser is precisely what §15 and §16
exist to prevent, and it would fall over on the first customer with a real workforce.

### Technical debt

- The Admin portal has no navigation, no forms, no dialogs and no mutation surface. Performance
  matches the twelve modules before it; the gap is the portal's.
- `CompetencyView` publishes no behavioural levels, so a framework's levels cannot be displayed.
- The overview's derived counts are page-scoped, as above.
- `vitest.config.ts` is the first in `apps/admin`; the other apps have none because they have no
  `.tsx` tests.

---

## 14. Test results

| Suite | Tests |
| --- | --- |
| `performance/scoring.test.ts` | 8 |
| `performance/lifecycle.test.ts` | 11 |
| `performance/render.test.tsx` | 14 |
| `payroll/lifecycle.test.ts` (pre-existing) | 11 |
| **`@work/admin` total** | **4 files, 44 tests** |

Coverage against §30: render (14 markup assertions against real React output), forms *(none exist)*,
validation *(none exist)*, permissions (withheld vs empty vs unauthenticated, distinguished),
lifecycle actions (11), pagination (server totals rendered beside page size), filters (server-side,
never client), conflict handling *(no mutation to conflict)*, exact score display (the mandatory
2^53 + 1 regression, on the markup), Arabic/English (both rendered and asserted), RTL (direction tied
to language), empty states, error states.

No UI test substitutes for an API authorization test. The API's own 27 tests over real PostgreSQL
remain the authority, and the UI tests say so in their own text.

---

## 15. Gates

Run with `TEST_DATABASE_URL` configured, uncached (`--force`), at `--concurrency=1`.

| Gate | Result |
| --- | --- |
| `check-standards` | no violations |
| `check-architecture` | 143 models, no violations |
| `check-localization` | 14 catalogue sets complete |
| `check-dependencies` | 1241 files, no cycles, no unused dependencies, no unreachable files |
| `format:check` | all files match Prettier |
| `lint` | 41/41 |
| `typecheck` | 41/41 |
| `test` | **41/41 tasks, 0 cached** |
| `build` | 24/24 — `/performance` route builds at 385 B |

`pnpm verify` exits **0**. No skipped tests, no `.only`, no hidden failures.

---

## 16. NOT VERIFIED

Unchanged, and no screen fabricates any of them. Each is stated on the page itself in both languages
so a later reader cannot build a control on top of a capability that is not there.

- **principal → employment self-service routing** — no "My Team", no manager picker
- **`read-team` without a trusted manager employment** — the parameter is never sent
- **notification delivery** — intent is recorded; nothing delivers it
- **scheduled execution** — nothing opens or closes on a timer
- **binary document upload, download and signed URLs** — an identifier only
- **true 360° anonymity** — confidentiality, and the screen says so
- **self / peer weighting** — recorded, readable, counted by nothing
- **OKR functionality** — tables and RLS, no application contract, no screen

---

## Status

**Phase 13 — ADMIN UI COMPLETE**

One route, twelve workspaces, the complete read and observability surface of the 49 API endpoints, in
the shape every Admin screen in this product has: server-rendered, contract-typed, bounded, bilingual
and direction-aware. Scores rendered by string surgery and never by arithmetic, with the 2^53 + 1
regression asserted against real markup. Lifecycle actions named per state with the reason any is
withheld, and the screen saying plainly that the server decides. Calibration showing both numbers.
Self and peer assessments labelled as counting for nothing. No fake "My Team", no claimed anonymity,
no document bytes, no invented KPI and no OKR screen.

The mutation surface — forms, dialogs, confirmations, concurrency UX — is absent because it is absent
from the entire Admin portal, and §12 records that rather than working around it.

Stopping here. No benchmarks, no Phase 14, no new Performance features.
