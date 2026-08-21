# Phase 16E — Decision Register

**Thirteen decisions are `APPROVED`, D-16E-12 is resolved, and one — D-16E-14 — is `OPEN`.** The approved automatic service-level
reminder is **implemented, tested and verified** — see
[`phase-16e-reminder-implementation.md`](phase-16e-reminder-implementation.md). One dependency
remains genuinely outside this repository: no job runner exists in Platform, so nothing *invokes* the
reminder on a schedule yet — and one remains **inside** it, opened by the handover investigation and
recorded as **D-16E-14**: no published query answers *which* steps are due, so a runner could execute
a reminder and could not find one. The contract Platform must satisfy, and that gap, are in
[`phase-16e-platform-runner-contract.md`](phase-16e-platform-runner-contract.md). The owner's explicit decisions are recorded in
[§ Owner approvals](#owner-approvals) below, appended rather than substituted: everything beneath
that section is the **pre-approval record**, preserved word for word, because the reasoning that
produced the questions is what makes the answers auditable a year from now.

*The three paragraphs that follow are the record as it stood at each earlier checkpoint, kept because
the reasoning is what makes the outcome auditable. Where a statement has since been overtaken, the
correction follows it rather than replacing it.*

**Phase 16E EXISTS**, and implementation was **blocked** at every approved capability's contract
boundary — eight of them, recorded with evidence in
[`phase-16e-contract-gaps.md`](phase-16e-contract-gaps.md). *Overtaken:* six of the eight were closed
by the work recorded in [`phase-16e-reminder-implementation.md`](phase-16e-reminder-implementation.md);
the two that remain are named there.

The owner then resolved those gaps in a second instruction, recorded in
[§ Contract-gap resolutions](#gap-resolutions). Two of its nine decisions are **amendments** that
narrow an earlier approval. *Overtaken in one respect:* the dependency order's first two steps were
read as belonging to a repository this one may never modify. Investigation found the machine
*principal* and its *capability* already implemented in Platform and simply unconsumed, while the
`ExecutionContext` they feed is this repository's own kernel — so the context was built here and the
principal remains Platform's. What is genuinely absent is a **job runner**, and it still is.

State at the earlier checkpoints: HEAD `7740817`, working tree clean, zero production changes since
`730502a`. **That is no longer true, and deliberately so** — the approved reminder is implemented.

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
| D-16E-10 | The first automatic business action | **APPROVED** | Owner — automatic service-level reminder |
| D-16E-11 | The reminder's history event — its **existence** | **APPROVED** | Owner |
| D-16E-12 | Authorization to modify Identity for the recipient contract | **RESOLVED** | Covered by the D-16E-13 directive; no new permission required |
| D-16E-13 | The **concrete** reminder history contract | **APPROVED** | Owner |
| D-16E-14 | How the runner discovers a due reminder | **OPEN** | None |

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

<a id="gap-resolutions"></a>

## Contract-gap resolutions — owner decisions

Recorded from the owner's second instruction. **Seven approvals and two amendments.** The amendments
*narrow* what the first instruction approved, and the narrowing is the substance: they withdraw
permission to build the general mechanism and require a named business action first.

### G-2 — Machine execution context · APPROVED

**Platform must provide it.** It must be tenant-scoped · infrastructure-provided · distinct from the
`TenantContext` human actors use · distinct from `SystemContext` · non-impersonating ·
non-membership-based · incapable of being supplied by a user · carrying deterministic job/execution
identity · carrying execution attempt identity · carrying correlation identity where required.

No fake `TenantMembership`. No fake `system:auto-approval` membership. No human actor field used for
machine execution. **Workflow must not invent this context.**

*Attached stop clause:* "If Platform's existing context model cannot support this, document the
minimum Platform contract required and STOP."

### G-1 — Machine authorization · APPROVED

**Machine authorization belongs to Platform.** Munaxa Work must not implement a role engine or a
permission engine. The automatic executor is authorized through an explicit **Platform-owned
machine-execution capability**. Human Workflow permissions must not be reused as machine
authorization. No wildcard permissions · no impersonation · no service credentials inside Work · no
permission bypass · **no deployment-only hidden authorization**.

*Attached condition:* "The exact Platform authorization contract must be documented before Workflow
consumes it."

### G-3 — `JobPort` · APPROVED, with extension

**Platform owns the concrete job runner.** The existing `JobPort` **remains** the Workflow-facing
abstraction and is to be extended *only as necessary* to support: deterministic job identity ·
scheduling · delivery · execution attempt · retry · acknowledgement/completion · safe duplicate
delivery · cancellation where required.

Workflow must not implement a worker or a scheduler. No second `JobPort`. No process-local queues. No
sleeps or polling loops as a substitute.

*Attached condition:* "If changing JobPort affects other modules, document the impact before
implementation." → **it does**; the impact is measured in `phase-16e-contract-gaps.md`.

### G-5 — SLA action · **AMENDED**

**The previous approval is narrowed.** A generic "SLA breach executes an action" framework must
**not** be implemented. SLA **remains a derived condition**.

An automatic action may be implemented **only when a specific business action has been explicitly
defined and approved**. The first implementation must identify: the exact triggering condition · the
exact workflow state · the exact action · the exact history event · the idempotency identity · the
notification intent, if applicable.

**Do not infer an action from `serviceLevel`. Do not create a generic action enum capable of
arbitrary future actions.**

*What changed:* D-16E-05 approved "automatic SLA action execution" limited to actions defined by
Workflow rules. There were none, and this amendment resolves that not by defining one but by
**withholding implementation until the owner names one**. No such action has been named.

### G-6 — Expiry · **AMENDED**

**Expiry stays derived.** No `expired` persistence column. **No automatic expiry action until the
exact expiry behaviour is explicitly defined.** If the product decision is to automatically
transition, close, reject or skip something on expiry, *that exact action* must be recorded as a
**separate explicit decision before implementation**.

*What changed:* D-16E-06 approved "automatic expiry execution" and set out a seven-step sequence for
it. This amendment suspends the execution half pending a named action. No such action has been named.

### G-4 — Automatic history · APPROVED in requirement, **withheld in vocabulary**

The architectural requirement is approved: automatic actions require auditable history carrying the
action · the workflow instance · the affected entity/step · the **execution identity** · the
**execution/correlation identity** · the occurred timestamp.

**The vocabulary is not.** Because the current history vocabulary is closed, any new automatic-action
history event **requires explicit approval before migration or code**. An existing human event must
**not** be reused merely because it is semantically close. If new columns are required, execution and
correlation provenance move **together with** the history change.

### G-7 — Organization calendar · APPROVED, bounded

A bounded cross-module contract is approved. Organization remains the owner of calendars, holidays
and calendar-day semantics. Workflow consumes a **narrow** contract only — no direct table access, no
duplicated calendar data, no broad Organization directory or calendar API. The minimum contract
answers **only** the facts needed to determine whether a date is a business day, following the
existing bounded-port precedent.

*Attached stop clause:* "If a new Organization permission is required, STOP and report it before
implementation." → **not required.** `organization.calendar.read` already exists and is already
grantable; see the correction recorded in `phase-16e-contract-gaps.md`.

### G-8 — Notification recipient · APPROVED, bounded

A bounded Identity contract is approved. `identity.describe-member` must **not** be reused. No full
member profiles. No Workflow access to Identity persistence. The contract resolves **only** the
recipient information the approved `NotificationPort` contract requires. Workflow addresses
memberships; **Identity owns the mapping** from membership to notification recipient / user identity.

*Attached stop clause:* "If a new Identity permission is required, stop and request explicit approval
rather than inventing one." → **not required.** `identity.membership.read` already exists and is what
`identity.membership-standing` already uses.

**Notification delivery and an outbox are not authorized in Phase 16E** unless separately approved.

### Dependency order imposed by the resolutions

1. Platform machine execution context
2. Platform machine authorization
3. `JobPort` execution semantics
4. **Define specific automatic business action(s)**
5. Define corresponding history event(s)
6. Organization business-day contract, if required
7. Identity notification-recipient contract, if required
8. Workflow automation integration
9. PostgreSQL idempotency and concurrency verification

**"Do not skip ahead because a later layer is technically easy."**

### Stop conditions attached to the resolutions

Platform context cannot represent machine execution safely · machine authorization is undefined ·
`JobPort` semantics require an unapproved architectural change · **a specific automatic action has
not been defined** · a new history event is required but not approved · a new permission is required
· a cross-module contract exceeds the approved bounded scope · a fake user or membership would be
necessary · impersonation would be necessary · idempotency cannot be enforced transactionally.

**No stop condition may be solved with a workaround.**

### Where the resolutions leave the phase

| Step | Owner | Status |
|---|---|---|
| 1 · machine execution context | **Platform** | **Cannot be done here.** Platform is the separate repository `munaxa/munaxa-platform`; MASTER_INSTRUCTIONS: *"Munaxa Work never duplicates Platform functionality, and never modifies Platform."* |
| 2 · machine authorization | **Platform** | **Cannot be done here**, same reason. The contract must be documented before Workflow consumes it, and it does not exist |
| 3 · `JobPort` execution semantics | kernel (this repository) | **Blocked by step 1.** Delivery must hand the handler the machine execution context; that type does not exist, so the delivery half cannot be typed |
| 4 · specific automatic action(s) | **the owner** | **Not defined.** G-5 and G-6 both withhold implementation until one is named. This is the next owner decision |
| 5 · history event(s) | the owner | Blocked by step 4, and the vocabulary is withheld until then |
| 6 · Organization business-day contract | Organization | Blocked by order; **no new permission needed** |
| 7 · Identity recipient contract | Identity | Blocked by order; **no new permission needed** |
| 8 · Workflow automation | Workflow | Blocked by 1–7 |
| 9 · PostgreSQL verification | Workflow | Blocked by 8 |

**Checkpoint 2 remains authorized and not started.** Three stop conditions are live: Platform context
cannot represent machine execution (nothing here can supply it), machine authorization is undefined,
and no specific automatic action has been defined.

---

## D-16E-10 — The first automatic business action · **APPROVED**

*The investigation that produced this decision is preserved below exactly as it stood while the
decision was OPEN; the owner's resolution follows it.*

The tenth decision, added after D-16E-09. **Nothing above it is renumbered, and no approved decision
changes status.** It exists because the G-5 and G-6 amendments withhold implementation until the
owner names a specific business action, and step 4 of the dependency order is that naming.

The full investigation is in [`phase-16e-first-action.md`](phase-16e-first-action.md). In summary:

**The candidate — automatic SLA escalation — is put forward with a recommendation to DECLINE *as the
first action*, and is not declined on merit.** The blocker is structural rather than a matter of
effort: `escalateBranch` takes `approverMembershipId` as an **input** and the domain never chooses a
person, so an automatic escalation must decide *who* is added. The three possible sources are all
closed — candidate enumeration is refused by **D-16D-16 (A)** and excluded from D-16E-01's scope;
configuring a target on the step template is new persistence and a new capability; and reusing
manager resolution widens **P-1** and **D-16C-11**, which `domain/manager.ts` states may not be
widened without a new approval. Secondary problems: `unanimous` branches refuse escalation by name,
Admin's `escalated` marker cannot distinguish a machine from a person, the manual-versus-automatic
race has no recorded rule, and `workflow_step_escalation_idx` keys on the *membership* so it cannot
prevent two automatic attempts adding two different people to one stuck branch.

**An alternative is put forward instead, for APPROVE / AMEND / DECLINE — not approved and not assumed
approved:** an **automatic service-level reminder**. When an awaiting step with a configured service
level passes its due instant, Workflow emits **one** notification intent addressed to that step's own
approver, records it once, and **changes no workflow state**. It chooses nobody (the recipient is
already named on the step, so D-16D-16 stays closed), leaves the D-16D-08 denominator structurally
unreachable, decides nothing on anyone's behalf, needs no SLA model change, needs no business days,
and has a one-key idempotency identity — `(tenant_id, step_id)`, because a step breaches once —
enforceable by a single partial unique index on `workflow_history` itself.

**Attached decisions, required only if the reminder is approved:** the **history event name** (the
vocabulary is closed at nine and none may be invented) · **two history columns** for execution and
correlation identity, moving in the same change · the **G-8 Identity contract**, bounded, on the
`identity.membership-standing` model, with **no new permission** since `identity.membership.read`
already exists.

**If escalation is preferred anyway**, four questions must be answered first: how the automatic
approver is selected (reopening D-16D-16, or widening P-1 and D-16C-11) · what happens on a
`unanimous` branch · whether a human escalation consumes the branch's automatic entitlement · whether
Admin must distinguish automatic from human escalation.

**Business days are not required** by either option, so **G-7 stays unopened**: the SLA model supports
elapsed time only, as `domain/service-level.ts` states outright. **Notification intent is required by
the alternative only**, where the intent *is* the action.

**Both options still require all three Platform contracts** — G-2, G-1 and G-3 — which live in
`munaxa/munaxa-platform`.

*Recorded, not asked:* whether the first automatic action must alter business state at all. If it
must, the finding is that **no such action can be defined today** without reopening a closed 16D
decision or introducing new configuration. That is the owner's choice and is not resolved by
inference.

### The owner's resolution · **APPROVED**

**D-16E-10 = APPROVED.** The first automatic business action is the **automatic service-level
reminder**:

> When an awaiting workflow step with a configured service level passes its due instant, the system
> emits exactly one notification intent for the approver assigned to that step, and makes no workflow
> decision and no state transition.

**Automatic escalation is rejected as the first automatic action**, and this approval must not be
reinterpreted as approving it. The recommendation to DECLINE it stands with its reasoning intact
above; nothing in it is withdrawn.

The approval defines the **business action only**. It authorizes inventing nothing — no machine actor,
scheduler, worker, `JobPort` execution, Platform authentication, Platform machine authorization,
generic automation engine, generic SLA action enum, generic expiry framework, service credential,
impersonation or permission bypass.

The full contract is [`phase-16e-reminder-contract.md`](phase-16e-reminder-contract.md): the exact
trigger (existing SLA semantics, strictly `>`, no business days, nothing persisted about the
condition), the state predicate, the intent, the recipient, the provenance, the idempotency identity
**`(tenant_id, step_id)`**, the transaction boundary, stale-execution and concurrency behaviour, the
Platform and Identity dependencies, and the sixteen explicit non-goals.

**Locked by this approval and not reopened:** D-16D-08 · D-16D-09 · D-16D-13 · D-16D-14 · D-16D-15 ·
D-16D-16 · D-16D-17 · D-16D-18 · D-16D-19 · D-16E-01…09 as approved and amended · G-1 · G-2 · G-3 ·
G-4 · G-7 · G-8.

**Three stop conditions are live**, so implementation has not begun: the Platform execution contract
is absent (G-2, G-1, G-3) · the Identity recipient contract is absent (D-16E-12) · the history event
is not approved (D-16E-11).

---

## D-16E-11 — The reminder's history event · **APPROVED (existence only)**

*Opened by the D-16E-10 contract and preserved below as it stood; the owner's resolution follows.*

Opened by the D-16E-10 contract, as the approval directs: *"Create a decision record for the history
event and leave it OPEN unless this instruction explicitly approves the exact event name."* **No
event name was supplied, so none is proposed and none is invented.**

The vocabulary is closed at nine values in two places asserted to agree —
`WORKFLOW_HISTORY_EVENTS` and `workflow_history_event_check`. The event must distinguish *an automatic
service-level reminder was emitted* from *a human escalated a branch*, and **`step-escalated` must not
be reused**: the domain defines it as a human act, and recording one act under another's name would
put an answer in the timeline nobody gave.

The decision also covers the **two provenance columns** — execution identity and correlation identity
— which G-4 requires move in the same change as the event value; `workflow_history` has neither today,
and `metadata` is not an acceptable home.

*Second checkpoint*, not started: `phase-16e-reminder-history.md` — event name · domain meaning ·
actor fields · execution/correlation fields · metadata · check-constraint change · RLS implications ·
append-only trigger implications · idempotency storage · concurrency behaviour.

**No migration, index or code may be written until this is approved.**

### The owner's resolution · **APPROVED, existence only**

**D-16E-11 = APPROVED** for the **existence** of a dedicated Workflow history event meaning exactly:

> Workflow automatically emitted a service-level reminder because an awaiting step passed its
> configured elapsed-time service level.

It is an **observation of an automatic notification-intent action**. It must not mean approver
escalated · approved · rejected · skipped · approval expired · SLA permanently breached · workflow
state changed.

**Explicitly not approved**, and therefore all still OPEN under **D-16E-13**: the event identifier ·
any column layout · any metadata shape · any provenance field name · any migration · any index · any
idempotency implementation. Nor: Identity modification · Platform modification · `JobPort` ·
scheduler · worker · notification delivery · outbox · broker · machine actor · service account ·
authentication change.

The investigation is [`phase-16e-reminder-history.md`](phase-16e-reminder-history.md), which traces
domain → repository → PostgreSQL → repository → view → rendering and answers every required question.
Its three most consequential findings:

1. **The actor model needs no change and no fake human.** Both actor columns stay **null**, which is
   the model's documented meaning — `domain/history.ts:35`, *"Absent when nothing human did"* — and
   every `step-awaiting` entry already does it. Separately, `workflow_history.created_by` is
   `not null` and comes from `actorOf()` in `packages/persistence/src/repository.ts:29-34`, which
   already produces a non-human `system:<reason>` for system contexts. That makes it a **third call
   site** the G-2 machine context must be represented at, alongside `assertTenantScoped` and
   `currentTenantId` — in a shared package every module uses. Newly recorded.
2. **Provenance must be dedicated columns, never `metadata`.** `metadata` is on the parity suite's
   `INFRASTRUCTURE` exclusion set, read by no mapper and written by no mapper — provenance placed
   there would be invisible to the application, the exact silent-unmapping failure that suite exists
   to catch.
3. **The history row can itself be the idempotency record**, because `workflow_history` is already
   insert-only *in the database* (the `workflow_history_no_mutation` trigger refuses update and
   delete) and already RLS-protected. So a claim can never be released, and no second table is
   needed.

**Proposed and not adopted:** `step-reminded`, with `step-service-level-reminded` offered as a
runner-up so the choice stays the owner's.

---

## D-16E-13 — The concrete reminder history contract · **APPROVED**

*The open form of this decision is preserved below as it stood; the owner's resolution follows it.*

D-16E-11 approved the event's **existence**; this decision is its **concrete shape**, and nothing in
it may be inferred from that approval:

- the exact **event identifier** — proposed `step-reminded`, runner-up
  `step-service-level-reminded`, neither adopted;
- the exact **provenance columns** — four are needed (execution identity, job identity, execution
  attempt, correlation identity), and their names, types and nullability **cannot be fixed until G-2
  defines what the machine execution context carries**. Tenant, instance and step are not duplicated;
- the exact **index predicate** — proposed
  `unique (tenant_id, step_id) where event = '<value>' and deleted_at is null`;
- the exact **migration** — additive: widen the check to ten values, add the columns, add the index;
- the **transaction-ordering trade-off**: `claim → notify → commit` risks a **duplicate** reminder on
  a crash; `claim → commit → notify` risks a **permanently lost** one, because the claim is committed
  and history is immutable, so no retry can ever re-emit it. There is no outbox and inventing one is
  forbidden, so one window is unavoidable. The investigation *recommends* the first — a redundant
  message is cheaper than a silence for an action whose whole effect is one message, and
  `NotificationRequest.idempotencyKey` gives Communications a second chance to suppress it — but
  **the choice is the owner's**.

**No migration, index, column or code exists.** Twelve change points are enumerated in the
investigation; none is implemented.

### The owner's resolution · **APPROVED**

**D-16E-13 = APPROVED**, and implementation of the concrete history contract is authorized. The
approved contract:

| Item | Approved value |
|---|---|
| **Canonical event** | **`step-reminded`** — the runner-up `step-service-level-reminded` is explicitly **not** to be used, nor any of `step-escalated`, `sla-breached`, `sla-overdue`, `notification-sent`, `automation-executed`, `job-executed`, `scheduler-fired`, `system-action`. *The event name is the business fact; automatic execution is provenance* |
| **Meaning** | an automatic service-level reminder intent was emitted for an awaiting step after its configured elapsed-time service level had passed. Implies nothing about delivery, receipt, reading, escalation, approval, rejection, skip, expiry, persisted overdue state, or any change to state, denominator, threshold, `outstanding` or `unresolved` |
| **Actor** | `actor_membership_id = NULL`, `on_behalf_of_membership_id = NULL`. No human actor is created or impersonated — not the requester, approver, manager, administrator or a service membership. **The recipient is not the actor** |
| **Provenance** | four dedicated **nullable** fields: execution identity · job identity · execution attempt · correlation identity. **Concrete names and types must follow the Platform execution-context contract**; until G-2/G-1/G-3 exist, **STOP rather than invent machine-identity types**. Never `metadata`, never secrets, tokens, credentials or authorization material. Tenant, instance and step are not copied in redundantly |
| **Idempotency** | identity `tenant_id + step_id + event = 'step-reminded'`; **the `workflow_history` row itself is the idempotency record**. Index: `unique (tenant_id, step_id) where event = 'step-reminded' and deleted_at is null`. No separate table, no in-memory or process-local locking, no scheduler-level dedup, no application-only duplicate check, no sleeps, no exactly-once assumptions. **PostgreSQL is authoritative** |
| **Vocabulary** | nine values → **ten**. Every layer that constrains the vocabulary updates consistently, and **no exact-set assertion may be weakened** |
| **Migration** | **one additive** migration: widen the CHECK · add the four provenance columns · add the partial unique index. RLS, forced RLS, append-only triggers, history immutability, tenant policies and authority checks are **not** weakened — the idempotency mechanism works *with* immutability, never around it |
| **Transaction ordering** | **`claim/idempotency → record history → commit → emit intent`.** The owner **rejected** `claim → notify → commit`, which opens a duplicate-notification window if the transaction later rolls back. The commit is the authoritative idempotency boundary, and the guarantee is explicitly **at-most-once reminder intent dispatch**. If dispatch fails after commit, history and the claim remain and the reminder is **not** re-emitted. No outbox in this checkpoint; ADR-0053/0064 unchanged; **exactly-once must not be claimed** |
| **Stale execution** | re-evaluate authoritative state inside the transaction, strict `>`. If no longer eligible: no history, no intent, no state change — the repository's established no-op result |
| **Localization** | `step-reminded` in **both** `en.json` and `ar.json`, human-readable. Provenance is **not** exposed through `WorkflowHistoryView` |

*Note on the recommendation this overrides.* The D-16E-11 investigation recommended
`claim → notify → commit`, reasoning that a duplicate message is cheaper than a silence. **The owner
decided the other way**, and the decision stands: at-most-once dispatch, with a missed notification
accepted rather than concealed. The earlier recommendation is left in place above so the trade-off
remains legible, not because it survives.

### Step 1 preconditions — **FAILED. Implementation did not begin.**

Verified at HEAD `07ed810`, working tree clean:

| Dependency | Required for | Status |
|---|---|---|
| **G-2** machine execution context | the four provenance columns (§5, §8.2), and any execution at all | **ABSENT** — `ExecutionContext` is still exactly `TenantContext \| SystemContext`; no machine-identity type exists anywhere in the kernel or the API |
| **G-1** machine authorization | authorizing the automatic execution | **ABSENT** — zero machine permissions declared |
| **G-3** `JobPort` execution | delivering the execution | **ABSENT** — `JobPort` is still enqueue-only, with **zero** implementations |
| **D-16E-12** Identity recipient contract | resolving the notification recipient | **OPEN** — and the existing contracts are **insufficient**, verified below |

**Why the migration cannot be written.** §8.2 states plainly: *"Their concrete names/types are
dependent on the Platform execution-context contract. If that contract is unavailable: STOP before
migration."* It is unavailable. And because §8 authorizes **one** migration containing 8.1, 8.2 and
8.3 together, splitting it to land the CHECK and the index alone would be working around the
dependency — which §25 forbids outright.

**Why the vocabulary cannot move alone.** `workflow-parity.integration.test.ts:104` requires
`workflow_history_event_check` and `WORKFLOW_HISTORY_EVENTS` to enumerate *exactly* the same set.
Adding `step-reminded` to the domain without the migration turns that assertion red, and §7 forbids
weakening it. The two must move together — the mechanism Phase 16D used deliberately for
`step-escalated`.

**Why Identity is insufficient, verified rather than assumed.** `TenantMembershipView` does carry
`workforceUserId` — the exact field `NotificationRecipient` needs — but every query that returns it is
closed to this use by §13: `identity.list-memberships` and
`identity.active-memberships-for-employment` are **enumerations**, and `identity.describe-member` is
**explicitly forbidden**. `identity.membership-standing` returns `{ active }` only, and widening it is
forbidden. The data is one field away and there is no permitted route to it. → **STOP at the Identity
boundary**, exactly as §13 provides.

**Nothing was worked around.** No fake actor, no `system:auto-reminder` identity, no permission
bypass, no wildcard authorization, no service credential, no impersonation, no tenant bypass, no
Work-side substitute for a Platform contract, no direct query of Identity's database, no widened
contract, and no split migration.

---

## D-16E-12 — Authorization to modify Identity for the recipient contract · **OPEN**

The bounded Identity contract itself is approved in principle by **G-8**. Permission to modify the
Identity module is a **separate** decision, exactly as **D-16D-19** was for
`identity.membership-standing`, and it is not inferred from G-8.

*Why a contract is needed at all:* `NotificationRecipient` requires a workforce-user identity;
Workflow addresses memberships and contains zero `userId` occurrences in production code.
`identity.membership-standing` returns `{ active }` and cannot answer it; `identity.describe-member`
is ruled out.

*The minimum contract, specified in `phase-16e-reminder-contract.md` §13 and **not created**:* one
membership identifier in · tenant-scoped from the execution context · only the recipient identity
`NotificationPort` requires · declares the **existing** `identity.membership.read`, so **no new
permission** · no enumeration · no profile, employment, reporting or delegation data · a second narrow
query rather than a widening of an existing one.

*Third checkpoint*, not started. Identity has not been modified.

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

---

## D-16E-14 — How the runner discovers a due reminder · **OPEN**

Opened by the Platform handover investigation, not by the owner, and recorded here because it is a
**new published contract** and therefore a decision rather than an implementation detail.

**The problem.** `workflow.remind-step` requires an `instanceId` and a `stepId`. No published Workflow
query answers *"which steps in this tenant are due a reminder now"*. Verified against every registered
query:

- `workflow.pending-approvals` declares `workflow.approval.read-own` and resolves from the **caller's
  membership** — a machine holds none, by design;
- `workflow.search-instances` declares `workflow.instance.read` — a human administrator's permission
  the runner must not hold — returns **instances rather than steps**, and cannot filter on the service
  level;
- `workflow.read-approval-status` and `workflow.read-history` need an `instanceId` the caller already
  has.

So the approved reminder is **executable but not discoverable**: a Platform runner could invoke it and
would have nothing to invoke it with. This is Workflow's gap to close, not Platform's.

**What closing it would need**, named rather than designed, and deliberately **not implemented**: one
bounded read — identifier-free, tenant-scoped, returning the `(instanceId, stepId)` pairs due at a
supplied instant, declaring **`workflow.reminder.execute`** rather than any human permission, and
bounded by a page size so it can never become an unbounded tenant-wide sweep.

**What it must not become.** A general "search steps" query, a tenant-wide approvals dashboard, an
analytics read, or anything a human principal could reach — each is refused elsewhere in this register
and none is reopened by this one.

*Blocks:* the reminder being invoked at all, jointly with the absent Platform job runner. Neither is
sufficient alone.
