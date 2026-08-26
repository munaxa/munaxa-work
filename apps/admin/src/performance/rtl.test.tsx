import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Figure, Isolated, Wrote, shownOf } from './frame';
import { performanceTranslator } from './locale';
import { CycleSummary, GoalsSection, ReviewQueueSection } from './register';
import {
  CategoriesSection,
  FrameworksSection,
  ScalesSection,
  TemplatesSection,
} from './configuration';
import { CalibrationSection, FeedbackSection, FindingsSection, TalentSection } from './outcomes';
import { RatingSection } from './review';
import { ProgressSection } from './goal';
import { aCycle, aFullRegister, aGoal, aReview } from './performance.fixture';

/**
 * Every Latin run inside Arabic, and what happens when one is not isolated.
 *
 * Two techniques, and both were found by looking at a rendered Arabic page rather than at code.
 *
 * **`<bdi>` alone is not enough for a value whose leading or trailing character is neutral.** A
 * decimal point, a percent sign and a minus are all *neutral* in the bidirectional algorithm, so
 * inside a right-to-left paragraph they take the paragraph's direction: `3.70` renders as `70.3`
 * and `60.00%` as `%60.00`. The Leave slice found this on a signed balance and Attendance on a
 * negative duration. `dir="ltr"` pins the isolate's own direction.
 *
 * **A ratio must be one isolate, not two.** Isolating only the total leaves the page count as a
 * second left-to-right run, and inside an Arabic paragraph the later run comes first: `2 / 4187`
 * renders as `4187 / 2`, which reads as a page bigger than its own total.
 */

const ar = performanceTranslator('ar');
const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('the isolation primitives', () => {
  it('isolates an identifier without forcing its direction', () => {
    expect(html(<Isolated>{'01930000-0000-7000-8000-00000000e001'}</Isolated>)).toBe(
      '<bdi>01930000-0000-7000-8000-00000000e001</bdi>',
    );
  });

  it('forces a score and a percentage left to right, because their separators are neutral', () => {
    expect(html(<Figure>{'3.70'}</Figure>)).toBe('<bdi dir="ltr">3.70</bdi>');
    expect(html(<Figure>{'60.00%'}</Figure>)).toBe('<bdi dir="ltr">60.00%</bdi>');
  });

  it('isolates free text so its own first strong character decides its direction', () => {
    // An English sentence in an Arabic table keeps its trailing full stop where it belongs.
    expect(html(<Wrote>{'Moderated against the peer group.'}</Wrote>)).toBe(
      '<bdi>Moderated against the peer group.</bdi>',
    );
  });

  it('renders a dash rather than an empty isolate for an absent value', () => {
    expect(html(<Wrote>{undefined}</Wrote>)).toBe('<span>—</span>');
  });

  it('puts the whole ratio in one isolate rather than isolating the total alone', () => {
    expect(html(<>{shownOf({ items: [1, 2], total: 4187 })}</>)).toBe('<bdi>2 / 4187</bdi>');
  });

  it('renders nothing at all for a listing that was refused', () => {
    expect(html(<>{shownOf(undefined)}</>)).toBe('');
  });
});

describe('every Latin run on an Arabic performance screen is isolated', () => {
  const full = aFullRegister();

  /**
   * Anything outside a `<bdi>` that is a run of Latin letters, digits or the separators around them
   * is a candidate for reordering. The catalogue's own Arabic text is Arabic, so what is left in
   * the stripped markup should be Arabic and punctuation only.
   */
  const unisolated = (markup: string): readonly string[] => {
    const withoutTags = markup
      .replaceAll(/<bdi[^>]*>.*?<\/bdi>/g, '')
      // Prose from the catalogue is the translator's own sentence, not a value this screen
      // composed. "must total 10,000 — one whole" carries a number the translator wrote into
      // Arabic text, and a plain integer inside an Arabic paragraph is ordered correctly by the
      // bidirectional algorithm without help. What this test is for is the values the *screen*
      // puts next to that prose, and none of these paragraphs interpolates one.
      .replaceAll(/<p\b[^>]*>.*?<\/p>/g, '')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll('&#x27;', "'");

    return withoutTags.match(/[A-Za-z0-9][A-Za-z0-9.,:%/-]*/g) ?? [];
  };

  it('leaves no bare identifier, score, percentage, date or ratio on the queue', () => {
    const markup = html(
      <ReviewQueueSection t={ar} language="ar" reviews={full.reviews} cycle={full.cycle} />,
    );

    // Permission names inside the withheld sentences are the module's own words, not values.
    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value on the goal list', () => {
    expect(unisolated(html(<GoalsSection t={ar} goals={full.goals} cycle={full.cycle} />))).toEqual(
      [],
    );
  });

  /**
   * A tenant's own cycle name commonly carries a year — "المراجعة السنوية 2026" — which is a Latin
   * digit run inside Arabic text. It is a value somebody stored, not a label this product ships, so
   * it goes through `<Wrote>` like every other authored value. Writing this assertion is what found
   * it: the summary rendered `nameIn(...)` bare, and so did four configuration sections.
   */
  it('leaves no bare value in the cycle summary, including a year inside a tenant name', () => {
    expect(unisolated(html(<CycleSummary t={ar} language="ar" cycle={aCycle()} />))).toEqual([]);
  });

  it('leaves no bare value on any configuration section', () => {
    const full = aFullRegister();
    const markup = [
      html(<ScalesSection t={ar} language="ar" scales={full.scales} />),
      html(<FrameworksSection t={ar} language="ar" frameworks={full.frameworks} />),
      html(<TemplatesSection t={ar} language="ar" templates={full.templates} />),
      html(<CategoriesSection t={ar} language="ar" categories={full.categories} />),
    ].join('');

    // Codes, versions, scores and every component weight. A bare `40.00%` renders as `%40.00`.
    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value on the calibration, talent, feedback or findings sections', () => {
    const full = aFullRegister();
    const markup = [
      html(<CalibrationSection t={ar} language="ar" sessions={full.sessions} cycle={full.cycle} />),
      html(<TalentSection t={ar} placements={full.placements} cycle={full.cycle} />),
      html(<FeedbackSection t={ar} language="ar" feedback={full.feedback} cycle={full.cycle} />),
      html(<FindingsSection t={ar} findings={full.findings} cycle={full.cycle} />),
    ].join('');

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value on the rating block', () => {
    const markup = html(
      <RatingSection
        t={ar}
        language="ar"
        review={aReview({ finalScore: 350, calibrated: true })}
        calibration={{
          calibrationDecisionId: 'd1',
          calibrationSessionId: 'n1',
          originalScore: 370,
          calibratedScore: 350,
          calibratedRatingLevelId: 'l2',
          reason: 'تمت المعايرة مقابل المجموعة',
          decidedAt: '2026-11-28T12:00:00.000Z',
          decidedBy: 'user:hr-director',
        }}
      />,
    );

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value on the progress history, including the exact measurement', () => {
    const markup = html(
      <ProgressSection
        t={ar}
        language="ar"
        goal={aGoal({ progress: aGoal().progress.slice(1) })}
      />,
    );

    expect(unisolated(markup)).toEqual([]);
  });
});

describe('an Arabic screen keeps its own direction', () => {
  it('renders Arabic text for every translated term', () => {
    const markup = html(<CycleSummary t={ar} language="ar" cycle={aCycle()} />);

    expect(markup).toContain('المراجعة السنوية 2026');
    expect(markup).toMatch(/[؀-ۿ]/);
  });
});
