import { Module } from '@nestjs/common';
import {
  PerformanceAssessmentController,
  PerformanceAssessmentItemController,
  PerformanceCalibrationController,
  PerformanceCycleController,
  PerformanceDispatcher,
  PerformanceEnrolmentController,
  PerformanceFeedbackController,
  PerformanceFrameworkController,
  PerformanceGoalCategoryController,
  PerformanceGoalController,
  PerformanceGoalProgressController,
  PerformanceRatingScaleController,
  PerformanceReconciliationController,
  PerformanceReviewController,
  PerformanceReviewLifecycleController,
  PerformanceReviewerAssignmentController,
  PerformanceTalentController,
  PerformanceTemplateController,
} from '@work/performance';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Performance's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `performance.composition.ts` rather than here, because the
 * identity module's composition registers Performance on the shared registry while this file
 * imports the identity module to reach the dispatcher. Keeping both in one file would make those
 * two facts a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, so a controller owning a literal segment must be declared before
  // one whose route begins with a parameter on the same prefix.
  //
  // Three prefixes are shared. On `performance/reviews`, `PerformanceReviewController` declares the
  // collection and `:reviewId` and comes first; the assessment and lifecycle controllers add deeper
  // routes under the same parameter and follow. On `performance/goals` and `performance/cycles` the
  // same pattern holds. `PerformanceTalentController` declares the literal `talent/matrix` before
  // its `placements/:reviewId`, inside one controller, for the same reason.
  //
  // An API test asserts this resolution rather than trusting the comment.
  controllers: [
    PerformanceRatingScaleController,
    PerformanceFrameworkController,
    PerformanceTemplateController,
    PerformanceGoalCategoryController,
    PerformanceCycleController,
    PerformanceEnrolmentController,
    PerformanceGoalController,
    PerformanceGoalProgressController,
    PerformanceReviewController,
    PerformanceReviewLifecycleController,
    PerformanceAssessmentController,
    PerformanceAssessmentItemController,
    PerformanceReviewerAssignmentController,
    PerformanceCalibrationController,
    PerformanceTalentController,
    PerformanceFeedbackController,
    PerformanceReconciliationController,
  ],
  providers: [
    {
      provide: PerformanceDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): PerformanceDispatcher =>
        new PerformanceDispatcher(dispatcher),
    },
  ],
})
export class PerformanceModule {}
