# Next Product Slice — Investigation

**Date:** 2026-08-24
**Branch:** `claude/munaxa-product-readiness-audit-8mr34d`
**Head at investigation:** `79fa7f1` (Product Slice — Approvals as Work)
**Status:** **INVESTIGATION ONLY — NOT AUTHORIZED TO BUILD**

This document selects and defines the next product slice from repository evidence. It changes no
production code, adds no capability, and creates no implementation commit. Every claim below cites
the file, route, contract or query it rests on; where the evidence does not settle a question, the
document says so rather than guessing.

---

## A. Current product state

### What has been delivered as product

Two vertical slices exist, both in `apps/admin`, both read-only, both verified against a running
API:

| Slice | Routes | Shape | Record |
|---|---|---|---|
| **1 — The Employee Record** | `/employment`, `/employment/[employmentId]` (+ `loading`, `not-found`) | One subject, fourteen facets, eleven modules composed in one screen | `employee-record-slice.md`, `employee-record-verification.md` |
| **2 — Approvals as Work** | `/approvals`, `/approvals/[instanceId]` (+ `loading`, `not-found`) | One reader's queue of decisions, and one approval opened in full | `slice-approvals-as-work.md`, `slice-approvals-as-work-record.md` |

These are the only two detail routes in the entire product. Every other screen is a single flat
page per module.

### The idioms those two slices established, which any next slice inherits

1. **Three states, never two.** *Refused* ≠ *empty* ≠ *populated*. The CQRS pipeline checks
   permission before the handler (`packages/kernel/src/cqrs/pipeline.ts:102`), so "you may not see
   this" and "there is nothing here" are genuinely different answers and the screen must say which.
2. **Server totals only.** A count is what the API reported, never `items.length`.
3. **Nothing computed in the UI.** No age, no due date, no tally, no percentage, no average.
4. **`<bdi>` isolation** for every Latin run inside translated text; direction follows language.
5. **Semantic `Badge` where the word is always present** — never colour alone.
6. **Boundaries stated as a quiet footnote**, not as an apology and not as decoration.
7. **No control that does nothing.**
8. **Identifiers monospaced and muted; memberships never shortened** (UUIDv7's first eight
   characters are identical for roughly four and a half hours).
9. **Loading and not-found are part of the route**, not an afterthought.

### What the rest of the product looks like today

Sixteen admin sections exist. Fourteen of them are a single page each, and eight of those still use
the pre-design-system layout (`mx-auto flex max-w-4xl flex-col gap-6 p-8` with raw `<h1>`/`<ul>`):
`attendance`, `compensation`, `leave`, `onboarding`, `organization`, `payroll`, `people`,
`recruitment`.

**Three shipped modules have no screen of their own**: `assets` (7 GET routes), `relations` (10 GET
routes), `identity` (4 GET routes). Assets and relations reach the product through exactly one route
each, composed inside the Employee Record — `/assets/custody/clearance?employmentId=` and
`/relations/violations?employmentId=`. Identity reaches it through none.

### The standing external blocker, unchanged

Authentication and authorization belong to Platform (ADR-0001). The only implementation in this
repository is `UnauthenticatedPort` (`packages/kernel/src/ports/authentication.ts:65`), wired at
`apps/api/src/identity/identity.module.ts:114`, and `PlatformPermissionChecker` is constructed with
an empty grant set (`apps/api/src/identity/permission-checker.ts:21`). **Every business route
answers 401 or 403 in this deployment.** That is why the three-state idiom is not a nicety: refusal
is the *ordinary* state today, and a screen that renders it as emptiness is lying.

This constrains slice selection absolutely: a slice whose value is in *writing* is a slice whose
value cannot be demonstrated, and a slice whose value depends on *knowing who the reader is* cannot
be built at all (see the `/me` finding in B.1).

---

## Method, and the evidence base

Route inventory was rebuilt from source rather than taken from the audit, because the audit's
per-module counts were derived with a script that took only the first `@Controller` path per file
and undercounted modules that declare two controllers in one file (`performance`, `organization`).
The corrected inventory totals **513 routes**, which matches the audit's headline figure.

| Module | Routes | GET | GET routes the admin UI actually calls | Section exists |
|---|---:|---:|---:|---|
| recruitment | 42 | 12 | **3** | yes, 261 lines |
| organization | 38 | 12 | 4 | yes |
| people | 30 | 5 | 2 | yes |
| onboarding | 25 | 8 | 4 | yes |
| leave | 32 | 15 | 9 | yes |
| attendance | 34 | 13 | 9 | yes |
| compensation | 36 | 18 | 13 | yes |
| payroll | 28 | 17 | 15 | yes |
| performance | 49 | 13 | 12 | yes |
| career | 40 | 13 | 13 | yes |
| learning | 38 | 11 | 11 | yes |
| letters | 16 | 7 | 7 | yes |
| documents | 13 | 5 | 5 | yes |
| workflow | 23 | 10 | 10 | yes (+ approvals) |
| employment | 18 | 7 | 6 (via the record) | yes |
| **assets** | 14 | 7 | **1**, via the Employee Record | **no** |
| **relations** | 19 | 10 | **1**, via the Employee Record | **no** |
| **identity** | 18 | 4 | **0** | **no** |

