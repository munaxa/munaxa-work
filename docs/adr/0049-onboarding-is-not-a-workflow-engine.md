# ADR-0049 — Onboarding is a checklist with one predecessor per task, not a workflow engine

**Status** Accepted · **Date** 2026-08-10 · **Author** Phase 7 · **Approval** Approved before implementation (D-6)

## Context

An onboarding is a list of things that have to happen, some of which depend on others, some of which
need somebody's approval, and some of which should notify a person. Every one of those is a step
towards a workflow engine, and Workflow is Phase 16.

The kernel declares `ApprovalPort` and `NotificationPort` (ADR-0024), and **neither is wired into
`apps/api`**. `DocumentPort` is declared and has no implementation anywhere in this repository.

The pressure is to fill the gaps: a dependency graph so a plan can express a real process, an
auto-approving `ApprovalPort` adapter so `approval` tasks work, a notification stub so a joiner is
told what to do. Each is a small change that makes a demonstration work and a production claim false.

## Decision

**A task waits for at most one other task, named by code.** `depends_on_template_code` on a template
and `depends_on_task_id` on a task. Not a graph, not a set, not a condition. A template cannot depend
on itself, and the database says so with a check constraint. Completing or waiving a task unblocks
what waited on it, in the same transaction.

**Five task kinds, closed.** `checklist`, `acknowledgement`, `document`, `approval`, `external`. A
sixth is a schema change rather than a configuration change, deliberately — "add a kind" is how a
checklist becomes a workflow engine one release at a time.

**An `approval` task records a decision made by a named human, here, today.** There is no
`ApprovalPort` in this module's dependencies. `onboarding_task.approval_reference` exists, is `null`,
and is reserved: when Phase 16 routes an approval, it writes the reference and the task's shape does
not change. This is the same treatment `recruitment_requisition.approval_id` received (ADR-0045).

**There is no `NotificationPort` in this module's dependencies, and no notification is sent.**
Onboarding raises domain events; Communications (Phase 17) subscribes when it can address a
recipient. The contract addresses a workforce user, and a joiner in their preboarding week may not
have one yet — the same limitation Recruitment documented for candidates.

**There is no `DocumentPort` in this module's dependencies, and no bytes are stored.** A `document`
task records a *reference* whose shape is validated, and names the document type it wants. No
endpoint in this module accepts a file.

## Reason

**One predecessor covers the real cases and cannot become a process language.** "Issue the laptop
after the contract is signed" is one predecessor. What a graph buys beyond that is branching and
joining, which is a workflow engine — and a workflow engine that lives in one business module is one
every later module will need and none will be able to reuse.

**A stub that succeeds is worse than a gap that is documented.** An auto-approving adapter makes an
`approval` task complete with nobody's name on it, and the record then asserts that somebody approved
something. A notification stub that logs makes a screen say "the joiner has been told" when nobody
has. Both are the specific kind of false completeness this product refuses.

**Reserving the column now costs nothing and saves a migration on live data later.** Phase 16 fills
`approval_reference` in; no task changes shape and no instance is rewritten.

## Consequences

- A plan cannot express "either A or B", conditional steps, or parallel branches that rejoin. A
  customer needing that waits for Phase 16, and the module guide says so.
- `approval`-kind tasks are completed by the person with the authority, and the record names them.
  That is a real approval; it is simply not a routed one.
- Document upload is **NOT VERIFIED** in the Phase 7 report, with the reason stated: no `DocumentPort`
  adapter exists or is wired in this repository.
- Notification delivery is **NOT VERIFIED** in the Phase 7 report, for the same kind of reason.
- Onboarding's events are internal to this repository. They are not published in the module's
  contracts, because there is no cross-module event contract yet and inventing one for a single
  consumer is the thing Phase 16/17 exist to do properly.

## Alternatives considered

**A dependency graph with cycle detection.** Rejected: the detection is the easy half. What follows
is partial ordering, unreachable-task detection and a rule for what happens when a predecessor is
waived — which is a process engine's semantics, arrived at without deciding to build one.

**Wire an `ApprovalPort` adapter that requires a named approver.** Rejected as the same behaviour the
`approval` task kind already has, plus an indirection that would need rewriting when Phase 16
supplies the real routing.
