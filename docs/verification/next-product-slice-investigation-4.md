# Next Product Slice Investigation

Which workflow should be Product Slice #8. Measured from `main` at `8e08c7b`, not from earlier
investigation documents — several of their figures turned out to be stale, and each correction is
noted where it matters.

Nothing was implemented. The only file this task adds is this one.

---

## A. Current product state

`main` at `8e08c7b`, working tree clean, `@munaxa/platform` **1.6.1** from the registry, parity
guard enforced and passing.

| Measure | Count |
| --- | ---: |
| Admin routes (`page.tsx`) | **28** |
| Detail routes (parameterised) | **11** |
| Routes with `loading.tsx` | 17 |
| Routes with `not-found.tsx` | 10 |
| Routes with `error.tsx` | 0 |
| Business modules | **18** |
| Published GET routes | **187** |
| Declared permission constants | **285** |

**Correction to the earlier count.** Previous documents recorded "28 routes, 10 of them detail".
There are **11** detail routes: `/attendance/days/[employmentId]/[attendanceDate]` was missed. The
route totals are otherwise unchanged.

The eleventh detail route is also the one without a `not-found.tsx`:
`/leave/balances/[employmentId]`, which does not call `notFound()` — a balance for an unknown
employment is an empty balance, not a missing page. That reads as deliberate.

**Composition depth by admin area**, non-test source lines and test files:

| Area | Lines | Tests | |
| --- | ---: | ---: | --- |
| performance | 3,172 | 7 | slice |
| leave | 2,778 | 5 | slice |
| workflow | 2,423 | 11 | **pre-slice** |
| recruitment | 2,365 | 4 | slice |
| payroll | 2,352 | 5 | slice |
| attendance | 2,347 | 5 | slice |
| employment | 2,037 | 4 | slice |
| learning | 2,023 | 3 | **pre-slice** |
| career | 1,995 | 4 | **pre-slice** |
| approvals | 1,344 | 4 | slice |
| compensation | 779 | 0 | **pre-slice** |
| documents | 580 | 0 | **pre-slice** |
| letters | 516 | 0 | **pre-slice** |
| organization | 335 | 0 | **pre-slice** |
| onboarding | 313 | 0 | **pre-slice** |
| people | 247 | 0 | **pre-slice** |

Every slice area sits between 1,300 and 3,200 lines with 4–7 test files. Every pre-slice area is
either thin (247–779 lines, **zero tests**) or deep but built to the older phase-era idioms
(career, learning, workflow).

**Three modules have no product surface at all**: `assets`, `relations`, `identity`.

---

## B. What the seven slices established

Employee Record, Approvals, Hiring, Payroll, Leave, Attendance and Performance cover the employee
lifecycle end to end: a person is hired, recorded, scheduled, paid, absent, appraised, and every
decision waiting on somebody is queued. They also established the idioms the product is now judged
by — refused ≠ empty ≠ not-found ≠ withheld per read, server totals never `items.length`, nothing
computed in the UI, no arbitrary `items[0]`, identifiers rendered whole, every Latin run isolated in
Arabic.

Measured adoption of those idioms:

- **`PageHeader` in 18 of 28 routes.** The 10 without it are exactly `/`, `/career`,
  `/compensation`, `/documents`, `/learning`, `/letters`, `/onboarding`, `/organization`, `/people`,
  `/workflow` — the pre-slice set, with nothing in between.
- **`reference()`** — the whole-identifier renderer — appears in five areas only: performance,
  leave, payroll, attendance, recruitment. Not in approvals or employment, and in no pre-slice
  screen.

So **more than a third of the Admin surface still reads as pre-slice product**. That matters to the
strategy question in §L.

---

## C. Candidate inventory

Every candidate that has a real backend in this repository. Nothing invented.

| Candidate | GET reads | Permissions | Locale keys (en/ar) | Module tests | Admin surface today |
| --- | ---: | ---: | ---: | ---: | --- |
| **Assets & Custody** | 7 | 7 | 90 / 90 | 18 | **none** (read by the Employee Record) |
| **Relations** | 10 | 9 | 169 / 169 | 20 | **none** (read by the Employee Record) |
| Self-Service | (identity 4) | 11 `read-own` | — | — | portals are 3 files, 116 lines |
| Manager Workspace | reuses others | — | — | — | none |
| Organization | 12 | — | — | — | 335 lines, 0 tests, pre-slice |

