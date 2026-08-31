# Munaxa Work — Next Product Direction Investigation #3 (after Slice #9)

**Investigation only. Nothing was implemented and nothing in the product changed.** No slice, no
platform capability, no route, migration, permission, contract or export. No completed slice was
modified, no authentication was implemented, no `/me` exists, nothing was copied from anywhere.

**A note on this file's name.** The task that commissioned this investigation asked for
`next-product-direction-investigation-2.md`. That file already exists: it is the seven-slice-era
direction investigation (commits `5f30d48` / `7b0ab8e`) whose outcome led to Slice #8, and it is a
historical record this repository has already once damaged and restored in an earlier task.
Following the same resolution used then (investigation #4 was written beside a protected #3 name),
this document is `-3` and the existing `-2` is untouched.

The strategic question, as commissioned:

> After nine slices of administrator-facing operational coverage, is the highest-value next move
> another Admin workflow, or a move toward another audience?

Everything below is measured from source at `b1473c3`.

---

## A. Current product state

**Applications.**

| App | Routes | Detail routes | loading | not-found | Titled | PageHeader |
| --- | --- | --- | --- | --- | --- | --- |
| admin | 32 | 14 | 21 | 13 | 21 | 22 |
| employee-portal | 1 | 0 | 0 | 0 | 0 | 0 |
| manager-portal | 1 | 0 | 0 | 0 | 0 | 0 |

- Every admin route renders real product content; **10 of the 32 are pre-slice screens** in the
  older product language (no `PageHeader`, no route title, card-per-read layout): `/career`,
  `/compensation`, `/documents`, `/learning`, `/letters`, `/onboarding`, `/organization`,
  `/people`, `/workflow`, and the home page. The 22 slice-grade routes all carry `PageHeader`;
  the one gap is `/employment` (has `PageHeader`, lacks a metadata title).
- The two portals are **bootstrap scaffolds**: one page each proving `@munaxa/ui`, `@munaxa/theme`
  and `@munaxa/platform` (1.6.1, registry) resolve and render. No shell, no navigation, no Work
  contract imports, no fetch. Their own copy names their intent — "Employee self-service",
  "Manager self-service".

**Published API surface** (from `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` decorators in module
controllers):

- **187 GET routes** across 18 modules, **73 of them detail reads** (path-parameterised).
- **326 write routes** (285 POST; 41 PUT/PATCH/DELETE concentrated in the eight oldest modules —
  the newer modules are POST-only by convention).
- Employment-scoped reads (an `employmentId` in path or query) exist across **11 modules**;
  Payroll and Workflow publish none, and Performance's scoping is deliberate and separate
  (section E).

**Consumption.** The admin app fetches roughly 130 distinct path shapes spanning **17 of the 18
modules. Identity is the only module no application reads.** As established in investigation #5,
no reliable "percentage of reads consumed" can be computed (path construction differs per area);
that metric stays withdrawn and is not recreated here.

**Scoped-read census, corrected.** 15 `*-own` permissions are declared. Investigation #5 reported
"exactly one attached to a handler"; re-derived from source, that was wrong too:

- `workflow.approval.read-own` guards **two** shipped reads — `workflow.pending-approvals` and
  `workflow.decided-approvals` — both keyed on `currentMembership()` with **no caller-supplied
  identifier at all** ("its absence is the control").
- `onboarding.task.complete-own` guards one query and one command (own-task self-completion).
- The remaining **13 are declared over nothing**. Learning's and Career's authorization files say
  so in as many words: *"`read-own` … is enforced nowhere for the same reason."*

**Verified state**: 471 test files, 5,401 tests, 0 failed, 0 skipped; PostgreSQL 16 with 31
migrations and 187 tables; Platform 1.6.1; parity enforced; tree clean (section S re-runs the
gate).

## B. Nine completed slices

| # | Slice | Audience | Entry | Detail routes | What it settled |
| --- | --- | --- | --- | --- | --- |
| 1 | Employee Record | Admin | `/employment` → `/employment/[id]` | 1 | the cross-module person page; withheld ≠ empty |
| 2 | Approvals | Admin (self-shaped) | `/approvals` | `[instanceId]` | "waiting on you / decided by you", membership-derived |
| 3 | Hiring | Admin | `/recruitment` | requisition, application | requisition→offer pipeline |
| 4 | Payroll | Admin | `/payroll` | run, result (payslip) | a run and a payslip, explainable |
| 5 | Leave | Admin | `/leave` | balance/[employmentId], request | a balance explained from its ledger |
| 6 | Attendance | Admin | `/attendance` | day/[employmentId]/[date] | a day, punches, verdicts |
| 7 | Performance | Admin | `/performance` | review, goal | a review and a goal by identifier |
| 8 | Assets & Custody | Admin | `/assets` | `[assetId]` | the asset and everyone who held it |
| 9 | Relations | Admin | Employee Record → `/relations/employments/[id]` | case/[violationId] | one employment's case file |

Together: an administrator starts at an employment and reaches leave standing, attendance days,
payroll results, reviews, goals, custody, and the disciplinary case file — each by identifier,
each stating its boundary. Major administrator *read* workflows are covered for every operational
module that has slice-grade screens. What no audience anywhere can do is **write**: all 326 write
routes are unreachable from every portal ("This portal reads; it writes nothing" is in every
boundary note), because no request carries an authenticated principal to attribute a write to.

## C. Current product capability map

Cross-module compositions in production code:

- Employee Record: 14 reads across 12 modules (15 with a manager), including the history repair.
- Relations case: 6 reads over one case + catalogue + employment naming.
- Assets asset page: asset + custody chain, employment-linked.
- Admin Approvals: the two membership-derived queues + instance detail.

Cross-slice links that exist today (from rendered markup): Employee Record ↔ Relations (rows →
cases, section → relations record, case → record), Assets custody → Employee Record, Recruitment
application → Employee Record, Payroll run → results → payslip, Performance internal
review/goal links, Leave request links. Missing but composable with existing routes: record's
leave/attendance sections → their detail routes; clearance blockers → asset pages; approvals
subject → its requisition (section K).

## D. Employee Self-Service

**The principal chain, inspected end to end** — not "there is no /me":

1. **`PlatformAuthenticationPort`** (`packages/kernel/src/ports/authentication.ts`):
   `authenticate(credentials) → PlatformPrincipal | undefined`. The port's own words: Work never
   verifies a credential; *"No password, no token format, no signature, no key material appears
   anywhere in this repository."*
2. **`UnauthenticatedPort`** is *"the default, and the only implementation this repository will
   ever contain: it authenticates nobody."* It is wired as the DI provider at
   `apps/api/src/identity/identity.module.ts:113` (`AUTHENTICATION_PORT`). This is the single
   seam a Platform adapter replaces.
3. **`TenantMiddleware`** (`apps/api/src/tenancy/tenant.middleware.ts`): two steps — Platform
   authenticates; then **a stored membership chooses the tenant** via
   `resolveForPrincipal(TenantMembershipDirectory, principal, x-munaxa-tenant)`. The header
   selects among the caller's own active memberships; it never grants. Unresolved → no context →
   `currentTenantId()` throws and row-level security returns nothing. Fails closed twice.
4. **Execution context** then carries `tenantId`, `userId` (workforce user), `membershipId` —
   and `currentMembershipId()` is available to every handler.
5. **Membership → employment**: Identity's `EmploymentLink` aggregate (membershipId ↔
   employmentId, `isPrimary`, status; deliberately no foreign key across modules), written by
   `POST /identity/members/:membershipId/employments` and read back inside
   `GET /identity/members/:membershipId` (`identity.describe-member`, one round trip, under
   `identity.membership.read`).
