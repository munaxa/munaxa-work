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
  DECISION_AUTHORITIES,
  WORKFLOW_HISTORY_EVENTS,
  WORKFLOW_INSTANCE_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_VERSION_STATUSES,
} from '../domain/workflow-vocabulary.js';

export type {
  ApprovalStatusView,
  ApprovalStepView,
  LocalizedTextView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
  WorkflowStepTemplateView,
  WorkflowStepView,
  WorkflowVersionView,
} from './views.js';