Self-Service and Manager Workspace are not modules; they are audiences. They are assessed on
whether the product can identify *who is asking*.

---

## D. Candidate readiness

| Candidate | Class | Why |
| --- | --- | --- |
| **Assets & Custody** | **B** | Everything published; needs **4 export lines**, and all four types already sit in `contracts/` |
| Relations | **B** | Everything published; needs **8 export lines**, also already in `contracts/` |
| Organization lookups | **B** | Two bounded reads that do not exist; a dependency, not a slice |
| Self-Service | **D** | Blocked by a capability this repository must not contain |
| Manager Workspace | **D** | Same blocker, plus team-scoped reads that do not exist |

---

## E. Self-Service — the exact blocker

The brief asked not to answer this with "`/me` does not exist". It is not the answer. The chain is
**built and exercised**; one link is empty by design.

| Link | Status |
| --- | --- |
| 1. credentials → principal | `PlatformAuthenticationPort` — **only `UnauthenticatedPort` exists in this repository** |
| 2. principal → membership | `resolveForPrincipal` + `PostgresMembershipDirectory`, wired in `apps/api/src/identity/identity.module.ts` — **real** |
| 3. membership → request context | `TenantContext.membershipId`, read by `currentMembershipId()` — **real** |
| 4. membership → employment | query `identity.primary-employment-for-membership` — **real, and Workflow already consumes it** (`apps/api/src/workflow/workflow-reporting-line.ts`) |

`tenant.middleware.ts` runs the whole sequence on every request: authenticate, resolve a membership,
stamp `tenantId`, `actor`, `userId`, `membershipId` onto the context.

Link 1 is the blocker, and the kernel states plainly why it will stay that way:

> The default, and **the only implementation this repository will ever contain**: it authenticates
> nobody. A product that must not implement authentication has exactly one safe default… Every
> deployment supplies Platform's adapter; a deployment that forgets serves 401 to every request.

That is ADR-0001. Munaxa Work never verifies a credential. So this is **not** an unconsumed read and
**not** architectural debt — the architecture is finished and correct. It is a **deployment
capability that belongs to Platform**, exactly like the `read:packages` credential in the previous
task: real, external, and not solvable inside this repository.

**The same blocker explains a finding elsewhere.** Eleven modules declare a `read-own` permission —
`attendance.read-own`, `leave.read-own`, `payroll.read-own`, `performance.review.read-own`,
`compensation.read-own`, `document.read-own`, `workflow.approval.read-own`, two in `career`, two in
`learning` — and **none is enforced**. The Assets module records why, in its own permissions file:

> There is deliberately no `assets.read-own`. **Ten modules declare a `read-own` and none enforces
> one**, because ADR-0032 resolves a principal to a tenant membership rather than to an employment.
> Declaring an eleventh that also resolves to nothing would add a grant that looks like
> self-service.

So the eleven unenforceable grants and the empty portals are one fact, not two.

**The smallest honest self-service workflow** is still not small: with a Platform adapter supplying
principals, `identity.primary-employment-for-membership` would give the portal its subject, and the
existing per-employment reads (`?employmentId=`) would furnish leave balance, attendance days,
payslips and reviews. Nothing new would be needed in the domain — but the eleven `read-own` grants
would have to become enforceable, which is an authorization change across eleven completed modules.
**Class D**, and its first step is an owner/deployment decision, not code.

---

## F. Manager Workspace — separately assessed, and further away

It carries the whole of §E's blocker (a manager must be identified before their team can be), and
then a second one the brief was right to insist on measuring rather than assuming.

**Which list reads accept which filters**, extracted from every controller:

| Module | Accepts `managerEmploymentId` | Accepts `employmentId` |
| --- | --- | --- |
| employment | **yes** | — (`personId`, `unitId`, `positionId`) |
| performance | **yes** | yes |
| attendance | no | yes |
| leave | no | yes |
| career, learning, letters | no | yes |
| workflow | no | no (`subjectId` / `subjectType`) |
| compensation | no | `employmentIds` (plural) |
| recruitment, organization, people | no | no |

So a manager workspace could compose **team roster** and **team performance** from existing
manager-scoped reads — and both modules were written with this in mind, `goal.controller.ts` noting
that *"`managerEmploymentId` on the search is a filter, not a credential"*.

