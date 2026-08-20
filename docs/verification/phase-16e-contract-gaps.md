# Phase 16E — Checkpoint 2 Scope and Contract Gaps

**Investigation only. No production file was created or modified.**

The owner's decisions of the record dated 2026-08-20 approve Phase 16E and all nine decisions
([`phase-16e-register.md`](phase-16e-register.md)). This document does what the approval's own
implementation order requires before any code is written: it states the exact Checkpoint 2 scope,
then names every contract that scope needs and does not have.

**Outcome: seven contract gaps, every one of them a STOP the owner's instruction defines.** No
production code is written, because there is no part of the approved scope that can be reached
without crossing one of them.

Verified at HEAD `2150f19`, working tree clean, zero production changes since `730502a`.

---

## 1. Checkpoint 2 scope, as approved

Phase 16E adds a **controlled automatic execution layer** on top of the completed human-triggered
engine, without changing the meaning of the human workflow. The approved chain is:

```
Scheduler → Platform job runner → infrastructure execution context → Work automation entry point
  → Workflow domain evaluation → transactional business action → Workflow history
  → notification intent → Phase 17 delivery
```

Ownership, as approved (D-16E-03):

| Platform / infrastructure owns | Munaxa Work owns |
|---|---|
| scheduler · job triggering · execution context · retry mechanics · worker lifecycle · job leasing/claiming · execution attempt identity · infrastructure observability | whether an action is due · whether it is allowed · workflow/domain rules · selecting the business action · transactionally applying it · recording Workflow history · producing notification intent |

Explicitly **not** absorbed by Phase 16E: notification delivery · Admin authentication · Admin
mutation architecture · candidate enumeration · directories · portals · analytics · external
approvers · Phase 17 implementation.

---

## 2. The chain, mapped to what exists

| Chain link | Exists today? | Evidence |
|---|---|---|
| Scheduler | **no** | no scheduler anywhere in the repository |
| Platform job runner | **no** | `JobPort` has zero implementations |
| Infrastructure execution context | **no** | `ExecutionContext` is `TenantContext \| SystemContext` and is neither |
| Work automation entry point | **no** | no job module in `apps/api/src`; `JobPort` has zero consumers |
| Workflow domain evaluation | **no rule to evaluate** | no automatic action is defined by any Workflow rule |
| Transactional business action | **partly** — `unitOfWork.execute` exists and is proven for the human path | Phase 16D |
| Workflow history | **vocabulary closed against it** | nine values, no automatic event |
| Notification intent | **no** | Workflow consumes no `NotificationPort`, and cannot address one |
| Phase 17 delivery | out of scope | correct |

Two of the nine links exist. The first four do not exist at all, and the rest are blocked behind
them.

---

## 3. Contract gaps

Each gap states what the approval requires, what the repository actually has, why it is a STOP under
the owner's own stop conditions, the **minimum** missing contract, and who owns it. **None of these
contracts is defined or implemented here** — naming a minimum shape is not the same as authorizing
it, and the owner reserved that authorization explicitly.

### G-1 — Machine-execution authorization contract · **STOP 1**, and D-16E-02's own stop clause

*Required.* "Workflow authorization for automatic actions must be explicit and separate from human
permissions." Reuse of `workflow.approval.escalate`, `approval.decide`, `instance.start`,
`instance.cancel` and `group.manage` is forbidden. Wildcard authorization, permission bypass,
service credentials inside Workflow and internal-only authorization are all forbidden.

*What exists.* Every handler declares a required permission — `CommandHandler.permission`
(`packages/kernel/src/cqrs/pipeline.ts:38`) and `QueryHandler.permission` (`:45`) — and the
dispatcher refuses before validation unless `PermissionChecker.holds` answers true
(`pipeline.ts:100`, `:120`). The production checker answers **false** for a missing context and for
a system context, and otherwise consults a set the *deployment* was configured to grant
(`apps/api/src/identity/permission-checker.ts:20-31`). Workflow declares exactly ten permissions,
all of them describing a human act (`packages/modules/workflow/src/application/workflow-permissions.ts:41-81`).

*Why it stops.* There is no principal an automatic executor could be, and therefore no set that
could contain a machine permission. The file that implements the checker states the constraint
plainly: *"Munaxa Work will never implement a role engine or a permission engine. What it does is
declare the permissions its handlers require, so that Platform has something to grant."* The grant
of authority to a non-human principal is therefore **Platform's contract, not Workflow's** — and
inventing one inside Workflow is precisely the bypass the approval forbids.

*Minimum missing contract (Platform).* A way for Platform to answer `holds(permission)` for a
**named machine execution identity** that is not a membership and not a user: the identity's
definition, how a deployment grants to it, and how the grant is scoped to one tenant. Plus **one
approved Workflow permission name** for automatic execution, which the owner has not supplied and
which cannot be inferred from the ten that exist.