The "GET routes the admin UI actually calls" column is the count of distinct published GET paths
appearing as request literals in each section's `api.ts`. It is the single most useful number in
this investigation: it measures the gap between what the backend can already answer and what the
product actually asks.

---

## B. Candidate slices

Each candidate is stated with the thirteen attributes the task requires. The readiness class is:
**A** already fully implemented, needs product composition · **B** mostly implemented, needs a small
vertical addition · **C** requires meaningful backend/domain work · **D** blocked by an unresolved
owner decision · **E** not currently suitable.

### B.1 Employee self-service — "My Work" — **class D, blocked**

- **User workflow:** an employee sees their own leave balance, payslip, attendance, documents and
  requests, and raises new ones.
- **Customer value / commercial importance:** very high. Self-service is the single most-used
  surface of any HCM product and is what a buyer sees first.
- **Existing backend capability:** none that is caller-scoped, outside Workflow.
- **Existing routes:** **there is no `/me` route anywhere in 513 routes.** `currentMembership()`
  appears in exactly six files, all of them in `packages/modules/workflow/src/application/`. Two
  modules document the omission as deliberate: `career/src/api/summary.controller.ts:15` ("It is
  deliberately *not* `career/summary/me`") and `workflow/src/api/approval.controller.ts:33`.
- **Existing contracts / UI:** `apps/employee-portal/src` contains four files — `layout.tsx`,
  `page.tsx`, `manifest.ts`, `globals.css`. It is a bootstrap page.
- **Authentication requirement:** absolute. Without a principal there is no "my".
- **Unresolved decisions:** the audit's §19 owner decision (how a deployment authenticates a user
  and holds a permission), plus a second one nobody has taken: *which* caller-scoped queries each
  module should publish, and under which "read-own" permissions.
- **Estimated slice size:** large, and unbuildable today.
- **Why not ready:** every screen would render "refused" for every reader, forever. That is not a
  demonstration of a product; it is a demonstration of the blocker.

### B.2 Manager workspace — **class D, blocked**

Same blocker, one step removed. Filters that a manager workspace needs *do* exist —
`performance.reviews?managerEmploymentId=`, `recruitment.search-requisitions?hiringManagerEmploymentId=`,
`GET /employments/:employmentId/reporting-lines` — but every one of them requires the caller's own
employment identifier, and nothing tells a portal what that is. Not ready, for the same reason.

### B.3 Recruitment / Hiring — **class A** ✅

- **User workflow:** headcount is authorized (requisition), an opening is created and published
  (vacancy), candidates apply (application), a panel interviews them, an offer is made, and a hire
  becomes an employment. This is the longest genuinely *readable* workflow in the product.
- **Customer value:** high. It is the workflow with the most participants and the longest elapsed
  time, which is exactly the workflow that most needs a screen.
- **Commercial importance:** high. Recruitment appears in every mid-market HCM evaluation.
- **Existing backend capability: complete for reading.** 42 routes, 12 of them GET, and the read
  model is unusually well shaped for composition:
  - `RequisitionSnapshot` = requisition + decisions + vacancies, from one bounded read
    (`recruitment-queries.ts`, `readRequisitionHandler`).
  - `ApplicationSnapshot` = application + history + interviews + offers, from one bounded read,
    and the handler's own comment states why they are returned together: *"answering it in four
    round trips is four chances for a screen to show an interview from one state beside a status
    from another"* (`pipeline-queries.ts`).
  - `PipelineView` = `countsByStatus` + `total`, **counted in the database**, with the handler
    documenting that a vacancy with forty thousand applications must not be loaded to be counted
    (`pipeline-queries.ts`).
  - `CandidateSnapshot` = candidate + profile + applications.
  - `FeedbackView` behind its own permission and **explicitly never aggregated**: *"Whether three
    fours beat one five is a hiring policy this module has no business inventing."*
  - `searchApplicationsHandler` returns `pagedResult(..., found.total)` — a real server total.
- **Existing routes:** all twelve GET routes are registered
  (`apps/api/src/recruitment/recruitment.module.ts`); the UI calls three of them.
- **Existing contracts:** `@work/recruitment/contracts` publishes sixteen views. No new one needed.
- **Existing UI:** `apps/admin/src/recruitment/` — three files, 261 lines. `Card` plus raw
  `<h2>/<ul>/<li>`, `opacity-70` for muted text, a two-state `unavailable` flag, statuses as plain
  text with no tone, identifiers truncated to eight characters, and **no detail route, no pipeline,
  no applications, no interviews, no offers**. There are **no tests** for it at all.