But **team leave, team attendance and team approvals have no team-scoped read at all**. They would
have to be N+1 fan-outs, one request per direct report, or new query parameters added to three
completed modules. The first is a product that degrades with team size; the second is domain work
inside finished slices, which this investigation is forbidden to propose and the seven-slice
settlement is meant to protect.

There is also no "who reports to me" read. `/employments/:employmentId/reporting-lines` is the
*history of a person's own manager*, not the inverse. The inverse is expressible only as
`/employments?managerEmploymentId=…`, which is a search, not a team.

**Class D.** Strictly further from ready than Self-Service, and it should not be attempted first.

---

## G. Assets & Custody — the readiest candidate

Seven published reads, and they compose into a workflow without a single new endpoint:

```text
/assets                      the inventory, paged
/assets/:assetId             one asset
/assets/:assetId/custody     that asset's custody chain — who has held it
/assets/categories           the catalogue
/assets/custody              the custody register
/assets/custody/clearance    what one employment still holds        ← already consumed
/assets/custody/summary      the register's own totals
```

| Readiness | |
| --- | --- |
| Permissions | 7, per resource *and* per capability: `asset.read/manage`, `category.read/manage`, `custody.read/assign/return` |
| Localization | **90 keys in English and 90 in Arabic** — complete, both languages |
| Module tests | **18 test files** |
| Contracts exported | 6 of 10 view types |
| Cross-module link | **already live** — as is Relations' |
| Admin surface | **none** |

**It is already connected to a completed slice.** The Employee Record consumes
`/assets/custody/clearance?employmentId=…`, imports `AssetClearanceView` from
`@work/assets/contracts`, and pulls Assets' own `en.json`/`ar.json` into
`apps/admin/src/employment/record-locale.ts`. Slice #8 would not be starting an island; it would be
opening the other end of a link the Employee Record already renders.

**The one gap, and it is four lines.** Four view types are defined in
`packages/modules/assets/src/contracts/views.ts` but not re-exported from `contracts/index.ts`:

```text
AssetCustodyView   CustodyPageView   CustodySummaryView   CustodyView
```

`/assets/custody`, `/assets/:assetId/custody` and `/assets/custody/summary` all return types a
consumer cannot import. They are already *in* the contracts directory — the fix is re-export, not
relocation, and additive.

That makes Assets **Class B**, and it is the smallest Class B on offer.

The module's composition file also reads as a module that expects a consumer: it wires an employment
directory under a bounded grant, uses the shared `systemClock`, and explicitly declines an approval
port, a job port and a permission checker because nothing in it needs them. AD-006 names offboarding
clearance as the consumer that will read custody through public contracts.

---

## H. Organization — a dependency, not a slice

Twelve published reads, but the two a screen actually needs are the two that do not exist.

Organization publishes `units` (list), `positions` (list), `hierarchy`, `legal-entities`,
`unit-types`, `standard-unit-types`, `tenant-settings`, `export`, and four **sub-resources** of a
unit: `:unitId/ancestry`, `:unitId/establishment`, `:unitId/governing-legal-entity`,
`:unitId/placements`.

**There is no `GET /organization/units/:unitId` and no `GET /organization/positions/:positionId`.**
Ancestry, which an earlier investigation recorded as missing, does exist. The single-entity lookup
does not.

This matters because Employment's own contract says so explicitly:

> **Organizational references are identifiers, never names.** `unitId`, not `unitName`. **A name is
> `organization`'s to resolve** and changes when a department is renamed; a copy here would be a
> second answer that is stale from the first rename.

`EmploymentView` carries `unitId` and `positionId?`. The architecture intends Organization to
resolve them and Organization has not published the read. A screen wanting a department name today
must fetch the whole `units` list and match — which collides directly with the "no arbitrary
`items[0]`, server totals never `items.length`" idioms the slices established.

**This is a contract gap two bounded reads wide, not a generic resolver problem** — and emphatically
not a reason to build a lookup service. Classification: **Class B dependency**, not a product slice.
It would make several future slices cleaner; it is not itself a customer workflow.

---

## I. Relations — ready, but is it the work customers ask for first?

Ten published reads and a genuinely complete module:

```text
/relations/violations                          /relations/investigations
/relations/violations/:violationId             /relations/investigations/:investigationId
/relations/violations/escalation               /relations/investigations/:violationId/history
/relations/categories                          /relations/cases/:violationId/action
/relations/disciplinary-rules                  /relations/cases/:violationId/applicable-action
```

Nine permissions, **169 locale keys in both languages**, **20 test files** — the most tested
unsurfaced module in the repository. Two natural detail routes (a violation, an investigation) and a
history chain. Technically this is as ready as Assets.

**Relations is also already wired into the Employee Record**, in the *same section* as Assets.
`record-api.ts` reads `/relations/violations?employmentId=…`, `record-governance.tsx` renders
violations beside asset custody, and that file's own comment names them together:

> The two modules that had complete backends and no screen at all until this record existed:
> employee relations and asset custody.

On raw readiness Relations is the **richer** module of the two: 10 reads against 7, 20 test files
against 18, 169 localized keys in each language against 90, and two natural detail routes plus a
history chain. Anyone ranking these on backend depth alone should pick Relations.

Three things put it behind, and none of them is readiness:

- **Eight unexported view types against four** — `ApplicableActionView`, `CaseEventView`,
  `CaseHistoryView`, `DisciplinaryActionView`, `DisciplinaryRuleView`, `EscalationContextView`,
  `InvestigationPageView`, `InvestigationView`. Same kind of fix, twice the surface.
- **Frequency.** Every customer issues laptops, phones, SIM cards and vehicles, and every customer
  has lost track of some. Disciplinary cases are episodic — real work, but not weekly work for most
  of the buyer's staff.
- **No second named consumer.** AD-006 names offboarding clearance as a consumer that will read
  custody through public contracts, so Assets sits on the critical path of a lifecycle event the
  product will need. Relations has no equivalent downstream claim recorded.

**Class B, and a close second — closer than the recommendation may make it look.** If the owner
weights backend depth and per-screen richness above frequency, Relations is the defensible
alternative, and §P records that as a live decision.

---

## J. Infrastructure findings — real, and none of them Slice #8

Kept deliberately apart from the product question. Each is measured; none is fixed.

**1. Contract exports — 46 view types unreachable from `contracts/index.ts`, across 9 modules.**
Two distinct sub-patterns:

| Sub-pattern | Count | Modules |
| --- | ---: | --- |
| Defined in `contracts/`, not re-exported | **14** | assets 4, relations 8, workflow 2 |
| Defined in `application/`, never promoted | **32** | compensation 13, leave 13, attendance 3, career 1, onboarding 1, recruitment 1 |

The first is a one-line additive fix per type. The second is a relocation and a bigger decision.

**Correction to the earlier finding.** It cited `documents` and `letters` as affected; both use
`export * from './views.js'` and have **no** gap. It also named `ExpectedWorkingDaysView` and
`BalanceAsOfView`, which are real — they are in the `application/` class. `AttendanceExport` does not
exist under that name.

**2. Authorization — 22 of 285 permission constants are declared but never referenced (92%
enforced).** Not a sweep-sized problem, and it splits cleanly:

- **Eleven `read-own` grants**, unenforceable by ADR-0032 and documented in-repo as deliberate (§E).
- **Eleven capability grants** whose read is folded into a parent — `employment.contract.read`,
  `employment.reporting-line.read`, `employment.assignment.read`, `compensation.export`,
  `identity.user.read`, `identity.user.manage`, `identity.portal.read`, `identity.preference.read`
  and three others.

The first group is a governance decision already taken. The second is worth an owner's eye, but
these are grants nobody can hold *over anything* — the failure mode is a grant that means nothing,
not a read that escapes its check. **Not a security defect; an ownership question.**

**3. `notFound()` returns HTTP 200 — measured, all 11 detail routes.** Against an API answering 404:

```text
/employment/[id]                    200        /performance/reviews/[id]      200
/approvals/[id]                     200        /performance/goals/[id]        200
/leave/requests/[id]                200        /recruitment/requisitions/[id] 200
/leave/balances/[id]                200        /recruitment/applications/[id] 200
/payroll/runs/[id]                  200        /attendance/days/[id]/[date]   200
/payroll/results/[id]               200
/no-such-route                      404   ← routing 404 works correctly
```

