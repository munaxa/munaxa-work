# Phase 16E — Decision Register

**All nine decisions are `OPEN`. No approval has been given for any of them, and none may be
inferred** — not from a recommendation, a finding, a precedent, convenience, or an option appearing
technically preferable.

**Phase 16E is NOT READY.** No implementation was performed and no production capability was added.

State verified at the time of writing: HEAD `385fd9b`, working tree clean, **zero production changes
since `730502a`** (`git diff 730502a HEAD -- packages apps prisma` is empty).

The evidence behind every entry is in [`phase-16e-plan.md`](phase-16e-plan.md), which is preserved
unchanged in substance; this register is the canonical status table.

---

## Decisions

| ID | Decision | Status | Approval |
|---|---|---|---|
| D-16E-01 | Does Phase 16E exist? | **OPEN** | None |
| D-16E-02 | Automatic execution | **OPEN** | None |
| D-16E-03 | Execution ownership | **OPEN** | None |
| D-16E-04 | JobPort ownership | **OPEN** | None |
| D-16E-05 | SLA action | **OPEN** | None |
| D-16E-06 | Expiry action | **OPEN** | None |
| D-16E-07 | Notification intent | **OPEN** | None |
| D-16E-08 | Business-day SLA | **OPEN** | None |
| D-16E-09 | Idempotency | **OPEN** | None |

**No option is selected and none is recommended.**

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

---

## Status

**Phase 16E is NOT READY.** **D-16E-01 through D-16E-09 remain OPEN awaiting explicit owner
approval.** Checkpoint 2 has not started, and no implementation is authorized.

When an approval arrives, this register gains the approved option, the approval date, the rejected
alternatives and the attached constraints — appended, never by rewriting what stands above.
