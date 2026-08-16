# Phase 16C — Definition of Ready

**Status: not approved. No implementation has begun.**

Written from the tree at `c0488c9`, after Phase 16B completed. Every claim below was checked against
the repository, the database catalogue and the phase specifications rather than against an earlier
checkpoint report. **Where a checkpoint report and the tree disagree, the tree is recorded and the
report is named.** Two such disagreements were found, and one of them changes 16C's premise.

---

## 1. Objective

Establish what Phase 16C **is** — not to build it.

Phase 16A built the approval engine. Phase 16B built the routing core. What remains of the approved
Phase 16 specification is the part that was blocked in both: **who else can be an approver, and what
time does to an approval that nobody has answered**. This document determines which of that is
genuinely ready, which belongs to another phase, what would have to be authorized first, and whether
16C should itself be split.

---

## 2. What is left of Phase 16

`work prompts/17_PHASE_16_WORKFLOW.md` is the approved specification and has never been amended.
Measured against the final tree, this is what it still asks for and does not have:

| Specification item | State after 16B |
| --- | --- |
| `EscalationRule` aggregate; AD-010; Time-based / Role / Manager / HR / Multi-level escalation | **absent** |
| `SLARule` aggregate; "Configurable SLA"; Escalation = "automatic reassignment after SLA breach" | **absent** |
| AD-005 approver kinds: Manager, HR, Role, Dynamic Rule, External API | **absent** — `membership` and `group` ship |
| Delegation: "Automatic Expiration" | **absent** in Workflow; Identity's `Delegation.expire()` exists and no command reaches it |
| `WorkflowAnalytics`; "Workflow Analytics" in Scope | **absent** |
| Validation: "Approver Availability" | **absent** |
| Search: "Delegation Search", "Advanced Search" | **absent** |
| Approval Sources: the other ten modules | **absent** — Recruitment alone is adopted |

Everything else in the specification is delivered: definitions, versions, instances, steps, decisions,
delegation consumed from Identity, approval groups, parallel approval, majority, unanimous,
first-response, conditional branching, queues, history, timeline, REST API, Admin UI, testing and
documentation.

---

## 3. Current architecture, as it actually stands

9 tables · 9 Prisma models · 7 repositories · 12 commands · 10 queries · 9 permissions · 7 stores ·
2 outbound ports · 5 controllers · 22 routes · 16 Admin sections · 28 indexes · 6 partial unique
indexes · 11 foreign keys and **0** cross-module · 39 check constraints · 9 RLS policies (enabled and
forced) · 2 append-only tables · 2 of the repository's 22 migrations.

Workflow's outbound ports are `DelegationPort` (Identity) and `BusinessDecisionPort` (the Recruitment
seam). No business module imports `@work/workflow`; only `apps/api` and `apps/admin` do.

---

## 4. What already exists elsewhere — consume, do not recreate

This section is the most important one, because two of the three "absent infrastructure" claims that
shaped the 16B split are wrong about the final tree.

### 4.1 `JobPort` **exists**. It has no adapter.

`packages/kernel/src/ports/index.ts:71` declares:

```ts
export interface JobRequest<TPayload> {
  readonly name: string;
  readonly payload: TPayload;
  readonly tenantId: string;
  readonly correlationId: string;
  /** Supplied by the caller so a retried enqueue does not run the work twice. */
  readonly idempotencyKey: string;
  readonly runAt?: Date;
}

export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
}
```

It is exported from `packages/kernel/src/index.ts:127` and has existed since **Phase 0**, commit
`4ed4c39` (2026-08-05), before Phase 16 began.

**`docs/verification/phase-16b-plan.md` Finding 2 states the opposite** — *"A search of every `.ts` in
`packages/` and `apps/` finds no `JobPort` interface, type, file or import"* — and every conclusion
derived from it inherits the error. The correct statement is Phase 16A's: **`JobPort` has no adapter
anywhere**, which is what five modules' comments say.

The distinction matters to 16C. The port is not the missing piece, and it is not 16C's to design: the
**contract already commits** to a tenant, a correlation identifier, a caller-supplied idempotency key
and an optional `runAt`. What does not exist is **any adapter, any durable store, any runner, any
retry policy, any failure handling and any evidence that a job can carry a tenant context or an
actor**. That is infrastructure, and §7 asks who owns it.