The not-found *UI* renders correctly every time; only the status is wrong. The response streams —
the shell and `<title>Employee record · Munaxa Work</title>` flush before the page's `await`
resolves, so the status is committed before `notFound()` runs.

This is **shared infrastructure touching six of the seven slices**. It is a real defect for anything
reading status rather than pixels — a crawler, a monitor, a cache. It does **not** block any
candidate in this document, because a new slice would inherit the same behaviour as the existing
ten and be no worse.

**4. Product coherence — 10 of 28 routes are pre-slice.** §B. Six of them have zero tests.

---

## K. Commercial workflow analysis

The product map after seven slices:

```text
Employee lifecycle
        │
        ├── Hiring          ✅ requisition → application, opened
        ├── Employee Record ✅ one person, across modules
        ├── Attendance      ✅ a day, its punches, the domain's verdicts
        ├── Leave           ✅ a balance explained from a published ledger
        ├── Payroll         ✅ a run and a payslip, explainable
        ├── Performance     ✅ a review and a goal, opened by identifier
        └── Approvals       ✅ the queue of decisions waiting on somebody
```

What a customer still cannot do, ranked by how often they need it:

1. **Know what an employee physically holds, and get it back when they leave.** Every customer
   issues equipment. Every customer loses track of it. The Employee Record already shows clearance
   blockers — and there is no screen anywhere to see the asset, its history, or the register those
   blockers come from. It is also on the path to offboarding, which AD-006 already names.
2. **Let employees see their own record.** Universally expected, structurally blocked (§E).
3. **Let managers act on their team.** Expected in mid-market, further blocked (§F).
4. **Run a disciplinary case to a documented outcome.** Real, episodic, sensitive (§I).

**Five-minute demo test:**

| Candidate | Demo |
| --- | --- |
| Assets & Custody | *"Here is every laptop. Here is this one, and everyone who has held it. Here is what Layla still holds, and here is why her clearance is blocked."* — ends inside a screen that already exists |
| Relations | *"Here is a violation, its investigation, the rule it breaches and the action that applies."* — equally coherent, and it also starts from the Employee Record. Harder to show a stranger: a disciplinary case demo needs invented misconduct against a named person |
| Self-Service | Cannot be demonstrated. Every request is 401 |
| Manager Workspace | Roster and performance only; leave and attendance would be visibly missing |

**Scoring** — High / Medium / Low, no manufactured numbers:

| Candidate | Customer value | Commercial value | Backend readiness | Workflow completeness | Dependency risk | Demo value |
| --- | --- | --- | --- | --- | --- | --- |
| **Assets & Custody** | **High** | **High** | **High** | **High** | **Low** | **High** |
| Relations | Medium | Medium | High | High | Low | Medium |
| Organization lookups | Low (direct) | Low | Medium | Low | Low | Low |
| Self-Service | High | High | Medium | Low | **High** | **Low** |
| Manager Workspace | High | High | Low | Low | **High** | Low |
| Coherence pass | Medium | Medium | n/a | n/a | Low | Medium |

**On Payroll and a separate payment product.** Payroll is already a Work domain with 17 published
reads and a shipped slice covering a run and a payslip. Nothing measured here says a separate
payment architecture is needed, and creating one would fragment a domain the product already owns.
No payroll capability gap was found that materially affects commercial completeness.

**External benchmarks.** No external code was read or copied. As a capability benchmark only, asset
custody and offboarding clearance are standard in the mid-market HR suites this product competes
with, and their absence is more conspicuous than disciplinary case management — which is a
consistency check on the ranking above, not its basis. The ranking is built from repository
evidence.

---

## L. Strategy comparison

| Strategy | Verdict |
| --- | --- |
| **A. Expand the Admin workspace** | **Recommended.** The only audience the product can currently serve, and the one with the readiest unbuilt workflow |
| B. Employee Self-Service | Blocked at link 1 of a four-link chain that is otherwise complete. A deployment decision, not a build |
| C. Manager Workspace | Blocked by B, plus three modules with no team-scoped read |
| D. Build shared infrastructure for B/C first | **Cannot be done here.** The missing capability is Platform's authentication adapter, which ADR-0001 forbids this repository from containing. There is no infrastructure to build |
| E. Another high-value Admin workflow | This *is* A, and Assets is the candidate |