6. **Employment → person**: `EmploymentView.personId`; person → identity records via People.

**So if a real authenticated employee arrived today**: Platform's adapter would name them (step 1
— absent), the middleware would resolve their membership (built), their permissions would be
whatever their membership holds (kernel pipeline, built), and their employment would be readable
through the employment link (built). Every step except step 1 exists. **What still would not
exist is the authorization pattern for "my X"**: the employment-scoped reads take `employmentId`
as a caller-supplied parameter under tenant-wide admin grants — granting `leave.read` to an
employee lets them query anyone. The one safe pattern in the repository is Workflow's: derive the
subject from context, accept no identifier. The 13 dormant `-own` grants are placeholders for
exactly that per-module work, and binding them to the employment link is a decision ADR-0032
currently forbids (*"a principal resolves to a tenant membership, not an employment"*) — an
owner-level ADR, not product code.

**Self-service capability map** (evidence per row; "Ready" = could ship with zero backend change
once a principal exists):

| Capability | Existing read | Existing permission | Existing UI | Principal required | Ready |
| --- | --- | --- | --- | --- | --- |
| My approvals queue | `GET /approvals/pending`, `/decided` (membership-derived) | `workflow.approval.read-own` (wired) | Admin Approvals screen | membership only | **Yes** — the only one |
| My onboarding tasks | own-task read + completion | `onboarding.task.complete-own` (wired) | none | membership only | read/complete yes; no UI |
| My profile / identity | `identity.describe-member` | `identity.membership.read` (admin) | none | membership + own-read decision | No |
| My employment | `GET /employments/:id` | `employment.read` (admin) | admin record | employment + own-read decision | No |
| My leave balances / requests | `/leave/balances?employmentId=`, `/leave/requests?…` | `leave.read` (admin); `leave.read-own`, `leave.request-own` **unwired** | admin screens | employment + `-own` wiring | No |
| My attendance | `/attendance/days?employmentId=` | `attendance.read` (admin); `attendance.read-own`, `attendance.event.record-own` **unwired** | admin screens | employment + `-own` wiring | No |
| **My payslip** | **none exists** (section: below) | `payroll.read-own` **unwired, guards nothing** | admin payslip via run | blocked in the module | **No — module gap** |
| My review / goals | reviews filter by cycle/status/manager only | `performance.review.read-own` **unwired**; module: confirming a review exists is the disclosure | admin screens | employment + module decision | No |
| My learning | `/learning/history/:employmentId` | `learning.*.read-own` ×2 **unwired** (*"enforced nowhere"*) | record section | employment + `-own` wiring | No |
| My career | `/career/summary/:employmentId`, readiness history | `career.*.read-own` ×2 **unwired** (same words) | record section | employment + `-own` wiring | No |
| My assets | `/assets/custody?employmentId=`, clearance | `assets.custody.read` (admin); **no `-own` declared** | record section | employment + module decision | No |
| My relations file | `/relations/violations?employmentId=` | `relations.violation.read` (admin); **no `-own` declared — deliberate** (AD-007) | admin slice #9 | employment + an owner decision nobody has asked for | No |
| My documents / letters | owner-scoped listings | `document.read-own`, `letter.request-own` **unwired** | record sections | employment + `-own` wiring | No |

