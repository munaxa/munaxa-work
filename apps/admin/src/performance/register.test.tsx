import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { performanceTranslator } from './locale';
import { registerAnsweredNothing, runningCycle } from './api';
import { CycleSummary, CyclesSection, GoalsSection, ReviewQueueSection } from './register';
import { CalibrationSection, FeedbackSection, FindingsSection, TalentSection } from './outcomes';
import {
  CategoriesSection,
  FrameworksSection,
  ScalesSection,
  TemplatesSection,
} from './configuration';
import {
  EMPLOYMENT_A,
  EMPLOYMENT_B,
  GOAL_A,
  GOAL_B,
  REVIEW_A,
  REVIEW_B,
  aCycle,
  aFullRegister,
  aReview,
  aPartlyWithheldRegister,
  aRefusedRegister,
  anEmptyRegister,
} from './performance.fixture';

/**
 * The performance register, asserted against the markup rather than a description of it.
 *
 * Each assertion is anchored to a defect the direction investigation named in the screen this
 * replaced, so none of them can come back quietly. The three that matter most are that every review
 * and every goal opens, that no figure on the page was counted in the browser, and that a refused
 * section never renders as an empty one.
 */

const en = performanceTranslator('en');
const ar = performanceTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** An `href` as it lands in an attribute: only `&` is escaped there, not the quotes around it. */
const attribute = (href: string): string => `href="${href}"`;

const full = aFullRegister();

describe('the review queue opens one review', () => {
  it('links every row to that review’s own route', () => {
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={full.reviews} cycle={full.cycle} />,
    );

    expect(markup).toContain(attribute(`/performance/reviews/${REVIEW_A}`));
    expect(markup).toContain(attribute(`/performance/reviews/${REVIEW_B}`));
  });

  /**
   * The screen this replaced rendered a review's rating, working, assessments and panel from
   * `reviews.items[0]` across four sections that named no review at all.
   */
  it('renders no review detail on the register at all', () => {
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={full.reviews} cycle={full.cycle} />,
    );

    for (const detail of [
      en('performance.label.components'),
      en('performance.label.panel'),
      en('performance.label.assessments'),
      en('performance.label.snapshot'),
    ]) {
      expect([detail, markup.includes(detail)]).toEqual([detail, false]);
    }
  });

  it('shows the server’s total beside the rows it received, never the row count alone', () => {
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={full.reviews} cycle={full.cycle} />,
    );

    // Two rows of four thousand one hundred and eighty-seven.
    expect(markup).toContain('2 / 4187');
  });

  it('renders both employment identifiers in full', () => {
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={full.reviews} cycle={full.cycle} />,
    );

    expect(markup).toContain(EMPLOYMENT_A);
    expect(markup).toContain(EMPLOYMENT_B);
    // The eight-character prefix the old `short()` produced is shared by every fixture identifier.
    expect(markup).not.toContain('01930000…');
  });

  /**
   * A review scored but not completed has no final score. The screen this replaced substituted the
   * calculated one under a heading that said final, which says a rating is settled when it is not.
   */
  it('leaves a final score absent rather than substituting the calculated one', () => {
    // One row, scored and not completed: `calculatedScore` 370, `finalScore` genuinely absent.
    const scored = { items: [aReview()], total: 1 };
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={scored} cycle={full.cycle} />,
    );

    // The calculated score appears exactly once — in its own column, not repeated into final's.
    expect(markup.match(/3\.70/g)).toHaveLength(1);
    // And the final-score cell carries the dash this product uses for an absent value.
    expect(markup).toContain('—');
  });
});

describe('the goal list opens one goal', () => {
  it('links every row to that goal’s own route', () => {
    const markup = html(<GoalsSection t={en} goals={full.goals} cycle={full.cycle} />);

    expect(markup).toContain(attribute(`/performance/goals/${GOAL_A}`));
    expect(markup).toContain(attribute(`/performance/goals/${GOAL_B}`));
  });

  it('renders no progress history on the register', () => {
    const markup = html(<GoalsSection t={en} goals={full.goals} cycle={full.cycle} />);

    expect(markup).not.toContain(en('performance.label.observedValue'));
    expect(markup).not.toContain('9007199254740993');
  });

  it('shows the server’s total, not the two rows it was given', () => {
    expect(html(<GoalsSection t={en} goals={full.goals} cycle={full.cycle} />)).toContain(
      '2 / 1284',
    );
  });
});

describe('nothing on the register is counted in the browser', () => {
  /**
   * The old overview showed four figures. One was the cycle's own `participantCount`; the other
   * three were `reviews.filter(...).length` over a page of fifty. `awaitingCalibration` was worse
   * than a miscount — it derived a state the domain does not publish, from "has a score and is not
   * completed".
   */
  it('shows the cycle’s own participant count and no derived counter', () => {
    const markup = html(<CycleSummary t={en} language="en" cycle={full.cycle} />);

    expect(markup).toContain('4187');
    for (const gone of [
      'awaitingCalibration',
      'awaitingManager',
      'reviewsCompleted',
      'openCycles',
    ]) {
      const label = en(`performance.label.${gone}`);

      expect([gone, markup.includes(label)]).toEqual([gone, false]);
    }
  });
});

