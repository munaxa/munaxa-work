# Phase 16E — Automatic Service-Level Reminder · Implementation

**Implemented, tested and verified.** The approved capability is:

> When an awaiting workflow step passes its configured elapsed-time service level, automatically emit
> one reminder intent to the step's existing approver, record exactly one immutable `step-reminded`
> history event as the database idempotency record, and change no workflow state.

Every part of that sentence is now real except the word *when* — nothing in this repository decides
*at what moment* to run it, because no job runner exists in Platform. That gap is §9, and it is the
only one.

---

## 1. What the investigation found, and why it changed the plan

The previous checkpoint stopped on four dependencies. Reading the Platform repository — accessible,
and worth reading before declaring anything absent — changed three of those four answers:

| Contract | Previously recorded | Actually |
|---|---|---|
| **G-1** machine authorization | absent | **Already implemented in Platform and simply unconsumed.** `ApiKeyService` and `ServiceAccountService` authenticate machines; `ApiKeyPrincipal` and `ServicePrincipal` carry `tenantId`, `scopes` and `permissions`; `BASELINE_POLICIES` in `@munaxa/rbac` denies machine principals the ability to change security policy |
| **G-2** machine execution context | absent, "Platform's" | **Half of it existed, and the other half was ours.** Platform's `SecurityContext` is tenant + `Principal` + `correlationId`, and `principalSubject()` yields `service:<clientId>`. But `ExecutionContext`, `TenantContext` and `SystemContext` are defined in **this repository's kernel** — so the async-local carrier was always Work's to extend. Platform owns *who the machine is*; the kernel owns *how that travels through a unit of work* |
| **G-3** job runner | absent | **Still absent, everywhere.** No job, queue or scheduler contract exists in Platform; `Scheduler` appears there only in a comment |
| **D-16E-12** Identity recipient | open, contract absent | **Contract implementable within the approved scope**, and it needed no new permission |

Platform's `Principal` union states the design this implementation follows:

> *"A principal is not always a person: background jobs, service accounts and API keys all
> authenticate, all get audited and all get authorized through the same path. Keeping them in one
> union is what stops 'machine calls' from quietly bypassing the checks humans go through."*

**Platform was read and never modified.**

## 2. The machine execution context

`MachineContext` is a third member of `ExecutionContext`
(`packages/kernel/src/tenancy/tenant-context.ts`), carrying `tenantId`, `executionIdentity`,
`correlationId`, and `jobId`/`attempt` when a runner supplied them.

Neither existing member could carry it, and the reasons are symmetrical. `SystemContext` has **no
tenant** and is refused by `currentTenantId`, by the CQRS pipeline and by every service grant — right
for a migration, useless for work belonging to one tenant. `TenantContext` is the shape a human
request produces: its `actor` is a person and nothing in the type says otherwise, so a machine placed
there would be indistinguishable from a human at exactly the point an auditor needs them apart.

**It is not a membership and cannot become one.** There is no `membershipId` and no way to add one.
That is what makes "a machine is never an approver" structural: `currentMembership()` answers
`undefined`, so `requireMembership` refuses automatic execution **without any rule about machines
existing anywhere**.

**It opens the tenancy gate and not the authorization one.** A machine still has to hold the
handler's declared permission, checked by the same `Dispatcher` a person's request goes through.

Three call sites now distinguish three kinds of caller: `assertTenantScoped`, `currentTenantId`, and
`actorOf` in `@work/persistence` — which writes the platform subject beside the `system:<reason>` a
migration already writes there. The union widening surfaced **eighteen** further call sites that
narrowed by excluding only the system context and then read a human field; sixteen were the same
`actor: context.actor` line in sixteen module context files, so the rule now lives once in the kernel
as `actorSubjectOf`.

## 3. `JobPort`'s execution half

