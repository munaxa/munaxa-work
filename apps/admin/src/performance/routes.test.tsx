import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import performancePage from '../app/performance/page';
import performanceLoading from '../app/performance/loading';
import reviewPage from '../app/performance/reviews/[reviewId]/page';
import reviewNotFound from '../app/performance/reviews/[reviewId]/not-found';
import goalPage from '../app/performance/goals/[goalId]/page';
import goalNotFound from '../app/performance/goals/[goalId]/not-found';
import { DESTINATIONS, isCurrent } from '../shell/navigation';

import { performanceTranslator } from './locale';
import { CYCLE, GOAL_A, REVIEW_A, aCycle, aFullRegister, aGoal } from './performance.fixture';
import { aReviewDetail, anEmployment } from './review.fixture';

/**
 * All three routes, end to end: a request in, Performance's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the
 * routes work — that a parameter is read, that a missing record is a 404 page while a refused one
 * is not, and that direction follows language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1';

const en = performanceTranslator('en');
const html = (node: ReactNode): string => renderToStaticMarkup(node);

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const register = aFullRegister();

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  [`/performance/reviews/${REVIEW_A}`, aReviewDetail],
  [`/performance/goals/${GOAL_A}`, aGoal],
  ['/performance/rating-scales', () => register.scales],
  ['/performance/frameworks', () => register.frameworks],
  ['/performance/templates', () => register.templates],
  ['/performance/goal-categories', () => register.categories],
  ['/performance/cycles', () => register.cycles],
  ['/performance/goals', () => register.goals],
  ['/performance/reviews', () => register.reviews],
  ['/performance/calibration-sessions', () => register.sessions],
  ['/performance/talent/matrix', () => register.placements],
  ['/performance/feedback', () => register.feedback],
  ['/performance/reconciliation', () => register.findings],
  ['/employments/', anEmployment],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = input.slice(BASE.length).split('?')[0] ?? '';
    const hit = ANSWERS.find(([fragment]) => path.startsWith(fragment));

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const answerWith = (statusCode: number): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: statusCode })));
};

const params = <TValue,>(value: TValue): Promise<TValue> => Promise.resolve(value);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the performance register route', () => {
  it('renders the queue, the goals and the configuration from one round of reads', async () => {
    answerEverything();
    const markup = html(await performancePage({ searchParams: params({}) }));

    expect(markup).toContain(en('performance.label.reviews'));
    expect(markup).toContain(en('performance.label.goals'));
    expect(markup).toContain(en('performance.label.ratingScales'));
    expect(markup).toContain(`/performance/reviews/${REVIEW_A}`);
    expect(markup).toContain(`/performance/goals/${GOAL_A}`);
  });

  it('says nothing is readable when every read was refused', async () => {
    answerWith(401);
    const markup = html(await performancePage({ searchParams: params({}) }));

    expect(markup).toContain(en('performance.label.nothingReadable'));
    expect(markup).not.toContain(en('performance.label.ratingScales'));
  });

  it('switches direction with language, on the element wrapping everything', async () => {
    answerEverything();

    expect(html(await performancePage({ searchParams: params({ lang: 'ar' }) }))).toContain(
      'dir="rtl"',
    );
    expect(html(await performancePage({ searchParams: params({}) }))).toContain('dir="ltr"');
  });

  it('ignores a repeated lang parameter rather than crashing on the array', async () => {
    answerEverything();
    const markup = html(await performancePage({ searchParams: params({ lang: ['ar', 'en'] }) }));

    expect(markup).toContain('dir="rtl"');
  });

  it('renders a skeleton with no placeholder figure while the reads are in flight', () => {
    const markup = html(performanceLoading());

    expect(markup).toContain('aria-busy="true"');
    // No text node at all, so no placeholder score somebody could act on. Digits appear only
    // inside Tailwind's own sizing classes.
    expect(markup.replaceAll(/<[^>]+>/g, '')).toBe('');
  });
});

describe('the review route', () => {
  it('renders one review, named, with its rating and its panel', async () => {
    answerEverything();
    const markup = html(
      await reviewPage({ params: params({ reviewId: REVIEW_A }), searchParams: params({}) }),
    );

    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain(en('performance.label.rating'));
    expect(markup).toContain(en('performance.label.panel'));
    expect(markup).toContain(en('performance.label.components'));
  });

  /**
   * `notFound()` throws inside a Next route, which is how the not-found page is reached. Asserting
   * the throw is asserting the route chose 404 over rendering an empty review.
   */
  it('raises the not-found page for a review the API did not return', async () => {
    answerWith(404);

    await expect(
      reviewPage({ params: params({ reviewId: 'absent' }), searchParams: params({}) }),
    ).rejects.toThrow();
  });

  it('renders a withheld page rather than a not-found one when the caller was refused', async () => {
    answerWith(403);
    const markup = html(
      await reviewPage({ params: params({ reviewId: REVIEW_A }), searchParams: params({}) }),
    );

    expect(markup).toContain(en('performance.label.nothingReadable'));
    expect(markup).toContain('performance.review.read-team');
  });

  /**
   * The one route in this product where a 404 is deliberately also a refusal. The page must be true
   * in both cases, so it may not say the review does not exist.
   */
  it('does not claim a review is absent on the not-found page', () => {
    const markup = html(reviewNotFound());

    expect(markup).toContain('may not exist');
    expect(markup).toContain('may not be yours to read');
    expect(markup).toContain('href="/performance"');
  });

  it('links back to the register', async () => {
    answerEverything();
    const markup = html(
      await reviewPage({ params: params({ reviewId: REVIEW_A }), searchParams: params({}) }),
    );

    expect(markup).toContain('href="/performance"');
  });
});

