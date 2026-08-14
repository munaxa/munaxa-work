import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { translator } from './locale';
import { civil, count } from './exact';
import { SummarySection } from './overview';
import { PathsSection, PlansSection, StagesSection } from './paths';
import { MembershipsSection } from './pools';
import { BenchSection, SuccessionSection, SuccessorsSection } from './succession';
import { LevelsSection, ReadinessSection } from './readiness';
import { ItemsSection, MobilitySection } from './development';
import { StatusSection } from './status';
import {
  aBench,
  aDevelopmentDetail,
  aLevel,
  aMembership,
  aPath,
  aPathDetail,
  aPlan,
  aReadinessHistory,
  aRecommendation,
  aSuccessionDetail,
  aSuccessionPlan,
  aSummary,
} from './views.fixture';

/**
 * What the screen refuses to claim, and the two kinds of value it must not convert.
 *
 * The render suite proves the workspaces appear. This half proves the harder property: that nothing
 * on the page overstates what this product does. A civil date keeps the day the domain stored, an
 * ordinal keeps the integer a human chose, a derived answer carries the day it was derived for, and
 * every capability that does not exist is named rather than left for somebody to infer from an
 * empty table.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;
const arabic = { t: ar, language: 'ar' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

/**
 * The text of every heading, column header and figure label in the markup.
 *
 * The distinction this exists for. A screen that *states* it cannot list critical positions has to
 * use the words "critical positions" to say so, and a screen that says it shows no nine-box band has
 * to name the nine-box. A blanket "this word never appears" assertion therefore fails on the very
 * sentence that makes the refusal honest — it would force the page to stop explaining itself, which
 * is the opposite of what these tests are for.
 *
 * A *claim*, by contrast, lives in a structural position: a section heading, a `<th scope="col">`, a
 * `<dt>` label. Those are the places a reader takes a word as a description of the data beneath it,
 * and those are what this searches.
 */
const labels = (markup: string): string =>
  [...markup.matchAll(/<(?:h2|th|dt)\b[^>]*>([\s\S]*?)<\/(?:h2|th|dt)>/g)]
    .map((match) => match[1] ?? '')
    .join(' | ')
    .toLowerCase();

describe('civil dates, on the page', () => {
  /**
   * The mandatory regression: the characters must survive all the way to the markup.
   *
   * `2026-02-28` is the case that breaks. `new Date('2026-02-28').toLocaleDateString()` on a server
   * west of UTC renders the 27th — a career plan that started a day early, an assessment attributed
   * to the wrong day, a membership that began before it did.
   */
  it('renders 2026-02-28 as 2026-02-28 in both languages', () => {
    for (const [label, markup] of [
      ['paths', html(<PathsSection {...props} paths={[aPath()]} total={1} />)],
      ['plans', html(<PlansSection {...props} plans={[aPlan()]} total={1} />)],
      [
        'memberships',
        html(<MembershipsSection {...props} memberships={[aMembership()]} total={1} />),
      ],
      ['readiness', html(<ReadinessSection {...props} history={aReadinessHistory()} />)],
      ['bench', html(<BenchSection {...props} bench={aBench()} />)],
      ['arabic', html(<PathsSection {...arabic} paths={[aPath()]} total={1} />)],
    ] as const) {
      expect([label, markup.includes('2026-02-28')]).toEqual([label, true]);
      // The day a `Date` round trip produces west of UTC, and the Arabic-Indic digits a
      // `toLocaleDateString` produces in Arabic. Neither may appear.
      expect([label, markup.includes('2026-02-27')]).toEqual([label, false]);
      expect([label, markup.includes('٢٠٢٦')]).toEqual([label, false]);
    }
  });

  it('is an identity function, and would be caught if somebody replaced it', () => {
    expect(civil('2026-02-28')).toBe('2026-02-28');
    expect(civil('2024-02-29')).toBe('2024-02-29');
    expect(civil(undefined)).toBe('—');
    // The conversion the function exists to prevent produces a different string.
    expect(new Date('2026-02-28T00:00:00Z').toDateString()).not.toContain('2026-02-28');
  });
});

