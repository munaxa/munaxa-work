import type { NotificationPort, PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  BusinessDecisionPort,
  Clock,
  DelegationPort,
  WorkflowStores,
} from './workflow-ports.js';
import type { MembershipStandingPort } from './workflow-membership-standing.js';
import type { ReminderRecipientPort } from './workflow-reminder-recipient.js';
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
 * **There is a notification port as of Phase 16E, and it emits intent only.** One approved automatic
 * action tells one approver that their step has passed its service level; Workflow says *what
 * happened and to whom* and never how to say it, and Phase 17 owns transport, templates, delivery and
 * retry. Nothing else in this module notifies anybody.
 *
 * **There is still no `JobPort` here, no storage port and no search port.** Workflow does not schedule
 * its own work: the reminder is a command a runner invokes through the same pipeline a person's
 * request goes through, so the scheduler stays on the other side of the boundary (D-16E-03). No bytes
 * are stored and no index is consulted. Each absent port is a capability named in the report as
 * `NOT VERIFIED` rather than a dependency nothing satisfies.
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
   * Whether the membership an administrator wants to escalate to may act at all (D-16D-12).
   *
   * **Required, like every other field here.** An optional port would be a rule that silently stops
   * being enforced in whichever composition forgot it — and this one is a *write-path* invariant, so
   * the composition that forgot it would accept escalations the approved rule refuses. Asked once,
   * for the one membership named on the command, and never for anybody already on the branch.
   */
  readonly membershipStanding: MembershipStandingPort;
  /**
   * Who to address an automatic reminder to (D-16E-10).
   *
   * **Required, like every other field here.** An optional port would be a capability that silently
   * stops working in whichever composition forgot it — and this one is on the only path that leaves
   * this module, so the composition that forgot it would claim a reminder in the database and send
   * nothing.
   */
  readonly reminderRecipient: ReminderRecipientPort;
  /**
   * Where a terminal decision goes.
   *
   * One port, one method, and no knowledge of who implements it: an adapter answers `not-adopted`
   * for subject types its module does not own, so Workflow never holds a module name or a command.
   * Nothing here is optional — a composition that forgot it would silently stop delivering decisions,
   * so the absence of adoption is expressed by the adapter's answer rather than by a missing field.
   */
  readonly businessDecision: BusinessDecisionPort;
  /**
   * Where a reminder's intent goes (D-16E-07).
   *
   * **Intent, never delivery.** One `notify` call carrying a template key, one recipient and the
   * identifiers a template needs — no channel, no provider, no retry and no delivery status. Required
   * like everything else here: a composition that omitted it would claim a reminder in the database
   * and send nothing, which is the failure mode hardest to notice.
   */
  readonly notifications: NotificationPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
