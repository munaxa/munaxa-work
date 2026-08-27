# Munaxa Work — Next Product Direction Investigation

**Investigation only. Nothing was implemented, and nothing in the product changed.** No route, no
migration, no table, no permission, no contract, no aggregation was added. No completed slice was
modified. No authorization finding was fixed, no HTTP semantics were changed, no identifier was
normalized, and no numeric phase was created. The one question this document answers is:

> What should Munaxa Work build next to produce the greatest increase in customer value and
> commercial product completeness **without prematurely expanding backend architecture**?

It does not select the next slice. It ranks the candidates, states what each would cost, and names
what the owner has to decide.

---

## A. What changed since the last direction was set, and why the previous ranking cannot simply be carried forward

The last ranking (`next-product-slice-investigation-2.md`) was written before Leave and before
Attendance shipped. Two things about it are now stale, and one thing about it turned out to be the
most durable finding in the programme.

**Stale.** Leave and Attendance were the top two candidates and are both done. The candidate list is
therefore genuinely re-opened, not merely re-ordered.

**Also stale.** That document ranked candidates largely on *how much backend already existed*. After
six slices the constraint has moved: backend readiness is no longer the scarce thing. Fifteen of the
eighteen modules publish more GET capability than any screen consumes. What is scarce now is
**a coherent product surface**, and two of this document's findings (§G, §K) are about surface
coherence rather than domain capability.

**Durable, and reconfirmed here.** The product's problem was never a domain gap. It was — and still
is — a composition gap. Every finding in §K was found by *running* the product, and none of them
would have been found by reading it.

Accordingly this investigation re-derived every number from source rather than citing the previous
document, and it re-ran every empirical check rather than quoting the earlier measurement.

---

## B. Inventory, rebuilt from source this turn

| Measure | Count |
| --- | --- |
| Modules under `packages/modules/` | 18 |
| Prisma models | 186 |
| Migrations | 31 |
| Routes on the API | 513 |
| **GET routes** | **187** |
| Permissions declared across all modules | 285 |
| Admin screens (Next.js `page.tsx`) | 25 |
| Detail routes that can render a not-found page | 8 |

### Published GET capability against what the admin portal actually reads

"Reads" counts the distinct API paths the admin composes for that module, normalising interpolated
identifiers. It is a close proxy for consumed GET routes, not a proof of one-to-one correspondence:
a screen that reads `/leave/requests` with three different query strings is one read here.

| Module | GET routes | Distinct paths the admin reads | Gap |
| --- | ---: | ---: | ---: |
| workflow | 10 | 10 | 0 |
| career | 13 | 13 | 0 |
| letters | 7 | 7 | 0 |
| performance | 13 | 12 | 1 |
| learning | 11 | 10 | 1 |
| documents | 5 | 4 | 1 |
| leave | 15 | 13 | 2 |
| attendance | 13 | 10 | 3 |
| payroll | 17 | 14 | 3 |
| recruitment | 12 | 9 | 3 |
| people | 5 | 2 | 3 |
| employment | 7 | 3 | 4 |
| onboarding | 8 | 4 | 4 |
| compensation | 18 | 13 | 5 |
| **assets** | **7** | **1** | **6** |
| **organization** | **12** | **4** | **8** |
| **relations** | **10** | **0** | **10** |
| **identity** | **4** | **0** | **4** |

Three modules stand out as wholly or almost wholly unconsumed: **Relations (0 of 10)**, **Identity
(0 of 4)** and **Assets (1 of 7)**. Two of those three turn out to be blocked by something other
than screen work — see §G.

---

## C. Candidate A — Assets & Custody as Work

### What the domain publishes

Seven GET routes:

| Route | Returns | View exported from the contract? |
| --- | --- | --- |
| `GET /assets/categories` | `AssetCategoryView` | yes |
| `GET /assets` | `AssetPageView` | yes |
| `GET /assets/:assetId` | `AssetView` | yes |
| `GET /assets/custody/clearance` | `AssetClearanceView` | yes |
| `GET /assets/:assetId/custody` | `AssetCustodyView` | **no** |
| `GET /assets/custody` | `CustodyPageView` | **no** |
| `GET /assets/custody/summary` | `CustodySummaryView` | **no** |

### The blocker, stated precisely

`packages/modules/assets/src/contracts/index.ts` exports six names. `CustodyView`,
`CustodyPageView`, `CustodySummaryView` and `AssetCustodyView` are defined in
`contracts/views.ts` and are **not among them**. A screen cannot name the type of three of the
seven reads, and the lint layer forbids reaching past the barrel into module internals.

This is not a detail. The whole point of the candidate is custody, and custody is precisely the part
that cannot be typed. `AssetView`'s own documentation says so outright:

> `status` is whether the item is in service … **It never says who holds it.** … a copy on this view
> would be a second answer that goes stale (ADR-0070).

So the three typeable inventory reads *deliberately* withhold the answer the screen exists to give,
and the three reads that hold it are unexported. A screen built on only the exported four would be
an inventory list that cannot say who has anything — which is the one thing an assets screen is for.