### 4.2 `NotificationPort` exists, with a recording adapter

`packages/kernel/src/ports/notification.ts` declares `NotificationPort.notify(request)` with a
template key, recipients, variables, correlation and an optional idempotency key. `RecordingNotificationPort`
in `packages/kernel/src/adapters/in-process-ports.ts:64` implements it by recording and delivering
nothing. Nine modules declare in prose that they hold no notification port.

**Workflow must not declare one.** Delivery is Phase 17 (`work prompts/18_PHASE_17_COMMUNICATIONS.md`
owns delivery queue, scheduled message, channels and preferences).

### 4.3 The manager is one query away, and the query does not exist

- Employment publishes `EmploymentView.managerEmploymentId` — *"The manager in force on `asOf`. Never
  by person"* (`packages/modules/employment/src/contracts/views.ts:53`), plus `ReportingLineView`.
- Identity owns `employment_link` (membership ↔ employment) with an index on
  `(tenant_id, employment_id)` — so the reverse lookup is **already indexed**.
- Identity's `EmploymentLinkRepository` exposes `forMembership` and `primaryFor(membership)` and
  **nothing keyed by employment**. The only published query, `identity.describe-member`, takes a
  membership and returns its employments.

**The gap is exactly one direction: employment → membership.** It is a new query on a completed
module (Identity, Phase 2 ✅). Confirmed still open; the 16B plan's Finding 5 is correct.

### 4.4 A calendar exists; its days are not published

`organization_calendar` and `organization_calendar_day` exist. `OrganizationCalendarView` publishes
`timeZone` and `workingDays` (ISO weekdays). `CalendarDayView` — `onDate` as `YYYY-MM-DD` *in the
calendar's own time zone*, `kind`, `name` — is **declared and exported**, and **no query returns it**.
Organization publishes 11 queries and none is a calendar-day read.

So weekends are answerable today from `workingDays`; **holidays are not**. The 16B plan's Finding 6 is
correct.

### 4.5 Delegation expiry exists in Identity's domain and is unreachable

`packages/modules/identity/src/domain/delegation.ts:167` implements `expire()`, refusing a second
expiry and a revoked grant. **No Identity command calls it.** Expiring a delegation on a timer is
therefore two absences, not one: a scheduler, and a command for it to call.

### 4.6 No role directory exists, anywhere

There is **no role table in the schema**, no role model in any module, and no role concept in the
kernel. Authorization is `PermissionGate.holds(permission)` over exact permission strings
(`packages/kernel/src/cqrs/pipeline.ts:51`). ADR-0001 places identity and access with Platform.

Nothing in this repository can enumerate "everybody who holds role X". That is not a gap to fill in
Workflow — it is the reason D-3 refused role approvers.

---

## 5. Classification of every remaining capability

### A. Candidate for 16C — architecturally ready

| Capability | Blocked by | Kind of block |
| --- | --- | --- |
| **Manager approver** | one narrow Identity query (§4.3) | completed-module authorization |
| **SLA as elapsed time** | nothing technical; semantics undecided (D-16C-05) | decision only |
| **Due-ness derived on read** | nothing | decision only |
| **Escalation as a bounded, idempotent administrator command** | semantics undecided (D-16C-07) | decision only |
| **Approval expiry as an observed state** | semantics undecided (D-16C-06) | decision only |
| **Further module adoptions** | one authorization per module | per-module decision |

### B. Belongs to a later phase — named owner

| Capability | Owner | Evidence |
| --- | --- | --- |
| Notification delivery | **Phase 17 Communications** | its prompt owns delivery queue, channels, scheduling, preferences |
| Analytics, dashboards, tenant-wide aggregates, scheduled reports | **Phase 20 Workforce Intelligence** | *"owns reporting, dashboards, KPIs and analytics"*; *"Scheduled reports execute in background jobs"* |
| Employee / manager self-service portals | **Phases 18 / 19** | their prompts own the portals |
| External API approvers | **explicitly deferred by the specification** | AD-005 says "(future)" |
| Platform authentication | **Platform** | ADR-0032; every business endpoint answers 401 until its adapter lands |
| Background job optimization, queue monitoring | **Phase 24 Enterprise Operations** | its prompt names both |

