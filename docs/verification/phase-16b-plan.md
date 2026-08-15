# Phase 16B — Definition of Ready

## Status

**NOT READY.**

Fourteen decisions block implementation. Four of them are blocked not by a missing parameter but by a
missing *contract or port that does not exist anywhere in this repository* — and in one case the
missing thing has been described in five modules' comments as though it existed.

This document is the Definition of Ready only. **No Phase 16B source, schema, migration, dependency,
adapter, route or screen was created**, and no completed module was touched. Where the approved
specification and the repository disagree, the repository is quoted and treated as the authority.

---

## Source Specification

`docs/PHASES.md` names the Phase 16 specification, and `docs/verification/phase-16-plan.md` §1 records
it as *"Munaxa Work / Phase 16 – Enterprise Workflow & Approvals", Version 1.0, Status **Approved***.
No separate Phase 16B specification exists. Phase 16B is therefore defined by three things, in this
order of authority:

1. **The approved Phase 16 plan's §17**, which proposes the split and names 16B's contents:
   *"approval groups, parallel tallies, escalation, SLA, conditional branching, further adoptions.
   ~4 tables and every unresolved formula."*
2. **The approved plan's §18 Exclusions**, which removes several candidates from Phase 16 entirely
   (below).
3. **The final Phase 16A repository**, which is what any 16B work must actually build on.

**The split itself (D-17 of the Phase 16 plan) was never formally approved.** It was recommended,
16A was then built and completed against it, and this document proceeds on the same recommendation —
but a reviewer should note that the sub-phase boundary is still, strictly, an unratified proposal.

### What the approved specification already excludes from Phase 16

§18 names these with their owner, so they are **not** 16B candidates unless the user explicitly
overrides the approved plan:

| Excluded | Owner named by §18 |
| --- | --- |
| Notification delivery, email, SMS, push | **Phase 17** (Communications) |
| Analytics and reporting aggregates | **Phase 20** |
| A scheduler or job runner | infrastructure — "no port adapter" |
| A role or permission engine | **Platform**, ADR-0001 |
| A delegation register | **Identity**, Phase 2 |
| External API approvers | the specification's own AD-005: *"future"* |
| An expression language beyond whatever D-7 approves | — |

The user's brief lists notifications, analytics, external approvers and outbox/broker among the
Phase 16B candidates. **The approved specification places all four outside Phase 16 altogether.**
They are carried below as decisions so the conflict is explicit rather than silently resolved, and
each is recommended to remain `NOT VERIFIED`.

---

## Repository Findings

Everything below was read from the final tree at `6980645`, not from a checkpoint report.

### Workflow, as Phase 16A left it

7 tables · 7 Prisma models · 22 indexes (7 partial unique) · 31 check constraints · 9 foreign keys,
none leaving the module · 2 immutability triggers · 6 repositories · 9 commands · 8 queries · 17
handlers · 7 permissions · 4 controllers · 17 routes · 11 Admin sections · 1 migration.

Aggregates: definition (with versions and step templates), instance (with steps), decision, history.
`workflow_instance.context` is `jsonb NOT NULL`, **stored for audit and read by nothing** — the only
candidate operand a branching condition could reference.

### Finding 1 — three shipped invariants forbid parallel approval

This is the most consequential discovery, and it is structural rather than a matter of taste.

```
workflow_step_ordinal_idx    UNIQUE (tenant_id, instance_id, ordinal)          WHERE deleted_at IS NULL
workflow_step_awaiting_idx   UNIQUE (tenant_id, instance_id)                   WHERE status = 'awaiting' AND deleted_at IS NULL
workflow_decision_step_idx   UNIQUE (tenant_id, step_id)                       WHERE deleted_at IS NULL
```

Together they enforce: **one step per ordinal, at most one awaiting step per instance, and exactly
one decision per step.** The domain agrees — `awaitingStep()` returns
`WorkflowStepState | undefined`, `WorkflowInstanceDetailView.awaiting` is singular, and
`ApprovalStatusView.steps` maps one approver to one step.

Every shape of parallel approval collides with at least one of them:

| Parallel model | Collides with |
| --- | --- |
| Several steps awaiting at once | `workflow_step_awaiting_idx` |
| Several steps sharing an ordinal (a "branch level") | `workflow_step_ordinal_idx` |
| One step, several approvers, several decisions | `workflow_decision_step_idx` |

Parallel approval is therefore **not additive to 16A**. It requires altering shipped uniqueness
guarantees that 16A's concurrency suites currently rely on — which makes D-4 and D-21 blocking
together, and makes the migration a *change* to existing indexes rather than only new tables.

### Finding 2 — `JobPort` does not exist

Five modules (Letters, Performance, Career, Learning, Workflow) carry comments reading *"`JobPort`
has no adapter"*, and `docs/modules/*.md` repeats the phrase. A search of every `.ts` in `packages/`
and `apps/` finds **no `JobPort` interface, type, file or import**. `packages/kernel/src/ports/`
contains exactly `approval.ts`, `authentication.ts`, `document.ts`, `notification.ts` and `index.ts`.

The repeated phrase is inaccurate and has been since roughly Phase 11: there is no port to adapt.
Anything in 16B requiring scheduled execution needs the **port designed, the durability and
at-most-once semantics decided, and a runner built** — not an adapter wired. That is a materially
larger dependency than the Phase 16 plan's §3.9 implies, and it is the reason SLA firing, escalation
firing, reminders and automatic expiry are grouped together in the split recommended below.

*This documentation inaccuracy is recorded as debt; correcting five modules' comments is not
authorized here.*

### Finding 3 — `NotificationPort` exists; delivery does not

`packages/kernel/src/ports/notification.ts` declares `NotificationPort.notify(request)` with a
`templateKey`, recipients as `userId`, variables, a correlation identifier and an optional
`idempotencyKey`.

Its **only** implementation is `RecordingNotificationPort` in
`packages/kernel/src/adapters/in-process-ports.ts`, which pushes onto an in-memory array and
de-duplicates by scanning it. It is **not durable, not delivered, not retryable, and lost on process
restart.** Eight modules state in comments that they deliberately compose no `NotificationPort`.

