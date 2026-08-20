# Phase 16E — Automatic Service-Level Reminder · Contract

**Contract definition only. No production file was created or modified.** No scheduler, worker,
`JobPort` execution, machine actor, permission, migration, route, history value or module change was
written or designed beyond the contract stated here.

Written at HEAD `077ccf3`, working tree clean, zero production changes since `730502a`.

This is the **first implementation checkpoint** of D-16E-10. It establishes what the action *is*, so
that the three contracts it depends on can be judged against a fixed target rather than a moving one.
Implementation does not follow from this document; it follows from the contracts in §12, §13 and the
history decision in §6, none of which exists yet.

---

## 1. D-16E-10 approval

**D-16E-10 = APPROVED.** The first automatic business action of Phase 16E is the **automatic
service-level reminder**:

> When an awaiting workflow step with a configured service level passes its due instant, the system
> emits exactly one notification intent for the approver assigned to that step, and makes no workflow
> decision and no state transition.

**This approval is explicitly not automatic escalation**, and must not be read as approving it.
Automatic escalation remains **rejected as the first automatic action** (§15).

**Locked and not reopened by this work:** D-16D-08 · D-16D-09 · D-16D-13 · D-16D-14 · D-16D-15 ·
D-16D-16 · D-16D-17 · D-16D-18 · D-16D-19 · D-16E-01 through D-16E-09 as approved and amended ·
G-1 · G-2 · G-3 · G-4 · G-7 · G-8.

**The approval defines the business action only.** It authorizes inventing nothing: no machine actor,
scheduler, worker, `JobPort` execution semantics, Platform authentication, Platform machine
authorization, generic automation engine, generic SLA action enum, generic expiry framework, service
credential, impersonation or permission bypass. Each remains a separate contract, consumable only
once it exists.

## 2. Exact trigger

A reminder becomes **due** exactly when:

```text
instance.status = 'running'
AND step.status  = 'awaiting'
AND step.service_level_count IS NOT NULL
AND asAt > awaiting_at + service_level_count × unit_span(service_level_unit)
```

where `unit_span('hours') = 3_600_000 ms` and `unit_span('days') = 86_400_000 ms`.

This is the **existing** Workflow SLA semantics, unchanged and not restated in a second place. It is
exactly `serviceLevelState(target, awaitingSince, asAt) === 'overdue'`
(`packages/modules/workflow/src/domain/service-level.ts:116-127`), which itself is
`asAt > dueAt(...)` from `dueAt` (`:90-97`).

Fixed properties, none of which this action may alter:

- **The comparison is strictly `>`.** Due exactly on the boundary is `within`. It must not become
  `>=`: `service-level.ts:113-115` — *"A target of one hour is met by an answer at exactly one hour."*
- **`asAt` is a parameter, never a clock the domain reads.** So the predicate is deterministic and
  two callers asking at the same instant get the same answer.
- **No business-day semantics.** Elapsed time only, no calendar, no daylight-saving adjustment.
- **Nothing is persisted about the condition**: no `due_at`, no `breached`, no `expired`. The
  condition stays derived, which is what the G-5 amendment requires.

*Inputs, and the only two columns that determine the due instant:* `workflow_step.service_level_count`
and `service_level_unit` (added in `20260816100000_workflow_routing_resolution`, constrained to `>= 1`
and to `('hours','days')`), and `workflow_step.awaiting_at`.

## 3. Exact state predicate

Only existing states are used; **no new state is introduced**, in the domain or in the database.

| Condition | Existing vocabulary |
|---|---|
| instance is running | `workflow_instance.status = 'running'` — one of `running, completed, rejected, cancelled` |
| the step is still being asked | `workflow_step.status = 'awaiting'` — one of `pending, awaiting, approved, rejected, skipped` |
| the step has a target | `service_level_count IS NOT NULL` |
| the target has passed | §2 |

**All four are revalidated inside the authoritative transaction at execution time**, from rows read
in that transaction — never from a job payload and never from a value captured at scheduling time. If
any is false when the action executes, the action is a **no-op** (§10).