**No phase in the repository claims ownership of building the durable job runner itself.** Phase 20
*consumes* background jobs and Phase 24 *optimizes* them; neither says who writes one. That is
D-16C-01, and it is the single largest unowned dependency in this phase.

### C. Already available — consume rather than recreate

`JobPort` (kernel, no adapter) · `NotificationPort` + `RecordingNotificationPort` (kernel) ·
`EmploymentView.managerEmploymentId` and `ReportingLineView` (Employment) · `employment_link` with its
`(tenant_id, employment_id)` index (Identity) · `OrganizationCalendarView.workingDays` and `timeZone`
(Organization) · `CalendarDayView` as a type (Organization) · `Delegation.expire()` (Identity domain).

### D. Requires a completed-module change

| Module | Change | Required by |
| --- | --- | --- |
| **Identity** (Phase 2 ✅) | a narrow query: employment → active membership, tenant-scoped, permissioned | manager approver, manager escalation |
| **Organization** (Phase 3 ✅) | a narrow query returning `CalendarDayView` for a calendar over a bounded range | business-day SLA only |
| **Identity** (Phase 2 ✅) | a command reaching the existing `Delegation.expire()` | automatic delegation expiry only |
| **Each adopting module** | its own `decide` seam, as Recruitment has | further adoptions |

Every one of these is additive. **None may be built during Definition of Ready**, and each needs its
own authorization.

### E. Requires a new architectural decision

Escalation that adds a history event changes `workflow_history_event_check` — a closed vocabulary of
eight events. Expiry as a state changes which of `ApprovalPort`'s five states this product can reach.
Manager routing must choose between resolving live and snapshotting. A durable runner is new shared
infrastructure. Each is a decision in §7, and at least the runner and the expiry state warrant ADRs.

---

## 6. Contradictions found

**Six.** None is silently reconciled.

### C-1 — `JobPort` does not exist *(false)*

*Source:* `docs/verification/phase-16b-plan.md` Finding 2, and every sentence derived from it,
including the 16B split rationale.
*Tree:* `packages/kernel/src/ports/index.ts:71`, exported at `packages/kernel/src/index.ts:127`,
present since Phase 0 commit `4ed4c39`.
*Conflict:* the plan claims no interface, no file and no import; the interface has existed for the
whole project and already specifies tenant, correlation, idempotency key and `runAt`.
*Must be decided:* nothing about the port — it is settled. What must be decided is **who builds the
adapter and runner** (D-16C-01). The 16B rationale that scheduling is blocked "because the port was
never written" must be restated as "blocked because no adapter, runner or durable store exists".

### C-2 — "four reserved `approval_id` columns"

*Source:* `prisma/schema.prisma:5327` — *"the four reserved `approval_id` columns across Recruitment,
Leave, Onboarding and Attendance"*.
*Tree:* exactly **two** models carry `approval_id`: `RecruitmentRequisition` and `LeaveRequest`.
*Conflict:* the comment overstates how many modules are pre-shaped for adoption, which matters to
D-16C-09 (which modules adopt next).
*Must be decided:* whether to correct the comment (documentation-only) and whether Onboarding and
Attendance are still intended adopters.

### C-3 — AD-005 requires approver kinds this repository has refused

*Source:* the approved specification, AD-005: Employee, **Manager, HR, Role, Group**, Dynamic Rule,
External API.
*Tree:* `APPROVER_KINDS = ['membership', 'group']`, and D-3 recorded role approvers as refused because
no role directory exists or ever will in this product.
*Conflict:* the specification has never been amended, so the product is knowingly short of its own
approved scope on four kinds.
*Must be decided:* D-16C-03 (role) and D-16C-04 (manager) — and whether the specification is amended
rather than left contradicted.

### C-4 — the Phase 16 plan put SLA and escalation in 16B

