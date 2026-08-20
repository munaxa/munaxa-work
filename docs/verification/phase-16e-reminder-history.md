# Phase 16E — Automatic Service-Level Reminder · History Contract

**Investigation and documentation only. No production file was created or modified.** No domain,
application, repository, schema, migration, index, port, adapter, permission, route, test or
localization change was written. Identity, Organization, Platform, Admin and the API are untouched.

Investigated at HEAD `815d9c7`, working tree clean, zero production changes since `730502a`.

This is the **second checkpoint** of D-16E-10. It traces the complete path
**domain → repository → PostgreSQL → repository → view → rendering** and reports what a new history
event would actually require, rather than assuming that adding a value to one layer is enough.

---

## 1. D-16E-11 approval state

**D-16E-11 = APPROVED**, for the **existence** of a dedicated Workflow history event meaning exactly:

> Workflow automatically emitted a service-level reminder because an awaiting step passed its
> configured elapsed-time service level.

It is an **observation of an automatic notification-intent action**. It must not mean: approver
escalated · approver approved · approver rejected · approver skipped · approval expired · the SLA was
permanently breached · workflow state changed.

**What is not approved**, and is therefore proposed rather than adopted below: the event identifier ·
any column layout · any metadata shape · any provenance field name · any migration · any index · any
idempotency implementation · Identity modification · Platform modification · `JobPort` · scheduler ·
worker · notification delivery · outbox · broker · machine actor · service account · authentication
change.

---

## 2. What the investigation covered

Read in full: `domain/history.ts` · `domain/workflow-vocabulary.ts` · `domain/service-level.ts` ·
`domain/escalation.ts` · `infrastructure/workflow-record-rows.ts` · `infrastructure/record.repository.ts` ·
`contracts/views.ts` · `apps/admin/src/workflow/history.tsx` · `locales/en.json`, `ar.json` ·
`packages/persistence/src/repository.ts` · `packages/kernel/src/ports/notification.ts` ·
`packages/kernel/src/tenancy/tenant-context.ts` · `packages/kernel/src/cqrs/pipeline.ts` ·
migrations `20260814100000_workflow`, `20260816100000_workflow_routing_resolution`,
`20260818100000_workflow_escalation` · the parity suites
`workflow-parity.integration.test.ts` and `workflow-repository-parity.integration.test.ts`.

---

## A. Event identity

### PROPOSED — `step-reminded`

**Marked PROPOSED. Implementation requires explicit approval of the concrete contract.** It has not
been added to `WORKFLOW_HISTORY_EVENTS`, to the check constraint, or to any catalogue.

*Why it fits the convention.* Every existing value is `<subject>-<past participle>` with the subject
being `instance` or `step`: `instance-started`, `step-awaiting`, `step-approved`, `step-rejected`,
`step-skipped`, `step-escalated`, `instance-completed`, `instance-rejected`, `instance-cancelled`.
The event concerns one step, so the subject is `step`. Two segments, lower-case, hyphenated — the
same shape as the other nine.

*Why not longer.* The owner's own §4 principle settles most of it: the business event answers *"what
happened to this workflow?"* and the provenance separately answers *"which automatic execution caused
it?"* So **`automatic` does not belong in the name** — that is the mechanism, and it lives in the
provenance columns. Nor does `service-level`: the cause is already derivable from the row itself, since
the step carries `service_level_count`, `service_level_unit` and `awaiting_at`, and the entry carries
`occurred_at`. And `domain/history.ts:13-15` requires the list be "a closed list with no business word
in it".

*The tension, stated rather than hidden.* Requirement A asks for an identifier that is "clearly
automatic-reminder-specific", while §4 forbids encoding the mechanism in the name. `step-reminded` is
reminder-specific but not, on its face, automatic. **What makes it unambiguously automatic is
structural, not lexical**: it is the only event whose actor columns are null *and* whose provenance
columns are populated. That is a stronger guarantee than a word in a name, because a name cannot be
enforced and a null-actor-plus-provenance shape can.