*Owner:* Platform (the authorization half) and the owner of this phase (the permission name).

---

### G-2 — Infrastructure execution context · **STOP 4 and 5**, and the ACTOR MODEL stop clause

*Required.* "Workflow must receive an explicit execution context identifying: tenant · job/action
identity · execution attempt · correlation/idempotency identity", infrastructure-provided,
never user-suppliable. The executor "is NOT a tenant membership and must NOT pretend to be one".

*What exists.* `ExecutionContext = TenantContext | SystemContext`
(`packages/kernel/src/tenancy/tenant-context.ts:58`). Neither can carry it:

| | `TenantContext` (`:18-49`) | `SystemContext` (`:52-56`) |
|---|---|---|
| tenant | yes | **no** |
| tenant-scoped business execution | yes | **refused** — `assertTenantScoped` throws (`pipeline.ts:143-150`), `currentTenantId()` throws (`tenant-context.ts:80-92`), `runWithServiceGrant` throws (`service-context.ts:62-66`) |
| actor | **required `string`** (`:22`), written to every audit column | none |
| job/action identity | no | no |
| execution attempt | no | no |
| correlation | yes | yes |

*Why it stops.* `SystemContext` is deliberately untenanted and is refused at three separate points
in the kernel — it cannot represent tenant-scoped execution, which the approval requires. And
`TenantContext` is the shape a human request produces; nothing in the type distinguishes a machine
from a person, so putting a machine identity in its required `actor` field is exactly the "fake
human actor" the approval forbids. Neither type carries the job identity or the execution attempt at
all. The owner directed: *"If the current `SystemContext` cannot safely represent this execution
context, do NOT silently modify it."* It cannot, and it was not modified.

*Minimum missing contract (kernel/Platform).* A **third** member of `ExecutionContext` — an
automatic-execution context carrying `tenantId`, a machine execution identity that is provably not a
membership, the job/action identity, the execution attempt identity and the correlation identity —
together with the pipeline's rule for it: `assertTenantScoped` must admit it (it is tenant-scoped)
while every human-decision guard must continue to refuse it.

*Owner:* kernel / Platform. Not Workflow.

---

### G-3 — `JobPort` is enqueue-only · D-16E-04's own stop clause

*Required.* The port must support enqueue/schedule · deterministic job identity · tenant-scoped
execution · execution attempt identity · safe retry · cancellation where required · no arbitrary
impersonation.

*What exists* (`packages/kernel/src/ports/index.ts:61-74`), in full:

```ts
export interface JobRequest<TPayload> {
  readonly name: string;
  readonly payload: TPayload;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly runAt?: Date;
}

export interface JobPort {
  enqueue<TPayload>(request: JobRequest<TPayload>): Promise<void>;
  schedule<TPayload>(request: JobRequest<TPayload>, cron: string): Promise<void>;
}
```

| Required semantic | Present |
|---|---|
| enqueue / schedule | **yes** |
| deterministic job identity | **partial** — `idempotencyKey` exists on submission only, and binds to nothing downstream |
| tenant-scoped execution | **no** — and `tenantId` here is a *field of the job request*, which is the "tenant identity from a job payload" the approval forbids as a tenancy source |
| execution attempt identity | **no** |
| safe retry | **no** — no attempt, no acknowledgement, no failure signal |
| cancellation | **no** |
| no arbitrary impersonation | not expressible — there is no execution side to constrain |

*Why it stops.* The port has **no execution half at all**: nothing registers a handler, nothing is
delivered, nothing is acknowledged, nothing is leased or claimed. A job can be submitted and can
never arrive. Repository-wide it has **zero implementations and zero consumers** — every one of its
several dozen occurrences is a comment or a negative-space assertion saying it has no adapter, in
Workflow, Career, Learning, Performance, Documents and Letters alike. The owner directed: *"If the
existing JobPort contract is insufficient, document the exact contract gap and stop before inventing
a replacement."*

*Minimum missing contract (Platform).* The execution half: handler registration keyed by job name ·
delivery carrying the execution context of **G-2** rather than a payload field · execution attempt
identity · acknowledgement and failure signalling · at-least-once delivery stated as such ·
lease/claim semantics if concurrent runners are permitted · cancellation.

*Owner:* Platform. Building a second scheduler inside Workflow is **STOP 7** and is forbidden.

---

### G-4 — History vocabulary and history schema · **STOP 2**, D-16E-06's stop clause, the HISTORY section

*Required.* Every automatic business action must record what happened, the instance, the affected
step/entity, the **execution identity/context**, the timestamp and the **correlation/execution
identity**. And: "Do not invent history event names. The current history check constraint is closed."

