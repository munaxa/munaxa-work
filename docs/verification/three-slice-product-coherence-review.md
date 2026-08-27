# Munaxa Work — Three-Slice Product Coherence Review

**Date:** 2026-08-24
**Branch:** `claude/munaxa-product-readiness-audit-8mr34d`
**Head at review:** `1c100f7`
**Kind:** review only. No production code was changed, no slice was selected, nothing was built.

The three delivered slices — the Employee Record, Approvals as Work, and Hiring as Work — were
developed independently. This asks one question of the result: **does Munaxa Work now feel like one
coherent commercial enterprise HR product?**

The rendered product is the authority here, not the verification documents. The application was
built, run against a fixture API answering the published contract shapes, and inspected at 1440 px
and 390 px in English and Arabic across every surface named in the task, plus Payroll and the
workforce directory for comparison.

---

## A. Product coherence verdict

# Mostly strong.

The three slices are unmistakably one product. What is not yet coherent is the **thirteen screens
around them**, and the gap is now wide enough to see at a glance.

**The evidence for "strong", from the running application:**

- **One shell, and it works.** `WorkspaceShell` wraps every route: sidebar with four labelled
  groups, collapse rail, mobile drawer, skip link, one language switch that changes language and
  direction together. Active navigation is correct on detail routes, because `isCurrent` is a
  prefix match — `/employment/0190…` keeps *Employment* marked.
- **The seven adopted routes are visually indistinguishable in kind.** The six slice routes and the
  workforce directory all use `Page width="wide"` and the same `PageHeader` shape: a back link above
  where there is a parent, a human title, a description, and a status `Badge` in `actions`. Not one
  of them deviates.
- **The withheld idiom is the most consistent thing in the product.**
  `admin.notice.sectionWithheld` appears **24 times across all three slices** and reads identically
  everywhere. A reader who learns what it means on the Employee Record knows what it means on the
  hiring pipeline.
- **All four record routes carry `loading.tsx` and `not-found.tsx`**, and all four not-found pages
  say the same true thing — the API returned nothing for this identifier, and here is why that is
  probably not absence.
- **Arabic is a first-class rendering, not a translation layer.** The whole frame mirrors; tables,
  facts and badges all flip; numbers and codes keep their direction.

**The evidence for "not yet fully coherent":**

- **Three page layouts coexist in one application.**

  | Layout | Routes | Which |
  |---|---:|---|
  | `Page width="wide"` + `PageHeader` | **7** | the three slices, their three record routes, and the workforce directory |
  | `mx-auto max-w-4xl … p-8`, raw `<h1>` | **8** | home, attendance, compensation, leave, onboarding, organization, payroll, people |
  | `flex flex-col gap-6 p-8` (full bleed, no max width) | **6** | career, documents, learning, letters, performance, workflow |

  The content column visibly starts and stops in three different places depending on which screen
  you are on.

- **Only 6 of 21 page routes set a title — and all six are the three slices.** `Employee record`,
  `Approvals`, `Approval`, `Hiring`, `Requisition`, `Application`. The other fifteen — including the
  home page and the workforce directory — fall back to `Munaxa Work — Administration`. With the
  shell making every screen reachable, a user with four tabs open cannot tell them apart.

- **The home page is the sidebar, rendered twice.** Four cards listing the same sixteen destinations
  that sit in the sidebar to their left. It was the only navigation before the shell existed; it is
  now duplication on the first screen anybody sees, and it is in the old layout.

- **Payroll is the clearest counter-example.** Eighteen stacked `Card`s, each with a heading and the
  words *"Nothing to show yet."* — see §J.

The product has a strong centre and an unfinished perimeter. That is a good place to be after three
slices; it is not a coherent whole yet.

---

## B. Shell and navigation assessment

### Coherent

- **The grouping reads to an HR user.** *Workforce · Operations · Talent · Governance* is four words
  an HR administrator understands without training, and it is not a module list: `Approvals` and
  `Workflow configuration` are deliberately in different groups, which is the single most important
  navigation decision in the product and it is right.
- **`Approvals` is correctly positioned as personal work.** It is first in Operations, and the
  comment in `navigation.ts` says why: *"it is the only destination in this portal whose content is
  addressed to the reader personally, and a queue somebody has to go looking for is not work."*
