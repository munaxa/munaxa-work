# Phase 16 — Enterprise Workflow & Approvals — Definition of Ready

**Status** Awaiting approval · **Baseline** `da759e8` (Phase 15 complete) · **Authoritative
specification** [`work prompts/17_PHASE_16_WORKFLOW.md`](../../work%20prompts/17_PHASE_16_WORKFLOW.md),
Version 1.0, Status Approved

This document is the Definition of Ready only. **No Phase 16 source code, schema, migration,
contract, port, controller, screen or dependency exists or is created by this checkpoint.** Every
"would" below describes work that is proposed and not yet authorized.

---

## 1. The specification, and why it is authoritative

Searched: `work prompts/` (42 files), `docs/adr/` (48 records plus the index), `docs/verification/` (all phase plans
and reports), `docs/PHASES.md`, `docs/DOMAIN_OWNERSHIP.md`, `docs/RELEASE_NOTES.md`, and a
repository-wide grep for `phase 16` / `workflow`.

**One candidate.** `work prompts/17_PHASE_16_WORKFLOW.md` — "Enterprise Architecture Specification /
Munaxa Work / Phase 16 – Enterprise Workflow & Approvals", Version 1.0, Status **Approved**. It is
the file `docs/PHASES.md` row 16 links to, which is this repository's precedence rule: the ledger
names the specification for each phase. No competing Phase 16 document, ADR or decision register
exists. There is no `phase-16-decisions.md`.

No Phase 16 ADR has been written. Phase 16 is named in **ADR-0024** (ports precede their engines),
**ADR-0045**, **ADR-0049** and in reserved columns across four migrations — but always as the
*consumer* of a seam, never as a decided design.

## 2. Objective

Implement the orchestration domain: workflow definitions and versions, running instances, approval
requests and decisions, routing, delegation, escalation, SLA and history — such that a business
module asks for a decision and does not learn who made it or in what order.

