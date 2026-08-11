import { Module } from '@nestjs/common';
import {
  LeaveAdministrationController,
  LeaveBalanceController,
  LeaveDecisionController,
  LeaveDispatcher,
  LeavePolicyController,
  LeaveRequestController,
  LeaveRunController,
  LeaveTypeController,
} from '@work/leave';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Leave's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `leave.composition.ts` rather than here, because the identity
 * module's composition registers Leave on the shared registry while this file imports the identity
 * module to reach the dispatcher. Keeping both in one file would make those two facts a cycle — the
 * same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. `LeaveRequestController` and
  // `LeaveDecisionController` share the `/leave/requests` prefix, and Nest resolves a route by the
  // order its controllers were declared: the request controller declares the literal `calendar`
  // segment and must come first, or `:leaveRequestId` would swallow it. The administration and run
  // controllers share the bare `/leave` prefix and are declared before the type and policy
  // controllers for the same reason.
  controllers: [
    LeaveRequestController,
    LeaveDecisionController,
    LeaveBalanceController,
    LeaveAdministrationController,
    LeaveRunController,
    LeaveTypeController,
    LeavePolicyController,
  ],
  providers: [
    {
      provide: LeaveDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): LeaveDispatcher => new LeaveDispatcher(dispatcher),
    },
  ],
})
export class LeaveModule {}