- **No control that lies.** No search box, no notification bell, no user menu — each would be a
  control with nothing behind it. The collapse toggle and the drawer are real.
- **Language and direction never separate.** One switch, one parameter, `dir` set on the element
  wrapping both frame and content.

### Inconsistent or incomplete

1. **No breadcrumbs anywhere.** The record routes use a back link in `PageHeader above` — *"Back to
   the workforce directory"*, *"Back to approvals"*, *"Back to hiring"*. That is a consistent
   pattern and it works at one level of depth. It does not scale: a vacancy pipeline opened from a
   requisition would need two levels, and the pattern has no second level. Not a defect today;
   a structural limit worth knowing about.
2. **The top bar is nearly empty.** At 1440 px it is a full-width band holding a sidebar trigger and
   a language link. It carries no page title, no context. That is honest — but it means the only
   thing telling you where you are is the sidebar highlight and the `<h1>`.
3. **Fourteen screens have no page title** (above).
4. **The home page duplicates the sidebar** (above) and answers no question. Its own comment
   explains why it holds no figures — every number an administrator would want is a cross-module
   read that does not exist. That reasoning is sound and the consequence is still that the front
   door of the product is a link list.
5. **Navigation is becoming module-centric at the edges, not at the centre.** *People*,
   *Employment*, *Organization*, *Attendance*, *Leave*, *Compensation*, *Payroll*, *Documents*,
   *Letters*, *Performance*, *Career*, *Learning* are module names. *Approvals* and *Hiring* are
   work. The two slices that named themselves after the work rather than the module are the two that
   read as product.
6. **`admin.nav.recruitment` is "Recruitment" while the screen it opens is titled "Hiring".** One
   destination, two names. Small, and the only outright terminology mismatch found.

---

## C. Employee Record — cross-product observations

The record itself is not reopened here. Three observations are only visible *because* two more
slices now exist.

**C1 — It is the only one of the three slices that does not isolate identifiers, and Arabic shows
it.** `record-frame.tsx`'s `Identifier` renders
`<TD className="font-mono text-xs text-muted-foreground">{value}</TD>` with no `<bdi>`; the
approvals and hiring frames both wrap the value in `Isolated`. In the rendered Arabic record the
truncated person, unit, position, career-statement and asset-category identifiers show as
`…01900000` — **the ellipsis on the wrong side**, reading as though the beginning were elided. This
is a real rendering defect in the product's flagship screen, and the other two slices already have
the fix. *Classification: fix now (next authorization).*

**C2 — Three slices, three rules for the same identifier.** The record truncates to eight
characters; approvals shows memberships in full and truncates subjects; hiring shows everything
whole. Each has a written justification, and each contradicts the next. Hiring's argument is the
strongest and applies to all of them — UUIDv7's leading bits are a timestamp, so two identifiers
created in the same window share their first eight characters and render identically. The record's
own footnote (*"a shortened identifier is shown rather than a name this screen invented"*) argues
for showing an identifier, not for shortening one.

**C3 — The workforce directory was converted to the design language and one section was left
behind.** Its `PageHeader` and workforce table are `Page`/`PageHeader`/`Table`/`Badge`;
`TimelineSection` directly beneath is raw `<ul>`/`<li>` with `opacity-80`, `opacity-60` and
`short()` truncation. And it is titled just **"History"** while showing the history of
`page.items[0]` — *the first row's* timeline, with nothing on screen saying whose. This is the same arbitrary-first-row pattern as Payroll's
`runs[0]`, on the screen that introduces the record. Now that every row opens a record, this section
has no reason to be on the list at all.

---

## D. Approvals — cross-product observations

**D1 — The strongest missing link in the product.** Every row in *Waiting for you* has
`subjectType: 'recruitment.requisition'` and a `subjectId`. Since the Hiring slice,
`/recruitment/requisitions/[requisitionId]` exists and takes exactly that identifier. The queue does
not link to it, and the boundary note says *"describing one in business terms means asking the
module that owns it"* — a statement that was true when it was written and **is no longer true**: the
product now owns a screen for that exact subject type. The two ends of the same chain are one
`href` apart and unconnected. *Classification: fix now (next authorization) — it needs no backend
change, only a subject-type-to-route mapping for the one type that exists.*

