import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type { Clock, DelegationPort, WorkflowStores } from './workflow-ports.js';

/**
 * Everything the Workflow application layer is given, and nothing it is not.
 *
 * **One cross-module dependency: Identity's delegation register.** That is the whole of Workflow's
 * outward reach in Phase 16A. It does not read an employment, a position, a person or a document,
 * because routing a decision needs none of them: an approver is a membership the tenant configured,
 * and the subject of an approval is an opaque identifier the requesting module supplied (AD-001).
 *
 * **There is deliberately no `ApprovalPort` here.** Workflow *implements* that port rather than
 * consuming one, and the implementation plus its first adopting module are Checkpoint 7. Wiring it
 * now would give the seam a path before the checkpoint that is supposed to prove it.
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
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