### What already works

`AssetClearanceView` is exported and **already consumed**, at
`apps/admin/src/employment/record-api.ts:186`, and rendered by `record-governance.tsx`. The Employee
Record already shows what an employment still holds and why clearance cannot complete. The
highest-value single view in the module is therefore already on screen.

### Verdict

**Class B — blocked by a contract decision, not by screen work.** The screen is a few days; the
decision in front of it is whether custody becomes public contract surface. That decision is
partly pre-made: AD-006 already names Offboarding as a consumer that will read custody *through
public contracts*. See §G.

---

## D. Candidate B — Self-Service / "My Work"

Re-checked from source this turn; the position is unchanged and the evidence is stronger than
before.

**There is no `/me`, and its absence is structural rather than incidental.**
`apps/api/src/workflow/workflow.routes.spec.ts:256` asserts it both on the wire and in the source:

> Checked on the wire *and* in the source. A 404 alone would prove only that nobody had written the
> route yet; the source check is what makes the absence structural.

The forbidden list is `/me`, `/my-team`, `/roles`, `/escalations`, `/sla`, `/sessions`,
`/waitlists`, `/recruitment`.

Five admin `api.test.ts` files (Leave, Attendance, Payroll, Approvals, Recruitment) additionally
assert that **no composed request names an identity of any kind** — `membership`, `workforceUser`,
`platformUser`, `approver`, `onBehalfOf`, `/me`, `userId`:

> Neither queue read may carry an identity of any kind. A queue endpoint that accepted one would let
> anybody holding the permission read anybody's queue, which is why the API declares no such
> parameter and why this file must not invent one.

**Fifteen `-own` permissions are declared. Two gate a handler. Thirteen gate nothing.**

| Gates a real handler | Gates nothing |
| --- | --- |
| `onboarding.task.complete-own` | `attendance.read-own`, `attendance.event.record-own`, `career.plan.read-own`, `career.development.read-own`, `compensation.read-own`, `document.read-own`, `learning.assignment.read-own`, `learning.certification.read-own`, `leave.read-own`, `leave.request-own`, `letter.request-own`, `payroll.read-own`, `performance.review.read-own` |
| `workflow.approval.read-own` | |

Assets goes further and declares *no* `-own` permission at all, with the reasoning written down:

> Declaring an eleventh that also resolves to nothing would add a grant that looks like self-service
> and is not. … there is now a custodian to be the "own", and the platform still cannot tell a
> signed-in principal that they are that employment. Self-service custody stays `NOT VERIFIED` and
> unbuilt.

**Why self-service remains blocked, exactly.** Authentication and authorization belong to Platform
(ADR-0001). This repository ships only an `UnauthenticatedPort`; every business route answers 401.
There is no principal → membership → employment resolution anywhere in the product. Self-service is
not a screen that has not been written — it is a screen whose subject cannot be determined. Building
it would require inventing a current-user resolver, which is Platform's, and doing so in Work would
put the identity of every reader in the hands of the module that reads their data.

**Verdict: Class D — blocked outside this repository.** Not next. Nothing in this document proposes
creating `/me`, a current-user resolver, or any self-service query.

---

## E. Candidate C — Manager Workspace / "Team Lens"

**Two modules publish a manager filter.** Employment (`GET /employments?managerEmploymentId=`) and
Performance (goals search, review search, review read, feedback search). Attendance publishes none;
Leave publishes none.

**The filter is documented as explicitly not a credential**, in both modules that have it:

> `managerEmploymentId` on the search is a filter, not a credential. A caller holding `goal.read` may
> narrow to one manager's reports; a caller holding only `goal.read-team` reads nothing, whatever
> they supply, because nothing in this product can yet prove they are that manager.

And, more sharply, on reviews:

> Deriving it from the review's own manager was a real defect in this module: every review has a
> manager and that manager always has it among their reports, so the check passed for everybody. It
> was a free pass wearing the shape of a check, and the regression test for it runs over this route.

The admin's Performance screen already refuses to use it, and says why:

> A screen that offered an administrator a manager picker and called the result "My Team" would be
> dressing a filter up as an identity.

**Verdict: Class D, and for a subtler reason than self-service.** The reads exist. Building a
"Manager Workspace" on them would produce a screen that *looks* like a manager's team and is in fact
an administrator's arbitrary filter — the exact failure the review module already had once and fixed.
This candidate is blocked by the same missing identity as §D, but it is more dangerous than §D
because it is *technically possible*: nothing would stop it being built, and the result would be a
credential-shaped control that is not one.

No manager aggregation API, no universal dashboard endpoint, and no manager-specific event system is
proposed here.

---

## F. Other backend-ready opportunities

Six modules were examined that were not on the original candidate list.

### Performance — the strongest late-emerging candidate