describe('the goal route', () => {
  it('renders one goal, its statement and its progress history', async () => {
    answerEverything();
    const markup = html(
      await goalPage({ params: params({ goalId: GOAL_A }), searchParams: params({}) }),
    );

    expect(markup).toContain('Reduce month-end close');
    expect(markup).toContain('9007199254740993');
    expect(markup).toContain(en('performance.label.progress'));
  });

  it('uses the goal’s own title as the page heading rather than its identifier', async () => {
    answerEverything();
    const markup = html(
      await goalPage({ params: params({ goalId: GOAL_A }), searchParams: params({}) }),
    );

    expect(markup).toMatch(/<h1[^>]*>[^<]*<bdi>Reduce month-end close/);
  });

  it('raises the not-found page for a goal the module does not hold', async () => {
    answerWith(404);

    await expect(
      goalPage({ params: params({ goalId: 'absent' }), searchParams: params({}) }),
    ).rejects.toThrow();
  });

  /**
   * `/goals` needs `goal.read-team`; `/goals/:goalId` needs `goal.read`. A caller can therefore see
   * a goal in the queue and be refused when they open it, and that is withheld, not absent.
   */
  it('renders a withheld page naming the permission the detail read needs', async () => {
    answerWith(403);
    const markup = html(
      await goalPage({ params: params({ goalId: GOAL_A }), searchParams: params({}) }),
    );

    expect(markup).toContain(en('performance.label.nothingReadable'));
    expect(markup).toContain('performance.goal.read');
  });

  it('says only that no goal was returned, because that is all a 404 means here', () => {
    const markup = html(goalNotFound());

    expect(markup).toContain(en('performance.notice.goalNotFound'));
    expect(markup).not.toContain('may not be yours to read');
  });
});

describe('the shell knows where performance is', () => {
  it('carries one destination for the register', () => {
    const performance = DESTINATIONS.filter((destination) => destination.href === '/performance');

    expect(performance).toHaveLength(1);
  });

  it('marks the register current for its own detail routes', () => {
    const destination = DESTINATIONS.find((each) => each.href === '/performance');

    expect(destination).toBeDefined();
    if (destination === undefined) return;

    expect(isCurrent(destination, `/performance/reviews/${REVIEW_A}`)).toBe(true);
    expect(isCurrent(destination, `/performance/goals/${GOAL_A}`)).toBe(true);
    expect(isCurrent(destination, '/leave')).toBe(false);
  });
});

describe('the register asks for the cycle it names', () => {
  it('scopes the queue to the running cycle and says so on the page', async () => {
    const asked: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      const path = input.slice(BASE.length).split('?')[0] ?? '';
      const hit = ANSWERS.find(([fragment]) => path.startsWith(fragment));

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    const markup = html(await performancePage({ searchParams: params({}) }));

    expect(asked.some((path) => path.includes(`cycleId=${CYCLE}`))).toBe(true);
    expect(markup).toContain(aCycle().code);
    expect(markup).toContain(en('performance.notice.scopedToCycle'));
  });
});
