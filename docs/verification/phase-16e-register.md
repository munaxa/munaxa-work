# Phase 16E — Decision Register

**All nine decisions are `APPROVED`.** The owner's explicit decisions are recorded in
[§ Owner approvals](#owner-approvals) below, appended rather than substituted: everything beneath
that section is the **pre-approval record**, preserved word for word, because the reasoning that
produced the questions is what makes the answers auditable a year from now.

**Phase 16E EXISTS**, and implementation is nevertheless **blocked**. Every approved capability stops
at a contract boundary that the approval itself designates as a STOP — eight of them, recorded with
evidence in [`phase-16e-contract-gaps.md`](phase-16e-contract-gaps.md). **No production capability
has been added**, and Phase 16D is untouched.

State verified at the time of writing: HEAD `2150f19`, working tree clean, **zero production changes
since `730502a`** (`git diff 730502a HEAD -- packages apps prisma` is empty).

The evidence behind every entry is in [`phase-16e-plan.md`](phase-16e-plan.md), which is preserved
unchanged in substance; this register is the canonical status table.

---

## Decisions

| ID | Decision | Status | Approval |
|---|---|---|---|
| D-16E-01 | Does Phase 16E exist? | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-02 | Automatic execution | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-03 | Execution ownership | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-04 | JobPort ownership | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-05 | SLA action | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-06 | Expiry action | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-07 | Notification intent | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-08 | Business-day SLA | **APPROVED** | Owner, record dated 2026-08-20 |
| D-16E-09 | Idempotency | **APPROVED** | Owner, record dated 2026-08-20 |

**The approval transition.** All nine stood `OPEN` from `2150f19` — the commit that recorded them —
until the owner's instruction. They were `OPEN` for the whole of that interval, and the earlier state
is not erased by this entry; it is what the rest of this document still records.

**No approval date was supplied by the owner.** `2026-08-20` is the date the decisions were
*recorded here*, and the column says "record dated" rather than "approved on" so that the two are
never confused.

---

<a id="owner-approvals"></a>

## Owner approvals

The register's nine decisions were framed as questions and carried **no lettered options** — the
pre-approval record states outright that "no option is selected and none is recommended". There is
therefore no option label to map onto, and what follows is the owner's **exact semantic wording**,
which the approval requires be recorded as such.

### D-16E-01 — Phase existence · APPROVED

Phase 16E officially exists. Its purpose is to add the controlled **automatic execution** layer on
top of the completed human-triggered engine from Phase 16D, **without changing the meaning of the
existing human workflow**.

*Approved scope:* automatic evaluation of approved workflow conditions · automatic execution of
explicitly approved workflow actions · SLA-driven actions · approval expiry actions · notification
intent emission · business-day SLA evaluation · durable/idempotent execution · `JobPort` integration
through the correct infrastructure boundary.

*Explicitly not absorbed:* notification delivery · Admin authentication · Admin mutation architecture
· candidate enumeration · directories · portals · analytics · external approvers · unrelated Phase 17
Communications implementation.

*Phase 16D is unchanged and no 16D decision is reopened:* human escalation remains supported,
`workflow.approval.escalate` remains its permission, the seven eligibility rules stand, the D-16D-08
stable denominator remains locked, escalated steps remain real steps, no candidate enumeration is
introduced, and Admin authentication remains outside 16D.

### D-16E-02 — Automatic execution · APPROVED, with constraints

Automatic execution is approved. It must use a **dedicated, explicit system-execution mechanism owned
by the infrastructure layer**. The automatic executor **is not a tenant membership and must not
pretend to be one**.

*Forbidden:* a fake human actor · `system:auto-approval` as a normal membership · impersonation ·
service credentials inside Workflow · wildcard authorization · permission bypasses · internal-only
authorization · browser-held credentials · a `tenantId` supplied by a job payload.

*Required of the execution context:* tenant · job/action identity · execution attempt ·
correlation/idempotency identity. Infrastructure-provided; never suppliable by an end user.

*Authorization:* explicit and **separate from human permissions**. `workflow.approval.escalate`,
`approval.decide`, `instance.start`, `instance.cancel` and `group.manage` may **not** be reused for
automatic execution merely because they are nearby.

*Attached stop clause:* "If a new machine-execution authorization contract is required, STOP and
document the exact missing contract rather than inventing one." → **triggered**, see G-1.

### D-16E-03 — Execution ownership · APPROVED

**Platform / infrastructure owns:** scheduler · job triggering · execution context · retry mechanics
· worker lifecycle · job leasing/claiming · execution attempt identity · infrastructure-level
observability.

**Munaxa Work owns:** determining whether an action is due · determining whether it is allowed ·
workflow/domain rules · selecting the business action · transactionally applying it · recording
Workflow history · producing notification intent.

Workflow must not implement its own scheduler, must not create cron logic, must not create worker
lifecycle management, and must not depend directly on a concrete scheduler.

### D-16E-04 — JobPort ownership · APPROVED

`JobPort` is an **infrastructure boundary**. The concrete implementation and the runner belong to
Platform/infrastructure; Workflow may depend only on the abstract port. Required port semantics:
enqueue/schedule · deterministic job identity · tenant-scoped execution · execution attempt identity
· safe retry · cancellation where required · no arbitrary impersonation. No second Workflow-specific
scheduler; no duplicate of `JobPort` inside Workflow.

*Attached stop clause:* "If the existing JobPort contract is insufficient, document the exact contract
gap and stop before inventing a replacement." → **triggered**, see G-3.

### D-16E-05 — SLA action · APPROVED, narrowly

Automatic SLA action execution is approved, with the distinction that **SLA evaluation determines
whether an action is DUE** and does not itself mean an approval expired, was rejected or was
approved — those are separate business actions. The SLA layer must produce an explicit action
decision. The first supported automatic SLA actions are **limited to actions explicitly defined by
Workflow rules**; a generic "do anything when SLA breaches" mechanism is forbidden. SLA remains
derived unless an explicit persisted execution record is required for idempotency or audit.

### D-16E-06 — Expiry action · APPROVED

Automatic expiry execution is approved. Expiry **remains derived** from existing workflow state and
timing rules, and no `expired` column may be added merely to represent the derived state. The
approved sequence when expiry becomes actionable: the scheduler identifies candidate work · Workflow
evaluates current state · Workflow atomically confirms expiry · Workflow performs the approved expiry
action · Workflow records the appropriate history event · notification intent is emitted if
applicable · duplicate execution is a no-op.

*Attached stop clause:* "If the existing history vocabulary does not contain an approved event for an
automatic expiry action, STOP and request/record that contract decision. Do not invent a history
event merely to make implementation pass." → **triggered**, see G-4.

### D-16E-07 — Notification intent · APPROVED

Workflow may emit an explicit notification intent **after a successful business action**. Workflow
does **not** deliver notifications; Phase 17 owns transport, email, SMS, push, templates, delivery
retry, provider integration and delivery status. The Workflow-side contract carries **only** what is
required to communicate the business event, with no provider-specific logic. A durable/outbox-
compatible intent boundary is preferred **where the existing architecture supports it**; a second
messaging system must not be built.

### D-16E-08 — Business-day SLA · APPROVED, with a dependency

Business-day SLA evaluation is approved and must use Organization's **authoritative** calendar and
holiday data through a **bounded cross-module port** following existing precedent. Workflow must not
read Organization tables, duplicate the calendar or holiday data, or model its own calendar. The
contract exposes only the calendar facts Workflow needs — never the whole Organization calendar
domain. No direct persistence access is permitted.

*Attached condition:* the required Organization read contract is to be documented and specified, and
"implement it in Organization **only if this approval covers that dependency**", with the contract
otherwise treated "as a separate authorization dependency unless the owner explicitly includes it".
The owner named no query, no view and no permission for it, and Checkpoint 2's authorization
excludes arbitrary new cross-module contracts and arbitrary new permissions. → **documented, not
implemented**, see G-7.

### D-16E-09 — Idempotency · APPROVED, strong

Automatic execution must be safe under duplicate scheduler delivery · concurrent workers · retries ·
worker crash after business commit · worker crash before acknowledgment · repeated due evaluation ·
delayed jobs · stale jobs · scheduler replay.

*Guarantees required:* the same logical automatic action cannot apply twice · concurrent attempts
converge to one successful business effect · retries after success are safe · a stale execution
cannot mutate an already-incompatible workflow state · history is not duplicated · notification
intent is not duplicated.

*Mechanism:* a **deterministic action/execution identity**, with database-enforced uniqueness and
transactional protection **preferred over** in-memory mutexes, process-local locks, sleeps and
preflight-only checks. Idempotency may not be claimed merely because a handler happens to be
retry-safe; it must be **proved with real PostgreSQL concurrency and integration tests**.

### Standing constraints attached to the approval

Recorded here because they bind every checkpoint of this phase, not only the first:

- **Actor model.** The automatic executor is an *infrastructure execution identity*. It must not
  appear in tenant membership, become or be selectable as an approver, receive human permissions,
  impersonate a human, bypass tenant isolation, or bypass domain authorization. If `SystemContext`
  cannot safely represent it, it must **not** be silently modified.
- **History.** Automatic actions must be auditable — action, instance, affected step/entity,
  execution identity/context, occurrence time, correlation/execution identity — but history event
  names may **not** be invented, and the check constraint is closed.
- **Tenancy.** Tenant identity comes from the authenticated/infrastructure execution context and
  never from a job payload, request body, user input or arbitrary command field. Cross-tenant
  execution must fail safely, proved with real PostgreSQL RLS tests.
- **Negative space, still refused.** `/workflow/escalations` · automatic polling APIs · tenant-wide
  escalation dashboards · candidate enumeration · automatic Admin controls · fake system membership ·
  scheduler logic inside Workflow · direct Organization or Identity persistence access · service
  credentials in Admin · wildcard authorization · permission inference · unapproved automatic history
  events.

### Checkpoint 2 authorization, and why it has not started

Checkpoint 2 is **authorized** for the approved scope. It does **not** authorize arbitrary new
permissions, arbitrary new history events, arbitrary new cross-module contracts, Admin
authentication, Admin mutation architecture, candidate enumeration, notification delivery, a
scheduler inside Workflow, fake system users, impersonation or wildcard authorization — and "any
newly discovered contract gap must be stopped and explicitly reported".

Eight were discovered, and each is a stop condition the approval names:

| Gap | Blocks | Stop condition |
|---|---|---|
| G-1 machine-execution authorization | D-16E-02 and everything downstream | 1 — a new permission not explicitly approved |
| G-2 infrastructure execution context | D-16E-02, D-16E-03 | 4 and 5 — Platform authentication / a fake actor |
| G-3 `JobPort` is enqueue-only | D-16E-04 | D-16E-04's own clause; 7 if worked around |
| G-4 closed history vocabulary and missing execution columns | D-16E-06, and every automatic action | 2 — a new history event not approved |
| G-5 no SLA action defined by any Workflow rule | D-16E-05 | 8 — a rule not determinable from the domain |
| G-6 no expiry trigger in the domain | D-16E-06 | 8 |
| G-7 no Organization calendar read contract | D-16E-08 | 1 and 3 |
| G-8 notification intent cannot address a recipient | D-16E-07 | 1 and 3 |

**Checkpoint 2 is authorized but cannot begin**, and the distinction is deliberate: the authorization
is not withheld, the prerequisites are absent. No production code was written, because no part of the
approved scope is reachable without crossing one of the eight — and a stop condition may not be
resolved by making a smaller undocumented change.

---

## Numbering reconciliation

`phase-16e-plan.md` was written before this register and numbered its decisions differently: it
raised **the actor problem as its own D-16E-05**, which shifted the five capability decisions by one
and pushed idempotency to D-16E-10.

**This register's numbering is canonical.** The actor problem is not lost — it belongs inside
**D-16E-02**, which is where the owner's own framing places it (*"there is no approved automatic
actor; `SystemContext` has no actor"*). The crosswalk:

| This register | `phase-16e-plan.md` |
|---|---|
| D-16E-01 | D-16E-01 |
| **D-16E-02** | D-16E-02 **+ D-16E-05 (the actor)** |
| D-16E-03 | D-16E-03 |
| D-16E-04 | D-16E-04 |
| D-16E-05 SLA action | D-16E-06 |
| D-16E-06 expiry action | D-16E-07 |
| D-16E-07 notification intent | D-16E-08 |
| D-16E-08 business-day SLA | D-16E-09 |
| D-16E-09 idempotency | D-16E-10, with §11 concurrency and §12 retry folded in |

Nothing was renamed to change its meaning, and no finding was dropped.

---

## What each decision asks

### D-16E-01 — Does Phase 16E exist? · **ROOT**

Whether there should be a Phase 16E at all; if so its exact scope; whether that scope is carved from
`17_PHASE_16_WORKFLOW.md`; what stays with Phases 17, 20, 22 and 24; and whether any existing phase
ownership must change.

*Evidence.* The specifications run `17_PHASE_16_WORKFLOW.md` → `18_PHASE_17_COMMUNICATIONS.md`. There
is **no authoritative Phase 16E definition anywhere in the repository**; the name appears only in the
closure sentence written at the end of 16D. 16A–16D were carved out of one specification during
execution.

**Phase 16E must not be created merely because work seems logically related to 16D.**

*Blocks:* every other decision.

### D-16E-02 — Automatic execution

Whether Phase 16E is authorized to introduce automatic workflow actions at all.

*Evidence.* Due evaluation, the command, persistence and history all exist. What does not exist is an
approved actor: `SystemContext` carries **no `actor` field**, `assertTenantScoped` in the CQRS
pipeline **throws** when a business handler is reached from it, and `system:auto-approval` is refused
by domain guards *and* by database check constraints. **The absence is a deliberate control, not
missing infrastructure.**

**Nothing may be invented to work around it** — no system actor, service credential, scheduler
identity, bypass identity, "internal" authorization or background-execution semantics.

### D-16E-03 — Execution ownership

If automatic execution is approved, who owns it — keeping these **separate and not collapsed into one
decision**: defining a command · evaluating a condition · scheduling work · executing work · retrying
work · delivering notifications.

*Evidence.* Several phases assume a runner; **no phase owns one**. Ownership may not be assigned
merely because another phase mentions jobs.

### D-16E-04 — JobPort ownership

*Evidence.* The abstraction exists at `packages/kernel/src/ports/index.ts:61-74` with **zero
consumers and zero implementations**; no phase specification names it; other phases assume background
jobs; no phase has been approved as the durable-runner owner.

**The question is ownership and authorization, not implementation.** Do not implement a consumer, do
not assign it to 16E, do not invent a runner.

### D-16E-05 — SLA action

Whether Phase 16E is authorized to create an **action** resulting from an SLA condition.

*Evidence.* The service level is derived on read: no `due_at`, no `expired`, no breach persistence, no
business-day calculation, no clock-driven domain logic. Elapsed-time service level is already
delivered.

**The derived state must not be turned into persisted state to make execution easier**, and
business-day semantics must not arrive with it.

### D-16E-06 — Expiry action

Whether an expiry **action** is in scope, keeping the distinction that expiry semantics may be
*derived* while automatic expiry execution is a separate capability.

*Evidence.* No expiry command, no expiry column, no approved automatic expiry actor. D-16C-06
approved expiry as *observed and derived, never written*.

**That approval expiry is discussed does not mean expiry execution is approved.**

### D-16E-07 — Notification intent

Whether Workflow is authorized to emit notification **intent**, keeping three responsibilities apart:
workflow execution · notification intent · notification delivery.

*Evidence.* Phase 17 owns communications and delivery; existing modules already demonstrate
synchronous notification-port intent; Workflow emits none today.

If approved, it defines **only what Workflow may emit**. No delivery, queue, broker, worker, retry or
notification infrastructure forms part of this gate.

### D-16E-08 — Business-day SLA

Whether business-day SLA belongs in 16E at all.

*Evidence.* Organization holds calendar and holiday data and publishes **write commands only**; there
is **no approved calendar read route**, and `CalendarDayView` has **no producers**. Workflow may not
read Organization's persistence directly.

**The contract must not be created now.** If business-day SLA is ever approved, a bounded Organization
read contract is recorded here as a **prerequisite**.

### D-16E-09 — Idempotency

If automatic execution is eventually approved, what idempotency means for it — **explicitly
distinguishing** duplicate request · repeated condition evaluation · retry after partial failure ·
concurrent execution · already-completed workflow · already-fired action · repeated notification
intent.

**The human escalation command's existing database uniqueness pattern must not be assumed to solve
automatic execution.** ADR-0071 and `workflow_step_escalation_idx` are the precedent for *how* a
durable identity is enforced, not evidence that the identity for an automatic action has been chosen.

---

## Recorded, not asked

Three design questions surfaced by the investigation have **no place among the nine** because they
arise only if D-16E-02 approves automatic actions. They are recorded so they are not discovered late,
and they are **not** raised as work: which automatic actions write history and under which event (the
check constraint is closed at nine values) · what authorizes an automatic action · whether Admin
displays automatic execution state (also gated by **D-16D-10**, which remains outside scope).

**Since the approval, two of the three are live and still unanswered.** D-16E-02 approved automatic
actions, which is exactly the condition these were waiting on:

- *which event an automatic action writes* — now **G-4**, an explicit stop; the constraint is still
  closed at nine and the approval forbids inventing a tenth;
- *what authorizes an automatic action* — now **G-1** and **G-2**, explicit stops;
- *whether Admin displays automatic execution* — **still not raised.** D-16D-10 (A) keeps Admin
  authentication and mutation outside scope, and D-16E-01 excludes Admin mutation architecture from
  Phase 16E, so this stays conditional.

---

## Preserved findings

These stand as findings and must not be silently resolved:

1. **The actor problem is a deliberate control**, not missing infrastructure. It must not be solved by
   adding a system actor.
2. **Business-day SLA is blocked by a missing Organization read contract.** The module boundary must
   not be bypassed.
3. **`JobPort` has no consumer and no owner**, and must not be assigned to Phase 16E without explicit
   approval.
4. **Expiry is a derived, read-time concept.** No persisted expiry state.
5. **Notification intent is separable from delivery**, and Phase 17 owns delivery.
6. **Admin authentication remains outside scope** (D-16D-10). Authentication must not enter Workflow.
7. **There is no authoritative Phase 16E specification**, so D-16E-01 must resolve before any
   implementation scope is real.

**Where each stands after the approval.** None is resolved by it, and none is dropped:

| # | After the approval |
|---|---|
| 1 | **Stands, and is now load-bearing.** The approval agrees: no fake human actor. The control is unchanged; what is missing is the infrastructure identity that replaces it — **G-2** |
| 2 | **Stands.** D-16E-08 approves the capability and leaves the contract as a separate authorization dependency — **G-7** |
| 3 | **Half resolved.** Ownership is now explicit (Platform, D-16E-04). The contract is still insufficient — **G-3** |
| 4 | **Stands.** D-16E-06 keeps expiry derived and forbids an `expired` column |
| 5 | **Stands.** D-16E-07 approves intent only; Phase 17 still owns delivery. Addressing a recipient is newly found to be blocked — **G-8** |
| 6 | **Stands unchanged.** D-16D-10 (A); Admin authentication and mutation are excluded from Phase 16E |
| 7 | **Resolved by D-16E-01**, which supplies the specification and its scope |

Two findings are **added** by this checkpoint's investigation:

8. **No automatic action is defined by any Workflow rule.** A step template carries a service-level
   *target* and no action, and no expiry period is configurable anywhere. The domain has nothing to
   evaluate — **G-5**, **G-6**.
9. **`workflow_history` cannot record an execution identity.** It has `actor_membership_id` and
   `on_behalf_of_membership_id` and no column for execution or correlation identity, which the
   approval requires of every automatic action. `metadata` is not an answer — **G-4**.

---

## Status

**Phase 16E EXISTS and all nine decisions are APPROVED.** Checkpoint 2 is **authorized** and has
**not started**: eight contract gaps block it, each one a stop condition the approval itself defines,
recorded with evidence in [`phase-16e-contract-gaps.md`](phase-16e-contract-gaps.md).

**No production code, test, schema, migration, permission, route, command, query, port, adapter or
cross-module contract was created or modified.** Phase 16D stands exactly as `730502a` left it.

*Superseded.* Until the owner's decisions, this section read: *"Phase 16E is NOT READY. D-16E-01
through D-16E-09 remain OPEN awaiting explicit owner approval. Checkpoint 2 has not started, and no
implementation is authorized."* That was true of `2150f19` and is kept here rather than deleted.

When each gap is closed, this register gains the contract that closed it and the approval that
authorized it — appended, never by rewriting what stands above.