## 4. Notification intent

The notification intent **is** the business action. There is no state change behind it.

Workflow emits one `NotificationRequest` (`packages/kernel/src/ports/notification.ts:17-26`) and
nothing else:

| Field | Value |
|---|---|
| `templateKey` | one key naming the event — *what happened*, never a channel. Content is Communications' business, not Workflow's |
| `recipients` | exactly one, the assigned approver of the overdue step (§5) |
| `variables` | the minimum a template needs to identify the approval, already permission-filtered by the caller. **No decision content, no rejection comment, no subject business data** |
| `correlationId` | from the machine execution context (§7) |
| `idempotencyKey` | the identity in §8, so a repeat is suppressed at the port as well as in the database |

**Workflow does not deliver.** No broker, worker, queue, email, SMS, push, notification UI or outbox
is implemented — Phase 17 owns delivery, transport, templates, provider integration, delivery retry
and delivery status. `NotificationPort.notify` is the entire Workflow-side surface, and this is the
first consumer of it in this module.

The port's own header states the rule this obeys: *"A domain says what happened and to whom. It never
says 'send an email'."*

## 5. Recipient semantics

**The recipient is the membership already assigned to the overdue step** —
`workflow_step.approver_membership_id`. It is read from the row, never chosen, never resolved through
routing, never enumerated. **D-16D-16 (A) is untouched**: no candidate query exists and none is
introduced.

One recipient per intent. Not the branch, not the outstanding set, not the requester, not a manager.

**Workflow does not know a `userId` and must not start.** `NotificationRecipient` requires
`readonly userId: string` (`notification.ts:12-15`) — a *workforce user* — while Workflow addresses
memberships and contains **zero** occurrences of `userId` in production code, deliberately. The
conversion is Identity's, through the bounded contract in §13. Workflow holds the membership; Identity
owns the mapping.

## 6. History event requirement · **STOP**

**A new history event is required, and it is not approved. Implementation stops here.**

The vocabulary is closed at nine values in two places that are asserted to agree —
`WORKFLOW_HISTORY_EVENTS` (`domain/workflow-vocabulary.ts:304-314`) and
`workflow_history_event_check` (`20260818100000_workflow_escalation/migration.sql:75`):

```
instance-started · step-awaiting · step-approved · step-rejected · step-skipped
step-escalated · instance-completed · instance-rejected · instance-cancelled
```

**None may be borrowed.** `step-escalated` in particular must not be: `domain/escalation.ts:15-16`
defines it as a human act — *"It is a human's act. Nothing here fires on elapsed time"* — and
`workflow-vocabulary.ts:299-302` warns that recording an act as an event meaning something else
"would put an answer in the timeline that nobody gave". The event this action needs must distinguish

> *an automatic service-level reminder was emitted*

from

> *a human escalated a branch*,

and no existing value carries that meaning.

**No name is proposed here.** The event name, its domain meaning, its actor fields, its provenance
fields, its metadata, the check-constraint change, the RLS and append-only implications, the
idempotency storage and the concurrency behaviour are the **second checkpoint's** work
(`phase-16e-reminder-history.md`), and the decision is recorded **OPEN** as **D-16E-11**.

## 7. Execution provenance

Per G-4, the record of an automatic action must answer four questions:

| Question | Source | Exists today? |
|---|---|---|
| which automatic execution caused this? | execution identity, from the Platform machine execution context | **no** — G-2 |
| which job / execution attempt performed it? | job identity + execution attempt identity, same context | **no** — G-2 |
| which workflow instance? | `workflow_history.instance_id` | **yes** |
| which step / branch? | `workflow_history.step_id`, `ordinal` | **yes** |

`workflow_history` carries `actor_membership_id` and `on_behalf_of_membership_id` (nullable) and **no
column for an execution or correlation identity**. Two columns are therefore required, and G-4
requires they move **in the same change** as the event value. `metadata` is not an acceptable home:
an audit fact in free-form JSON is an audit fact nothing constrains.