**D2 — The approval detail's `<h1>` is a machine token.** The largest text on the page is
`recruitment.requisition`. Every other record in the product titles itself with a human value —
*Layla Haddad*, *REQ-000417*, *APP-009913*. Same root cause as D1: with a requisition record now in
the product, the subject could be named.

**D3 — Identifier treatment is inconsistent within the single screen.** The description line prints
the subject in full (`Subject: 01900000-0000-7000-8000-00000000r001`) while the `Facts` block two
rows down prints `APPROVAL 01900000…` truncated.

**D4 — One boundary line is now factually wrong.** *"A membership is shown in full and never as a
name: no module publishes a lookup from a membership to a person."* The next-slice investigation
established that `GET /identity/members/:membershipId` (`identity.describe-member`) returns
membership + business profile including `displayName`. The claim is right at the module-contract
level and wrong at the HTTP level. *Classification: fix now — it is shipped product text that
overstates a limitation.*

**D5 — The terminology is the best in the product.** *"A named member"*, *"The requester's
manager"*, *"An approval group"*, *"Their own"* / *"Delegated"*, *"Not yet reached"*, *"Against
target"*. This is the vocabulary the rest of the product should be measured against.

---

## E. Hiring — cross-product observations

**E1 — It is the most product-shaped of the three.** Four server totals, then requisitions →
vacancies → pipeline → applications → candidates, in the order the work happens. It is the only
screen in the application that opens with figures a person acts on.

**E2 — It set the identifier rule the other two should follow** (see C2), and the `<bdi>` isolation
the record lacks (see C1).

**E3 — It is the only slice that connects outward.** A completed hire links to
`/employment/[employmentId]` — the one place in the product where one workflow hands off to another
by a route. Nothing links back (see §G).

**E4 — Its empty-state language is specific where the record's is generic.** *"No headcount has been
requested"*, *"Nothing is open for applications"*, *"Nobody has applied"* against the record's single
`admin.label.empty` = *"Nothing to show."* used for every section. The specific version is better
product; the record's generic one is not wrong, only weaker.

**E5 — `approvalId` is rendered and deliberately not linked**, because `workflowApprovalPortFor` is
composed nowhere so the identifier is always absent in this deployment. That reasoning holds. It is
worth recording that **both ends of that link now exist as screens** — see §G.

---

## F. Shared UX findings

| # | Finding | Evidence | Classification |
|---|---|---|---|
| F1 | The Employee Record does not `<bdi>`-isolate identifiers; Arabic renders the ellipsis on the wrong side | `record-frame.tsx:184`, rendered `record-ar` | **fix now** |
| F2 | Approvals does not link a `recruitment.requisition` subject to the requisition record that now exists | `queue.tsx`, `/recruitment/requisitions/[id]` | **fix now** |
| F3 | The approvals boundary note claims no membership-to-person lookup exists; one does over HTTP | `admin.approvals.membershipsAreIdentifiers` | **fix now** |
| F4 | Three different identifier rules across three slices (truncated / mixed / whole) | C2 | **future design-system refinement** — one rule, stated once |
| F5 | Fifteen of twenty-one page routes set no title; the six that do are exactly the three slices | `metadata` audit | **future refinement** (small, product-wide) |
| F6 | Three page layouts coexist across 21 routes: 7 `Page`+`PageHeader`, 8 `max-w-4xl`, 6 full-bleed | layout audit | **future refinement** — resolves as each screen becomes a slice |
| F7 | The home page duplicates the sidebar | rendered `home-en` | **future refinement** — belongs to whatever replaces it |
| F8 | The workforce directory's "History" shows an unattributed first row, in the old idiom | `sections.tsx` `TimelineSection` | **future refinement** (belongs with a directory slice) |
| F9 | The record's loading skeleton is `max-w-5xl`; every other is `max-w-6xl` | `loading.tsx` audit | **future refinement** |
| F10 | `admin.nav.recruitment` says "Recruitment"; the screen says "Hiring" | navigation vs `metadata` | **future refinement** |
| F11 | Generic vs specific empty-state sentences (record vs approvals/hiring) | E4 | **future refinement** |
| F12 | Minutes rendered raw (`9600 min`, `480 min`, `Overdue by (minutes) 2880`) | record, approval detail | **intentional difference** — the owning module publishes minutes and ships the word; converting would invent a working day. Commercially notable (see §I) |
| F13 | Codes rendered untranslated (`FULL_TIME`, `careers_site`, `panel`, `LATENESS`) | all three slices | **intentional difference** — tenant and country-pack values |
| F14 | Each slice page sets `dir`/`lang` on its own wrapper although `WorkspaceShell` already does | every slice `page.tsx` | **no action** — harmless, and it keeps each page correct when rendered in isolation by tests |
| F15 | Two links per row to the same destination in the workforce directory (number and person name) | rendered `directory-en` | **no action** |

