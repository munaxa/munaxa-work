import { PostgresRatingScaleRepository } from './configuration.repository.js';
import { PostgresFrameworkRepository } from './framework.repository.js';
import {
  PostgresGoalCategoryRepository,
  PostgresTemplateRepository,
} from './template.repository.js';
import { PostgresGoalProgressRepository, PostgresGoalRepository } from './goal.repository.js';
import { PostgresCycleRepository, PostgresReviewRepository } from './review.repository.js';
import { PostgresReviewerAssignmentRepository } from './reviewer.repository.js';
import {
  PostgresAssessmentRepository,
  PostgresComponentScoreRepository,
} from './assessment.repository.js';
import {
  PostgresCalibrationDecisionRepository,
  PostgresCalibrationSessionRepository,
  PostgresTalentPlacementRepository,
} from './outcome.repository.js';
import { PostgresFeedbackRepository, PostgresSnapshotRepository } from './feedback.repository.js';
import { PostgresReconciliationRepository } from './reconciliation.repository.js';
import type { PerformanceStores } from '../application/performance-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to. Every application store in `PerformanceStores` has an
 * implementation here; the type would not compile if one were missing, which is the point of
 * returning the whole interface rather than a partial.
 */
export const postgresPerformanceStores = (): PerformanceStores => ({
  ratingScales: new PostgresRatingScaleRepository(),
  frameworks: new PostgresFrameworkRepository(),
  goalCategories: new PostgresGoalCategoryRepository(),
  templates: new PostgresTemplateRepository(),

  goals: new PostgresGoalRepository(),
  goalProgress: new PostgresGoalProgressRepository(),
  cycles: new PostgresCycleRepository(),
  reviews: new PostgresReviewRepository(),
  reviewers: new PostgresReviewerAssignmentRepository(),
  assessments: new PostgresAssessmentRepository(),
  componentScores: new PostgresComponentScoreRepository(),

  calibrationSessions: new PostgresCalibrationSessionRepository(),
  calibrationDecisions: new PostgresCalibrationDecisionRepository(),
  placements: new PostgresTalentPlacementRepository(),
  feedback: new PostgresFeedbackRepository(),
  snapshots: new PostgresSnapshotRepository(),
  reconciliation: new PostgresReconciliationRepository(),
});