**The actor columns stay null for this action.** No membership acted; writing one would be the fake
human actor every locked decision forbids. The provenance columns say what did.

**Only opaque identities are recorded.** No infrastructure credential, secret, connection string or
Platform token reaches history.

## 8. Idempotency identity

**Approved identity: `(tenant_id, step_id)`.**

The reasoning, verified against the code rather than assumed:

- `awaiting_at` is written exactly once per step, when it becomes awaiting — at instance start
  (`domain/instance.ts:266`), when a branch opens after a decision (`domain/decision.ts:316`), and on
  escalation (`domain/escalation.ts:201`).
- Nothing restarts it. `service-level.ts:22-23`: *"Nothing restarts it: not an escalation, not a
  delegation, not a decision on a sibling step."*
- Step status never returns to `awaiting`.
- Therefore **a step can cross its service-level threshold only once**, and one reminder per step,
  ever, is the correct and complete identity.

`tenant_id` leads the key, as it leads every other key in this schema: two tenants may legitimately
hold identifiers that collide, and a key without the tenant in it would let one tenant's reminder
suppress another's.

**The database is authoritative.** Not an in-memory lock, not process-local state, not scheduler
exactly-once delivery, not worker exactly-once delivery, not a sleep, and not an assumption that
retries do not happen. ADR-0071 settles why a read cannot do it: *"a `select` followed by an `insert`
is not idempotent under concurrency."*

**Preferred mechanism**: an append-only record protected by a **partial unique index**, following the
`workflow_step_escalation_idx` precedent — `unique … where <predicate> and deleted_at is null`. The
attractive shape is the history row *being* the idempotency record, so no second table exists; and
`workflow_history` is already insert-only, protected by the `workflow_history_no_mutation` trigger
which raises `workflow_history_immutable` on any update or delete
(`20260814100000_workflow/migration.sql:457-468`). That makes it a sound place for a uniqueness claim:
a row can be inserted and can never be altered to release the claim.

**The index and its migration are not added here.** They depend on the exact event value and
persistence shape, which §6 leaves OPEN.

## 9. Transaction boundary

One `unitOfWork.execute`, the same shape Phase 16D's escalation handler already proves
(`application/escalation.use-case.ts:51`). Inside one transaction, in order:

1. read the instance; absent → no-op;
2. read the step; absent → no-op;
3. evaluate §2 and §3 **from those rows**, at the execution instant;
4. if the predicate is false → **no-op**, commit nothing;
5. insert the provenance/idempotency record — this is where duplicate execution is refused by the
   database, not by a preceding read;
6. emit the notification intent.

**The commit boundary and the uniqueness claim are the same transaction.** Step 5 before step 6 is
deliberate: the claim must be won before the intent is emitted, so a rollback cannot leave an intent
emitted with no record of it.

*Stated as a known limit, not glossed:* `NotificationPort.notify` is an out-of-process effect that
cannot be enrolled in the database transaction. A crash between commit and notify loses one reminder;
a crash between notify and commit is prevented by the ordering above. The port's own
`idempotencyKey` (§4) is the second line of defence. There is **no outbox** in this repository —
dispatch is post-commit, in-process and at-most-once by design (ADR-0053, ADR-0064) — and building one
is explicitly out of scope. **At-most-once reminder delivery is therefore an accepted property of this
action**, and it is acceptable precisely because a missed reminder changes no business state.

## 10. Stale-execution behaviour

A scheduled execution that arrives after the world moved on is **a no-op, not an error and not a
retry**.

| Change between scheduling and execution | Result |
|---|---|
| step approved, rejected or skipped | no-op — `status != 'awaiting'` |
| instance completed, rejected or cancelled | no-op — `status != 'running'` |
| step's service level removed by a definition change | no-op — no target, so no due instant |
| a human escalated the branch meanwhile | **irrelevant** — escalation adds a *different* step and never touches this step's `awaiting_at`, `status` or target |
| the reminder already emitted | no-op — the uniqueness claim in §8 refuses the second |

