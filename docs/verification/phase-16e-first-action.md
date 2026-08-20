# Phase 16E — The First Automatic Business Action

**Investigation and decision proposal only. No production file was created or modified.** No
scheduler, worker, `JobPort` execution, machine actor, migration, route, permission or history value
was designed or written.

Investigated at HEAD `e36b4c6`, working tree clean, zero production changes since `730502a`.

---

## 1. Decision ID

**D-16E-10 — the first automatic business action.** Status **OPEN**. It follows D-16E-09 and
renumbers nothing.

## 2. Candidate action

> Automatically escalate an approval branch when its configured SLA becomes actionable.

Evaluated, **not** assumed. The investigation's finding is that it **cannot be the first automatic
action**, for a reason that is structural rather than a matter of effort, and an alternative is
presented in its place (§19, §20).

---

## 3. Existing evidence

### 3.1 What constitutes an SLA breach today *(question 1)*

A step is **overdue** exactly when `serviceLevelState` returns `'overdue'`
(`packages/modules/workflow/src/domain/service-level.ts:116-127`):

```ts
const due = dueAt(target, awaitingSince);
if (due === undefined) return 'none';
return asAt.getTime() > due.getTime() ? 'overdue' : 'within';
```

Three properties matter and all three are already settled:

- **Strict comparison.** Due exactly on the boundary is `within`, deliberately — "a target of one
  hour is met by an answer at exactly one hour".
- **The instant is a parameter, never a clock the domain reads.** So the predicate is deterministic
  and testable, and two callers asking at the same instant get the same answer.
- **Nothing is persisted.** No `due_at`, no `breached`, no `expired`. `service-level.ts:9-11` states
  it: *"It is not a deadline: nothing happens when it passes. And it is not a state."*

### 3.2 The exact fields that determine `dueAt` *(question 2)*

`dueAt(target, awaitingSince)` (`service-level.ts:90-97`) reads exactly two things:

| Input | Column | Notes |
|---|---|---|
| `target.count`, `target.unit` | `workflow_step.service_level_count`, `service_level_unit` | added in migration `20260816100000_workflow_routing_resolution`; constrained to `>= 1` and to `('hours','days')` |
| `awaitingSince` | `workflow_step.awaiting_at` | nullable; set when the step becomes awaiting |

Arithmetic is exact milliseconds — `HOUR_MS = 3_600_000`, `DAY_MS = 86_400_000` — with **no calendar
consulted and no daylight-saving shift applied**. Both are absent-tolerant: a step with no target or
no `awaiting_at` has no due time at all, which is why the state is `'none'` rather than a guess.

`awaiting_at` is written **once per step**, when it becomes awaiting — at instance start
(`instance.ts:266`), when a branch opens after a decision (`decision.ts:316`), and on escalation
(`escalation.ts:201`). Nothing restarts it: `service-level.ts:22-23` — *"Nothing restarts it: not an
escalation, not a delegation, not a decision on a sibling step."* Step status never returns to
`awaiting`. **A step therefore has at most one breach, ever**, which §10 depends on.

### 3.3 Can the condition be evaluated deterministically without changing the SLA model? *(question 3)*

**Yes.** The predicate is a pure function of two persisted columns and a supplied instant. Nothing
needs to be added, persisted or derived differently. This satisfies the G-5 amendment's requirement
that SLA remain a derived condition.

The full predicate, stated without vagueness:

```
instance.status = 'running'
AND step.status  = 'awaiting'
AND step.service_level_count IS NOT NULL
AND asAt > step.awaiting_at + (step.service_level_count × unit_span(step.service_level_unit))
```

with `unit_span('hours') = 1 hour` and `unit_span('days') = 24 hours`, and `>` strict.

### 3.4 Which workflow states permit escalation *(question 4)*

Three branch-level refusals, in order (`domain/escalation.ts:169-184`):

| Refusal | Condition |
|---|---|
| `escalation-instance-not-running` | `instance.status !== 'running'` |
| `escalation-branch-not-awaiting` | the ordinal has no step, or no step in it is `awaiting` — one test covering "no such branch", "condition skipped it", "already approved", "already rejected" |
| `escalation-branch-is-unanimous` | the branch rule is `unanimous` |

Then five person-level refusals (`personRefusal`, `:105-152`): `escalation-approver-already-assigned`
· `escalation-already-escalated` · `escalation-approver-is-the-requester` ·
`escalation-approver-already-decided` · `escalation-approver-not-eligible`.

