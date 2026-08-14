import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  addStepHandler,
  archiveVersionHandler,
  createDefinitionHandler,
  draftVersionHandler,
  publishVersionHandler,
  retireDefinitionHandler,
} from './definition.use-case.js';
import { cancelInstanceHandler, startInstanceHandler } from './instance.use-case.js';
import { decideStepHandler } from './decision.use-case.js';
import {
  readDefinitionHandler,
  readInstanceHandler,
  searchDefinitionsHandler,
  searchInstancesHandler,
} from './workflow-queries.js';
import {
  decidedApprovalsHandler,
  pendingApprovalsHandler,
  readApprovalStatusHandler,
  readHistoryHandler,
} from './approval-queries.js';
import { ALL_WORKFLOW_PERMISSIONS, WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Workflow's module declaration: nine commands, eight queries, two navigation entries.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event.**
 * Dispatch is post-commit, in-process and at-most-once with no outbox, so a module whose correctness
 * depended on delivery would be wrong the first time a process restarted mid-dispatch — which is
 * exactly why a decision reaches an adopting module inside the approver's own request rather than
 * through an event (D-9). ADR-0050 settled the same question for onboarding.
 *
 * **Nothing here is scheduled.** No approval comes due by itself, nothing escalates and no delegation
 * expires on a timer: `JobPort` has no adapter anywhere in this repository. SLA and escalation are
 * Phase 16B, and there is no handler here that could fire one.
 *
 * **Nothing here writes outside Workflow**, and the shape of this list is part of why: every command
 * names a Workflow aggregate, and there is no handler whose name or dependencies could reach a
 * requisition, a leave request or a payroll run. The seam that will let an adopting module's own
 * `decide` command run is Checkpoint 7's, and nothing in this file anticipates it.
 *
 * **Two navigation entries and no third.** A queue and an administrator's list of approvals. There is
 * no "my team" entry, because there is no team query — resolving one needs the caller's employment
 * (D-14).
 */
export const workflowModule = (dependencies: WorkflowDependencies): WorkModule => ({
  name: 'workflow',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'workflow.approvals',
      path: '/workflow/approvals',
      permission: WorkflowPermissions.approvalReadOwn,
      order: 100,
    },
    {
      key: 'workflow.definitions',
      path: '/workflow/definitions',
      permission: WorkflowPermissions.definitionRead,
      order: 101,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration. Every one of these is routed: unlike every other
  // module's `read-own`, Workflow's reaches a handler, because an approval is addressed to a
  // membership and a membership is what the request resolved.
  permissions: ALL_WORKFLOW_PERMISSIONS,
});

const commandsOf = (
  dependencies: WorkflowDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createDefinitionHandler(dependencies),
    retireDefinitionHandler(dependencies),
    draftVersionHandler(dependencies),
    addStepHandler(dependencies),
    publishVersionHandler(dependencies),
    archiveVersionHandler(dependencies),

    startInstanceHandler(dependencies),
    decideStepHandler(dependencies),
    cancelInstanceHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: WorkflowDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchDefinitionsHandler(dependencies),
    readDefinitionHandler(dependencies),
    searchInstancesHandler(dependencies),
    readInstanceHandler(dependencies),

    pendingApprovalsHandler(dependencies),
    decidedApprovalsHandler(dependencies),
    readHistoryHandler(dependencies),
    readApprovalStatusHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