A no-op writes nothing, emits nothing, and must **not** be retried into success. The condition is
re-derived at execution time from rows read in the transaction; a scheduling-time snapshot is never
trusted.

## 11. Concurrency behaviour

| Scenario | Required outcome |
|---|---|
| **two workers, two real connections, same step** | one winner. The loser's insert violates the unique index, its transaction rolls back, and it emits nothing. Exactly one record, exactly one intent |
| **stale job** — step approved before execution | no effect (§10) |
| **manual activity** before execution | state re-read inside the transaction; the intent is emitted only if the trigger still holds |
| **repeated delivery** of the same job | one business effect; the second delivery is harmless and is refused by the same claim |
| **tenant isolation** | an execution for tenant A cannot affect tenant B. The tenant comes from the machine execution context, **never** from a job payload, request body or command field; RLS is the second half of the guarantee |

All five must be proved against **real PostgreSQL**, with real concurrent connections. **No sleeps**
may be used to prove concurrency. None of this is proved today, and none is claimed.

## 12. Platform dependency · **STOP**

**Absent. The implementation stops at this boundary and no Work-side substitute is created.**

| Contract | Required semantics | State |
|---|---|---|
| **G-2** machine execution context | tenant context · machine execution identity · job identity · execution attempt · correlation identity · not user-suppliable · not a membership | **absent.** `ExecutionContext = TenantContext \| SystemContext`; `SystemContext` is untenanted and refused by `assertTenantScoped`, `currentTenantId` and `runWithServiceGrant`; `TenantContext` requires a human `actor` |
| **G-1** machine authorization | an explicit Platform-owned machine-execution capability, with failure semantics | **absent.** `PlatformPermissionChecker.holds` returns false for a system context; Work declares permissions and never grants them |
| **G-3** `JobPort` execution | delivery · execution attempt · retry semantics · acknowledgement · safe duplicate delivery · cancellation · tenancy source | **absent.** `JobPort` is enqueue-only, with zero implementations and zero consumers |

All three live in `munaxa/munaxa-platform`, which this repository must never modify. **The automatic
action must never pretend to be a human**, and with these three absent there is no non-pretending way
to execute it at all.

## 13. Identity dependency · **STOP**

**The required bounded contract does not exist.** Documented here; Identity is **not** modified.

*What is needed:* given **one** membership identifier, return **only** the workforce-user identity
that `NotificationRecipient.userId` requires.

*What exists:* `identity.membership-standing` (D-16D-18) returns `{ active: boolean }` and nothing
else — it cannot answer this. `identity.describe-member` **must not be reused** (a payload no
permission can narrow, ruled out in Phase 16D). No other query answers it.

*The mapping is one column.* `tenant_membership.workforce_user_id` is exactly the workforce user
(`prisma/schema.prisma:37-56`), and ADR-0033 makes that one row per Platform account.

*The minimum contract, specified and not created:*

- accepts **one** membership identifier;
- **tenant-scoped**, resolved from the execution context and never from input;
- returns **only** the recipient identity `NotificationPort` requires — no name, no email, no address,
  no channel preference, no profile, no employment, no reporting line, no delegation;
- declares **`identity.membership.read`**, which **already exists**
  (`identity-permissions.ts:21`) and is what `identity.membership-standing` already uses —
  **no new permission is added**;
- **does not enumerate**: one identifier in, one answer out, never a list;
- answers `not_found` for a membership in another tenant exactly as for one that does not exist;
- does **not** widen `identity.membership-standing` or any other existing contract — it is a second
  narrow query, on the same model.

*Authorization to modify Identity is a separate decision*, exactly as D-16D-19 was for
`identity.membership-standing`. Recorded **OPEN** as **D-16E-12**. The contract is approved in
principle by G-8; permission to touch the Identity module is not the same thing and is not inferred.

## 14. Security and tenancy rules

- **Tenant identity comes from the machine execution context.** Never from a job payload, request
  body, user input or command field. Cross-tenant execution must fail safely and be proved with real
  PostgreSQL RLS tests.