| | |
| --- | --- |
| GET routes | 13 |
| Reads the admin composes | 12 |
| Views exported from the contract | 25 of 25 |
| Detail routes | 2 (`/goals/:goalId`, `/reviews/:reviewId`) |
| Admin detail routes | **0** |

The contract is complete. The legacy screen already reads twelve of thirteen routes, including
`ReviewDetailView`, and it renders reconciliation, the talent matrix and calibration behind separate
permissions with the separation explained on screen. The one unconsumed read is `GET
/performance/goals/:goalId` — "One goal with its progress history".

The review detail route is notable for a reason that matters to §H:

> Also the answer when the review exists but the caller is not entitled to it. 404 rather than 403,
> because confirming a review exists is the disclosure.

That is the *only* route found in this survey where 404-for-403 is a deliberate, documented privacy
decision rather than a tenancy boundary. Any Performance slice would have to render that correctly:
a "no such review" page that is also, silently, the refusal page.

**Class A.** Everything a slice needs exists, is exported, is permissioned, is bounded, and there
are two detail routes to hang a *Work* screen on — which is what the last six slices have been
about: turning a list of everything into one person's decision.

### Career — complete, and already fully consumed

13 GET routes, 13 read, 19 of 19 views exported. Including `GET /career/summary/:employmentId`,
which the **Employee Record already consumes**. There is no unconsumed capability here worth a
slice. **Class C** — not because it is weak, but because it is finished at the level a slice
operates on.

### Learning — one unconsumed read, low value

11 GET, 10 read. The single gap is `GET /learning/certifications`. `GET /learning/history/:employmentId`
is consumed by the Employee Record. **Class C.**

### Relations — the largest unconsumed surface in the product, and entirely blocked

10 GET routes, **0 consumed**, and **8 of its 12 views are unexported**. Only
`ViolationCategoryView`, `ViolationView`, `ViolationPageView` and `LocalizedTextView` are published.
Seven of the ten query handlers return a type no screen can name:
`DisciplinaryRuleView`, `ApplicableActionView`, `DisciplinaryActionView`, `EscalationContextView`,
`InvestigationView`, `InvestigationPageView`, `CaseHistoryView`. The eighth unexported name,
`CaseEventView`, is the element type inside `CaseHistoryView` and is unreachable for the same reason.
(Assets is shaped the same way: three of its four unexported names back a route, and the fourth,
`CustodyView`, is the element type inside `CustodyPageView`.)

The barrel says why the boundary is drawn hard here:

> the moment a second module reads `relation_violation` directly the boundary stops being a boundary
> — and in this domain the boundary is also the access trail.

**Class B, and the most consequential owner decision in this document.** Publishing an investigation
contract is not clerical. It is a decision about who may name a disciplinary case in a type
signature. See §G.

### Organization — 12 GET, 4 read, and it holds an export

Four reads are consumed — `hierarchy`, `unit-types`, `legal-entities`, `tenant-settings`. Eight are
not: `units`, `positions`, `standard-unit-types`, `export`, `units/:unitId/establishment`,
`units/:unitId/ancestry`, `units/:unitId/placements`, `units/:unitId/governing-legal-entity`. All 11
views are exported, so nothing is blocked. **Class B** on value:
an org-structure screen is a *configuration* surface, not a *work* surface, and the last six slices
have been deliberately about work.

`GET /organization/export` is the only export route in the product and is discussed in §G.

### Identity — 4 GET, 0 consumed, and correctly so

Members, member search, one member, invitations. This is the module closest to Platform's
responsibility, and four of its seventeen permissions gate nothing (`identity.user.read`,
`identity.user.manage`, `identity.portal.read`, `identity.preference.read`) for the same reason
self-service does. **Class D.**

---

## G. Separate investigation 1 — contract exports

**Method.** For every module, every `*View` defined under `src/contracts/` was compared against the
names its `contracts/index.ts` barrel actually re-exports (two modules star-export and are therefore
complete by construction).

**Result: 15 of 18 modules export every view they define. Three do not.**

| Module | Views defined | Unexported | Route-backed? |
| --- | ---: | ---: | --- |
| assets | 10 | 4 | 3 of 7 GET routes cannot be typed |
| relations | 12 | 8 | 7 of 10 GET routes cannot be typed |
| workflow | 21 | 2 | 0 — reachable through an exported parent |

### Classification, per the four categories asked for

**1. `workflow` — accidental omission. Lowest severity in the product.**

`ServiceLevelTargetView` and `StepServiceLevelView` are not exported, but their *parents* are:

```
ApprovalStepView.serviceLevel?: StepServiceLevelView          (execution-views.ts:105, :204)
WorkflowStepTemplateView.serviceLevel?: ServiceLevelTargetView (views.ts:139)
```

The data therefore already crosses the boundary and is **already rendered**:
`apps/admin/src/approvals/detail.tsx:164` reads `step.serviceLevel?.state`, `:169` its `dueOn`,
`:171` its `overdueByMinutes`. The Approvals slice consumes a type it cannot name. Nothing is
blocked; a consumer simply cannot write a helper function's signature. Publishing these two names
adds no information that is not already public. **This is a clerical omission and can be fixed
without an owner decision.**