- **Dependencies:** none blocking. Cross-module identifiers are `positionId`, `unitId`,
  `costCenterId` (Organization — see F), `requestedByEmploymentId`,
  `hiringManagerEmploymentId`, `interviewerEmploymentIds` (Employment — resolvable by
  `GET /employments/:employmentId`, exactly as slice 1 did), `personId` (People — resolvable).
- **Authentication requirement:** the same as slices 1 and 2 — none to *build*, because the
  three-state idiom renders refusal honestly.
- **Unresolved decisions:** one, and it is a finding rather than a blocker:
  `recruitment.offer.read` is **declared and enforced nowhere** (its only occurrence in the module
  is the constant at `recruitment-permissions.ts:56`), while offers reach any caller holding
  `recruitment.application.read` inside `ApplicationSnapshot`. The module's own doc comment claims
  the opposite. Recorded, not fixed; the slice works around it by never rendering offer figures.
- **Cross-module requirements:** one bounded employment read per named employment, as slice 1 did.
  Organizational unit and position stay identifiers (see F).
- **Estimated slice size:** medium — two new detail routes and a rework of one existing page,
  no backend change of any kind.
- **Why ready:** the largest backend-to-product gap in the repository (3 of 12 GET routes used),
  a complete published read model, every permission already declared, a localization catalogue that
  already carries the full status vocabulary for all six aggregates, and a workflow that is worth
  looking at even when nobody can act on it.

### B.4 Payroll run record — **class A**

- **User workflow:** a payroll officer opens a run, reads its results, its exceptions, its
  reconciliation and its payment instructions, and traces one employee's payslip.
- **Commercial importance:** the highest of any candidate. Payroll is the decider in the target
  market.
- **Existing backend capability:** 17 GET routes; the UI already calls 15.
- **Existing UI:** `apps/admin/src/payroll/` is 1,443 lines across seven files including
  `results.tsx`, `outputs.tsx` and `lifecycle.ts`. It is the second-most-composed section.
- **The defect that makes it a candidate:** `loadPayroll` reads `runs[0]` and `results.items[0]`
  (`apps/admin/src/payroll/api.ts:122` and `:165`). **The screen always shows the first run and the
  first result, and there is no way to choose either.** You cannot look at last month's payroll.
- **Estimated slice size:** small-to-medium — `/payroll/runs/[payrollRunId]` and
  `/payroll/runs/[payrollRunId]/results/[payrollResultId]`, plus the design language.
- **Why it ranks below recruitment:** the reading is already composed; what is missing is
  navigability. And the payroll *workflow* — calculate, approve, finalize, reverse — is entirely
  writes, all of which are blocked. The product gain is real but narrower.

### B.5 Leave — request record — **class A**

- 15 GET routes; the UI calls 9. Unused and directly useful: `GET /leave/requests/:leaveRequestId`,
  `/requests/:leaveRequestId/approval-chain`, `/balances/:employmentId/as-of`,
  `/balances/:employmentId/projected`, `/balances/reconciliation`.
- The audit's benchmark table specifically flags the projected end-of-year balance as a
  MenaITech-class expectation that exists in the API with no screen.
- **Why it ranks below recruitment and payroll:** the *reviewer's* view of a leave request is
  substantially what slice 2 already delivers generically (a pending approval whose subject is a
  leave request), and the *requester's* view is class D. What is left is a register detail page —
  useful, but the smallest product delta of the three.

### B.6 Attendance — **class A/B**

13 GET routes, UI calls 9. `GET /attendance/days/:employmentId/:attendanceDate` is a bounded
per-employee read that nothing uses, and per-employee attendance already appears inside the Employee
Record. The workflow that matters — punching, correcting, approving a day — is writes. Not the next
slice.

### B.7 Requests (letters, documents, onboarding) — **class A, low delta**

Letters (7 of 7 GET routes used), documents (5 of 5) and onboarding (4 of 8) are already at or near
full read coverage. A letter *request* is a genuine request workflow, but its approval surface is
slice 2's, and its issuance is blocked twice over — by authentication and by `StoragePort` having
no adapter at all (an unowned decision, audit §10).

### B.8 Performance — **class A, low delta**

13 GET routes, UI calls 12. Already the most complete section after career and learning. The one
notable gap is deliberate: `performance.reviews` filters by `cycleId`, `status` and
`managerEmploymentId` only — never by `employmentId` — by the module's own disclosure reasoning.
That is a settled decision and this investigation does not reopen it.

### B.9 Assets — **class B**

