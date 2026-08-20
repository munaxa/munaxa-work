# Phase 16C — Checkpoint 4 — Application

**Scope.** Workflow's application layer: the command that resolves a manager, the configuration that
accepts one, the reads that answer whether a step is overdue, one new port, and the tests for all of
it. No repository, no API route, no Admin screen, no migration, and no change to Identity,
Organization or any other completed module.

Everything below rests on decisions approved on 2026-08-16 and recorded in
[`phase-16c-plan.md`](./phase-16c-plan.md) §7A and §7B.

---

## 1. What was built

### 1.1 The manager approver

A `manager` step names **nobody**. Whose manager it means is the person who raised the approval, and
that is fixed rather than configured (P-1) — so there is no target field on the template, no second
identifier column, and nothing for an administrator to get wrong.

The resolution happens **once**, when an instance starts, in `application/instance-snapshot.ts`:

| Step | Where |
| --- | --- |
| Is a manager named by any template of this version? | `snapshotManager` — no template, no call |
| Ask the reporting line for the requester, as at the approval's UTC civil date | `ReportingLinePort.managerOf` |
| Turn the answer into one approver or one of four refusals | `domain/manager.ts` `resolveManager` |
| Copy the resolved membership onto the step | `domain/branch-plan.ts` `planSteps` |

From there the step is indistinguishable from one naming a person directly: `approver_kind` is
`membership`, the approver is a membership identifier, and nothing about the running approval consults
a reporting line again. A reorganization the day after an approval starts changes nothing about it —
the same sentence as 16B's approval-group rule, and deliberately not a second rule (D-16C-08).

**Two manager steps in one process ask one question.** Asserted on the call log rather than on the
answers, because "how many times did this module ask another module something" is exactly what a
mocked answer hides.

**The date is UTC and it is the approval's own start.** `resolutionDateOf` is the single conversion
(P-6). An approval raised at `2026-02-28T23:30Z` resolves against the 28th everywhere, rather than
finding one manager in Riyadh and another in Los Angeles.

### 1.2 The service-level target

A target is configured on a step template as a whole count and a unit — hours or days — and copied
onto the step when an instance starts, exactly as `branch_rule`, `quorum` and `condition` are. Editing
the template afterwards never moves a due time on a step somebody is already waiting to answer.

**The clock starts when *that step* becomes `awaiting`** (P-5), not when the approval started. A
sequential chain's third step starts when the second is answered; every step of a parallel branch
starts together when the branch opens. The instant is stamped once, in the domain, from the `at`
already flowing through `startInstance` and `decide` — nothing calls `new Date()` or `Date.now()`.
Nothing restarts a running clock: not a sibling's decision, not a delegation, not anything.

**Nothing is stored beyond the three authoritative inputs** (`service_level_count`,
`service_level_unit`, `awaiting_at`). Due, state and overdue-by-minutes are derived at read time from
those, plus an explicit reading instant supplied by the `Clock` port. There is no `due_at` column, no
`expired` state, no scheduler, no timer and no job.

### 1.3 The published contract

Two new views, both derived and neither carrying a version or an identifier of its own:

- `ServiceLevelTargetView` — `count`, `unit`. What was configured, on `WorkflowStepTemplateView`.
- `StepServiceLevelView` — `count`, `unit`, `awaitingOn`, `dueOn`, `state`, `overdueByMinutes`. How a
  running step stands, on `WorkflowStepView` and on `PendingApprovalView`. Every instant is an ISO
  string; `overdueByMinutes` is a truncated whole number; `state` is `none | within | overdue`, and
  `expired` is not among them.

No Prisma type crosses the boundary. No aggregate, no dashboard, no ranking and no tenant-wide overdue
count exists anywhere.

### 1.4 The port

`application/workflow-reporting-line.ts` — one interface, one method:

```ts
managerOf(requesterMembershipId: string, asOfDate: string): Promise<ManagerResolution>
```

`ManagerResolution` is the **domain's own type**, so an adapter cannot invent a fifth outcome and this
file cannot drift from the rule. The port cannot be asked "who holds role X", "who reports to me" or
"everybody in this department" — which is what keeps the manager approver from being the first
implementation of the role engine `PlatformPermissionChecker` says this product will never build.

**No adapter exists, deliberately.** The Identity query behind it is Checkpoint 6's — a completed
module's contract, built and verified on its own side before Workflow depends on it — and the adapter
is Checkpoint 7's.