**Payroll, reconfirmed against current source** (the critical check): all 17 payroll GETs are
run-, result-, group- or period-scoped — `/payroll/runs/:id/results`,
`/payroll/results/:id/payslip`, dashboards and configuration. **No read accepts an employment,
and no read derives a subject from the caller.** An employee cannot obtain payslip, result,
payment date, period, currency, frozen totals or line items without first obtaining a
`payrollResultId` from the run-scoped listing — an administrator surface under `payroll.read`.
**Self-Service cannot honestly claim "My Payslip." The blocker stands, unchanged.** No endpoint
was created; the gap is recorded.

**Assets specifically** (commissioned question): `GET /assets/custody?employmentId=` exists,
published, under `assets.custody.read`, exposing the custody chain (asset ids, tags via
clearance, dates, day counts — nothing about the person). A route could be *composed* without
backend change — but not *authorized* safely: the read honours whatever `employmentId` the
caller supplies, so handing the grant to employees is an IDOR-by-filter. An employee asset view
therefore waits on the same two things as everything else: a principal, and a module-side own
read (or an explicit owner decision that the filter-under-grant is acceptable — the repository's
own precedent, Performance's authorization file, argues it is not).

**The Employee Portal** is a real Next.js app on Platform 1.6.1 with the same build pipeline and
theming as admin, and nothing else: one bootstrap page, no shell, no navigation, no Work
contracts, no locale wiring. It is the right foundation and zero percent of the product.

**Classification: Class D.** Two foundations missing — the Platform authentication adapter
(external, this repository is forbidden to supply it) and the principal→employment authorization
decision (ADR-0032's successor). Neither is UI work, so no amount of UI work upgrades the class.

## E. Manager Workspace

The strongest evidence in the repository, from Performance's `authorization.ts` — the module
already built manager scoping end to end and then disabled the only unsafe half:

- `performance.review.read-team` and `goal.read-team` exist; `reviewScopeFor` resolves a team
  **through Employment's published `employment.search` contract under a bounded service grant**
  (D-31 answered; `MAX_DIRECT_REPORTS` 500); queries are bounded *before* the store because a
  count of removed rows is itself a disclosure; out-of-scope detail reads answer 404.
- And then: *"A `read-team` caller reads nothing, whatever they name… Nothing can check the claim
  until a principal resolves to an employment, so the claim is not accepted."* The manager
  identifier is honoured only beside `read-all`, where it narrows somebody who could already read
  everything.

Elsewhere: `employment.managerEmploymentId` and reporting lines exist; Workflow explicitly
refuses a manager queue (*"Resolving 'my team' needs the caller's employment, and a
caller-supplied manager identifier is a filter and never a credential"* — D-14); Leave,
Attendance, Assets, Relations and Payroll publish **no team-scoped read at all** — team views
there would be per-report iteration, i.e. new module work, and assembling a team in the browser
is the exact pattern every brief forbids.

Capability classes: today's per-module scopes are either tenant-wide (admin) or
employment-scoped (parameterised); the only true manager scope implemented is Performance's, and
it is deliberately inert. **Classification: Class D** — same two foundations as Self-Service,
plus per-module team reads that mostly do not exist yet (Class B/C work each, after the
foundations).

## F. Platform Authentication — the dependency, quantified

**Interface**: `PlatformAuthenticationPort` (kernel). **Implementation**: `UnauthenticatedPort`,
by declaration the only one this repository will ever contain (ADR-0001). **Why it cannot
authenticate**: it exists to make "Work never verifies a credential" structural; the alternative
default — believing a header — is the failure the port exists to prevent. **What supplies it**: a
Platform-owned adapter, provided at the `AUTHENTICATION_PORT` DI seam in `apps/api`, resolving
whatever credential Platform issues to a `PlatformPrincipal` (`platformUserId` immutable per
AD-004).

What it unlocks, counted from this repository rather than invented:

- **Audiences**: all three. Today zero of three applications can serve an authenticated human.
- **Writes**: all **326 write routes** across 18 modules are unreachable from any UI today —
  every slice's boundary note says "this portal reads; it writes nothing", and the reason every
  time is *"a request from this portal carries no authenticated principal"*. Every transactional
  workflow in the roadmap (deciding an approval, recording a violation, requesting leave,
  punching in, issuing a letter) is behind this one seam.
- **Reads**: all 187 GETs currently answer 401 to every real request; every one of the nine
  slices has only ever rendered production data through a scratchpad stub. The Payroll screen
  says it on screen: *"Sign-in is not available in this deployment, so payroll data cannot be
  shown."*
- **Already-built self capabilities that go live with no product code**: the two Workflow queues
  (on a shipped screen — the Approvals slice renders "Waiting for you 3 / 317" from a stub
  today), Onboarding own-task completion, Identity's delegation register, and the audited access
  trails gaining a real actor.
- **Permissions**: 285 permission constants become grantable to real principals; the per-section
  withheld/empty distinctions the slices were built around become observable product behaviour
  instead of stub choreography.
- **What it does not unlock by itself**: "my X" and "my team" reads still need the
  principal→employment ADR and per-module `-own`/`read-team` wiring (13 dormant grants;
  Performance's inert scope). Authentication is necessary, not sufficient — but it is first, and
  everything else is sequenced behind it.

> Is Platform authentication now the highest-leverage dependency in the roadmap? **Yes.** Both
> new audiences, all writes for the existing audience, and the entire live-data experience of
> the nine shipped slices converge on one DI seam this repository is forbidden to fill.

## G. Learning

11 GET routes (catalogue + versions, categories, paths + steps, enrolments + assessment results,
assignments, certifications, mandatory rules, instructors, `history/:employmentId`), 4 detail
reads; 259/259 localized keys; 21 test files; **all 16 contract views exported — Class A, no
contract work at all** (unlike Relations, which was Class B). Permissions are admin-read plus two
unenforced `-own` grants. Employee/manager scope: none wired; the screen itself says *"Reading
your own record is not available: this product cannot yet tell which employment you are."*
Existing UI: one pre-slice route — **sixteen stacked cards**, each one read with "Nothing to
show", no `PageHeader`, no title, no detail route. The complete admin workflow that exists in
the backend (catalogue → enrolment → assessment → certification → mandatory-rule compliance,
with expiring certifications derived at read time) has no work surface. Useful today to **Admin**
(compliance/mandatory-training is the commercially strongest read-only story left); to Employee
and Manager only after the foundations.

## H. Career

13 GET routes, 6 detail reads (plans, paths, pools + memberships, succession + bench strength,
readiness levels + `history/:employmentId`, mobility recommendations, `summary/:employmentId`);
248/248 keys; 27 test files; **all 19 views exported — Class A**. Two unenforced `-own` grants,
same wording as Learning. Existing UI: one pre-slice card-stack route; the record shows the
per-employment summary. A complete admin read workflow exists (succession planning: pool →
nominations → readiness → bench strength). Audience today: Admin (strategic HR); its
differentiator is smaller than Learning's compliance story and several of its concepts
(readiness stated-not-scored, recommendations that execute nothing) demo less concretely.

## I. Identity

Infrastructure first: it owns the membership directory the middleware resolves through, the
employment link, delegations, portals, preferences — the substrate of both future audiences.
**It is the only module with zero UI consumption.** Published admin reads exist (members list /
search / describe, invitations list), and the invitation lifecycle (invite → accept) is a real
administrative workflow — but its interesting half is writes, which are principal-blocked like
all writes. Verdict: **infrastructure and self-service dependency now; an administrative
workflow (member & invitation register) later; a standalone "Identity management" screen for its
own sake — no.**

## J. Organization

12 GETs. `units` and `positions` are paginated term-searches; `units/:unitId/ancestry`,
`/placements`, `/establishment`, `/governing-legal-entity` exist — **there is still no bounded
unit-by-id or position-by-id lookup**, which is why the Employee Record and the workforce
directory show placement identifiers and say why. Classification of the known issues:

- No by-id unit/position lookup: **contract gap** (owner decision on Organization's surface). It
  blocks no shipped slice (they render honestly), and would degrade Manager Workspace and
  Self-Service placement displays identically — worth fixing before either audience ships.
- Pre-slice `/organization` screen: **maintenance** (same modernization backlog as section L).
- Nothing found rises to product blocker or architecture finding beyond what ADR-0032 already
  governs.

## K. Relations after Slice #9, and cross-slice workflows

**What Slice #9 created for others**: eight newly-exported views make offboarding-style
compositions typable; the employment relations record and case routes give any future surface a
navigation target (the record already uses both). For Self-Service, Relations deliberately
declares no `-own` grant — an employee reading their own case file is an owner decision (AD-007
territory), not a missing wire. For Manager Workspace, no team read exists and the
employment-scoped list under `relations.violation.read` must not be handed to managers as a
filter. For offboarding, AD-006's clearance path runs through Assets' published contract and the
violations list is composable per employment — future composition only; nothing built.

**Cross-slice workflows**: the graph in section C shows the administrator paths already link
across five slices around the Employee Record. The gaps are small and composable today (record →
leave balance / attendance day details, clearance rows → asset pages, approvals subject → its
requisition, employment links on payroll results). This is real value but it is **incremental
polish measured in links, not a slice** — and the *employee* and *manager* versions of exactly
these journeys are the two Class-D audiences. Cross-slice navigation is not currently a greater
commercial opportunity than the dependency that would let anyone log in to travel it.

## L. Product coherence

Representative routes from all nine slices were rendered this session (populated via stubs where
per-slice fixtures exist; fail-closed chrome against no API elsewhere; EN and AR; 1440 and 390
where judged): record, approvals (populated queues), recruitment (AR), payroll, leave,
attendance, performance, assets and relations (both from Slice #9's full walk), plus the
pre-slice learning/career/organization/people screens for contrast.

- **Within the nine slices: coherent product language.** One navigation shell, `Page`/
  `PageHeader`, tables that own their scrolling, withheld ≠ empty ≠ not-found everywhere,
  boundary footers in the customer's words, translated closed vocabularies beside untranslated
  tenant values, `<bdi>` isolation throughout, consistent loading skeletons and not-found pages.
- **Minor inconsistencies** (all pre-known, none new): shortened identifiers in the older slices
  (Approvals subjects render `01900000…`) against the whole-identifier idiom of slices 8–9;
  locale-formatted timestamps (`20/08/2026, 09:00:00`) in Approvals against civil dates
  elsewhere; badge-tone conventions drifting slightly per slice; `/employment` missing its route
  title.
- **The two-generation split**: the 10 pre-slice routes are a different, older product — card
  stacks of raw reads without `PageHeader`, titles, or detail routes. It is contained and
  enumerated, and each "X as Work" slice has been retiring one screen at a time.

**Verdict: B — minor inconsistencies**, with the legacy list quantified. Not A, because the
identifier/date drift is visible on adjacent screens; not C, because navigation, vocabulary,
semantics and RTL behave as one product everywhere, and the split is a known backlog with a
proven retirement pattern. Nothing was fixed in this task.

## M. Commercial comparison

| Candidate | Customer value | Commercial value | Backend readiness | Workflow completeness | Demo value | Principal dependency | Class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Relations follow-up | Low (slice complete; remainder is writes) | Low | High | High | Low | Writes need principal | — |
| Employee Self-Service | High | High | Medium (reads exist; own-scoping mostly unwired; payslip absent) | Low | High | **Blocking** | D |
| Manager Workspace | High | High | Low (one inert team scope; no team reads elsewhere) | Low | High | **Blocking** | D |
| Learning as Work | Medium-High (compliance) | Medium-High | High (Class A, 16/16 views) | High (read side) | Medium-High | None | A |
| Career as Work | Medium | Medium | High (Class A, 19/19 views) | High (read side) | Medium | None | A |
| Identity register | Low standalone | Low | Medium (reads yes; the workflow is writes) | Low | Low | Writes blocked | B/D |
| Organization | Low-Medium | Low | Medium (lookup gap is the point) | Medium | Low | None | C |
| Cross-slice integration | Medium | Medium | High (links only) | High | Medium | None | A (small) |
| Product coherence pass | Medium (internal quality) | Medium | High | — | Medium | None | A (maintenance) |
| **Platform authentication** | **High (everything live)** | **High (pilots become possible)** | Chain built to the seam | — | **High (real login demo)** | **It is the principal** | D→unlocks |
| Other operational workflow (Compensation etc.) | Medium | Medium | Medium | Medium | Medium | None | B |

Five-minute demo test: Learning (compliance dashboard → course → who is overdue) and Self-Service
("open your phone, see your payslip") both pass — but Self-Service cannot be built, and every
demo of the existing product currently requires a stub API because nobody can sign in.

## N. Product vs Platform

- **Product slices** available now: Learning as Work, Career as Work, cross-slice link polish,
  coherence modernization of the 10 legacy screens. All Admin-audience, all read-only, all
  stub-demoed like their nine predecessors.
- **Platform initiatives**, not slices: the authentication adapter (external, the DI seam);
  the principal→employment resolution decision (an ADR the owner must make — ADR-0032's
  successor); manager principal resolution (same decision's second half).
- **Maintenance**: contract-export hygiene (none currently pending — Learning and Career are
  fully exported), organization by-id lookups (contract gap), `notFound()` HTTP semantics
  (infrastructure, tracked).
- These are deliberately not combined into one "Self-Service slice": a slice cannot contain an
  external adapter and an ADR.

## O. Strategic decision

The repository answers the commissioned question in its own voice, three times over:

1. Every slice's boundary note: writes are refused because *"a request from this portal carries
   no authenticated principal."*
2. Performance's authorization file: team reads are disabled *"until a principal resolves to an
   employment (ADR-0032)."*
3. Learning's status card: *"this product cannot yet tell which employment you are."*

Nine slices in, another admin slice (Learning is the best of them, and it is genuinely Class A)
would add a tenth read-only surface to a product no customer can log into, while both
strategically requested audiences stay exactly as blocked as they were at slice one. The marginal
value of slice #10 is real but declining; the value of the dependency is every audience, every
write, and the live-data version of everything already built.

## P. Recommended next direction

**Prioritize the Platform authentication adapter — a Platform dependency — before Product Slice
#10.**

- **Exact blocker**: no implementation of `PlatformAuthenticationPort` other than
  `UnauthenticatedPort` exists or may exist in this repository (ADR-0001). The seam is the
  `AUTHENTICATION_PORT` provider in `apps/api/src/identity/identity.module.ts`; the contract is
  `authenticate(PresentedCredentials|undefined) → PlatformPrincipal|undefined` with an immutable
  `platformUserId` (AD-004).
- **What it unlocks** (section F): three audiences; 326 write routes; 187 reads answering real
  requests; 285 permissions against real principals; the shipped Approvals queues and Onboarding
  own-tasks live with zero product code; every slice demo on live data; customer pilots.
- **Affected applications**: `apps/api` (the seam), admin (goes live), employee-portal and
  manager-portal (become buildable products).
- **Affected permissions / reads**: all of them, per section F; specifically the 2 wired `-own`
  reads immediately, and the 13 dormant `-own` grants plus Performance's inert `read-team`
  once the follow-on ADR lands.
- **Why before Slice #10**: sections F, M and O. No product slice changes any of it.
- **What Work must NOT do to compensate** (each has been the tempting shortcut at some point):
  no header-trusting or "dev-mode" adapter; no demo-authentication flag; no client-side
  impersonation; no `/me` mocked in a portal; no module-side membership→employment resolver
  ahead of the ADR; no handing tenant-wide read grants to employee principals so that
  "self-service" works by filter; no weakening of the fail-closed middleware. The
  `UnauthenticatedPort` stays the only in-repo implementation.

**Sequenced after the adapter (for planning, not authorized by this document)**: (1) the owner's
ADR on principal→employment resolution over Identity's employment link; (2) a Self-Service MVP
whose first screen is the already-built approvals queue plus own-task onboarding; (3) per-module
`-own` wiring, where the payslip gap and Relations' deliberate silence each need their own
owner decision. **If the owner wants a product slice built in parallel with no dependency on any
of this, the evidence names Learning as Work (Class A) as the strongest candidate** — but the
single recommended direction is the dependency.

## Q. Definition of Ready / Platform requirements

The dependency is Ready when:

1. A Platform-owned adapter implementing `PlatformAuthenticationPort` is provisioned to
   deployments (delivery mechanism is Platform's decision; the seam is DI at
   `AUTHENTICATION_PORT`), verifying Platform-issued credentials and returning stable
   `platformUserId`s.
2. Operational: memberships exist for pilot users (Identity's invitation acceptance flow —
   `POST /identity/invitations/:id/acceptance` — is the built path; it needs the adapter first,
   or Platform-side provisioning).
3. An owner decision (ADR) on principal→employment resolution is scheduled — explicitly out of
   the adapter's scope but the very next blocker behind it.
4. Nothing in this repository changes to make (1) possible; a deployment without the adapter
   keeps serving 401, by design.

## R. Out of scope

Everything in the commissioning brief's stop list, plus, explicitly: no adapter prototype, no
auth-related environment flag, no portal shell work "to be ready", no `-own` wiring ahead of the
ADR, no contract changes for Learning/Career (none are needed — that is the point of Class A),
no fixes to the coherence findings in section L, no organization lookups.

## S. Verification

`pnpm verify` with every cache cleared and PostgreSQL 16 live (`TEST_DATABASE_URL` set; 31
migrations applied; 187 tables). As recorded in the Slice #9 gate, the chained script forwards
`--force` only to its final command, so each turbo stage was run with `--force` explicitly and
tests with the script's own `--concurrency=1`:

- `pnpm standards`: engineering standards; architecture (186 models); localization (20/20
  catalogue sets); dependencies (2028 files, no cycles, no unused, no unreachable); platform
  parity — 5 packages = lockfile, all `registry`, `@munaxa/platform` 1.6.1.
- `pnpm format:check`: clean.
- lint 51/51 tasks, 0 cached — 1m55.581s.
- typecheck 51/51 tasks, 0 cached — 40.132s.
- test 51/51 tasks, 0 cached — 8m57.701s: **471 test files passed, 5,401 tests passed, 0 failed,
  0 skipped** — identical to the Slice #9 baseline, as an investigation demands.
- build 29/29 tasks, 0 cached — 1m17.504s. Exit 0.

No production code, package, lockfile, permission, migration or CI file changed in this task; the
only addition is this document.

## T. Git

- Branch `claude/munaxa-product-readiness-audit-8mr34d`, base `b1473c3` (Slice #9).
- Single commit adding `docs/verification/next-product-direction-investigation-3.md`; the
  commissioned `-2` name is occupied by the protected seven-slice-era record and was left
  untouched, as section-top note explains. Working tree clean after commit; pushed to origin.

---

# PRODUCT DIRECTION INVESTIGATION #2 COMPLETE — AWAITING OWNER DECISION