describe('refused, empty and populated are three different answers', () => {
  it('says withheld — naming the permission — when a read was refused', () => {
    const withheld = aPartlyWithheldRegister();
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={withheld.reviews} cycle={withheld.cycle} />,
    );

    expect(markup).toContain('performance.review.read-team');
    expect(markup).not.toContain(en('performance.notice.noReviews'));
  });

  it('says nothing exists when the read answered and was empty', () => {
    const empty = anEmptyRegister();
    const markup = html(<CyclesSection t={en} language="en" cycles={empty.cycles} />);

    expect(markup).toContain(en('performance.notice.noCycles'));
    expect(markup).not.toContain('performance.cycle.read');
  });

  it('names a different permission for each independently refused section', () => {
    const withheld = aPartlyWithheldRegister();

    expect(
      html(<TalentSection t={en} placements={withheld.placements} cycle={withheld.cycle} />),
    ).toContain('performance.talent.read');
    expect(
      html(
        <CalibrationSection
          t={en}
          language="en"
          sessions={withheld.sessions}
          cycle={withheld.cycle}
        />,
      ),
    ).toContain('performance.calibrate');
    expect(
      html(<FindingsSection t={en} findings={withheld.findings} cycle={withheld.cycle} />),
    ).toContain('performance.reconcile');
    expect(
      html(
        <FeedbackSection
          t={en}
          language="en"
          feedback={withheld.feedback}
          cycle={withheld.cycle}
        />,
      ),
    ).toContain('performance.feedback.read-team');
  });

  it('reports that nothing answered only when nothing did', () => {
    expect(registerAnsweredNothing(aRefusedRegister())).toBe(true);
    expect(registerAnsweredNothing(anEmptyRegister())).toBe(false);
    expect(registerAnsweredNothing(full)).toBe(false);
  });
});

describe('which cycle the scoped listings describe', () => {
  it('picks the running one rather than whichever sorted first', () => {
    const closed = aCycle({ cycleId: 'closed', status: 'closed' });
    const running = aCycle({ cycleId: 'running', status: 'in_progress' });

    expect(runningCycle([closed, running])?.cycleId).toBe('running');
  });

  it('falls back to the first cycle when none is running, rather than to nothing', () => {
    const closed = aCycle({ cycleId: 'closed', status: 'closed' });

    expect(runningCycle([closed])?.cycleId).toBe('closed');
    expect(runningCycle([])).toBeUndefined();
  });

  it('names the cycle beside every listing it scopes', () => {
    const markup = html(
      <ReviewQueueSection t={en} language="en" reviews={full.reviews} cycle={full.cycle} />,
    );

    expect(markup).toContain(en('performance.notice.scopedToCycle'));
  });

  it('renders no cycle-scoped section at all when there is no cycle', () => {
    const empty = anEmptyRegister();

    expect(
      html(<ReviewQueueSection t={en} language="en" reviews={empty.reviews} cycle={undefined} />),
    ).toBe('');
    expect(html(<GoalsSection t={en} goals={empty.goals} cycle={undefined} />)).toBe('');
  });
});

describe('the configuration the tenant rates against', () => {
  it('renders each section from the one permission that answers all four', () => {
    expect(html(<ScalesSection t={en} language="en" scales={full.scales} />)).toContain(
      'FIVE-POINT',
    );
    expect(html(<FrameworksSection t={en} language="en" frameworks={full.frameworks} />)).toContain(
      'CORE-2026',
    );
    expect(html(<TemplatesSection t={en} language="en" templates={full.templates} />)).toContain(
      'ANNUAL-STD',
    );
    expect(html(<CategoriesSection t={en} language="en" categories={full.categories} />)).toContain(
      'OPERATIONAL',
    );
  });

  it('shows each component weight as published and adds none of them up', () => {
    const markup = html(<TemplatesSection t={en} language="en" templates={full.templates} />);

    expect(markup).toContain('60.00%');
    expect(markup).toContain('40.00%');
    // 10,000 basis points is the total the domain enforces. This screen never renders a sum.
    expect(markup).not.toContain('100.00%');
  });
});

describe('both languages, and no raw key in either', () => {
  const sections = (t: typeof en): readonly ReactNode[] => [
    <CycleSummary key="c" t={t} language="en" cycle={full.cycle} />,
    <ReviewQueueSection key="r" t={t} language="en" reviews={full.reviews} cycle={full.cycle} />,
    <GoalsSection key="g" t={t} goals={full.goals} cycle={full.cycle} />,
    <CyclesSection key="y" t={t} language="en" cycles={full.cycles} />,
    <TalentSection key="t" t={t} placements={full.placements} cycle={full.cycle} />,
    <FeedbackSection key="f" t={t} language="en" feedback={full.feedback} cycle={full.cycle} />,
    <FindingsSection key="n" t={t} findings={full.findings} cycle={full.cycle} />,
    <CalibrationSection key="b" t={t} language="en" sessions={full.sessions} cycle={full.cycle} />,
  ];

  for (const [language, t] of [
    ['en', en],
    ['ar', ar],
  ] as const) {
    it(`renders ${language} with no catalogue key reaching the markup`, () => {
      const markup = sections(t).map(html).join('');

      // A key that resolved to itself is a missing translation on a customer's screen.
      expect(markup).not.toMatch(/performance\.(label|notice|vocabulary)\.[a-zA-Z]/);
    });
  }
});
