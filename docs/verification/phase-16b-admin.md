# Phase 16B — Checkpoint 7 — Admin UI

**Admin UI only.** No schema change, no migration, no domain rule, no application command or query,
no permission, no repository, no API route and no cross-module adapter. No completed module was
touched. The only production code outside `apps/admin` is the Workflow module's own **locale
catalogues**, which is where every Admin string in this product lives (`apps/admin` keeps none of its
own).

The route is unchanged: **`/workflow`**, server-rendered, `?lang=en` and `?lang=ar`.

---

## Sections — sixteen, five of them new

| Section | Source |
| --- | --- |
| Overview | `overview.tsx` — five server totals |
| **Approval groups** | `groups.tsx` *(new)* |
| **Members of this group** | `groups.tsx` *(new)* |
| Workflows, Versions, Approval chain | `definitions.tsx` — the chain gained five columns |
| Approvals, This approval's chain | `instances.tsx` — the chain gained two columns |
| **Branches and tallies** | `branches.tsx` *(new)* |
| **Awaiting a decision now** | `branches.tsx` *(new)* |
| Approval status, Timeline | unchanged |
| Waiting for you, Decided by you | unchanged |
| **What this release added** | `status.tsx` *(new)* |
| What this product does not do | `status.tsx` — rewritten |

The 16A screen was extended rather than redesigned: no existing section was removed, renamed or
restructured, and no existing honesty notice was weakened.

---

## Requests: ten at most, and never more with more data

| Endpoint | When |
| --- | --- |
| `GET /definitions?page=1&size=50` | always |
| `GET /instances?page=1&size=50` | always |
| `GET /approval-groups?page=1&size=50` | always |
| `GET /approvals/pending?page=1&size=50` | always |
| `GET /approvals/decided?page=1&size=50` | always |
| `GET /definitions/:id` | first row only |
| `GET /instances/:id` | first row only |
| `GET /instances/:id/history?page=1&size=50` | first row only |
| `GET /approvals/:id/status` | first row only |
| `GET /approval-groups/:id` | first row only |

**Budget: 10.** Zero rows → **5** (the five listings; no first row to read a detail for). One row →
**10**. Fifty rows → **10**. A service that will not answer at all → **1**.

Ten of the twenty-two API routes, all of them `GET`. The five `POST`/`DELETE` routes the module
publishes are named in the notices as API capabilities and none is called.

**N+1, proved rather than asserted.** The request-budget suite stubs `globalThis.fetch` — the HTTP
boundary and nothing above it — and re-runs the whole load with **fifty rows in every listing**. The
count is unchanged at ten, and `/approval-groups/` appears exactly once. A member-count column on the
group listing is precisely what would have made that fifty, so there is no such column: the listing
view carries no count, and inventing one would cost a request per row. The count lives on the detail,
for one group, and a notice says which group and why.

---

## Groups: an explicit list, said in as many words

The listing shows the code, the bilingual name, the identifier and the row version. The detail shows
those, the number of memberships, and every membership with the instant it was added.

A membership is rendered **in full**. Every other identifier on the screen is shortened to eight
characters for the width of a cell; a membership must not be, because these are UUIDv7 — the leading
forty-eight bits are a millisecond timestamp, so two memberships added on one afternoon share their
first eight characters, and a list of two people would render as the same person twice. A test pins
exactly that collision.

Nothing resolves a membership to a name: this screen holds no Identity contract and makes no request
to one, so a name here would be invented.

The word "group" is now allowed as a column, and the words that would turn a list into a directory
are not. A test scans every heading, `<th>` and `<dt>` of both sections and refuses **role**,
**department**, **organizational unit**, **manager**, **team**, **reports**, **directory**,
**position**, **employment**, **dynamic**, **owner**, **status** and **effective** — the last three
because a group has no lifecycle and a column implying one would be a lifecycle somebody thought they
had set.

---

## Configuration, branches and tallies

The published chain gained `approverKind`, the approver group, the branch rule, the quorum and the
condition. A step configured before Phase 16B carries none of the last three, and its cells render as
absent rather than filled with the defaults the domain would apply — printing `unanimous` on a step
nobody configured that way would report a decision the tenant never made.

A running step gained the **source group** — provenance for "why was I asked?" — and its branch rule.
Every running step names a person whatever the version named, because the list was resolved into its
members before the row existed.

The tally table renders all eleven published figures: position, rule, asked, approved, rejected,
answered, outstanding, approvals needed, quorum, quorum state and outcome.

