# Product Slice — Approvals as Work

**Date** 2026-08-24 · **Baseline** `6686999` + the Employee Record verification ·
**Status** **INVESTIGATION ONLY — NOT AUTHORIZED, NOT BUILT**

This document establishes the next product slice from repository evidence. **No production code was
written for it.** It is not a phase, it is not Phase 5.4, and it creates no numbered sequence.

---

## 1. What the investigation found first

The audit said `GET /workflow/approvals/pending` *"has no screen at all"*. **That was wrong**, and
the correction changes the slice's shape rather than its priority.

`apps/admin/src/workflow/approvals.tsx` already contains `PendingSection`, `DecidedSection` and
`ApprovalStatusSection`, all three consuming the real queues, all three rendered by `/workflow` —
which is a **single page carrying fourteen sections**: overview, definitions, versions, steps,
instances, instance steps, branches, awaiting, approval status, history, groups, group members,
pending, decided, provided and status notices.

So the queue is not missing. What is missing is that **approvals are not work**:

- the queue is the thirteenth section of an administration page, below workflow *configuration*;
- there is no destination whose subject is "what is waiting for me";
- there is **no instance detail route** — `/workflow` renders the *first* instance of the listing as
  an example, and there is no way to open the second;
- nothing anywhere says how many approvals are waiting;
- an approval cannot be answered from the product.

The audit's P1-1 remains the right next slice. Its scope is **promotion, not construction**.

---

## 2. The ten questions, answered from the repository

### 1. Can a signed-in caller's pending approvals be represented with existing contracts?

**Yes, completely.** `PendingApprovalView` is published and carries everything a queue row needs:

```text
stepId · instanceId · ordinal · subjectType · subjectId
definitionCode · startedOn · serviceLevel? · version
```

and `StepServiceLevelView` carries `count`, `unit`, `awaitingOn`, `dueOn`, `state`
(`none | within | overdue`) and `overdueByMinutes` — all **derived by the server against one reading
instant per page**, so a screen computes no age and reads no clock.

`WorkflowDecisionView` answers the decided half, keeping `decidedByMembershipId` and
`onBehalfOfMembershipId` as two fields that must never be collapsed.

**Whose queue it is, is not representable at all — and that is the control.** The query takes
`page` and `size` and nothing else; the caller comes from `currentMembership()` on the resolved
request. There is no parameter through which a screen could aim the queue at somebody else, and
`forbidNonWhitelisted` refuses an undeclared property rather than dropping it.

### 2. Which existing API routes are already sufficient?

All of them. **No new route is needed.**

| Route | Permission | Serves |
|---|---|---|
| `GET /workflow/approvals/pending` | `workflow.approval.read-own` | the queue |
| `GET /workflow/approvals/decided` | `workflow.approval.read-own` | what the caller answered |
| `GET /workflow/instances/:instanceId` | `workflow.instance.read` | instance, steps, decisions, awaiting, branch tallies |
| `GET /workflow/instances/:instanceId/history` | `workflow.instance.read` | the timeline |
| `GET /workflow/approvals/:instanceId/status` | `workflow.approval.read-own` | the same approval in `ApprovalPort`'s vocabulary |
| `GET /workflow/definitions` | `workflow.definition.read` | the definition a code belongs to |
| `POST /workflow/approvals/:instanceId/decision` | `workflow.approval.decide` | **out of scope — a write** |

### 3. What screens are needed?

Two, and one nav change.

| Screen | What it is |
|---|---|
| `/approvals` | The queue as the page's subject: what is waiting, oldest first, with its service level. Plus the caller's decided list |
| `/approvals/[instanceId]` | One approval: what it is about, where it stands, who has answered, the branch tally, the full timeline |

`/workflow` **stays** and keeps every configuration section; it loses only the two queue sections
that move. The navigation entry currently labelled "Approvals" points at `/workflow`; it should point
at `/approvals`, and `/workflow` should be labelled for what it is — workflow configuration.

### 4. Can the queue be read-only initially?

**Yes, and it must be.** Deciding is `POST /workflow/approvals/:instanceId/decision` behind
`workflow.approval.decide`, and no request can carry a principal in this deployment. A decide button
would post unauthenticated and answer 401 — a control that does not do what it appears to do, on the
one screen whose entire purpose is acting.

The detail screen should therefore **name the decision as an API capability**, exactly as every other
screen in this portal names its writes.