**Strategy D deserves its explicit refusal.** It is the intuitive answer — *build the foundation
first* — and it is wrong here, because the foundation is already built. Links 2, 3 and 4 exist, are
wired, and are exercised in production code paths by Workflow. What is missing cannot be written in
this repository at all. Choosing D would mean either waiting on an external decision or
implementing authentication in a product that must not have it.

**The honest competitor to Assets is not another module — it is the coherence pass.** Ten of 28
routes still read as pre-slice, six with no tests at all. Making the whole product read as one
product may well be worth more to a prospect than an eighth workflow. It is excluded here for one
reason: the brief asks which *workflow* comes next, and a coherence pass adds none. **The sequencing
of the two is a genuine owner decision (§P).**

---

## M. Recommended Slice #8

**Assets & Custody.**

Everything it needs is published: seven reads, seven permissions, ninety localized keys in both
languages, eighteen module test files. It composes a complete workflow — inventory, one asset, that
asset's custody chain, the register, and what one employment still holds — with **no new endpoint,
no new permission, no migration and no domain change**. It costs four re-export lines, and all four
types already sit in the contracts directory.

It finishes something rather than starting something: the Employee Record already renders clearance
blockers from Assets and already loads Assets' Arabic catalogue, so Slice #8 opens the other end of
a link the product ships today.

**Relations is a genuinely close second**, and on backend depth it is ahead — more reads, more
tests, more localization (§I). Assets is recommended over it on three grounds that are commercial
rather than technical: half the export gap, a workflow every customer performs constantly rather
than episodically, and a second consumer already named in AD-006. A reasonable owner could choose
Relations instead, and §P records that.

---

## N. Definition of Ready

Before implementation begins, all of these must be true:

1. **The four exports land first, in their own change.** `AssetCustodyView`, `CustodyPageView`,
   `CustodySummaryView` and `CustodyView` re-exported from
   `packages/modules/assets/src/contracts/index.ts`. Additive, no behaviour change, its own commit —
   so that if it is wrong, it is wrong on its own.
2. **The owner confirms the slice's boundary**: read-only, GET only, no `ApprovalPort`, no custody
   assignment or return from the UI — matching every slice since #1.
3. **The route shape is agreed**: `/assets`, `/assets/[assetId]`, and whether the custody register
   is a section of `/assets` or its own `/assets/custody`.
4. **The clearance surface is settled** — whether Slice #8 adds a screen for it or leaves it where
   the Employee Record already renders it. It must not be rendered twice.
5. **`notFound()` HTTP semantics are accepted as-is** for the new detail route, on the same terms as
   the existing ten, or fixed for all eleven first as a separate task.
6. **The gate is green on `main` before starting** — it is (§Q).

---

## O. Out of scope

Deliberately excluded, and none of it was done:

- Any implementation whatsoever — no route, page, API, contract, migration, permission, component,
  localization or abstraction.
- The four Assets exports. Named in §N as the first step; **not made here**.
- Self-Service, `/me`, and any change to the authentication port or the eleven `read-own` grants.
- Manager Workspace, direct-reports reads, and team filters in leave, attendance or workflow.
- Organization's two missing lookups, and any generic resolver or lookup service.
- Relations.
- The 46 unexported view types, the 22 unreferenced permissions, the `notFound()` status, identifier
  consistency and the coherence pass.
- The seven completed slices — untouched.
- Platform, `@munaxa/*` versions, the lockfile, CI and the parity guard — untouched.
- No code was read from or copied from Horilla or MenaITech, and neither was treated as an
  architectural authority.

---

## P. Owner decisions

Four, and only these cannot be settled from repository evidence:

1. **Assets & Custody as Slice #8, or Relations instead** — recommendation, not authorization. The
   two are close: Relations has more published reads, more tests and more localization; Assets has
   half the export gap, a more frequent workflow and a second consumer named in AD-006 (§I, §M).
2. **Slice #8 versus a coherence pass first.** Ten of 28 routes are pre-slice, six untested. An
   eighth workflow widens the product; a coherence pass makes the existing seven read as one. Both
   are defensible and the evidence does not decide it.
3. **The Platform authentication adapter.** Until a deployment supplies one, Self-Service and
   Manager Workspace are unreachable and eleven `read-own` grants stay unenforceable. This is
   external to the repository (ADR-0001) and is the single highest-leverage decision on this list —
   it unblocks two whole audiences.
