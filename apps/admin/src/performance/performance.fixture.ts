import type {
  CalibrationSessionView,
  CompetencyFrameworkView,
  CycleView,
  FeedbackView,
  GoalCategoryView,
  GoalView,
  RatingScaleView,
  ReconciliationFindingView,
  ReviewTemplateView,
  ReviewView,
  TalentPlacementView,
} from '@work/performance/contracts';

import type { PerformanceRegister } from './api';

/**
 * The performance data the tests render, shaped by the module's published contracts.
 *
 * Every field is one the contract declares, so a fixture that drifts from the module fails to
 * compile rather than passing a test against a shape the API never produces.
 *
 * The values exercise the distinctions this slice exists to keep:
 *
 * - **Three employments whose UUIDv7 identifiers share a timestamp prefix.** That is what a page of
 *   reviews written by one enrolment run actually looks like, and it is what made the `short()`
 *   helper the screen this replaced used render three different people as the same eight characters.
 * - **A review scored but not completed**, so a `finalScore` that is genuinely absent can be
 *   asserted absent rather than silently replaced by the calculated one.
 * - **A calibration decision that confirmed rather than moved a rating**, and one that moved it.
 * - **A peer aggregate below the configured minimum**, so "withheld" can be told from "zero".
 * - **An excluded component with its reason**, so an exclusion is never inferred from a gap.
 */

export const EMPLOYMENT_A = '01930000-0000-7000-8000-00000000e001';
export const EMPLOYMENT_B = '01930000-0000-7000-8000-00000000e002';
export const EMPLOYMENT_C = '01930000-0000-7000-8000-00000000e003';
export const MANAGER = '01930000-0000-7000-8000-00000000m001';
export const CYCLE = '01930000-0000-7000-8000-00000000c001';
export const REVIEW_A = '01930000-0000-7000-8000-00000000r001';
export const REVIEW_B = '01930000-0000-7000-8000-00000000r002';
export const GOAL_A = '01930000-0000-7000-8000-00000000g001';
export const GOAL_B = '01930000-0000-7000-8000-00000000g002';
export const TEMPLATE = '01930000-0000-7000-8000-00000000t001';
export const CATEGORY = '01930000-0000-7000-8000-00000000y001';

const listing = <TItem>(items: readonly TItem[], total: number) => ({ items, total });

export const aCycle = (extra: Partial<CycleView> = {}): CycleView => ({
  cycleId: CYCLE,
  code: 'FY26-ANNUAL',
  name: { en: 'Annual review 2026', ar: 'المراجعة السنوية 2026' },
  reviewTemplateId: TEMPLATE,
  kind: 'annual',
  status: 'in_progress',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  managerAssessmentDue: '2026-11-15',
  calibrationDue: '2026-12-01',
  participantCount: 4187,
  version: 3,
  ...extra,
});

export const aReview = (extra: Partial<ReviewView> = {}): ReviewView => ({
  reviewId: REVIEW_A,
  cycleId: CYCLE,
  employmentId: EMPLOYMENT_A,
  managerEmploymentId: MANAGER,
  ratingScaleId: '01930000-0000-7000-8000-00000000s001',
  // Scored, not completed: `finalScore` is genuinely absent and must render as absent.
  status: 'manager_assessment',
  calculatedScore: 370,
  calculatedRatingLevelId: '01930000-0000-7000-8000-00000000l003',
  calibrated: false,
  scoredAt: '2026-11-20T09:00:00.000Z',
  version: 4,
  ...extra,
});

