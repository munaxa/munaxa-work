# Phase 16E — The Platform JobPort Runner Contract

**Documentation only. No production file was created or modified, and none may be:** D-16E-03 assigns
the scheduler and the runner to Platform, and building either here is the one thing this phase
forbids most explicitly.

This document is the handover. It states what `munaxa-work` has already built and will consume, so
that the Platform team has something to satisfy rather than something to negotiate. **Every semantic
below is taken from code that exists**; nothing is invented, and where something is missing it is
named as missing rather than filled in.

Written against `main` at `7c29a92`.

---

## 1. Ownership boundary

| Owned by **Platform** | Owned by **Munaxa Work** |
|---|---|
| the scheduler — deciding *when* | the business rule — deciding *whether* |
| the job runner — the process that leases, delivers and counts attempts | the business action — what is recorded |
| the machine principal and its capability grant | declaring the permission that grant must satisfy |
| the execution context handed to the application | interpreting it, and refusing without it |
| retry policy, backoff, dead-lettering | idempotency of the business effect |
| infrastructure observability | the audit trail of the business fact |

**Platform must not delegate to Workflow** (§18) and Workflow must not acquire (§5): a queue, a timer,
a cron expression, a polling loop, a worker lifecycle, or any notion of when work should run.

## 2. Required Platform principal

Platform already has this; nothing new is required of the principal model itself.

The runner must authenticate as a **non-human principal** — `@munaxa/types` `ServicePrincipal`
(`kind: 'service'`) or `ApiKeyPrincipal` (`kind: 'api-key'`). Both already carry `tenantId`, `scopes`
and `permissions`, and `principalSubject()` already renders the stable audit subject
(`service:<clientId>`, `apikey:<keyId>`) that Work writes into its audit columns.

**The principal must hold `workflow.reminder.execute`** and, deliberately, nothing else of Workflow's.
It must **not** hold `workflow.approval.escalate`, `workflow.approval.decide`,
`workflow.instance.start`, `workflow.instance.cancel` or `workflow.group.manage` — D-16E-02 separates
machine authorization from every human permission, and a runner holding one of those could take an
action a person would be recorded as having taken.

`SystemPrincipal` (`kind: 'system'`) is acceptable only if Platform scopes it to one tenant; it is
described upstream as "internal platform work — migrations, schedulers, break-glass", and the tenant
requirement in §4 is not negotiable.

## 3. Required machine execution context

Work already defines the shape the runner must produce. `MachineContext` is the **third** member of
`ExecutionContext` (`packages/kernel/src/tenancy/tenant-context.ts`):

```ts
export interface MachineContext {
  readonly machine: true;
  readonly tenantId: string;        // uuid v7; validated by runInContext
  readonly executionIdentity: string; // service:<clientId> | apikey:<keyId> | system:<component>
  readonly jobId?: string;
  readonly attempt?: number;
  readonly correlationId: string;
}
```

The mapping Platform must perform is one-to-one and mechanical:

| `SecurityContext` (Platform) | `MachineContext` (Work) |
|---|---|
| `tenantId` | `tenantId` |
| `principalSubject(principal)` | `executionIdentity` |
| `correlationId` | `correlationId` |
| — (from the runner) | `jobId`, `attempt` |

**It carries no membership and no user, and offers no field for either.** That is the mechanism, not
a convention: `currentMembershipId()` returns `undefined` under it, so every Workflow operation that
needs a member — deciding a step, escalating a branch — refuses machine execution *by construction*,
with no rule about machines written anywhere.

## 4. Tenant propagation

**The tenant comes from the authenticated execution context and from nowhere else.**

`JobRequest.tenantId` records which tenant the work was *submitted for*; `JobExecution.tenantId` is
which tenant it *runs as*, and **only the runner may set it**. A handler that took the tenant from
`payload` would let whoever enqueued a job choose the tenant, which is the one thing tenancy may never
allow (ADR-0030, ADR-0032).

`runInContext` refuses a `tenantId` that is not a valid uuid v7 for any tenant-scoped context,
machine included. `currentTenantId()` answers under a machine context — that is the entire reason
`MachineContext` exists rather than reusing the untenanted `SystemContext`.

## 5. Permission propagation

**Automatic execution goes through the same gate a person does.** The machine context opens tenancy
and *not* authorization:

- `assertTenantScoped` admits a machine context (it refuses only an absent or system one);
- the dispatcher then calls `PermissionChecker.holds('workflow.reminder.execute')` exactly as for a
  human command, before validation and before the handler runs.

So a machine that does not hold the permission is refused `{kind: 'forbidden'}` for the same reason
and by the same code path as a person. There is one place authorization is decided, not two that can
disagree. Platform supplies the checker; Work only *declares* what a handler requires — it implements
no role engine and no permission engine, and must not be asked to.

