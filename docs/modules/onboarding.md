# `onboarding` — the process that carries a new employment to a first working day

**Phase 7.** Owns onboarding plans and their immutable versions, onboarding instances, the tasks
generated for one, their owners, due dates, completion and waiver, the history of every movement, and
the reconciliation that guarantees a joiner has an induction at all.

Owns no identity (`people`), no employment (`employment`), no structure (`organization`), no hiring
(`recruitment`), no documents, no messaging and no approvals routing.

## The distinction the whole module rests on

```text
Recruitment ── hire ──► Person + Employment          (created there, never here)
                              │
                              └── start command ──► Onboarding ──► Tasks
                                        ▲
                          reconciliation │ (the guarantee)
```

An **Onboarding** is a *process* attached to an employment that already exists. It carries no
employment fact — no status, no unit, no position, no manager, no employee number — because each of
those belongs to Employment or Organization and is read as at a date
([ADR-0047](../adr/0047-onboarding-owns-no-employment-fact.md)). Completing an onboarding does not
make anybody an employee; cancelling one ends no employment.

A **Plan** is what a customer names and retires. It holds no tasks. Its **versions** do, and a
published version never changes ([ADR-0048](../adr/0048-plan-versions-are-immutable.md)).

## Tables

| Table | Holds |
| ----- | ----- |
| `onboarding_plan` | The identity of a reusable definition: code, name, status |
| `onboarding_plan_version` | One version of it, and who published it |
| `onboarding_task_template` | What a version asks for, before anybody exists to do it |
| `onboarding_instance` | One onboarding for one employment: which version, where it got to, how it ended |
| `onboarding_task` | A task on a running onboarding: owner, due date, status, how it concluded |
| `onboarding_task_event` | Every movement of a task, appended and never amended |

All six are tenant-first, audited, versioned, soft-deleted and under row-level security applied by the
migration that creates them (ADR-0030). `onboarding_instance.employment_id` and `person_id` carry
foreign keys that cross a module's tables, and both point *backward*, to modules Onboarding already
depends on — the rule ADR-0042 states, not a different one. Their existence is what makes it
impossible for this module to invent an employment.

## The property this module is built around

**An onboarding is started by an idempotent command and guaranteed by reconciliation, never by an
event** ([ADR-0050](../adr/0050-onboarding-starts-by-command-not-by-event.md)).

Event delivery in this repository is **post-commit, in-process, at-most-once, with no outbox**. A hire
event can be lost. So:

- `POST /api/v1/onboarding/onboardings` is safe to retry. A repeat returns the onboarding that exists
  with `alreadyExisted: true`, not a `409` and not a second instance.
- The boundary is a **partial unique index** on `(tenant_id, employment_id)` over the live states, so
  two concurrent requests converge on one row rather than racing to two. A terminal onboarding leaves
  the index, so a rehire can be onboarded again.
- `GET /api/v1/onboarding/reconciliation` names the employments that have none;
  `POST /api/v1/onboarding/reconciliation` starts one for each by **sending the same command** an
  administrator would. Tenant-scoped, bounded, deterministic and safe to rerun.

An event may be an **accelerator**, never a guarantee. Event received ≠ onboarding guarantee; event
not received ≠ onboarding failure.

Phase 7 introduces **no job infrastructure**. Something has to call the reconciliation endpoint — an
operator, or a deployment's own scheduler.

## Decisions a reviewer should challenge

**An HR administrator does not hold Employment's or People's permissions.** Onboarding reaches both
through their published application services, under a **bounded service grant**: the module holds the
narrow cross-domain read for the duration of one operation, the user is still checked for the
onboarding operation they asked for, the permitted list is explicit, grants cannot nest, and every use
is logged. [ADR-0043](../adr/0043-bounded-service-grant.md). Neither adapter has a `create`.

**A published plan version is immutable, and an instance copies its tasks.** Both, because either
alone leaves history rewritable. Improving a checklist drafts the next version; publishing it
supersedes the previous one and leaves it readable.
[ADR-0048](../adr/0048-plan-versions-are-immutable.md).

**A task waits for at most one other task.** Not a graph. Five task kinds, closed — a sixth is a schema
change rather than a configuration change, because "add a kind" is how a checklist becomes a workflow
engine one release at a time. [ADR-0049](../adr/0049-onboarding-is-not-a-workflow-engine.md).

**Overdue is not a column.** It is `due_on < today and the task has not concluded`, computed by the
query that asks. A stored flag needs a sweeper and is wrong between sweeps — which is worse than not
having it, because a screen would show it with confidence.

**Waiving is not completing, and each is its own permission.** "We did it" and "it did not apply to
this person" are different answers, and the second is the one an auditor asks about. A waiver
satisfies a requirement; a cancellation does not.

**Nothing is shipped.** This product seeds no plan, no task and no code. A tenant that has configured
none gets an onboarding with no tasks and a screen that says so — which is honest. Shipping a default
checklist would be this product deciding how a customer inducts people, and in several of this
product's markets part of that answer is statutory and belongs to a country pack (00B).

**Due dates are calendar days, in UTC.** Not working days: which week-end a tenant keeps is country
data a country pack owns, and Organization publishes no calendar read for this module to ask. Recorded
as a limitation rather than approximated.

## Statuses and codes

The **state** sets — an onboarding's five, a task's six, a plan's three, a version's three — are closed
and checked in the database, because product behaviour branches on them.

Everything else is a **code**: a plan code, a role queue, a cancellation reason, a waiver reason, a
document type. Codes are tenant or country-pack data, validated by shape and never against a list this
product ships (00B).

## What Onboarding does not do

**No documents.** A `document` task records a *reference* and names the type of document it wants. No
endpoint accepts bytes, and no `DocumentPort` adapter exists or is wired anywhere in this repository.
Document upload is **NOT VERIFIED**, and the completion report says so rather than implying it works.

**No notifications.** The kernel's contract addresses a workforce user, and a joiner in their
preboarding week may not have one yet. Onboarding raises domain events; Communications (Phase 17)
subscribes when it can address a recipient. Notification delivery is **NOT VERIFIED**.

**No approvals routing.** An `approval`-kind task records a decision by a named human, here.
`approval_reference` is reserved for Phase 16 and is null today, exactly as
`recruitment_requisition.approval_id` is (ADR-0045).

**No self-service screens.** `onboarding.read-my-tasks` and `onboarding.complete-own-task` are
published contracts for Phase 18 and are deliberately **not routed**: both need the caller's own
employment, and this product has no edge that resolves an authenticated member to one. Mounting them
now would mean taking the employment from the request, which is precisely how somebody closes another
person's task.

**No offboarding, no probation, no compensation, no learning.** A probation period is an employment
term, a first-week training plan is Learning's, and none of them is a checklist item this module
invents.