**2. `assets` — omission that blocks a candidate; the decision is already half-made.**

The four unexported names are `CustodyView`, `CustodyPageView`, `CustodySummaryView` and
`AssetCustodyView`. The barrel's own comment establishes that publishing custody is not a new idea:

> AD-006 says offboarding clearance reads custody **through public contracts**, and Offboarding
> (Phase 11.2) is the module that will do it.

The clearance half of custody was published for exactly that reason. The remaining question is
whether the *history* half (who held it before, and for how long) becomes public surface too.
**Owner decision required, narrow in scope, and directly gates Candidate A.**

**3. `relations` — owner decision required, and the widest one.**

Seven of ten reads unusable. Publishing them makes disciplinary rules, applicable actions, escalation
context, investigations and case history nameable by any consumer. Given the module's own statement
that "the boundary is also the access trail", this is a governance decision rather than a contract
tidy-up. **Not a clerical fix. Should not be bundled into any slice.**

**4. Nothing was classified "unclear".** Every unexported view was traced to either a query handler
(assets, relations) or an exported parent (workflow).

**Nothing was exported. No contract was modified. No generic export mechanism was created.**

### Separately: what the product means by "export"

Three modules declare an `export` permission that gates nothing: `leave.export`,
`payroll.export`, `compensation.export`. Each is documented as deliberately narrower than reading —
Leave's says "an export is the highest-volume disclosure this module can make, and leave data says
who was away, when, and — through the type — sometimes why."

Meanwhile **exactly one export route exists in the product**, `GET /organization/export`, and it is
scoped to structure rather than to people:

> Every placement period, not just the ones in force: an export carrying only today's structure
> would be a backup that discarded the history this module exists to keep.

**Recommendation, and nothing more than a recommendation.** If export is built, it should follow
Organization's shape — a per-module route returning that module's own document, behind that module's
own already-declared `*.export` permission — and **not** a generic cross-module export mechanism. A
generic exporter would need to read every module's data, which makes it a second consumer of every
boundary at once and puts the highest-volume disclosure in the product behind a single permission
that no module owns. The three orphan `export` permissions are the design already written down;
building the generic thing would strand them.

---

## H. Separate investigation 2 — HTTP not-found semantics, re-verified across all eight detail routes

**The API layer is correct.** All 18 modules carry a `handler-result.ts` mapping `not_found` →
`NotFoundException`, `forbidden` → `ForbiddenException`, `validation` → 400, `rejected` → 422,
`conflict` → 409. Fifteen distinct variants exist because each carries module-specific reasoning in
its doc comment, not because the mapping differs.

**The portal is not.** Measured live this turn, against a build of the current commit and an API
answering 404 to every request:

| Route | HTTP status | Rendered heading |
| --- | ---: | --- |
| `/approvals/:instanceId` | **200** | Approval — *No approval …* |
| `/attendance/days/:employmentId/:attendanceDate` | **200** | Attendance day — *No attendance …* |
| `/employment/:employmentId` | **200** | Employee record — *No employee …* |
| `/leave/requests/:leaveRequestId` | **200** | Leave request — *No leave request with this identifier was returned.* |
| `/payroll/results/:payrollResultId` | **200** | (not-found page) |
| `/payroll/runs/:payrollRunId` | **200** | (not-found page) |
| `/recruitment/applications/:applicationId` | **200** | (not-found page) |
| `/recruitment/requisitions/:requisitionId` | **200** | (not-found page) |
| `/no-such-page` (unrouted) | **404** | Next's own |

Every route renders the *correct copy*. Every route returns the *wrong status*. An unrouted path
still answers 404, so the application's 404 handling is not broken in general — `notFound()` inside
a rendered route is what does not set the status.

The count has grown from seven to eight because the Attendance slice added the eighth. It will grow
again with every detail route the product adds, which is the argument for treating it as its own
piece of work rather than as a footnote inside the next slice.

**A ninth detail route has no not-found page at all, and that is correct.**
`/leave/balances/:employmentId` states why in its own source:

> **There is no `notFound` here, deliberately.** Leave cannot say whether an employment exists —
> that is Employment's question, and this page asks Employment only for a name. An employment Leave
> holds nothing for gets empty sections saying Leave holds nothing, which is true, rather than a 404
> claiming the employment is not real.

This is the distinction any fix must preserve: the defect is that `notFound()` returns 200 when it
*is* called, not that it is called too rarely.

**Scope, if it is authorized.** It is one behaviour, in one place, affecting eight routes and a
ninth (`/leave/balances/:employmentId`) that deliberately has no not-found page. It is not a
slice; it is a defect fix with a regression test per route. **It was not fixed here.**

---

## I. Separate investigation 3 — authorization consistency

**Method.** For every module, each declared permission was checked for a reference from a command or
query handler.

**Result: 285 permissions declared, 28 referenced by no handler.**

