/**
 * Enterprise Workflow & Approvals: workflow definitions and the versions of them, running
 * instances, the steps they are made of, the decisions approvers made, and the history of how each
 * instance got where it is.
 *
 * **Workflow owns process and owns no business data.** It routes a decision about a subject it
 * identifies by an opaque `subjectType` and `subjectId` and knows nothing else about. The requesting
 * module keeps its own decision record, its own invariants and its own permissions; what changes
 * when it adopts Workflow is *who is asked, in what order, and how the request reaches them*
 * (AD-001, ADR-0045).
 *
 * **A published version is immutable and an instance copies its steps.** Retiring a definition,
 * archiving a version or publishing a replacement changes nothing about an approval already under
 * way (AD-003, ADR-0048).
 *
 * **A decision is append-only, and nobody is impersonated.** A delegated decision records the
 * delegate who acted *and* the approver whose authority they used, in two separate columns.
 * Delegation itself is Identity's (AD-010); this module consumes it and stores none.
 *
 * **This is Phase 16A.** Approval is one step at a time, in order. There is no role or group, no
 * manager routing, no SLA, no escalation, no branching, no tally and no notification — and no
 * vocabulary in the module in which to express any of them. Each is named in
 * `workflow-vocabulary.ts` with the reason it is absent, and each is Phase 16B or `NOT VERIFIED`.
 */
export * from './domain/workflow-vocabulary.js';
export * from './domain/workflow-rejection.js';
export * from './domain/defined.js';
export * from './domain/definition.js';
export * from './domain/instance.js';
export * from './domain/decision.js';
export * from './domain/history.js';

export * from './contracts/views.js';

export * from './application/workflow-module.js';
export * from './application/workflow-permissions.js';
export * from './application/workflow-dependencies.js';
export * from './application/workflow-ports.js';
export * from './application/in-memory-stores.js';
export * from './application/workflow-views.js';
export * from './application/workflow-paging.js';
export * from './infrastructure/workflow-stores.js';

export { WorkflowDispatcher } from './api/workflow-dispatcher.js';
export { WorkflowDefinitionController } from './api/definition.controller.js';
export { WorkflowVersionController } from './api/version.controller.js';
export { WorkflowInstanceController } from './api/instance.controller.js';
export { WorkflowApprovalController } from './api/approval.controller.js';