### 3.5 Reuse of `escalateBranch`, and the blocking finding *(questions 5, 6)*

`escalateBranch(instance, steps, request)` is **pure**, takes its instant as a parameter, and its own
header anticipates exactly this question (`escalation.ts:15-18`):

> *"The function is deterministic and takes its instant as a parameter, so a future runner could
> invoke the command above it unchanged — which is the whole of what 'safe for a scheduler' means."*

So on reuse the answer is unambiguous: **the domain operation can be reused as-is, and must be**;
duplicating the seven rules in an automation-specific handler is forbidden and unnecessary. Nor does
the domain need a new actor concept — it has none today. `EscalateBranchRequest` carries `stepId`,
`ordinal`, `approverMembershipId`, `at` and `approverIsActive`, and **no actor at all**. The actor is
an application concern (`currentMembership()`, refusing `escalation-actor-unknown`), not a domain
one.

**But `approverMembershipId` is an input, and the domain never chooses it.** Automatic escalation
must decide *who* is added. There are exactly three possible sources, and every one is blocked:

| Source | Status |
|---|---|
| **Enumerate eligible approvers** | **Refused.** D-16D-16 (Option A) approved *no candidate enumeration*, and it is implemented as a proven absence — no candidate query exists (`phase-16d-audit.md` §7, §10). Phase 16E's own D-16E-01 lists candidate enumeration among what 16E does **not** absorb. Choosing this reopens a closed 16D decision |
| **Configure a target on the step template** | New column, new configuration vocabulary, new definition command — new persistence and a new business capability, each needing its own approval, and forbidden in this checkpoint |
| **Resolve a manager** | `ReportingLinePort.managerOf` exists, but `resolveManager` is bound to approved parameters: **the requester's** manager (P-1), primary active employment (P-2), primary line (P-3), exactly one level up (P-4), **as at the instant the approval started** (D-16C-11). `domain/manager.ts:9-10`: *"None of those is configurable, and none may be widened here without a new approval."* "The stuck approver's manager, resolved now" widens P-1 **and** D-16C-11 |

**This is the finding.** It is not that automatic escalation is hard; it is that the system
deliberately holds no answer to "who should be added", and every route to one requires the owner to
reopen or widen an approved decision.

Two further problems stand even if selection were solved:

- **`unanimous` branches refuse escalation by name.** An automatic capability that silently does
  nothing for an entire class of branches is a capability with a hole in it, and the hole is
  invisible to the administrator watching it.
- **The published marker cannot tell a machine from a person.** Admin renders `Assigned` /
  `Escalated` from the boolean `step.escalated` (`apps/admin/src/workflow/instances.tsx`). D-16D-09
  approved that marker to mean *an approver was added*. An automatic escalation would render
  identically to a human one in the only published view there is.

### 3.6 The idempotency precedent *(question 10)*