So notification delivery is not "missing an adapter" — it is missing durability, delivery, retry and
failure semantics, all of which Phase 17 owns.

### Finding 4 — no role, group or permission directory exists

No table in the 175-table schema is a role, group or permission directory. (`payroll_group` is a
payroll batching construct, not a security group.) Identity publishes five queries —
`identity.active-delegations-for`, `identity.describe-member`, `identity.list-invitations`,
`identity.list-memberships`, `identity.search-members` — and **none of them answers "who holds role X"
or "which memberships are in group X".** The repository's standing commitment (ADR-0001, and the
Phase 16 plan §3.5) is that a role or permission engine belongs to Platform and is never built here.

### Finding 5 — manager routing is *nearly* answerable, and the gap is exactly one query

The reporting line is real: `employment_reporting_line` carries `manager_employment_id`,
`line_type`, `effective_from` and `effective_to`, and `employment.read-employment(employmentId, asOf?)`
returns an `EmploymentSnapshot` whose `reportingLine?: ReportingLineView` exposes
`managerEmploymentId`. That is a bounded, effective-dated, exact-identifier read.

`identity.describe-member(membershipId)` returns `employments: EmploymentLinkView[]`, and
`EmploymentLinkView` carries `isPrimary` — so a membership's primary employment is a stored,
published fact.

The chain a `manager` approver kind needs is therefore:

1. approver membership → their employments — `identity.describe-member` ✅ (composite; also returns
   profile, preferences, portals and delegations, so it over-returns)
2. employment → manager's employment — `employment.read-employment` ✅
3. **manager's employment → manager's membership — no published query exists** ❌

Step 3 is the entire gap. Workflow steps name memberships, so without it a resolved manager cannot be
assigned to a step. No query anywhere accepts an `employmentId` and returns memberships; the reverse
direction is published, the forward direction is not.

### Finding 6 — a calendar exists, holidays are not published

`organization_calendar` and `organization_calendar_day` both exist.
`OrganizationCalendarView` publishes `timeZone` and `workingDays` (ISO weekdays, Monday 1 – Sunday 7)
and is returned inside `organization.export-structure` — a **whole-organization export**, which also
carries every unit, placement, legal entity, position and establishment.

`CalendarDayView` — `onDate`, `kind`, `name`, i.e. the holidays and exceptions — is **declared as a
published type and returned by no query at all.** It appears in `contracts/index.ts` and
`contracts/views.ts` and nowhere else.

So: weekends are obtainable only by exporting the organization; **holidays are obtainable by nothing.**
A business-day calculation is not implementable against today's contracts.

### Finding 7 — nothing consumes `ApprovalPort`, including after 16A

`WorkflowApprovals implements ApprovalPort` and `workflowApprovalPortFor` is exported — and
**referenced by nothing**. Six modules' dependency files state they deliberately compose no
`ApprovalPort`; the only adapter that has ever been wired is `AutoApprovingPort`, which approves
everything as `system:auto-approval`.

Recruitment's adoption in 16A went the **other** way: Workflow calls Recruitment's existing
`recruitment.decide-requisition` through Workflow's own outbound `BusinessDecisionPort`. The inbound
port is still unproven end-to-end.

Adoption candidates are plentiful — eleven `decide`/`approve` commands exist across Attendance,
Career, Compensation, Leave, Letters, Organization, Payroll, Performance and Recruitment — and three
modules (Compensation, Leave, Payroll) already publish their chain *in `ApprovalPort`'s shape*.

---

## Existing Phase 16A Boundary

Delivered: definitions, versions, sequential chains, instances, steps, decisions, history, the
caller's own queue, delegation consumed from Identity, `ApprovalPort` implemented, the Recruitment
adoption seam, synchronous bounded business-decision delivery, PostgreSQL persistence, API, Admin UI,
and the performance/security/concurrency audit.

Deliberately absent, with no column, port, route, screen or placeholder: parallel approval, tallies,
majority, unanimous, quorum, first-response, conditional branching, roles, groups, manager routing,
SLA, business days, escalation, scheduling, automatic delegation expiry, notification delivery,
external approvers, analytics, asynchronous callbacks, outbox and broker.

`expired` exists in the kernel's `ApprovalPort` vocabulary and 16A never produces it.

---

## Proposed Phase 16B Scope

**A further split is recommended, and the seam is real rather than tidy.**

### Phase 16B — Routing core

Approval groups (as an explicit membership list), parallel steps, tally arithmetic, parallel terminal
rules, and conditional branching over a closed condition form.

**Every decision it needs is a parameter the user sets.** It requires **no new port, no scheduler, no
completed-module contract change and no new infrastructure.** It does require altering three shipped
uniqueness invariants (Finding 1), which is a Workflow-internal migration.

### Phase 16C — Routing intelligence

SLA, business days, escalation, manager routing, role/group routing beyond an explicit list, and any
scheduled firing.

**Every one of these is blocked on something that does not exist**: a `JobPort` that was never
written (Finding 2), an Organization holiday contract that is declared but unreturned (Finding 6), or
an Identity employment→membership query that has no counterpart (Finding 5). Two of the three are
completed-module authorizations; the third is new shared infrastructure.

### Why this split rather than the user's proposed one

The user's sketch places manager and role/group routing in the second half, which matches. It also
places *branching* in the first half, which matches. The evidence that makes the seam architectural
rather than cosmetic is that the two halves fail for **different reasons**: 16B-core is blocked only
by *unanswered questions*, and 16C is blocked by *absent contracts and absent infrastructure*.
Approving 16B-core unblocks work immediately; approving 16C unblocks nothing until three separate
authorizations land.

**Dependency order:** 16B-core first. Parallel steps and tally arithmetic change the step and
decision model, and SLA, escalation and manager routing all attach to *a step*. Building 16C first
would attach timing rules to a step model that 16B-core then reshapes.

**Independent value:** 16B-core alone delivers "two directors must both approve this" and "route
differently above SAR 50,000" — the two capabilities most commonly asked of an approval engine, and
neither needs a clock. 16C alone delivers nothing without 16B-core, because there is no parallel step
for an SLA to attach to beyond what 16A already has.

