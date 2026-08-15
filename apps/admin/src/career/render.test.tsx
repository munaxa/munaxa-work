import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { directionOf, translator } from './locale';
import { OverviewSection, SummarySection } from './overview';
import { PathsSection, PlansSection, StagesSection } from './paths';
import { MembershipsSection, PoolsSection } from './pools';
import { BenchSection, SuccessionSection, SuccessorsSection } from './succession';
import { LevelsSection, ReadinessSection } from './readiness';
import { DevelopmentSection, ItemsSection, MobilitySection } from './development';
import { StatusSection } from './status';
import {
  aBench,
  aDevelopmentDetail,
  aLevel,
  aMembership,
  aPath,
  aPathDetail,
  aPlan,
  aPool,
  aReadinessHistory,
  aRecommendation,
  aSuccessionDetail,
  aSuccessionPlan,
  aSummary,
} from './views.fixture';

/**
 * What the screen actually renders, asserted against the markup rather than against a description
 * of it.
 *
 * Every major workspace, its totals, its empty state, its exact values and its Arabic. These are the
 * assertions nobody else in this repository can make: the API suites prove the server sends a page
 * and a total, and only this proves a browser puts both on the page and does not print one in place
 * of the other.
 *
 * `renderToStaticMarkup` runs the real components with the real catalogues and produces the real
 * HTML — no DOM, no test renderer, no new dependency, and nothing mocked at all.
 */

const en = translator('en');
const ar = translator('ar');
const props = { t: en, language: 'en' } as const;
const arabic = { t: ar, language: 'ar' } as const;

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/**
 * A catalogue string as React emits it.
 *
 * React escapes `'`, `"`, `&`, `<` and `>` in text nodes, so a sentence containing an apostrophe
 * appears in the markup escaped. Comparing against the raw string would fail on text that rendered
 * correctly, which is a test bug wearing the shape of a defect.
 */
const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

describe('the workspaces render', () => {
  it('renders every major section with its heading', () => {
    const markup = [
      html(
        <OverviewSection
          {...props}
          pathsTotal={1}
          plansTotal={1}
          poolsTotal={1}
          membershipsTotal={1}
          successionPlansTotal={1}
          recommendationsTotal={1}
          levelCount={1}
          asOf="2026-02-28"
          unavailable={false}
        />,
      ),
      html(<SummarySection {...props} summary={aSummary()} />),
      html(<PathsSection {...props} paths={[aPath()]} total={1} />),
      html(<StagesSection {...props} detail={aPathDetail()} />),
      html(<PlansSection {...props} plans={[aPlan()]} total={1} />),
      html(<PoolsSection {...props} pools={[aPool()]} total={1} />),
      html(<MembershipsSection {...props} memberships={[aMembership()]} total={1} />),
      html(<SuccessionSection {...props} plans={[aSuccessionPlan()]} total={1} withheld={false} />),
      html(<SuccessorsSection {...props} detail={aSuccessionDetail()} />),
      html(<BenchSection {...props} bench={aBench()} />),
      html(<LevelsSection {...props} levels={[aLevel()]} />),
      html(<ReadinessSection {...props} history={aReadinessHistory()} />),
      html(<DevelopmentSection {...props} detail={aDevelopmentDetail()} />),
      html(<ItemsSection {...props} detail={aDevelopmentDetail()} />),
      html(
        <MobilitySection
          {...props}
          recommendations={[aRecommendation()]}
          total={1}
          asOf="2026-02-28"
        />,
      ),
      html(<StatusSection {...props} />),
    ].join('\n');

    for (const heading of [
      'career.label.overview',
      'career.label.summary',
      'career.label.paths',
      'career.label.stages',
      'career.label.plans',
      'career.label.pools',
      'career.label.memberships',
      'career.label.succession',
      'career.label.successors',
      'career.label.bench',
      'career.label.levels',
      'career.label.assessments',
      'career.label.developmentPlans',
      'career.label.developmentItems',
      'career.label.mobility',
      'career.label.statusNotices',
    ]) {
      expect([heading, markup.includes(escaped(en(heading)))]).toEqual([heading, true]);
    }
  });

  it('renders the data the API returned, not a description of it', () => {
    const markup = html(<PathsSection {...props} paths={[aPath()]} total={1} />);

    expect(markup).toContain('finance');
    expect(markup).toContain('Finance');
    expect(markup).toContain(en('career.vocabulary.careerPathStatus.published'));
    expect(markup).toContain(en('career.vocabulary.careerPathKind.management'));
  });
});