*Runner-up, offered so the owner can choose rather than be steered:* **`step-service-level-reminded`**
— unambiguous about the cause and future-proof if a second kind of reminder is ever approved. Costs:
it would be the first three-segment value, and it anticipates a generality the D-16E-05 amendment
explicitly forbids (no generic mechanism, no generic action enum), so today there is exactly one kind
of reminder for it to be distinguished from.

**Neither is adopted. The identifier is the owner's.**

---

## B. Business meaning

**`step-reminded` means:** an automatic service-level reminder intent was emitted for an awaiting step
whose configured elapsed-time service level had passed at the moment of execution. It records that
Workflow acted, on which step, and when — nothing more.

**What it does not imply**, each stated because each is a mistake a reader could otherwise make:

- **not delivered** — the notification intent was emitted to `NotificationPort`; transport, template,
  provider and delivery status are Phase 17's and are not claimed here;
- **not seen** — nothing here says the approver read anything, or was even reachable;
- **not a persisted overdue state** — no `breached`, no `due_at`, no `expired`, no `sla_state`. The
  service level stays derived, and this row is the record of an *action*, not of a *condition*;
- **not a decision** — no approval, rejection or skip; no step status changed;
- **not an escalation** — no approver was added, no step was created;
- **not expiry** — the approval did not end and nothing expired.

---

## 7. Actor semantics

**Finding: the existing history model can represent this honestly, unchanged, and needs no fake
human.**

Both actor columns are left **null**. This is not an evasion — it is the model's documented meaning.
`domain/history.ts:35` types `actorMembershipId` as optional and says why: *"The membership that
acted. Absent when nothing human did — a step merely becoming current."* Every `step-awaiting` entry
is already written with no actor, in `startHistory` and in `decisionHistory`, and
`cancellationHistory` takes the actor as an optional parameter for the same reason.

The database agrees: `actor_membership_id` and `on_behalf_of_membership_id` are both nullable, and the
only constraint over them, `workflow_history_authority_check`, requires merely that
`on_behalf_of_membership_id is null or actor_membership_id is not null` — *"Nobody acts on another's
behalf without acting."* Null and null is legal and already occurs.

**Never populated with**: a fake membership · a service membership · a manager · the assigned approver
· the requester · the configuring administrator. The assigned approver is the **recipient**, not the
actor, and writing them into the actor column would say they did something they did not do.

**One column does need an answer, and it is a real finding.** `workflow_history.created_by` is
`varchar(255) not null`, supplied by `auditForInsert` → `actorOf()`
(`packages/persistence/src/repository.ts:29-34`):

```ts
const actorOf = (): string => {
  const context = currentContext();
  if (context === undefined) return 'system:unknown';
  return isSystemContext(context) ? `system:${context.reason}` : (context.userId ?? context.actor);
};
```

Two consequences:

1. **The audit convention already accommodates a non-human actor** — `system:<reason>` — without a
   membership anywhere. So `created_by` is not a reason to invent a fake user.
2. **`actorOf` is a third place the machine execution context must be represented**, alongside
   `assertTenantScoped` (`pipeline.ts:143`) and `currentTenantId` (`tenant-context.ts:80`). A new
   `ExecutionContext` union member would make this function stop compiling until it is handled —
   which is the safe failure — but it means `packages/persistence/src/repository.ts` is a **required
   change point of the G-2 contract**, in a shared package every module uses. That was not previously
   recorded and is recorded now.

---

## 8. Execution provenance

### Where it belongs: **dedicated columns.** Not metadata, and the reason is enforced by a test.