describe('exact integers, on the page', () => {
  /**
   * The three integer boundaries the API can carry, at their domain maxima.
   *
   * A stage sequence of 500, a successor rank of 50 and a readiness ordinal of 100 are the largest
   * values the domain accepts. Each must appear as the integer it is: `toLocaleString` would render
   * 500 as `٥٠٠` in Arabic and would insert a separator the moment a bound moved, and `toFixed`
   * would render a rank as `50.00`.
   */
  it('renders the largest sequence, rank and ordinal exactly, in both languages', () => {
    for (const [label, markup] of [
      ['sequence-en', html(<StagesSection {...props} detail={aPathDetail()} />)],
      ['sequence-ar', html(<StagesSection {...arabic} detail={aPathDetail()} />)],
      ['rank-en', html(<SuccessorsSection {...props} detail={aSuccessionDetail()} />)],
      ['rank-ar', html(<SuccessorsSection {...arabic} detail={aSuccessionDetail()} />)],
      ['ordinal-en', html(<LevelsSection {...props} levels={[aLevel()]} />)],
      ['ordinal-ar', html(<LevelsSection {...arabic} levels={[aLevel()]} />)],
    ] as const) {
      const expected = label.startsWith('sequence')
        ? '500'
        : label.startsWith('rank')
          ? '50'
          : '100';

      // The exact cell, not a substring: `>500<` cannot match inside `>5000<`.
      expect([label, markup.includes(`>${expected}<`)]).toEqual([label, true]);
      // No decimal point was introduced anywhere a number is rendered.
      expect([label, markup.includes(`>${expected}.`)]).toEqual([label, false]);
    }
  });

  it('renders a large server total without a separator or a localized digit', () => {
    const markup = html(<BenchSection {...arabic} bench={aBench()} />);

    // Four thousand nominated, in Arabic. Not `4,000`, not `٤٬٠٠٠`.
    expect(markup).toContain('4000');
    expect(markup).not.toContain('4,000');
    expect(markup).not.toContain('٤');
  });

  it('is an identity function, and would be caught if somebody localized it', () => {
    expect(count(500)).toBe('500');
    expect(count(4000)).toBe('4000');
    expect(count(undefined)).toBe('—');
    // The conversion the function exists to prevent produces a different string.
    expect((4000).toLocaleString('ar-EG')).not.toBe('4000');
  });
});

describe('derived answers carry the day they were derived for', () => {
  it('prints the server’s asOf beside every derived value, and never a browser clock', () => {
    for (const [label, markup] of [
      ['stages', html(<StagesSection {...props} detail={aPathDetail()} />)],
      ['successors', html(<SuccessorsSection {...props} detail={aSuccessionDetail()} />)],
      ['bench', html(<BenchSection {...props} bench={aBench()} />)],
      [
        'mobility',
        html(
          <MobilitySection
            {...props}
            recommendations={[aRecommendation()]}
            total={1}
            asOf="2026-02-28"
          />,
        ),
      ],
    ] as const) {
      expect([label, markup.includes('2026-02-28')]).toEqual([label, true]);
      expect([label, markup.includes(en('career.label.asOf'))]).toEqual([label, true]);
    }
  });

  it('shows a stored status and a derived standing as two separate facts', () => {
    // The fixture is stored `proposed` and stands `expired` — the same row, two different answers.
    const markup = html(
      <MobilitySection
        {...props}
        recommendations={[aRecommendation()]}
        total={1}
        asOf="2026-02-28"
      />,
    );

    expect(markup).toContain(en('career.vocabulary.mobilityStatus.proposed'));
    expect(markup).toContain(en('career.vocabulary.mobilityStatus.expired'));
    // And the page says nothing expired it.
    expect(markup).toContain(escaped(en('career.withheld.mobilityExpiry')));
  });
});