### 5. What should the queue show?

Per row, all published and none derived: the **definition code** (what kind of decision this is),
the **subject type and identifier** (what it is about), **when it started**, **which step** of the
chain, and — where the step carries a target — **how it stands against it**, as the server's own
word (`within` / `overdue`) with the overdue minutes it supplied.

Above the rows: the **server's total**, never the page length. A queue that reported `items.length`
would tell somebody with three hundred approvals they have fifty, and the module's own handler
comments say so.

### 6. What should the approval detail show?

`WorkflowInstanceDetailView` answers most of it in one read: the instance and its status, every
step with its approver kind, status, escalation marker, branch rule, quorum and conditions, every
decision with **both** identities kept apart, the branch tallies with `assigned`, `approvals`,
`rejections`, `outstanding`, `threshold`, `quorumMet` and `outcome`, and which steps are awaiting.
`GET /instances/:id/history` adds the timeline. `GET /approvals/:id/status` adds the same approval in
the port's five-state vocabulary, which is what a consuming module sees.

Three things the detail must **not** do, each because the module refuses to:
- call anybody a manager — Workflow resolves no reporting line and holds no idea of one;
- infer delegation by comparing identifiers — `authority` and `onBehalfOfMembershipId` are the API's
  own fields, and guessing at them is exactly the fact an auditor needs to be certain of;
- compute an age, a due date or a tally — all four are the server's, derived against its own instant.

### 7. What existing UI components should be reused?

Everything the Employee Record established, and nothing new:

`Page` · `PageHeader` · `Section` · `Stack` · `Grid` · `Surface` · `Table`/`THead`/`TBody`/`TR`/`TH`/`TD`
· `Badge` · `EmptyState` · and the record's own `Isolated`, `Status`, `Rows`, `Fact` helpers.

All server components. `Pagination` is a client component and is **not** needed for a first slice:
the queue is bounded and paged by the server, and a "showing N of M" line is honest without it.

The workflow module's catalogue already carries every vocabulary both screens need, in both
languages: `instanceStatus`, `stepStatus`, `decision`, `authority`, `approvalState`, `approverKind`,
`approverOrigin`, `historyEvent`, `branchRule`, `branchOutcome`, `conditionOperator`, `quorumMet`,
`serviceLevelUnit`, `serviceLevelState`. **No new module string is required.**

### 8. Does wiring `ApprovalPort` require a new owner decision?

**Yes — and it is out of scope for this slice.**

`workflowApprovalPortFor` is exported from `apps/api/src/workflow/workflow.composition.ts:108` and
**called from nowhere**. Composing it would make Leave, Payroll, Compensation and Attendance route
real approvals through Workflow instead of publishing chains from their own tables — a behavioural
change to four completed modules. Two things make it a decision rather than ordinary product code:

1. `WorkflowApprovals.request` **refuses** when a tenant has configured no active definition for a
   subject type. That is correct — the whole point of replacing `AutoApprovingPort` is that nothing
   approves on the product's behalf — but it means adopting the port turns a previously-working
   leave approval into a refusal until the tenant configures a workflow. Which modules adopt, and
   what a tenant must configure first, is the owner's call.
2. Recruitment is currently the single adopted module, by **write** through `RecruitmentDecisions`,
   and each further adoption needs its own `BusinessDecisionPort`.

**The slice does not need it.** Reading the queue and one approval is entirely independent of which
modules raise approvals.

### 9. Does displaying pending approvals require authentication to be available?

**For real rows, yes — and the distinction matters to the screen's design.**

The pipeline checks the permission **before** the handler runs
(`packages/kernel/src/cqrs/pipeline.ts:102`). In this deployment `PlatformPermissionChecker` holds an
empty set, so `workflow.approval.read-own` is not held and the request is **refused**, not answered
empty. The screen therefore renders its *withheld* state, not "you have no approvals".

That ordering is worth stating because the handler's own fallback is different: **with** the
permission but **without** a resolved membership, it returns an empty page rather than everybody's.
So the screen must distinguish three states, and the Employee Record already establishes the idiom:

| State | What it means | What the screen says |
|---|---|---|
| Refused | no permission, or nothing authenticated | withheld — the caller may not read this |
| Empty page | permission held, no membership resolved, or genuinely nothing waiting | nothing is waiting |
| Rows | a real queue | the queue |