| Category | Count | Members |
| --- | ---: | --- |
| Self-service (`-own`, `read-about-self`) | 14 | see §D |
| Export | 3 | `leave.export`, `payroll.export`, `compensation.export` |
| Reads whose route does not exist | 11 | `employment.assignment.read`, `employment.reporting-line.read`, `employment.contract.read`, `identity.user.read`, `identity.user.manage`, `identity.portal.read`, `identity.preference.read`, `organization.cost-center.read`, `organization.profit-center.read`, `recruitment.offer.read`, `performance.summary.read` |

Per module: assets 0, onboarding 0, people 0, relations 0, workflow 0 · recruitment 1, documents 1,
letters 1 · attendance 2, career 2, compensation 2, learning 2, organization 2, payroll 2 · employment
3, leave 3, performance 3 · identity 4.

**The important finding is not the number. It is that the rule already exists and is enforced in
exactly one module.**

`packages/modules/assets/src/application/assets-authorization.test.ts:87` asserts the invariant in
both directions:

> declares every permission a handler enforces, and enforces every permission it declares

Thirteen of the eighteen modules have an authorization test at all — assets, attendance, career,
employment, identity, learning, onboarding, organization, people, performance, recruitment,
relations, workflow. Twelve of those assert only the forward direction (every enforced permission is
declared). **Only Assets asserts the reverse.**

All 28 unreferenced permissions are therefore in modules that do not assert the reverse direction.
Four modules — onboarding, people, relations, workflow — satisfy the invariant anyway, without
asserting it, which means it is currently true by care rather than by construction. Assets has zero
because the test forbids it, and Assets states the risk plainly:

> A permission naming an absent capability is a grant somebody can hold over nothing, and the day it
> starts meaning something they hold it already (D-5.2-04).

**Classification.** These are **not authorization defects.** Nothing fails open; the pipeline checks
the permission before the handler runs (`packages/kernel/src/cqrs/pipeline.ts:102`), and a
permission with no handler is a grant over nothing today. The 14 self-service permissions are
**deferred capability, correctly declared and correctly not built**, and are explicitly *not*
classified as authorization defects here. The risk is the one Assets names: a grant that becomes
meaningful later, already held.

**Nothing was fixed. No permission was weakened, added, or removed.** The generalisable move — should
the owner want it — is to promote Assets' bidirectional assertion into the shared testing package so
every module asserts it, and let each module explicitly allow-list the deferred grants it intends to
keep. That is a testing change, not a permission change.

---

## J. Separate investigation 4 — identifier consistency

**The rule that has emerged across six slices: render the identifier whole.**

| Slice | Identifier helper | Behaviour |
| --- | --- | --- |
| #1 Payroll | `payroll/exact.ts:64` `reference()` | whole |
| #2 Hiring | `recruitment/exact.ts:76` `reference()` | whole |
| #3 Approvals | `workflow/exact.ts:65` `short()` | **truncated to 8 chars** |
| #4 Employee Record | `employment/record-locale.ts:108` `short()` | **truncated to 8 chars** |
| #5 Leave | `leave/exact.ts:78` `reference()` | whole |
| #6 Attendance | `attendance/exact.ts:72` `reference()` | whole |

`reference()` is `(value) => value ?? DASH` in all four slices that have it — byte-identical, and
independently written four times.

**Why truncation is wrong here, using the repository's own analysis.** `apps/admin/src/workflow/exact.ts`
already documents that truncating a UUIDv7 to 8 hex characters retains the top 32 bits of a 48-bit
millisecond timestamp, so **every identifier minted within the same 65,536 ms window renders
identically**. The tolerance condition recorded alongside it is "a row identifier nobody compares".

That condition holds on neither of the two screens that still truncate. Approvals shows
`instanceId`, `definitionId` and `workflowVersionId` as three adjacent facts on one card
(`approvals/detail.tsx:116–124`) and a `subjectId` per queue row (`queue.tsx:141`) — identifiers
placed side by side are identifiers meant to be compared. The Employee Record shows `personId`,
`unitId`, `positionId` and `managerEmploymentId` in the same way.

Across the whole admin app, `short()` is defined ten times and called **95 times** outside tests.

**Verdict.** This is a coherence defect *inside two completed slices*, not a rule waiting to be
invented — four of six slices already implement the correct rule. **It was not fixed, and neither
completed slice was modified.** The scope, if authorized, is: replace `short()` with `reference()`
on the two slices, keep it on the legacy screens or retire it there separately, and add the
assertion to each slice's render test. No new component is needed; §K explains why.

---

## K. Product coherence after six slices — measured on the running product

The application was built from the current commit, served against fixture APIs, and walked with a
real browser at 1440 px. Seventeen screens were visited. This section reports only what the rendered
product showed.

### K.1 Failing closed — the product is sound

Every screen was loaded three times against an API answering **404 to everything**, then **401 to
everything**, then **403 to everything**. All seventeen screens rendered their own heading and their
empty state, with HTTP 200, in all three conditions. **No screen errored, and no screen claimed data
it did not have.** This is the single most important coherence result in this document and it is a
pass.