describe('what the screen refuses to claim', () => {
  /**
   * The critical-position boundary, asserted as text rather than as an absence.
   *
   * A succession plan names a position. Nothing on the page may caption that position "critical",
   * offer a criticality filter, or head a table in a way that implies the list is of critical roles.
   * The notice states the refusal, so a reader does not infer the capability from the data.
   */
  it('shows a position as a reference and never as a critical position', () => {
    const markup = [
      html(<SuccessionSection {...props} plans={[aSuccessionPlan()]} total={1} withheld={false} />),
      html(<BenchSection {...props} bench={aBench()} />),
      html(<StagesSection {...props} detail={aPathDetail()} />),
      html(<StatusSection {...props} />),
    ].join('\n');

    // The refusal is stated in prose — which necessarily uses the words.
    expect(markup).toContain(escaped(en('career.notice.positionsAreReferences')));
    expect(markup).toContain(escaped(en('career.withheld.criticalPositions')));

    // And no heading, column header or figure label claims one. `position` alone is legitimate —
    // it is the column holding the identifier — so the search is for the *judgement*.
    for (const forbidden of ['criticality', 'critical', 'crucial', 'key role']) {
      expect([forbidden, labels(markup).includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('shows no nine-box band, potential rating or high-potential flag against a nomination', () => {
    const markup = [
      html(<SuccessorsSection {...props} detail={aSuccessionDetail()} />),
      html(<StatusSection {...props} />),
    ].join('\n');

    // Both notices name the nine-box in order to say the screen does not show one.
    expect(markup).toContain(escaped(en('career.notice.noNineBoxHere')));
    expect(markup).toContain(escaped(en('career.withheld.ninebox')));

    // No column, figure or heading offers one — which is where a band would have to live to be
    // read as a fact about the nominee beside it.
    for (const forbidden of [
      'nine-box',
      'ninebox',
      'nine_box',
      'potential',
      'high potential',
      'band',
      'rating',
      'score',
    ]) {
      expect([forbidden, labels(markup).includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('says nothing is scheduled, beside the review date that is not a schedule', () => {
    const markup = [
      html(<SuccessionSection {...props} plans={[aSuccessionPlan()]} total={1} withheld={false} />),
      html(<StatusSection {...props} />),
    ].join('\n');

    // The date and the flag are both shown, and the page says nothing fires on either.
    expect(markup).toContain('2026-12-01');
    expect(markup).toContain(en('career.label.reviewDue'));
    expect(markup).toContain(escaped(en('career.withheld.scheduledReview')));
  });

  it('says the 70-20-10 mix is counted and never validated, and prints the API’s own verdict', () => {
    const markup = html(<ItemsSection {...props} detail={aDevelopmentDetail()} />);

    // The literal the API returns, unmodified.
    expect(markup).toContain('NOT VERIFIED');
    expect(markup).toContain(escaped(en('career.withheld.developmentMix')));
    // And no pass, fail or balance judgement anywhere.
    for (const forbidden of ['balanced', 'compliant', '70-20-10 met']) {
      expect([forbidden, markup.toLowerCase().includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('says nobody can read their own record, and offers no route that would', () => {
    const markup = html(<StatusSection {...props} />);

    expect(markup).toContain(escaped(en('career.withheld.selfService')));
    // No "my career", no "my team", and no link to either. The words would only appear as a route.
    for (const forbidden of ['/career/me', 'my-team', 'href=']) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('says no evidence document exists, and shows no link or upload', () => {
    const markup = [
      html(<ReadinessSection {...props} history={aReadinessHistory()} />),
      html(<StatusSection {...props} />),
    ].join('\n');

    expect(markup).toContain(escaped(en('career.withheld.evidenceDocument')));
    for (const forbidden of ['<a ', 'download', 'upload', 'href=']) {
      expect([forbidden, markup.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('says a recommendation moves nobody, beside the promotion kind that suggests one', () => {
    const markup = [
      html(
        <MobilitySection
          {...props}
          recommendations={[aRecommendation({ kind: 'promotion' })]}
          total={1}
          asOf="2026-02-28"
        />,
      ),
      html(<StatusSection {...props} />),
    ].join('\n');

    // The vocabulary word appears, because it is the kind of suggestion somebody made.
    expect(markup).toContain(en('career.vocabulary.mobilityKind.promotion'));
    // And the page states that accepting one changes no employment, position or salary.
    expect(markup).toContain(escaped(en('career.withheld.recommendationsOnly')));
  });

  it('names lifecycle transitions as API capabilities and offers no control for any of them', () => {
    const markup = [
      html(<SuccessorsSection {...props} detail={aSuccessionDetail()} />),
      html(<PlansSection {...props} plans={[aPlan()]} total={1} />),
      html(<ItemsSection {...props} detail={aDevelopmentDetail()} />),
    ].join('\n');

    expect(markup).toContain(escaped(en('career.notice.actionsAreApi')));
    expect(markup).toContain(en('career.vocabulary.action.confirm'));
    // No form, no button, no input, no dialog — this portal has no mutation architecture.
    for (const control of ['<form', '<button', '<input', '<select', '<dialog', 'onclick']) {
      expect([control, markup.toLowerCase().includes(control)]).toEqual([control, false]);
    }
  });

  it('shows identifiers rather than names, and says why', () => {
    const markup = html(<SummarySection {...props} summary={aSummary()} />);

    // A shortened identifier, not a person's name — this screen has asked People for nothing.
    expect(markup).toContain('01900000…');
    expect(markup).toContain(escaped(en('career.notice.identifiersNotNames')));
  });

  it('states every NOT VERIFIED capability in Arabic as well as English', () => {
    const markup = html(<StatusSection {...arabic} />);

    for (const key of [
      'career.withheld.selfService',
      'career.withheld.criticalPositions',
      'career.withheld.ninebox',
      'career.withheld.scheduledReview',
      'career.withheld.mobilityExpiry',
      'career.withheld.developmentMix',
      'career.withheld.evidenceDocument',
      'career.withheld.recommendationsOnly',
    ]) {
      expect([key, markup.includes(escaped(ar(key)))]).toEqual([key, true]);
      // And the key itself never leaks, which is what a missing translation would look like.
      expect([key, markup.includes(key)]).toEqual([key, false]);
    }
  });
});