4. **The eleven unreferenced capability grants** (§J.2). Whether they are removed, enforced, or
   documented as intentionally folded into a parent read.

---

## Q. Verification

`pnpm verify` on `main` at `8e08c7b`, `TURBO_FORCE=true` (no cached replay), PostgreSQL 16 live with
31 of 31 migrations applied, parity guard enforced with no override:

| Stage | Result |
| --- | --- |
| standards | 5 gates, no violations — parity all-registry at platform 1.6.1 |
| format:check | clean |
| lint | **51 successful, 51 total**, 0 cached — 2m19.106s |
| typecheck | **51 successful, 51 total**, 0 cached — 51.027s |
| test | **51 successful, 51 total**, 0 cached — 10m10.952s |
| build | **29 successful, 29 total**, 0 cached — 1m44.074s |
| **`pnpm verify`** | **exit 0** |

**462 test files, 5,306 tests, 0 failed, 0 skipped.** No pre-existing failure was found, so none had
to be documented or worked around. No production code was changed to make this pass.

Measurements in this document were taken from source with `git ls-files`-scoped scans, from the
running Admin application built on `main` (the HTTP status table in §J.3), and from the published
controllers rather than from documentation.

---

# PRODUCT SLICE #8 RECOMMENDATION

**Candidate:** Assets & Custody

**Classification:** Class B — composable from existing published contracts, gated on one bounded
export change of four lines.

**Why now:** Everything it needs is published, and it completes a link the product already ships —
the Employee Record reads `/assets/custody/clearance` today, yet there is no screen anywhere for the
asset, its custody chain, or the register those blockers come from. Self-Service and Manager
Workspace are blocked by a capability this repository must not contain; Organization is a dependency
rather than a workflow. **Relations is genuinely comparable and slightly richer**, and is chosen
against only on export gap (4 lines versus 8), on frequency — custody is constant work, discipline
is episodic — and because AD-006 already names offboarding clearance as a second consumer of custody.

**Customer workflow:** See the inventory. Open one asset and read who has held it and who holds it
now. Read the custody register and its server-published totals. Open an employment's clearance and
see exactly what is still outstanding — the same answer the Employee Record shows, now reachable
from the other end.

**Existing backend:** 7 GET reads, 7 permissions (per resource *and* per capability), 90
localization keys in English and 90 in Arabic, 18 module test files, a composition that already
wires a bounded employment directory and the shared clock.

**Existing UI:** No screen of its own. One live consumer: `apps/admin/src/employment/record-api.ts`
reads `/assets/custody/clearance`, `record-governance.tsx` renders it beside Relations' violations,
and `record-locale.ts` imports Assets' own catalogues.

**Missing dependencies:** Four view types defined in `packages/modules/assets/src/contracts/views.ts`
and not re-exported from `contracts/index.ts` — `AssetCustodyView`, `CustodyPageView`,
`CustodySummaryView`, `CustodyView`.

**New backend required:** **None.** No endpoint, no permission, no contract beyond the four
re-exports, no migration, no schema change, no domain change.

**Commercial value:** High. Custody is universal — every customer issues equipment and every customer
loses track of some — and offboarding clearance is named in AD-006 as the consumer that reads custody
through public contracts. It demonstrates in five minutes and finishes inside a screen that already
ships.

**Risks:** Low, and three are named. The four re-exports must land first and separately. The new
detail route inherits the HTTP-200 `notFound()` behaviour of the existing ten — no worse, but not
better. Clearance must not end up rendered in two places.

**Definition of Ready:** §N — exports first as their own change; read-only GET-only boundary
confirmed; route shape agreed; the clearance surface settled; `notFound()` semantics accepted or
fixed for all eleven routes first; gate green on `main`, which it is.

**Explicit owner decisions:** §P — (1) authorize Assets as Slice #8, or Relations in its place; (2) decide Slice #8 versus a
coherence pass first, since 10 of 28 routes are still pre-slice; (3) the Platform authentication
adapter, which alone unblocks Self-Service, Manager Workspace and eleven `read-own` grants; (4) what
becomes of the eleven unreferenced capability grants.

---

# PRODUCT SLICE #8 INVESTIGATION COMPLETE — AWAITING OWNER AUTHORIZATION
