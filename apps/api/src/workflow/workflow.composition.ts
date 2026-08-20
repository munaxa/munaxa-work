import { RecordingNotificationPort } from '@work/kernel';
import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';
import { postgresWorkflowStores, workflowModule } from '@work/workflow';
import { systemClock } from '@work/payroll';

import type { Asking } from '../payroll/asking.js';
import type { Sending } from './sending.js';
import { WorkflowDelegations } from './workflow-sources.js';
import { WorkflowMembershipStanding } from './workflow-membership-standing.js';
import { WorkflowReminderRecipient } from './workflow-reminder-recipient.js';
import { WorkflowReportingLine } from './workflow-reporting-line.js';
import { RecruitmentDecisions } from './recruitment-decisions.js';
import { WorkflowApprovals } from './workflow-approvals.js';

/**
 * Workflow's composition: one cross-module adapter and the PostgreSQL stores.
 *
 * **Every dependency here is real.** No in-memory store, no fabricated delegation port and no
 * auto-approving anything — and the module's own types would not let one in unnoticed, because
 * `postgresWorkflowStores()` returns the whole `WorkflowStores` interface rather than a partial, and
 * `WorkflowDependencies` has no optional field. The in-memory stores exist for the application
 * suites and are reachable only from a test harness, never from this function.
 *
 * **Three adapters and two directions.**
 *
 * *Inbound* — `WorkflowApprovals` implements the kernel's `ApprovalPort` unchanged, so a business
 * module can ask Workflow to route a decision. It replaces `AutoApprovingPort`, which approved
 * everything as `system:auto-approval`, with routing to a named person. Nothing consumes it yet: M-1
 * authorizes Recruitment to accept a decision, not to request one.
 *
 * *Outbound* — `RecruitmentDecisions` implements Workflow's own `BusinessDecisionPort`, carrying a
 * terminal decision to Recruitment's published `decide` command. It is the only place Workflow writes
 * into another module, and it recognizes exactly one subject type; every other subject reaches it and
 * is answered `not-adopted`.
 *
 * *Inbound, and new in Phase 16C* — `WorkflowReportingLine` answers who the requester's manager is,
 * once, when an approval starts. It composes three published contracts — Identity's primary
 * employment, Employment's primary reporting line on the day, Identity's holder of that employment —
 * and holds two employment-scoped grants and no others. Notably **not**
 * `identity.membership.read`: reaching the requester's employment through `identity.describe-member`
 * would have handed the approvals engine the tenant's member register to read one identifier
 * (B-2).
 *
 * *No Organization, People or Documents adapter.* Routing a decision needs none of them, and the
 * manager did not change that: the reporting line is Employment's fact and the membership behind it
 * is Identity's, so no third domain was consulted and no time zone or calendar was involved.
 *
 * *No notification port* — the specification's own Non Goals exclude delivery, so nothing here could
 * later be misread as "the approver was told". `NOT VERIFIED`.
 *
 * *No `JobPort`* — nothing in Workflow runs when nobody is asking. A delegation is checked at the
 * instant of a decision rather than expired on a timer, and SLA and escalation are Phase 16B.
 * `NOT VERIFIED`.
 *
 * *No role directory and no group directory* — and no parameter here through which one could be
 * supplied. Manager resolution is now wired, and is not one of them: it answers about one named
 * person at a time and cannot be asked who holds a role, who is in a department, or who reports to
 * somebody. It resolves **once**, when an instance starts, and a running approval never consults it
 * again.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. In this module a disagreeing clock is
 * a delegation checked against the wrong instant, which is the difference between an approval a
 * deputy was entitled to make and one they were not.
 */
export const workflowModuleFor = (
  unitOfWork: UnitOfWork,
  // **Two parameters, two capabilities, and the split is the authorization.** `reader` can only ask,
  // and it is what the delegation adapter gets: reading Identity must never be able to write to it.
  // `writer` can also send, and exactly one adapter receives it — the one that applies a terminal
  // decision to the module that asked for the approval. A single dispatcher parameter would make
  // that distinction a convention; two parameters make it a type.
  reader: Asking,
  writer: Sending,
  permissions: PermissionChecker,
): WorkModule =>
  workflowModule({
    unitOfWork,
    stores: postgresWorkflowStores(),
    delegation: new WorkflowDelegations(reader),
    // Real, from this checkpoint. Checkpoint 4 left `reportingLine` optional because no composition
    // could supply it honestly before Identity's own contract existed; both halves exist now, so a
    // manager step resolves through the real seam rather than failing closed on an unwired port.
    reportingLine: new WorkflowReportingLine(reader),
    // Phase 16D. The same `reader`: asking whether somebody may act must never be able to change
    // whether they may.
    membershipStanding: new WorkflowMembershipStanding(reader),
    // Phase 16E. The same `reader` again, and the same reasoning: learning who to address a reminder
    // to must never be able to change anything about them.
    reminderRecipient: new WorkflowReminderRecipient(reader),
    // The intent seam, and the only thing that leaves this module when nobody asked. Recording rather
    // than delivering: Phase 17 owns transport, and no adapter here sends anything.
    notifications: new RecordingNotificationPort(),
    businessDecision: new RecruitmentDecisions(writer),
    permissions,
    clock: systemClock,
  });

/**
 * Workflow answering the kernel's `ApprovalPort`, for a composition that wants to hand it to a
 * module.
 *
 * Separate from the module factory because it is a *different seam*: the module is the engine, and
 * this is the interface a requesting domain holds. Kept exported and unwired rather than hidden —
 * the capability exists, nothing consumes it yet, and pretending otherwise in either direction would
 * be dishonest.
 */
export const workflowApprovalPortFor = (writer: Sending): WorkflowApprovals =>
  new WorkflowApprovals(writer);