*Source:* `docs/verification/phase-16-plan.md` §17 — *"16B — routing intelligence. Approval groups,
parallel tallies, **escalation, SLA**, conditional branching"*.
*Tree:* delivered 16B contains neither, and `phase-16b-plan.md` reassigned both to 16C.
*Conflict:* two plan documents describe different 16B scopes; the delivered scope matches the second.
*Must be decided:* nothing — but the record should say the scope moved rather than leave two plans
disagreeing.

### C-5 — `docs/PHASES.md` over-states 16C's scope

*Source:* the Phase 16B entry I wrote at closure: *"Phase 16C — SLA, escalation, scheduling, manager
routing, role approvers, **notification and analytics** — is not started"*.
*Tree:* notification delivery is Phase 17's and analytics is Phase 20's, by their own prompts and by
`phase-16-plan.md` §18.
*Conflict:* a closure sentence assigns two capabilities to 16C that the repository assigns elsewhere.
*Resolution:* documentation-only, and corrected in this checkpoint (§12).

### C-6 — the specification's "Business Domain Callback" versus the shipped seam

*Source:* the specification's High-Level Model ends in a callback; AD-002 lists Domain Events.
*Tree:* D-9 shipped a **synchronous** decision inside the approver's own request, with idempotent
reconciliation, because there is no outbox and at-most-once dispatch cannot carry correctness.
*Conflict:* pre-existing and knowingly accepted in 16A; it becomes live again the moment anything
fires on a timer, because a scheduled decision has no approver request to travel in.
*Must be decided:* D-16C-02 — what carries a decision that no human request initiated.

---

## 7. Blocking decision register

Fourteen. Every one requires explicit approval; none is defaulted because one option is easier.

---

### D-16C-01 ⛔ — Who owns the durable job runner?

*Why it matters.* Automatic escalation, automatic expiry, delegation expiry and reminders all need
scheduled execution. The **port exists** (§4.1); nothing implements it.

*Options.*
**(a)** Nobody in Phase 16C. Nothing fires on a timer; due-ness and escalation candidacy are queries
somebody runs, which is what Career, Learning and Performance already do.
**(b)** Phase 16C builds a Workflow-internal runner.
**(c)** A separate infrastructure phase builds a durable runner against the existing `JobPort`, and
Workflow consumes it afterwards.

*Consequences.* **(b)** puts a scheduler inside a business module, gives this product two job systems
the day Phase 20 needs one, and makes Workflow responsible for retry, idempotency, failure recovery
and tenant context — none of which exists. **(c)** is correct but blocks 16C entirely until it lands.
**(a)** ships useful capability now and keeps automatic firing honestly `NOT VERIFIED`.

*Recommendation.* **(a) for Phase 16C, and (c) as a separate phase.** A scheduler is not a Workflow
convenience.

*Approval required: yes.*

---

### D-16C-02 ⛔ — What carries a decision no human request initiated?

*Why it matters.* The Recruitment seam runs **inside the approver's own request** under a bounded
grant, so the actor recorded downstream is a human. A timer-fired escalation or expiry has no request
and no human, and `system:auto-approval` is refused by a check constraint in the adopting module.

*Options.* **(a)** Nothing terminal fires without a human request. **(b)** A service actor is defined
for scheduled transitions. **(c)** An outbox carries the decision.

*Consequences.* **(b)** reintroduces exactly the actor ADR-0045 refused. **(c)** is new infrastructure
and was refused as D-9.

*Recommendation.* **(a)**, which follows from D-16C-01(a).

*Approval required: yes.*

---

### D-16C-03 ⛔ — Role approvers: build, refuse, or amend the specification?

*Why it matters.* AD-005 requires them; no role directory exists (§4.6).

*Distinctions that must not be collapsed:* an **application permission** (a string a gate checks) · a
**product role** (does not exist) · an **organizational role** (does not exist) · a **job position**
(Organization owns a catalogue; nobody holds one as an approver) · an **approval group** (an explicit
list — shipped) · a **dynamic membership set** (does not exist).

*Options.* **(a)** Remain `NOT VERIFIED` and amend the specification to say so. **(b)** Treat "role" as
an approval group and record that the word is satisfied by the list. **(c)** Build a role directory.