7 GET routes and no section of its own; one of them is consumed by the Employee Record.
Commercially secondary, and its most product-relevant contribution —
clearance and custody blockers — already renders inside the Employee Record. `CustodyView` is not
exported from the module's contracts (recorded during slice 1), so an assets workspace would need
either a contracts addition or a design around `AssetClearanceView`.

### B.10 Employee relations / discipline — **class B**

10 GET routes and no section of its own — one is consumed by the Employee Record — including bounded reads (`/relations/violations/:violationId`,
`/relations/investigations/:investigationId`) and a genuinely interesting one,
`/relations/cases/:violationId/applicable-action` — the rule engine's answer for a case. Real
commercial relevance in the target market. But it is the most permission-sensitive screen in the
product, and building the disciplinary workspace while no permission is grantable puts the most
sensitive data behind the least tested boundary. Not now.

### B.11 Identity — members, invitations, delegations — **class B**

4 GET routes and no section of its own, consumed by nothing. Notable because `GET /identity/members/:membershipId` (`identity.describe-member`,
`identity-queries.ts:203`) returns membership + profile + preferences + portals + employment links +
delegations — the one bounded read that would make slice 2's membership references human-readable.
Relevant to F, and a strong *later* candidate; not the strongest next one, because it is
administration rather than a workflow.

### B.12 Learning and career/talent — **class A, lowest delta**

Career: 13 of 13 GET routes used. Learning: 11 of 11. These are the two most completely composed
sections in the product. There is essentially no read capability left unsurfaced.

### B.13 Workforce dashboard — **class E**

Each of attendance, leave, compensation and payroll publishes its own `/dashboard`; **no tenant-wide
aggregate endpoint exists.** A cross-module dashboard would either compose N module dashboards in
the portal — defensible, but every figure would read "refused" today — or require a new aggregate
that no module owns, which is the speculative architecture the standing instructions forbid. It also
carries the specific risk the owner named: replacing the established design language with a generic
dashboard template. Not suitable as the next slice.

---

## Ranked comparison

Criteria, in the owner's stated hierarchy. Cells state evidence, not scores.

| | **Recruitment** | **Payroll run** | **Leave request** | Self-service | Assets / Relations | Dashboard |
|---|---|---|---|---|---|---|
| **1. Customer workflow** | Longest readable multi-actor workflow in the product; six aggregates | Real, but its steps are writes | Real; reviewer half already covered by slice 2 | The most valuable workflow — unbuildable | Register, not workflow | Not a workflow |
| **2. Commercial importance** | High — in every HCM evaluation | **Highest** in the target market | High | Highest | Secondary | Presentation |
| **3. MenaITech-class expectation** | Requisition-authorized hiring and a pipeline board are category-standard (see D) | Explainable payroll is where Munaxa already leads | Projected balance is an explicit benchmark gap (audit §8) | Self-service is the benchmark's own product | Assets on the profile — already done in slice 1 | Benchmark's weakness, not its strength |
| **4. Backend readiness** | **3 of 12 GET routes used**; 3 snapshot views; server-counted pipeline | 15 of 17 used | 9 of 15 used | **No `/me` route exists** | 0 of 7 / 0 of 10 used | No aggregate endpoint |
| **5. Backend change required** | **None** | None | None | New caller-scoped queries in every module | Contracts addition (assets) | New aggregate, or N portal reads |
| **6. Architecture / ownership** | Clean: one module owns the whole spine | Clean | Clean | Ownership of "read-own" undecided | Clean | **No owner** |
| **7. Design-system delta** | Largest: `Card` + raw lists, two-state, no tests | Medium: partly composed | Medium | n/a | Total, from nothing | Risk of a generic template |
| **8. Smallest useful slice** | Two detail routes + one page rework | Two detail routes | One detail route | n/a | Whole section | Whole screen |
| **Class** | **A** | **A** | **A** | **D** | **B** | **E** |

The decisive column is 4 combined with 5. Recruitment is the only candidate where a *complete,
purpose-built read model for a real workflow* is sitting entirely unused behind zero required
backend change.

---

## C. Ranked recommendation

### #1 — **Product Slice — Hiring as Work** (recruitment)

**Recommended as the next slice.**

The reasoning, in the owner's own hierarchy:

1. **It completes a customer workflow rather than a configuration screen.** Slice 1 answered "who is
   this person". Slice 2 answered "what needs me". Neither answered "how is a piece of work moving
   through the organization". Hiring is the product's longest such piece of work, and it is
   readable end to end today.
2. **It is the largest gap between backend readiness and product in the repository.** Twelve GET
   routes; three used. Forty-two routes; one flat 261-line page. Nothing else has that ratio at
   that scale.
3. **It requires no backend change of any kind.** No new route, query, permission, table, column,
   migration, event, port or contract. Everything the screens need is already published, already
   registered, and already permissioned. This is the cleanest class-A candidate in the product.