---

## G. Information architecture findings

**What each user would click first, from the rendered navigation:**

| User | First click | Does it serve them? |
|---|---|---|
| **Recruiter** | *Recruitment* | **Yes.** The strongest single answer in the product. |
| **HR administrator** | *People* or *Employment* | **Partly.** *Employment* gives the directory and the record — the product's centre. *People* is 2 of 5 reads and an old-layout page. |
| **Manager** | *Approvals* | **Partly.** The queue is the right destination, but nothing in the product is scoped to a manager's team; there is no manager workspace. |
| **Employee** | — | **No.** There is nothing for them. `apps/employee-portal/src` is four files, and no route in 513 answers "who am I". |

**Findings:**

1. **Recruitment reads as a workflow; almost everything else reads as a module.** That is the
   product's clearest signal about which direction works.
2. **The Employee Record is a destination, not a viewer** — it composes eleven modules and is
   reached from a directory and from a completed hire. It has earned the centre.
3. **Approvals is correctly separated from Workflow configuration** and the separation is documented
   in `navigation.ts`. Keep it.
4. **Three shipped modules have no destination at all**: `assets` (7 GET routes), `relations` (10),
   `identity` (4). Assets and relations reach the product through exactly one route each, inside the
   Employee Record; identity through none.
5. **Destinations that now look obviously incomplete beside the slices** — backend exists, product
   surface does not: **Payroll** (§J), **Organization** (4 of 12 reads, no unit detail),
   **People** (2 of 5 reads, no person record, on a screen that introduces the register the whole
   product depends on).
6. **The gap between the best and worst screen has widened.** That is the expected cost of slicing,
   and it is the argument for continuing to slice rather than for normalizing everything at once.

---

## H. The repeated cross-module reference problem

**Verdict: yes — it now warrants its own investigation, and the previous scoping holds.**

Four surfaces now show unresolved cross-module references, up from two when the problem was first
named:

| Surface | Unresolved | Resolvable? |
|---|---|---|
| Employee Record | organizational unit, position, asset category | **no** — Organization publishes no reachable read by identifier |
| Approvals queue & detail | `subjectId`, membership identifiers | **partly** — the subject is resolvable *by route* since Hiring (F2); memberships are resolvable over HTTP (D4) |
| Requisition record | position, organizational unit, cost centre | **no** — same Organization gap |
| Application record | interviewer employments | **yes, but N per row** — deliberately not done |

**The question the separate investigation should answer**, unchanged from
`next-product-slice-investigation.md` §F and confirmed by this review:

> Should Organization publish reachable bounded reads by identifier for a unit, a position and a
> cost centre — and if so, does that mean wiring what already exists (`ListPositions.positionId`,
> `DescribeUnit`/`UnitDetail`) or publishing something new, and under which existing permissions?

**One addition this review makes to that scope.** The problem has a *second, separable half* that
does not belong to Organization at all: **how an unresolved reference should be presented.** Three
slices have three answers (C2), and that is a design-system question about the `Identifier`
primitive, not a domain question. The investigation should name it and hand it to whoever owns the
shared frame — it can be settled without Organization changing anything.

**Boundaries, restated so they cannot drift:** no generic resolver, no universal lookup service, no
modification of Organization or any completed module in the investigation itself, and it does not
automatically become the next implementation slice.

---

## I. Commercial maturity

Against MenaITech/MenaME as a **capability benchmark** and Horilla as a **domain reference** only —
no implementation comparison, no feature-count comparison.

### Demonstrated capability — a real company would understand these

- **The employee as the centre of the product.** One record, eleven modules, honest about what each
  caller may see. This is the single thing the audit named as missing and it is now the product's
  strongest asset — and it is the benchmark's own centre of gravity.
