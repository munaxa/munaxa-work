# Munaxa Work — Next Product Direction Investigation #2

**Investigation only. Nothing was implemented and nothing in the product changed.** No slice, no
platform capability, no route, migration, table, permission, contract, resolver or aggregation. No
completed slice was modified. No authorization finding, HTTP status, contract export or identifier
was fixed. No numeric phase was created, and Product Slice #8 was not selected automatically.

One question:

> What is the largest remaining product gap preventing Munaxa Work from feeling commercially
> complete and differentiated?

---

## A. Seven-slice product state

| # | Slice | What it made possible |
| --- | --- | --- |
| 1 | Employee Record | one person's cross-module record |
| 2 | Approvals as Work | the queue of decisions waiting on somebody |
| 3 | Hiring as Work | a requisition and an application, opened |
| 4 | Payroll as Work | a run and a payslip, explainable |
| 5 | Leave as Work | a balance made explainable from a published ledger |
| 6 | Attendance as Work | a day, its punches and the domain's verdicts |
| 7 | Performance as Work | a review and a goal, opened by identifier |

**What the seven now enable together, which none enables alone.** An administrator can start at an
employment and reach that person's leave standing, their attendance day, their payroll result, their
review, their goal and their approval — each by identifier, each with the boundary between what the
product knows and what it does not stated on the page. That is a coherent operational HR product,
and it is the thing that did not exist eight turns ago.

**What the seven share, and what the rest of the product does not.** Every slice fails closed on a
per-read basis, renders no figure it computed itself, opens specific records rather than
first-rows, isolates every Latin run in Arabic, and states its own boundaries once. §O measures how
far that has and has not spread.

---

## B. Current product inventory, rebuilt from source

| Measure | Count |
| --- | ---: |
| Modules | 18 |
| Prisma models | 186 |
| Migrations | 31 |
| API routes | 513 |
| GET routes | 187 |
| Permissions declared | 285 |
| Admin routes (`page.tsx`) | 28 |
| — of those, detail routes | 10 |
| `not-found.tsx` | 10 |
| `loading.tsx` | 17 |

### The 28 admin routes, by what they are

**Product workflows — 17 routes.** `/employment` + `/employment/[employmentId]`; `/recruitment` +
2 detail; `/approvals` + 1 detail; `/payroll` + 2 detail; `/leave` + 2 detail; `/attendance` + 1
detail; `/performance` + 2 detail.

**Legacy module screens — 8 routes**, each a single page with no detail route: `/people`,
`/organization`, `/onboarding`, `/compensation`, `/career`, `/learning`, `/documents`, `/letters`.

**Configuration — 1 route.** `/workflow` (labelled "Workflow configuration" in the navigation).

**Shell — 1 route.** `/`.

**Modules with no admin surface at all — 3.** **Assets**, **Relations**, **Identity**. Assets appears
only as a section inside the Employee Record.

### What a customer can actually do today

They can **run seven operational workflows** and **inspect eight module registers**. They cannot open
a course, a learning record, a career plan, an asset, a custody record, a disciplinary case, an
investigation, or a member — because no route exists for any of them.

**A configuration page is not a workflow, and this document does not count one as equivalent.** By
that test the product has seven workflows and nine reference surfaces.

---

## C. Assets / Custody / Clearance

### C.1 Assets and custody

Re-verified from current source. **The classification has not changed, and the reason has not
changed.**

### The seven GET routes

| Route | Returns | Exported? |
| --- | --- | --- |
| `GET /assets/categories` | `AssetCategoryView` | yes |
| `GET /assets` | `AssetPageView` | yes |
| `GET /assets/:assetId` | `AssetView` | yes |
| `GET /assets/custody/clearance` | `AssetClearanceView` + `CustodyBlockerView` | yes |
| `GET /assets/:assetId/custody` | `AssetCustodyView` | **no** |
| `GET /assets/custody` | `CustodyPageView` | **no** |
| `GET /assets/custody/summary` | `CustodySummaryView` | **no** |

`CustodyView` — the element type inside two of those — is also unexported. Six of ten defined views
are published; four are not.

### The workflow the contracts actually support

Derived rather than assumed. Reading only what is exported, a screen can show: the asset catalogue,
the inventory, one asset, and **what one employment still holds and why clearance cannot complete**.

It cannot show who holds any given asset. `AssetView`'s own documentation is explicit:

> `status` is whether the item is in service … **It never says who holds it.** … a copy on this view
> would be a second answer that goes stale (ADR-0070).

So the asset-centric half of the workflow — *this laptop, who has it, who had it before* — is
precisely the half that is unexported. A screen built on the four published views would be an
inventory list that cannot answer the question an assets screen exists to answer.

### What already works

