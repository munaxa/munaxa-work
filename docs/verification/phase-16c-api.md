# Phase 16C — Checkpoint 8 — API

**Scope.** Transport only: the wire shapes Workflow accepts for a manager step and a service-level
target, and the tests proving what a running approval makes of them. No domain change, no
application behaviour change, no repository, no migration, no Admin, no completed-module change.

Migrations unchanged at 23.

---

## 1. What the API actually had to add

Almost nothing, and that is the finding worth leading with.

**Every 16C read was already on the wire.** `WorkflowStepTemplateView.serviceLevel`,
`WorkflowStepView.serviceLevel` and `PendingApprovalView.serviceLevel` were added to the *published
contracts* in Checkpoint 4, and Workflow's controllers return application views untouched through
`unwrapOrThrow`. So `read-definition`, `read-instance` and `pending-approvals` began serving the
service-level target, the awaiting instant, the due instant, the state and the overdue minutes the
moment Checkpoint 4 landed. No controller, no mapper and no DTO was needed for any of it, and none
was written.

**One write shape changed**: `AddStepBody`. Everything else in this checkpoint is tests.

| Change | File |
| --- | --- |
| `routeToRequestersManager?: boolean` | `api/workflow.dto.ts` |
| `serviceLevel?: ServiceLevelBody` (`count`, `unit`) | `api/workflow.dto.ts` |
| Map the boolean to `approverKind: 'manager'`; pass the target through | `api/version.controller.ts` |

---

## 2. Routes

**Unchanged: 22 routes, 12 commands, 10 queries.** No route was added, removed, renamed or
re-pathed, and the route-reconciliation suite passes untouched — every route still maps to exactly
one registered handler, no handler is reachable twice, and there is no generic execute endpoint.

None of the forbidden endpoints exists: no `/workflow/me`, `/workflow/my-manager`,
`/workflow/managers`, `/workflow/sla`, `/workflow/escalations`, `/workflow/expiry`,
`/workflow/routing` or `/workflow/analytics`. Manager routing and service levels reached the wire
through the surfaces that already existed — a step body on the way in, and the instance, definition
and queue views on the way out.

---

## 3. DTOs and validation

**`routeToRequestersManager` is a boolean, deliberately, and not an approver kind.** A manager
template names nobody — whose manager it means is the requester, fixed rather than configured (P-1)
— so there is no identifier the kind could be derived from and it has to be stated. A `boolean`
carries exactly one capability: it cannot be widened by a client into `role` or `external` the way a
free `approverKind` string could. `approverKind` remains absent from every body, so
`forbidNonWhitelisted` refuses it outright and 16B's derivation rule is preserved exactly.

`false` is an omission rather than a third state — a step with the flag off names neither a person
nor a group, which is the domain's `step-approver-required`.

**No manager identifier is accepted anywhere.** `managerEmploymentId`, `managerMembershipId`,
`workforceUserId`, `platformUserId` and `roleId` are each **400** on the wire, asserted individually.

**`ServiceLevelBody`** is `@IsInt` + `@Min(1)` and a unit drawn from the domain's own
`SERVICE_LEVEL_UNITS`, so `business-days`, `weeks`, `minutes`, a fraction, a zero, a negative, a
string count and a half-supplied object are all **400**s — malformed rather than declined. No
`@Max`: a ceiling would be a policy about how long an approval may take, invented at the edge.

Nothing derived is accepted either: `dueAt`, `expiresAt`, `expired`, `breached`, `overdueByMinutes`,
`escalateAfter` and `businessDays` are each 400.

**Nested validation uses the established `@IsDefined()` + `@ValidateNested()` pairing.** No shared
validation infrastructure was touched.

---

## 4. Manager API semantics

- **Configuration**: `approverKind: 'manager'` with no identifier, read back from
  `read-definition`.
- **Running**: `approverKind: 'membership'` and a concrete `approverMembershipId`, indistinguishable
  from a step a tenant typed.
- **The API resolves nothing.** No controller calls Identity, Employment, `ReportingLinePort`, a
  repository or Prisma; resolution happened once, three layers away, when the instance started.
- **Nothing about how the manager was found reaches the wire** — asserted by scanning the whole
  response body for the employment identifiers and for the words `employment` and `reporting`, and
  finding none.
- **Ambiguity is a 422** carrying `manager-membership-ambiguous`, with no instance, no step, no
  history row and no queue entry left behind.

---

## 5. Service-level API semantics

The response is the application's view, unmodified: `count`, `unit`, `awaitingOn`, `dueOn`, `state`,
`overdueByMinutes`. Instants are ISO strings, `overdueByMinutes` is an integer and absent while the
step is within its target, and `state` is one of three values with **no `expired` among them**.

**The controller computes none of it**, and a test settles that from both ends: the response carries
a due time exactly two hours after the awaiting instant, while the row carries a count, a unit and
`awaiting_at` and the table has no `due_at`, `expired`, `breached`, `overdue_at` or
`elapsed_minutes` column at all.

A step nobody is waiting on yet reports its target with `state: 'none'` and no instants — a
different sentence from "within its target", and the one a screen must show.