*One honest note on method.* An earlier pass used a chained fixture rig that could answer a request
with a 200 carrying another module's payload. Three screens threw under it. That is a defect of the
rig, not of the product — no contract-typed API can produce that response — and it is **not**
reported as a finding. It is recorded here only because the earlier numbers appear in this session's
working files.

### K.2 No page-level horizontal scroll

`document.documentElement.scrollWidth === window.innerWidth` held on all seventeen screens.

### K.3 Finding — two different screens are both titled "Approvals"

| Route | Navigation label | Page heading |
| --- | --- | --- |
| `/approvals` | Approvals | **Approvals** |
| `/workflow` | Workflow configuration | **Approvals** |

`/workflow` also carries a section headed "Approvals" and another headed "This approval's chain".
A reader who follows "Workflow configuration" arrives at a page titled "Approvals" that is not the
Approvals screen. This is the clearest coherence defect the walk found.

### K.4 Finding — the navigation label and the page heading disagree on five screens

| Route | Navigation says | Page says |
| --- | --- | --- |
| `/recruitment` | Recruitment | Hiring |
| `/organization` | Organization | Structure |
| `/career` | Career | Career and succession |
| `/learning` | Learning | Learning and development |
| `/workflow` | Workflow configuration | Approvals |

Some of these are defensible — "Hiring" is the *work*, "Recruitment" is the *module*, and that
distinction is the whole thesis of the slice programme. But it is applied on five screens and not on
the other twelve, and no rule is written down for when the heading may differ from the label.

### K.5 Finding — the boundary footnote is on thirteen of sixteen screens, under seven different headings

The "what this does not hold" footnote is the strongest product idiom the slice programme produced,
and it is more widely adopted than expected: **thirteen of the sixteen module screens carry one**,
and so does the Employee Record detail route. What is inconsistent is what it is *called*.

| Heading | Screens |
| --- | --- |
| What *&lt;Module&gt;* does not **hold** | `/attendance`, `/compensation`, `/employment`, `/leave`, `/onboarding`, `/recruitment` |
| What Payroll does not **do** | `/payroll` |
| What this **product** does not do | `/career`, `/workflow` |
| **Status** — the idiom's content under a heading that does not announce it | `/learning`, `/performance` |
| What this **screen** does not do | `/approvals` |
| What this **record** does not show | `/employment/:employmentId` |
| What this **register** does not hold | `/people` |
| **none** | `/organization`, `/documents`, `/letters` |

`/performance` and `/learning` render the section under a heading that resolves to the single word
**"Status"** — `performance/overview.tsx:78` and `learning/overview.tsx:88` both title the section
`status`, and both locale catalogues render `status` as *Status*. The doc comment above each is
verbatim the idiom ("What this product does not do, said once and plainly"), so the intent is right
and only the visible heading is not. A section headed "Status" whose content is a list of things the
product cannot do is the least legible instance of the idiom in the product, and the easiest to fix.

The six slices additionally apply an uppercase transform in their `frame.tsx` that the legacy screens
do not, so the same sentence reads *WHAT LEAVE DOES NOT HOLD* on one screen and *What Compensation
does not hold* on the next.

Four variations at once, then: the verb ("hold" vs "do" vs "show"), the subject (the module, the
product, this screen, this record, this register), the casing, and — on two screens — whether the
heading names the idiom at all.

### K.6 Finding — the legacy screens open with a section called "Overview"; no slice does

`/compensation`, `/performance`, `/career`, `/learning` and `/workflow` all begin with a section
headed "Overview". None of the six slices has one — a slice opens on the work (Requests, Exceptions,
Waiting for you) rather than on a summary. This is a real difference in product posture and it is
currently the fastest way to tell a slice from a legacy screen.

### K.7 What §K means for the ranking

None of K.3–K.6 needs a new component, a new endpoint, or a contract change. They are naming,
coverage and wording. Together with §J they form a coherent, self-contained piece of work —
**"make the seventeen screens agree with each other"** — that is smaller than any slice and would
raise the perceived completeness of the whole product rather than one module of it.

**No screen was normalized, and no component was created.** This investigation did not prove a new
shared component is necessary: the four `reference()` implementations are one line each and the
boundary footnote already has a shared shape inside each slice's `frame.tsx`.

---

## L. Commercial maturity

### Horilla (read from a clone; nothing copied)

Horilla's `asset` app carries nine models: `AssetCategory`, `AssetLot`, `Asset`, `AssetItem`,
`AssetReport`, `AssetDocuments`, `ReturnImages`, `AssetAssignment`, `AssetRequest`. Two of those are
concepts Munaxa Work does not have:

- **`AssetRequest`** — an employee asking for an asset. That is a self-service surface, and per §D
  it is blocked here for reasons that have nothing to do with assets.
- **Condition on return** — `AssetAssignment` grades a returned item Healthy / Minor damage / Major
  damage, with `ReturnImages` attached.