`AssetClearanceView` is exported, carries named blockers (`assetTag` — "the label somebody uses to go
and find the item"), and is **already consumed** at `apps/admin/src/employment/record-api.ts:186`,
rendered by `record-governance.tsx`. The most valuable single Assets read is already on screen.

### Classification: **B**

Blocked by a contract decision, not by screen work. The decision is narrow and half-made — AD-006
already names Offboarding as a consumer that will read custody *through public contracts*, which is
why the clearance half was published. The remaining question is whether custody *history* becomes
public surface too.

---

### C.2 Clearance / Offboarding, treated separately

Investigated as its own candidate, because "Assets has a clearance read" and "the product can run an
employee departure" are different claims.

### What exists

| Capability | Where | State |
| --- | --- | --- |
| An employment can end | `POST /employments/:employmentId/end` | exists |
| `ended` is a real status | `EMPLOYMENT_STATUSES` = draft, pending_approval, active, suspended, ended | exists |
| Asset clearance for one employment | `GET /assets/custody/clearance` | exists, exported, consumed |

### What does not exist

There is **no offboarding module, no exit process, no clearance aggregate, no leaver checklist and
no second clearance domain**. Onboarding has plans, plan versions, task definitions and tasks; there
is no offboarding twin. Nothing in the repository holds outstanding obligations beyond assets — not
accounts, not finance, not keys, not documents.

Assets says so itself, and names the module that would own the answer:

> **`assetsClear`, not `clear`.** Assets does not decide whether a person is cleared; Offboarding
> (Phase 11.2) will, across domains this module knows nothing about — accounts, finance, keys. A
> field called `clear` on an Assets contract would be read as the whole answer and would be wrong
> the first time anything outside Assets blocked an exit.

### Classification: **C — a product gap requiring new domain capability**

This is the distinction §6 asked for, and it falls on the far side of it. Clearance is **not existing
capability that can be composed**: composing it would mean inventing the very aggregate Assets
deliberately refuses to imply. §P measures the scale — Horilla's offboarding app carries ten models.

Commercially it is important; that is not the same as buildable. It is honestly Class C and should
not be dressed as anything else.

---

## D. Self-Service / My Work — and a correction to the previous investigation

**The previous investigation's central claim about self-service was wrong, and this document
corrects it rather than reconciling it silently.**

`next-product-direction-investigation.md` §D stated:

> There is no principal → membership → employment resolution anywhere in the product.

That is false. Re-reading the current source, **the chain exists, is published, is permissioned, and
is already exercised by production code.**

### The chain, link by link

| # | Link | Where | State |
| --- | --- | --- | --- |
| 1 | credentials → principal | `PlatformAuthenticationPort` (kernel) | **port only — no adapter, by design** |
| 2 | principal → membership | `resolveForPrincipal` + `TenantMembershipDirectory`, `apps/api/src/tenancy/tenant.middleware.ts:88` | **exists** |
| 3 | membership on this request | `TenantContext.membershipId` + `currentMembershipId()` (kernel) | **exists** |
| 4 | membership → employment | `identity.primary-employment-for-membership` → `EmploymentLinkView.employmentId` | **exists, exported, permissioned** |

Link 4 is a published Identity query with its own permission and its own stated reason for existing:

> **Why this exists rather than a consumer reading `identity.describe-member`.** That query answers
> the whole of a member's page … guarded by `identity.membership.read`, the permission behind the
> member register. A consumer that needed one employment identifier would have had to hold the
> register to get it. This one is guarded by `identity.employment-link.read`, which is the
> permission for exactly this fact.

### It is not theoretical — one module already runs the whole chain

`packages/modules/workflow/src/application/approval-queries.ts:55` and `:105`, behind
`workflow.approval.read-own`:

```ts
const caller = currentMembership();
if (caller === undefined) return success(emptyPage<PendingApprovalView>());
const found = await dependencies.stores.steps.awaitingFor(transaction, caller, pageOf(query));
```

That is a **working self-service read**. And `apps/api/src/workflow/workflow-reporting-line.ts:144`
runs link 4 under a kernel service grant to resolve a requester's primary employment.

This explains a fact the previous investigation reported without explaining: of fifteen `-own`
permissions, exactly two gate a real handler — `workflow.approval.read-own` and
`onboarding.task.complete-own`. They are the two whose subject is a **membership**. The other
thirteen belong to modules whose subject is an **employment**, and none of them makes the link-4 hop.

### So what is actually blocking self-service

**One thing: Platform's authentication adapter.** Without link 1 there is no principal, so no
membership, so `currentMembershipId()` returns `undefined` and the one working self-service read
correctly returns an empty page. And the kernel is unambiguous that this will not change here:

> The default, and **the only implementation this repository will ever contain**: it authenticates
> nobody. … Every deployment supplies Platform's adapter.

`/me` remains structurally asserted absent in `apps/api/src/workflow/workflow.routes.spec.ts:256`
and in three admin `api.test.ts` files. **Nothing was changed and no assertion was removed.**

### The strategic question §7 asks

> Is self-service now the largest product gap even though the repository is not ready to support it?

**It is the largest gap by customer value and it is not the largest actionable gap.** Two facts
decide it:

1. **No work inside Munaxa Work unlocks it.** The missing link is the one the architecture
   deliberately places outside this repository. There is no "smallest platform capability" to build
   here — §27's premise does not apply, and inventing one would mean writing the authentication this
   product is forbidden to write.
2. **The thirteen employment-subject `-own` permissions would each need a new query handler** making
   the link-4 hop. That is thirteen pieces of domain work across eight modules, and it is Class C
   whether or not link 1 ever arrives.

### Classification: **D — blocked outside this repository**

Downgraded in *actionability* and upgraded in *understanding*: the gap is one adapter wide, not an
architectural chasm, and the day that adapter lands the product is much closer to self-service than
the previous investigation believed.

---

## E. Manager Workspace / Team Lens

Rebuilt from current source. The two candidates §8 asks to separate behave differently.

### Manager Self-Service Workspace

Requires the caller to *be* a manager, which requires link 1 of §D. **Class D**, same blocker, same
reasoning.

### Manager Team Lens inside the Admin

| Module | Manager filter on a read? |
| --- | --- |
| Employment | yes — `GET /employments?managerEmploymentId=` |
| Performance | yes — goals search, review search, review read, feedback search |
| Leave | none |
| Attendance | none |
| Payroll | none |
| Recruitment | none |

Two modules of six. And both document the parameter as explicitly not a credential:

> `managerEmploymentId` on the search is a filter, not a credential. A caller holding `goal.read`
> may narrow to one manager's reports; a caller holding only `goal.read-team` reads nothing.

The Performance module also records that deriving scope from the record itself was a real defect:

> Deriving it from the review's own manager was a real defect in this module: every review has a
> manager and that manager always has it among their reports, so the check passed for everybody. It
> was a free pass wearing the shape of a check.

**A Team Lens built on two modules would be an administrator's filter presented as a manager's
team**, and it would be four-sixths empty. The Performance slice already refuses to offer it and
says why on the screen.

### Classification: **D — blocked, and more dangerous than self-service because it is technically possible**

Nothing would stop it being built. The result would be a credential-shaped control that is not one.

---

### Performance follow-up (§9 of the brief)

Not reopened. Performance is complete: 13 GET routes, 13 consumed, 25 of 25 views exported, two
detail routes, `notFound()` semantics rendered honestly on the one route where 404 is also a
refusal.

Two open items, classified as §9 asks:

**1. `PerformanceSummaryView` has no handler and no route — an owner decision, not a product gap.**
The view is exported and `performance.summary.read` is declared; neither appears anywhere else in
the module. Its fields (`participants`, `completed`, `calibrated`, `averageFinalScore`,
`byRatingLevel`) are exactly the figures the pre-slice screen counted in a browser. Slice #7 removed
the counters rather than replacing them. Either the summary is intended and unbuilt, or the view and
the permission are orphans. **A slice must not decide this.**

**2. No Performance view publishes a workflow instance — a future enhancement, not a gap.** Goal
approval and review completion are named human acts in the domain, but no view carries an approval
instance identifier, so there is nothing for a screen to open. Wiring `ApprovalPort` would be new
integration, not composition.

Connected to Employee Record, Hiring, Learning and Career, Performance now reads as part of a
lifecycle rather than a silo — which is what makes §F and §G the natural continuation.

---

## F. Learning

### Backend

| | |
| --- | --- |
| GET routes | 11 |
| Distinct reads the admin composes | 10 (9 on the screen, 1 via the Employee Record) |
| Views defined / exported | **16 / 16** |
| Detail-capable reads | **4** — `courses/:courseId`, `paths/:pathId`, `enrolments/:enrolmentId/assessment-results`, `history/:employmentId` |
| Admin detail routes | **0** |

`LearningHistoryView` is the shape a lifecycle detail route needs, and it publishes its own counters
rather than leaving them to a browser:

```ts
readonly employmentId: string;
readonly asOf: string;
readonly assignments / enrolments / certifications: readonly …[];
readonly openAssignments: number;
readonly overdueAssignments: number;
readonly completedCourses: number;
readonly activeCertifications: number;
readonly expiringCertifications: number;
```

It is **already consumed by the Employee Record**, so the most valuable read is proven.

### The workflow the contracts support

Mandatory rules say what training is required; assignments say who owes it; `overdueAssignments`
says who is late; `history/:employmentId` is one person's record; `certifications` carry expiry.
That is **compliance training**, which is a headline enterprise-HR expectation and the one Learning
workflow a customer will ask about first.

### The screen that exists today

Measured, not asserted. `apps/admin/src/learning/`:

| Defect | Count |
| --- | ---: |
| `items[0]` — a section describing an arbitrary first row | **13** |
| `short()` — identifiers truncated to 8 characters | **22** |
| `.filter(...)` in a render path — figures counted in the browser | **9** |
| `lifecycle.ts` — domain rules re-derived in React | present |

**This is the worst remaining screen in the product**, and it is worse than Performance was before
slice #7 (which had 5 `items[0]` sections, 14 `short()` call sites, 4 browser counters and a
`lifecycle.ts`). §O shows it is also one of the three screens with the worst empty state.

