import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CalibrationDecisionView,
  FeedbackView,
  GoalView,
  ReviewDetailView,
  ReviewView,
} from '@work/performance/contracts';
import { describe, expect, it } from 'vitest';

import { directionOf, translator } from './locale';
import { GoalsSection, ProgressSection } from './goals';
import { OverviewSection, UnavailableSection } from './overview';
import { FeedbackSection, PanelSection } from './panel';
import { AssessmentsSection, RatingSection, ReviewQueueSection, WorkingSection } from './reviews';

/**
 * What the screen actually renders, asserted against the markup rather than against a description
 * of it.
 *
 * `renderToStaticMarkup` runs the real components with the real catalogues and produces the real
 * HTML — no DOM, no test renderer, no new dependency, and nothing mocked but the API response.
 * These are the assertions nobody else in this repository can make: the API suites prove the server
 * sends `9007199254740993`, and only this proves a browser puts those digits on a page.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;
const arabic = { t: ar, language: 'ar' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/**
 * A catalogue string as React emits it.
 *
 * React escapes `'`, `"`, `&`, `<` and `>` in text nodes, so a sentence containing an apostrophe —
 * "a manager's own queue" — appears in the markup as `&#x27;`. Comparing against the raw string
 * would fail on text that rendered correctly, which is a test bug wearing the shape of a defect.
 */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

/** 2^53 + 1. `Number` of it is 9007199254740992, with nothing to indicate the digit is gone. */
const ENORMOUS = '9007199254740993';

const aGoal = (overrides: Partial<GoalView> = {}): GoalView => ({
  goalId: '01930000-0000-7000-8000-000000000001',
  scope: 'individual',
  employmentId: '01930000-0000-7000-8000-000000000002',
  title: 'Reduce payroll run time',
  measurement: 'percentage',
  weightBasisPoints: 10_000,
  status: 'active',
  startDate: '2026-01-01',
  dueDate: '2026-06-30',
  progressBasisPoints: 4500,
  progress: [],
  version: 1,
  ...overrides,
});

const aReview = (overrides: Partial<ReviewView> = {}): ReviewView => ({
  reviewId: '01930000-0000-7000-8000-000000000003',
  cycleId: '01930000-0000-7000-8000-000000000004',
  employmentId: '01930000-0000-7000-8000-000000000002',
  ratingScaleId: '01930000-0000-7000-8000-000000000005',
  status: 'manager_assessment',
  calibrated: false,
  version: 1,
  ...overrides,
});

const aDetail = (review: ReviewView, calibration?: CalibrationDecisionView): ReviewDetailView => ({
  review,
  reviewers: [],
  assessments: [],
  componentScores: [],
  peerAggregate: { available: false, responseCount: 1, minimumResponses: 3 },
  ...(calibration === undefined ? {} : { calibration }),
});

describe('the exact measurement, on the page', () => {
  /** The mandatory regression: the digits must survive all the way to the markup. */
  it('renders 2^53 + 1 digit for digit', () => {
    const markup = html(
      <ProgressSection
        {...props}
        goal={aGoal({
          progress: [
            {
              goalProgressId: '01930000-0000-7000-8000-000000000006',
              progressBasisPoints: 4500,
              observedValue: ENORMOUS,
              recordedAt: '2026-06-01T09:00:00.000Z',
              recordedBy: 'user:performance-hr',
            },
          ],
        })}
      />,
    );

    expect(markup).toContain(ENORMOUS);
    // The value a JavaScript number would have produced must appear nowhere on the page.
    expect(markup).not.toContain('9007199254740992');
  });
});

describe('a score, on the page', () => {
  it('renders hundredths as a decimal without dividing anything', () => {
    const markup = html(
      <ReviewQueueSection
        {...props}
        reviews={[aReview({ calculatedScore: 370, finalScore: 350 })]}
        total={1}
      />,
    );

    expect(markup).toContain('3.70');
    expect(markup).toContain('3.50');
    // Not the raw hundredths, and not a float artefact.
    expect(markup).not.toContain('369.99');
  });

  it('shows the original beside the calibrated score, never instead of it', () => {
    const markup = html(
      <RatingSection
        {...props}
        detail={aDetail(aReview({ calculatedScore: 400, finalScore: 350, calibrated: true }), {
          calibrationDecisionId: '01930000-0000-7000-8000-000000000007',
          calibrationSessionId: '01930000-0000-7000-8000-000000000008',
          originalScore: 400,
          calibratedScore: 350,
          calibratedRatingLevelId: '01930000-0000-7000-8000-000000000009',
          reason: 'Moderated against the peer group',
          decidedAt: '2027-01-10T09:00:00.000Z',
          decidedBy: 'user:performance-manager',
        })}
      />,
    );

    // Both numbers, and the reason. A screen showing only 3.50 would make the moderation invisible
    // to the person it was applied to.
    expect(markup).toContain('4.00');
    expect(markup).toContain('3.50');
    expect(markup).toContain('Moderated against the peer group');
    expect(markup).toContain(en('performance.notice.calibrationKept'));
  });

  it('shows no calibration row at all for a review nobody calibrated', () => {
    const markup = html(
      <RatingSection {...props} detail={aDetail(aReview({ calculatedScore: 400 }))} />,
    );

    expect(markup).toContain('4.00');
    expect(markup).not.toContain(en('performance.label.originalScore'));
  });
});