---

## 2. The refusals

Four, and no fifth was invented. Each is a different person's mistake to fix, which is why they are
four rather than one.

| Outcome | Refusal | Whose mistake |
| --- | --- | --- |
| No primary active employment | `manager-no-primary-employment` | an administrator's |
| No manager on the primary reporting line | `manager-not-assigned` | the organization's |
| Manager's employment has no active membership | `manager-not-a-member` | Identity's |
| The resolved manager is the requester | `manager-is-the-requester` | the process designer's |

All four **fail the whole start**: no instance, no steps, no history. Asserted directly — a process
whose first step was perfectly resolvable and whose second named an unresolvable manager leaves
nothing behind at all, and the first approver's queue stays empty. Skipping the step is the one
outcome that must never happen, because an approval that quietly drops a stage completes while looking
like a process.

A fifth reason, `manager-not-resolved`, is **not new** — it was built in Checkpoint 2 for a caller
that plans a manager step without reading the chain. It is what an unwired composition gets (§4).

---

## 3. Files

**New (4)**

| File | Lines | What |
| --- | --- | --- |
| `application/workflow-reporting-line.ts` | 45 | the port |
| `application/instance-snapshot.ts` | 105 | both start-time snapshots, split from the use case at the budget |
| `application/workflow-manager.test.ts` | 267 | 12 tests |
| `application/workflow-sla.test.ts` | 366 | 16 tests |

**Changed (12)** — `application/`: `instance.use-case.ts`, `step.use-case.ts`,
`workflow-dependencies.ts`, `workflow-views.ts`, `workflow-queries.ts`, `approval-queries.ts`,
`workflow-scenarios.ts`, `workflow-test-harness.ts`, `workflow-boundaries.test.ts`. `contracts/`:
`views.ts`. `domain/`: `instance.ts`, `decision.ts`.

**Also changed, in `apps/api`** — `workflow.audit.spec.ts` (§5) and a new
`workflow-audit.fixture.ts`, extracted from it at the 400-line budget. Both are test scaffolding; no
controller, route or DTO was touched.

### 3.1 The domain change, and why it is here

Checkpoint 2 put `serviceLevel` on `WorkflowStepTemplateState` and Checkpoint 3 added
`service_level_count`, `service_level_unit` and `awaiting_at` to `workflow_step` — but
`WorkflowStepState` never gained the three fields, and nothing stamped the instant. That is a
Checkpoint 2 omission, and it is closed here rather than worked around, because the alternative was to
stamp the instant in the application layer where `startInstance` and `decide` already have it and the
domain does not. Three additions, no new rule:

- `WorkflowStepState.serviceLevel?`, `WorkflowStepState.awaitingAt?`
- `StartInstanceRequest.manager?`, passed straight to `planSteps`
- `awaitingAt` stamped on a step that becomes `awaiting` — in `startInstance` and in
  `decision.ts`'s `approvedOutcome`, both from the instant already in hand

---

## 4. One deviation, stated rather than buried

**`WorkflowDependencies.reportingLine` is optional.** Every other field on that interface is required,
and the composition doc has said so as a safety property since 16A.