### Classification: **A — product-ready**

Everything a slice needs exists, is exported, is permissioned, is bounded, and there are four detail
reads with no detail route. No new backend capability of any kind.

---

## G. Career

### Backend

| | |
| --- | --- |
| GET routes | 13 |
| Distinct reads the admin composes | 13 |
| Views defined / exported | **19 / 19** |
| Detail-capable reads | **6** — `summary/:employmentId`, `development-plans/:id`, `paths/:id`, `succession-plans/:id`, `succession-plans/:id/bench-strength`, `readiness/history/:employmentId` |
| Admin detail routes | **0** |

`CareerSummaryView` is the per-employment lifecycle read — plan, pool memberships, nominations,
latest readiness, active development plan, mobility recommendations — and is **already consumed by
the Employee Record**. `BenchStrengthView` counts in the database precisely so a consumer cannot
count a page:

> A count assembled from `items.length` would be the size of the page, which is the defect this
> shape exists to make impossible.

### The screen that exists today

`items[0]` × 5, `short()` × 21 (the second-highest in the product), `lifecycle.ts` present, 16
sections, and the second-worst empty state (§O).

### Classification: **A — product-ready**

Career and Learning are twins: same completeness, same defect family, same absent detail routes.
Career's succession workflow is more specialised; Learning's compliance workflow is more universal.

---

## H. Relations

10 GET routes, **0 consumed**, **no admin surface at all**, and **8 of 12 views unexported**. Only
`ViolationCategoryView`, `ViolationView`, `ViolationPageView` and `LocalizedTextView` are published;
seven of the ten query handlers return a type no screen can name — `DisciplinaryRuleView`,
`ApplicableActionView`, `DisciplinaryActionView`, `EscalationContextView`, `InvestigationView`,
`InvestigationPageView`, `CaseHistoryView` — plus `CaseEventView`, the element type inside one of
them.

A workflow **is** supported by the domain — a violation, its category, the applicable disciplinary
action, an investigation and a case history — but only the first two are typeable.

The module states why the boundary is hard here:

> the moment a second module reads `relation_violation` directly the boundary stops being a boundary
> — and in this domain the boundary is also the access trail.

### Classification: **B — blocked on the widest contract decision in the product**