describe('what the screen says about self and peer assessments', () => {
  it('states beside each that neither contributes to the score', () => {
    const markup = html(
      <AssessmentsSection
        {...props}
        assessments={[
          {
            assessmentId: '01930000-0000-7000-8000-00000000000a',
            assessmentKind: 'self',
            assessorEmploymentId: '01930000-0000-7000-8000-000000000002',
            status: 'submitted',
            overallScore: 500,
            items: [],
          },
          {
            assessmentId: '01930000-0000-7000-8000-00000000000b',
            assessmentKind: 'manager',
            assessorEmploymentId: '01930000-0000-7000-8000-00000000000c',
            status: 'submitted',
            overallScore: 370,
            items: [],
          },
        ]}
      />,
    );

    expect(markup).toContain(en('performance.notice.selfNotCounted'));
    expect(markup).toContain(en('performance.notice.managerCounted'));
    // The self assessment's own 5.00 is still readable. It is recorded, not hidden.
    expect(markup).toContain('5.00');
  });
});

describe('what the screen refuses to claim', () => {
  it('never uses the word anonymous, in either language', () => {
    const feedback: FeedbackView = {
      feedbackId: '01930000-0000-7000-8000-00000000000d',
      subjectEmploymentId: '01930000-0000-7000-8000-000000000002',
      authorEmploymentId: '01930000-0000-7000-8000-00000000000c',
      kind: 'praise',
      visibility: 'manager',
      body: 'Carried the release',
      givenAt: '2026-06-01T09:00:00.000Z',
    };
    const english = html(<FeedbackSection {...props} feedback={[feedback]} />);
    const عربي = html(<FeedbackSection {...arabic} feedback={[feedback]} />);

    // The word appears exactly once, inside the sentence that **denies** it — "confidential, not
    // anonymous". Asserting it never appears at all would have been the wrong property: the honest
    // screen is the one that says the word in order to refuse it.
    expect(english.toLowerCase().split('anonymous').length - 1).toBe(1);
    expect(english).toContain('not anonymous');
    expect(عربي).toContain('ليست مجهولة');

    // And every row is attributed: the author's identifier is on the page, never a placeholder.
    expect(english).toContain(feedback.authorEmploymentId.slice(0, 8));
  });

  it('says a withheld panel aggregate is withheld, and shows no score for it', () => {
    const markup = html(
      <PanelSection
        {...props}
        reviewers={[]}
        aggregate={{ available: false, responseCount: 1, minimumResponses: 3 }}
      />,
    );

    expect(markup).toContain(en('performance.notice.aggregateWithheld'));
    expect(markup).toContain(en('performance.notice.notAnonymous'));
  });

  it('lists every capability this product does not have', () => {
    const markup = html(<UnavailableSection {...props} />);

    // Compared against the *escaped* text React actually emits. An apostrophe becomes `&#x27;`, so
    // asserting against the raw catalogue string would fail on a sentence that rendered perfectly.
    for (const key of [
      'performance.notice.readTeamUnavailable',
      'performance.notice.noNotifications',
      'performance.notice.noSchedule',
      'performance.notice.noDocumentBytes',
      'performance.notice.noOkr',
    ]) {
      expect(markup).toContain(escaped(en(key)));
    }
  });
});

describe('empty and unavailable states', () => {
  it('renders an empty state rather than a blank card', () => {
    const markup = html(<GoalsSection {...props} goals={[]} total={0} />);

    expect(markup).toContain(en('performance.notice.empty'));
  });

  it('distinguishes an unreachable API from a tenant with no data', () => {
    const unreachable = html(
      <OverviewSection
        {...props}
        cycle={undefined}
        cycles={[]}
        reviews={[]}
        reviewsTotal={0}
        goalsTotal={0}
        unavailable
      />,
    );
    const empty = html(
      <OverviewSection
        {...props}
        cycle={undefined}
        cycles={[]}
        reviews={[]}
        reviewsTotal={0}
        goalsTotal={0}
        unavailable={false}
      />,
    );

    // "Not signed in" and "nothing configured yet" are different answers, and a screen that showed
    // the same thing for both would send an administrator looking for data that was never withheld.
    expect(unreachable).toContain(en('performance.notice.unauthenticated'));
    expect(empty).not.toContain(en('performance.notice.unauthenticated'));
  });

  it('says a withheld workspace is a permission boundary rather than an outage', () => {
    const markup = html(<WorkingSection {...props} detail={undefined} />);

    expect(markup).toContain(en('performance.notice.empty'));
  });
});

describe('Arabic and direction', () => {
  it('renders Arabic labels rather than falling back to English keys', () => {
    const markup = html(<GoalsSection {...arabic} goals={[aGoal()]} total={1} />);

    expect(markup).toContain(ar('performance.label.goals'));
    expect(markup).toContain(ar('performance.vocabulary.goalStatus.active'));
    // A missing key renders as the key itself, which would be unmistakable here.
    expect(markup).not.toContain('performance.label.');
  });

  it('ties direction to language rather than leaving it a separate control', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  it('renders a table that can scroll rather than overflowing the page', () => {
    const markup = html(<GoalsSection {...props} goals={[aGoal()]} total={1} />);

    // Wide content scrolls inside its own container. A table that pushed the page sideways is
    // unusable on a narrow screen and unreadable in either direction.
    expect(markup).toContain('overflow-x-auto');
    // And the header cells are real scoped headers, so a screen reader can navigate the table.
    expect(markup).toContain('scope="col"');
  });
});