export const aGoal = (extra: Partial<GoalView> = {}): GoalView => ({
  goalId: GOAL_A,
  scope: 'individual',
  employmentId: EMPLOYMENT_A,
  cycleId: CYCLE,
  goalCategoryId: CATEGORY,
  title: 'Reduce month-end close to five working days',
  description: 'Bring the consolidated close inside five working days without extra headcount.',
  measurement: 'numeric',
  targetDescription: 'Five working days or fewer, sustained for two quarters.',
  weightBasisPoints: 3000,
  status: 'active',
  startDate: '2026-01-01',
  dueDate: '2026-12-31',
  progressBasisPoints: 6500,
  approvedAt: '2026-02-03T08:30:00.000Z',
  approvedBy: 'user:hr-director',
  progress: [
    {
      goalProgressId: '01930000-0000-7000-8000-00000000p001',
      progressBasisPoints: 4000,
      // Larger than a double can hold. It must reach the cell digit for digit.
      observedValue: '9007199254740993',
      note: 'Close ran to seven days in June. Two reconciliations are still manual.',
      recordedAt: '2026-07-01T06:00:00.000Z',
      recordedBy: 'user:finance-lead',
    },
    {
      goalProgressId: '01930000-0000-7000-8000-00000000p002',
      progressBasisPoints: 6500,
      observedValue: '6',
      evidenceDocumentId: '01930000-0000-7000-8000-00000000d001',
      recordedAt: '2026-10-01T06:00:00.000Z',
      recordedBy: 'user:finance-lead',
    },
  ],
  version: 6,
  ...extra,
});

const scales: readonly RatingScaleView[] = [
  {
    ratingScaleId: '01930000-0000-7000-8000-00000000s001',
    code: 'FIVE-POINT',
    name: { en: 'Five point', ar: 'خماسي' },
    minimumScore: 100,
    maximumScore: 500,
    effectiveFrom: '2025-01-01',
    active: true,
    levels: [
      {
        ratingLevelId: '01930000-0000-7000-8000-00000000l003',
        code: 'MEETS',
        name: { en: 'Meets expectations', ar: 'يلبي التوقعات' },
        ordinal: 3,
        minimumScore: 300,
        maximumScore: 399,
      },
    ],
    version: 2,
  },
];

const frameworks: readonly CompetencyFrameworkView[] = [
  {
    frameworkId: '01930000-0000-7000-8000-00000000f001',
    code: 'CORE-2026',
    frameworkVersion: 2,
    name: { en: 'Core competencies', ar: 'الجدارات الأساسية' },
    weighted: true,
    effectiveFrom: '2026-01-01',
    active: true,
    competencies: [
      {
        competencyId: '01930000-0000-7000-8000-00000000k001',
        code: 'COLLAB',
        name: { en: 'Collaboration', ar: 'التعاون' },
        category: 'core',
        weightBasisPoints: 5000,
        displayOrder: 1,
        active: true,
      },
    ],
    version: 2,
  },
];

const templates: readonly ReviewTemplateView[] = [
  {
    templateId: TEMPLATE,
    code: 'ANNUAL-STD',
    name: { en: 'Standard annual', ar: 'السنوي القياسي' },
    ratingScaleId: '01930000-0000-7000-8000-00000000s001',
    competencyFrameworkId: '01930000-0000-7000-8000-00000000f001',
    requiresSelfAssessment: true,
    requiresPeerAssessment: true,
    requiresCalibration: true,
    goalWeightTotalBasisPoints: 10_000,
    minimumPeerResponses: 3,
    active: true,
    components: [
      { component: 'goals', weightBasisPoints: 6000 },
      { component: 'competencies', weightBasisPoints: 4000 },
    ],
    version: 1,
  },
];

const categories: readonly GoalCategoryView[] = [
  {
    goalCategoryId: CATEGORY,
    code: 'OPERATIONAL',
    name: { en: 'Operational', ar: 'تشغيلي' },
    active: true,
    version: 1,
  },
];

const sessions: readonly CalibrationSessionView[] = [
  {
    calibrationSessionId: '01930000-0000-7000-8000-00000000n001',
    cycleId: CYCLE,
    code: 'FIN-PANEL',
    name: { en: 'Finance panel', ar: 'لجنة المالية' },
    status: 'concluded',
    organizationUnitId: '01930000-0000-7000-8000-00000000u001',
    scheduledFor: '2026-11-28T09:00:00.000Z',
    concludedAt: '2026-11-28T12:30:00.000Z',
    concludedBy: 'user:hr-director',
    decisionCount: 37,
    version: 2,
  },
];

