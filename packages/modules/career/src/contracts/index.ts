/**
 * What another module may import from Career.
 *
 * Views only. No handler, no store, no dependency type and no domain aggregate: a consumer that
 * could reach a handler could bypass this module's permission checks, and one that could reach a
 * store would be querying Career's tables from outside Career.
 *
 * **Nothing in Career is pushed anywhere, and nothing here is writable.** Career reads Employment,
 * Organization, Learning and Documents through their published contracts and modifies none of them
 * (ADR-0072). No consumer of this file can cause a career recommendation to become a promotion,
 * because no shape below carries anything that would.
 */
export type {
  BenchStrengthView,
  CareerPathDetailView,
  CareerPathView,
  CareerPlanView,
  CareerStageView,
  CareerSummaryView,
  DevelopmentItemView,
  DevelopmentMixView,
  DevelopmentPlanDetailView,
  DevelopmentPlanView,
  LocalizedTextView,
  MobilityRecommendationView,
  PoolMembershipView,
  ReadinessAssessmentView,
  ReadinessLevelView,
  SuccessionPlanDetailView,
  SuccessionPlanView,
  SuccessorView,
  TalentPoolView,
} from './views.js';