*Consequences.* **(c)** is a Platform concern (ADR-0001) and would be the single largest scope
addition in the phase. **(b)** is a rename that would let a reader believe a directory exists.

*Recommendation.* **(a).**

*Approval required: yes.*

---

### D-16C-04 ⛔ — Manager approver: adopt the Identity contract?

*Why it matters.* This is the one candidate capability blocked by exactly one additive query (§4.3),
and it is the most-requested approver kind after a named person.

*Options.* **(a)** Not in 16C; `manager` stays `NOT VERIFIED`. **(b)** Authorize a narrow Identity
query `employment → active membership`, tenant-scoped, behind its own permission, and add a `manager`
approver kind.

*Consequences of (b).* Identity is a completed module. The query must be narrow — one employment in,
its active memberships out — and must not become a general directory read. It also settles nothing on
its own: D-16C-08 through D-16C-11 all become live.

*Recommendation.* **(b), if and only if** D-16C-08 (live vs snapshot), D-16C-10 (no manager) and
D-16C-11 (inactive employment) are answered in the same approval.

*Approval required: yes — and it is a completed-module change.*

---

### D-16C-05 ⛔ — Is an SLA elapsed time or business days?

*Why it matters.* Business days need holidays, and holidays are declared but unreturned (§4.4).

*Options.* **(a)** Elapsed time only — whole hours or days of `timestamptz` arithmetic. **(b)** Business
days, authorizing a narrow Organization calendar-day query.

*Also undecided under (b).* Whose calendar when an approver's unit differs from the requester's;
whose time zone; inclusive or exclusive boundaries; whether the result is a civil date or an instant.
Workflow holds **no civil date at all** today, so introducing one is a modelling decision.

*Consequences.* **(a)** is buildable immediately and will surprise a tenant whose weekend is Friday and
Saturday. **(b)** is correct for the domain and is a completed-module change.

*Recommendation.* **(a) for 16C.** Business days only with an explicit Organization authorization, and
**never** by duplicating a calendar inside Workflow.

*Approval required: yes.*

---

### D-16C-06 ⛔ — Approval expiry semantics

*Why it matters.* `expired` is one of `ApprovalPort`'s five states and **this product has never
produced it**. Introducing it changes what the port can mean everywhere.

*Every one of these must be answered together, and none has an obvious default:*

- Is expiry **automatic** or **observed** — a state a read computes, or a transition somebody writes?
- Who triggers it if it is written? (Without D-16C-01(c), only a human command can.)
- Is expiry **terminal** for the instance, or only for a step?
- Can an expired step later be decided? (If yes, expiry is advisory; if no, an approval can die of
  silence.)
- What happens to a **delegated** authority over an expired step?
- What happens to the **other steps of a parallel branch** — do they expire together, or does one
  expiring reduce the branch?
- Does expiry write **history**? That changes a closed eight-event vocabulary and its check constraint.
- How does expiry interact with **quorum** — is an expired approver "outstanding" for ever, or does the
  denominator shrink? *Shrinking it would break the locked 16B rule that the denominator is the
  snapshot and non-response is never subtracted.*
- How does it interact with **first-response**, where one answer decides?

*Recommendation.* **Expiry is observed, not written**, in 16C: a read reports that an approval has
been waiting longer than its target, and nothing changes state. That preserves every 16B invariant
and needs no scheduler. A written `expired` state should be its own decision after D-16C-01.

*Approval required: yes.*

---

### D-16C-07 ⛔ — Escalation semantics

*Why it matters.* The specification defines escalation as *"automatic reassignment after SLA breach"* —
three commitments at once, and the automatic one is infrastructure-blocked.

*Undecided.* What starts it (elapsed time, business days, a person) · levels and whether they chain ·
who receives it (a membership, a group, a manager — the last needs D-16C-04) · whether it **adds** an
approver or **replaces** the current one · whether it restarts the clock · whether it is recorded in
history · what happens when the target cannot be resolved.

*Consequences.* Replacing an approver silently rewrites who was asked, which the 16B snapshot rule
exists to prevent. Automatic firing needs D-16C-01(c) and, twice-fired, escalates twice.

