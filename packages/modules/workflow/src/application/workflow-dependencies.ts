import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  BusinessDecisionPort,
  Clock,
  DelegationPort,
  WorkflowStores,
} from './workflow-ports.js';

/**
 * Everything the Workflow application layer is given, and nothing it is not.
 *
 * **One cross-module dependency: Identity's delegation register.** That is the whole of Workflow's
 * outward reach in Phase 16A. It does not read an employment, a position, a person or a document,
 * because routing a decision needs none of them: an approver is a membership the tenant configured,
 * and the subject of an approval is an opaque identifier the requesting module supplied (AD-001).
 *
 * **There is deliberately no `ApprovalPort` here.** Workflow *implements* the kernel's port rather
 * than consuming it — a business module asks Workflow to route a decision, never the other way
 * about. `businessDecision` below is the **return** path, which that port has no method for, and the
 * two are not the same seam.
 *
 * **There is no `JobPort`, no notification port, no storage port and no search port.** Nothing in
 * this module runs when nobody is asking, nobody is told anything, no bytes are stored and no index
 * is consulted. Each absent port is a capability named in the report as `NOT VERIFIED` rather than a
 * dependency nothing satisfies.
 *
 * **There is no role directory, no group directory and no manager resolution**, and there is no
 * interface here through which one could be supplied. `PlatformPermissionChecker` states that this
 * product will never implement a role engine; a port that took one would be the beginning of it.
 */
export interface WorkflowDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: WorkflowStores;
  readonly delegation: DelegationPort;
  /**
   * Where a terminal decision goes.
   *
   * One port, one method, and no knowledge of who implements it: an adapter answers `not-adopted`
   * for subject types its module does not own, so Workflow never holds a module name or a command.
   * Nothing here is optional — a composition that forgot it would silently stop delivering decisions,
   * so the absence of adoption is expressed by the adapter's answer rather than by a missing field.
   */
  readonly businessDecision: BusinessDecisionPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