**Recommendation, requiring approval:** split. If the user declines, Phase 16B carries all fourteen
blocking decisions and three completed-module authorizations at once.

---

## Decisions

Fourteen blocking, four resolved-by-exclusion, three resolved. **A recommendation is not an
approval.**

### D-1 — Delegation ownership and expiry — **RESOLVED (ownership) / see D-11, D-16 (expiry)**

*Question.* Does Identity continue to own delegation, and does 16B need automatic expiry?

*Repository evidence.* Identity owns the `delegation` table and publishes
`identity.active-delegations-for`. 16A consumes it under `identity.delegation.read` and stores no
delegation state, asking at the instant of each decision. Verified across 26 delegation tests.

*Specification evidence.* Phase 16 plan D-2 ⛔, resolved during 16A: Workflow does not own delegation.

*Recommendation.* **Ownership stays with Identity — settled, no further decision needed.**
Automatic expiry is **not required**: asking at the instant of the decision already produces correct
behaviour for a delegation that has ended, and 16A proved it. A scheduled expiry sweep would add a
scheduler dependency to obtain an answer the read already gives.

*Consequence of the alternative.* Storing an expiry transition means a second source of truth for a
fact Identity owns, and it goes stale the moment Identity revokes a delegation early.

*Blocks implementation:* no. *Modifies a completed module:* no. *Authorization required:* no.

### D-2 — Which approver kinds ship — ⛔ **BLOCKING**

*Question.* Which of `membership`, `group`, `role`, `manager`, `external` does 16B support?

*Repository evidence.* `APPROVER_KINDS = ['membership']`, enforced by two check constraints
(`workflow_step_approver_kind_check`, `workflow_step_template_approver_kind_check`). `group` needs a
definition (D-3). `role` has no directory anywhere (Finding 4). `manager` is missing exactly one
query (Finding 5). `external` has no identity representation at all.

*Specification evidence.* AD-005 names seven kinds. Phase 16 plan D-4 ⛔ recommended
`membership` + `group` only.

*Options.* (a) `membership` + `group`; (b) add `manager`, accepting an Identity authorization;
(c) add `role`, requiring a directory this repository has committed never to build.

*Recommendation.* **(a)**, with `manager` moved to 16C behind D-13 and `role` and `external` remaining
`NOT VERIFIED`.

*Consequence.* (b) makes 16B depend on a completed-module change. (c) contradicts ADR-0001 and the
plan's §3.5.

*For each kind:* resolution path, contract, permission, boundedness, snapshot-or-live, tenant
semantics and the no-approver case are all **undecided** and must be stated per kind before
Checkpoint 2.

*Blocks:* yes. *Modifies a completed module:* only under (b) or (c). *Authorization:* yes.

### D-3 — Group semantics — ⛔ **BLOCKING**

*Question.* What is an approval group: an explicit list of memberships, a role-like construct, a
static list, a dynamic query, Workflow-owned or Identity-owned?

*Repository evidence.* No group table or contract exists anywhere (Finding 4). Nothing in Identity
could answer "which memberships belong to group X".

*Recommendation.* **A Workflow-owned, explicit, static list of memberships** — a
`workflow_approval_group` and `workflow_approval_group_member` pair, tenant-scoped, with no query
semantics and no inheritance. This keeps the repository's commitment not to build a directory while
delivering the capability the specification names.

*Consequence.* A dynamic query group is a directory by another name and needs Platform. An
Identity-owned group is a completed-module change and a new Identity aggregate.

*Open sub-question that must be answered with it:* is a group's membership **snapshotted onto the
instance when it starts, or read live at each decision**? Snapshot is consistent with 16A's rule that
an instance copies its steps from the version; live means a group edited mid-approval changes who may
decide. See D-21.

*Blocks:* yes. *Modifies a completed module:* no under the recommendation. *Authorization:* yes.

### D-4 — Parallel approval semantics — ⛔ **BLOCKING**

*Question.* What does parallel approval mean structurally?

*Repository evidence.* **Finding 1** — three shipped unique indexes and the singular `awaitingStep()`
each forbid a different parallel shape. Whichever model is chosen, at least one shipped invariant must
be altered, and 16A's concurrency suites assert the current ones.

*Undecided, all of it:* whether all branches start simultaneously; whether each step carries an
independent decision; whether branches are ordered; whether one step may have several approvers;
whether one approval request has several actors; and how a delegated decision interacts with a
parallel step (which is the interaction most likely to be got wrong, because 16A records the delegate
as actor and the approver as authority — under a tally, whose vote is it?).

*Recommendation.* **A branch is a set of steps sharing an ordinal**, each with one approver and one
decision, so `workflow_decision_step_idx` survives untouched and only the two step indexes change.
This preserves 16A's "one decision per step" audit guarantee, which is the invariant most expensive
to lose.

*Blocks:* yes. *Modifies a completed module:* no. *Authorization:* yes.

### D-5 — Tally arithmetic — ⛔ **BLOCKING**

*Question.* The exact formulae for majority, unanimous, quorum and first-response.

*Repository evidence.* **No formula exists anywhere in the repository.** ADR-0069 is the governing
precedent: a score is an integer and an absence is not a zero. Phase 16 plan §8.1 tabulated eight
parameters and stated *"Nothing here may be defaulted. Each option changes who is approved."*

*The parameters, still unanswered, per rule:*

| Parameter | Options |
| --- | --- |
| Denominator | all assigned approvers / only those who responded |
| Majority threshold | `> n/2` / `≥ ⌈n/2⌉` (these differ for even `n`) |
| Tie | rejected / pending until another responds / refused at configuration time for even `n` |
| Non-response | excluded / counted as rejection / counted as approval |
| A rejection under "unanimous" | ends the step immediately / all must respond first |
| First-response | first decision of either kind / first approval, rejections tallied |
| A delegate's vote | counts as the delegator's single vote / counts additionally |
| Approver whose membership ends mid-instance | excluded, denominator shrinks / step refuses |
| Quorum | absolute integer / proportion; and what happens when it cannot be met |
| Minimum voters | is a one-approver "majority" legal? |
| Weights | none / per approver |
| Percentages | forbidden / permitted |

