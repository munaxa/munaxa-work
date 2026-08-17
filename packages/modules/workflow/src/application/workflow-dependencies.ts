import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  BusinessDecisionPort,
  Clock,
  DelegationPort,
  WorkflowStores,
} from './workflow-ports.js';
import type { ReportingLinePort } from './workflow-reporting-line.js';

/**
 * Everything the Workflow application layer is given, and nothing it is not.
 *
 * **Two cross-module dependencies, and the second arrived in Phase 16C.** Identity's delegation
 * register answers who is acting for whom at the instant of a decision. `reportingLine` answers who
 * one person's manager is on the day an approval started — one membership in, one manager out. Both
 * are questions about *people a decision is addressed to*, and neither reads a document, a position
 * or a payslip: the subject of an approval remains an opaque identifier the requesting module
 * supplied and Workflow never interprets (AD-001).
 *
 * **`reportingLine` is not a directory and there is no interface here through which one could
 * arrive.** It has one method, takes one membership and a date, and returns one manager or one of
 * four named reasons there is none. "Who holds role X", "who reports to me" and "everybody in this
 * department" are three questions it cannot be asked, which is what keeps the manager approver from
 * being the beginning of the role engine `PlatformPermissionChecker` says this product will not
 * build.
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
 * **There is still no role directory and no group directory.** A role is a question about people
 * evaluated against facts nobody in this repository owns; a group is a list a tenant wrote down, in
 * Workflow's own tables. The manager is neither: it is one named person, read once and copied onto a
 * step, and nothing about a running approval consults it again.
 */
export interface WorkflowDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: WorkflowStores;
  readonly delegation: DelegationPort;
  /**
   * Who the requester's manager is, on the day an approval started. Read once, at the start.
   *
   * **Required, as of Checkpoint 7.** It was optional for exactly one checkpoint and for a stated
   * reason: the Identity contract behind it is a *completed module's* change, built and verified on
   * its own side first, so no composition could have supplied this honestly before it existed. An
   * adapter would have been that work done early, and a stub answering "no manager" would have been
   * Workflow inventing an organizational fact and blaming the tenant for it.
   *
   * Both halves exist now, so the field is required and there is no composition — production or
   * test — that can omit it. `WorkflowDependencies` has no optional field again, which is the
   * property the composition doc has relied on since 16A: a dependency cannot be forgotten quietly.
   */
  readonly reportingLine: ReportingLinePort;
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