Publishing an investigation contract is a governance decision about who may name a disciplinary case
in a type signature. Not clerical, and it should not be bundled into any slice.

---

## I. Organization

12 GET routes, 4 consumed, **11 of 11 views exported** — technically unblocked, unchanged from the
previous investigation.

Eight unconsumed reads: `units`, `positions`, `standard-unit-types`, `export`,
`units/:unitId/establishment`, `units/:unitId/ancestry`, `units/:unitId/placements`,
`units/:unitId/governing-legal-entity`.

The screen already renders a structure tree and has **zero `items[0]`, zero `short()` and zero
browser-side counting** — it is one of the cleanest legacy screens in the product.

**What Organization is.** Units, positions, legal entities, unit types, calendars, cost and profit
centres, tenant settings. Every one of those is something an administrator *configures* so that
other modules can reference it. There is no work queue, no case, no record somebody acts on.

### Recommendation: **configuration infrastructure, not a product slice**

Its per-unit reads (ancestry, placements, establishment, governing legal entity) would be better
consumed *by the Employee Record*, where a unit identifier already appears and a reader is already
asking "where does this person sit?" — but that is an Employee Record enhancement, not an
Organization slice, and it is not proposed here.

---

## J. Identity

4 GET routes — the member register, member search, one member, and invitations — **0 consumed**, 10
of 10 views exported, and four of seventeen permissions gating nothing.

**Identity is where §D's chain lives**, and that is the interesting thing about it: it already
publishes `identity.primary-employment-for-membership`, the delegation register, and the membership
standing query that Workflow consumes.

**Is a member register a product workflow?** Partly. "Who has access to this tenant, who was
invited, who was suspended" is a real administrative question, and `identity/members/:membershipId`
("Everything about one member") is a genuine detail read. But it is **access administration**, and
this product's architecture places authentication and authorization with Platform (ADR-0001). A
Munaxa Work screen that presented itself as the place access is managed would be claiming ownership
of a boundary the product deliberately does not own.

### Classification: **C for the workflow, D for the framing**

The reads exist and are typeable, so a register screen is buildable. But identity recovery, access
and authentication are **not** Munaxa Work Admin workflows, and building a screen that looks like
they are would be the second time this product had to un-invent a credential-shaped control.

---

## K. Cross-module contract exports

**15 of 18 modules export every view they define.** Unchanged.

| Module | Defined | Unexported | Blocks composition? |
| --- | ---: | ---: | --- |
| assets | 10 | 4 | **yes** — 3 of 7 GET routes untypeable |
| relations | 12 | 8 | **yes** — 7 of 10 GET routes untypeable |
| workflow | 21 | 2 | no — reachable through an exported parent |

**Clerical: 2** (`ServiceLevelTargetView`, `StepServiceLevelView`). Both are already rendered by the
Approvals slice through `ApprovalStepView.serviceLevel`; a consumer simply cannot name the type.
Publishing them adds no information that is not already public.

**Owner/governance decisions: 12** — Assets' four (narrow, half-made by AD-006) and Relations' eight
(wide, and the access trail is the boundary).

### Is contract-export completeness a product-velocity constraint now?

**It constrains exactly two candidates and nothing else.** Fifteen modules are complete, including
every module the seven slices consumed and both modules §F and §G recommend. The two it blocks are
the two ranked below Learning and Career.

**A dedicated investigation is not worth doing now.** The complete inventory is in this document and
in §G of the previous one; what remains is not analysis but two owner decisions of very different
weight. Bundling them into one "contract exports" task would put a clerical two-line change and a
disciplinary-records governance decision in the same review.

*Noted, not acted on:* `GET /organization/export` and `GET /employments/export` are the only two
export routes in the product, while `leave.export`, `payroll.export` and `compensation.export` are
declared permissions gating nothing.

---

## L. HTTP not-found semantics

Re-measured live this turn, against a build of the current commit and an API answering 404 to
everything. **The count has grown from eight to ten**, with slice #7's two routes.

| Route | Status |
| --- | ---: |
| `/employment/[employmentId]` | 200 |
| `/approvals/[instanceId]` | 200 |
| `/leave/requests/[leaveRequestId]` | 200 |
| `/payroll/runs/[payrollRunId]` | 200 |
| `/payroll/results/[payrollResultId]` | 200 |
| `/recruitment/requisitions/[requisitionId]` | 200 |
| `/recruitment/applications/[applicationId]` | 200 |
| `/attendance/days/[employmentId]/[attendanceDate]` | 200 |
| **`/performance/reviews/[reviewId]`** | **200** |
| **`/performance/goals/[goalId]`** | **200** |
| an unrouted path | **404** |

Every route renders the correct copy. Every route returns the wrong status.

### What kind of issue is this?

| Framing | Verdict |
| --- | --- |
| Release-blocking | **no** — no human-facing behaviour is wrong; the page says the right thing |
| Correctness | **yes** — the status contradicts the body, and that is a defect however small |
| SEO | **not applicable** — this is an authenticated internal admin portal; nothing indexes it |
| API/client integration | **no** — no client consumes these HTML routes programmatically; the API's own `handler-result.ts` maps `not_found` → 404 correctly in all 18 modules |
| Low-priority infrastructure | **yes, and this is the honest label** |

**Blast radius: ten routes, one shared Next.js behaviour, growing by one to two per slice.** It is
cheap now and marginally more expensive later, and it blocks nothing.

### Recommendation

**Do not do it before another product slice.** It is a defect fix with a regression test per route
and no customer-visible symptom. Doing it first would spend a cycle on the one finding in this
document that no customer can see.

---

## M. Authorization consistency

**285 declared, 28 unreferenced.** Identical to the previous investigation — slice #7 added no
permission and removed none.

