import type {
  BenchStrengthView,
  CareerPathDetailView,
  CareerPathView,
  CareerPlanView,
  CareerSummaryView,
  DevelopmentItemView,
  DevelopmentPlanDetailView,
  DevelopmentPlanView,
  MobilityRecommendationView,
  PoolMembershipView,
  ReadinessAssessmentView,
  ReadinessLevelView,
  SuccessionPlanDetailView,
  SuccessionPlanView,
  SuccessorView,
  TalentPoolView,
} from '@work/career/contracts';

import type { ReadinessHistoryForDisplay } from './api';

/**
 * The published views, as the API would return them.
 *
 * Typed against the module's own contracts rather than written loosely, so a field the module
 * renames breaks these fixtures at compile time instead of leaving a screen test passing against a
 * shape the API no longer sends.
 *
 * The values are deliberately awkward where awkwardness is the point: `2026-02-28` is the civil date
 * a `Date` round trip shifts west of UTC, `500` is the largest stage sequence the domain accepts,
 * `50` the largest rank and `100` the largest ordinal — the three integer boundaries this screen
 * must render exactly. A fixture full of round numbers would prove nothing about either.
 */

const LOCALIZED = { en: 'Finance', ar: 'المالية' } as const;

export const aPath = (overrides: Partial<CareerPathView> = {}): CareerPathView => ({
  pathId: '01900000-0000-7000-8000-0000000000a1',
  code: 'finance',
  name: LOCALIZED,
  kind: 'management',
  status: 'published',
  effectiveFrom: '2026-02-28',
  inForce: true,
  stageCount: 2,
  version: 2,
  ...overrides,
});

export const aPathDetail = (
  overrides: Partial<CareerPathDetailView> = {},
): CareerPathDetailView => ({
  path: aPath(),
  stages: [
    {
      stageId: '01900000-0000-7000-8000-0000000000b1',
      pathId: '01900000-0000-7000-8000-0000000000a1',
      // The domain's maximum. A `toLocaleString` would render this `500` in English and `٥٠٠` in
      // Arabic, and would gain a separator the moment the bound moved.
      sequence: 500,
      name: { en: 'Finance director', ar: 'مدير مالي' },
      targetPositionId: '01900000-0000-7000-8000-0000000000c1',
    },
  ],
  asOf: '2026-02-28',
  ...overrides,
});

export const aPlan = (overrides: Partial<CareerPlanView> = {}): CareerPlanView => ({
  careerPlanId: '01900000-0000-7000-8000-0000000000d1',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  pathId: '01900000-0000-7000-8000-0000000000a1',
  status: 'active',
  startedOn: '2026-02-28',
  targetDate: '2027-02-28',
  version: 2,
  ...overrides,
});

export const aPool = (overrides: Partial<TalentPoolView> = {}): TalentPoolView => ({
  talentPoolId: '01900000-0000-7000-8000-0000000000f1',
  code: 'future-leaders',
  name: { en: 'Future leaders', ar: 'قادة المستقبل' },
  kind: 'leadership',
  status: 'active',
  version: 1,
  ...overrides,
});

export const aMembership = (overrides: Partial<PoolMembershipView> = {}): PoolMembershipView => ({
  membershipId: '01900000-0000-7000-8000-000000000101',
  talentPoolId: '01900000-0000-7000-8000-0000000000f1',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  from: '2026-02-28',
  addedBy: 'user:career-hr',
  version: 1,
  ...overrides,
});

export const aSuccessionPlan = (
  overrides: Partial<SuccessionPlanView> = {},
): SuccessionPlanView => ({
  successionPlanId: '01900000-0000-7000-8000-000000000111',
  positionId: '01900000-0000-7000-8000-0000000000c1',
  status: 'active',
  reviewOn: '2026-12-01',
  reviewDue: false,
  version: 2,
  ...overrides,
});

export const aSuccessor = (overrides: Partial<SuccessorView> = {}): SuccessorView => ({
  successorId: '01900000-0000-7000-8000-000000000121',
  successionPlanId: '01900000-0000-7000-8000-000000000111',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  readinessLevelId: '01900000-0000-7000-8000-000000000131',
  // The domain's maximum rank.
  rank: 50,
  status: 'nominated',
  nominatedOn: '2026-02-28',
  nominatedBy: 'user:career-hr',
  version: 1,
  ...overrides,
});