describe('totals and paging', () => {
  it('shows the server’s total separately from the number of rows on the page', () => {
    const markup = html(
      <PlansSection {...props} plans={[aPlan(), aPlan({ careerPlanId: 'b' })]} total={4000} />,
    );

    // Two rows of four thousand. A screen that printed only `2` would tell an administrator that
    // two people are on career plans in an organization where four thousand are.
    expect(markup).toContain('2 / 4000');
    expect(markup).toContain(en('career.label.page'));
  });

  it('shows a total of zero as a total, and an empty page as an empty state', () => {
    const markup = html(<PlansSection {...props} plans={[]} total={0} />);

    expect(markup).toContain('0 / 0');
    expect(markup).toContain(escaped(en('career.notice.empty')));
  });

  /**
   * A page beyond the last: rows are empty and the total is not.
   *
   * This is the case a screen gets wrong by using `items.length` as the total — it would print
   * "0 / 0" for a tenant with four thousand plans, and an administrator would conclude the data had
   * gone. The server's total is carried separately precisely so this reads correctly.
   */
  it('shows an empty page beyond the last without losing the server’s total', () => {
    const markup = html(<PlansSection {...props} plans={[]} total={4000} />);

    expect(markup).toContain('0 / 4000');
    expect(markup).toContain(escaped(en('career.notice.empty')));
  });

  it('takes the bench counts from the API’s own query rather than counting rows', () => {
    // Four thousand nominated, one row fetched. A screen that counted its own rows would say 1.
    const markup = html(<BenchSection {...props} bench={aBench()} />);

    expect(markup).toContain('4000');
    expect(markup).toContain('12');
  });
});

describe('empty, withheld and unavailable states', () => {
  it('distinguishes an unreachable API from a tenant with no data', () => {
    const overview = (unavailable: boolean): string =>
      html(
        <OverviewSection
          {...props}
          pathsTotal={0}
          plansTotal={0}
          poolsTotal={0}
          membershipsTotal={0}
          successionPlansTotal={0}
          recommendationsTotal={0}
          levelCount={0}
          asOf={undefined}
          unavailable={unavailable}
        />,
      );

    // "Not signed in" and "nothing configured yet" are different answers, and a screen that showed
    // the same thing for both would send an administrator looking for data that was never withheld.
    expect(overview(true)).toContain(escaped(en('career.notice.unauthenticated')));
    expect(overview(false)).not.toContain(escaped(en('career.notice.unauthenticated')));
  });

  it('distinguishes a refused listing from an empty one', () => {
    const withheld = html(<SuccessionSection {...props} plans={[]} total={0} withheld={true} />);
    const empty = html(<SuccessionSection {...props} plans={[]} total={0} withheld={false} />);

    // A permission boundary is a different fact from an empty tenant, and neither is an error.
    expect(withheld).toContain(escaped(en('career.notice.withheld')));
    expect(withheld).not.toContain(escaped(en('career.notice.empty')));
    expect(empty).toContain(escaped(en('career.notice.empty')));
    expect(empty).not.toContain(escaped(en('career.notice.withheld')));
  });

  it('renders an absent detail as an empty state rather than zeros', () => {
    for (const markup of [
      html(<StagesSection {...props} detail={undefined} />),
      html(<SuccessorsSection {...props} detail={undefined} />),
      html(<BenchSection {...props} bench={undefined} />),
      html(<ReadinessSection {...props} history={undefined} />),
      html(<DevelopmentSection {...props} detail={undefined} />),
      html(<ItemsSection {...props} detail={undefined} />),
    ]) {
      expect(markup).toContain(escaped(en('career.notice.empty')));
      expect(markup).not.toContain('>0<');
    }
  });
});

describe('Arabic and direction', () => {
  it('puts the page in RTL for Arabic and LTR for English', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');

    // The page element itself, as the route renders it.
    const rtl = html(<main dir={directionOf('ar')}>{html(<StatusSection {...arabic} />)}</main>);
    const ltr = html(<main dir={directionOf('en')}>{html(<StatusSection {...props} />)}</main>);

    expect(rtl).toContain('dir="rtl"');
    expect(ltr).toContain('dir="ltr"');
    expect(ltr).not.toContain('dir="rtl"');
  });

  it('renders the Arabic catalogue strings, not the English ones', () => {
    const markup = [
      html(<PathsSection {...arabic} paths={[aPath()]} total={1} />),
      html(
        <SuccessionSection {...arabic} plans={[aSuccessionPlan()]} total={1} withheld={false} />,
      ),
      html(<LevelsSection {...arabic} levels={[aLevel()]} />),
      html(<StatusSection {...arabic} />),
    ].join('\n');

    // Real Arabic text, from the module's own catalogue.
    expect(markup).toContain(ar('career.label.paths'));
    expect(markup).toContain(ar('career.vocabulary.careerPathStatus.published'));
    expect(markup).toContain(escaped(ar('career.withheld.criticalPositions')));

    // And the English equivalents are absent, so a fallback cannot pass for a translation.
    expect(markup).not.toContain(en('career.vocabulary.careerPathStatus.published'));
    expect(markup).not.toContain(escaped(en('career.withheld.criticalPositions')));
  });

  it('renders the bilingual name in the reader’s language', () => {
    const english = html(<PathsSection {...props} paths={[aPath()]} total={1} />);
    const عربي = html(<PathsSection {...arabic} paths={[aPath()]} total={1} />);

    expect(english).toContain('Finance');
    expect(عربي).toContain('المالية');
  });
});