- **Approvals as personal work, with a visible committee.** Named approvers, positions in the chain,
  authority kept separate from actor, branch tallies, a timeline. The audit's benchmark table called
  the engine *"richer than the benchmark's; unwired and unsurfaced"*. It is now surfaced.
- **Hiring end to end as a readable workflow**, with a pipeline board counted by the server.
- **Bilingual product, not a translated one.** Twenty gated catalogue sets, full RTL, direction
  bound to language.
- **Multi-tenancy, forced RLS, immutability at the table** — protected, not traded away.

### Backend-ready but not demonstrated

- **Payroll run navigation and the payslip** (§J).
- **Leave**: the request record, the approval chain, and the projected end-of-year balance the audit
  explicitly flagged as a MenaITech-class expectation with no screen.
- **Organization structure** as a browsable hierarchy.
- **People** as a register with a person record.
- **Assets and employee relations** as registers.

### Missing, with the honest consequence of each

| Absent | Acceptable at this stage? |
|---|---|
| Any write, anywhere. 513 routes, 0 forms | **Acceptable** — gated by an external authentication decision, and stated on every screen |
| Employee self-service — no `/me` route exists in 513 | **Not acceptable for long.** This is what a buyer opens first. It is also the largest single hole in the demonstration |
| Manager workspace | **Not acceptable for long**, same reason |
| Offboarding and final settlement | **Acceptable** — Assets already publishes its clearance contribution |
| Statutory content — `country-packs` exports nothing | **Would prevent a real company from judging value** in the target market. End-of-service, social insurance and WPS are decision criteria, not features |
| Document bytes — `StoragePort` has no adapter, and no phase owns it | **Acceptable and stated**, but it is an unowned decision |
| Notification delivery | **Acceptable** — assigned outside this repository |

### Is the product too HR-admin-centric?

**Yes, and knowingly.** All three slices are the administrator's view. *Approvals* is personal, but
personal *within the admin portal*. Employee and manager portals are four-file bootstrap pages. The
product currently demonstrates **one of the three audiences a commercial HCM is sold to**.

### Does it demonstrate operational work rather than only records?

**Partly, and this is the most encouraging finding.** Approvals is work. The hiring pipeline is
work. The Employee Record is a record — correctly. What is missing is operational work an
*employee* or a *manager* does, and that is gated by the authentication decision rather than by
product design.

---

## J. Payroll assessment

**Yes — Payroll should be a high-priority future product slice.** The gap is now the largest
composition gap in the product, and this review found it worse than the investigation recorded.

**What the investigation found, confirmed:**

- 17 GET routes, 15 already consumed by the screen.
- `loadPayroll` reads `runs[0]` (`api.ts:122`) and `results.items[0]` (`api.ts:165`). **The screen
  always shows an arbitrary run and an arbitrary employee's result, and offers no way to choose
  either.** You cannot look at last month's payroll.

**What running the product added:**

- **Eighteen stacked `Card`s**, each a heading over one sentence. Seven in `sections.tsx`, seven in
  `outputs.tsx`, four in `results.tsx`. It is a wall of boxes where the slices use `Section`.
- **Refused is rendered as empty almost everywhere.** `unavailable` is consulted in exactly one
  place — the *Overview* section, which says *"Sign-in is not available in this deployment, so
  payroll data cannot be shown"*. The other sixteen `<Empty>` usages print `payroll.notice.empty`
  — *"Nothing to show yet."* — whether the API refused the caller or answered with nothing. On a
  payroll screen, telling an operator there is nothing when the truth is they were refused is the
  most consequential version of the mistake the three slices exist to prevent.
- **No `PageHeader`, no description, no summary figures** — a bare `<h1>Payroll</h1>` over the boxes.
- **`money()` renders `${amount.amount} ${amount.currencyCode}`** — a raw decimal beside a code.
- **"Reports" is a list of five words that are not links**, which reads as navigation that does not
  navigate.
- **The old `max-w-4xl` layout**, so the content column is narrower than every slice.

**Commercially this is the highest-value screen in the product and currently its weakest.** Payroll
is the decider in the target market, and the repository already publishes explainable payroll from a
frozen snapshot — a genuine advantage the current screen does not show.

**Not fixed here.** No payroll file was touched.

---

## K. Product gaps, in three categories

### A. Already convincing