4. **Its read model was designed for exactly this screen.** `ApplicationSnapshot` exists because a
   pipeline screen reading four endpoints would show inconsistent state. `PipelineView` counts in
   the database because a recruitment product's first scaling failure is loading a pipeline to
   count it. `FeedbackView` refuses to aggregate because scoring is a hiring policy. Those are three
   decisions taken *for a screen that was never built*.
5. **It exercises the three-state idiom harder than either previous slice.** Interview feedback sits
   behind its own permission (`recruitment.interview.feedback.read`, genuinely enforced at
   `pipeline-queries.ts` `readFeedbackHandler`), so *withheld* is a real, reachable state and not a
   hypothetical one.
6. **It is the only module that adopted the approval engine.** `RequisitionView.approvalId` is
   published so a consumer can tell "decided by approval X" from "decided inside this module" — the
   subject-side counterpart of slice 2's queue. The slice shows that distinction honestly without
   wiring anything.
7. **It has no tests today.** A slice that adds the first tests to a 261-line untested section is
   worth more than one that adds the twentieth to a well-covered one.

### #2 — **The payroll run record**

Ranks second, and it is close. It loses on one thing only: the reading is already substantially
composed, so the delta is navigability and design language rather than newly surfaced product.
Against that, it fixes a defect that is worse than an absence — `runs[0]` and `results.items[0]`
mean the screen silently shows *an arbitrary run* and gives no way to see any other. That is a
genuine product bug and it should be the slice after this one, or sooner if the owner weights
commercial importance above workflow completeness. Its own workflow — calculate, approve, finalize,
reverse — is writes, and stays blocked either way.

### #3 — **The leave request record**

