import { Module } from '@nestjs/common';
import {
  PayrollConfigurationController,
  PayrollDecisionController,
  PayrollDispatcher,
  PayrollResultController,
  PayrollRunController,
} from '@work/payroll';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Payroll's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `payroll.composition.ts` rather than here, because the
 * identity module's composition registers Payroll on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, and two of these share the bare `/payroll` prefix. The
  // configuration controller declares literal segments (`dashboard`, `groups`, `periods`,
  // `deduction-definitions`) and is declared first; the result controller's routes are all
  // two-segment paths under `runs/` and `results/`; the run controller carries the bare
  // `:payrollRunId` and comes last. An API test asserts the resolution rather than trusting this
  // comment.
  controllers: [
    PayrollConfigurationController,
    PayrollResultController,
    PayrollDecisionController,
    PayrollRunController,
  ],
  providers: [
    {
      provide: PayrollDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): PayrollDispatcher => new PayrollDispatcher(dispatcher),
    },
  ],
})
export class PayrollModule {}
