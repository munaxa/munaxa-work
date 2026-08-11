/**
 * What another module may import from Performance.
 *
 * Views only. No handler, no store, no dependency type and no domain aggregate: a consumer that
 * could reach a handler could bypass this module's permission checks, and one that could reach a
 * store would be querying Performance's tables from outside Performance.
 *
 * **Nothing in Performance is pushed anywhere.** Compensation, Learning and Career pull a rating or
 * a placement when they want one; Performance modifies nothing outside itself (AD-005).
 */
export type {
  AssessmentItemView,
  AssessmentView,
  BasisPoints,
  CalibrationDecisionView,
  CalibrationSessionView,
  CompetencyFrameworkView,
  CompetencyView,
  ComponentScoreView,
  CycleView,
  FeedbackView,
  GoalCategoryView,
  GoalProgressView,
  GoalView,
  LocalizedTextView,
  PeerAggregateView,
  PerformanceSummaryView,
  RatingLevelView,
  RatingScaleView,
  ReconciliationFindingView,
  ReviewDetailView,
  ReviewSnapshotView,
  ReviewTemplateView,
  ReviewView,
  ReviewerAssignmentView,
  ScoreHundredths,
  TalentPlacementView,
  TemplateComponentView,
} from './views.js';