Munaxa Work's Assets has something Horilla does not: **`AssetClearanceView`**, a bounded answer about
one employment that carries no employment status, no person and no tenant, published specifically so
Offboarding can consume it across a module boundary.

**These are different products making different bets, and neither list is a gap list for the other.**
Nothing here recommends adding asset requests, damage grades or return photographs. They are
Horilla's product decisions.

### MenaITech (public positioning only — weaker evidence, and marked as such)

No MenaITech source material was read. The regional expectation this benchmark establishes — and
which earlier investigations recorded — is that **leave and end-of-service entitlement are headline,
statutory features** in this market. Leave shipped as slice #5. Nothing in this section proposes a
feature merely because a competitor has one, and no product is decomposed here because MenaITech
decomposes it that way.

### What the benchmarks actually say about the ranking

Neither benchmark points at Assets. Both point at self-service, which is blocked. Horilla's
administrative/employee/manager dashboard separation is the same structure §D and §E rule out. **The
benchmarks are therefore not the deciding input this time**, and it would be dishonest to present
them as one.

---

## M. Classification

| Candidate | Class | Why |
| --- | --- | --- |
| **Performance as Work** | **A** — buildable now, no new backend | 13 GET, 12 already read, 25 of 25 views exported, two detail routes and no admin detail route, manager filter documented as non-credential, one deliberate 404-for-403 to render honestly |
| Screen coherence pass (§J + §K) | **A** — buildable now, smallest scope | Naming, footnote coverage, identifier rendering. No endpoint, no contract, no component |
| Assets & Custody as Work | **B** — blocked on one narrow contract decision | 3 of 7 reads untypeable; AD-006 already anticipates publishing custody |
| Organization as Work | **B** — unblocked technically, weak on value | 8 unconsumed reads, all typeable; but a configuration surface, not a work surface |
| Relations as Work | **B** — blocked on the widest contract decision | 7 of 10 reads untypeable; the boundary is also the access trail |
| `notFound()` HTTP status | **A** — defect fix, not a slice | One behaviour, eight routes, growing |
| Career / Learning | **C** — already consumed | 13 of 13 and 10 of 11 read; nothing a slice would add |
| Self-Service / "My Work" | **D** — blocked outside this repository | No principal → employment resolution; absence is structurally asserted |
| Manager Workspace / "Team Lens" | **D** — blocked, and dangerous if built anyway | The filter is not a credential, and a screen would make it look like one |

---

## N. Ranking

**1. Performance as Work.** The only Class A *product* candidate. It is the same move the last six
slices made — take a module that publishes a full read surface and no way to act on one case, and
give it the detail route. Two detail routes exist (`/goals/:goalId` unconsumed, `/reviews/:reviewId`
consumed but with no admin route), the contract is complete, and it carries one genuinely
interesting honesty problem: a review the caller may not read answers 404 by design, so the
not-found page *is* the refusal page and must be written to be true in both cases.

**2. The screen coherence pass (§J + §K).** Smaller than a slice and it improves all seventeen
screens rather than one. Two screens both titled "Approvals" is the kind of defect that costs
credibility in a demo out of proportion to its size. If the owner wants the fastest visible increase
in *product completeness* rather than *capability*, this is it — and it can be done before or after
#1 without conflict.

**3. `notFound()` HTTP status.** A defect fix, eight routes, growing by one per slice. Cheap now,
more expensive later. Not a slice and should not be bundled into one.

**4. Assets & Custody as Work** — conditional on the owner publishing the three route-backed custody
views (and `CustodyView`, the element type inside one of them). If
that decision is made, this becomes Class A and moves above #3.

**5. Organization as Work.** Unblocked, but configuration rather than work.

**6. Relations as Work.** Highest unconsumed surface in the product, gated behind the governance
decision in §G — which should be taken on its own merits, not because a screen wants it.

**Not ranked: Self-Service, Manager Workspace.** Blocked, and neither should be worked around.

---

## O. Definition of Ready for the top candidate

Stated so the owner can authorize or reject it. **This is not an authorization and no work was
started.**

**Reads it would use — all existing, all exported, none new.**
`GET /performance/cycles`, `/rating-scales`, `/goal-categories`, `/frameworks`, `/templates`,
`/goals`, **`/goals/:goalId`** *(currently unconsumed — one goal with its progress history)*,
`/reviews`, **`/reviews/:reviewId`**, `/calibration-sessions`, `/reconciliation`, `/talent/matrix`,
`/feedback`.

**Routes it would add to the admin app.** `/performance/goals/[goalId]` and
`/performance/reviews/[reviewId]`, each with `loading.tsx` and `not-found.tsx` (ADR-0075 already
accepts `[name]` segments).

**What it must not do.** Not compute a rating, a weighted score, a goal completion percentage, a
cycle progress figure or any total. The rule is already implemented correctly on the legacy screen
and should be carried forward rather than re-derived: `apps/admin/src/performance/scoring.ts` is a
*formatter*, not a calculator —