`JobPort` was enqueue-only: work could be submitted that nothing could ever deliver. It gains
`JobExecution`, `JobOutcome`, `JobHandler` and `register`
(`packages/kernel/src/ports/index.ts`) — job identity, tenant, execution attempt, correlation
identity, the execution identity, delivery to a named handler, and failure reporting.

**The tenant is on the execution, not in the payload.** A handler taking the tenant from `payload`
would let whoever enqueued the job choose the tenant, which is the one thing tenancy may never allow.

**No runner is implemented and none may be.** The process that holds a queue, leases work, counts
attempts and applies a retry policy is Platform's.

## 4. The Identity recipient contract

`identity.membership-recipient` — one membership identifier in, one `workforceUserId` out
(`packages/modules/identity/src/application/membership-recipient.query.ts`).

It declares the **existing** `identity.membership.read` and **adds no permission**. Every alternative
was closed: `list-memberships` and `active-memberships-for-employment` are enumerations,
`describe-member` answers a member's whole page, and `membership-standing` returns a predicate and may
not be widened.

**It answers *who*, never *whether*.** A suspended member still has a recipient, and a test asserts
it: eligibility is `membership-standing`'s question, and folding the two would make an addressing
lookup take a position on it.

Workflow reaches it through `WorkflowReminderRecipient`
(`apps/api/src/workflow/workflow-reminder-recipient.ts`) under a bounded service grant naming that one
permission. The elevation record names the **machine identity** rather than a person, which is what
makes "what did Workflow read inside Identity, and on whose authority" answerable for automatic work.

## 5. The history contract

`step-reminded` — the tenth value, in the domain list and in `workflow_history_event_check`, moved
together in one migration exactly as `step-escalated` was. The parity suite requires the two to
enumerate the same set.

**Both actor columns stay null**, which is the model's documented meaning — *"absent when nothing
human did"* — and what every `step-awaiting` entry already does. The approver on the step is the
**recipient**, not the actor.

**Provenance is four dedicated nullable columns**: `execution_identity`, `execution_correlation_id`,
`execution_job_id`, `execution_attempt`. Not `metadata`, which the parity suite classifies as
non-domain and which no mapper reads — provenance there would have been invisible to the application.

Two constraints make the wrong row unrepresentable rather than merely discouraged:

- `workflow_history_execution_check` — the four move together: an execution needs a correlation, a job
  number needs a job, an attempt needs a job.
- `workflow_history_execution_not_human_check` — **a machine did it or a person did, never both.**
  Impersonation is not forbidden by convention; it cannot be expressed.

## 6. Idempotency

Identity `(tenant_id, step_id)`, enforced by
`workflow_history_reminder_idx: unique (tenant_id, step_id) where event = 'step-reminded' and
deleted_at is null`.

The **history row is itself the idempotency record**, so the claim and the audit entry are one insert
and cannot disagree. `workflow_history` is already insert-only *in the database* — the
`workflow_history_no_mutation` trigger refuses every update and delete — so a claim can never be
released.

The key is a step because a step's clock starts once, nothing restarts it, and a step never returns to
`awaiting`; it therefore crosses its target exactly once.

**The handler does not re-read history to check for a duplicate, and must not.** A `select` followed
by an `insert` is not idempotent under concurrency (ADR-0071), so a check there is one two workers
could both pass. The database arbitrates.

## 7. Transaction ordering, and the failure window

As approved: **evaluate → claim → record → commit → emit**.

The owner rejected `claim → notify → commit`, which opens a duplicate window if the transaction later
rolls back. The consequence is stated rather than hedged: **at-most-once reminder intent dispatch**.
If the send fails after the commit, the history row and the claim remain and no second reminder is
ever generated for that step. A test asserts exactly that, so nobody can later "fix" the lost reminder
by retrying into a second claim.

There is no outbox and none was built (ADR-0053, ADR-0064).

## 8. What it does not do