## 6. `JobExecution` construction

The contract the runner must satisfy (`packages/kernel/src/ports/index.ts`):

```ts
export interface JobExecution<TPayload> {
  readonly name: string;
  readonly payload: TPayload;
  readonly tenantId: string;
  readonly jobId: string;            // the idempotencyKey it was submitted with; stable across retries
  readonly attempt: number;          // 1, then 2, 3…
  readonly correlationId: string;
  readonly executionIdentity: string; // never a membership
}

export type JobOutcome =
  | { readonly outcome: 'complete' }
  | { readonly outcome: 'failed'; readonly reason: string };

export interface JobHandler<TPayload> {
  readonly name: string;
  run(execution: JobExecution<TPayload>): Promise<JobOutcome>;
}

export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
  register<TPayload>(handler: JobHandler<TPayload>): void;
}
```

Deliberately absent, and must stay absent: any lease token, queue name or broker cursor. A handler
that could see those would eventually depend on one runner.

## 7. Execution attempt semantics

`attempt` is 1 for the first delivery, then 2, 3… **A retry is a new attempt at the same `jobId`** —
`jobId` is stable across retries, which is what makes the pair meaningful in an audit.

Both reach Workflow history as provenance (`execution_job_id`, `execution_attempt`). The database
requires `attempt >= 1` and requires a job behind an attempt.

## 8. Correlation identity

`JobRequest.correlationId` → `JobExecution.correlationId` → `MachineContext.correlationId` →
`workflow_history.execution_correlation_id`, and → the notification intent's `correlationId`.

One identifier threads the whole chain, which is what makes "what did this run do" answerable across
Platform, Work and Phase 17.

## 9. Retry behaviour

**Platform owns the retry policy. Workflow does not choose one** — a handler that scheduled its own
retries would be a second scheduler.

`{outcome: 'failed', reason}` asks for whatever policy the runner was configured with.
`{outcome: 'complete'}` means done **or not needed** — both are successes, because an execution that
correctly did nothing has succeeded at the only thing it was asked to decide.

**Retrying is always safe**, and safe by construction rather than by promise: the second attempt
either loses the database claim or finds the condition no longer true (§14).

## 10. Acknowledgement behaviour

The handler's returned `JobOutcome` is the acknowledgement. There is no separate ack call, no
heartbeat and no visibility-timeout extension in this contract; if the runner needs them they are
Platform's internal concern and must not surface in `JobExecution`.

## 11. Failure behaviour

| Failure point | Result |
|---|---|
| before the Workflow transaction commits | nothing survives — no claim, no history, no intent |
| the database claim is lost to a concurrent winner | the whole transaction aborts; the handler emits nothing |
| after commit, while emitting notification intent | history and claim remain; **the reminder is lost and no second one is generated** |

The third is the accepted trade, stated rather than hedged: **at-most-once reminder intent dispatch**
(D-16E-13). It is acceptable precisely because a missed reminder changes no business state — the
approval is exactly where it was. **The runner must not attempt to compensate for it**, and must not
treat a lost notification as a reason to re-run the job: the claim is committed and history is
immutable, so a re-run correctly does nothing.

## 12. Cancellation

`JobPort` declares no cancellation method, and Work needs none: a reminder whose approval was answered
or ended is refused by re-evaluation at execution time (§14), so a stale job is harmless and needs no
cancelling. If Platform adds cancellation for its own reasons, it must not require Workflow to
implement anything.

## 13. Concurrency

**Delivery is at-least-once and is stated as such** in the port. No runner can promise otherwise
across a crash, so every registered handler must be safe to run twice.

Two runners delivering the same reminder concurrently is a supported case, not an error: exactly one
commits, the other takes a unique violation on `workflow_history_reminder_idx` that aborts its whole
transaction, and it emits nothing. This is proved today against real PostgreSQL with two connections
and no sleeps (`workflow-reminder-uniqueness.integration.test.ts`).

## 14. Idempotency interaction

**The business idempotency identity is `(tenant_id, step_id)` and it is Workflow's, not the runner's.**

- The `workflow_history` row **is** the claim — there is no separate idempotency table, and the audit
  record and the claim therefore cannot disagree.
- `workflow_history_reminder_idx` is a partial unique index:
  `unique (tenant_id, step_id) where event = 'step-reminded' and deleted_at is null`.
- A step's clock starts once when it becomes `awaiting`, nothing restarts it, and a step never returns
  to `awaiting` — so a step crosses its target once and one reminder per step is the complete rule.