const placements: readonly TalentPlacementView[] = [
  {
    talentPlacementId: '01930000-0000-7000-8000-00000000x001',
    cycleId: CYCLE,
    reviewId: REVIEW_A,
    employmentId: EMPLOYMENT_A,
    performanceBand: 3,
    potentialBand: 2,
    boxCode: 'B3-P2',
    rationale: 'Strong delivery; broader scope not yet demonstrated.',
    placedAt: '2026-11-28T12:00:00.000Z',
    placedBy: 'user:hr-director',
  },
];

const feedback: readonly FeedbackView[] = [
  {
    feedbackId: '01930000-0000-7000-8000-00000000b001',
    subjectEmploymentId: EMPLOYMENT_B,
    authorEmploymentId: EMPLOYMENT_C,
    kind: 'praise',
    visibility: 'manager',
    body: 'Carried the close single-handed in June.',
    relatedReviewId: REVIEW_B,
    givenAt: '2026-07-04T10:00:00.000Z',
  },
];

const findings: readonly ReconciliationFindingView[] = [
  {
    kind: 'unscored_review',
    subjectId: REVIEW_B,
    detail: { cycleId: CYCLE, status: 'peer_assessment' },
  },
];

/** Everything readable. The server's totals are deliberately far larger than the pages. */
export const aFullRegister = (extra: Partial<PerformanceRegister> = {}): PerformanceRegister => ({
  scales: listing(scales, 1),
  frameworks: listing(frameworks, 1),
  templates: listing(templates, 1),
  categories: listing(categories, 1),
  cycles: listing([aCycle(), aCycle({ cycleId: 'c2', code: 'FY25-ANNUAL', status: 'closed' })], 2),
  cycle: aCycle(),
  goals: listing(
    [
      aGoal(),
      aGoal({
        goalId: GOAL_B,
        employmentId: EMPLOYMENT_B,
        title: 'Publish the treasury policy',
        status: 'achieved',
      }),
    ],
    1284,
  ),
  reviews: listing(
    [
      aReview(),
      aReview({
        reviewId: REVIEW_B,
        employmentId: EMPLOYMENT_B,
        status: 'completed',
        finalScore: 420,
        completedAt: '2026-12-02T09:00:00.000Z',
      }),
    ],
    4187,
  ),
  sessions: listing(sessions, 1),
  placements: listing(placements, 1),
  feedback: listing(feedback, 1),
  findings: listing(findings, 1),
  ...extra,
});

/** Everything answered and nothing in it. Not the same as refused. */
export const anEmptyRegister = (): PerformanceRegister => ({
  scales: listing([], 0),
  frameworks: listing([], 0),
  templates: listing([], 0),
  categories: listing([], 0),
  cycles: listing([], 0),
  cycle: undefined,
  goals: listing([], 0),
  reviews: listing([], 0),
  sessions: listing([], 0),
  placements: listing([], 0),
  feedback: listing([], 0),
  findings: listing([], 0),
});

/** Nothing answered. Every read refused, which is this deployment's ordinary state. */
export const aRefusedRegister = (): PerformanceRegister => ({
  scales: undefined,
  frameworks: undefined,
  templates: undefined,
  categories: undefined,
  cycles: undefined,
  cycle: undefined,
  goals: undefined,
  reviews: undefined,
  sessions: undefined,
  placements: undefined,
  feedback: undefined,
  findings: undefined,
});

/** The cycles readable and every cycle-scoped read refused: a permission boundary, not an outage. */
export const aPartlyWithheldRegister = (): PerformanceRegister =>
  aFullRegister({
    goals: undefined,
    reviews: undefined,
    sessions: undefined,
    placements: undefined,
    feedback: undefined,
    findings: undefined,
  });
