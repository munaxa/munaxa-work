import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { performanceTranslator } from './locale';
import { RatingSection, ReviewHeader, WorkingSection } from './review';
import { AssessmentsSection, PanelSection, SnapshotSection } from './assessments';
import { GoalHeader, GoalStatement, ProgressSection } from './goal';
import { EMPLOYMENT_A, MANAGER, aCycle, aGoal, aReview } from './performance.fixture';
import { aReviewDetail, anEmployment, anEmploymentWithheldName } from './review.fixture';

/**
 * The two detail screens this slice added, asserted against their markup.
 *
 * These are the screens the product did not have. Every assertion here is about a fact the domain
 * published that the register could not show, or about a value the screen must not invent.
 */

const en = performanceTranslator('en');
const ar = performanceTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** `renderToStaticMarkup` escapes apostrophes, so a sentence containing one is looked up escaped. */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const detail = aReviewDetail();

describe('one review names its subject', () => {
  it('renders the person’s name when Employment answered, and keeps the identifier beside it', () => {
    const markup = html(
      <ReviewHeader
        t={en}
        language="en"
        review={detail.review}
        cycle={aCycle()}
        subject={anEmployment()}
        manager={undefined}
      />,
    );

    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain(EMPLOYMENT_A);
  });

  /** `personName` is present only when the caller may read the person. Absent is a boundary. */
  it('falls back to the identifier rather than a blank when Employment withheld the name', () => {
    const markup = html(
      <ReviewHeader
        t={en}
        language="en"
        review={detail.review}
        cycle={aCycle()}
        subject={anEmploymentWithheldName()}
        manager={undefined}
      />,
    );

    expect(markup).toContain(EMPLOYMENT_A);
    expect(markup).not.toContain('Layla Haddad');
  });

  it('names the cycle rather than showing its identifier when the list answered', () => {
    const markup = html(
      <ReviewHeader
        t={en}
        language="en"
        review={detail.review}
        cycle={aCycle()}
        subject={undefined}
        manager={undefined}
      />,
    );

    expect(markup).toContain('Annual review 2026');
    expect(markup).toContain('FY26-ANNUAL');
  });

  it('shows the manager identifier in full', () => {
    const markup = html(
      <ReviewHeader
        t={en}
        language="en"
        review={detail.review}
        cycle={undefined}
        subject={undefined}
        manager={undefined}
      />,
    );

    expect(markup).toContain(MANAGER);
  });
});

describe('the rating shows what was published and nothing else', () => {
  it('shows no final score for a review that has none', () => {
    const markup = html(
      <RatingSection t={en} language="en" review={detail.review} calibration={undefined} />,
    );

    expect(markup.match(/3\.70/g)).toHaveLength(1);
    expect(markup).not.toContain('4.20');
  });

  it('says no calibration decision was recorded rather than leaving the block blank', () => {
    const markup = html(
      <RatingSection t={en} language="en" review={detail.review} calibration={undefined} />,
    );

    expect(markup).toContain(escaped(en('performance.withheld.notCalibrated')));
  });

  it('keeps the original score beside the calibrated one rather than replacing it', () => {
    const markup = html(
      <RatingSection
        t={en}
        language="en"
        review={aReview({ finalScore: 350, calibrated: true })}
        calibration={{
          calibrationDecisionId: 'd1',
          calibrationSessionId: 'n1',
          originalScore: 370,
          calibratedScore: 350,
          calibratedRatingLevelId: 'l2',
          reason: 'Moderated against the peer group.',
          decidedAt: '2026-11-28T12:00:00.000Z',
          decidedBy: 'user:hr-director',
        }}
      />,
    );

    expect(markup).toContain('3.70');
    expect(markup).toContain('3.50');
    expect(markup).toContain(escaped(en('performance.notice.calibrationKept')));
  });
});

describe('the working shows what left the denominator, and why', () => {
  it('shows the weight beside the denominator, because they differ when something was excluded', () => {
    const markup = html(<WorkingSection t={en} detail={detail} />);

    expect(markup).toContain('60.00%');
    expect(markup).toContain('40.00%');
    // The excluded component's denominator is zero, and that is the arithmetic being shown.
    expect(markup).toContain('0.00%');
  });

  it('renders the recorded exclusion reason rather than inferring one from a missing score', () => {
    const markup = html(<WorkingSection t={en} detail={detail} />);

    expect(markup).toContain(en('performance.vocabulary.exclusionReason.not_applicable'));
  });

  it('says the review is not scored rather than showing an empty table', () => {
    const markup = html(<WorkingSection t={en} detail={aReviewDetail({ componentScores: [] })} />);

    expect(markup).toContain(escaped(en('performance.notice.notScored')));
  });
});

describe('the panel is confidential, never anonymous', () => {
  it('names every reviewer and claims no anonymity', () => {
    const markup = html(
      <PanelSection
        t={en}
        language="en"
        reviewers={detail.reviewers}
        aggregate={detail.peerAggregate}
      />,
    );

    expect(markup).not.toMatch(/[Aa]nonymous(?!\.)/);
    expect(markup).toContain(escaped(en('performance.notice.aggregateWithheld')));
  });

  /**
   * When the aggregate *is* available the panel used to print "confidential, not anonymous" — the
   * same sentence the page's boundary footer already carries. Running the page showed it twice.
   */
  it('does not repeat the boundary footnote when the aggregate is available', () => {
    const markup = html(
      <PanelSection
        t={en}
        language="en"
        reviewers={detail.reviewers}
        aggregate={{ available: true, responseCount: 4, minimumResponses: 3, averageScore: 390 }}
      />,
    );

    expect(markup).toContain('3.90');
    expect(markup).not.toContain(escaped(en('performance.notice.notAnonymous')));
  });

  it('withholds the aggregate below the minimum rather than showing a zero', () => {
    const markup = html(
      <PanelSection
        t={en}
        language="en"
        reviewers={detail.reviewers}
        aggregate={detail.peerAggregate}
      />,
    );

    // Two responses of a required three are both shown; no average is.
    expect(markup).toContain('>2<');
    expect(markup).toContain('>3<');
    expect(markup).toContain('—');
  });
});