*Recommendation.* **Integer arithmetic only, no weights, no percentages** — consistent with ADR-0069
and with Workflow's schema, which has no `numeric` column and should not gain one. Beyond that, every
row above is the user's to set. A "reasonable" default here silently decides who is approved.

*Blocks:* yes — this is the single largest blocker. *Modifies a completed module:* no.
*Authorization:* yes, per parameter.

### D-6 — Parallel terminal states — ⛔ **BLOCKING**

*Question.* When does a parallel step become terminal, and what happens to the steps still pending?

*Repository evidence.* 16A's `WORKFLOW_STEP_TRANSITIONS` permits `awaiting → approved | rejected |
skipped`, and cancellation already skips remaining steps. There is no `superseded` state and no
`escalated` state.

*Undecided.* Whether a step ends when all required decisions arrive, when a majority is reached early,
when a rejection makes success arithmetically impossible, when quorum is met, or on first response.
And whether the remaining pending steps are **cancelled, skipped, left awaiting, or recorded as
superseded** — where `skipped` reuses 16A's vocabulary and `superseded` needs a new one.

*Recommendation.* **Early termination the moment the outcome is arithmetically determined**, with
remaining steps moved to `skipped`, reusing the existing vocabulary and the existing history event
`step-skipped`. Leaving them awaiting would leave a decided approval on somebody's queue — the exact
failure 16A's `skipped` state exists to prevent.

*Blocks:* yes. Depends on D-5. *Authorization:* yes.

### D-7 — Conditional branching — ⛔ **BLOCKING**

*Question.* Is branching in scope, and if so what is the condition form?

*Repository evidence.* No expression language exists. ADR-0049 records that Onboarding is
deliberately not a workflow engine. `workflow_instance.context` is `jsonb NOT NULL`, stored and read
by nothing — the only available operand source.

*Recommendation.* The Phase 16 plan §8.4 already proposed a **closed** form for approval, and it
remains the right one: a condition is a triple `(key, operator, value)` over the instance's
`context`, operators limited to `equals | not-equals | greater-than | less-than | in`, values typed
as string or integer, **a missing key is a refusal and never a false**, conditions combined only by
`all-of`, and the whole condition stored **on the version** so it freezes with it.

*Consequence of anything richer.* Nesting, arithmetic, `or`, dates or cross-step references make this
a workflow-expression language, which is its own product with its own validation, testing and
security surface.

*Still undecided:* whether conditions may reference **business-module data** rather than `context`.
Recommendation: **no** — that would make Workflow read a business module during routing, which
contradicts AD-001 and would put a cross-module read on the hot path of every step transition.

*Blocks:* yes. *Authorization:* yes.

### D-8 — SLA definition — ⛔ **BLOCKING**

*Question.* What starts and ends the clock, and at what granularity?

*Repository evidence.* Workflow has **no due-time column and no elapsed field**. All temporal columns
are `timestamptz`; there is no `date` column and no `numeric` (Phase 16A exactness audit).

*Undecided.* Whether the clock starts at instance creation or step assignment; whether it applies per
instance or per step; whether delegation pauses or resets it; whether cancellation and rejection stop
it; whether escalation is driven by elapsed time or a stored due date; and **whether the due-ness is
stored or derived on read**.

*Recommendation.* **Derived on read against a stated instant**, exactly as Career derives `reviewDue`
and Learning derives requirement currency — because a stored flag needs something to maintain it and
nothing maintains anything (Finding 2). Per **step**, started at assignment, unaffected by delegation
(a delegate answers the same step).

*Blocks:* yes. *Authorization:* yes.

### D-9 — Business days — ⛔ **BLOCKING, and contract-blocked**

*Question.* Is an SLA elapsed wall-clock time or business days?

*Repository evidence.* **Finding 6.** `workingDays` and `timeZone` are published only inside
`organization.export-structure`, a whole-organization document. `CalendarDayView` — the holidays — is
a published type **returned by no query**. There is no bounded calendar contract.

*Options.* (a) **Elapsed wall-clock time**, needing nothing new; (b) **business days**, requiring a
new bounded Organization query.

*Recommendation.* **(a) for 16B/16C as scoped.** If the user requires business days, the minimum
additive Organization contract is stated under *Completed-Module Contract Changes* and must be
authorized separately — it is not proposed here and must not be built during Definition of Ready.

*Also undecided under (b):* weekends per tenant or per unit calendar; whose time zone; inclusive or
exclusive boundaries; and whether the calculation is civil-date or instant based. 16A holds **no
civil date at all**, so introducing one is a modelling decision, not a detail.

*Blocks:* yes. *Modifies a completed module:* **yes, under (b)**. *Authorization:* yes under (b).

### D-10 — Escalation — ⛔ **BLOCKING**

*Question.* What escalation means, and to whom.

*Repository evidence.* No escalation column, state or history event. 16A's history vocabulary is a
closed list of eight events, enforced by `workflow_history_event_check`; escalation would add at least
one and change that constraint.

*Undecided.* The trigger; the target; whether levels form a chain; whether escalation **replaces** the
current approver or **adds** another; whether it is recorded in history; whether it restarts the SLA;
whether it is automatic or a command somebody runs; and what happens when the target cannot be
resolved.

*Recommendation.* **A bounded, idempotent administrator command** — reassignment somebody performs,
recorded in history, adding an approver rather than silently replacing one, and never restarting the
clock. **Automatic firing remains `NOT VERIFIED`** because it needs D-11.

*Consequence of automatic escalation.* It requires a durable scheduler that does not exist, and an
escalation that fires twice reassigns twice.

*Blocks:* yes. Depends on D-2 (target kind) and D-11 (automatic firing). *Authorization:* yes.

### D-11 — Scheduling and `JobPort` — ⛔ **BLOCKING, and infrastructure-blocked**

*Question.* Which capabilities require scheduled execution, and can the repository support them?

*Repository evidence.* **Finding 2 — `JobPort` does not exist.** Not "has no adapter": there is no
interface, no file and no import. `packages/kernel/src/ports/` holds four ports and none is a job
port.

*Consequence.* Every scheduled capability — SLA breach detection, automatic escalation, delegation
expiry, reminders, cleanup — needs the **port designed and a durable runner built** before any of them
can be specified, including decisions about idempotency, retry, persistence, failure handling, tenant
context and duplicate firing. None of that exists to be answered against.

*Recommendation.* **No capability in 16B or 16C fires on a schedule.** Due-ness and escalation
candidacy are **queries somebody runs**, which is the established repository shape (Career, Learning,
Performance all do exactly this). Building a scheduler is its own phase-level decision, not a Workflow
convenience.

*Blocks:* yes — it blocks any automatic-firing requirement. *Modifies a completed module:* no, but it
would create **new shared infrastructure**. *Authorization:* yes, if automatic firing is required.

### D-12 — Notification semantics — **RESOLVED BY EXCLUSION (recommend `NOT VERIFIED`)**

*Repository evidence.* **Finding 3.** `NotificationPort` exists; the only implementation records into
an in-memory array. Eight modules deliberately compose none.

*Specification evidence.* §18 assigns notifications to **Phase 17**, and the specification's own Non
Goals list notifications, email, SMS and push.

*Recommendation.* **Remain `NOT VERIFIED`.** Assignment, escalation, decision, delegation and reminder
notifications are all Phase 17's. Nothing in 16B is correctness-critical on delivery: an approval
waits until somebody acts on it, and 16A's Admin screen already states plainly that nobody is told.

*Blocks:* no — unless the user overrides §18, in which case durability, retry, idempotency and failure
semantics all become blocking and Phase 17 is effectively pulled forward.

### D-13 — Manager routing — ⛔ **BLOCKING, and contract-blocked**

*Question.* Is manager routing buildable?

*Repository evidence.* **Finding 5.** Two of the three links exist and are bounded;
**employment → membership does not exist in any published query.**

*Why existing contracts cannot answer it.* `identity.describe-member` goes membership → employments,
never the reverse. `identity.list-memberships` is a paged listing of the whole tenant — enumerating it
and filtering locally is precisely what the brief forbids, and it would be O(tenant) on every step
transition. `employment.export-workforce` returns the entire workforce.

*Recommendation.* **Not in 16B.** Move to 16C behind an explicit Identity authorization. Until then
`manager` remains `NOT VERIFIED`.

*Also undecided.* Which employment when a membership has several (`isPrimary` exists and would be the
natural answer); which `line_type` counts as *the* manager; the `asOf` instant; and what happens when
an employment has no manager or the manager has no membership.

*Blocks:* yes. *Modifies a completed module:* **yes — Identity.** *Authorization:* yes.

### D-14 — Role and group routing — ⛔ **BLOCKING**

*Question.* Can a bounded contract answer "who holds role X" or "which memberships are in group X"?

*Repository evidence.* **Finding 4** — no directory, and no query that answers either question.

*Recommendation.* **Role routing remains `NOT VERIFIED`**, permanently as far as this repository is
concerned, because ADR-0001 and the plan's §3.5 place a role engine with Platform. **Group routing
ships only as D-3's explicit Workflow-owned list**, which Workflow can answer from its own tables
with a bounded, indexed read and no cross-module call at all.

*Blocks:* yes, jointly with D-3. *Modifies a completed module:* no under the recommendation.

### D-15 — External approvers — **RESOLVED BY EXCLUSION (recommend `NOT VERIFIED`)**

*Specification evidence.* AD-005 marks the External API approver *"future"*, and §18 excludes it.

*Repository evidence.* Every approver in Workflow is a `uuid` membership, constrained by check
constraints and by RLS. An external approver has no identity representation, no authentication path
(the repository authenticates nobody — ADR-0032), no tenant membership and therefore no row-level
security position.

*Recommendation.* **Remain `NOT VERIFIED`.** Decision authentication for a party outside the tenant
cannot be safely defined against this repository today.

*Blocks:* no.

### D-16 — Approval expiry — ⛔ **BLOCKING**

*Question.* Is expiry derived, stored, scheduled, terminal, cancellable or escalatable?

*Repository evidence.* `expired` is one of the five states in the kernel's `ApprovalPort.ApprovalState`
and 16A never produces it. `REACHABLE_APPROVAL_STATES` deliberately excludes it. Workflow's own
`WORKFLOW_INSTANCE_STATUSES` has no expired state at all, so producing one would change the instance
vocabulary and its check constraint.

*Recommendation.* **Do not produce it.** The port declaring a state does not oblige Workflow to reach
it, and an approval that "expires" while nobody is watching is an approval nobody decided — which is
what `cancelled` already means, with a reason and a named actor. If expiry is required, it should be a
**cancellation with a stated reason**, not a sixth state.

*Consequence of the alternative.* A terminal `expired` needs a scheduler (D-11) to reach it, and a
derived one would be a state that changes without anybody writing a row — which no other status in
this product does.

*Blocks:* yes. *Authorization:* yes.

### D-17 — Analytics — **RESOLVED BY EXCLUSION (recommend `NOT VERIFIED`)**

*Specification evidence.* §18 assigns analytics and reporting aggregates to **Phase 20**.

*Repository evidence.* Phase 15 set the precedent — bounded operational reads only, aggregates over a
population deferred. 16A's Admin screen states that no rate, average, bottleneck or compliance figure
is calculated anywhere.

*Recommendation.* **Remain `NOT VERIFIED`.** No metric in the specification is defined precisely
enough to build: none names a source, scope, aggregation, window or budget.

*Blocks:* no.

### D-18 — Asynchronous callbacks and outbox — **RESOLVED (recommend: none)**

*Repository evidence.* 16A proved the synchronous seam end-to-end: Recruitment asked first, refusal
leaves nothing written, retry reconciles on the approval identifier. `PostgresUnitOfWork.execute`
takes a fresh connection per call, so two modules' writes cannot share a transaction — this is why the
ordering exists rather than a distributed transaction.

*Recommendation.* **No outbox, no broker, no worker, no asynchronous callback.** 16B adds tally
arithmetic and branching, neither of which changes *how* a terminal decision reaches the adopting
module. Introducing asynchronous infrastructure because it is architecturally attractive would add a
durability surface with no capability behind it.

*Blocks:* no.

### D-19 — Is Phase 16B split into 16B and 16C? — ⛔ **BLOCKING**

*Question.* One implementation phase or two?

*Evidence.* The two halves are blocked by different kinds of thing: routing core by unanswered
parameters, routing intelligence by three absent contracts and one absent port.

*Recommendation.* **Split**, dependency order 16B-core → 16C.

*Blocks:* yes — it determines every subsequent checkpoint. *Authorization:* yes; the specification
defines no sub-phases, so this is the user's call exactly as D-17 of the Phase 16 plan was.

### D-20 — Snapshot or live resolution — ⛔ **BLOCKING**

*Question.* When a step names a group (or, later, a manager), is the set of approvers **snapshotted
onto the instance at start** or **resolved live at each decision**?

*Repository evidence.* 16A already answers the analogous question one way: an instance **copies** its
steps from the version at creation (Phase 16 plan D-18, following ADR-0048), so retiring a version
cannot rewrite a running approval. But delegation is resolved **live**, at the instant of the
decision, because a delegation that ended must stop working immediately.

So the repository contains **both** patterns, deliberately, for different reasons — which is why this
cannot be inferred.

*Recommendation.* **Snapshot the group's membership onto the instance's steps at start**, consistent
with the copy-at-creation rule: somebody removed from a group mid-approval has already been asked, and
a chain that silently changes who may decide is not auditable.

*Consequence of live resolution.* Removing somebody from a group changes a running approval's
denominator, which interacts with D-5's tally in a way that can flip an outcome retroactively.

*Blocks:* yes. Depends on D-3, and feeds D-5. *Authorization:* yes.

### D-21 — Schema strategy against 16A's shipped invariants — ⛔ **BLOCKING**

*Question.* Does 16B alter 16A's three uniqueness invariants, or model parallelism beside them?

*Repository evidence.* **Finding 1**, plus the fact that 16A's concurrency suites assert all three and
its benchmark measures the queue through `workflow_step_queue_idx`, a partial index over awaiting
steps whose selectivity assumes one awaiting step per instance.

*Options.* (a) Alter `workflow_step_ordinal_idx` and `workflow_step_awaiting_idx` in a Workflow
migration, keeping `workflow_decision_step_idx`; (b) leave 16A's tables untouched and add parallel
structures beside them, accepting two step models; (c) version the tables.

*Recommendation.* **(a).** Two step models would mean every query, every screen and every adopting
module handling both. The migration is Workflow-internal and touches no other module.

*Consequence.* 16A's concurrency assertions must be **revised rather than deleted** — the invariant
becomes "at most one awaiting step **per branch**", and a suite that simply dropped the assertion
would remove the guarantee rather than restate it.

*Blocks:* yes. Depends on D-4. *Modifies a completed module:* no — Workflow is the phase's own module.
*Authorization:* yes, because it changes shipped guarantees.

---

## Completed-Module Contract Changes

**Nothing below is authorized, and nothing was built.** Each would require explicit approval.

### 1. Identity — employment → membership (required by D-13, 16C only)

*Current contract.* `identity.describe-member(membershipId)` → membership, profile, preferences,
portals, employments, delegations. Direction is membership → employment.

*Why insufficient.* Manager routing needs the reverse. Nothing accepts an `employmentId`.
`identity.list-memberships` is a paged whole-tenant listing; enumerating and filtering locally is
O(tenant) per step transition and is exactly what the brief forbids.

*Minimum additive change.* A bounded query taking one or more `employmentId`s and returning the
linked membership identifiers with their `isPrimary` flag and link status — no profile, no
preferences, no portals, no delegations.

*Permission.* A new Identity permission of the narrowest kind, e.g. `identity.membership.read-link`,
consumed by Workflow under a bounded service grant.

*Tenant behaviour.* Tenant-scoped under Identity's existing RLS, resolved from the ambient context.

*Performance bound.* Exact-identifier lookup; must accept a bounded set so a parallel step resolves in
one query rather than one per approver.

### 2. Organization — a bounded calendar-day query (required by D-9 only if business days are chosen)

*Current contract.* `OrganizationCalendarView` (with `workingDays` and `timeZone`) is returned only
inside `organization.export-structure`, a whole-organization document. `CalendarDayView` is a
published type **no query returns**.

*Why insufficient.* Exporting an entire organization to learn whether the 23rd is a holiday is not a
bounded read, and the holidays are not in the export at all.

*Minimum additive change.* A query taking a calendar identifier and a date range and returning
`CalendarDayView[]` — the type that already exists — plus the calendar's `workingDays` and `timeZone`.

*Permission.* Organization's existing calendar read permission if one exists; otherwise the narrowest
new one.

*Performance bound.* Bounded by an explicit date range, never open-ended.

### 3. Kernel / shared infrastructure — a job port (required by D-11 only if automatic firing is chosen)

*Current state.* **No `JobPort` exists.** This is new infrastructure, not a completed-module change,
and it carries its own decisions about durability, at-most-once versus at-least-once, retry,
persistence, tenant context and duplicate firing.

*Recommendation.* Do not take this on inside a Workflow phase.

---

## Permissions

Under the recommended scope, 16B adds to 16A's seven:

| Permission | Covers | Phase |
| --- | --- | --- |
| `workflow.group.manage` | Creating an approval group and editing its membership | 16B |
| `workflow.group.read` | Reading groups and their members | 16B |
| `workflow.step.reassign` | The bounded administrator escalation command (D-10) | 16C |

No wildcard, no prefix grant. Cross-module grants stay exactly as 16A left them —
`identity.delegation.read`, `recruitment.requisition.read`, `recruitment.requisition.approve` — unless
D-13 is authorized, which would add one narrow Identity read.

---

## Ports

**No new port is proposed.** `ApprovalPort` stays unchanged (16A implements it inbound);
`BusinessDecisionPort` and `DelegationPort` stay as 16A declared them. `NotificationPort` is not
composed. `JobPort` is not created.

If D-13 is authorized, the Identity read joins the existing `Asking`-only reader — an adapter that
reads Identity must not gain the ability to write to it, which 16A enforces by type.

---

## Cross-Module Dependencies

Unchanged from 16A under the recommended scope: Identity `identity.active-delegations-for`;
Recruitment `recruitment.read-requisition` and `recruitment.decide-requisition`.

**Further adoptions** are named in the plan's §17 as 16B work. Candidates, all with an existing
`decide`/`approve` command: Attendance, Career, Compensation, Leave, Letters, Organization, Payroll,
Performance, Recruitment. Three — Compensation, Leave, Payroll — already publish their chain in
`ApprovalPort`'s shape. **Each adoption is its own authorization** (Phase 16 plan D-10 ⛔), because
each modifies a completed module, and none should be assumed.

---

## Domain Changes

Approval group and group member (new aggregates, D-3). A branch or parallel-step model (D-4). Tally
evaluation as a pure function over a step's decisions (D-5), returning a refusal as a value. A closed
condition form frozen on the version (D-7). Revised step transitions and terminal rules (D-6).

`ApproverKind` gains `group`. `WorkflowHistoryEvent` gains at least one event for escalation if D-10 is
approved. Neither vocabulary may be widened without changing its check constraint in the same
migration — 16A's parity gate asserts they match exactly.

---

## Schema Changes

Two new tables (`workflow_approval_group`, `workflow_approval_group_member`), and — per **D-21** —
**alterations to two shipped indexes**, which is the part a reviewer should look at hardest. No new
`numeric`, `real`, `double precision`, `bigint`, `money` or `date` column: 16A's type inventory is
`character varying`, `integer`, `jsonb`, `timestamp with time zone`, `uuid`, and the benchmark asserts
it. Tally counts are integers; there are no percentages and no weights.

RLS enabled **and forced** on both new tables, exactly one permissive `ALL` policy each for `PUBLIC` on
`(tenant_id = app_current_tenant())`, and no foreign key leaving the module.

---

## API Surface

Under the recommended scope, roughly four new routes: create a group, read groups, add a member,
remove a member — plus whatever D-10 approves for reassignment in 16C. Existing routes gain richer
responses (a step's approvers, a tally's standing) without changing their shape.

No generic status route, no `/me`, no `/my-team`, no roles, groups-as-directory, SLA, escalation,
analytics or scheduling endpoint beyond what these decisions explicitly approve. Every handler keeps
exactly one permission and one route.

---

## Admin Surface

Additive sections for groups and, where approved, a step's parallel approvers and the tally's current
standing. Server-rendered, read-only, en/ar with `dir="rtl"`, bounded request budget, no client state
and no controls — the same architecture 16A used. Every capability still deferred must move from
16A's `NOT VERIFIED` list only when it is actually built.

---

## Performance

Tiers unchanged: **500 / 10,000 / 100,000** per tenant, two tenants at equal volume, unprivileged
role, RLS forced, `vacuum analyze` after seeding, plans captured from the real repositories.

Budgets **inherited unchanged** — queue 100 ms, detail 150 ms, cohort 2 s / 10 s / 60 s. **No budget
is invented here**, because the specification provides none.

Likely critical workloads, each measurable only once its capability is approved:

| Workload | Depends on |
| --- | --- |
| Pending queue where a member is one of several parallel approvers | D-4 |
| Decision submission against a parallel step | D-4, D-5 |
| Tally evaluation for a step with many approvers | D-5 |
| Branch evaluation at a step transition | D-7 |
| Group membership resolution at instance start | D-3, D-20 |
| SLA / escalation candidates as of an instant | D-8, D-10 — **the O(n) risk**, as the Phase 16 plan flagged |
| Manager resolution for a cohort of steps | D-13 |

The last two are exactly the two workloads Phase 16A could not measure. **Nothing unapproved will be
benchmarked**, and no index will be added to flatter a fixture.

One carried-forward gap worth resolving in whichever phase touches it: `InstanceStore.search` accepts
a single `subjectId` and no `subjectIdsIn`, so the plan's proposed cohort read ("open instances for
200 subjects, one query") still cannot be run.

---

## Security

Everything 16A established is preserved and re-asserted, not assumed: tenant isolation with RLS
enabled and forced; exactly one permissive `ALL` policy per table for `PUBLIC` on
`(tenant_id = app_current_tenant())`; unprivileged PostgreSQL roles with `rolsuper = false` and
`rolbypassrls = false` asserted before any security result is believed; no cross-module foreign key;
bounded cross-module queries only; **no caller-supplied acting identity anywhere**; and no wildcard
grant.

Two new risks this phase introduces, both of which must be tested rather than reasoned about:

- **A tally is an authorization surface.** If a delegate's vote can count *additionally* (D-5), a
  delegation becomes a way to change an outcome rather than to stand in for somebody. The
  recommendation — one vote per delegator — is a security position, not a convenience.
- **Group membership is an approver directory.** Whoever may edit a group can change who approves.
  `workflow.group.manage` must be separable from `workflow.definition.manage`, exactly as
  `instance.cancel` is separable from `instance.start` today.

---

## NOT VERIFIED

| Capability | Reason | Required contract or decision | Blocks 16B? | Completed-module authorization? |
| --- | --- | --- | --- | --- |
| Role approvers | No role directory; ADR-0001 places it with Platform | A directory this repository has committed not to build | no | yes, and out of scope |
| External approvers | AD-005 "future"; §18 excludes | Identity representation, authentication, tenant position | no | yes |
| Manager routing | employment → membership is unpublished | Additive Identity query (Change 1) | no (16C) | **yes — Identity** |
| Business-day SLA | Holidays returned by no query | Additive Organization query (Change 2) | no (16C) | **yes — Organization** |
| Automatic SLA firing | `JobPort` does not exist | A job port and a durable runner (Change 3) | no | new infrastructure |
| Automatic escalation firing | Same | Same | no | new infrastructure |
| Automatic delegation expiry | Not needed; asked at the instant of decision | — | no | no |
| Approval expiry (`expired`) | Declared in the port, never produced; needs a scheduler or a new state | D-16 | no | no |
| Notification delivery | Only `RecordingNotificationPort` exists; §18 assigns Phase 17 | Durable delivery, retry, failure semantics | no | no |
| Analytics | §18 assigns Phase 20; no metric is defined precisely | A defined metric with source, scope, window, budget | no | no |
| Outbox / broker / worker | 16A's synchronous seam is proven; nothing requires them | — | no | no |
| Self-service | No principal → employment resolution (ADR-0032) | Platform authentication | no | no |
| Cohort read over many subjects | `InstanceStore.search` has no `subjectIdsIn` | A Workflow-internal filter | no | no |

---

## Proposed Checkpoints

Assuming D-19 approves the split, for **16B — Routing core**:

| # | Checkpoint | Gate |
| --- | --- | --- |
| 1 | Definition of Ready | This document, and every blocking decision approved |
| 2 | Domain — groups, branches, tally, conditions | Pure functions; refusals as values; vocabularies match constraints |
| 3 | Schema — two tables, **two altered indexes** | RLS forced, one policy each, no FK leaving, migration reviewed against 16A's invariants |
| 4 | Application — commands, queries, permissions | One permission per handler; tally is a pure function |
| 5 | PostgreSQL repositories | Real database, unprivileged role, plans captured |
| 6 | API | One route per handler, reconciled exactly |
| 7 | Admin UI | Bounded requests, en/ar, honest `NOT VERIFIED` |
| 8 | Performance, security and integration audit | Three tiers, inherited budgets, revised concurrency invariants |
| 9 | Final report | Recounted from the tree |

**No cross-module adapter checkpoint** is proposed for 16B-core: under the recommended scope it adds
no cross-module dependency. That is a deliberate difference from 16A's shape and a sign the split is
real.

For **16C — Routing intelligence**, checkpoints would mirror these with an added cross-module adapter
checkpoint and a scheduling seam — but 16C should not be planned in detail until Changes 1–3 are
authorized, because its shape depends entirely on which of them lands.

---

## Risks

1. **Altering shipped uniqueness invariants (D-21) is the highest-risk change in this phase.** 16A's
   concurrency guarantees rest on them, and a suite that relaxed an assertion rather than restating it
   would silently remove a guarantee.
2. **A defaulted tally parameter decides who is approved.** This is the risk the Phase 16 plan called
   out in bold and it has not diminished.
3. **`JobPort`'s absence has been mis-documented for five phases.** Any plan that assumed "adapter
   missing" rather than "port missing" underestimates the scheduling work by an order of magnitude.
4. **Group membership is an approver directory by another name.** Kept static and explicit it is safe;
   any drift toward queries or inheritance rebuilds the role engine this repository refuses.
5. **Adoption pressure.** Nine modules have a `decide` command and none consumes `ApprovalPort`. Each
   adoption is a completed-module change and should be resisted as a "while we are here".

---

## Technical Debt Carried Forward

1. Duplicate-key race on `POST /instances` can surface as **500** — the shared `ProblemDetailsFilter`
   maps only `ConcurrencyException` to 409. Repository-wide.
2. Repository-wide test run fails at **default** concurrency — `deadlock detected` in
   `@work/onboarding`. The pinned `--concurrency=1` configuration is green.
3. `documents-concurrency.integration.test.ts` is flaky under a full run (2 of 4 observed).
4. Every `measure-*-performance` script rewrites planner statistics that outlive `truncate`.
5. **New, found by this Definition of Ready:** five modules and four module documents state
   *"`JobPort` has no adapter"* when no such port exists. Correcting the wording is not authorized
   here.
6. **New:** `CalendarDayView` is a published Organization type returned by no query — a contract that
   exists on paper only.

---

## Definition of Ready Checklist

| Item | State |
| --- | --- |
| Authoritative specification identified | ✅ Phase 16 v1.0, Approved; no separate 16B document |
| Repository inspected rather than assumed | ✅ final tree at `6980645` |
| Tally arithmetic defined | ❌ **D-5** |
| Parallel terminal semantics defined | ❌ **D-6** |
| Branching semantics defined | ❌ **D-7** |
| Approver resolution semantics defined | ❌ **D-2, D-3, D-20** |
| Manager routing contract available | ❌ **D-13** — Identity change required |
| Role/group resolution contract available | ❌ **D-14** — group only, as an explicit list |
| SLA semantics defined | ❌ **D-8** |
| Business-day semantics defined | ❌ **D-9** — Organization change required if chosen |
| Escalation semantics defined | ❌ **D-10** |
| Scheduler guarantees available | ❌ **D-11** — the port does not exist |
| Notification correctness requirements | ✅ none — recommended `NOT VERIFIED` |
| External approver semantics | ✅ none — recommended `NOT VERIFIED` |
| Approval expiry semantics defined | ❌ **D-16** |
| Analytics defined | ✅ none — recommended `NOT VERIFIED` |
| Schema strategy against 16A invariants | ❌ **D-21** |
| Scope split decided | ❌ **D-19** |
| Budgets available | ✅ inherited unchanged; none invented |
| Security posture preserved | ✅ 16A's, re-asserted |

**14 blocking · 3 resolved · 4 resolved by exclusion.**

---

## Approval Required

Before any Phase 16B implementation begins:

1. **D-19** — the split into 16B (routing core) and 16C (routing intelligence).
2. **D-2, D-3, D-20** — approver kinds, group semantics, and snapshot-versus-live resolution.
3. **D-4, D-21** — the parallel model, and the alteration of two shipped uniqueness invariants.
4. **D-5** — every tally parameter, individually. **Nothing here may be defaulted.**
5. **D-6** — parallel terminal rules and the fate of remaining steps.
6. **D-7** — whether branching ships, and the closed condition form.
7. **D-8, D-9, D-10, D-11, D-16** — SLA, business days, escalation, scheduling and expiry (16C).
8. **D-13** — if manager routing is required: explicit **Identity** authorization for Change 1.
9. **D-9(b)** — if business days are required: explicit **Organization** authorization for Change 2.
10. **D-11** — if automatic firing is required: explicit authorization to design a job port and a
    durable runner as new shared infrastructure.
11. Confirmation that **D-12, D-15, D-17, D-18** remain excluded per the approved §18, or an explicit
    override.

**No Phase 16B implementation may begin until every blocking decision above is explicitly approved.**