`JobRequest.idempotencyKey` is a *different* thing and both are needed: it stops the runner delivering
duplicate work, while the index stops duplicate work having a duplicate effect. **Platform's key is
not a substitute for the database claim**, and the handler deliberately does not re-read history to
decide — a select-then-insert is not idempotent under concurrency (ADR-0071).

**Do not weaken this.** No application lock, no `SELECT FOR UPDATE` as the primary guarantee, no
in-memory deduplication, no second idempotency table, no retry that bypasses the claim, and no outbox
unless separately approved.

## 15. Security boundary

The runner must never become a privilege bypass. Work already enforces most of this; the rest is
Platform's to honour:

| Guarantee | Enforced by |
|---|---|
| tenant from the execution context, never a payload | `JobExecution.tenantId`, set only by the runner |
| machine cannot masquerade as a member | `MachineContext` has no membership field |
| machine cannot supply `actorMembershipId` | not a command field; taken from context, which has none |
| machine cannot supply `onBehalfOfMembershipId` | same |
| an entry cannot name both a human and an execution | `workflow_history_execution_not_human_check` — **impersonation is unrepresentable, not merely forbidden** |
| permissions evaluated on the normal path | the CQRS dispatcher, before the handler |
| no wildcard authorization | `workflow.reminder.execute` is an exact name; the checker matches exactly |
| no credential in history | only opaque identities are recorded; the schema has no column for one |

**Platform must not** issue the runner a wildcard scope, an impersonation grant, or a principal that
also resolves to a membership.

## 16. RLS expectations

Row-level security stays **enabled and forced** (ADR-0030). A machine execution is not a reason to see
across a tenant boundary, and the policy neither knows nor cares that a machine wrote the row.

The runner must connect as a role with **no `BYPASSRLS`** and must set the tenant the same way an
HTTP request does. `workflow_history` additionally stays append-only under
`workflow_history_no_mutation`; the idempotency claim can therefore never be released, by anybody.

## 17. Observability requirements

Platform owns infrastructure observability — queue depth, lease age, attempt counts, failure rates.

Work owns the business audit, and already writes it: every automatic entry carries the execution
identity, correlation identity, job identity and attempt. **Provenance is deliberately not published
through `WorkflowHistoryView`** — it is an operator's fact, not a field for an approvals screen — so
Platform should expect to correlate by `correlationId`, not to read it back out of a tenant-facing
API.

## 18. What Platform must not delegate to Workflow

- deciding *when* a reminder is due to be attempted (Workflow decides only *whether*, at execution);
- retry policy, backoff or dead-lettering;
- queue mechanics, leasing, or worker lifecycle;
- the machine principal's credentials or their rotation;
- turning a lost notification into a second attempt.

## 19. The exact Workflow contract consumed by the runner

```
command:     workflow.remind-step
payload:     { instanceId: string, stepId: string }
permission:  workflow.reminder.execute
context:     MachineContext (required — see the refusal below)
```

Outcomes the runner will see:

| Result | Meaning | Runner should |
|---|---|---|
| `ok: { reminded: true }` | recorded and intent emitted | `complete` |
| `rejected: workflow.rejection.reminder-not-yet-due` | not due at execution time | `complete` |
| `rejected: …reminder-step-not-awaiting` / `…reminder-instance-not-running` | stale — answered or ended meanwhile | `complete` |
| `rejected: …reminder-step-has-no-service-level` / `…-has-no-clock` | no target, or a persistence defect | `complete`, and surface the second |
| `rejected: …reminder-execution-unknown` | **the context was not a machine context** | `failed` — the runner is misconfigured |
| `forbidden: workflow.reminder.execute` | the principal lacks the capability | `failed` — the grant is missing |
| `not_found: workflow-instance` / `workflow-step` | gone, or another tenant's | `complete` |

**Every refusal is also the stale-execution answer.** A reminder decided at one instant and executed
at another is the same question asked again with newer rows, so the runner needs no separate notion of
staleness and cannot forget to check for it.

The due condition, re-derived inside the authoritative transaction:

```
instance.status = 'running'
AND step.status = 'awaiting'
AND step.service_level_count IS NOT NULL
AND asAt > step.awaiting_at + service_level_count × unit_span(service_level_unit)
```

with `unit_span('hours') = 1h`, `unit_span('days') = 24h`, and `>` **strict**.

---

## 20. The blocking gap: the runner cannot discover work

**This is the one thing that must be resolved before any of the above is implementable, and it is
Workflow's to resolve, not Platform's.**

`workflow.remind-step` requires an `instanceId` and a `stepId`. **No published Workflow query answers
"which steps in this tenant are due a reminder now."** Verified against every registered query:

| Query | Why it cannot answer |
|---|---|
| `workflow.pending-approvals` | declares `workflow.approval.read-own` and resolves from the **caller's membership** — a machine has none, by design |
| `workflow.search-instances` | declares `workflow.instance.read` (a human administrator's permission the runner must not hold), returns **instances not steps**, and cannot filter on the service level |
| `workflow.read-approval-status`, `workflow.read-history` | need an `instanceId` the caller already has |

So the runner can *execute* a reminder and has no way to *find* one.

Closing it needs a **new bounded Workflow read** — identifier-free, tenant-scoped, returning the
`(instanceId, stepId)` pairs due at a supplied instant, declaring **`workflow.reminder.execute`**
rather than any human permission, and bounded by a page size. That is a new published contract and
therefore **a new owner decision**; it is deliberately not designed here beyond naming what it must
be, and **not implemented**.

Until it exists, Platform can build the runner but cannot feed it.

---

## The end-to-end flow

```
Platform scheduler                    ← Platform owns
        ↓
Platform JobPort runner               ← Platform owns
        ↓
machine execution principal           ← Platform owns (ServicePrincipal / ApiKeyPrincipal)
        ↓
MachineContext                        ← Work's shape, Platform constructs it
        ↓
workflow.remind-step                  ← Workflow owns the business rule
        ↓
evaluate the due condition            ← Workflow, inside the transaction
        ↓
Identity recipient lookup             ← Identity owns membership → workforce user
        ↓
PostgreSQL idempotency claim          ← Workflow, the database arbitrates
        ↓
workflow_history: step-reminded       ← Workflow, the claim and the audit are one insert
        ↓
transaction commit                    ← the authoritative boundary
        ↓
notification intent                   ← Workflow emits intent only
        ↓
Phase 17 delivery                     ← Phase 17 owns transport
```

The recipient lookup sits **after** the claim deliberately: a reminder that is refused never asks
Identity anything, which is asserted in the application suite.

---

## The Platform-side tests that must exist

Documented rather than written, because their behaviour is Platform's. Work's own half of each is
already proved and is named for comparison.

| Scenario | Required outcome | Work's existing half |
|---|---|---|
| **Tenant isolation** — a job for tenant A cannot execute as tenant B | refused; RLS filters, and the context tenant is the only tenant | `workflow-reminder-uniqueness.integration.test.ts` proves RLS both ways over an automatic entry |
| **Machine authorization** — a principal without `workflow.reminder.execute` | `forbidden`, before the handler runs | proved in `workflow-reminder.test.ts` |
| **Authorized execution** — a correctly granted principal | reaches Workflow as a `MachineContext` | proved in `machine-context.test.ts` |
| **Human separation** — machine execution acquires no membership | `currentMembershipId()` is `undefined`; both actor columns null | proved in `machine-context.test.ts` and the persistence suite |
| **Retry** — the same job delivered twice | one `step-reminded` row; the second delivery is harmless | proved by the partial unique index |
| **Concurrency** — two executions against one step | **exactly one** row; the loser aborts | proved with two real connections, no sleeps |
| **Failure** — the Workflow transaction fails | no claim survives | proved by the rollback assertions |
| **Notification** — intent only after commit | intent emitted post-commit; a failed send keeps the claim | proved in `workflow-reminder.test.ts` |

Platform must additionally prove what only it can: that the runner sets the tenant from the principal
and never from the payload, that `attempt` increments across redeliveries of one `jobId`, and that a
`failed` outcome re-delivers under its configured policy.

---

## Completion criteria

The reminder becomes executable when **all** of these hold:

1. Platform provides a job runner implementing `JobPort`, including `register` and delivery.
2. The runner authenticates as a non-human principal holding `workflow.reminder.execute` and nothing
   else of Workflow's.
3. The runner constructs a `MachineContext` per §3 and runs the handler inside it.
4. The runner connects as a role with no `BYPASSRLS`.
5. **The Workflow discovery query of §20 is approved and built** — without it there is nothing to feed
   the runner.
6. The Platform-side tests above pass.

Until 1–5, the approved reminder is complete and dormant: every part of it is built, verified and
merged in `munaxa-work`, and nothing invokes it.

---

## What this document does not authorize

No scheduler, worker, cron, polling loop, queue consumer, broker, outbox, timer, system actor, fake
machine user, service credential, Platform authentication, or a `JobPort` adapter that pretends to
execute jobs — none of these may be built in `munaxa-work`, and none is.

Nor does it authorize a generic automation framework, an `AutomationRule`, a generic action type or
SLA action enum, automatic escalation, rejection, skip, expiry or approval, business-day calendars,
candidate enumeration or a picker, Admin mutation, analytics, reporting or portals.

**The service-level reminder remains the only approved automatic business action.**