| Category | Count |
| --- | ---: |
| Self-service (`-own`, `read-about-self`) | 14 |
| Export | 3 |
| Reads whose route does not exist | 11 |

§D now explains the 14 rather than merely counting them: two of the fifteen `-own` permissions gate
real handlers because their subject is a **membership**; the other thirteen belong to modules whose
subject is an **employment**, and none makes the link-4 hop.

**Does this threaten product credibility? No.** Nothing fails open — the CQRS pipeline checks the
permission before the handler runs (`packages/kernel/src/cqrs/pipeline.ts:102`), so a permission
with no handler is a grant over nothing. The risk is the one Assets names in its own test:

> A permission naming an absent capability is a grant somebody can hold over nothing, and the day it
> starts meaning something they hold it already (D-5.2-04).

Assets is still the only module asserting the invariant in both directions.

**Recommendation: not the next dedicated task.** The generalisable move — promoting Assets'
bidirectional assertion into the shared testing package with a per-module allow-list of deferred
grants — is a testing change, is small, and would be better done *with* whichever slice next touches
permissions than as a standalone sweep. `recruitment.offer.read`,
`employment.reporting-line.read` and `employment.contract.read` were not touched.

---

## N. Identifier consistency

| Screen | Behaviour | `short()` call sites |
| --- | --- | ---: |
| Payroll, Hiring, Leave, Attendance, **Performance** | whole, via `reference()` | 0 |
| **learning** | truncated | **22** |
| **career** | truncated | **20** |
| workflow (configuration) | truncated | 11 |
| employment (Employee Record) | truncated | 9 + 1 |
| compensation | truncated | 5 |
| documents | truncated | 4 |
| approvals | truncated | 4 |
| onboarding | truncated | 3 |
| letters | truncated | 2 |

**81 call sites remain**, down from 95 — slice #7 removed 14. Five slices now use `reference()`,
which is `(value) => value ?? DASH`, written identically five times.

### Assessment

| | |
| --- | --- |
| Customer impact | **real where identifiers are compared, invisible where they are not** |
| Frequency | 81 sites across 9 screens |
| Mobile | none — truncation *helps* at 390 px, which is why it was written |
| Arabic / RTL | none — both forms are isolated identically |
| Scope | one-line helper swap per screen, plus a render assertion each |

The repository's own analysis is the argument: eight hex characters of a UUIDv7 are the top 32 bits
of a 48-bit millisecond timestamp, so **every identifier minted inside the same 65,536 ms window
renders identically**. The stated tolerance is "a row identifier nobody compares" — which holds on
Documents and Letters and does not hold on Approvals (three identifiers side by side on one card) or
the Employee Record (`personId`, `unitId`, `positionId`, `managerEmploymentId` in one block).

### Recommendation

**Not a standalone task, and not a design-system correction.** 42 of the 81 sites are on Learning and
Career — the two screens §F and §G propose rewriting anyway. Doing those two slices removes half the
problem as a by-product, exactly as slice #7 removed Performance's 14. What remains afterwards is
Approvals and the Employee Record, which is the narrow, genuinely-worth-doing residue.

---

## O. Product coherence, measured on the running product

The application was built from the current commit, served against an API answering **404 to
everything**, and walked in a browser. This is the state a customer sees before Platform's
authentication adapter is supplied — which is to say, the state every reader of this deployment
sees.

### Q.1 Product-critical — all pass

- **17 of 17 screens render at HTTP 200** with their own heading and an empty state. None errored.
- **No page-level horizontal scroll on any screen, at 390 px, in English and Arabic.**
- Every screen's navigation entry is marked current.

### Q.2 Important — the empty state is where slice and legacy diverge

What a customer *reads* when nothing is readable:

| | Screen | Words | "Nothing to show." |
| --- | --- | ---: | ---: |
| SLICE | `/employment` | 94 | 0 |
| SLICE | `/performance` | 143 | 0 |
| SLICE | `/leave` | 152 | 0 |
| SLICE | `/payroll` | 165 | 0 |
| SLICE | `/approvals` | 179 | 0 |
| SLICE | `/attendance` | 202 | 0 |
| SLICE | `/recruitment` | 207 | 0 |
| legacy | `/documents` | 106 | 0 |
| legacy | `/letters` | 117 | 0 |
| legacy | `/people` | 120 | 0 |
| legacy | `/organization` | 124 | 0 |
| legacy | `/onboarding` | 140 | 0 |
| legacy | `/compensation` | 144 | 0 |
| legacy | **`/learning`** | **461** | **14** |
| legacy | **`/career`** | **686** | 0 (16 sections) |
| legacy | **`/workflow`** | **1,117** | **11** |

A slice says it **once**. Three screens say it **eleven, fourteen and sixteen times**. `/workflow`
renders eleven hundred words to a reader entitled to none of it.

**This is the single most legible coherence defect in the product**, and it is concentrated in
exactly three screens — two of which are §F and §G.

### Q.3 Important — two screens are both titled "Approvals"

| Route | Navigation | Heading |
| --- | --- | --- |
| `/approvals` | Approvals | **Approvals** |
| `/workflow` | Workflow configuration | **Approvals** |

Unchanged from the previous investigation. A reader following "Workflow configuration" arrives at a
page titled "Approvals" that is not the Approvals screen.

### Q.4 Cosmetic — navigation label and heading disagree on five screens

`/recruitment` (Recruitment → Hiring), `/organization` (Organization → Structure), `/career` (Career
→ Career and succession), `/learning` (Learning → Learning and development), `/workflow` (Workflow
configuration → Approvals). Some are defensible — "Hiring" is the work, "Recruitment" is the module
— but no rule is written down for when they may differ.

### Q.5 Intentional

The boundary footnote, the withheld-per-read language, and the read-only posture with no controls
are deliberate and consistent across all seven slices.