**No arithmetic, and the assertion is over the source rather than the markup.** `branches.tsx`
contains no `/`, no `* 100`, no `Math.`, no `toFixed`, no `%`, no width style and no progress bar,
and no figure is combined with another. A screen can render the right number today and still hold the
division that produces the wrong one tomorrow. The fixture is built so a derived figure would
disagree: `majority` over a denominator of two needs **two** approvals and **one** has been made, so
a screen reusing `approvals` or computing `floor(2 / 2)` prints `1` where the server says `2`.

A branch is several steps at one position, and the awaiting section is a table rather than a row. A
recorded decision renders as that decision and never as a skipped step.

---

## Conditions: configuration, never a verdict

Each clause renders as its key, its comparison and its operand. The key is the raising module's own
word and is printed untranslated; the operator is this module's closed vocabulary and is translated.
A whole-number bound goes through the same integer function as every other number, so `4000` reads
identically in both languages. A list operand keeps its configured order.

**Nothing is evaluated.** No true, no false, no "would run", no tick. The server tells three
configuration mistakes apart from an ordinary "the condition did not hold" — the request does not
carry the value, the value is of a kind the comparison cannot use, and the value is of a different
kind from the one configured — and a screen printing `false` would collapse four outcomes into one,
three of them somebody's mistake to fix. A step with no condition renders as having none, not as one
that is always true.

---

## Decisions, and the queue

Unchanged from 16A and re-asserted: a direct decision shows the actor with its acting-for cell
**absent** rather than filled from the actor; a delegated one shows the delegate and the approver in
two labelled columns, taken from the API's own fields and never inferred by comparing identifiers.
The rejection comment stays on the decision and never reaches the timeline.

The queue reads `page` and `size` and nothing else. There is no membership selector, no "view as", no
approver picker, no `me` and no `my-team` — and there is no parameter to get wrong because there is
no parameter at all. Two suites check this: one over the requests actually made, one over the source
of `api.ts`, so a parameter added behind a condition a stubbed run might not take fails as well.

---

## Honesty, in both directions

**Six capabilities moved from absent to present.** Approval groups, group membership, parallel
approval, the three branch rules, the quorum, conditional branching and the tally were all on the
16A deferred list. Leaving them there would be the same dishonesty pointed the other way — telling an
administrator this product cannot ask two people at once, on a page rendering a branch that does.
They are now stated as implemented in a new **"What this release added"** section, and the catalogue
keys that claimed they were missing were **deleted**, so a screen cannot render one by accident and a
later reader cannot resurrect one.

Two entries were **rewritten rather than removed**, because what is absent is narrower than what was
absent:

- *Roles* — "There is no role directory and no role approver. A step names a member or an approval
  group — an explicit list — and never a role."
- *Group directory* — "There is no group directory. An approval group is a list a tenant maintains;
  no department, organizational unit or membership query is resolved into one."

**Seventeen absences remain**, three of them added by this checkpoint: SLA, business days,
escalation, scheduling, approval expiry, delegation expiry, **delegated-access management**, roles,
**group directory**, manager routing, external approvers, notification delivery, analytics,
asynchronous callbacks, outbox, **routing intelligence** and **self-service portals** — plus the
three portal-level facts the screen states about itself.

The structural-claims test moved with the product. Four words left its forbidden list — branch, rule,
quorum, tally — and are now asserted **present** as columns, because the data is there to describe.
What stays forbidden is every word that would still be a claim: SLA, service level, escalation, due,
overdue, elapsed, age, business day, role, manager, team, directory, department, analytics, rate,
average, bottleneck, compliance, notification, reminder, schedule, upload, download, webhook.

---

## Read-only, and server-rendered

No `<form>`, `<button>`, `<input>`, `<select>`, `<textarea>` or `<dialog>`; no `href`, no `onclick`,
no `use client`, no `useState`, no `useEffect`, no router and no `window.`. Asserted over the whole
rendered route and again over every production source file of the workspace. The 16A architecture is
read-only and this checkpoint kept it: a create-group or add-member form would be a second UI
architecture introduced for one module, and a button that did nothing would be worse than the
sentence saying the server decides.

No image was added and no new dependency. The existing cards, tables and typography are unchanged.

---

## Localization

Every new string is in the Workflow module's own catalogues, English and Arabic, with real Arabic
script. **Twenty-five new labels, six new notices, four new vocabularies** (branch rule, branch
outcome, condition operator, quorum state), one new `approverKind` term, **six `provided` entries**
and **four new `withheld` entries**; four `withheld` keys were deleted and two rewritten.