Ranks third. Everything it needs exists, including the projected-balance endpoint the benchmark
table explicitly flags. It loses because half of its value (the reviewer's view) is already
delivered generically by slice 2, and the other half (the requester's view) is class D. It becomes
the strongest candidate the moment authentication lands, because at that point "my leave" is the
first screen a real user opens.

**Not recommended, and why, in one line each:** self-service and the manager workspace are blocked
by an absent principal; assets, relations and identity are registers rather than workflows and one
of them is the most permission-sensitive screen in the product; career, learning, performance,
letters and documents are already at or near full read coverage; the workforce dashboard has no
owning module and no aggregate endpoint.

---

## D. MenaITech benchmark relevance

**Stated honestly first:** the benchmark evidence available in this repository is the audit's §8
table and `docs/ROADMAP_ANALYSIS.md`. Neither records a recruitment-specific MenaITech observation —
`ROADMAP_ANALYSIS.md` mentions recruitment twice, both times about sequencing, not capability. So
the paragraphs below distinguish what is *verified in-repo* from what is a *general HCM-category
expectation*. Nothing in section C depends on an unverified benchmark claim.

**Verified in-repo, and relevant to this slice** (audit §8):

- *"Every action as a transaction that routes for approval and shows its committee."* Recruitment is
  the only module that adopted the routed approval, and a requisition record is where that shows.
- *"One product with one shell, one navigation, one search."* The slice extends the shell rather
  than adding another unlinked page.
- *"Configuration surfaced as product, not as a database."* The current recruitment screen is three
  database tables rendered as lists. That is precisely the failure mode named.
- *"Where the benchmark's own weaknesses are the wedge — raw decimals surfacing in the UI, dense
  unstyled key-value screens, clipped labels."* The current recruitment screen has all three.

**General HCM-category expectation, not verified against MenaITech here:** that hiring is authorized
in advance by a requisition carrying headcount; that a recruiter works from a pipeline board of
counts per stage; that a panel's feedback is recorded per interviewer; and that a hire produces the
employee record rather than a parallel one. Munaxa Work's backend already satisfies all four —
`headcountRequested`/`headcountFilled`/`headcountRemaining`, `PipelineView`, `FeedbackView`, and
`hireState` with its explicit partial-transition states.

**What must not be imported from the benchmark:** a candidate portal (Recruitment's own boundaries
note says there is none in this phase), aggregated interview scoring (the module refuses it
deliberately), and any rendering of proposed compensation as a resolved figure (`proposedCompensation`
is opaque `Metadata` "as authored, never interpreted", and Compensation is authoritative for pay).

---

## E. Horilla reference relevance for the recommended slice

**Scope statement, repeated from the audit so it is not lost:** no Horilla source is present in this
repository and this session has no access to it. Horilla is a *domain and business-rule reference*
only. Nothing in this recommendation depends on a Horilla claim, and nothing below is a licence to
fetch, vendor or copy anything.

**Relevant Horilla modules, if the owner chooses to consult them:** its recruitment module — the
stage/pipeline model, interview scheduling, and offer handling.

**What would be useful to study, at the level of business rules and edge cases only:**

- How a re-application to the same opening is handled. Munaxa has already decided this (one
  application per candidate per vacancy; re-applying reopens the existing one and the response says
  so), so this is a *confirmation* exercise, not an input.
- What a pipeline stage vocabulary looks like in practice, against Munaxa's nine application
  statuses plus a free `stageCode`.
- Which edge cases a hiring product hits that Munaxa's `hireState` already anticipates —
  `pending` → `person_linked` → `employment_created` → `completed`, with `failed` as a first-class
  outcome (ADR-0046).

**What must NOT be copied — explicitly:**

- **No Horilla code, in any form.** Not adapted, not transliterated, not "inspired by" at the
  statement level.
- **No Horilla database models.** Munaxa's 186 Prisma models and 32 migrations are authoritative and
  this slice adds none.
- **No Horilla module structure.** Munaxa's module ownership (ADR-0023) wins wherever they conflict.
- **No Horilla UI.** The Employee Record is the visual and product reference for this slice, not
  Horilla and not a generic dashboard template.
- **No Horilla dependency**, direct or transitive, into any Munaxa package.
- **No feature added because Horilla has it.** If a capability is absent from Munaxa's contracts, the
  slice does without it and says so in the boundaries note.
- **No scope expansion from the comparison.** The comparison informs *nothing* in the Definition of
  Ready below; that document is derived from Munaxa's own published routes.

---

## F. Cross-module reference investigation — verdict

**Verdict: yes, it warrants its own investigation — but a much narrower one than "human-readable
cross-module references", and it must not become the next implementation slice.**

Investigating it properly changed the shape of the problem. The recurring symptom has been recorded
three times (slice 1's organizational unit and position; slice 2's membership and workflow subject),
and I previously described it as "no module publishes a bounded lookup". **That was too broad, and
this investigation corrects it.** Checking each reference against the actual route table:

| Reference | Bounded read by identifier? | Evidence |
|---|---|---|
| employment → person's name | **yes** | `GET /employments/:employmentId`; used by slice 1 |
| person → name | **yes** | `GET /people/:personId` |
| membership → display name | **yes, over HTTP** | `GET /identity/members/:membershipId` → `MemberDescription` incl. `BusinessProfileView.displayName` (`identity-queries.ts:192`) |
| candidate → display name | **yes** | `GET /recruitment/candidates/:candidateId` |
| **organizational unit → name** | **no** | `ListUnits` has no `unitId` filter at all (`organization-queries.ts:51`); `units/:unitId/ancestry` returns *ancestors*, not the unit |
| **position → title** | **declared, unreachable** | `ListPositions.positionId` exists and is documented at length as "one bounded request" for exactly this purpose (`organization-queries.ts:104-123`), and `PositionsController.list` forwards only `term`, `family`, `status`, `page`, `size` (`positions.controller.ts:36-59`) |
| **cost centre / profit centre → name** | **no** | no read route of any kind |
| workflow subject (`subjectType`+`subjectId`) → business description | **no, and correctly so** | each subject type lives in a different module; a generic resolver is precisely what must not be built |

Two further facts sharpen it:

- `organization.describe-unit` and its `UnitDetail` view — "a unit with everything a detail screen
  needs, resolved as of a date" — **are declared with no handler and no route.** The query name
  appears exactly once in the module: on the interface itself. They are unreachable declarations.
- The unreachable `positionId` filter is the exact failure mode Recruitment's own
  `search-filters.ts` names in its opening comment: *"listing them in one place is what stops a
  filter existing in the query handler and being silently unreachable from the API."*

**So the real recurring problem is one module, not the product:** *Organization publishes no
reachable bounded read-by-identifier for the entities every other module stores identifiers to.*
Employment, People, Identity and Recruitment all publish one. Organization does not, and one was
written for positions and left unwired.

**The question the separate investigation should answer:**

> Should Organization publish reachable bounded reads by identifier for a unit, a position and a
> cost centre — and if so, does that mean wiring what already exists (`ListPositions.positionId`,
> `DescribeUnit`/`UnitDetail`) or publishing something new, and under which existing permissions?

**Its scope, stated as boundaries:**

- **In scope:** the four Organization findings above; whether the unwired declarations are intended
  or abandoned; what the correct read shape is for a *consumer holding an identifier* as against a
  *user browsing a catalogue*; whether `organization.unit.read` and `organization.position.read`
  already cover it.
- **Explicitly out of scope, per the owner's instruction and repeated here so it cannot drift:**
  **no generic resolver. No universal lookup service. No modification of a completed module merely
  to make a screen easier.** No change to any other module. No caching of a name outside the module
  that owns it — the current screens' choice to render an identifier rather than a stale name stays
  correct until this is settled.
- **It does not become the next implementation slice.** The Hiring slice below is specified to work
  without it: organizational unit and position remain identifiers, exactly as they do on the
  Employee Record and the current recruitment page, and the boundaries note says why.

---

## G. Definition of Ready — Product Slice: Hiring as Work

Everything below is derived from published Munaxa routes and contracts. It is a specification, not
an authorization.

### Routes (all in `apps/admin`)

| Route | Files | Purpose |
|---|---|---|
| `/recruitment` | `page.tsx` (rework) | The hiring workspace: requisitions with headcount, vacancies with server-counted pipeline totals, candidates |
| `/recruitment/requisitions/[requisitionId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One requisition: status, headcount, decision history, its vacancies and each vacancy's pipeline |
| `/recruitment/applications/[applicationId]` | `page.tsx`, `loading.tsx`, `not-found.tsx` | One application: candidate, status, history, interviews, panel feedback, offer states |

Dynamic segments follow **ADR-0075**. Links are plain `<a>` elements, as in both prior slices
(`import Link from 'next/link'` is rejected by `@typescript-eslint/naming-convention`; that reason is
recorded in code comments rather than by adding a second standards ADR).

### Existing APIs used — no new endpoint, query, permission or contract

| Request | Returns | Already used by the UI? |
|---|---|---|
| `GET /recruitment/requisitions?page=1&size=25` | `PagedResult<RequisitionView>` | yes |
| `GET /recruitment/requisitions/:requisitionId` | `RequisitionSnapshot` | **no** |
| `GET /recruitment/vacancies?requisitionId=…&page=1&size=25` | `PagedResult<VacancyView>` | partly (unfiltered) |
| `GET /recruitment/vacancies/:vacancyId/pipeline` | `PipelineView` | **no** |
| `GET /recruitment/applications?vacancyId=…&page=1&size=25` | `PagedResult<ApplicationView>` | **no** |
| `GET /recruitment/applications/:applicationId` | `ApplicationSnapshot` | **no** |
| `GET /recruitment/interviews/:interviewId/feedback` | `readonly FeedbackView[]` | **no** |
| `GET /recruitment/candidates/:candidateId` | `CandidateSnapshot` | **no** |
| `GET /employments/:employmentId` | `EmploymentView` | yes (slice 1) |

Three to nine of twelve published GET routes, with no backend change.

`GET /recruitment/applications/:applicationId/interviews` is redundant with the snapshot and is not
called — one bounded read, not two.

### UI surfaces

- The Employee Record's design language, without exception: `Page`, `PageHeader`, `Section`,
  `Stack`, `Surface`, `Grid`, `Table`/`THead`/`TBody`/`TR`/`TH`/`TD`, `Badge`, `EmptyState`,
  `Skeleton`, `KpiGrid`/`StatCard` for the pipeline board.
- The pipeline board renders `PipelineView.countsByStatus` and `PipelineView.total` **as the server
  reported them**. No status is summed, ordered by count, or given a percentage in the UI.
- The applications list under a vacancy shows application number, status, stage, applied-on and
  hire state. **It does not show candidate names**, because `ApplicationView` does not carry one and
  resolving N candidates for N rows is the unbounded read this module's own handler comment warns
  against. The candidate's name appears on the application record, from one bounded read. This limit
  is stated in the boundaries note.
- Interview feedback renders per interviewer with its `recommendation` word and its raw `score`.
  **No average, no computed verdict, no "3 of 5 say yes" tally** — the module refuses to aggregate
  and so does the screen.
- **Offer figures are never rendered.** `proposedCompensation` and `currencyCode` are omitted
  entirely; only the offer's status, version, proposed start date, expiry and decision timestamps
  appear. Two reasons, both stated in the boundaries note: the module publishes the figure as opaque
  and never interprets it, and `recruitment.offer.read` is declared but enforced nowhere (see the
  finding in B.3), so rendering the figure would put an unguarded boundary on screen.
- Organizational unit, position and cost centre render as **identifiers, monospaced and muted** —
  not names, not truncated below full length where they are the only handle. The boundaries note
  says why, and points at nothing: it does not promise a future resolution.
- `hireState` renders as its own row when present, including `failed`, because a hire that stopped
  half way is a fact operations must see (ADR-0046).
- `RequisitionView.approvalId` renders the distinction between "decided by approval X" and "decided
  in this module". It links nowhere — `workflowApprovalPortFor` is composed nowhere, so the field
  will be absent in this deployment, and a link to an approval that does not exist is a control that
  does nothing.

### States, on every surface

1. **Refused** — 401/403. Says the caller was refused, not that there is nothing.
2. **Empty** — the API answered with zero rows.
3. **Populated.**
4. **Withheld** — the outer read succeeded and an inner one behind a different permission did not.
   Genuinely reachable here: `recruitment.interview.feedback.read` is enforced separately from
   `recruitment.application.read`.
5. **Loading** — `loading.tsx` per route, `Skeleton` in the record's own layout.
6. **Not found** — `not-found.tsx` per route. All three snapshot handlers return `notFound(...)`,
   so 404 is a real response and not a hypothetical.

### Permissions — all existing, none added

`recruitment.requisition.read`, `recruitment.vacancy.read`, `recruitment.application.read`,
`recruitment.interview.read`, `recruitment.interview.feedback.read`, `recruitment.candidate.read`,
and the employment read permission slice 1 already relies on. **No permission is declared, renamed,
widened or narrowed.**

### Localization

- `packages/modules/recruitment/locales/{en,ar}.json` already carries the complete status vocabulary
  for requisition, vacancy, candidate, application, interview, offer and hire, plus
  `recommendation.*` and the labels `pipeline`, `headcount`, `filled`, `remaining`.
- New keys are limited to detail-screen labels, added to the same catalogues in both languages, and
  `git add`ed — `scripts/check-localization.mjs` reads `git ls-files`, so an unstaged catalogue is
  invisible to the gate.
- `label.unavailable` currently conflates "unreachable" with "refused". The slice replaces the
  two-state wording with the three-state idiom.
- Every Latin run inside translated text is `<bdi>`-isolated. Direction follows language via
  `directionOf`; there is no separate direction control.
- Both `?lang=en` and `?lang=ar` are verified on every route.

### Mobile behaviour

- Verified at **1440 px and 390 px** with rendered screenshots, as both prior slices were.
- The pipeline board stacks; every table scrolls inside its own `overflow-x` container so the page
  body never scrolls horizontally; no identifier is truncated to make a column fit.

### Tests — anchored to findings, not to coverage

- **Request literals**: extracted from the composition module and asserted to name no identity, to
  interpolate only the identifiers the route was given, and to page explicitly. (The prior slice's
  whole-file word scan produced false matches against doc-comment prose; the literal extraction is
  the corrected form.)
- **Server totals**: a fixture whose `total` deliberately exceeds its page length, asserting the
  rendered figure is the server's and never `items.length`.
- **Three states plus withheld**, at the composition, section and route layers.
- **No offer figure is rendered** — asserted against a fixture that carries one.
- **No aggregation of feedback** — asserted against a fixture with several differing scores.
- **Not-found** renders for a 404 rather than an empty record.
- Recruitment has **no tests at all** today; these are the first.

### Explicitly out of scope

- **Every write.** No stage move, screening, interview scheduling or conclusion, feedback
  submission, offer draft/issue/decision, requisition submission or decision, vacancy opening or
  publication, hire, import or export. 513 routes, 0 forms remains true after this slice.
- No candidate portal, and no external-facing surface of any kind.
- No new route, query handler, permission, contract view, Prisma model, column, migration, domain
  event, port or configuration key.
- No modification to `packages/modules/recruitment/src/{domain,application,infrastructure,api,contracts}`.
- No wiring of `workflowApprovalPortFor`.
- No fix to the unenforced `recruitment.offer.read` permission — recorded as a finding; narrowing
  who may see offer data is an owner decision, not a side effect of a UI slice.
- No resolution of organizational unit, position or cost-centre names — see F.
- No generic reference resolver, no shared lookup service, no cache of another module's names.
- No notification, badge, analytics, escalation, expiry or reminder.
- No change to `/workflow` or `/approvals`.
- No re-layout of any other module's screen "for consistency" — the eight pre-design-system pages
  stay as they are until each is its own slice.

---

## Findings recorded during this investigation, and deliberately not fixed

1. **`recruitment.offer.read` is declared and enforced nowhere.** Offers reach any caller holding
   `recruitment.application.read` via `ApplicationSnapshot`, while the module's own doc comment
   states that offers are read behind their own permission. *Owner decision — narrowing access.*
2. **`ListPositions.positionId` is unreachable from the API.** Added deliberately in Phase 15 with a
   documented justification; `PositionsController.list` does not forward it. *Feeds the F
   investigation.*
3. **`organization.describe-unit` / `UnitDetail` are declared with no handler and no route.** *Feeds
   the F investigation.*
4. **`ListUnits` has no `unitId` filter**, so a unit cannot be resolved by identifier at all. *Feeds
   the F investigation.*
5. **The payroll screen shows an arbitrary run.** `runs[0]` and `results.items[0]`, with no
   selection. *Recommendation #2 exists to fix this.*
6. **Three shipped modules have no screen of their own**: assets, relations and identity. Assets
   and relations each surface through one route inside the Employee Record; identity surfaces
   through none.
7. **The audit's per-module route counts were derived by a script that undercounted files declaring
   two controllers.** The corrected inventory is in this document; the 513 total is unchanged, so no
   conclusion in the audit moves.

---

## H.

**INVESTIGATION ONLY — NOT AUTHORIZED TO BUILD**