*Recommendation.* **A bounded, idempotent administrator command** that **adds** an approver to the
branch, is recorded in history, never restarts the clock, and never removes anybody. Automatic firing
remains `NOT VERIFIED`.

*Approval required: yes.*

---

### D-16C-08 ⛔ — Live resolution or snapshot?

*Why it matters.* This is the deepest question in the phase. 16B locked the rule for **groups**: a
list is resolved **once, at instance start**, and later edits never reach a running approval. A
`manager` approver could be resolved the same way, or looked up at each decision.

*Options.* **(a)** Snapshot at instance start, exactly as a group. **(b)** Resolve live at decision
time. **(c)** Resolve when the **branch opens** rather than when the instance starts.

*Consequences.* **(b)** means the person who may decide changes under the approval, and a reorganization
mid-approval silently moves authority — and it contradicts the snapshot invariant the whole of 16B is
built on. **(c)** is defensible for a long chain whose later branches open days later, but it means two
different resolution moments in one product, which a reader must then keep straight.

*Recommendation.* **(a)**, for consistency with the locked group rule. If **(c)** is wanted, it must be
a stated, tested rule applied to *every* resolved approver kind, not only to managers.

*Approval required: yes.*

---

### D-16C-09 ⛔ — Which modules adopt next?

*Why it matters.* Recruitment is the only adopted module. Only Recruitment and Leave carry an
`approval_id` column (C-2). Each adoption is a completed-module change and a seam of its own.

*Recommendation.* **Zero by default.** Name and approve each module separately, as D-10 required.

*Approval required: yes, per module.*

---

### D-16C-10 ⛔ — What happens when a routed approver cannot be resolved?

*Why it matters.* No manager, no active membership behind a manager's employment, an employment that
has ended. 16B's precedent is unambiguous: a group that resolves to nobody **fails the start closed**
(`branch-group-empty`), and a condition that cannot be evaluated is a **refusal, never `false`**.

*Options.* **(a)** Fail closed — the approval does not start, with a named refusal. **(b)** Skip the
step. **(c)** Fall back to a configured approver.

*Consequences.* **(b)** silently removes an approval stage somebody configured — the worst outcome
available, because it looks like success. **(c)** needs a fallback model that does not exist.

*Recommendation.* **(a).**

*Approval required: yes.*

---

### D-16C-11 ⛔ — Effective dating for a resolved manager

*Why it matters.* `managerEmploymentId` is *"the manager in force on `asOf`"*. Something must supply
`asOf`.

*Options.* **(a)** The instant the approval started. **(b)** The instant the branch opened. **(c)** The
instant of the decision.

*Consequences.* **(c)** contradicts D-16C-08(a). **(a)** is consistent with the snapshot rule and means
a reporting line backdated after the approval started does not move authority.

*Recommendation.* **(a).**

*Approval required: yes.*

---

### D-16C-12 ⛔ — Automatic delegation expiry

*Why it matters.* Identity's `Delegation.expire()` exists and nothing calls it (§4.5). A delegation
today is in force only if Identity says so **at the instant of the decision**, which is why Workflow
keeps no expiry state.

*Options.* **(a)** Leave it. Expiry is already observed correctly at decision time. **(b)** Authorize an
Identity command plus a scheduler to call it.

*Recommendation.* **(a).** The current behaviour is already right; a timer would only make the stored
status agree with a question that is answered live anyway.

*Approval required: yes if (b).*

---

### D-16C-13 ⛔ — Does 16C need a schema change, and does any weaken an invariant?

*Why it matters.* An SLA target on a step template and a step is additive and harmless. A `manager`
approver kind widens `workflow_step_template_approver_kind_check`. An escalation history event widens
`workflow_history_event_check`. An `expired` step or instance status widens two more.

*Rule.* **No 16C migration may weaken a 16A/16B invariant**: not the append-only triggers, not
`workflow_decision_step_idx`, not the composite tenant-aware foreign keys, not RLS forced on nine
tables, not the tally arithmetic.

*Recommendation.* Additive columns and widened closed vocabularies only, each with its parity test.

*Approval required: yes.*

---

### D-16C-14 ⛔ — Is Phase 16C split?

See §8. *Approval required: yes.*

---

## 8. Should 16C be split?

