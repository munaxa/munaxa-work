import type { AssessmentView, ReviewDetailView } from '@work/performance/contracts';
import type { EmploymentView } from '@work/employment/contracts';

import {
  EMPLOYMENT_A,
  EMPLOYMENT_B,
  EMPLOYMENT_C,
  GOAL_A,
  MANAGER,
  aReview,
} from './performance.fixture';

/**
 * One review in full, and the employment a detail page names.
 *
 * Split from `performance.fixture.ts` because both files were about to cross the 400-line budget
 * together — and because the register and the review detail are read by different tests: a register
 * test has no business compiling a panel.
 *
 * Three distinctions are deliberate and each is asserted somewhere:
 *
 * - The review is **scored but not completed**, so `finalScore` is genuinely absent. The screen this
 *   replaced rendered the calculated score in its place, under a heading that said final.
 * - The peer aggregate holds **two responses against a minimum of three**, so `available: false`
 *   can be told from a genuine zero — and so the note beneath says withheld rather than anonymous.
 * - One component is **excluded with its reason recorded**, so an exclusion is never inferred from
 *   a missing score.
 */

const assessments: readonly AssessmentView[] = [
  {
    assessmentId: '01930000-0000-7000-8000-00000000a001',
    assessmentKind: 'manager',
    assessorEmploymentId: MANAGER,
    status: 'submitted',
    overallScore: 370,
    strengths: 'Held the close together through two system migrations.',
    developmentAreas: 'Delegation. Too much still routes through one person.',
    submittedAt: '2026-11-19T15:00:00.000Z',
    items: [
      {
        assessmentItemId: '01930000-0000-7000-8000-00000000i001',
        itemKind: 'goal',
        goalId: GOAL_A,
        score: 380,
        weightBasisPoints: 3000,
        comment: 'Six days, down from eleven.',
        excluded: false,
      },
      {
        assessmentItemId: '01930000-0000-7000-8000-00000000i002',
        itemKind: 'competency',
        competencyId: '01930000-0000-7000-8000-00000000k001',
        excluded: true,
        exclusionReason: 'not_applicable',
      },
    ],
  },
  {
    assessmentId: '01930000-0000-7000-8000-00000000a002',
    assessmentKind: 'self',
    assessorEmploymentId: EMPLOYMENT_A,
    status: 'submitted',
    overallScore: 420,
    submittedAt: '2026-11-10T08:00:00.000Z',
    items: [],
  },
];

/** One review in full: scored, not completed, not calibrated, aggregate below the minimum. */
export const aReviewDetail = (extra: Partial<ReviewDetailView> = {}): ReviewDetailView => ({
  review: aReview(),
  reviewers: [
    {
      reviewerAssignmentId: '01930000-0000-7000-8000-00000000q001',
      reviewerEmploymentId: EMPLOYMENT_B,
      role: 'peer',
      status: 'submitted',
      requestedAt: '2026-10-01T09:00:00.000Z',
      respondedAt: '2026-10-09T11:00:00.000Z',
    },
    {
      reviewerAssignmentId: '01930000-0000-7000-8000-00000000q002',
      reviewerEmploymentId: EMPLOYMENT_C,
      role: 'peer',
      status: 'declined',
      requestedAt: '2026-10-01T09:00:00.000Z',
    },
  ],
  assessments,
  componentScores: [
    {
      component: 'goals',
      weightBasisPoints: 6000,
      included: true,
      score: 380,
      denominatorBasisPoints: 6000,
      contributedScore: 228,
      excludedItems: [],
    },
    {
      component: 'competencies',
      weightBasisPoints: 4000,
      included: false,
      exclusionReason: 'not_applicable',
      denominatorBasisPoints: 0,
      excludedItems: [{ reference: 'COLLAB', reason: 'not_applicable' }],
    },
  ],
  // Two responses against a minimum of three: withheld, and not the same thing as zero.
  peerAggregate: { available: false, responseCount: 2, minimumResponses: 3 },
  ...extra,
});

export const anEmployment = (extra: Partial<EmploymentView> = {}): EmploymentView => ({
  employmentId: EMPLOYMENT_A,
  employmentNumber: 'EMP-004417',
  personId: '01930000-0000-7000-8000-00000000z001',
  personName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
  status: 'active',
  employmentTypeCode: 'FULL_TIME',
  originalHireDate: '2021-03-01',
  startDate: '2021-03-01',
  asOf: '2026-11-20',
  metadata: {},
  version: 4,
  ...extra,
});

/**
 * The same employment with **no** `personName` at all.
 *
 * `exactOptionalPropertyTypes` is on, so the key is omitted rather than set to `undefined` — which
 * is also what the API does: the field is absent when the caller may not read the person, and
 * absent is meaningful.
 */
export const anEmploymentWithheldName = (): EmploymentView => {
  const { personName: _withheld, ...rest } = anEmployment();

  return rest;
};