- **RLS stays enabled and forced.** `workflow_history` is protected by `app_protect_table`
  (`20260814100000_workflow/migration.sql:492`), and history stays append-only under the
  `workflow_history_no_mutation` trigger. Neither may be relaxed to make an idempotency claim
  convenient.
- **No fake actor, no fake membership, no impersonation, no service credential, no wildcard
  permission, no permission bypass, no internal-only authorization.** The executor is a Platform
  identity that is not a membership, cannot be an approver, and cannot be selected as one.
- **Actor columns stay null**; provenance columns carry the machine identity (§7).
- **No credentials in history** — opaque identities only.
- **The blast radius is one message.** This action changes no business state, so it cannot alter who
  approves, what any denominator is, or what any approval decides. That is the property that makes it
  the right first rung.

## 15. Rejected automatic-escalation path

Automatic escalation is **rejected as the first automatic action**, and this approval must not be
reinterpreted as approving it.

The blocker is structural rather than a matter of effort: `escalateBranch` takes
`approverMembershipId` as an **input** and the domain never chooses a person, so an automatic
escalation must decide *who* is added. All three routes are closed — candidate enumeration is refused
by **D-16D-16 (A)** and excluded from D-16E-01's scope; configuring a target on the step template is
new persistence and a new capability; and reusing manager resolution widens **P-1** and **D-16C-11**,
which `domain/manager.ts:9-10` states may not be widened without a new approval.

Accordingly this action **does not call `workflow.escalate-branch`**, adds **no approver**, adds **no
step**, and does **not** reuse `step-escalated`. **Phase 16D's human escalation capability remains
exactly as implemented** — the ten permissions, the seven eligibility rules, the partial unique index
and the published `escalated` marker all stand untouched.

## 16. Explicit non-goals

Not implemented, not designed, and not begun: automatic escalation · automatic approval · automatic
rejection · automatic skip · automatic expiry · business-day SLA · SLA breach persistence · a generic
automation framework · generic action configuration · candidate enumeration · a candidate picker ·
Admin mutation · Admin authentication · notification delivery · a scheduler · a worker · a broker ·
an outbox · analytics · portal changes.

Nor: a `due_at`, `breached` or `expired` column · a change to `>` · a second SLA model · a Work-side
substitute for any Platform contract.

---

## Effect on the locked decisions

Stated positively rather than assumed, because "we did not touch it" is a claim that should be
checkable:

| Locked | Why this action cannot reach it |
|---|---|
| **D-16D-08** denominator | no step is added and no status changes, so `assignedOf`, `assigned`, the threshold, `outstanding` and `unresolved` are not merely unchanged — they are **structurally unreachable** from this action |
| **D-16D-09** `escalated` marker | no step is created, so no step's `escalated` value exists to be set |
| **D-16D-13**, **D-16D-14** | no approver is added, so neither refusal is consulted |
| **D-16D-15** delegation | no decision is made, so delegation is not consulted |
| **D-16D-16** no enumeration | the recipient is read from one row; no candidate query exists or is added |
| **D-16D-17**, **D-16D-18** | membership standing is not needed; this action asks nothing about eligibility |
| **D-16D-19** | Identity is not modified. The new contract needs its own authorization — **D-16E-12** |
| **D-16E-01…09**, **G-1…G-8** | consumed as approved; none reinterpreted, none widened |

---

## Checkpoint status

**Three stop conditions are live**, from the instruction's own list:

1. **the Platform execution contract is absent** (§12) — G-2, G-1, G-3;
2. **the required Identity recipient contract is absent** (§13);
3. **the history event is not approved** (§6).

None was worked around. No new permission is required. No generic framework is required. No locked
decision is changed. The action alters no Workflow state, no quorum, no tally and no denominator, and
needs no business-day semantics, no fake actor, no impersonation, no service credential and no
authorization bypass.

**Next checkpoint:** the history contract — `phase-16e-reminder-history.md` (**D-16E-11**, OPEN).
Not started; it follows review of this document.

**STOP — awaiting explicit owner approval.**