**Recommendation: yes — 16C and 16D — but the seam is not the one the example suggests.**

The evidence is that the remaining work fails for **three** different reasons, not two:

| Group | Blocked by | Ready when |
| --- | --- | --- |
| Manager approver | one additive **Identity** query | that query is authorized |
| SLA target, due-ness on read, escalation as a command, observed expiry | **semantics decisions only** | the register above is answered |
| Automatic firing, delegation expiry on a timer, business-day SLA | **absent infrastructure** (a runner) or an additive **Organization** query | those land |

The third group cannot be scheduled at all, so it is not a phase — it is a `NOT VERIFIED` list with
named owners. That leaves two implementable groups:

- **Phase 16C — Routing resolution.** The `manager` approver kind, the resolution moment (D-16C-08),
  effective dating (D-16C-11), and fail-closed behaviour (D-16C-10). One completed-module
  authorization. No clock.
- **Phase 16D — Time in Workflow.** An SLA target as elapsed time, due-ness derived on read,
  escalation as a bounded idempotent command, and expiry as an observed state. No completed-module
  change, no scheduler.

**Order: 16C then 16D.** Not because 16D depends on 16C's code, but because escalation's most-asked-for
target is *the manager*, and shipping time-based routing whose only possible target is an explicit
list would deliver a capability nobody asked for. If D-16C-04 is declined, the order **reverses**: 16D
becomes the only implementable half and should ship alone.

**If the split is declined**, Phase 16C carries fourteen blocking decisions, one completed-module
authorization and two vocabularies to widen at once — which is what the 16A/16B split existed to
avoid.

---

## 9. Invariants any 16C design must preserve

Non-negotiable, and each is machine-checked today:

Approval identity is membership-based · actor and authority stay separate · a delegated decision is
one vote for the delegator · group membership is snapshotted into a running approval · editing a group
does not mutate an existing approval · a recorded decision can never become skipped · branches have
independent denominators and decisions · the majority denominator is **assigned**, not respondents ·
ties do not approve · quorum gates evaluation and never approves by itself · first-response is
deterministic · conditions fail closed · missing or invalid operands remain **refusals**, not `false` ·
decisions and history are append-only · RLS enabled **and** forced on every table · no cross-module
foreign key · **no generic role engine** · no client-supplied actor identity · no `system:auto-approval`
· no outbox unless separately approved · no asynchronous correctness path unless separately approved ·
no business module imports Workflow internals.

**Three proposals in this document would conflict if answered carelessly**, and each is flagged at its
decision: live manager resolution (D-16C-08) contradicts the snapshot rule; an expiry that shrinks the
denominator (D-16C-06) contradicts the assigned-denominator rule; and an escalation that replaces an
approver (D-16C-07) contradicts the recorded-decision rule.

---

## 10. Requirements any 16C checkpoint inherits

**Security.** RLS enabled and forced on every table with exactly one permissive `ALL` policy for
PUBLIC; every security claim proved under a role with `rolsuper = false` and `rolbypassrls = false`;
composite tenant-aware foreign keys on anything referencing a Workflow row; no cross-module foreign
key; no client-supplied identity on any endpoint.

**Tenancy.** Two tenants at equal volume in every isolation proof; totals excluded as well as rows; no
data visible without a tenant context. Any new cross-module query must be tenant-scoped **and**
permissioned on the owning module's side.

**Concurrency.** Two real connections, no sleeps, no disabled constraints; every loser classified by
the constraint or exception type that produced it.

**Exactness.** No `numeric`, `real`, `double precision`, `bigint`, `money`. An SLA target is a **whole
number of hours or days**, never a fraction. Instants are `timestamptz`; a civil date may be
introduced **only** under D-16C-05(b) and must then be a string, never a `Date` above the repository.
Memberships render in full.

**Localization.** English and Arabic in the module's own catalogues, real Arabic script, direction
following language, no key rendered, no hardcoded English in TSX. Any new vocabulary — an escalation
event, an expiry state — needs both languages before it ships.

