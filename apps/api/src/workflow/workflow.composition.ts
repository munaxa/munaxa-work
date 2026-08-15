import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';
import { postgresWorkflowStores, workflowModule } from '@work/workflow';
import { systemClock } from '@work/payroll';

import type { Asking } from '../payroll/asking.js';
import { WorkflowDelegations } from './workflow-sources.js';

/**
 * Workflow's composition: one cross-module adapter and the PostgreSQL stores.
 *
 * **Every dependency here is real.** No in-memory store, no fabricated delegation port and no
 * auto-approving anything — and the module's own types would not let one in unnoticed, because
 * `postgresWorkflowStores()` returns the whole `WorkflowStores` interface rather than a partial, and
 * `WorkflowDependencies` has no optional field. The in-memory stores exist for the application
 * suites and are reachable only from a test harness, never from this function.
 *
 * **One adapter, and the absences are the design.**
 *
 * *No Recruitment adapter, and no `ApprovalPort` implementation* — the write seam into an adopting
 * module is Checkpoint 7, and it is the only place a Phase 16 defect could corrupt a completed
 * module. Wiring it here would give it a path before the checkpoint meant to prove it.
 *
 * *No Employment, Organization, People or Documents adapter* — routing a decision needs none of
 * them. An approver is a membership the tenant named, and a subject is an opaque identifier its own
 * module understands (AD-001). Each is `NOT VERIFIED` rather than an adapter nothing calls.
 *
 * *No notification port* — the specification's own Non Goals exclude delivery, so nothing here could
 * later be misread as "the approver was told". `NOT VERIFIED`.
 *
 * *No `JobPort`* — nothing in Workflow runs when nobody is asking. A delegation is checked at the
 * instant of a decision rather than expired on a timer, and SLA and escalation are Phase 16B.
 * `NOT VERIFIED`.
 *
 * *No role directory, no group directory, no manager resolution* — and no parameter here through
 * which one could be supplied.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. In this module a disagreeing clock is
 * a delegation checked against the wrong instant, which is the difference between an approval a
 * deputy was entitled to make and one they were not.
 */
export const workflowModuleFor = (
  unitOfWork: UnitOfWork,
  // `Asking` rather than the dispatcher: the one adapter reads, and a parameter that could `send`
  // would be authority this module has no use for in 16A. Workflow writes nothing outside itself
  // until Checkpoint 7, and the type of this parameter is part of how that is true rather than
  // merely intended.
  dispatcher: Asking,
  permissions: PermissionChecker,
): WorkModule =>
  workflowModule({
    unitOfWork,
    stores: postgresWorkflowStores(),
    delegation: new WorkflowDelegations(dispatcher),
    permissions,
    clock: systemClock,
  });