No step is written, no status moves, no decision is recorded, no approver is added, and the tally —
`assigned`, threshold, `outstanding`, `unresolved` — is **structurally unreachable**: the handler
holds no step-store or instance-store write. D-16D-08 is untouched, and the application suite proves
it by comparing the entire published approval status before and after.

Not implemented: automatic escalation · candidate enumeration · approval automation · automatic
rejection, skip or expiry · business-day SLA · SLA breach persistence · a generic automation framework
or action enum · a scheduler · a worker · a broker · an outbox · notification delivery · Admin
mutation or authentication · analytics · portals.

## 9. The one remaining gap — **no job runner**

Nothing invokes the reminder on a schedule, because **no job runner exists in Platform**. The
capability is complete and reachable — a command, through the pipeline, under a machine context — and
what is missing is the thing that decides *when*.

This is not a gap that can be closed here: D-16E-03 assigns the scheduler, job triggering, retry
mechanics and worker lifecycle to Platform, and building one in Workflow is forbidden by that same
decision. `JobPort` now states exactly what such a runner must satisfy, so the contract it has to meet
is written down rather than negotiable.

**Required in `munaxa/munaxa-platform`:** a runner implementing `JobPort`, delivering a
`JobExecution` under a machine principal, whose `SecurityContext` the API maps into a
`MachineContext`. Both halves of that mapping exist; nothing performs it.

## 10. Verification

| Gate | Result |
|---|---|
| `pnpm standards` | **PASS** — no violations · 176 models · 17 catalogue sets · 1,746 files, no cycles |
| `pnpm format:check` | **PASS** |
| `prisma validate` | **PASS** |
| `prisma migrate status` | **25 migrations, up to date, no drift** |
| `turbo run build lint typecheck test --force` | recorded in the accompanying report |

**Proved against real PostgreSQL**, not asserted in prose:

- **Concurrency** — two real connections, overlapping in time, no sleeps: exactly one commits, the
  loser takes `duplicate:workflow_history_reminder_idx`, its transaction aborts whole, and one row
  survives bearing the winner's identity.
- **RLS** — an automatic entry is visible in its own tenant and invisible in another, with both rows
  confirmed to exist so the "1" is a policy filtering rather than a row never written. A tenant cannot
  write an automatic entry into another tenant's rows.
- **Immutability** — the claim cannot be released: update and delete both raise
  `workflow_history_immutable`.
- **Constraints** — a row naming both an approver and an execution is refused; an execution with no
  correlation is refused; an attempt with no job is refused; a human entry naming its actor is still
  accepted.
- **Round trip** — the provenance survives domain → mapper → PostgreSQL → mapper → domain, including
  the unscheduled case where `jobId` and `attempt` are absent.

**Still NOT VERIFIED:** scheduled firing · a durable runner · `JobPort` delivery end to end · retry
semantics under a real runner · notification *delivery* · business days · automatic escalation ·
expiry execution · authentication through the real Platform adapter.

## 11. What was corrected along the way

Recorded because the corrections are part of the evidence:

- A negative-space scan forbade the word `notification` in Workflow's dependency keys. D-16E-07
  approved notification *intent*, so keeping it would have meant failing an owner decision or renaming
  a port to evade a word. It was replaced with the words that mean **delivery** — broker, queue,
  channel, transport, email, sms, push — and a positive assertion that `notify` is called exactly
  once. The same treatment was applied to the domain scan, the schema-column scan and the migration
  scan: each fragment that came off carries a companion assertion that what replaced it is present, so
  a removal cannot pass for an abandonment.
- Extracting the harness's fakes put test doubles into the application source scan, which then matched
  a fake's own field. The fakes joined the existing `test-harness`/`scenarios` exclusions rather than
  the scan being loosened.
- A port-narrowness assertion started failing because a minimal file reader dropped the original's
  comment-stripping — so a doc comment explaining that a port has no `page` or `search` matched the
  scan forbidding them. Stripping was restored.
- Four files exceeded the 400-line budget and were **split**, never exempted.