**Performance budgets.** Inherited unchanged: queue 100 ms, detail 150 ms, cohort 2 s / 10 s / 60 s, at
500 / 10,000 / 100,000 approvals per tenant, two tenants, real PostgreSQL, `vacuum analyze` after
seeding. A due-ness read is a **queue** read and gets the queue budget — it is the screen an
administrator would open every morning, and it must be index-backed rather than a scan over every
running approval.

**API expectations.** No new permission without approval. Any new route reconciles by name against the
module's registration. `approverKind` remains derived and never client-supplied. No identity parameter.
Nothing computed at the edge.

**Admin expectations.** Server-rendered, read-only, bounded request budget with no growth by row
count, both languages, and the honesty section updated in **both** directions — anything 16C
implements must leave the deferred list, and anything still absent must stay on it.

---

## 11. Proposed checkpoints

Once this Definition of Ready is approved, and only then:

1. **Definition of Ready** — this document.
2. **Domain** — the resolution rule, its refusals, and (16D) the due-ness arithmetic.
3. **Schema** — additive columns and widened closed vocabularies, one migration, with parity tests.
4. **Application** — commands, queries, ports, and the snapshot/resolution orchestration.
5. **PostgreSQL repositories** — mappers, plans, isolation, concurrency.
6. **Cross-module contract** — the Identity query, authorized separately and implemented **in
   Identity** by its own checkpoint before Workflow consumes it.
7. **Cross-module adapter** — Workflow's port and the adapter in `apps/api`.
8. **API.**
9. **Admin UI.**
10. **Performance, security and integration audit.**
11. **Final report.**

Checkpoints 6 and 7 are **two** rather than one, and in that order: a completed module's contract is
authorized, built and verified on its own side before Workflow depends on it. That is the sequence
16A used for the Recruitment seam, and it is the only sequence in which a refusal to authorize does
not leave half a feature in the tree.

For **16D**, checkpoint 6 disappears — it needs no cross-module contract.

---

## 12. Documentation corrected in this checkpoint

One, documentation-only, under STEP 17's rule: `docs/PHASES.md` said Phase 16C covers *"notification
and analytics"* (C-5). Those belong to Phases 17 and 20 by their own prompts. The sentence now names
the capabilities 16C could actually own and points the other two at their owners.

C-1 and C-2 are **not** corrected here: C-1 is an error inside a completed checkpoint's plan document,
and rewriting a delivered plan would erase the record of what was believed when the decision was made
— it is stated here instead. C-2 is a schema comment, and this checkpoint may not touch the schema.

---

## 13. NOT VERIFIED after this checkpoint

Unchanged from 16B and re-confirmed against the tree: SLA · business days · escalation · scheduled
firing · durable scheduler and job runner · manager routing · role approvers · dynamic role or group
directory · external approvers · notification delivery · analytics · approval expiry · automatic
delegation expiry · outbox · broker · worker · self-service portals · routing intelligence beyond the
16B core · cohort query · tenant-wide branch or tally aggregates · volumes above 100,000 · concurrency
beyond two connections · authentication through the real Platform adapter.

**`JobPort` moves from "does not exist" to "exists as a port, with no adapter, no runner and no
durable store"** — a correction of the record, not a change of capability.

---

## 14. Stop conditions

Stop and report rather than working around, if:

- a capability requires the durable runner before D-16C-01 is answered;
- a completed module must change before its authorization is granted;
- any proposal would weaken an invariant in §9;
- expiry or escalation would alter a tally denominator;
- routing would resolve live while the group rule snapshots;
- a role directory becomes necessary;
- a scheduled action would need an actor no human supplied;
- the Recruitment seam would have to change;
- a new kernel or shared-infrastructure change is required;
- the performance budget cannot be met without redesign.

---

## 15. Acceptance criteria for this Definition of Ready

- [x] The final tree was read before anything was proposed.
- [x] Every remaining specification item is classified A–E with evidence.
- [x] Six contradictions are reported, cited and left unreconciled except one documentation fix.
- [x] Fourteen blocking decisions are registered, each with options, consequences and a recommendation.
- [x] A split is recommended, with the seam justified from the tree rather than from the example.
- [x] Checkpoints are proposed but not started.
- [x] No production code, schema, migration, package or dependency changed.

**Phase 16C has not started, and must not start until this document is approved.**