*What exists.* Nine events, in the domain
(`packages/modules/workflow/src/domain/workflow-vocabulary.ts:304-315`) and in the database
(`prisma/migrations/20260818100000_workflow_escalation/migration.sql:75`), asserted as one
vocabulary in two places:

```
instance-started · step-awaiting · step-approved · step-rejected · step-skipped
step-escalated · instance-completed · instance-rejected · instance-cancelled
```

None denotes an expiry or any automatic action. Recording one as `step-skipped`,
`instance-cancelled` or `instance-rejected` would assert something that did not happen — the same
reasoning that kept `step-escalated` out of the decision events in 16D.

Two further closed vocabularies sit behind it: `workflow_step.status` admits exactly `pending,
awaiting, approved, rejected, skipped` (`20260814100000_workflow/migration.sql:292-293`) and
`workflow_instance.status` exactly `running, completed, rejected, cancelled` (`:240-241`). Neither
has an expired value.

*A second, separate gap.* `workflow_history` carries `actor_membership_id` and
`on_behalf_of_membership_id` (`:399-400`) and **no column for an execution or correlation
identity**. The approval requires both to be recorded. That is a schema gap on top of the vocabulary
gap, and it is not solved by `metadata` — an audit fact that lives in free-form JSON is an audit fact
nothing constrains.

*Minimum missing contract (owner).* Explicit approval of the history event name(s) for each approved
automatic action, and explicit approval of the history columns that carry execution and correlation
identity. Both then move in one migration with the domain list, as `step-escalated` did.

*Owner:* the owner of this phase. Not inferable.

---

### G-5 — No SLA action is defined by any Workflow rule · **STOP 8**

*Required.* "The first supported automatic SLA actions should be limited to actions explicitly
defined by Workflow rules. Do not create a generic 'do anything when SLA breaches' mechanism."

*What exists.* A step template carries `serviceLevel?: ServiceLevelTarget` — a whole count and a unit
— and nothing else (`packages/modules/workflow/src/domain/definition.ts:124`, `:212`). The domain
derives three answers from it and takes no action: `dueAt` (`service-level.ts:90`),
`serviceLevelState` (`:116`) and `overdueByMinutes` (`:139`). The file states the design outright:
*"It is not a deadline: nothing happens when it passes."*

*Why it stops.* There is **no configured action anywhere** — no on-breach field, no action
vocabulary, no policy on a definition, a version, a step or an instance. So there is no Workflow rule
from which "which action is due" could be answered, and the only way to answer it would be to invent
the generic mechanism the approval forbids. The approval separates SLA evaluation from the business
action correctly; the gap is that the second half has no domain model at all.

*Minimum missing contract (owner + domain).* An explicit, closed vocabulary of permitted automatic
SLA actions, and where a tenant configures one. Both are business decisions this module cannot take
for itself.

---

### G-6 — Expiry has no trigger in the domain · **STOP 8**

*Required.* Expiry remains derived; no `expired` column; when expiry becomes actionable, the
scheduler identifies candidates and Workflow confirms and acts.

*What exists.* `APPROVAL_STATES` lists `expired` and `REACHABLE_APPROVAL_STATES` deliberately
excludes it (`workflow-vocabulary.ts:281-285`). There is no expiry command, no expiry column, and —
the point — **no expiry period is configurable anywhere**. `serviceLevel` is a *step* target, not an
instance expiry, and D-16C-06 approved expiry as observed and derived, never written.

*Why it stops.* "When expiry becomes actionable" presupposes a rule that says when an approval
expires. No such rule exists in the approved domain model, so the trigger cannot be determined —
STOP 8 — and it compounds G-4, since even a correctly derived expiry has no history event to record.

*Minimum missing contract (owner + domain).* Where an expiry period is configured and what the
expiry action does to the instance and its steps, given that neither status vocabulary admits an
expired value.

---

### G-7 — Organization calendar read contract · **STOP 3**, and D-16E-08's own instruction

*Required.* Business-day SLA must use Organization's authoritative calendar and holiday data through
a bounded cross-module port. Workflow must not read Organization tables, duplicate the calendar or
model its own.

*What exists.* Organization **holds the data**: `organization_calendar` carries the time zone and
working days, and `organization_calendar_day` carries dated holidays, unique on
`(tenant_id, calendar_id, on_date)` (`prisma/schema.prisma:407-430`). Organization **publishes no way
to read it**: `CalendarDayView` is a type with **zero producers**
(`packages/modules/organization/src/contracts/views.ts:184-189`), and not one of Organization's
eleven registered queries is a calendar query.

*Why it stops.* The approval's own step 3 is conditional — *"implement it in Organization only if
this approval covers that dependency"* — and the instruction also directs: *"Treat the required
cross-module contract as a separate authorization dependency unless the owner explicitly includes
it."* The owner named no query, no view and no permission for it, and Checkpoint 2's authorization
explicitly excludes "arbitrary new cross-module contracts" and "arbitrary new permissions". A new
Organization query needs a new Organization permission for Workflow to hold, which is **STOP 1** as
well as **STOP 3**.

