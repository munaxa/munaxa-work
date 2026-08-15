# Workflow

**Workflow records the approval processes a tenant configures, raises an approval about a record
another module owns, asks one named person at a time to decide it, and writes down who answered, on
whose authority, and when — and it owns no business data.**

Phase 16A. Seven tables. Package `@work/workflow`.

An approval is *about* a subject, and the subject is two opaque strings — `recruitment.requisition`
and an identifier — that this module never interprets. There is no foreign key out of the module, no
import of another module's package, and no shape in which Workflow could learn what a requisition is.
There is **no `numeric`, no `real`, no `double precision`, no `bigint`, no `money` and no `date`
column anywhere in the schema**: every number is a small whole one somebody chose or the server
counted, and every moment is an instant, because a request, a decision and a step becoming current
are moments rather than days.

---

## What it owns

Workflow definitions and their versions; the step templates on a version, in ordinal order; the
running instances raised against a published version; the steps copied onto an instance when it
starts; the decision recorded against a step; and the timeline of routing events for an instance.

## What it does not own, and why

| Absent | Where it belongs | Why |
| --- | --- | --- |
| What the record being approved *is* | The owning business module | AD-001. A subject type and identifier are stored and interpreted by nobody here. Workflow has no Recruitment contract, no Recruitment import and no Recruitment route |
| Whether a delegation is in force | Identity | Identity owns the delegation register. Workflow asks `identity.active-delegations-for` **at the instant of the decision** and keeps no expiry state of its own |
| A person's name, or which employment they hold | People, Employment | A step names a **membership**. Resolving one to a human being is Identity's read behind Identity's permission, and this screen and this module have asked for neither |
| Roles and groups | Platform, if it ever publishes them | D-3. There is no role directory and no group directory in this product. A step names a membership because that is the only thing that can be resolved |
| A reporting line, or "my team" | Nowhere in this repository | D-14. Resolving a manager needs the caller's *employment*, and no principal resolves to one (ADR-0032). A caller-supplied manager identifier is a filter, never a credential |
| A due time, an age, an overdue flag | Nowhere — Phase 16B | D-12. No column and no field. Publishing an instant is not measuring one |
| Anything on a schedule | A scheduler that does not exist | `JobPort` has no adapter in this repository. Nothing escalates, nothing expires, nothing is swept |
| Notification delivery | A transport that does not exist | Workflow composes no notification port at all. Nobody is told they have been asked |
| A tally — majority, unanimous, quorum, first-response | Nowhere — Phase 16B | Every chain is sequential and one named member answers each step |
| Conditional routing | Nowhere — Phase 16B | `context` is stored for audit and **read by nothing**: with no branching there are no routing rules to read it |
| Approval analytics | Nowhere | No rate, average, bottleneck or compliance figure is calculated in the module, the API or the screen |

---

## The four decisions that carry the module

### The queue is the caller's own membership, and no identifier is accepted

This is the first `read-own` in this repository that is **routed and enforced**. Eight modules
declare one and route it nowhere, because a career plan or a payslip is about an *employment* and no
principal resolves to one. An approval is addressed to a **membership** — this person, in this tenant
— and a membership is exactly what the request resolved before any handler ran.

So `workflow.pending-approvals` takes no parameter naming whose queue to read. Not a filter that
defaults to the caller: **no field at all**. A `?membershipId=` would be an IDOR wearing a
permission's name, and this module's queue is the list of what named directors are being asked to
decide this week. A caller the request resolved no membership for gets an empty page rather than
everybody's, because "we do not know which member you are" has exactly one safe answer.

### A decision records two people, and they never collapse into one

`decidedByMembershipId` is who acted. `onBehalfOfMembershipId` is whose authority they used, present
only under delegation. *Who approved this* and *whose authority was it* are different questions a
year later, and a single column answers only one of them.

Nobody is impersonated: a delegated decision records the **delegate** as the actor and never writes
the delegator's name into the actor column. The database enforces the pair —
`workflow_decision_delegation_check` makes `authority = 'delegated'` exactly equivalent to naming an
approver, and `workflow_decision_self_delegation_check` refuses a row where the two are the same
person.

### The decision reaches the adopting module before Workflow writes anything

`PostgresUnitOfWork.execute` takes a fresh pooled connection and opens its own transaction on every
call, so two modules' writes **cannot** share one. There is no distributed transaction, no outbox, no
broker, no worker and no scheduler, and none is claimed.

