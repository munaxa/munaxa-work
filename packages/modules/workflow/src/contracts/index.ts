/**
 * The public contract of Enterprise Workflow & Approvals.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its handlers, its
 * stores, its tables and its aggregates are private and stay private, because the moment a second
 * module reads `workflow_instance` directly the boundary stops being a boundary.
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export type {
  ApprovalDecisionKind,
  ApprovalStateName,
  ApproverKind,
  BranchOutcome,
  BranchRule,
  ConditionOperator,
  DecisionAuthority,
  WorkflowDefinitionStatus,
  WorkflowHistoryEvent,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
  WorkflowVersionStatus,
} from '../domain/workflow-vocabulary.js';

/**
 * The vocabularies themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request body, a database row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  APPROVAL_DECISIONS,
  APPROVAL_STATES,
  APPROVER_KINDS,
  BRANCH_OUTCOMES,
  BRANCH_RULES,
  CONDITION_OPERATORS,
  DECISION_AUTHORITIES,
  WORKFLOW_HISTORY_EVENTS,
  WORKFLOW_INSTANCE_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_VERSION_STATUSES,
} from '../domain/workflow-vocabulary.js';

export type {
  ApprovalGroupDetailView,
  ApprovalGroupMemberView,
  ApprovalGroupView,
  BranchConditionView,
  LocalizedTextView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowStepTemplateView,
  WorkflowVersionView,
} from './views.js';

/** The running half of the same contract — see `execution-views.ts` for why it is a second file. */
export type {
  ApprovalStatusView,
  ApprovalStepView,
  BranchTallyView,
  DueReminderView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
  WorkflowStepView,
} from './execution-views.js';