`metadata` is on the parity suite's `INFRASTRUCTURE` exclusion set
(`workflow-repository-parity.integration.test.ts:72-81`), alongside `tenant_id` and the audit and
soft-delete pairs, with the comment: *"Everything **not** on this list is a domain column, and the
assertion below requires a mapper to read it."* No mapper reads `metadata`; `historyColumns` does not
select it and `historyValues` does not write it. **Provenance placed there would be invisible to the
application** — exactly the silent-unmapping failure that suite exists to catch. It is also
unconstrained JSON, and an audit fact nothing constrains is an audit fact nothing can be held to.

A separate execution table was considered and is not proposed: it would need its own tenancy, its own
RLS policy, its own immutability guarantee and its own join, to hold facts that belong one-to-one with
the history row that already exists.

### The minimum set

| # | Question | Answer | Column |
|---|---|---|---|
| 1 | execution identity | the machine execution that ran | **new** |
| 2 | job identity | which job it was | **new** |
| 3 | execution attempt | which attempt | **new** |
| 4 | correlation identity | the correlation chain | **new** |
| 5 | tenant | **already `tenant_id`** — not duplicated, and RLS derives it safely | — |
| 6 | affected instance | **already `instance_id`** | — |
| 7 | affected step | **already `step_id`** (with `ordinal` for the branch) | — |