| Capability | Surface |
|---|---|
| The employee as the product's centre | `/employment`, `/employment/[employmentId]` |
| Personal approval work, with the committee visible | `/approvals`, `/approvals/[instanceId]` |
| Hiring as an end-to-end readable workflow | `/recruitment` + two record routes |
| One application shell, bilingual, RTL-correct | `WorkspaceShell` |

### B. Backend-ready, product-incomplete — composable without substantial backend work

| Capability | Evidence | Size |
|---|---|---|
| **Payroll run and result navigation** | 15 of 17 reads consumed; only the selection and the design language are missing | medium |
| **Leave request record** | `GET /leave/requests/:id`, `/approval-chain`, `/balances/:id/as-of`, `/projected` all published and unused | small |
| **Person record** | `GET /people/:personId`, `/profile` published; 2 of 5 reads consumed | small |
| **Organization structure browser** | `hierarchy`, `ancestry`, `placements`, `establishment` published; 4 of 12 consumed | medium |
| **Assets register** | 7 GET routes, no destination | medium |
| **Employee relations register** | 10 GET routes including `applicable-action`, no destination | medium |
| **Approvals → subject links** | the requisition record already exists (F2) | very small |

### C. Backend or domain work required — do not recommend merely because the area is incomplete

| Capability | Why it is not composition |
|---|---|
| **Employee self-service** | No `/me` route exists in 513; `currentMembership()` appears only in workflow. Needs caller-scoped queries per module *and* the authentication decision |
| **Manager workspace** | Same blocker: filters like `managerEmploymentId` exist, but nothing tells a portal who the caller is |
| **"Which application hired this employment"** | `search-applications` filters by term/status/vacancy/candidate/stage — there is no `employmentId` filter, so the record cannot reach the hire that produced it |
| **Any write surface** | External authentication decision |
| **Statutory content** | `country-packs` exports nothing |
| **Document/payslip bytes** | `StoragePort` has no adapter and no owner |
| **Cross-module dashboard** | No tenant-wide aggregate endpoint; each module publishes only its own |

---

## L. UX quality against the Employee Record bar

Only meaningful issues; visual perfection is not the goal.

**Meets the bar:** the six slice routes and the workforce directory's header and table. Visual hierarchy is clear, tables are dense without being
cramped, statuses are always a word with a tone rather than a colour, and every one of the six
states — refused, empty, populated, withheld, loading, not-found — is distinguishable in the
rendered product.

**Below the bar, in order of how much it costs the product:**

1. **Payroll's eighteen cards and its refused-as-empty** (§J).
2. **The Arabic ellipsis on the Employee Record** (F1) — the only outright rendering defect found.
3. **The home page** — old layout, duplicates the sidebar, no title (F5, F7).
4. **Eight screens still on `max-w-4xl` with raw `<h1>`** (F6).
5. **The directory's `TimelineSection`** — raw lists, `opacity-*`, unattributed, inside an otherwise
   converted screen (C3, F8).

**Not found**, and worth recording because they were looked for: no decorative UI, no fake controls,
no unnecessary cards inside the slices, no colour-only status, no duplicated labels, and no computed
business value anywhere in the three slices.

---

## M. Mobile as a product, at 390 px

All three workflows remain **usable**, not merely fitting.

**Works:**
- Hierarchy survives: page title, description, then sections in the same order as at desk width.
- The hiring overview stacks two-by-two rather than into a five-tile scroll.
- Every table scrolls inside its own container; the page body never scrolls horizontally.
- Links are reachable and obvious; the drawer replaces the sidebar cleanly.
- Arabic stays readable at 390 px, fully mirrored.
- Pipeline stages stay understandable — each chip is one non-wrapping token, *"Received · 118"*.

**Findings:**

1. **The Employee Record is 4,462 px tall on a 390 px screen** — eleven sections with no way to jump
   between them. Finding *Leave* means scrolling past six sections. The record is the screen most
   likely to be opened on a phone.
2. **Column order matters more on a phone, and Approvals has it backwards.** In *Decided by you*,
   the first visible column after the decision is a full 36-character membership identifier, which
   consumes the viewport and pushes *Decided* and *Comment* off-screen. The full membership is
   correct (truncation would make two directors identical); its **position** is what costs the
   reader.
3. **Identifier columns are the main driver of horizontal scroll** across all three slices — the
   direct product consequence of the unresolved-reference problem in §H.

