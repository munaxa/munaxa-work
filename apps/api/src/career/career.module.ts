import { Module } from '@nestjs/common';
import {
  CareerDevelopmentController,
  CareerDevelopmentItemController,
  CareerDispatcher,
  CareerMembershipController,
  CareerMobilityController,
  CareerPathController,
  CareerPlanController,
  CareerPoolController,
  CareerReadinessController,
  CareerSuccessionController,
  CareerSuccessionLifecycleController,
  CareerSuccessorController,
  CareerSummaryController,
} from '@work/career';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Career's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `career.composition.ts` rather than here, because the identity
 * module's composition registers Career on the shared registry while this file imports the identity
 * module to reach the dispatcher. Keeping both in one file would make those two facts a cycle — the
 * same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, so a controller owning a literal segment must be declared before
  // one whose route begins with a parameter on the same prefix.
  //
  // One prefix is shared. On `career/succession-plans`, `CareerSuccessionController` declares the
  // collection, `:successionPlanId` and `:successionPlanId/bench-strength` and comes first; the
  // lifecycle controller adds the state-changing routes under the same parameter and follows.
  //
  // Every other prefix belongs to exactly one controller, and the pairs that could be confused are
  // distinct segments rather than one nested in the other: `career/development-plans` and
  // `career/development-items` name different aggregates, and `career/pools` and
  // `career/pool-memberships` do too. Within `career/readiness`, `levels`, `assessments` and
  // `history/:employmentId` are all literal-first, so no parameter shadows a sibling.
  //
  // An API test asserts this resolution rather than trusting the comment.
  controllers: [
    CareerPathController,
    CareerPlanController,
    CareerPoolController,
    CareerMembershipController,
    CareerSuccessionController,
    CareerSuccessionLifecycleController,
    CareerSuccessorController,
    CareerReadinessController,
    CareerDevelopmentController,
    CareerDevelopmentItemController,
    CareerMobilityController,
    CareerSummaryController,
  ],
  providers: [
    {
      provide: CareerDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): CareerDispatcher => new CareerDispatcher(dispatcher),
    },
  ],
})
export class CareerModule {}
