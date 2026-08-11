import { Module } from '@nestjs/common';
import {
  AssignmentsController,
  ContractsController,
  EmploymentDispatcher,
  EmploymentHistoryController,
  EmploymentLifecycleController,
  EmploymentsController,
  ReportingLineController,
  TransferController,
} from '@work/employment';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Employment's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a quarter of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `employment.composition.ts` rather than here, because the
 * identity module's composition registers Employment on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape Organization and People have, and the same fix.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. `GET /employments/export` is one
  // segment after `/employments`, which is also the shape of `GET /employments/:employmentId` — and
  // Nest resolves a route by the order its controllers were declared. Declared the other way round,
  // an export would answer "no such employment".
  //
  // `employment.controller.spec.ts` asserts that the export resolves to the collection, so a
  // reordering is a failing test rather than a 404 somebody finds in production.
  controllers: [
    TransferController,
    EmploymentLifecycleController,
    AssignmentsController,
    ReportingLineController,
    ContractsController,
    EmploymentHistoryController,
    EmploymentsController,
  ],
  providers: [
    {
      provide: EmploymentDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): EmploymentDispatcher =>
        new EmploymentDispatcher(dispatcher),
    },
  ],
})
export class EmploymentModule {}