**No client-supplied reading instant.** Reading twice gives an identical answer, and an `asOf` query
parameter is simply not a parameter of the route.

---

## 6. Actor identity and queues

No body or query anywhere in this module carries an identity — not an actor, a membership, a
workforce user, a delegate or somebody to act on behalf of. The acting membership comes from the
authenticated request, established by middleware outside the controller.

`GET /workflow/approvals/pending` still takes `page` and `size` and nothing else. Manager routing did
not become a queue filter: the manager sees their own approval because the step names them, and
another membership reading the same route sees nothing.

---

## 7. Authorization and tenancy

**No permission was added.** The nine existing Workflow permissions are unchanged; manager
configuration and service-level configuration both ride on `definition.manage`, and the reads on
`definition.read`, `instance.read` and `approval.read-own`. Nothing named `workflow.manager.*`,
`workflow.routing.*` or `workflow.sla.*` exists.

The tenant is ambient — no tenant identifier is accepted in a URL, query, body or header by any
Workflow controller. The suites run against real PostgreSQL as an unprivileged role, and the existing
tenancy suite proving cross-tenant refusal for definitions, instances, groups and totals passes
unchanged.

---

## 8. Error mapping

Unchanged, and `ProblemDetailsFilter` was not touched: malformed body **400**, domain refusal
**422**, missing subject **404**, stale version **409**. The two new groups exercise all four —
including the case worth naming: a manager step that also names a *real* group is a 422, while one
naming a group that does not exist is a 404 from the existence check. The second would have made the
first pass for the wrong reason, so both are asserted.

---

## 9. Request budget and N+1

No new request shape and no new read path, so the budget is 16B's unchanged. Manager resolution does
not happen during listing and cannot: the membership is already on the step, and the queue returns
its rows with their service-level fields from the same bounded read that returned them before.

---

## 10. Negative space

The API negative-space audit passes unchanged. Controllers remain transport-only: no `PrismaClient`,
no SQL, no repository, no `UnitOfWork`, no direct Identity, Employment, Organization or Recruitment
import, no `ReportingLinePort` use, and none of the deferred capabilities — scheduler, `JobPort`,
timer, cron, worker, outbox, broker, notification, escalation, expiry, business-day calculation,
analytics or portal.

---

## 11. Files

**New (2)** — `api/workflow-approval.dto.ts` (split at budget), plus the two suites below.

**Changed** — `api/workflow.dto.ts`, `api/version.controller.ts`, `api/instance.controller.ts` and
`api/approval.controller.ts` (import path after the split).

**Tests (new)** — `workflow.routing.spec.ts` (16), `workflow.service-level.spec.ts` (24).

**Fixtures** — `workflow-api.fixture.ts` registers Employment's queries and exposes the owner pool
for seeding another module's world, exactly as it already did for Identity.

---

## 12. Defects

**One, pre-existing, found and fixed.** `workflow-repository-plans.integration.test.ts` pinned
`workflow_instance_status_idx` by name. Two indexes can answer a filter on tenant and status —
`workflow_instance_status_idx` `(tenant_id, status, started_at, id)`, which also satisfies the
query's ordering, and `workflow_instance_subject_idx` `(tenant_id, subject_type, subject_id, status)`,
which does not — and at fixture size their costs are indistinguishable. The assertion was pinning a
tie-break, and it failed on a database where the coin landed the other way.

`workflow-schema-boundaries.integration.test.ts` had already written the rule down — *"which of two
equally-costed indexes the planner picks is not a property worth pinning at fixture size"* — and this
was the one assertion in the module that ignored it. It now pins what a fixture-sized table can
honestly answer: an index is reachable, the tenant is inside its condition, nothing scans, and the
bound is in the statement. The queue assertion beside it still names `workflow_step_queue_idx`, and
legitimately: that index is partial on exactly `status = 'awaiting'`, so it is the only candidate
rather than the winner of a tie.

*An intermediate attempt is worth recording because it was wrong.* Running `analyze` in that suite's
`beforeEach` did make its own assertion deterministic — and broke a sibling suite's, because
statistics are global. It was reverted.

---

## 13. Deviations

**A repository test file was modified**, which §2 did not list as in scope. The failure was
pre-existing (it reproduces with this checkpoint's changes stashed) and environmental, and the gate
requires zero failures. The change corrects an assertion that was wrong in principle rather than
weakening one — see §12.

---

## 14. Gates

| Gate | Result |
| --- | --- |
| `pnpm standards` | no violations · 176 models · 17 catalogues · 1,704 files, no cycles |
| `pnpm format:check` | clean |
| `pnpm lint` | 47/47 |
| `pnpm typecheck` | 47/47 |
| `pnpm build` | 27/27 |
| `pnpm prisma validate` | valid |
| `pnpm prisma migrate status` | 23 migrations, up to date |
| `turbo run test --force --concurrency=1` | uncached, serial, 0 failed, 0 skipped |

---

## 15. NOT VERIFIED

No Admin screen renders any of this — Checkpoint 9. Automatic expiry, escalation execution,
business-day SLA, role approvers, external approvers, notifications, analytics and portals remain
absent, and no route exposes any of them.

---

**Phase 16C Checkpoint 8 is complete. Checkpoint 9 has not started.**