**Four new columns, and the exact set cannot be finalised here.** Their names, types and nullability
follow from what the **G-2 machine execution context actually carries**, and G-2 does not exist. Fixing
column names against a contract that has not been written is how a schema acquires a shape nothing
needs. That is a **STOP** (§7's own clause: *"Do not modify the schema until the required execution
provenance contract is explicitly resolved"*).

**Never recorded**: secrets, bearer tokens, credentials, connection strings, Platform authorization
details, or opaque infrastructure payloads. Opaque identities only.

**Nullability, when it is decided**: these columns exist only on automatic rows, and the other nine
events have no execution behind them. So they are nullable, with — if the owner wants the guarantee in
the database rather than in prose — a check constraint tying them to the automatic event, in the style
`workflow_history_authority_check` already uses.

---

## 9. Idempotency

**Business identity: `(tenant_id, step_id)`**, as approved in D-16E-10 and re-verified here:
`awaiting_at` is written once (`instance.ts:266`, `decision.ts:316`, `escalation.ts:201`), nothing
restarts it (`service-level.ts:22-23`), and a step never returns to `awaiting`. A step crosses its
threshold once, so one reminder per step, ever.

**Can the history row itself be the idempotency record? Yes**, and it is the better of the two options.

- `workflow_history` is already **insert-only in the database**, not merely by convention: the
  `workflow_history_no_mutation` trigger fires `before update or delete` and raises
  `workflow_history_immutable` with `errcode = 'restrict_violation'`
  (`20260814100000_workflow/migration.sql:457-468`). A row that claims the identity can never be
  altered to release the claim, and cannot be soft-deleted to make room for a second.
- It is already tenant-scoped and RLS-protected — `call app_protect_table('workflow_history')`
  (`:492`).
- It removes the need for a second table, and therefore for a second tenancy policy, a second
  immutability guarantee and a join.

**The exact predicate**, proposed and not created:

```sql
create unique index workflow_history_reminder_idx
  on workflow_history (tenant_id, step_id)
  where event = 'step-reminded' and deleted_at is null;
```

Notes on each part:

- **partial**, so it constrains only reminder rows. The other nine events legitimately repeat on a
  step — several `step-awaiting` entries and a `step-approved` share one `step_id`.
- **`tenant_id` leads**, as it leads `workflow_step_escalation_idx` and every other key here. Two
  tenants may hold colliding identifiers, and a key without the tenant would let one tenant's reminder
  suppress another's.
- **`step_id` is nullable** on the table, but the predicate admits only rows of this event, which
  always name a step. Postgres would in any case not index a null pair as a conflict.
- **`deleted_at is null`** mirrors the escalation precedent. It is belt-and-braces here, since the
  immutability trigger makes a soft delete impossible; kept for consistency, and worth an explicit
  note rather than silent divergence.

**The database is authoritative.** No in-memory mutex, no process lock, no sleep, no retry
suppression, no scheduler exactly-once assumption, no worker exactly-once assumption. ADR-0071:
*"a `select` followed by an `insert` is not idempotent under concurrency"* — so the guarantee is the
index, never a preceding read.

**Not created here.** The index depends on the approved event value, and the migration on the approved
column set.

---

## 10. Concurrency

**The race the implementation must pass**, on real PostgreSQL with two real connections:

```
tenant T, step S, one due condition, two workers, at the same instant
```

| Required outcome | Provided by |
|---|---|
| exactly one history/idempotency row | `workflow_history_reminder_idx` unique violation on the loser's insert |
| exactly one notification intent | the intent is emitted **after** the claim commits, so the loser never reaches it |
| no duplicate reminder | same |
| no workflow-state change, either side | the action writes no step and no instance row at all |

**The guarantee is the unique index inside the transaction, not application locking.** The loser
receives `23505 unique_violation`; in PostgreSQL that error aborts its transaction, so it rolls back
whole — there is no partial effect to compensate. That is the same mechanism
`workflow-escalation-uniqueness.integration.test.ts` already proves for human escalation, and the same
one ADR-0071 prescribes.

Application-level locking is explicitly **not** the correctness mechanism. Nothing may depend on the
scheduler or the worker delivering once.

---

## 11. Transaction ordering, and the failure window

The proposed ordering follows the owner's, with steps 3 and 7 clarified:

1. authorize the machine execution through the approved Platform contract;
2. establish the tenant execution context;
3. read the instance and the step **inside the transaction** — no `select … for update` is required,
   because the correctness guarantee is the unique index rather than a lock, and a row lock here would
   serialise readers for no benefit;
4. re-evaluate the SLA predicate from those rows;
5. verify the step is still `awaiting`;
6. verify the instance is still `running`;
7. **atomically claim the identity by inserting the history row** — the claim and the audit record are
   the same insert, which is what makes them impossible to disagree;
8. emit the notification intent;
9. commit.

### The failure window, examined rather than asserted away

`NotificationPort.notify` returns `Promise<void>` and is **out of process**. It cannot enrol in the
database transaction, and this repository has **no outbox** — dispatch is post-commit, in-process and
at-most-once by design (ADR-0053, ADR-0064). So one window is unavoidable, and the choice is only
*which* one:

| Ordering | Failure mode |
|---|---|
| **claim → notify → commit** (above) | a crash after notify but before commit rolls the claim back, so the reminder **could be sent twice** |
| **claim → commit → notify** | a crash after commit but before notify **loses the reminder permanently** — the claim is committed, so no retry can ever re-emit it |

Both are real. Neither can be eliminated without an outbox, and **inventing one is forbidden**.

*The honest cost of the second, stated plainly:* because the claim is committed and history is
immutable, a lost reminder is lost **for good** for that step. There is no retry path and no
reconciliation command that could re-emit it.

*What this document recommends, and why it is a recommendation and not a decision:* the ordering above
(notify inside the transaction, before commit) is preferred, because a duplicate reminder is a second
message and a lost reminder is a silence — and for an action whose entire business effect is one
message, a redundant message is the cheaper failure. The `idempotencyKey` on `NotificationRequest`
(`notification.ts:25`) gives Communications a second chance to suppress the duplicate, which nothing
gives the silence.

**This is the owner's call**, and the instruction asks for exactly it: *"Determine whether that is
acceptable for this action."* It is recorded as an open sub-decision (§21) and neither ordering is
implemented.

---

## 12. Notification semantics

**The existing `NotificationPort` can represent this with no new delivery architecture. There is no
contract gap here.**

`NotificationRequest` (`packages/kernel/src/ports/notification.ts:17-26`) carries `templateKey`,
`recipients`, `variables`, `correlationId` and an optional `idempotencyKey` — which is precisely
"remind this person about this awaiting step":

| Field | Value |
|---|---|
| `templateKey` | one key naming the event. Content and channel are Communications' business — the port's header: *"A domain says what happened and to whom. It never says 'send an email'."* |
| `recipients` | exactly one — the assigned approver of the overdue step |
| `variables` | the minimum a template needs to identify the approval. No decision content, no rejection comment, no subject business data |
| `correlationId` | from the machine execution context |
| `idempotencyKey` | the `(tenant_id, step_id)` identity, so a repeat is suppressed at the port as well as in the database |

**The history event records intent, never delivery.** It must not claim delivered, sent, received or
read — which is one reason `notification-sent` is rejected in §17.

---

## 13. Identity boundary

**Unchanged from the reminder contract, and Identity was not modified.**

Workflow holds `workflow_step.approver_membership_id`; `NotificationRecipient` requires
`readonly userId: string` — a workforce user (`notification.ts:12-15`). Workflow contains **zero**
`userId` occurrences in production code, deliberately. The mapping is one column,
`tenant_membership.workforce_user_id` (`prisma/schema.prisma:37-56`), and ADR-0033 makes it one row
per Platform account.

The minimum contract: one membership identifier in · tenant-scoped from the execution context · only
the recipient identity `NotificationPort` requires · declares the **existing**
`identity.membership.read`, so **no new permission** · no enumeration · no profile, employment,
reporting or delegation data · `not_found` for another tenant's membership exactly as for one that
does not exist · a **second narrow query**, never a widening of `identity.membership-standing` and
never `describe-member`.

**D-16E-12 remains OPEN** — authorization to modify Identity, on the D-16D-19 precedent.

---

## 14. History database constraints — the complete path

The instruction's two questions, answered directly.

### "If only the domain vocabulary changes, what prevents PostgreSQL from rejecting the event?"

**Nothing — and that is the point.** `workflow_history_event_check`
(`20260818100000_workflow_escalation/migration.sql:75`) enumerates the same nine values. An insert of
a tenth fails with a check violation at the first attempt.

The two lists are also asserted to agree *before* runtime:
`workflow-parity.integration.test.ts:104` pairs `workflow_history_event_check` with
`WORKFLOW_HISTORY_EVENTS` and requires the enumerated sets be identical. So a domain-only change fails
the parity suite, and a constraint-only change fails it too. This is the mechanism Phase 16D used
deliberately for `step-escalated`: `domain/escalation.ts:47-49` records that the value was *"named here
in Checkpoint 2 and deliberately kept out of `WORKFLOW_HISTORY_EVENTS` until Checkpoint 3's migration
widened the constraint"* — the two moved together.

### "If PostgreSQL changes, what prevents the mapper from silently dropping it?"

For the **event value**: nothing needs to change in the mapper — `historyValues` writes `event` and
`historyState` reads it as `row.event as WorkflowHistoryEvent`. The cast is worth naming: a value
present in the database but absent from the domain union would be read back as a lie the type system
cannot catch. The parity suite is what prevents that state from existing.

For the **new provenance columns**, the protection already exists and is specific.
`workflow-repository-parity.integration.test.ts:272-285`, *"reads every domain column the database has,
so none is silently unmapped"*, fails for any column that is not on the `INFRASTRUCTURE` list and not
in `historyColumns`. Its own comment records why it exists: three Phase 16C columns were invisible to
the application for a checkpoint and a half before this direction was closed.

### Every place that must change

| # | Layer | File | Change |
|---|---|---|---|
| 1 | domain vocabulary | `domain/workflow-vocabulary.ts:304-314` | add the value to `WORKFLOW_HISTORY_EVENTS` |
| 2 | domain model | `domain/history.ts` | a builder for the entry, and **`WorkflowHistoryState` gains the provenance fields** — it has none today |
| 3 | database | new migration | widen `workflow_history_event_check`; add four provenance columns; add `workflow_history_reminder_idx` |
| 4 | row type | `workflow-record-rows.ts:289-298` | `HistoryRow` gains four fields |
| 5 | read mapper | `:301-312` | `historyColumns` gains four names — **the string list, which nothing type-checks** |
| 6 | state mapper | `:314-326` | `historyState` maps them |
| 7 | write mapper | `:328-337` | `historyValues` writes them |
| 8 | repository | `record.repository.ts:112` | inherits `historyColumns`; no separate change expected |
| 9 | contract view | `contracts/views.ts:340-349` | **`WorkflowHistoryView` should gain the event value only, not the provenance** — see §15 |
| 10 | localization | `locales/en.json:235-245`, `ar.json` | `vocabulary.historyEvent.<value>` in **both** |
| 11 | Admin | `apps/admin/src/workflow/history.tsx` | **no change** — the table renders `<Term group="historyEvent" value={entry.event} />` and picks the new label up automatically |
| 12 | fixtures and parity suites | several | new value and columns reflected |

Step 5 is the weak link and deserves naming: `historyColumns` is a plain string array. Adding a field
to `HistoryRow` and `historyState` without adding it to `historyColumns` **compiles**, and the value
arrives `undefined` at runtime. The parity assertion in §14 is the only thing that catches it, which is
why it must run as part of the implementation checkpoint.

**None of the twelve is implemented.**

---

## 15. History rendering

**As things stand, the new event would render as a raw key.** `Term` falls back to the key itself,
and `apps/admin/src/workflow/notices.test.tsx:203-212` asserts exactly that behaviour, noting a
missing entry "renders as `workflow.vocabulary.historyEvent.step-escalated` in a screen".

So **localization entries are required in both `en.json` and `ar.json`** — and this is enforced, not
merely advisable: `pnpm standards` runs `check-localization`, which reports catalogue *completeness*
(currently "17 catalogue set(s) complete"), so an English entry without its Arabic counterpart fails
the gate.

**No additional display metadata is needed.** The table already renders occurred-on, event, ordinal,
actor and on-behalf-of, and needs no new column: the automatic entry shows its label with **both actor
cells empty**, which is the honest rendering — nobody acted — and is visibly different from
`step-escalated`, which always names an actor.

**Rendering exposes no execution identity, and must not start.** `WorkflowHistoryView`
(`contracts/views.ts:340-349`) publishes eight fields and no provenance, and the recommendation is that
it stay that way: the provenance is an audit fact for operators, not a field for an approvals screen,
and publishing it would put infrastructure identifiers in a tenant-facing payload for no reader's
benefit. If operators need it, that is a separate, narrower decision.

**Admin was not modified in this checkpoint.** The localization entries and the view decision are
recorded as implementation scope.

---

## 16. Security and tenancy

- **Tenant-scoped**: `workflow_history.tenant_id`, under `app_protect_table('workflow_history')`
  (ADR-0030 — RLS enabled *and* forced). The reminder row is no different from any other and gets no
  exemption.
- **A machine execution never becomes a reason to bypass RLS.** The tenant comes from the execution
  context, never from a job payload, request body or command field. Cross-tenant execution must fail
  safely.
- **Visible only to authorized tenant users** — the entry is read through the same history query and
  the same permission as every other entry. This adds no read path.
- **Never exposed**: machine credentials · bearer tokens · Platform authorization details · scheduler
  internals. Opaque identities only, and §15 keeps even those out of the published view.
- **Append-only stays append-only**, and RLS stays forced. Neither may be relaxed to make the
  idempotency claim convenient — the claim is designed to work *with* immutability, not around it.

**Test design required later, not written now**: same-tenant visibility · cross-tenant invisibility ·
cross-tenant execution refusal · the two-worker race of §10 · a stale execution producing no row. All
against real PostgreSQL, with real concurrent connections, and **no sleeps**.

---

## 17. Rejected event designs

Each judged on meaning, not on appearance in a list.

| Candidate | Verdict |
|---|---|
| `step-escalated` | **Reject.** Means a human added an approver (`escalation.ts:15-16`: *"It is a human's act"*). Borrowing it would make automatic and human escalation indistinguishable in the audit record, and would claim an approver was added when none was |
| **`step-reminded`** | **Proposed.** Two segments, `step-` subject, past participle — the existing convention. Claims no decision, no escalation, no expiry, no delivery, no state. Weakness: not lexically "automatic" — answered structurally in §A |
| `step-service-level-reminded` | **Runner-up, not rejected.** More precise about the cause; costs a three-segment first, and anticipates a generality the D-16E-05 amendment forbids |
| `sla-breached` | **Reject.** Asserts a *state* — the thing D-16E-05, D-16C-06 and ADR-0070 all refuse. The service level is derived and stays derived; this row records an action, not a condition. Also breaks the `<subject>-<participle>` convention |
| `sla-overdue` | **Reject.** Same state claim, and worse: "overdue" is a *continuing* condition while a history entry is a *moment* |
| `notification-sent` | **Reject.** Claims **delivery**, which Workflow does not do and cannot know — Phase 17 owns it. The event records intent |
| `automation-executed` | **Reject.** Infrastructure mechanics, not a business fact. Answers "which machinery ran", which §4 assigns to provenance |
| `job-executed` | **Reject.** Same, and worse — names the *job*, an infrastructure object Workflow must not model |
| `scheduler-fired` | **Reject.** Names a component this module must never contain (D-16E-03) |
| `system-action` | **Reject.** Says nothing about what happened to the workflow, and "system" is the fake-actor vocabulary every locked decision refuses |

---

## 18. Relationship to SLA

The event **creates no persisted SLA state**. The trigger stays exactly:

```text
instance.status = 'running'
AND step.status  = 'awaiting'
AND service_level_count IS NOT NULL
AND asAt > awaiting_at + count × unit_span
```

with strictly `>`, elapsed time only, no calendar. **Not added**: `breached_at` · `due_at` ·
`expired_at` · `overdue` · `sla_state`. The row is the record of the reminder **action**; it is not a
new SLA state model, and `serviceLevelState` remains the single answer to "is this overdue", computed
on every read.

## 19. Relationship to expiry

**No connection.** D-16E-06 remains amended: expiry stays derived and expiry execution is not
implemented. The reminder event must **not** be reused for expiry, and an SLA breach does **not** mean
expiry — a passed target is a target that passed, and nothing ends.

## 20. Relationship to escalation

**This is not escalation.** No approver is added, `escalateBranch` is not invoked, no second branch is
created, and none of quorum, denominator, threshold, `outstanding` or `unresolved` changes — the action
writes no step row at all, so **D-16D-08 is structurally unreachable from it**. Automatic escalation
remains declined as the first automatic action. Phase 16D's human escalation stands exactly as
implemented.

---

## 21. Decision output

### Proposed event

```text
PROPOSED — step-reminded
```

*(Runner-up offered, not recommended over it: `step-service-level-reminded`.)*

### Proposed meaning

An automatic service-level reminder intent was emitted for an awaiting step whose configured
elapsed-time service level had passed at the moment of execution. It records that Workflow acted, on
which step, and when. It does not mean the notification was delivered, seen or read; it does not
record a persisted overdue or breached state; it is not a decision, an escalation or an expiry; and no
workflow state changed because of it.

### Required fields

**Business fields — all already present, none added:** `event` · `instance_id` · `step_id` ·
`ordinal` · `occurred_at` · `actor_membership_id` (**null**) · `on_behalf_of_membership_id` (**null**).

**Execution provenance fields — four new columns, names deferred to G-2:** execution identity · job
identity · execution attempt · correlation identity. Tenant, instance and step are **not** duplicated —
`tenant_id`, `instance_id` and `step_id` already carry them.

### Required database changes — *not implemented*

| Table | Change |
|---|---|
| `workflow_history` | widen `workflow_history_event_check` to ten values |
| `workflow_history` | add four provenance columns, nullable, optionally with a check tying them to the automatic event |
| `workflow_history` | add `workflow_history_reminder_idx` — `unique (tenant_id, step_id) where event = '<value>' and deleted_at is null` |
| — | one migration, additive, no destructive change; RLS and the append-only trigger unchanged |

### Required Workflow changes — *not implemented*

`domain/workflow-vocabulary.ts` (the value) · `domain/history.ts` (an entry builder, and provenance
fields on `WorkflowHistoryState`, which has none) · `infrastructure/workflow-record-rows.ts`
(`HistoryRow`, `historyColumns`, `historyState`, `historyValues`) · a new application use case that
evaluates the predicate and writes the row in one `unitOfWork.execute` · `contracts/views.ts` (the
event value only — **not** the provenance) · fixtures and both parity suites.

### Required Identity changes — *not implemented*

One bounded query: membership identifier → the recipient identity `NotificationPort` requires. Uses
the existing `identity.membership.read`. **No new permission.** Blocked on **D-16E-12**.

### Required Platform dependencies — *not implemented*

**G-2** machine execution context — and note the third call site found here:
`packages/persistence/src/repository.ts:29-34` (`actorOf`), alongside `assertTenantScoped` and
`currentTenantId`. **G-1** machine authorization. **G-3** `JobPort` execution semantics — delivery,
attempt, retry, acknowledgement, safe duplicate delivery, cancellation.

### Required Admin / localization changes — *not implemented*

`vocabulary.historyEvent.<value>` in **both** `en.json` and `ar.json`, enforced by
`check-localization`. **No Admin code change** — the table picks the label up through `Term`.

### Concurrency proof plan

Two real connections, same tenant, same step, same due condition, concurrently. Exactly one history
row, exactly one intent, no duplicate, no state change; the loser takes `23505` and rolls back whole.
Plus: stale execution after the step is decided → no row; repeated delivery of the same job → one
effect; cross-tenant execution → refused. Real PostgreSQL, no sleeps.

### Security proof plan

Same-tenant visibility · cross-tenant invisibility under RLS · cross-tenant execution refusal · tenant
never taken from a payload · no credential in any recorded column · RLS enabled **and forced**, and the
append-only trigger still refusing update and delete.

### Remaining decisions

| Decision | Status |
|---|---|
| **The concrete history contract** — exact identifier, exact provenance column names and types, exact index predicate, exact migration | **OPEN — D-16E-13** |
| **The transaction-ordering trade-off** (§11) — duplicate reminder versus permanently lost reminder | **OPEN**, folded into D-16E-13 |
| **D-16E-12** — authorization to modify Identity for the recipient contract | **OPEN** |
| **G-2, G-1, G-3** — the Platform contracts | **absent**; not this repository's to write |

---

## Stop conditions reached

1. **The concrete history contract is not approved** — D-16E-11 approves the event's *existence*; the
   identifier, columns, index and migration are explicitly not approved.
2. **The provenance columns cannot be fixed** until G-2 defines what the machine execution context
   carries. §7's clause applies: do not modify the schema first.
3. **The Platform execution contract is absent** — G-2, G-1, G-3.
4. **The Identity recipient contract is absent** — D-16E-12 open.

No stop condition was worked around. No new permission is required. No locked decision is changed. No
generic framework is required. The action alters no Workflow state, no quorum, no tally and no
denominator, and needs no business-day semantics, no fake actor, no impersonation, no service
credential and no authorization bypass.

**No implementation was performed.**

**STOP — awaiting explicit owner approval of the concrete D-16E-11 history contract.**