Workflow owns **process**. It owns **no business data**, and it never writes a business entity
directly (AD-001, and the repository's own `Asking` discipline).

## 3. Repository findings

Read from the Phase 15 tree, from source rather than from the phase reports.

### 3.1 The module is greenfield

No `packages/modules/workflow`, no `workflow_*` table, no Prisma model, no migration, no API module,
no Admin route. The two occurrences of "workflow" in `prisma/schema.prisma` are both comments
explaining that something deliberately *is not* one (ADR-0049).

### 3.2 The seam was prepared five phases ago, and it is narrower than it looks

`ApprovalPort` (`packages/kernel/src/ports/approval.ts`) declares `request` / `status` / `cancel`,
`ApprovalStatus` with an ordered `steps` array, and an `ApprovalDecided` event type. `AutoApprovingPort`
implements it, records `approver: 'system:auto-approval'` and says in its own comment that it does not
pretend a chain considered anything.

**`AutoApprovingPort` is wired nowhere.** It appears in no `apps/api` composition. Every module that
could have consumed it deliberately does not:

| Module | What it does today | Where it is written down |
| --- | --- | --- |
| Recruitment | Own `recruitment_requisition_decision`; own `approve` permission; reversal, never amendment | ADR-0045 |
| Onboarding | `approval`-kind task decided by a named human; `approval_reference` reserved and null | ADR-0049 |
| Attendance | Own decision; `approval_reference` reserved and null | migration comment, `day.use-case.ts` |
| Leave | `leave_request_decision`; chain published *in `ApprovalPort`'s shape* from its own table | `decision.controller.ts`, `request-queries.ts` |
| Compensation | `compensation_approval_decision`; chain in `ApprovalPort`'s shape | `compensation-dependencies.ts` |
| Payroll | `payroll_approval_decision`; no `ApprovalPort` | `payroll-dependencies.ts` |
| Letters | `letter_approval_decision`; shape mirrors `ApprovalPort`'s view | `letter-approval.ts` |
| Performance | Goal approval, review completion, calibration decision — each a named human act | `goal.ts`, migration check constraints |
| Career | Successor confirmation is a named human act with its own permission | ADR-0072 · D-8 |

Six decision tables exist (`compensation_approval_decision`, `leave_request_decision`,
`letter_approval_decision`, `payroll_approval_decision`, `performance_calibration_decision`,
`recruitment_requisition_decision`) and **ten decision commands** are already published:
`leave.decide-request`, `recruitment.decide-requisition`, `recruitment.decide-offer`,
`recruitment.reverse-requisition-decision`, `compensation.decide`, `compensation.reverse-decision`,
`payroll.approve`, `letters.decide`, `attendance.approve-day`, `attendance.decide-correction`.

So the seam is real, but it is **not** "swap the adapter and five modules get routing". Each of those
modules records its own decision in its own table. What Phase 16 can change without touching them is
*who is asked, in what order, and how the request reaches them* — which is exactly what ADR-0045's
migration path says: *"No table changes, no state changes, and no change to the decision record. What
changes is who the request is routed to and how it gets there."*

### 3.3 Four `approval_id` / `approval_reference` columns are reserved and null

`recruitment_requisition.approval_id`, `leave_request.approval_id`,
`onboarding_task.approval_reference`, and Attendance's reserved column. Each is `varchar(64)`, null,
and documented as Phase 16's. **`ApprovalStatus.approvalId` is the value they are shaped for.**

### 3.4 Delegation already exists, and it is Identity's

`packages/modules/identity/src/domain/delegation.ts` — a full aggregate with `create`, `revoke`,
`expire`, `activate`, `isInForceAt`, a half-open period, a `scope` string deliberately left opaque,
and states `scheduled` / `active` / `revoked` / `expired`. There is a controller
(`delegation.controller.ts`), a use case, a table, and a **published query**
`identity.active-delegations-for(delegateMembershipId, atInstant)` under permission
`identity.delegation.read`, returning `DelegationView` from Identity's contracts.

Its own header states the ownership decision:

> It lives here rather than in Workflow (AD-010) because delegation is a statement about identity —
> *who may act as whom* — and Workflow, Leave, Payroll and Self Service will each need the answer.
> Building it inside Workflow would make four other domains depend on the approvals engine to find
> out who a person's deputy is.
>
> Phase 2 owns the fact. Phase 16 consumes it.

`docs/DOMAIN_OWNERSHIP.md` agrees: *"Employment link, delegation | `identity` | Phase 2 ✅"*.

Delegation is keyed on **`membershipId`**, not on an employment or a person.

### 3.5 There is no role engine, and there will never be one

`apps/api/src/identity/permission-checker.ts`:

> Munaxa Work will never implement a role engine or a permission engine. What it does is *declare*
> the permissions its handlers require, so that Platform has something to grant.

`PermissionChecker` is `holds(permission): Promise<boolean>`. There is **no role table, no group
table, no role assignment and no way to enumerate the members of a role.** `holds` answers about the
current caller only; nothing in this repository can answer "who holds `leave.approve`". The only
`*_group` table in the schema is `payroll_group`, which is a payroll population, not a directory.

### 3.6 Principal resolution: membership yes, employment no — and the distinction is the phase

This is the single most consequential finding, and it is finer than the blanket statement carried in
the Phase 13, 14A and 15 reports.

- **Principal → membership resolves today, in production.** `tenant.middleware.ts` authenticates
  through `PlatformAuthenticationPort`, then calls `PostgresMembershipDirectory.activeMembershipsOf`,
  and every business request carries a `ResolvedMembership` — `tenantId`, **`membershipId`**,
  `workforceUserId`, `platformUserId`. The audit actor is `user:<workforceUserId>`, not
  `user:anonymous`. This is wired, not stubbed.
- **Principal → employment does not.** There is a stored `EmploymentLink` aggregate in Identity
  (`membershipId → employmentId`, with `isPrimary`), surfaced through the composite query
  `identity.describe-member(membershipId)` under the broad `identity.membership.read` permission.
  The *data* exists; a narrow, purpose-built contract for "which employment is this caller" does not,
  and no phase has adopted one. → **D-14**, and it must not be assumed.

**Why this matters more here than in any previous phase.** Career's "my career plan" is about an
*employment*, so it was `NOT VERIFIED`. An **approval queue is about a member** — the person who was
asked to decide — and a member is exactly what a request already resolves to. So "the approvals
waiting for me", "delegate my authority", and "what I decided" are, for the first time in this
repository, honestly buildable. "Route to the requester's **manager**" is not, because a manager is a
reporting line in Employment keyed by `employmentId`.

### 3.7 Event delivery cannot carry a decision

From `leave-events.ts`, `attendance-events.ts`, `compensation-events.ts`, `onboarding-events.ts` —
the same paragraph, four times:

> Event delivery in this repository is **post-commit, in-process and at-most-once, with no outbox**:
> the unit of work commits and *then* dispatches, and a process that dies between the two loses
> whatever it was carrying. There is no published cross-module event contract and no subscription
> contract, and inventing one for a single consumer is the work Phase 16/17 exist to do properly.

`InProcessEventDispatcher` is wired in `database.module.ts`. The only registration loop in the
application is `identity.module.ts`, registering a module's own handlers. **No cross-module
subscription exists anywhere in `apps/api`.**

ADR-0050 settled the question for a comparable case: *"An onboarding is started by an idempotent
command and guaranteed by reconciliation, never by an event."* ADR-0053: *"Recalculation is found by
asking, not by being told."*

### 3.8 A cross-module *write* has one precedent, and it is synchronous and actor-preserving

ADR-0046: Recruitment's hire is a four-step saga that calls **Employment's application service**,
with a recoverable `hire_state`, write-once uniquely-indexed identifiers, idempotent steps and a
detectable partial failure. Not a distributed transaction, and it does not pretend to be one.

The mechanism that makes it safe is `runWithServiceGrant` (ADR-0043), whose contract is explicit:

> It does not touch the execution context. The tenant, the actor and the correlation identifier stay
> exactly as the request set them, so every audit column and every event still names the human being
> who asked. **A grant changes what is permitted, never who is acting.**

This is the hinge of the whole phase. When an approver submits their decision to Workflow over HTTP,
the actor on that request *is that human*. Workflow can, inside that same request, enter a bounded
grant and invoke the business module's existing `decide` command — and the business module's audit
columns and check constraints see the approver's own identity. The fourteen
`check (… <> 'system:auto-approval')` constraints across Performance, Learning and Career pass,
because nothing automatic happened.

What this does **not** cover is any decision reached without a human request in flight: an escalation
firing, an SLA expiring a request, an auto-approval on timeout. Those have no actor and no request,
and there is no outbox to carry them. → **D-9 ⛔**, **D-11 ⛔**.

### 3.9 Kernel ports, as they actually are

| Port | Interface | Adapter | Production-capable |
| --- | --- | --- | --- |
| `ApprovalPort` | yes | `AutoApprovingPort` | **No** — a stub that approves everything, wired nowhere |
| `NotificationPort` | yes | `RecordingNotificationPort` | **No** — records, delivers nothing |
| `DocumentPort` | yes | none | No |
| `StoragePort` | yes | none | No |
| `JobPort` (`enqueue`, `schedule(cron)`) | yes | **none anywhere** | No |
| `SearchPort` | yes | none | No |
| `EmailPort` | yes | none | No |
| `FeatureFlagPort` | yes | `InMemoryFeatureFlags` | Development only |
| `PlatformAuthenticationPort` | yes | authenticates nobody, by design (ADR-0001) | Platform's, not ours |
| Numbering facility | — | **does not exist** (Career D-20) | No |
| Event bus / outbox | `InProcessEventDispatcher` | in-process, at-most-once, no outbox | No |
| Workflow engine | — | none — this phase | — |
| Electronic signature, PDF, OCR, external search | — | none | No |

**`JobPort` having no adapter is the constraint that shapes half of this phase.** Escalation "after
SLA breach", delegation "Automatic Expiration" and any timed transition all require something to run
when nobody is asking. Nothing does.

### 3.10 Organization's calendar is not reachable by a narrow contract

`organization_calendar` and `organization_calendar_day` exist, with `timeZone`, `workingDays`
(ISO weekdays) and typed exception days. `OrganizationCalendarView` and `CalendarDayView` are in
Organization's published contracts — but the **only** query that returns them is
`organization.export-structure`, which returns the entire organization as one document. Phase 16's
own rules forbid using a broad export endpoint to answer a narrow question. An SLA measured in
*business days* therefore has no bounded contract behind it today. → **D-12 ⛔**, **C-15**.

### 3.11 Conventions Phase 16 inherits unchanged

Modular monolith (ADR-0023), `domain ◄ application ◄ infrastructure ◄ api`, lint-enforced. One shared
`Dispatcher`; every handler declares one permission. A module package depends only on `@work/kernel`
and `@work/persistence` — cross-module adapters live in `apps/api/src/<module>/` and take `Asking`
(`ask` only, no `send`). RLS enabled **and forced**, one `tenant_isolation` policy per table via
`app_protect_table`. Every model carries `tenant_id`, the four audit columns, `deleted_at`/`deleted_by`
(**soft delete is mandatory** — `check-architecture.mjs` fails without it, which satisfies AD-011 by
construction) and `version` for optimistic concurrency. Budgets: controller 150 lines, repository 250,
`*.use-case.ts` 300, other 400; complexity ≤ 10; no `any`, no suppressions. Admin is server-rendered
with `renderToStaticMarkup`, en + ar with `dir="rtl"`, a fixed request budget. Benchmarks run at
500 / 10,000 / 100,000 as an unprivileged role with a second tenant seeded at equal volume. Tests run
at pinned `--concurrency=1`; the default-concurrency deadlock is known, reproduced and carried.

---

## 4. Requirement reconciliation

Every requirement in the specification, classified. Evidence is code, schema or ADR.

| Requirement | Class | Evidence |
| --- | --- | --- |
| Workflow Definition, Version | **Greenfield** | No table, no model |
| Workflow Instance, Step, Action | **Greenfield** | — |
| Approval Request, Approval Decision | **Greenfield as routing**; the *decision record* is **already owned** by seven modules | §3.2 — six decision tables, ten decision commands |
| Approval Queue, Pending/Completed Approvals | **Greenfield**, and **verifiable** — a queue is addressed to a member, and membership resolves | §3.6 |
| Delegation | **Owned by another module** (Identity, Phase 2, AD-010) | §3.4 → **C-1 / D-2 ⛔** |
| Delegation Search, Delegation History | **Already implemented** in Identity | `identity.active-delegations-for`, delegation events |
| Automatic Expiration of delegation | **Already implemented** as `expire()`, but **blocked by missing infrastructure** for the *automatic* part | §3.9 — no `JobPort` |
| Approval Group | **Greenfield if it is an explicit member list**; **contradictory** if it means a role | §3.5 → **C-2 / D-3 ⛔** |
| Escalation Rule, Multi-level Escalation | **Blocked by missing infrastructure** for time-triggered firing | §3.9 → **D-9 ⛔** |
| SLA Rule, Configurable SLA | **Partially blocked** — elapsed-time SLA is buildable; business-day SLA needs a contract | §3.10 → **D-12 ⛔** |
| Time-based Escalation | **Blocked by missing infrastructure** | no `JobPort` |
| Role Escalation, HR Escalation | **Contradictory** — no role model | §3.5 → **C-2** |
| Manager Escalation, Manager approver | **Blocked by a missing contract** — needs principal → employment, then the reporting line | §3.6 → **D-14 ⛔** |
| Single / Sequential / Parallel approval | **Greenfield**, specified enough to build | AD-006, AD-007 |
| Majority / Unanimous / First Response Wins | **Impossible to verify honestly** — no formula | → **C-5 / D-6 ⛔** |
| Conditional Approval, conditional branching (AD-008) | **Impossible to verify honestly** — no expression language | → **C-6 / D-7 ⛔** |
| Dynamic Rule approver (AD-005) | **Impossible to verify honestly** — same | → **C-6 / D-7 ⛔** |
| External API approver | **Explicitly deferred** by the specification itself ("future") | AD-005 |
| Workflow History, Workflow Timeline | **Greenfield** | — |
| Workflow Analytics | **Owned by a later phase** / explicitly deferred | Phase 20 Workforce Intelligence; Phase 15 refused to invent analytics → **C-7 / D-16** |
| "Business Domain Executes", "Business Domain Callback" | **Blocked by missing infrastructure** for the asynchronous form; **buildable** synchronously | §3.7, §3.8 → **C-3 / D-9 ⛔** |
| AD-002 "Domain Events" as a communication mechanism | **Contradictory** — at-most-once, no outbox, no subscription contract, ADR-0050 refuses it | §3.7 → **C-3** |
| AD-003 versioned definitions, running instances keep their version | **Greenfield**, and there is a direct precedent | ADR-0048 (onboarding plan versions immutable, instance copies at creation) |
| AD-004 unlimited approval steps | **Greenfield**, no contradiction | — |
| AD-011 audit, soft delete, optimistic concurrency, metadata, versioning | **Already enforced repository-wide** | `check-architecture.mjs` |
| Validation: circular approval chains, duplicate requests, approver availability, delegation validity, workflow version | **Greenfield**; "approver availability" partly blocked | → **D-5**, **D-14** |
| Notifications on escalation / SLA breach | **Excluded by the specification's own Non Goals**, and no adapter exists | Non Goals; `RecordingNotificationPort` → **C-11** |
| REST API, Administration UI, Testing, Documentation | **Greenfield**, conventions established | Phases 13–15 |
| "No source-specific logic inside Workflow" over 11 named source modules | **Requires modification to completed modules** if adoption is in scope | → **C-10 / D-10 ⛔** |

---

## 5. Domain ownership

### What Phase 16 would own

The **process**: a definition, its versions, a running instance, its steps, the request that a
decision be made, the decision *as an act of routing*, the assignment of a step to an approver, the
history of every transition, and the rules (escalation, SLA) that govern timing.

### What it must reference and never duplicate

| Concept | Owner | Workflow's relationship |
| --- | --- | --- |
| Delegation — who may act as whom | **Identity** (Phase 2, AD-010) | **Asks** `identity.active-delegations-for`. Stores no delegation row. → **D-2 ⛔** |
| Membership, workforce user | **Identity** | An approver is a `membershipId`. Workflow stores the identifier and no property of it |
| Employment, reporting line, manager | **Employment** (Phase 5) | Would ask `employment.search` / `employment.read-employment` — *if* the caller's employment can be resolved. → **D-14 ⛔** |
| Position, unit, calendar, time zone | **Organization** (Phase 3) | Would ask a narrow contract that does not exist yet. → **D-12 ⛔** |
| Permission, role | **Platform** (ADR-0001, AD-002) | Cannot enumerate. → **D-3 ⛔** |
| The business decision record and its business meaning | **Leave, Recruitment, Compensation, Payroll, Letters, Attendance, Onboarding, Performance, Career** | Workflow routes; the module records. Two sources of truth would be the failure → **D-10 ⛔** |
| Person, name, contact | **People** | Never read. A queue shows the identifier the caller already holds |
| Analytics | **Phase 20** | → **D-16** |

### Duplicate-domain risks, named

1. **Delegation.** The specification says Workflow owns it; the repository has shipped it in Identity
   with an explicit ADR-style rationale. Building a second delegation table would give a tenant two
   registers of who covers for whom, and the approval routed from the stale one is the one that
   matters. **STOP → D-2.**
2. **Approval Group vs a role.** A group whose members are explicitly named is Workflow's own
   configuration and duplicates nothing. A group defined *by role* requires a directory this product
   has promised never to build. **STOP → D-3.**
3. **Approval decision.** Seven modules already record decisions with their own permissions,
   constraints and reversal rules. If Workflow also stores a decision, the two can disagree — and
   ADR-0045's whole argument is that the business decision record must not become "the system
   approved it". **STOP → D-10.**
4. **Workflow History vs each module's own history.** Employment status history, Attendance's
   immutable events, Career's immutable assessments. Workflow's history must record *routing*, never
   restate a business fact.
5. **`WorkflowProjection` (an aggregate root in the specification) vs derive-on-read.** Phase 15 D-16
   refused a `CareerSummaryProjection` and derived it from six store reads instead; Phase 9 ADR-0059
   kept a projection but made the ledger authoritative and the projection reconciled. → **D-15**.
6. **SLA "business day" vs Organization's calendar.** Workflow must not ship its own weekend or
   holiday table. → **D-12**.

---

## 6. Contradiction register

Each states the specification, the repository, why both cannot hold, and a proposed resolution.
**A proposed resolution is not an approval.**

**C-1 — "Workflow owns delegation" vs Identity owns it, shipped.**
*Spec*: "Workflow owns delegation" (IMPORTANT); `Delegation` is an Aggregate Root; AD-009.
*Repository*: a complete Identity aggregate, table, controller, use case and published query, whose
header names AD-010 and says "Phase 2 owns the fact. Phase 16 consumes it."
*Affected*: identity, workflow. *Why irreconcilable*: two writable registers of who may act as whom.
*Proposed*: Workflow **consumes** `identity.active-delegations-for` through a bounded grant and owns
no delegation row; the specification's "supports delegation" is read as "resolves through it".
*Approval*: **required — D-2 ⛔**.

**C-2 — Role and Group approvers vs "never a role engine".**
*Spec*: AD-005 approvers may be Role or Group; `ApprovalGroup` is an aggregate root; Role Escalation
and HR Escalation are required.
*Repository*: `PermissionChecker` is `holds(permission)` for the current caller only; no role table,
no group table, no assignment table, and an explicit written commitment never to build one.
*Why irreconcilable*: routing to a role requires enumerating its holders; nothing can.
*Proposed*: an `ApprovalGroup` is an **explicitly enumerated list of memberships**, Workflow's own
configuration, and the words "Role" and "HR" are `NOT VERIFIED` rather than approximated by a group
somebody named "HR". *Approval*: **required — D-3 ⛔**.

**C-3 — "Business Domain Callback" / domain events vs at-most-once, no outbox.**
*Spec*: AD-002 lists Domain Events as a communication mechanism; the High-Level Model ends in a
Business Domain Callback.
*Repository*: post-commit, in-process, at-most-once dispatch, no outbox, no cross-module subscription
contract; ADR-0050 refuses event-driven starts; ADR-0053 pulls rather than being told.
*Why irreconcilable*: a lost event leaves an approved request permanently un-executed, with the
approval recorded — the worst of both records.
*Proposed*: the decision reaches the business module **synchronously, inside the approver's own
request**, through the module's existing `decide` command under a bounded grant that preserves the
actor (§3.8); plus a **detectable, idempotent, administrator-run reconciliation** for anything that
did not complete, on ADR-0046's saga pattern. No event carries correctness.
*Approval*: **required — D-9 ⛔**.

**C-4 — Escalation and automatic expiry vs no `JobPort` adapter.**
*Spec*: "Escalation — Automatic reassignment after SLA breach"; "Delegation — Automatic Expiration".
*Repository*: `JobPort` is an interface with zero implementations anywhere.
*Proposed*: SLA breach and escalation *due* are **derived on read against a stated day/instant**
(Learning ADR-0070, Career D-13), and the reassignment itself is a **bounded, idempotent command an
administrator runs**, arbitrated by a partial unique index (Learning ADR-0071). Automatic firing is
`NOT VERIFIED`. *Approval*: **required — D-9 ⛔ / D-11 ⛔**.

**C-5 — Majority / Unanimous / First Response Wins with no arithmetic.**
*Spec*: six approval patterns listed, "Tenant configurable".
*Repository*: no formula anywhere; Phase 13 precedent (ADR-0069) is that unspecified arithmetic is a
blocking decision and an absence is never silently a zero.
*Unspecified, every one of them*: the **denominator** (assigned approvers, or those who responded);
**ties** under majority; **abstention and non-response**; whether a **delegated** vote counts as the
delegator's; what happens when an approver is **removed or their membership ends** mid-instance;
whether "first response wins" means first *decision* or first *approval*; whether a single rejection
ends a parallel step (unanimous) or is tallied.
*Proposed*: build **Single**, **Sequential** and **Parallel-unanimous-with-first-rejection-ending**
only if that rule is explicitly approved; refuse to invent the rest.
*Approval*: **required — D-6 ⛔**. Explicit parameters for approval are in §8.

**C-6 — Conditional branching and Dynamic Rule approvers with no language.**
*Spec*: AD-008 "Workflow supports conditional branching"; AD-005 "Dynamic Rule".
*Repository*: ADR-0049 states the position directly — *"What a graph buys beyond that is branching
and joining, which is a workflow engine"* — and that a sixth task kind is deliberately a schema change
because *"add a kind is how a checklist becomes a workflow engine one release at a time."* The
`ApprovalRequest.context` field exists (`Readonly<Record<string, unknown>>`, "facts the routing rules
may read") but nothing defines an operator set, a type system, evaluation order, missing-key
behaviour, or how a condition is versioned with its definition.
*Proposed*: **do not invent an expression language.** Either approve a closed, enumerated condition
form (§8) or defer branching to a later increment. *Approval*: **required — D-7 ⛔**.

**C-7 — "Workflow Analytics" vs Phase 20 and the Phase 15 precedent.**
*Spec*: Analytics is a scope item and `WorkflowProjection` an aggregate root.
*Repository*: `docs/PHASES.md` assigns Workforce Intelligence to Phase 20; Phase 15 refused to build a
"readiness distribution" on the grounds that a distribution over a population is analytics.
*Proposed*: Workflow publishes **bounded operational reads** — a queue, a count for one instance, a
timeline for one instance — and no aggregate over a population. *Approval*: recommended — **D-16**.

**C-8 — Employee / Manager / HR approvers vs what resolves.**
*Spec*: AD-005.
*Repository*: membership resolves (§3.6); employment does not; there is no HR role (C-2).
*Proposed*: approver kinds ship as **`membership`** and **`group`** (an explicit list). `manager` is
`NOT VERIFIED` pending D-14; `role`/`HR` is `NOT VERIFIED` pending D-3.
*Approval*: **required — D-4 ⛔**.

**C-9 — `ApprovalPort`'s shape vs the repository's own conventions.**
*Spec*: implicitly, that Phase 16 supplies this port's adapter (ADR-0024).
*Repository*: `ApprovalStep.decidedAt` and `ApprovalStatus.completedAt` are `Date`; no method carries
a `tenantId`; `approver` is an unconstrained `string`; `request()` returns a resolved `ApprovalStatus`
synchronously, which is true of an auto-approver and false of a real chain.
*Why it matters*: implementing the port as written puts a `Date` on the boundary of a repository that
has spent three phases removing them, and leaves tenancy to ambient context at a seam other modules
call. Changing it is a **kernel change touching ADR-0024** and every module that publishes a chain
"in `ApprovalPort`'s shape".
*Proposed*: implement the port **as written**, unchanged, and keep Workflow's own contracts civil-date
and tenant-explicit — the `Date` stays confined to the legacy seam. Amending the port is a separate
decision. *Approval*: **required — D-8 ⛔**.

**C-10 — "Approval Sources: Recruitment … Career" vs eleven modules that do not call the port.**
*Spec*: eleven named source modules, "No source-specific logic inside Workflow".
*Repository*: none consumes `ApprovalPort`; each has its own decision table, permission and rules;
ADR-0045 deliberately refuses routing for requisitions.
*Why irreconcilable*: making a module route means modifying a completed module — forbidden without
explicit approval (§12) — and *not* making it route means the "sources" list describes nothing.
*Proposed*: Phase 16 delivers the **engine and the seam**, adopts **zero** modules by default, and
proves the seam end to end against **one** module chosen for it. Each adoption is its own approval.
*Approval*: **required — D-10 ⛔** and §11/§12.

**C-11 — Escalation and SLA vs "Do NOT implement Notifications".**
*Spec*: Non Goals exclude notifications; Escalation reassigns after a breach.
*Repository*: `RecordingNotificationPort` records and delivers nothing.
*Why it matters*: a reassignment nobody is told about is a queue silently changing owner.
*Proposed*: honest and stated — reassignment is recorded and visible in the queue; "the new approver
was told" is `NOT VERIFIED` and belongs to Phase 17. Not blocking.

**C-12 — Approval Queue is self-service, and this time it resolves.**
*Spec*: Approval Queue, Pending Approvals.
*Repository*: three phases recorded self-service as `NOT VERIFIED` for lack of principal → employment.
*Why this is different*: a queue is addressed to a **member**, and `ResolvedMembership.membershipId`
is on every request (§3.6). *Proposed*: `GET /workflow/approvals/pending` resolves the queue from the
**request's own membership**, never from a client-supplied identifier — and there is deliberately no
`?membershipId=` parameter. *Approval*: recommended — **D-13**.

**C-13 — Phase size.**
Twelve aggregate roots, fifteen scope items, six approval patterns, six escalation kinds, four
delegation kinds. Recent phases: Phase 13 = 23 tables, Phase 14A = 12, Phase 15 = 12. → §17,
**D-17**.

**C-14 — "External API (future)" approver.** The specification defers it itself. Excluded, §18.

**C-15 — Business-day SLA vs no bounded calendar contract.** §3.10. → **D-12 ⛔**.

---

## 7. Decision register

Twenty-two decisions. ⛔ = blocking. **None is resolved; a recommendation is not an approval.**

| ID | Question | Spec wording | Repository evidence | Recommendation | Blocking | Modifies a completed module | Schema | Security | Lifecycle | Performance | Deferrable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **D-1** | Is Workflow greenfield, one module, `@work/workflow`? | Scope | No workflow artefact exists | Yes, following Career's layout | no | no | yes | no | no | no | no |
| **D-2 ⛔** | Does Workflow own Delegation? | "Workflow owns delegation"; AD-009 | Identity owns it, shipped, AD-010 (§3.4) | **No.** Consume `identity.active-delegations-for`; store no delegation | **yes** | no (consumes an existing contract) | yes (a table not created) | yes (grant) | yes | yes | no |
| **D-3 ⛔** | What is an approver "Role"/"Group"? | AD-005; `ApprovalGroup` | No role engine, ever (§3.5) | **Group = an explicit list of memberships.** Role/HR → `NOT VERIFIED` | **yes** | no | yes | yes | no | no | partly |
| **D-4 ⛔** | Which approver kinds ship? | AD-005 (7 kinds) | membership resolves; employment and role do not | `membership` + `group` only | **yes** | no | yes | yes | yes | no | no |
| **D-5** | How are circular chains and duplicate requests refused? | Validation Rules | Career/Learning precedent: partial unique index + check constraint | Duplicates: partial unique index on (subject, open). Cycles: a step may not name an approver already terminal on the same instance — enforced in the domain | no | no | yes | no | yes | yes | no |
| **D-6 ⛔** | The arithmetic of Majority / Unanimous / First-Response | six patterns, "Tenant configurable" | **no formula anywhere**; ADR-0069 precedent | Ship Single + Sequential + one explicitly approved parallel rule; refuse the rest | **yes** | no | yes | no | yes | no | partly |
| **D-7 ⛔** | Conditional branching and Dynamic Rule | AD-008, AD-005 | no expression language; ADR-0049 | **Do not invent one.** Approve a closed condition form (§8) or defer | **yes** | no | yes | no | yes | yes | yes |
| **D-8 ⛔** | Implement `ApprovalPort` as written, or amend it? | ADR-0024 | `Date`, no tenant, sync return (§3.2, C-9) | Implement **as written**; amend in a separate ADR if ever | **yes** | **yes if amended** (kernel + 7 modules) | no | yes | no | no | no |
| **D-9 ⛔** | How does a decision reach the business module? | "Business Domain Callback"; AD-002 events | at-most-once, no outbox (§3.7); ADR-0046 saga; grant preserves actor (§3.8) | **Synchronous, in the approver's request, under a bounded grant**, plus idempotent reconciliation. No event carries correctness | **yes** | no by itself; **yes** per adoption (D-10) | yes | yes | yes | yes | no |
| **D-10 ⛔** | Which business modules adopt Workflow in this phase? | 11 "Approval Sources" | none consume the port; ADR-0045 refuses for requisitions | **Zero by default.** Prove the seam against **one** module, named and approved | **yes** | **yes** — one module | yes | yes | yes | yes | no |
| **D-11 ⛔** | Escalation and SLA firing | "Automatic reassignment after SLA breach" | no `JobPort` adapter (§3.9) | **Derive due-ness on read**; reassign by a bounded idempotent administrator command; automatic firing `NOT VERIFIED` | **yes** | no | yes | no | yes | yes | no |
| **D-12 ⛔** | Is an SLA elapsed time or business days? | "Configurable SLA" | calendar only via a broad export (§3.10) | **Elapsed time** (whole hours/days, `timestamptz` arithmetic) unless a narrow Organization calendar contract is authorized | **yes** | **yes if business days** — additive Organization query | yes | no | yes | yes | no |
| **D-13** | Does the approval queue resolve from the caller's membership? | Approval Queue | membership resolves (§3.6) | **Yes**, from the request's own membership; no client-supplied identifier, no `?membershipId=` | no | no | no | **yes** | no | yes | no |
| **D-14 ⛔** | Manager routing — adopt a principal → employment contract? | AD-005 "Manager"; Manager Escalation | link stored in Identity; only a broad composite query exposes it (§3.6) | **Not in this phase.** `manager` approver → `NOT VERIFIED`. Adopting it needs a narrow additive Identity contract | **yes** | **yes if adopted** — additive Identity query | no | **yes** | no | no | yes |
| **D-15** | Is `WorkflowProjection` a table or a derived read? | Aggregate Roots | Career D-16 derived; ADR-0059 kept a reconciled projection | **Derived on read** unless a benchmark shows otherwise; if stored, the instance stays authoritative and the projection is reconciled | no | no | yes | no | no | **yes** | no |
| **D-16** | Workflow Analytics | Scope; Future Consumers | Phase 20 owns analytics; Phase 15 precedent | Bounded operational reads only; aggregates over a population → `NOT VERIFIED` | no | no | no | no | no | yes | yes |
| **D-17 ⛔** | Is Phase 16 split? | — | 12 aggregate roots vs 12/12/23 tables (§17) | **A split is recommended** (16A engine, 16B escalation/SLA/branching/groups). The specification defines no sub-phases, so this is the user's call | **yes** | no | yes | no | no | no | — |
| **D-18** | Does a definition version become immutable on publish? | AD-003 | ADR-0048 (onboarding plan versions) | **Yes**, and an instance **copies** its steps at creation, exactly as ADR-0048 does | no | no | yes | no | **yes** | no | no |
| **D-19** | Is a decision amendable? | — | ADR-0045: never amended; reversal only | **Never amended.** Immutability enforced by trigger, as Career's assessments are | no | no | yes | yes | yes | no | no |
| **D-20** | Civil date or instant for SLA, escalation and history? | — | Career/Learning: civil dates as strings; Attendance: instants for events | **Instants (`timestamptz`)** for a request, a decision and an SLA; **civil dates** only where a human states a day (a delegation period). Never mixed, never a `Date` above the repository | no | no | yes | no | yes | no | no |
| **D-21** | Does an approval request need a human-readable reference? | — | no numbering facility (Career D-20) | **No.** A UUID and the subject identifier. A reference would need a facility that does not exist | no | no | yes | no | no | no | no |
| **D-22** | Are Workflow's domain events published cross-module? | AD-002 | no subscription contract (§3.7) | **Internal only**, exactly as Leave, Attendance, Compensation and Onboarding keep theirs. Publishing a subscription contract is its own phase-level decision | no | no | no | yes | no | no | yes |

---

## 8. Scoring, arithmetic and rule formulae — the parameters that need approval

Phase 16 contains no score, rating, percentage or weight. It contains three pieces of **decision
arithmetic** and one **rule language**, and none is specified. Following the Phase 13 precedent, each
is stated as explicit parameters for approval rather than chosen here.

### 8.1 Parallel approval tally (**D-6 ⛔**)

| Parameter | Options | Note |
| --- | --- | --- |
| Denominator | (a) all assigned approvers; (b) those who responded | (b) lets one responder decide a step of five |
| Majority threshold | (a) `> n/2`; (b) `≥ ⌈n/2⌉` | These differ for even `n` |
| Tie | (a) rejected; (b) pending until another responds; (c) refused at configuration time for even `n` | |
| Non-response at SLA | (a) excluded; (b) counted as rejection; (c) counted as approval | (c) is auto-approval by another name |
| A rejection under "unanimous" | (a) ends the step immediately; (b) all must respond first | |
| "First response wins" | (a) first *decision* of either kind; (b) first *approval*, rejections tallied | |
| A delegate's vote | (a) counts as the delegator's, one vote; (b) counts additionally | (b) lets delegation change an outcome |
| An approver whose membership ends mid-instance | (a) excluded, denominator shrinks; (b) step refuses and escalates | |

**Nothing here may be defaulted.** Each option changes who is approved.

### 8.2 SLA elapsed time (**D-12 ⛔**)

Unit (whole hours or whole days); wall-clock or business time; whose time zone (the tenant's, the
calendar's, UTC); whether the clock starts at instance creation or step assignment; whether it pauses
on reassignment or delegation. Business time needs a calendar contract that does not exist (§3.10).

### 8.3 Escalation level ordering (**D-11 ⛔**)

Whether levels fire cumulatively or replace, whether a level's SLA restarts, and whether the original
approver may still decide after escalation. All unspecified.

### 8.4 The condition language (**D-7 ⛔**)

If branching is approved, the **closed** form proposed for approval is: a condition is a triple
`(key, operator, value)` over `ApprovalRequest.context`, with operators limited to
`equals | not-equals | greater-than | less-than | in`, values typed as string or integer, a **missing
key is a refusal and never a false**, conditions combined only by `all-of`, and the whole condition
stored on the **version** so it is frozen with it. Anything richer — nesting, arithmetic, `or`,
dates, cross-step references — is a workflow-expression language and is not proposed.

---

## 9. Lifecycle model

The specification gives a flow, not a state machine. Every state vocabulary below is **proposed**;
inventing one without approval is a stop condition (§22).

### WorkflowDefinition / WorkflowVersion (**D-18**)

Proposed from the specification's own words plus ADR-0048: `draft → published → archived`. A published
version is **immutable**; a change is a new version. `archived` is terminal for new instances and
changes nothing about instances already running (AD-003). An instance **copies** its steps from the
version at creation, so retiring the version cannot rewrite a running approval.

### WorkflowInstance

Proposed: `running → completed | rejected | cancelled`. Terminal: all three. The specification's
"Archived" is proposed as an **audit disposition of a terminal instance**, not a fourth live state.

### WorkflowStep

Proposed: `pending → in-progress → approved | rejected | skipped | escalated`. Whether `escalated` is
a state or a property of a still-pending step is **open and depends on D-11**.

### ApprovalRequest / ApprovalDecision

`ApprovalPort.ApprovalState` already fixes the vocabulary at the seam: `pending | approved | rejected
| cancelled | expired`. Workflow's own request should not invent a different one. A **decision is
immutable** (D-19) — never amended, reversal only, enforced by trigger as Career's assessments are.

### Unspecified and therefore blocking

- Can a rejected instance be **resubmitted**, or is a new instance required?
- Can a **cancelled** instance be resumed? Who may cancel — requester, approver, administrator?
- Does `expired` end an instance, or return it to `pending` under a new approver?
- May a **published** version be un-published?
- What happens to running instances when a definition is archived — the specification says they
  continue on their version, which implies nothing, and the implication must be stated.

→ **D-6, D-7, D-11** and a lifecycle sign-off are prerequisites of Checkpoint 2.

---

## 10. Self-service and identity

- **Approval queue → the request's own `membershipId`.** Verifiable today (§3.6). No client-supplied
  identifier is accepted, and there is deliberately no `?membershipId=` filter — the absence is the
  control. → **D-13**.
- **"Approvals I have decided"** — same mechanism, same verifiability.
- **Delegation "acting as"** — Identity already answers `identity.active-delegations-for` for a
  `delegateMembershipId`, which the request resolves. A delegate's authority is therefore checkable
  without inventing anything. The **scope** string is opaque by Identity's design; what value Workflow
  passes is part of **D-2**.
- **Manager routing → `NOT VERIFIED`.** Requires principal → employment (**D-14**) and then
  Employment's reporting line. A caller-supplied `managerEmploymentId` is a filter, never a
  credential — the rule Phases 13, 14A and 15 each enforced.
- **"HR" as an approver → `NOT VERIFIED`** (C-2).

---

## 11. Cross-module contract audit

Every dependency Phase 16 would have. **Nothing here is authorized.**

| # | Module | Contract | Permission | Input | Output | Paging | Tenant | Answers the question? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| X-1 | Identity | `identity.active-delegations-for` | `identity.delegation.read` | `delegateMembershipId`, `atInstant: Date` | `readonly DelegationView[]` | **unpaged** — bounded by one delegate's active delegations | tenant-scoped | **Yes** for "who am I acting for". **Note**: it answers *for a delegate*; "who is acting for this absent approver" is the inverse and needs checking against the store's capability at Checkpoint 6 → part of **D-2** |
| X-2 | Employment | `employment.search` | `employment.employment.read` | manager, as-of date, paging | page | paged | tenant-scoped | Answers "who reports to this manager" — but only once the caller's employment is known (**D-14**) |
| X-3 | Employment | `employment.read-employment` | `employment.employment.read` | `employmentId` | one employment | n/a | tenant-scoped | Yes, for confirming an identifier |
| X-4 | Organization | *(does not exist)* — a narrow calendar/working-day query | would be `organization.calendar.read` | calendar, date range | working days + exception days | must be paged or range-bounded | tenant-scoped | **No contract exists.** Only `organization.export-structure` returns calendars, and using a whole-organization export to answer one date question is forbidden → **D-12 ⛔** |
| X-5 | Identity | *(does not exist as a narrow contract)* — membership → primary employment | would be `identity.membership.read` or narrower | `membershipId` | `employmentId?` | n/a | tenant-scoped | `identity.describe-member` returns it inside a wide composite under a broad permission. Adopting it as an identity-resolution contract is **D-14 ⛔** |
| X-6 | *the one adopted module* (D-10) | its existing `decide` command | that module's own approve permission | its own input | its own result | n/a | tenant-scoped | **Yes** — and the actor stays the human approver under a bounded grant (§3.8) |

**Explicitly refused shapes**: no paging through an upstream dataset; no whole-tenant fetch filtered
locally; no use of `employment.export-workforce` or `organization.export-structure`; no reading
another module's Prisma tables; no cross-module foreign key. Every adapter takes `Asking` (`ask` only)
except X-6, which is a **write** and therefore its own decision (**D-9**, **D-10**) with its own
narrowly-named grant.

---

## 12. Completed-module modifications

**None is proposed for default inclusion.** Three are *possible* and each needs its own approval.

**M-1 — the one adopted module (D-10 ⛔).** *Current*: records its own decision; `approval_id` null.
*Required*: request through `ApprovalPort` at submission, store the returned `approvalId` in the
already-reserved column, and accept its existing `decide` command being invoked under a grant.
*Why insufficient today*: nothing requests routing. *Minimal additive change*: write the reserved
column; no new table, no new state, no change to the decision record — precisely ADR-0045's stated
path. *Permission*: unchanged. *RLS*: unchanged. *Backwards compatible*: yes — the column is already
there and nullable. *Tests*: that module's full suite, plus a cross-module suite proving the actor
recorded is the human approver and not a service identity.

**M-2 — a narrow Organization calendar contract (D-12 ⛔, only if business-day SLA is approved).**
*Current*: calendars reachable only through `organization.export-structure`. *Required*: a bounded
"working days between two dates for this calendar" query. *Minimal additive change*: one query, one
permission, no schema change. *Backwards compatible*: yes, purely additive.

**M-3 — a narrow Identity membership → employment contract (D-14 ⛔, only if manager routing is
approved).** *Current*: `identity.describe-member` returns employment links inside a wide composite
under `identity.membership.read`. *Required*: `membershipId → primary employmentId`, so a caller can
resolve **their own** employment without being granted the ability to read any member's full record.
*Minimal additive change*: one query and one narrow permission. *Security impact*: this is the change
that would end the three-phase `NOT VERIFIED` on self-service, so it deserves an ADR of its own rather
than being smuggled in as a Phase 16 convenience.

**Without M-1, Phase 16 delivers an engine with no adopted source and proves its seam only against
its own tests.** That is a real and defensible outcome; it is stated here so it is chosen rather than
discovered.

---

## 13. Infrastructure audit

Table in §3.9. What Phase 16 depends on:

- **`ApprovalPort`** — the phase's own deliverable. **D-8** decides whether it is implemented as
  written.
- **`JobPort`** — required by escalation and SLA firing; **no adapter exists**; not proposed to be
  built here (a scheduler is infrastructure, not workflow). → **D-11 ⛔**.
- **`NotificationPort`** — a stub. Excluded by the specification's Non Goals. → C-11.
- **Event bus / outbox** — in-process, at-most-once, no outbox. **Not correctness-bearing.** → **D-9**.
- **Numbering** — does not exist. Not required. → **D-21**.
- **`StoragePort`, `DocumentPort`, `SearchPort`, `EmailPort`, signature, PDF, OCR** — not required by
  this phase, and none has an adapter.
- **Role/permission directory** — Platform's, never ours. → **D-3 ⛔**.

**No stub is treated as production infrastructure anywhere in this plan.**

## 14. Performance and scale

Budgets **inherited unchanged** from Phases 13–15: queue 100 ms, detail 150 ms, cohort 2 s / 10 s /
60 s at tiers A = 500, B = 10,000, C = 100,000 employments per tenant, two tenants seeded at equal
volume, unprivileged role, `vacuum analyze` after seeding. **No new budget is invented.**

Proposed workloads — every one bounded by an index the migration would create:

| Workload | Budget | Why it is the risky shape |
| --- | --- | --- |
| Pending queue for one member | queue | The screen everybody opens; must not scan instances |
| Pending queue, filtered by definition | queue | Selectivity of a partial index |
| Completed approvals for one member | queue | Grows without bound over time; needs the ordered index |
| Instances by subject (`subjectType`, `subjectId`) | detail | The business module's own lookup |
| One instance with its steps and decisions | detail | Fixed fan-out; must be a bounded number of reads |
| Timeline/history for one instance | detail | Append-only and ordered |
| Instances breaching SLA as of an instant | queue | **The O(n) risk of this phase** — a derived predicate over every open instance. Must reach a partial index on open instances, or it is a sequential scan at tier C |
| Escalation candidates as of an instant | queue | Same shape, same risk |
| Definitions and versions for a tenant | detail | Configuration; flat with headcount |
| Cohort: open instances for 200 subjects | cohort | One query for 200, never one per subject |

Two workloads **cannot be defined until a decision lands**: anything measuring a manager's queue
(**D-14**) and anything measuring a business-day SLA (**D-12**). They are named here so their absence
is visible rather than silent.

## 15. Security and RLS

For every future table: `tenant_id` not null; RLS **enabled and forced**; exactly **one**
`tenant_isolation` policy, `ALL`, permissive, `public`, `(tenant_id = app_current_tenant())` — one
policy per table, because PostgreSQL ORs permissive policies together. Verified by an unprivileged
role with `rolsuper = false` and `rolbypassrls = false` asserted first. **No security claim may come
from a superuser-based test.**

Scope rules:

- **Actor scope** — the queue is the caller's own membership (**D-13**). No client-supplied identifier.
- **Ownership scope** — only an assigned approver (or their active delegate) may decide a step.
- **Manager scope** — `NOT VERIFIED` (**D-14**).
- **Delegated scope** — authority derives from Identity's period, evaluated at the instant of the
  decision, never from a cached "active" flag. Identity's own comment makes this point.
- **Exact-ID behaviour** — an instance the caller may not see answers **404, never 403**: for an
  approval, confirming that a request exists for a named subject is itself disclosure, exactly as
  Career reasoned about a succession bench.
- **Count leakage** — a queue count must carry the same predicate as its page.
- **Cross-tenant mutation and tenant-move** — refused, and proven.

**Cannot be proven today**: that the person deciding *is* the assigned approver in any sense richer
than "holds this membership", because there is no attestation beyond Platform's principal; and
anything manager-scoped. Both are `NOT VERIFIED`, not deferred design.

## 16. Exactness and dates

Career and Learning hold **no `numeric`, `double precision`, `real`, `bigint` or `money`**, and Phase
16 proposes the same: every number is a small bounded integer — a step ordinal, an escalation level, an
SLA duration, an approval count. No value approaches `Number.MAX_SAFE_INTEGER`, so no string-preserving
path is required. If any decision introduces one, that is a stop condition (§22).

Temporal rule (**D-20**): a request, a decision, an assignment and an SLA are **instants**
(`timestamptz`), because "was this decided before the deadline" is a question about a moment, and
Attendance settled that instants are for events. A **civil date** (`YYYY-MM-DD` string, no `Date` above
the repository) is used only where a human states a day — a delegation period, an effective date on a
definition. The two are never mixed in one column, asserted by column type across all tables.

One conflict is already known: `identity.active-delegations-for` takes `atInstant: Date`, and
`ApprovalPort` returns `Date`. Both are existing seams. The rule proposed is that `Date` **does not
cross into Workflow's own contracts** — it is converted at the adapter and at the port implementation,
and nowhere else.

## 17. Phase size

| | Definitions | Instances | Approvals | Config | Total tables (est.) |
| --- | --- | --- | --- | --- | --- |
| Aggregate roots named | `WorkflowDefinition`, `WorkflowVersion`, `WorkflowStep` (template) | `WorkflowInstance`, step instance, `WorkflowHistory` | `ApprovalRequest`, `ApprovalDecision`, step assignment | `ApprovalGroup` + members, `EscalationRule`, `SLARule` | |
| Est. tables | 3 | 3 | 3 | 4 | **~13** |

Plus roughly **30–36 commands**, **14–18 queries**, **18–24 permissions**, **1–3 cross-module
adapters**, **10–13 controllers**, **4–6 Admin workspaces**, 1 migration.

By table count that is Career-sized. **By behaviour it is not.** Career had no branching, no tally
arithmetic, no timing rules and no cross-module write. Phase 16 has all four, and the last one is the
first cross-module *write* since ADR-0046.

**Recommended split (D-17 ⛔ — the user's call; the specification defines no sub-phases):**

- **16A — the engine.** Definition, version, instance, step, approval request, decision, assignment,
  queue, history. Single and sequential approval. Delegation **consumed** from Identity. `ApprovalPort`
  implemented. One adopted module proving the seam. ~9 tables.
- **16B — routing intelligence.** Approval groups, parallel tallies, escalation, SLA, conditional
  branching, further adoptions. ~4 tables and every unresolved formula.

The split is recommended precisely because **every blocking arithmetic and language decision (D-6,
D-7, D-11, D-12) falls in 16B**, so 16A can proceed on decisions that are answerable from the
repository, while 16B waits for parameters only the user can set.

## 18. Exclusions

From the specification's own Non Goals: notifications, email, SMS, push, business rules, payroll,
leave, attendance, recruitment logic. From AD-005: **External API approvers** ("future").

Additionally excluded, with the owner named:

Analytics and reporting aggregates (Phase 20) · notification delivery (Phase 17) · a scheduler or job
runner (infrastructure, no port adapter) · a role or permission engine (Platform, ADR-0001) · a
delegation register (Identity, Phase 2) · document storage and signatures (no adapter) · employee and
manager self-service portals (Phases 18–19) beyond the caller's own queue · migrating any module's
historical decisions into Workflow · a second decision record for any business fact · an expression
language beyond whatever D-7 approves · **Phase 17**.

## 19. Preliminary NOT VERIFIED register

| Capability | Missing dependency | Why it cannot be honestly verified | Deferred | Blocking decision | Needs future infrastructure |
| --- | --- | --- | --- | --- | --- |
| Automatic escalation on SLA breach | `JobPort` adapter | Nothing runs when nobody is asking | no | **D-11 ⛔** | yes |
| Automatic delegation expiry | `JobPort` adapter | Identity's `expire()` exists; nothing calls it on a timer | no | D-11 | yes |
| Manager approver / Manager escalation | principal → employment | A supplied manager identifier is not proof of identity | no | **D-14 ⛔** | contract |
| Role approver / HR escalation | a role directory | No role model, and never will be | no | **D-3 ⛔** | no — refused by decision |
| External API approver | — | The specification defers it | **yes** | no | yes |
| Notification of assignment, escalation or outcome | `NotificationPort` adapter | The stub records; nothing is delivered | **yes** (Phase 17) | no | yes |
| Business-day SLA | Organization calendar contract | Only a whole-organization export exposes calendars | no | **D-12 ⛔** | contract |
| Conditional branching / dynamic routing | an approved condition form | No expression language is specified | no | **D-7 ⛔** | no |
| Majority / unanimous / first-response outcomes | approved arithmetic | Denominator, ties and abstention are all unspecified | no | **D-6 ⛔** | no |
| Workflow analytics | Phase 20 | An aggregate over a population is analytics | **yes** | no | no |
| Asynchronous business-domain callback | an outbox | At-most-once delivery cannot carry correctness | no | **D-9 ⛔** | yes |
| Adoption by the other ten source modules | per-module approval | Each is a completed module | no | **D-10 ⛔** | no |

**None of these may ship a placeholder success state.** The Phase 15 standard applies: the screen and
the API say `NOT VERIFIED`, in both languages, rather than showing an empty table somebody reads as
"nothing to escalate".

## 20. Testing strategy

**Domain** — every proposed transition and every refusal; a version frozen at publish and an instance
unaffected by archiving it (AD-003/D-18); an unlimited step count with no hardcoded ceiling (AD-004);
step ordinals at their bounds; a decision that cannot be amended; a cycle refused; the tally rule
exactly as approved, including its ties and its absences.
**Schema** — migration up; RLS enabled *and* forced on every table with exactly one policy each; check
constraints; the immutability trigger; partial unique indexes (one open request per subject; one open
assignment per approver per step); **no foreign key leaving the module**; no `numeric`/`float`/`bigint`;
`date` vs `timestamptz` asserted per column.
**Application** — one permission per handler proved by granting a caller *every other* Workflow
permission and asserting refusal; paging bounds; optimistic concurrency; in-memory/PostgreSQL store
parity (the Phase 15 P3 defect was exactly this disagreeing).
**PostgreSQL** — transaction ownership; two real connections racing a decision on the same step, with
one winner and a 409; no sleeps and no disabled constraints; exact values through the real mappers;
captured query plans.
**Cross-module** — as an **unprivileged role**: delegation resolved through Identity; dependency
failure is a refusal and never a silent default; tenant isolation across every adapter; malformed
identifiers; and — for X-6 — that the actor recorded in the business module is **the human approver**,
proved against that module's `system:auto-approval` check constraint.
**API** — 400/403/404/409/422 mapped through the shared Problem Details filter; named lifecycle
sub-resources, no generic status `PATCH`; exact-ID isolation answers **404, not 403**; pagination
bounds; no `/workflow/me`-style route beyond the queue that resolves from the request itself.
**Admin** — fixed request budget independent of data volume, asserted; no N+1; en + ar with `dir="rtl"`;
exact integers with no separator or localized digit; `NOT VERIFIED` stated honestly for every row in
§19, with negative assertions narrowed to headings and labels so they cannot match the refusal notice
itself (the Phase 15 T7 defect).
**Performance** — §14, three tiers, second tenant at equal volume.
**Isolation** — the safe pinned run (`--concurrency=1`) is the result; the default-concurrency run is
reported as the known-failing experiment and **never called green**.

## 21. Checkpoint plan

The established ten-checkpoint sequence fits, with **one addition**: the port and the adoption seam
(the first cross-module *write* since ADR-0046) is its own checkpoint rather than a corner of the
adapter checkpoint, because it is the only place a Phase 16 defect can corrupt a completed module.

| # | Objective | Allowed | Prohibited | Gates | Expected tests | STOP if | Deliverable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Definition of Ready** | documentation only | all source | standards | — | the specification is missing or ambiguous | this plan |
| 2 | **Domain** | `src/domain` | schema, application, adapters | standards, unit | transitions, refusals, bounds, tally | any lifecycle state or formula is unapproved | pure aggregates |
| 3 | **Schema** | migration, `schema.prisma` | application, API | standards, architecture, migration | RLS, constraints, indexes, triggers | a column exists for a `NOT VERIFIED` capability | one migration |
| 4 | **Application** | `src/application`, `src/contracts` | infrastructure, API | standards, unit | authorization, paging, concurrency, parity | a handler needs a contract that does not exist | commands, queries, ports |
| 5 | **PostgreSQL repositories** | `src/infrastructure` | API, Admin | standards, integration | RLS, races, exactness, plans | a race is arbitrated in application code rather than by an index | stores + parity |
| 6 | **Cross-module adapters** | `apps/api/src/workflow/*-sources.ts` | business-module source | standards, integration | delegation, isolation, failure paths | a required contract is missing (X-4, X-5) | adapters under bounded grants |
| 7 | **The port and the seam** | `ApprovalPort` implementation; the one adopted module (M-1) | any other module | standards, integration | actor preservation, idempotency, recoverable partial state | D-8, D-9 or D-10 is unapproved | a proven seam, or a documented refusal |
| 8 | **API** | `src/api`, `apps/api/src/workflow` | Admin | standards, e2e | status mapping, isolation, concurrency | a lifecycle needs a generic status mutation | controllers |
| 9 | **Admin UI** | `apps/admin/src/workflow` | API/application changes | standards, render | budget, RTL, exactness, honesty | a screen would imply a capability from §19 | server-rendered screens |
| 10 | **Performance, security & integration audit** | benchmark scripts | production source | full verify | three tiers, unprivileged role | a budget would have to move | measured report |
| 11 | **Final report & closing audit** | documentation | all source | full verify | — | any number disagrees with the repository | final report |

Each checkpoint ends by stopping for approval, per `work prompts/27_DEVELOPMENT_PROTOCOL.md`.

## 22. Stop conditions

Implementation **must stop and report**, never silently reconcile, if:

1. the authoritative specification cannot be determined, or a second Phase 16 document appears;
2. a scope item's domain ownership conflicts with `DOMAIN_OWNERSHIP.md` or a shipped module;
3. a tally, threshold or SLA formula is required and unapproved (**D-6, D-11, D-12**);
4. a lifecycle state or transition is needed that §9 does not list and no approval covers;
5. a condition or routing expression beyond D-7's approved closed form is required;
6. a cross-module contract is missing and the only alternative is a broad export or an unbounded read;
7. a completed module would change without the specific approval named in §12;
8. self-service or manager routing would rest on a client-supplied identifier;
9. required infrastructure is absent and a stub would stand in for it;
10. a performance budget cannot be defined from the inherited set, or a workload misses and the
    proposed fix is to move the budget;
11. a security invariant cannot be proven as an unprivileged role;
12. an exactness or date semantic is ambiguous, or a value exceeds the safe integer range;
13. the phase exceeds its planned size and no split has been approved (**D-17**);
14. the audit finds any `NOT VERIFIED` capability partially implemented.

## 23. Definition of Done

`pnpm standards` and `pnpm verify --force` green at the pinned concurrency, zero skipped; architecture,
localization (en + ar complete), and dependency checks green; RLS enabled and forced on every new
table with exactly one policy each, proven unprivileged; benchmarks at three tiers within inherited
budgets with no budget moved and no index added to flatter a fixture; every §19 capability stated
honestly in the API and the Admin screen; a final report whose every number is counted from the
repository; `docs/PHASES.md`, `docs/RELEASE_NOTES.md`, `docs/DOMAIN_OWNERSHIP.md`,
`docs/modules/workflow.md` and `docs/adr/README.md` updated; no completed module changed beyond what
§12 records as approved.

---

# APPROVAL REQUIRED

### BLOCKING

- **D-2** — Workflow consumes Identity's delegation and owns no delegation row (C-1).
- **D-3** — An approval group is an explicit list of memberships; "Role" and "HR" approvers are
  `NOT VERIFIED` (C-2).
- **D-4** — Approver kinds shipped: `membership` and `group` only (C-8).
- **D-6** — The parallel tally arithmetic, parameter by parameter (§8.1). **No default may be taken.**
- **D-7** — Conditional branching and dynamic approvers: approve the closed condition form in §8.4, or
  defer branching entirely (C-6).
- **D-8** — Implement `ApprovalPort` as written rather than amending the kernel port (C-9).
- **D-9** — The decision reaches the business module synchronously inside the approver's own request,
  under a bounded grant, with idempotent reconciliation; no event carries correctness (C-3).
- **D-10** — Which business module, if any, adopts Workflow in this phase (C-10).
- **D-11** — Escalation and SLA are derived on read and reassigned by a bounded administrator command;
  automatic firing is `NOT VERIFIED` (C-4).
- **D-12** — SLA is elapsed time, not business days, unless M-2 is authorized (C-15).
- **D-14** — Manager routing is not built in this phase; `manager` approvers are `NOT VERIFIED`.
- **D-17** — Whether Phase 16 is split into 16A (engine) and 16B (routing intelligence) (C-13).

### COMPLETED-MODULE CHANGES REQUIRING EXPLICIT APPROVAL

- **M-1** — The one adopted module writes its reserved `approval_id` and accepts its existing `decide`
  command being invoked under a bounded grant. **No table, state or decision-record change.**
  Requires D-9 and D-10. *Not proposed for default inclusion.*
- **M-2** — An additive narrow calendar/working-day query on **Organization**. Required only if a
  business-day SLA is approved (D-12).
- **M-3** — An additive narrow membership → primary-employment query on **Identity**. Required only if
  manager routing is approved (D-14). Deserves its own ADR: it would end the self-service
  `NOT VERIFIED` carried since Phase 13.

### RECOMMENDED / NON-BLOCKING

- **D-1** greenfield module layout · **D-5** duplicate and cycle refusal by index and domain rule ·
  **D-13** the queue resolves from the caller's own membership · **D-15** `WorkflowProjection` derived
  on read until a benchmark says otherwise · **D-16** bounded operational reads, no analytics ·
  **D-18** a published version is immutable and an instance copies its steps · **D-19** a decision is
  never amended · **D-20** instants for events, civil dates for stated days · **D-21** no
  human-readable reference · **D-22** Workflow's domain events stay internal.

**No Phase 16 implementation may begin until all BLOCKING decisions are explicitly approved.**

A recommendation in this document is not an approval, and the absence of an objection is not an
approval. Where a decision is refused, the dependent capability becomes `NOT VERIFIED` rather than
being approximated.