### Q.6 Separate investigation

Section-heading vocabulary (the boundary footnote appears under seven different headings, two of
which are the single word "Status") — recorded in the previous investigation §K.5 and unchanged.

---

## P. Product architecture bottleneck

> Is the next bottleneck product composition or platform capability?

**Composition. Decisively, and the evidence points the same way from three directions.**

**1. The one platform capability that would matter cannot be built here.** §D establishes that the
self-service chain is four links, three exist, and the missing one is the authentication adapter the
kernel says is "the only implementation this repository will ever contain … Every deployment
supplies Platform's adapter." There is no smallest-capability answer to give, because the smallest
capability is somebody else's.

**2. The capabilities §22 lists as possible bottlenecks are mostly present.**

| Capability | State |
| --- | --- |
| current user identity | port only — outside this repository |
| current membership | **exists** — `currentMembershipId()`, consumed by Workflow |
| manager context | **exists** — `identity.primary-employment-for-membership` + `WorkflowReportingLine` |
| cross-module references | **exists** — `runWithServiceGrant`, used in production |
| public contract exports | **15 of 18 complete**; the 3 gaps block only the candidates ranked below |
| workflow instances | exist; Performance publishes none, which is a Performance decision |
| reporting | absent everywhere, and not requested by any candidate |
| aggregate read models | present where the domain publishes one (`LearningHistoryView`, `CareerSummaryView`, `BenchStrengthView`, `AssetClearanceView`) |

**3. Two modules are as ready as Performance was, and their screens are worse than Performance's
was.** Learning: 16/16 views, 4 detail reads, 0 detail routes, 13 `items[0]`. Career: 19/19 views, 6
detail reads, 0 detail routes, 5 `items[0]`. Composition has not run out.

**Munaxa Work is not approaching the point where a platform capability should precede further
vertical slices.** It is approaching the point where the *admin* surface is finished and the next
surface is gated on a deployment decision.

---

## Q. MenaITech / MenaME benchmark

**Weaker evidence than the rest of this document, and marked as such** — no MenaITech or MenaME
source material was read. What follows measures Munaxa Work against the capabilities a mature
enterprise HR platform in this market is expected to demonstrate, using the repository as the
evidence for what Munaxa has.

### Already credible

| Capability | Why |
| --- | --- |
| HR administration | Employee Record with cross-module composition; 28 routes |
| Recruitment | requisition → vacancy → pipeline → application, with detail routes |
| Attendance | days, punches including superseded ones, exceptions with the domain's own verdicts |
| Leave | requests, balances, and a ledger that makes a balance explainable |
| Payroll | runs, results, payslips, reconciliation, accounting output |
| Performance | cycles, goals, reviews, calibration, nine-box, with two detail routes |
| Workflows | a real approval engine — definitions, versions, branches, delegation, service levels, escalation |

### Partially credible

| Capability | Gap |
| --- | --- |
| Learning | full backend, one crowded screen, no detail route, no compliance workflow surfaced |
| Documents | 5 GET routes, 4 consumed, but **no storage adapter exists** — references only, never bytes |
| Assets / custody | inventory and clearance published; custody itself unexported |
| Employee relations | complete domain, 7 of 10 reads untypeable, no screen |

### Clearly missing, and why

| Capability | Missing because |
| --- | --- |
| **Employee self-service** | **backend architecture defers it** — Platform's authentication adapter is out of this repository by ADR-0001/ADR-0032 |
| **Manager self-service** | same blocker, plus four of six modules publish no manager filter |
| **Reporting / analytics** | **not implemented** — no reporting module, no aggregate endpoint, and no candidate in this document asks for one |
| **Offboarding / clearance** | **not implemented** — no domain exists (§C.2) |
| Notifications | **intentionally deferred** — "Notification intent is recorded. Nothing in this product delivers it." |
| Scheduled execution | **intentionally deferred** — "Nothing opens or closes on a schedule." |

**The distinction §15 asks for matters most on self-service:** it is missing because of an
architectural decision, not because nobody built it, and no amount of product work in this
repository changes that.

---

## R. Horilla reference

Read from a clone. **Nothing was copied — no code, schema, architecture, permissions, module
boundaries or UI.**

### What Horilla has that Munaxa Work does not

**An `offboarding` app, with ten models:** `Offboarding`, `OffboardingStage`,
`OffboardingStageMultipleFile`, `OffboardingEmployee`, `ResignationLetter`, `OffboardingTask`,
`EmployeeTask`, `ExitReason`, `OffboardingNote`, `OffboardingGeneralSetting` — plus a dashboard with
task, **asset** and feedback tables.

That is the honest measure of §C.2's Class C: Munaxa Work would need a domain of roughly that scale,
and Assets' clearance read would be one input to it rather than the whole of it.

**Per-module employee dashboards.** `leave/views.py:employee_dashboard`,
`asset/views.py:asset_dashboard_requests`, `employee/views.py:employee_profile`, `self_info_update`,
`update_own_profile_image`. Self-service is not one screen in Horilla; it is a surface each module
grows. That is a useful shape to know — and it is the shape §D says Munaxa cannot yet build.

**`AssetRequest`** — an employee asking for an asset. A self-service surface, blocked here for
reasons that have nothing to do with assets.

### What Munaxa Work has that Horilla does not

`AssetClearanceView` — a bounded cross-module answer published specifically so another module can
consume it without reading Assets' tables. Horilla's offboarding reads the asset tables directly.

**These are different products making different bets. Neither list is a gap list for the other**, and
nothing here recommends adding a feature because Horilla has one.

---

## S. Candidate classification