describe('which assessment counts is said beside each one', () => {
  it('marks the manager assessment as the one the score derives from', () => {
    const markup = html(
      <AssessmentsSection t={en} language="en" assessments={detail.assessments} />,
    );

    expect(markup).toContain(escaped(en('performance.notice.managerCounted')));
    expect(markup).toContain(escaped(en('performance.notice.selfNotCounted')));
  });

  it('opens an assessed goal, and leaves a competency as an identifier', () => {
    const markup = html(
      <AssessmentsSection t={en} language="en" assessments={detail.assessments} />,
    );

    expect(markup).toContain('href="/performance/goals/');
    // Performance publishes no read for one competency, so a competency stays an identifier.
    expect(markup).toContain('01930000-0000-7000-8000-00000000k001');
    expect(markup).not.toContain('href="/performance/competencies');
  });

  it('shows a self assessment’s score without implying it contributed', () => {
    const markup = html(
      <AssessmentsSection t={en} language="en" assessments={detail.assessments} />,
    );

    expect(markup).toContain('4.20');
    expect(markup).not.toContain(en('performance.label.contribution'));
  });
});

describe('the completion snapshot', () => {
  it('says a snapshot is taken on completion rather than showing an empty block', () => {
    const markup = html(<SnapshotSection t={en} language="en" snapshot={undefined} />);

    expect(markup).toContain(escaped(en('performance.notice.noSnapshot')));
  });
});

describe('one goal, with the history recorded against it', () => {
  it('renders the exact measurement digit for digit, past what a double can hold', () => {
    const markup = html(<ProgressSection t={en} language="en" goal={aGoal()} />);

    expect(markup).toContain('9007199254740993');
    expect(markup).not.toContain('9007199254740992');
  });

  it('shows an evidence document as an identifier with no link', () => {
    const markup = html(<ProgressSection t={en} language="en" goal={aGoal()} />);

    expect(markup).toContain('01930000-0000-7000-8000-00000000d001');
    expect(markup).not.toContain('href="/documents');
  });

  /**
   * The progress table used to repeat the boundary footnote verbatim beneath itself. Running the
   * page showed the same sentence twice, four lines apart. It is said once, in the footer.
   */
  it('does not repeat the boundary footnote beneath the table', () => {
    const markup = html(<ProgressSection t={en} language="en" goal={aGoal()} />);

    expect(markup).not.toContain(escaped(en('performance.notice.noDocumentBytes')));
  });

  it('says nothing was recorded rather than rendering an empty table', () => {
    const markup = html(<ProgressSection t={en} language="en" goal={aGoal({ progress: [] })} />);

    expect(markup).toContain(escaped(en('performance.notice.noProgress')));
  });

  it('renders what the goal actually says, not only what it is worth', () => {
    const markup = html(<GoalStatement t={en} goal={aGoal()} />);

    expect(markup).toContain(escaped('Bring the consolidated close inside five working days'));
    expect(markup).toContain(escaped('Five working days or fewer'));
  });

  it('names the category and the cycle from the lists the page already read', () => {
    const markup = html(
      <GoalHeader
        t={en}
        language="en"
        goal={aGoal()}
        cycle={aCycle()}
        owner={undefined}
        category={{
          goalCategoryId: 'y1',
          code: 'OPERATIONAL',
          name: { en: 'Operational', ar: 'تشغيلي' },
          active: true,
          version: 1,
        }}
      />,
    );

    expect(markup).toContain('Operational');
    expect(markup).toContain('Annual review 2026');
    expect(markup).toContain('30.00%');
  });
});

describe('both languages on both detail screens, and no raw key in either', () => {
  const screens = (t: typeof en): readonly ReactNode[] => [
    <ReviewHeader
      key="h"
      t={t}
      language="en"
      review={detail.review}
      cycle={aCycle()}
      subject={anEmployment()}
      manager={anEmployment()}
    />,
    <RatingSection key="r" t={t} language="en" review={detail.review} calibration={undefined} />,
    <WorkingSection key="w" t={t} detail={detail} />,
    <PanelSection
      key="p"
      t={t}
      language="en"
      reviewers={detail.reviewers}
      aggregate={detail.peerAggregate}
    />,
    <AssessmentsSection key="a" t={t} language="en" assessments={detail.assessments} />,
    <SnapshotSection key="s" t={t} language="en" snapshot={undefined} />,
    <GoalHeader
      key="g"
      t={t}
      language="en"
      goal={aGoal()}
      cycle={aCycle()}
      owner={anEmployment()}
      category={undefined}
    />,
    <GoalStatement key="t" t={t} goal={aGoal()} />,
    <ProgressSection key="o" t={t} language="en" goal={aGoal()} />,
  ];

  for (const [language, t] of [
    ['en', en],
    ['ar', ar],
  ] as const) {
    it(`renders ${language} with no catalogue key reaching the markup`, () => {
      const markup = screens(t).map(html).join('');

      expect(markup).not.toMatch(/performance\.(label|notice|vocabulary|withheld)\.[a-zA-Z]/);
    });
  }
});