*Why.* `apps/api/src/workflow/workflow.composition.ts` builds the module. A required field would force
that file to supply something, and the only two things it could supply are the Checkpoint 7 adapter
(out of scope, and out of order — Identity's own query does not exist yet) or a stub answering "no
manager", which would be Workflow inventing an organizational fact and blaming a tenant for it.

*What it costs, and what it does not.* An unwired composition refuses a manager step with
`manager-not-resolved` — an existing refusal, fail-closed, never a skipped step. A process naming no
manager is entirely unaffected, which is every process configured before this phase. The composition
file was **not** modified.

*How it is contained.* The application boundary suite pins the dependency list at exactly seven names
including `reportingLine`, so an eighth cannot arrive unnoticed; the field's own comment states that
it becomes required at Checkpoint 7; and `workflow-manager.test.ts` exercises the unwired composition
against the real `workflowModule` rather than arguing about it in prose.

---

## 5. Boundaries moved, in both directions

Three suites asserted that a manager resolution and a due date did not exist. Each was rewritten
rather than deleted, and each gained a **complement** so that a name leaving a forbidden list can
never pass for a capability quietly abandoned.

| Suite | Left the deferred list | Asserted present instead | Still forbidden |
| --- | --- | --- | --- |
| `application/workflow-boundaries.test.ts` | `dueAt`, `managerOf` | `dueAt`, `managerOf`, `serviceLevelState`, `resolutionDateOf` | `escalat`, `breach`, `businessDay`, `workingDay`, `roleId`, `reportsTo`, `notify`, `setTimeout`, `setInterval`, `cron`, `expiresAt`, `slaHours` |
| `apps/api/workflow.audit.spec.ts` | `managerOf`, `reportingLine`, `slaDue` → `slaHours` | six symbols pinned to four named files | everything above, plus `JobPort`, `NotificationPort`, `outbox`, `enqueue`, `publishToBroker`, `externalApprover`, `roleDirectory` |
| `application/workflow-boundaries.test.ts` (dependencies) | — | `reportingLine` in a seven-name list | `job`, `notification`, `storage`, `search`, `directory`, `outbox` |

`directory` remains a forbidden substring and `reportingLine` does not contain it — asserted rather
than merely argued, with the distinction written out beside it: a directory answers questions *about*
people; this port answers one question about one person on one day.

**No handler name changed.** There is no manager command, no manager query, no SLA query and no
overdue endpoint. The registration assertion still forbids `manager`, `sla`, `team`, `role`,
`escalat`, `schedule`, `expire`, `notify`, `analytic` and `external` in every registered name, and
still pins the count at 22. The queue and the instance detail gained a derived field; nothing gained a
route.

---

## 6. Tests

| Suite | Tests | Subject |
| --- | --- | --- |
| `workflow-manager.test.ts` | 12 | asked once · asked for the requester · asked on the UTC date · not asked at all when no manager is named · the resolved person on the step as an ordinary membership · two manager steps, one question · the manager decides normally · four refusals · nothing written on refusal · unwired composition fails closed · unwired composition unaffected otherwise |
| `workflow-sla.test.ts` | 16 | configured target published as typed · absent where unconfigured · five invalid targets refused · first step's clock at the approval's start · a later step's clock when *it* opens · a branch's steps start together · an instant already set never moves · boundary is `within` · truncated whole minutes · two readings, two answers, no write between · overdue changes nothing about instance, tally or timeline · an overdue step stays on its queue |

**Module totals.** Workflow 625 tests, 623 passing. `apps/api` 615 passing. `apps/admin` 224 passing.
Nothing skipped, nothing `.only`, no `eslint-disable`, no `any`, and no assertion weakened to pass.

### 6.1 Two tests left red, named

`workflow-branch-persistence.integration.test.ts` and `workflow-persistence.integration.test.ts` each
fail one round-trip assertion, for **one** cause: the domain now stamps `awaitingAt` on an awaiting
step and carries `serviceLevel` on it, Checkpoint 3 added all three columns to `workflow_step`, and
the **mapper** that would round-trip them is a PostgreSQL repository — Checkpoint 5's, and out of this
checkpoint's scope.

They were left failing rather than narrowed to the columns that survive, because these assertions are
the only thing that will refuse a Checkpoint 5 which forgets one of the three. Both carry a comment
naming the cause and the checkpoint that closes it. Phase 16B's Checkpoint 2 left exactly one test red
for the same reason and its Checkpoint 3 turned it green.

---

## 7. Not built, and still not

No scheduler, worker, cron, timer or `JobPort` adapter. No notification, outbox or broker. No
automatic expiry and no automatic escalation — an escalation remains an application-level command
nobody has asked for yet. No business-day calculation and no calendar dependency: a two-day target
elapses across a weekend, which is a stated limit rather than a defect. No role routing, no external
approvers, no analytics, no self-service portal. No `/workflow/me`, no `/workflow/my-team`, no manager
queue and no SLA dashboard. No new permission — the manager is resolved inside `start-instance` under
`instance.start`, and the target is read under permissions that already existed. Nothing of Phase 16D.

---

## 8. Gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | 47/47 |
| `pnpm lint` | 47/47, no errors, no warnings |
| `pnpm standards` | no violations · 176 models · 17 catalogues complete · 1,689 files, no cycles |
| `pnpm test` (Workflow) | 623 passed, 2 failed — §6.1 |
| `pnpm test` (`apps/api`, `apps/admin`) | 615 and 224 passed |

---

**Phase 16C Checkpoint 4 is complete. Checkpoint 5 has not started.**