*Classification for all three: future refinement. None is a blocking defect.*

---

## N. Security and authorization findings

Only findings the slices actually surfaced, plus one adjacent case this review confirmed. Nothing
was fixed.

| # | Finding | Evidence | Classification |
|---|---|---|---|
| S1 | **`recruitment.offer.read` is declared and enforced nowhere.** Offers — including `proposedCompensation` — reach any caller holding `recruitment.application.read` via `ApplicationSnapshot`, while the module's own comment says offers sit behind their own permission | `recruitment-permissions.ts:56` is its only occurrence | **owner decision** — narrowing who may see offer data changes who can see what |
| S2 | **`employment.reporting-line.read` and `employment.contract.read` are declared and enforced nowhere.** Both are served from `employment.read-history`, gated by `EmploymentPermissions.historyRead` | `readEmploymentHistoryHandler`, `reporting-line.controller.ts:37` | **separate investigation** — S1 is now a pattern, not a one-off. A sweep for declared-but-unenforced permissions is warranted |
| S3 | **Refused ≠ empty is honoured in the three slices and not elsewhere.** Payroll consults `unavailable` in one section and prints the same empty sentence in sixteen others; most module screens use a single two-state `unavailable` flag | `payroll/sections.tsx:110`, rendered `/payroll` | **future slice** — it is fixed by composing each screen, not by a global change |
| S4 | **Withheld interview feedback behaves correctly** — `recruitment.interview.feedback.read` is genuinely enforced, and the application record says withheld rather than "no feedback" | `readFeedbackHandler`, rendered withheld state | **existing accepted behaviour** — this is the reference implementation |
| S5 | **Several `*-own` permissions are declared and used by no query** — `attendance.read-own`, `career.plan.read-own`, `compensation.read-own`, `document.read-own`, `attendance.event.record-own` | permission sweep | **existing accepted behaviour** — self-service is unbuilt (§K C); these are declarations ahead of their queries, not unenforced boundaries |
| S6 | **Every business route answers 401/403 in this deployment**, and every screen in the three slices says so rather than showing emptiness | `PlatformPermissionChecker` holds an empty grant set | **owner decision** — the standing external blocker |

**Not invented:** no speculative vulnerability is listed. S1 and S2 are the only two cases where a
declared permission names a boundary the API does not enforce, and both were found by reading the
code rather than inferred.

---

## O. Recommended next direction — three opportunities, none authorized

*Not a selection. Evidence for a decision the owner takes.*

### #1 — Payroll as work

- **Why it matters:** the highest-value screen in the target market is currently the product's
  weakest, and it contains a defect worse than an absence — an arbitrary run shown as though it were
  *the* run.
- **Backend readiness:** highest of any candidate. 15 of 17 reads already consumed; the run,
  results, exceptions, approval chain, reconciliation, accounting output, payment instructions and
  payslip data are all published and rendered today, just not navigable.
- **Major dependency:** none. No backend change identified.
- **Evidence still needed before authorization:** whether a per-run route plus a per-result route is
  the right shape, or whether the payroll *period* is the better subject; and whether payslip data
  belongs on the Employee Record (a decision the record's own boundary note says nobody has taken
  for compensation).

### #2 — Connecting what already exists

- **Why it matters:** the cheapest coherence gain available. F2 (approvals → requisition record),
  D2 (name the subject), F1 (the Arabic ellipsis), F3 (a boundary line that overstates), F5 (page
  titles). Each is small; together they are the difference between three good screens and one
  product.
- **Backend readiness:** total. Every route and identifier already exists.
- **Major dependency:** a decision on the single identifier rule (§H, second half).
- **Evidence still needed:** which subject types should map to routes, and whether that mapping
  lives in the approvals composition or in the shell.

### #3 — Leave as work

- **Why it matters:** the most-used HR workflow, and the audit's benchmark table names the projected
  end-of-year balance as a MenaITech-class expectation that exists in the API with no screen.
- **Backend readiness:** high. 15 GET routes, 9 consumed; the request record, its approval chain and
  both balance projections are unused.
- **Major dependency:** overlap with Approvals — the reviewer's view of a leave request is partly
  what slice 2 already delivers generically; the requester's view needs a principal.