| Candidate | Class | Why |
| --- | --- | --- |
| **Learning as Work** | **A** | 11 GET / 10 consumed, 16 of 16 views exported, 4 detail reads, 0 detail routes, per-employment history view with five published counters |
| **Career as Work** | **A** | 13 GET / 13 consumed, 19 of 19 exported, 6 detail reads, 0 detail routes, per-employment summary already on the Employee Record |
| Product coherence pass | **A** | naming, empty states, identifiers — no endpoint, contract or component |
| `notFound()` status fix | **A** | one behaviour, ten routes, no customer-visible symptom |
| Assets / Custody as Work | **B** | 3 of 7 reads untypeable; AD-006 already anticipates publishing custody |
| Relations as Work | **B** | 7 of 10 reads untypeable; a governance decision, not a clerical one |
| Identity member register | **C** | reads exist and are typeable, but access administration is Platform's boundary |
| **Clearance / Offboarding as Work** | **C** | no domain exists; would require an aggregate Assets deliberately refuses to imply |
| Reporting / analytics | **C** | nothing in the product produces an aggregate beyond per-record views |
| Organization as Work | **C (as a slice)** | technically unblocked, but configuration rather than work; better as an Employee Record enhancement |
| Self-Service / My Work | **D** | one missing link — Platform's authentication adapter, permanently outside this repository |
| Manager Workspace | **D** | same blocker, and four of six modules publish no manager filter |

---

## T. Ranked opportunities

### 1. Learning as Work — Class A

| | |
| --- | --- |
| User | HR administrator, compliance owner |
| Workflow | what training is mandatory → who owes it → who is overdue → one person's record → one course |
| Customer value | **high** — compliance training is the Learning question a customer asks first |
| Commercial importance | **high** — a headline enterprise-HR capability (§Q) |
| GET routes | 11, of which 10 consumed |
| Contracts | 16 of 16 exported |
| Permissions | 24 declared, 2 unreferenced (both `-own`) |
| UI readiness | worst screen in the product: 13 `items[0]`, 22 `short()`, 9 browser counters, a `lifecycle.ts` |
| Dependencies | Employment (one bounded read for a name), as Attendance and Performance already do |
| Authentication | none beyond what every slice needs |
| New backend work | **none** |
| Risk | **low** — identical in shape to slice #7 |
| Product impact | closes the worst empty state (461 words, 14 "Nothing to show.") and removes 22 of the 81 remaining truncated identifiers |

**Why #1.** It is the only candidate that is simultaneously the most product-ready, the most
commercially expected, and the worst-rendered surface in the product. Slice #7 proved the pattern on
a module with the same profile.

### 2. Career as Work — Class A

Same completeness, second-worst screen (5 `items[0]`, 20 `short()`, 16 sections, 686-word empty
state), six detail-capable reads. Ranked second only because succession planning is a more
specialised buyer conversation than compliance training. Doing #1 and #2 together would remove **42
of the 81** remaining truncated identifiers and **two of the three** worst empty states.

### 3. Product coherence pass — Class A

`/workflow`'s 1,117-word empty state, the two screens both titled "Approvals", the five
navigation/heading disagreements, and the remaining `short()` sites on Approvals and the Employee
Record. Smaller than a slice. **Ranked below #1 and #2 because doing them shrinks it substantially**
— what is left afterwards is Workflow, Approvals and the Employee Record, which is a coherent
half-day rather than a sprawl.

### 4. Assets / Custody as Work — Class B

Conditional on publishing `CustodyView`, `CustodyPageView`, `CustodySummaryView` and
`AssetCustodyView`. The decision is narrow and AD-006 already anticipates it. If taken, this becomes
Class A and moves above #3.

### 5. `notFound()` status fix — Class A, low value

Ten routes, one behaviour, no customer-visible symptom (§L). Cheap; blocks nothing.

### 6. Relations as Work — Class B

Largest unconsumed surface (10 GET, 0 consumed, no screen), gated behind the widest contract
decision in the product. Should be taken on its own merits, not because a screen wants it.

### 7. Organization — Class C as a slice

Better as an Employee Record enhancement than a slice of its own.

### 8. Identity member register — Class C

Buildable, but access administration is a boundary this product deliberately does not own.

### 9. Clearance / Offboarding — Class C

Commercially important, needs a new domain of roughly ten models (§R). The most valuable thing on
this list that cannot honestly be composed.

### 10. Contract export investigation — not worth a dedicated task

The inventory is complete (§K). What remains is two owner decisions of very different weight, which
should be taken separately rather than bundled.

### 11. Authorization investigation — not the next task

No defect (§M). The generalisable fix is a testing change best done alongside whichever slice next
touches permissions.

### 12. Identifier consistency investigation — not a standalone task

42 of 81 sites disappear as a by-product of #1 and #2 (§N).

### Not ranked: Self-Service, Manager Workspace

Blocked outside this repository. Neither should be worked around, and §D explains why working around
them is now *more* tempting and no more correct than before.

---

## U. Strategic recommendation

> **A. Continue with another product slice — Learning as Work as Product Slice #8.**

Three findings decide it.

**The platform bottleneck is not Munaxa's to clear.** §D establishes that self-service is one
adapter away, that three of its four links exist and are exercised in production code, and that the
missing one is permanently outside this repository. There is no small platform capability to build
first, so option **B is not available** — and that is a materially different conclusion from "the
architecture is not ready", which is what the previous investigation implied.

**Composition has not run out.** Two modules are exactly as ready as Performance was, with more
detail-capable reads and worse screens. Option **A is available on evidence, not on habit.**

**The best slice and the worst coherence defect are the same screen.** `/learning` has the most
`items[0]` sections, the most browser-side counting, the second-most truncated identifiers and the
second-worst empty state in the product. Doing the slice fixes the coherence problem as a
by-product, which is why option **C should follow #1 and #2 rather than precede them.**

