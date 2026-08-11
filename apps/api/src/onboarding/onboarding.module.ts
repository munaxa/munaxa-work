import { Module } from '@nestjs/common';
import {
  OnboardingDispatcher,
  OnboardingExportController,
  OnboardingLifecycleController,
  OnboardingsController,
  PlanVersionsController,
  PlansController,
  ReconciliationController,
  TasksController,
} from '@work/onboarding';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Onboarding's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `onboarding.composition.ts` rather than here, because the
 * identity module's composition registers Onboarding on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts a
 * cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. `GET /onboarding/export` and
  // `GET /onboarding/reconciliation` are each one segment after `/onboarding`, and the plan-version
  // controller claims the bare `/onboarding` prefix — Nest resolves a route by the order its
  // controllers were declared, so the specific paths are declared first.
  controllers: [
    OnboardingExportController,
    ReconciliationController,
    PlansController,
    OnboardingLifecycleController,
    OnboardingsController,
    TasksController,
    PlanVersionsController,
  ],
  providers: [
    {
      provide: OnboardingDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): OnboardingDispatcher =>
        new OnboardingDispatcher(dispatcher),
    },
  ],
})
export class OnboardingModule {}