- **Evidence still needed:** whether the leave *register* or the leave *request* is the subject, and
  how much of the reviewer's view Approvals should keep.

---

## P. Owner decisions and investigations now accumulating

| # | Decision or investigation | First raised | Status |
|---|---|---|---|
| 1 | **How a deployment authenticates a user and holds a permission** | audit §19 | External (Platform). Blocks every write and all self-service |
| 2 | **Where document bytes live** — `StoragePort` has no adapter and no owning phase | audit §10 | **Unowned** |
| 3 | **Whether `workflowApprovalPortFor` should be composed** | audit §9 | Now a *product* question: both ends of the link exist as screens (§E5, §G) |
| 4 | **Organization bounded reads by identifier** | next-slice investigation §F | Scope defined; confirmed by this review (§H) |
| 5 | **One identifier presentation rule across the product** | this review | New — design-system question, separable from #4 |
| 6 | **`recruitment.offer.read` enforcement** | hiring slice §K | Owner decision (S1) |
| 7 | **Declared-but-unenforced permissions generally** | this review | New — S2 makes S1 a pattern; a sweep is warranted |
| 8 | **Whether compensation and payslip data belong on the Employee Record** | employee-record verification | Open; relevant to a payroll slice |
| 9 | **`country-packs` statutory content** | audit §9 | Open; commercial consequence stated in §I |

---

## Q. Verification

The complete gate, run on this branch with no code changes:

```
pnpm verify   →  exit 0, 29 tasks successful

Engineering Standards: no violations.
Architecture: 186 model(s) checked, no violations.
Localization: 20 catalogue set(s) complete.
Dependencies: 1945 source file(s), no cycles, no unused dependencies, no unreachable files.
prettier --check  — all matched files use Prettier code style
eslint .          — clean across every package
tsc --noEmit      — clean across every package
next build / tsc -p tsconfig.build.json — every app and package built
```

**Tests, re-run uncached** (`turbo run test --force`, because the first `pnpm verify` was a full
cache hit and a replayed result should not be reported as a run):

```
3415 passed, 1624 skipped, 0 failed
```

The 1,624 skipped are the repository's standing behaviour — integration suites skip themselves when
`DATABASE_URL` is unset for the test run.

**Migrations:** PostgreSQL 16 started locally; `prisma migrate deploy` reports **no pending
migrations**, with **31 of 31 applied** (`_prisma_migrations` = 31; `prisma/migrations/` holds 31
directories plus `migration_lock.toml`). *Small correction to earlier documents, which said 32 — that
count included the lock file.*

**Rendered-product verification:** the application was built and served against a fixture API
answering the published contract shapes for all three slices at once. Inspected: the shell, the home
page, the workforce directory, the Employee Record, Approvals, the approval detail, the Hiring
workspace, the requisition record, the application record, and Payroll — at 1440 px and 390 px, in
English and Arabic. Populated, empty, refused, withheld and not-found states were exercised where
the existing fixtures permit. No product data was invented; every payload is shaped by a published
contract.

**One caveat, stated rather than glossed:** two artefacts in the rendered workforce directory —
`employment.status.undefined` and an empty *"Recorded by:"* — were traced to the fixture sending
`status`/omitting `recordedBy` where `StatusRecordView` publishes `toStatus` and `recordedBy`. They
are **stub artefacts, not product defects**, and are excluded from every finding above.

---

## R. Git state

- **Head at review:** `1c100f7` — *Record the Hiring as Work slice commit hash*
- **This review's commit:** `7813d62` — *Three-slice product coherence review*, whose only file is
  this document. (A commit cannot record its own identifier; the hash is filled in by the small
  follow-up commit directly after it, as the hiring record did.)
- **Branch:** `claude/munaxa-product-readiness-audit-8mr34d`, pushed to `origin`
- **Working tree:** clean. This document is the only file the task adds; no production code changed.
- **No local registry workaround committed.** The `@munaxa/*` packages live in GitHub Packages and
  this session's token carries no `read:packages` scope, so the platform packages were built from
  public source in the scratchpad and linked through seven `pnpm.overrides` entries in the root
  `package.json` for the duration of the review. Those entries are reverted before the commit;
  `git diff HEAD -- package.json pnpm-lock.yaml` is empty.

---

# REVIEW COMPLETE — AWAITING NEXT SLICE AUTHORIZATION
