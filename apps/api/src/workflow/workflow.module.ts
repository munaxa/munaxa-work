import { Module } from '@nestjs/common';
import {
  WorkflowApprovalController,
  WorkflowApprovalGroupController,
  WorkflowDefinitionController,
  WorkflowDispatcher,
  WorkflowInstanceController,
  WorkflowVersionController,
} from '@work/workflow';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Workflow's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `workflow.composition.ts` rather than here, because the
 * identity module's composition registers Workflow on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts a
 * cycle — the same shape every module before it has.
 *
 * **The Recruitment seam has no transport, and that is not an omission.** A terminal decision reaches
 * an adopting module inside the approver's own request, through the application's own port. There is
 * no controller here for it, no route under `workflow/recruitment`, and nothing on the four
 * controllers below that could invoke it directly.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, so a controller owning a literal segment must be declared before
  // one whose route begins with a parameter on the same prefix.
  //
  // Here every prefix belongs to exactly one controller — `definitions`, `versions`, `instances`,
  // `approvals`, `approval-groups` — so no controller can shadow another. `approvals` and
  // `approval-groups` are distinct segments rather than nested, so neither captures the other.
  //
  // Two places inside a prefix could have gone wrong and are asserted rather than trusted. Within
  // `workflow/approvals`, `pending` and `decided` are literals declared before `:instanceId/status`
  // and `:instanceId/decision`. Within `workflow/approval-groups`, `members/:memberId` is a literal
  // segment declared on a different method from `:approvalGroupId`, so a member removal is never
  // read as a group identifier.
  controllers: [
    WorkflowDefinitionController,
    WorkflowVersionController,
    WorkflowInstanceController,
    WorkflowApprovalController,
    WorkflowApprovalGroupController,
  ],
  providers: [
    {
      provide: WorkflowDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): WorkflowDispatcher =>
        new WorkflowDispatcher(dispatcher),
    },
  ],
})
export class WorkflowModule {}