The precedent is exact and recent: the equivalent Identity contract in Phase 16D
(`identity.membership-standing`) required its own explicit approvals — D-16D-18 for the contract and
D-16D-19 for the authorization to modify Identity — before a line was written. The same standard
applies here.

*Minimum missing contract (Organization).* A bounded read answering only the calendar facts a
business-day calculation needs — for a calendar and a date range: the time zone, the working
weekdays, and the non-working dated days — exposing no other part of the calendar domain, together
with the permission name Workflow would hold. **Not created here.**

---

### G-8 — Notification intent cannot address a recipient · **STOP 1 and 3**

Recorded as a gap although the approval treats notification intent as straightforward, because it is
blocked for a reason the investigation had not previously surfaced.

*Required.* Workflow may emit an explicit notification intent after a successful business action,
carrying only what is needed to communicate the business event; Phase 17 delivers.

*What exists.* `NotificationPort` exists in the kernel and is the right seam
(`packages/kernel/src/ports/notification.ts:28-30`). But `NotificationRecipient` addresses a
**workforce user**: `readonly userId: string` (`:12-15`).

*Why it stops.* Workflow addresses **memberships**, never users — `userId` appears **zero times** in
Workflow's production code, deliberately. Emitting an intent therefore requires resolving a
membership to a user through Identity, which is a new cross-module read contract and a new
permission. `identity.describe-member` exists but was ruled out in Phase 16D as a payload no
permission can narrow, and `identity.membership-standing` returns `{ active }` and nothing else.

There is also **no outbox** in this repository — event dispatch is post-commit, in-process and
at-most-once by design (ADR-0053, ADR-0064). The approval says to *prefer* a durable/outbox-compatible
boundary "where the existing architecture supports it"; it does not support it today, and building
one is the "second messaging system" the approval forbids.

*Minimum missing contract (Identity).* A bounded membership → workforce-user read, on the
`identity.membership-standing` model, plus its permission. **Not created here.**

---

## 4. What is implementable now

**Nothing.**

That is a finding, not a refusal, and it is worth stating why it is not an artefact of caution. The
approved architecture is a chain, and the first four links — scheduler, runner, execution context,
entry point — do not exist. Even the one link that is purely Workflow's own and needs no
infrastructure, the domain evaluation of "is an action due and permitted", cannot be written: G-5 and
G-6 mean there is **no automatic action defined in the domain to evaluate**. There is no smaller
correct increment hiding inside this scope, and the owner directed that a STOP must not be solved by
making a smaller undocumented change.

Phase 16D is untouched. Human escalation, the ten permissions, the seven eligibility rules, the
D-16D-08 denominator and the nine history events all stand exactly as `730502a` left them.

---

## 5. Verification performed

Read and inspected, at HEAD `2150f19`:

`packages/kernel/src/ports/index.ts` · `packages/kernel/src/ports/notification.ts` ·
`packages/kernel/src/tenancy/tenant-context.ts` · `packages/kernel/src/tenancy/service-context.ts` ·
`packages/kernel/src/cqrs/pipeline.ts` · `apps/api/src/identity/permission-checker.ts` ·
`packages/modules/workflow/src/application/workflow-permissions.ts` ·
`packages/modules/workflow/src/domain/workflow-vocabulary.ts` ·
`packages/modules/workflow/src/domain/service-level.ts` ·
`packages/modules/workflow/src/domain/definition.ts` ·
`packages/modules/organization/src/contracts/views.ts` · `prisma/schema.prisma` ·
`prisma/migrations/20260814100000_workflow/migration.sql` ·
`prisma/migrations/20260818100000_workflow_escalation/migration.sql`.

Searches run: `JobPort`/`JobRequest` across `packages` and `apps` excluding `dist` — **no
implementation and no consumer**, every hit a comment or a negative-space assertion; `CalendarDayView`
— **no producer**; `userId` in Workflow production code — **none**; registered `queryName` values in
Organization and Identity; `apps/api/src` module listing — **no job or worker module**.

Gates run: `pnpm standards` and `pnpm format:check`. The full implementation gate was **not** run,
and `prisma validate` / `prisma migrate status` were **not** run, because no schema or code changed.

---

## 6. NOT VERIFIED

Everything Phase 16D left unverified stands, and Phase 16E adds nothing to the verified column.
Specifically still not verified, and now blocked rather than merely absent: scheduled firing ·
durable runner · `JobPort` execution · automatic execution of any kind · automatic escalation ·
approval expiry execution · SLA-driven action · business days · notification intent · notification
delivery · outbox · broker · worker · machine authorization · machine execution identity.