> **Nothing in this file does arithmetic on a score, and that is the whole point.** The engine
> decided what a review is worth; a screen that recalculated it would be a second, weaker answer to
> a question the domain already settled.

— converting hundredths and basis points by string insertion rather than division, and passing
`observedValue` through as the decimal string it arrived as because it is a `bigint` that can exceed
2^53. A slice should reuse this file, not replace it. Also: not send `managerEmploymentId`, not
create `/me`, and not add a permission, contract, migration, table, endpoint or event.

**The honesty problem it must solve.** `GET /performance/reviews/:reviewId` answers 404 both for a
review that does not exist and for a review the caller may not read. The not-found page must be true
in both cases without hinting which one occurred — which is a stricter requirement than any of the
six shipped slices faced, because Leave and Attendance could distinguish 404 from 403 and this route
deliberately cannot.

**Open question for the owner.** `performance.summary.read` is declared and gates nothing, and
there is no `PerformanceSummaryView` route. Either the summary is intended and unbuilt, or the
permission is an orphan. A slice should not decide that.

---

## P. Gate

`pnpm verify` — `standards && format:check && lint && typecheck && test && build` — run to completion
with **PostgreSQL 16 running locally and `TEST_DATABASE_URL` set**, so the integration suites
executed against a real database rather than skipping.

**Exit code 0. Nothing failed and nothing was skipped.**

### That this was a run and not a cache replay

`.turbo/cache` and `node_modules/.cache/turbo` were deleted before the command started. Four turbo
stages report a summary (`standards` and `format:check` are plain node/prettier invocations and
report none):

| Stage | Tasks | Cached | Wall clock |
| --- | ---: | ---: | ---: |
| `lint` | 51 | **0** | 1m43.5s |
| `typecheck` | 51 | 22 | 22.8s |
| `test` | 51 | 22 | **7m28.2s** |
| `build` | 29 | **0** | 1m8.4s |

The "22 cached" entries are **this same run's own outputs** — a stage's 51 tasks include the
dependency `build` tasks that an earlier stage in this run already executed. No task in this gate
replayed a cache written before the run.

For the stage that matters most, this was checked task by task rather than inferred from the
summary: **29 `test` tasks executed, 29 cache misses, 0 cache hits.**

### Actual test counts

| | |
| --- | --- |
| Packages running `test` | 29 |
| Packages with test files | 24 (five run `--passWithNoTests` and have none: `contracts`, `country-packs`, `sdk`, `employee-portal`, `manager-portal`) |
| **Test files** | **458 passed (458)** |
| **Tests** | **5,233 passed (5,233)** |
| Failed | 0 |
| Skipped | 0 |

The two largest: `@work/api` 88 files / 827 tests, `@work/admin` 50 files / 632 tests. Then
`@work/workflow` 75, `@work/career` 27, `@work/learning` 21, `@work/relations` 20, `@work/kernel` 19,
`@work/assets` 18, `@work/performance` 17, `@work/identity` 15, `@work/organization` 14,
`@work/people` 12, `@work/attendance` 11, `@work/documents` 9, `@work/payroll` 9, `@work/leave` 8,
`@work/recruitment` 8, `@work/compensation` 8, `@work/employment` 8, `@work/letters` 7,
`@work/onboarding` 6, `@work/persistence` 4, `@work/testing` 3, `@work/config` 1.

Earlier sessions on this repository recorded runs where 517 API tests silently skipped because no
database was reachable. That did not happen here: `skipped` appears zero times in the entire log,
and the integration suites (`*.integration.test.ts`, `*.cross-module.spec.ts`) show real per-file
timings in the hundreds of milliseconds to seconds, which is what a database-backed test costs.

---

## Q. Constraints honoured

- **Nothing was implemented.** No product slice, no route, no migration, no table, no permission, no
  contract, no aggregation, no event, no component.
- **No completed slice was modified.** Approvals and the Employee Record still truncate identifiers
  (§J); Attendance and Leave are untouched.
- **No `/me`, no current-user resolver, no manager aggregation API, no universal dashboard
  endpoint, no manager-specific event system.** The test asserting `/me` must not exist was not
  modified.
- **Nothing was exported and no contract was modified** (§G). No generic export mechanism was
  created; §G contains a recommendation only.
- **The `notFound()` HTTP status was not fixed** (§H).
- **No authorization finding was fixed.** No permission was weakened, added or removed. Missing
  self-service queries were not classified as authorization defects (§I).
- **No screen was normalized and no new component was created** (§K).
- **Nothing was copied from Horilla or MenaITech** — no code, architecture, UI, schema, permissions
  or module boundaries. No feature is proposed merely to match another product (§L).
- **No numeric phase was created**, and the next slice was **not** selected automatically.
- The only files added are this document and the working files under the session scratchpad, which
  are not committed.

---

# INVESTIGATION COMPLETE — AWAITING OWNER REVIEW AND NEXT SLICE AUTHORIZATION