Codes, subject types, condition keys, membership identifiers and UUIDs are never translated. No
English is hard-coded in any component, and no catalogue key renders anywhere — asserted for
`workflow.label.`, `workflow.vocabulary.`, `workflow.notice.`, `workflow.withheld.` and
`workflow.provided.` in both languages. Direction moves with language: `dir="rtl"` and `lang` for
Arabic, `ltr` for English, and `ltr` with English text for an unknown language.

---

## Exactness

Instants render through the one UTC-pinned function. The regression case is kept:
`2026-02-28T23:30:00.000Z` renders as the **28th at 23:30** in both languages, and never as
`01/03/2026` (the day it becomes east of UTC) or `15:30` (west of it). No clock is consulted — a test
asserts today's date appears nowhere on the page.

Integers render through `String` and nothing else: no thousands separator, no Arabic-Indic digits, no
decimal. `4000` is `4000` in both languages, in a tally figure and in a condition operand alike.
Memberships render in full; other identifiers are shortened for display and never converted.

---

## Tests

| Suite | Tests |
| --- | --- |
| `api.test.ts` — request budget, N+1, identity absence, failure handling | 16 |
| `render.test.tsx` — sixteen sections, both languages, empty states | 12 |
| `page.test.tsx` — route, direction, mounting, no controls, no deferred route | 8 |
| `honesty.test.tsx` — instants, integers, actor vs authority, the state nothing reaches | 14 |
| `notices.test.tsx` — what was added, what is still absent, structural claims | 7 |
| `groups.test.tsx` — listing, detail, membership rendering, what a group is not | 13 |
| `branches.test.tsx` — tallies, parallel steps, approver kinds, conditions | 18 |
| `boundary.test.ts` — the security boundary, over the source | 6 |
| **Workflow Admin total** | **94** |

`renderToStaticMarkup` throughout: no jsdom, no Playwright, no Cypress, no testing-library, no new
dependency. The only thing mocked anywhere is `globalThis.fetch`.

---

## Defects and deviations

**One defect, classified as a test defect.** The new boundary suite failed on `api.ts` and `page.tsx`
because it searched the **prose**: the file names `workforceUserId` in the sentence saying it never
sends one, and describes the path a value takes "through a repository to PostgreSQL". Fixed in the
test by stripping comments before searching — the same correction the API route spec needed in
Checkpoint 6, and for the same reason: an assertion that fails on the paragraph explaining a refusal
forces the code to stop explaining itself. A type-only import survives the strip, so a real leak still
fails.

Three deviations, each deliberate:

1. **No member count on the group listing.** The listing view does not publish one and a column would
   cost a request per group. The count is on the detail, for the first row, and a notice says so.
2. **No branch or tally figure in the overview.** A tenant-wide "approvals awaiting a majority" is an
   aggregate no endpoint answers; producing one would mean reading every approval. The overview shows
   only totals the server counted, and the branch section shows the tallies of the one approval read.
3. **No separate "running approvals" figure.** The API publishes a total over all approvals, not one
   over the running ones. Filtering the page in the browser would report a page as an organization.

Two files were split for the 400-line budget: the 16B fixtures into `branches.fixture.ts`, and the
claims half of `honesty.test.tsx` into `notices.test.tsx`. No test was weakened, skipped or deleted.

---

## Gates

- `pnpm standards`: clean — 176 architecture models, 17 catalogues, 1,676 files, no cycles, no unused
  dependencies.
- `format:check`, `lint`, `typecheck`, `build`: clean, 47/47 and 27/27.
- Prisma validate: valid. Migrate status: up to date, 22 migrations — unchanged, as this checkpoint
  added none.
- Repository-wide, uncached, `--concurrency=1`: **3,471 passed, 0 failed, 0 skipped**, 338 files,
  47/47 tasks. Admin: 224 in 19 files, of which Workflow is 94 in 8. Workflow module: 530. API: 599.
- No `.only`, no skipped test, no `eslint-disable`, no `any`.

---

## Not verified

- No 16C capability is displayed and no placeholder control exists for one: SLA, business days,
  escalation, scheduled firing, `JobPort`, manager routing, role approvers, dynamic group
  directories, external approvers, notification delivery, analytics, approval expiry and automatic
  delegation expiry are named as absent and have no column, figure or control anywhere.
- No condition is evaluated in the browser, and no evaluated result is displayed, because the API
  publishes none.
- The screen renders the first row's detail for a definition, an approval and a group. Reading a
  chosen row would need a route parameter and a second read path; that is a navigation design, not
  this checkpoint's.
- Every business endpoint still answers 401 until Platform's authentication adapter is supplied
  (ADR-0032). The screen fails closed and says the service did not answer, which it distinguishes
  from a tenant with nothing in it.