Options D and E are blocked. Option F — a reporting capability — is real but no candidate needs it,
and inventing one would be the speculative backend expansion the product-development model exists to
prevent.

---

## V. Definition of Ready — Learning as Work

**This is not an authorization and no work was started.** Stated so the owner can authorize or reject.

**Workflow.** What training is required and who owes it → who is overdue → one employment's learning
record → one course or one path.

**Reads it would use — all existing, all exported, none new.**
`GET /learning/mandatory-rules`, `/assignments`, `/enrolments`, `/courses`, **`/courses/:courseId`**,
`/paths`, **`/paths/:pathId`**, `/instructors`, **`/certifications`** *(currently unconsumed)*,
**`/enrolments/:enrolmentId/assessment-results`**, **`/history/:employmentId`** *(consumed today only
by the Employee Record)*.

**Routes it would add to the admin app.** `/learning/records/[employmentId]`,
`/learning/courses/[courseId]`, `/learning/paths/[pathId]` — each with `loading.tsx` and
`not-found.tsx`. ADR-0075 already accepts `[name]` segments.

**Existing contracts.** `LearningHistoryView`, `AssignmentView`, `EnrolmentView`,
`CertificationView`, `CourseView`, `CourseVersionView`, `PathView`, `PathDetailView`,
`MandatoryRuleView`, `AssessmentView`, `AssessmentResultView`, `InstructorView`,
`ReconciliationView` — 16 of 16 exported.

**Existing permissions.** 24 declared; the slice uses only the read permissions that already gate
these routes. None added, removed or weakened. The two unreferenced `-own` permissions stay
unreferenced.

**States.** loading / not-found / refused / empty / populated / withheld-per-read, with each refused
read naming the permission it needed — the language slices #5, #6 and #7 established.

**Localization.** Learning's own catalogue, merged with the portal's; nested keys only; both
languages; parity asserted.

**RTL.** Every Latin run isolated; `<bdi dir="ltr">` for percentages and any signed figure; one
isolate for each `shown / total` ratio.

**Mobile.** 1440 px and 390 px, no page-level horizontal scroll, tables scrolling inside their own
containers.

**Tests.** Routing, data (no `items[0]`, server totals, no browser calculation), states, localization,
RTL, security (no write, no identity named), mobile.

**What it must not do.** Not compute `openAssignments`, `overdueAssignments`, `completedCourses`,
`activeCertifications` or `expiringCertifications` — **`LearningHistoryView` publishes all five.**
Not compute a completion percentage or a compliance rate. Not send an identity. Not create `/me`. Not
add a permission, contract, migration, table, endpoint or event. Not offer a control.

**Out of scope.** Career (its own slice), Assets, Relations, Organization, the `notFound()` status,
the identifier residue on Approvals and the Employee Record.

**Known blockers.** None. **Open question for the owner:** Learning declares
`learning.assignment.read-own` and `learning.certification.read-own`, both unreferenced. Like the
other eleven employment-subject `-own` permissions they are deferred self-service, and a slice
should not decide their fate.

---

## W. Separate investigations

These should remain independent and are **not** folded into any slice:

1. **Assets custody contract publication** — four views; narrow; AD-006 already anticipates it.
2. **Relations contract publication** — eight views; a governance decision about disciplinary records.
3. **`PerformanceSummaryView` and `performance.summary.read`** — an exported view and a declared
   permission with no handler and no route; owner decision.
4. **`notFound()` HTTP status** — ten routes, one shared behaviour.
5. **Bidirectional permission assertion** — promote Assets' test into the shared testing package.
6. **Identifier residue on Approvals and the Employee Record** — after slices #8 and #9 remove 42 of
   81 sites.
7. **Export routes and export permissions** — two routes exist, three permissions gate nothing.
8. **Section-heading vocabulary** — the boundary footnote appears under seven headings, two of them
   the single word "Status".

---

## X. Verification

`pnpm verify` — `standards && format:check && lint && typecheck && test && build` — run with
PostgreSQL 16 live and `TEST_DATABASE_URL` set. **Exit code 0.**

### Migrations verified

| Check | Result |
| --- | --- |
| Migrations on disk | 31 |
| Applied and finished in the database | 31 |
| Rolled back | 0 |
| `prisma migrate status` | *31 migrations found… Database schema is up to date!* |
| `prisma validate` | *The schema at ../../prisma/schema.prisma is valid* |

### That this was a run and not a cache replay

`.turbo/cache` and `node_modules/.cache/turbo` were deleted before the command started.

| Stage | Tasks | Cached | Wall clock |
| --- | ---: | ---: | ---: |
| `lint` | 51 | **0** | 1m47.8s |
| `typecheck` | 51 | 22 | 22.8s |
| `test` | 51 | 22 | **7m6.2s** |
| `build` | 29 | 22 | 1m0.5s |

`standards` and `format:check` are plain node and prettier invocations and emit no turbo summary;
both ran and both passed. The "22 cached" entries are **this same run's own outputs** — a stage's 51
tasks include the dependency `build` tasks an earlier stage in this run already executed.

Checked task by task rather than inferred from the summary: **29 `test` tasks executed, 29 cache
misses, 0 cache hits.**

### Actual counts

| | |
| --- | --- |
| Packages running `test` | 29 |
| Packages with test files | 24 |
| **Test files** | **462 passed (462)** |
| **Tests** | **5,306 passed (5,306)** |
| Failed | 0 |
| Skipped | 0 — the string `skipped` appears zero times in the whole log |

`@work/api` 88 files / 827 tests. `@work/admin` 54 files / 705 tests. Both integration-heavy suites
executed against the live database with real per-file timings.

Identical to the slice #7 gate, as expected: **this turn changed no code.** The only file added is
this document.

---

## Y. Git

GIT_PLACEHOLDER
