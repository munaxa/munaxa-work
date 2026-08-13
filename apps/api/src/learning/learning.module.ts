import { Module } from '@nestjs/common';
import {
  LearningAssessmentController,
  LearningAssignmentController,
  LearningCertificationController,
  LearningCourseCategoryController,
  LearningCourseController,
  LearningCourseVersionController,
  LearningDispatcher,
  LearningEnrolmentController,
  LearningEnrolmentLifecycleController,
  LearningHistoryController,
  LearningInstructorController,
  LearningMandatoryRuleController,
  LearningPathController,
} from '@work/learning';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Learning's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `learning.composition.ts` rather than here, because the
 * identity module's composition registers Learning on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared, so a controller owning a literal segment must be declared before
  // one whose route begins with a parameter on the same prefix.
  //
  // One prefix is shared. On `learning/enrolments`, `LearningEnrolmentController` declares the
  // collection and `:enrolmentId/assessment-results` and comes first; the lifecycle controller adds
  // the four state-changing routes under the same parameter and follows. Every other prefix belongs
  // to exactly one controller — `learning/courses` and `learning/course-versions` are distinct
  // segments, not a course whose identifier happens to read like one.
  //
  // An API test asserts this resolution rather than trusting the comment.
  controllers: [
    LearningCourseCategoryController,
    LearningCourseController,
    LearningCourseVersionController,
    LearningAssessmentController,
    LearningPathController,
    LearningMandatoryRuleController,
    LearningAssignmentController,
    LearningEnrolmentController,
    LearningEnrolmentLifecycleController,
    LearningCertificationController,
    LearningInstructorController,
    LearningHistoryController,
  ],
  providers: [
    {
      provide: LearningDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): LearningDispatcher =>
        new LearningDispatcher(dispatcher),
    },
  ],
})
export class LearningModule {}