`workflow_step_escalation_idx` is a **partial unique index** on
`(tenant_id, instance_id, ordinal, approver_membership_id) where escalated_at is not null and
deleted_at is null` (`20260818100000_workflow_escalation/migration.sql:106-108`), and
`escalationIdentity` names the same tuple in the domain while explicitly **not** enforcing it
(`escalation.ts:222-236`, citing ADR-0071: *"a `select` followed by an `insert` is not idempotent
under concurrency"*).

It is sufficient for *duplicate escalation of a named person* and **insufficient for automatic
execution**, for a reason worth stating precisely: its key contains `approver_membership_id`. Two
automatic attempts that selected **different** people for the same stuck branch would both insert
successfully — one due condition, two added approvers. The existing index cannot prevent that,
because it was designed for an identity a human supplies.

---

## 4–6. The candidate, stated exactly (for the record, not for adoption)

Had selection been solvable, the definition would be:

- **Trigger** — the predicate in §3.3, evaluated at the execution instant inside the authoritative
  transaction.
- **Eligible state** — instance `running`; the branch at the ordinal has at least one step
  `awaiting`; branch rule is `majority` or `first-response` (never `unanimous`). Existing vocabulary
  only; no new state.
- **Action** — add exactly one approver to the awaiting branch through `escalateBranch`, changing
  nothing else.

**It is not proposed**, because §3.5 has no answer for *which* approver.

## 7. Human-command reuse decision

**Reuse `escalateBranch` unchanged**, if this action is ever approved. Its authorization and actor
assumptions are *not* human-specific — the domain function carries no actor and no permission; those
live in the application handler and the pipeline. The seven eligibility rules must not be duplicated.

The application layer above it **is** human-specific (`currentMembership()`, refusing
`escalation-actor-unknown`), so an automatic path would need its own application handler over the
same domain function — which is the correct seam and requires no domain change.

## 8. History semantics

**A new history event is required. `step-escalated` must not be reused.**

`escalation.ts:11-12` defines that event's meaning as a human act — *"It is a human's act. Nothing
here fires on elapsed time"* — and `workflow-vocabulary.ts:299-302` warns that recording an act as an
event that means something else "would put an answer in the timeline that nobody gave". Borrowing it
would make automatic and human escalation indistinguishable in the audit record, which is precisely
what history exists to prevent.

The vocabulary is closed at nine values in two places that are asserted to agree
(`workflow-vocabulary.ts:304-314`; `workflow_history_event_check`). **The event name is therefore an
owner decision, and none is proposed here** — G-4 forbids inventing one.

## 9. Execution provenance

The minimum that answers the four required questions:

| Question | Source |
|---|---|
| which automatic execution caused this? | the execution identity from the Platform machine execution context (**G-2**) |
| which job/execution attempt performed it? | the execution attempt identity from the same context |
| which workflow instance? | `workflow_history.instance_id` — **already present** |
| which step/branch? | `workflow_history.step_id`, `ordinal` — **already present** |

`workflow_history` today carries `actor_membership_id` and `on_behalf_of_membership_id` and **no
column for an execution or correlation identity**. Two columns are therefore required, moving in the
same change as the event value (G-4). `metadata` is not an answer: an audit fact in free-form JSON is
an audit fact nothing constrains.

**No infrastructure credential or secret is recorded** — only opaque identities.

## 10. Idempotency identity

For automatic escalation, the identity must be the **due condition**, not the person:
`(tenant_id, instance_id, ordinal, <breach occurrence>)`. Because `awaiting_at` is written once and
never restarted (§3.2), a branch's breach occurs once, so this collapses to
**`(tenant_id, instance_id, ordinal)`** — *at most one automatic escalation per branch, ever*.

That is a **different key** from `workflow_step_escalation_idx`, which includes the membership, so the
existing index is not sufficient (§3.6) and a second partial unique index would be required.

## 11. Manual-race semantics

*What if a human escalates the branch at the same moment the automatic action executes?*

With the identity in §10 the two are **not** mutually exclusive — they have different keys, so both
would commit and the branch would gain **two** approvers from one stuck condition. That is the
outcome the instruction forbids.

Making them mutually exclusive requires a rule the owner has not given: does a human escalation
*consume* the branch's automatic entitlement, or not? Both readings are defensible and neither is
recorded. **This is an open sub-decision**, and it is a second reason the candidate is not ready.

## 12. State-race semantics

Sound, and this part needs nothing new. The execution must re-read instance and steps **inside** the
authoritative transaction and re-invoke `escalateBranch`, which already refuses every stale case by
name: the instance no longer `running` → `escalation-instance-not-running`; the branch approved,
rejected, skipped or otherwise not awaiting → `escalation-branch-not-awaiting`; the person already
added → `escalation-already-escalated`. A refusal is the correct outcome and must be recorded as a
no-op, never retried into success.

This is exactly the "revalidate current state inside the authoritative transaction" the instruction
requires, and Phase 16D's one-transaction escalation handler already demonstrates the shape.

## 13. Business-day requirement

**Not required, and must not be introduced.**

The existing SLA model supports **elapsed time only**. `service-level.ts:20-24` states it outright:
*"Elapsed time, in whole hours or whole days (D-16C-05). Not business days: Workflow holds no
calendar… A tenant whose weekend is Friday and Saturday will find a two-day target elapsing across
it, and that is a stated limit rather than a bug."*

Both the candidate and the alternative in §19 use the elapsed-time predicate unchanged, so **G-7
stays unopened**. No Organization query was created.

*(Recorded for completeness: were business days ever required, `organization.calendar.read` already
exists and no new permission would be needed — but the bounded query still would, and it is not
created here.)*

## 14. Notification requirement

**Not required for the candidate.** Escalation adds an approver; the approver learns of it by seeing
their queue. Nothing in Phase 16D notifies anybody, and the candidate changes that in no way.

**Required for the alternative in §19**, where the intent *is* the action.

## 15. Required cross-module contracts

| Contract | Candidate | Alternative (§19) |
|---|---|---|
| Identity — membership standing (`identity.membership-standing`) | **already exists** (D-16D-18); `escalateBranch` needs `approverIsActive` | not needed |
| Identity — membership → notification recipient (**G-8**) | not needed | **required**; bounded, on the `membership-standing` model. `identity.membership.read` already exists, so **no new permission** |
| Organization — business-day calendar (**G-7**) | **not needed** | **not needed** |

## 16. Required Platform contracts

Unchanged by this decision and required by **either** option, because both are automatic:

- **G-2** machine execution context — tenant-scoped, non-membership, user-unsuppliable, carrying job,
  attempt and correlation identity.
- **G-1** machine authorization — an explicit Platform-owned machine-execution capability. No
  Workflow permission may be reused, and none may be invented here.
- **G-3** `JobPort` execution semantics — delivery, attempt, retry, acknowledgement, safe duplicate
  delivery, cancellation.

All three live in `munaxa/munaxa-platform`, which this repository must never modify.

## 17. Persistence changes, if any

| Change | Candidate | Alternative (§19) |
|---|---|---|
| new history event value + widened check constraint | **yes** | **yes** |
| history columns for execution + correlation identity | **yes** | **yes** |
| a second partial unique index for the automatic idempotency key | **yes**, on a key including `ordinal` and excluding the membership | **yes**, and it can be a partial unique index **on `workflow_history` itself** — `(tenant_id, step_id) where event = <the new value>` — so the history row *is* the idempotency record and no second table exists |
| `expired` column | **no**, and forbidden | **no** |
| any change to `workflow_step` | **no** | **no** |

None is created here.

## 18. Security implications

Both options share these, and neither weakens anything:

- **No fake actor, no impersonation, no service credential, no permission bypass, no wildcard.** The
  executor is a Platform identity that is not a membership, cannot be an approver, and cannot be
  selected as one.
- **Tenancy** comes from the machine execution context, never from a job payload. RLS remains the
  second half of the guarantee and must be proved with real PostgreSQL tests before any claim.
- **Provenance is opaque** — identities only, no credentials in history.
- **The candidate is the more dangerous of the two**: it changes who may approve a running approval.
  D-16D's own note calls escalation *"the most powerful thing an administrator can do to a running
  approval short of ending one"*. Handing that to a machine whose target-selection rule does not yet
  exist is the risk this document exists to surface.
- **The alternative changes no business state at all**, so it cannot alter who approves, what the
  denominator is, or what any approval decides.

## 19. Rejected alternatives

| Option | Why rejected |
|---|---|
| **Automatic SLA escalation** *(the prompt's candidate)* | No approved way to choose the approver; all three routes reopen or widen a closed decision (§3.5). Plus: silently inert on `unanimous` branches, indistinguishable from human escalation in the only published view, an unresolved manual-race rule (§11), and a new index because the existing one keys on the person (§3.6) |
| **Automatic rejection on breach** | Writes a decision nobody made. Contradicts ADR-0045 (*"a requisition approval is made by a named human, not by an adapter"*) and the domain's own rule against putting an answer in the timeline nobody gave |
| **Automatic skip of an overdue step** | `step-skipped` means *the process passed this person by* — used after a rejection or cancellation, and for condition-excluded branches (`escalation.ts:87-92`). Borrowing it to mean "they were too slow" changes the meaning of an existing event, which G-4 forbids |
| **Automatic expiry / cancellation** | **Explicitly withheld** by the G-6 amendment until the exact expiry behaviour is a separate decision. No expiry period is configurable anywhere: `serviceLevel` is a *step* target, not an instance expiry |
| **Persist a `breached` flag and act on it** | ADR-0070 — *"a stored flag that nothing maintains is worse than no flag"*. The condition is derivable exactly; storing it creates a second record that can disagree with the first |
| **A configurable "on breach do X" rule** | The generic framework and the generic action enum, both forbidden by the G-5 amendment |

### The alternative put forward instead

> **Automatic service-level reminder.** When an awaiting step with a configured service level passes
> its due instant, Workflow emits **one** notification intent addressed to that step's own approver,
> records it once, and **changes no workflow state**.

Why it is materially safer and more architecturally appropriate, on repository evidence:

1. **It chooses nobody.** The recipient is the membership already named on the step
   (`workflow_step.approver_membership_id`). No enumeration, no routing, no widening of P-1 —
   **D-16D-16 stays closed**, which is the single reason the candidate fails.
2. **It changes no business state**, so `assignedOf`, the denominator, the threshold, `outstanding`
   and `unresolved` are untouched. **D-16D-08 is structurally unreachable**, not merely checked.
3. **It decides nothing on anyone's behalf**, so ADR-0045 is never approached — unlike every option
   that approves, rejects, skips or expires.
4. **The trigger is already fully derived** (§3.3) and needs no SLA model change, satisfying the G-5
   amendment exactly: SLA stays derived, and the action is *named* rather than inferred from
   `serviceLevel`.
5. **Elapsed time suffices**, so G-7 stays unopened (§13).
6. **Idempotency is clean and one-keyed.** A step breaches once (§3.2), so the identity is
   `(tenant_id, step_id)` — **one reminder per step, ever** — enforceable by a single partial unique
   index on `workflow_history`, the ADR-0071 pattern already proven by
   `workflow_step_escalation_idx`. Two concurrent workers: one insert wins, the other takes a unique
   violation and rolls back. The database is authoritative; no in-memory lock, no exactly-once
   assumption.
7. **Both races are trivial.** Manual escalation adds a *different* step and never touches this
   step's `awaiting_at`, so the two cannot collide. If the step stops being `awaiting`, or the
   instance stops being `running`, revalidation inside the transaction makes the action a no-op.
8. **It is the correct first rung.** It exercises the whole approved chain end to end — machine
   context, authorization, `JobPort` delivery, derived condition, transactional guard, history,
   idempotency, notification intent — while the business effect it risks is *one message*.

**What it still costs**, stated plainly and not minimised: it needs the same three Platform contracts
(§16); it needs **one new history event**, which is the owner's to name (§8); it needs the **two
history provenance columns** (§9); and it makes the **G-8 Identity contract mandatory** rather than
conditional (§15).

**And one honest caveat.** A reminder is not a change of business state, so if the owner's intent is
that the first automatic action *must* alter the workflow, this does not satisfy it — and in that
case the finding is that **no such action can be defined today** without reopening a closed 16D
decision or introducing new configuration. That is the choice this document puts to the owner, and it
is not one to resolve by inference.

## 20. Final owner decision required

**D-16E-10 is OPEN.** Two things need an explicit owner decision, and the second only if the first
selects an option:

**(a) Which action is first.**

| | Recommendation |
|---|---|
| Automatic SLA escalation *(the prompt's candidate)* | **DECLINE as the first action** — blocked by approver selection (§3.5), which no approved mechanism can supply. Not declined on merit; it may return once §20(c) is answered |
| Automatic service-level reminder *(§19)* | **Put forward for APPROVE / AMEND / DECLINE.** Not approved, not assumed approved |

**(b) If the reminder is approved**, three attached decisions, each explicit:

1. the **history event name** for it — the vocabulary is closed and none may be invented;
2. the **two history columns** for execution and correlation identity, moving in the same change;
3. the **G-8 Identity contract** — bounded membership → notification recipient, on the
   `identity.membership-standing` model. `identity.membership.read` already exists, so **no new
   permission is required**.

**(c) If escalation is preferred despite §3.5**, then first, and separately:

1. how the automatic approver is **selected** — this reopens **D-16D-16** or widens the manager
   parameters **P-1** and **D-16C-11**, and either is the owner's call alone;
2. what happens on a **`unanimous`** branch, which refuses escalation by name;
3. whether a **human escalation consumes** the branch's automatic entitlement (§11);
4. whether Admin must **distinguish** automatic from human escalation, given that D-16D-09's marker
   cannot (§3.5).

---

## Stop conditions reached

Three, from the instruction's own list:

1. **"the action requires reopening any closed D-16D decision"** — automatic escalation needs
   approver selection, which reopens D-16D-16 (A).
2. **"the action requires an unapproved history event"** — true of *both* options; the vocabulary is
   closed and no name may be invented.
3. **"a specific automatic action has not been defined"** — still true, and it is what D-16E-10 asks
   the owner to resolve.

None was worked around. No action was implemented, no scheduler or worker designed, no machine actor
invented, no permission added, no migration written, and no module modified.

**STOP — awaiting explicit owner approval of the first automatic business action.**
