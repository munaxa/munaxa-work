import { Module } from '@nestjs/common';
import {
  CompensationApprovalController,
  CompensationComponentController,
  CompensationDispatcher,
  CompensationPayrollController,
  CompensationPlanController,
  CompensationRecordController,
  CompensationStructureController,
  EmploymentCompensationController,
} from '@work/compensation';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Compensation's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `compensation.composition.ts` rather than here, because the
 * identity module's composition registers Compensation on the shared registry while this file
 * imports the identity module to reach the dispatcher. Keeping both in one file would make those
 * two facts a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, and four of these share the bare `/compensation` prefix. The
  // payroll controller declares only literal segments (`payroll-period`, `changed-since`,
  // `dashboard`, `imports`) and is declared first; the record and approval controllers follow with
  // their own literals; and the controllers carrying `:parameter` segments come last. An API test
  // asserts the resolution rather than trusting this comment.
  controllers: [
    CompensationPayrollController,
    CompensationRecordController,
    CompensationApprovalController,
    CompensationStructureController,
    EmploymentCompensationController,
    CompensationPlanController,
    CompensationComponentController,
  ],
  providers: [
    {
      provide: CompensationDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): CompensationDispatcher =>
        new CompensationDispatcher(dispatcher),
    },
  ],
})
export class CompensationModule {}