export const aSuccessionDetail = (
  overrides: Partial<SuccessionPlanDetailView> = {},
): SuccessionPlanDetailView => ({
  plan: aSuccessionPlan(),
  successors: [aSuccessor()],
  asOf: '2026-02-28',
  ...overrides,
});

export const aBench = (overrides: Partial<BenchStrengthView> = {}): BenchStrengthView => ({
  successionPlanId: '01900000-0000-7000-8000-000000000111',
  positionId: '01900000-0000-7000-8000-0000000000c1',
  nominated: 4000,
  confirmed: 12,
  asOf: '2026-02-28',
  ...overrides,
});

export const aLevel = (overrides: Partial<ReadinessLevelView> = {}): ReadinessLevelView => ({
  readinessLevelId: '01900000-0000-7000-8000-000000000131',
  code: 'ready-now',
  name: { en: 'Ready now', ar: 'جاهز الآن' },
  // The domain's maximum ordinal.
  ordinal: 100,
  active: true,
  version: 1,
  ...overrides,
});

export const anAssessment = (
  overrides: Partial<ReadinessAssessmentView> = {},
): ReadinessAssessmentView => ({
  readinessAssessmentId: '01900000-0000-7000-8000-000000000141',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  readinessLevelId: '01900000-0000-7000-8000-000000000131',
  successionPlanId: '01900000-0000-7000-8000-000000000111',
  assessedOn: '2026-02-28',
  assessedBy: 'user:career-assessor',
  recordedAt: '2026-02-28T09:00:00.000Z',
  ...overrides,
});

export const aReadinessHistory = (
  overrides: Partial<ReadinessHistoryForDisplay> = {},
): ReadinessHistoryForDisplay => ({
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  assessments: [anAssessment()],
  latest: anAssessment(),
  ...overrides,
});

export const aDevelopmentPlan = (
  overrides: Partial<DevelopmentPlanView> = {},
): DevelopmentPlanView => ({
  developmentPlanId: '01900000-0000-7000-8000-000000000151',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  careerPlanId: '01900000-0000-7000-8000-0000000000d1',
  status: 'active',
  startedOn: '2026-02-28',
  targetDate: '2026-12-31',
  employeeAcknowledgedOn: '2026-02-28',
  version: 2,
  ...overrides,
});

export const anItem = (overrides: Partial<DevelopmentItemView> = {}): DevelopmentItemView => ({
  developmentItemId: '01900000-0000-7000-8000-000000000161',
  developmentPlanId: '01900000-0000-7000-8000-000000000151',
  category: 'education',
  kind: 'course',
  title: 'Advanced financial reporting',
  learningAssignmentId: '01900000-0000-7000-8000-000000000171',
  targetDate: '2026-12-31',
  status: 'in_progress',
  overdue: false,
  version: 1,
  ...overrides,
});

export const aDevelopmentDetail = (
  overrides: Partial<DevelopmentPlanDetailView> = {},
): DevelopmentPlanDetailView => ({
  plan: aDevelopmentPlan(),
  items: [anItem()],
  mix: { experience: 1, exposure: 0, education: 1, mixVerdict: 'NOT VERIFIED' },
  asOf: '2026-02-28',
  ...overrides,
});

export const aRecommendation = (
  overrides: Partial<MobilityRecommendationView> = {},
): MobilityRecommendationView => ({
  mobilityRecommendationId: '01900000-0000-7000-8000-000000000181',
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  kind: 'lateral_move',
  targetPositionId: '01900000-0000-7000-8000-0000000000c1',
  status: 'proposed',
  // Stored `proposed`, standing `expired` — the same row, two different facts (D-13).
  standing: 'expired',
  recommendedOn: '2026-02-28',
  recommendedBy: 'user:career-hr',
  validUntil: '2026-09-01',
  version: 1,
  ...overrides,
});

export const aSummary = (overrides: Partial<CareerSummaryView> = {}): CareerSummaryView => ({
  employmentId: '01900000-0000-7000-8000-0000000000e1',
  plan: aPlan(),
  openPoolMemberships: [aMembership()],
  openNominations: [aSuccessor()],
  latestReadiness: anAssessment(),
  activeDevelopmentPlan: aDevelopmentPlan(),
  openRecommendations: [aRecommendation()],
  asOf: '2026-02-28',
  ...overrides,
});