What exists instead is an ordering: **Recruitment is asked first**. A refusal therefore leaves
Workflow with nothing written — no decision, no history, and the step still awaiting. The reverse
window (Recruitment committed, Workflow's commit failed) is closed by **reconciling on the approval
identifier** when the decision is retried. Only a repeat of the same approval with the same outcome
converges; an opposite outcome, a different approval and a decision taken directly in Recruitment all
keep their own meaning and are refused with the reason that is true.

### A decision and a timeline entry cannot be rewritten

`workflow_decision` and `workflow_history` are append-only at the table — two triggers refuse update
and delete, including an update that changes nothing — and the repositories offer no mutation method
to call. A correction is a new row recorded beside the old one.

The timeline records **routing** and nothing else: who was asked, who answered, on whose authority,
when. It carries no comment, because a rejection comment is one person's written opinion of another's
request and it belongs on the decision, where a permission decides who may read it.

---

## Boundaries

Workflow consumes three published contracts under three bounded service grants, and nothing else.

| Module | Contract | Grant |
| --- | --- | --- |
| Identity | `identity.active-delegations-for` | `identity.delegation.read` |
| Recruitment | `recruitment.read-requisition` | `recruitment.requisition.read` |
| Recruitment | `recruitment.decide-requisition` | `recruitment.requisition.approve` |

No wildcard, no prefix grant, nothing more. Every cross-module act is a dispatched command or query
through that module's own handler, under that module's own permission and row-level security;
Workflow cannot write into another module's database.

**The capability split is a type rather than a convention.** `workflowModuleFor` takes a
`reader: Asking` (which can only `ask`) and a `writer: Sending` (which can also `send`). The
delegation adapter is constructed from the reader, so an adapter that only reads Identity has no
`send` to reach for.

**Recruitment is the single adopted business module**, and its only change is the approved seam: its
`decide` command accepts an optional `approvalId`, records it, and refuses when a different approval
already routed the record. `approvalId` is the Workflow instance identifier — there is no second
approval identifier anywhere.

**The kernel's `ApprovalPort` is unchanged.** Workflow *implements* it inbound (`request`, `status`,
`cancel`), published and unwired: the capability exists, nothing consumes it yet, and pretending
otherwise in either direction would be dishonest.

---

## Published contracts

Views only. No handler, no store, no dependency type and no aggregate leaves the module: a consumer
that could reach a handler could bypass this module's permission checks, and one that could reach a
store could bypass its tenancy.

`WorkflowDefinitionView`, `WorkflowVersionView`, `WorkflowStepTemplateView`,
`WorkflowDefinitionDetailView`, `WorkflowInstanceView`, `WorkflowStepView`, `WorkflowDecisionView`,
`WorkflowInstanceDetailView`, `WorkflowHistoryView`, `PendingApprovalView`, `ApprovalStepView`,
`ApprovalStatusView`, plus the closed vocabularies themselves so a consumer narrowing an untyped
string need not keep its own copy of the list.

---

## Permissions, and the separations that matter

Seven, one per handler and enforced by the pipeline rather than inside any handler.

| Permission | Covers |
| --- | --- |
| `workflow.definition.manage` | Creating a definition, drafting a version, adding a step, publishing, archiving, retiring |
| `workflow.definition.read` | Reading definitions and versions |
| `workflow.instance.start` | Raising an approval |
| `workflow.instance.cancel` | Stopping one nobody decided |
| `workflow.instance.read` | Reading approvals, timelines and approval status |
| `workflow.approval.decide` | Answering a step |
| `workflow.approval.read-own` | The caller's own two queues |

**`instance.start` does not imply `instance.cancel`**: the person who raised a request is not thereby
the person who may end somebody else's without a decision. **`approval.read-own` does not imply
`approval.decide`**: seeing your queue is not answering from it.

---

## `NOT VERIFIED`

SLA · business days · escalation · scheduling · approval expiry · automatic delegation expiry ·
parallel approval · majority · unanimous · quorum · first-response · conditional branching · roles ·
groups · manager routing · external approvers · notification delivery · analytics · asynchronous
callbacks · outbox · broker · self-service.

Twenty-two capabilities, each with a stated reason, none with a placeholder, a disabled control or a
"coming soon" anywhere in the product. The Admin screen states them as sentences rather than leaving
an empty table to imply the feature failed.

**`expired` is declared in the `ApprovalPort` vocabulary and this implementation never produces it.**
The mapping is total so a reader can see the gap rather than infer it; the gap is not an operational
state, and no screen offers a legend in which the word could appear.

---

## Measured

`TEST_DATABASE_URL=... pnpm measure:workflow` — production repositories, real PostgreSQL, an
unprivileged role with row-level security enabled and forced, a second tenant at equal volume holding
the same membership and subject identifiers, `vacuum analyze` after seeding.

Eighteen workloads at 500, 10,000 and 100,000 approvals per tenant against the budgets inherited
unchanged from Phases 13–15: **54 measurements, no misses**. The approval queue — the screen
everybody opens — is flat at 1.6 ms, 1.7 ms and 3.9 ms as the data grows two hundred fold, served by
a partial index over awaiting steps whose count is an index-only scan with no heap fetches.

Full results, query plans, the concurrency matrix and the debt register are in
[`../verification/phase-16a-final-report.md`](../verification/phase-16a-final-report.md).