Conflating the first two would tell an administrator their approvals are clear when nobody is
signed in.

### 10. What is the smallest useful vertical slice?

**Two read-only screens and one navigation change**, over routes that already exist.

---

## 3. Proposed user workflow

```text
Sign in  →  Approvals                    "seven waiting, two overdue"
              ↓  open one
            Approval detail              what it is about · where it stands ·
                                         who has answered · the branch tally ·
                                         the timeline
              ↓  (a later slice, gated on authentication)
            Decide                       approve or reject, with a comment
```

---

## 4. Exact slice scope

### In

1. **`/approvals`** — `PageHeader` with the server's total; the pending queue as a `Table`
   (definition code, subject, step, started, service-level `Badge`); the decided list beneath it;
   the three-state handling from §2.9; both languages, direction following language; `<bdi>` on every
   identifier, code and instant.
2. **`/approvals/[instanceId]`** — instance status; steps; decisions with both identities kept apart;
   branch tallies; awaiting steps; timeline; the approval in the port's vocabulary; the decision
   named as an API capability and offered as no control.
3. **Navigation** — `approvals` → `/approvals`; `/workflow` relabelled as workflow configuration and
   kept, minus the two sections that move.
4. **`loading.tsx` and `not-found.tsx`** for both routes.
5. **Tests** — refused ≠ empty ≠ populated; the server's total is used and never `items.length`; no
   parameter names a membership anywhere in the composed request; delegation shown from the API's
   own fields and never inferred; no control; both languages; every navigation destination still
   exists on disk.
6. **Documentation** — a slice record beside this document.

### Out

| Out of scope | Why |
|---|---|
| Deciding, cancelling, escalating — any write | Gated on the authentication decision in the audit's §19 |
| Wiring `ApprovalPort` | An owner decision per adopting module — §2.8 |
| Resolving `subjectId` to a human description | Requires asking the owning module per subject type; a real design question, and the first thing to revisit after this slice |
| Resolving a membership to a person's name | Identity publishes no bounded lookup for it; the same shape of gap the Employee Record recorded for organizational units |
| A notification badge in the shell | Needs a count on every page load for every screen; a separate decision about ambient cost |
| Approval analytics, cycle times, bottlenecks | Phase 20 by that phase's own specification |
| Expiry, automatic escalation, scheduled reminders | No `JobPort` adapter; execution is Platform's under D-16E-03 |

---

## 5. Dependencies

| Dependency | State | Effect |
|---|---|---|
| `PendingApprovalView`, `WorkflowDecisionView`, `WorkflowInstanceDetailView`, `WorkflowHistoryView`, `ApprovalStatusView`, `BranchTallyView`, `StepServiceLevelView` | **All published** | none |
| The six read routes in §2.2 | **All exist** | none |
| Workflow's bilingual catalogue | **Complete** | none |
| The design system | **Installed**, and the record proves the composition | none |
| Platform authentication | **Absent** | the queue renders withheld until it arrives — the same behaviour every screen has |
| `ApprovalPort` wiring | **Not composed** | only Recruitment raises approvals today, so the queue is thin in practice. It does not block the screens |

---

## 6. Unresolved decisions

**None blocks this slice.** Two exist nearby and are recorded so they are not discovered later:

1. **Which modules adopt `ApprovalPort`, and what a tenant must configure first** (§2.8) — the
   owner's, and needed before Leave or Payroll approvals appear in the queue at all.
2. **How an approval's subject is described to a human** — Workflow holds two opaque strings by
   design. Asking the owning module per subject type is a cross-module composition question worth
   its own investigation; until then the queue shows the type and the identifier, as Workflow does.

---

## 7. Definition of Ready

| Criterion | Status |
|---|---|
| Every read the slice needs exists and is published | **Yes** — §2.1, §2.2 |
| No new table, column, migration, permission, handler, port or event | **Yes** |
| No completed module changed | **Yes** — the slice is presentation only |
| No unresolved owner decision blocks it | **Yes** — §6 |
| Design-system components exist for every element | **Yes** — §2.7 |
| Both languages available with no new module string | **Yes** — §2.7 |
| Visual reference established | **Yes** — the Employee Record |
| Customer value | **High** — approvals are the spine of the benchmark product, and the engine is richer than the benchmark's and currently invisible as work |
| Demonstrability | **High** — it is the second destination that makes the product feel like one |

**Ready. Awaiting owner authorization to build.**
