import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, afterEach } from 'vitest';

// Imported camelCase and *called* rather than rendered as JSX: it is an async server component, so
// a test awaits it to get the element tree. PascalCase would be the JSX convention, which the
// portal's naming rule reserves for values used as components — and this one never is.
import careerPage from '../app/career/page';
import { translator } from './locale';

/**
 * The route itself, rendered as Next renders it.
 *
 * The section suites assert each workspace in isolation; this asserts the one thing only the page
 * owns — that `?lang=ar` switches the language *and* the direction of the `<main>` element together,
 * and that every workspace is actually mounted on it rather than merely importable.
 */

const en = translator('en');
const ar = translator('ar');

const empty = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [], total: 0 }),
      }),
    ),
  );
};

describe('the /career route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders left to right in English, with the English heading', async () => {
    empty();
    const markup = renderToStaticMarkup(await careerPage({}));

    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toContain('dir="rtl"');
    expect(markup).toContain(en('career.label.career'));
  });

  it('renders right to left for ?lang=ar, with the Arabic heading', async () => {
    empty();
    const markup = renderToStaticMarkup(
      await careerPage({ searchParams: Promise.resolve({ lang: 'ar' }) }),
    );

    expect(markup).toContain('dir="rtl"');
    expect(markup).not.toContain('dir="ltr"');
    expect(markup).toContain(ar('career.label.career'));
    expect(markup).not.toContain(en('career.label.career'));
  });

  it('falls back to English for an unknown language rather than rendering keys', async () => {
    empty();
    const markup = renderToStaticMarkup(
      await careerPage({ searchParams: Promise.resolve({ lang: 'fr' }) }),
    );

    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toContain('career.label.');
  });

  it('mounts every workspace on the page, not merely in the imports', async () => {
    empty();
    const markup = renderToStaticMarkup(await careerPage({}));

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
      expect([heading, markup.includes(en(heading))]).toEqual([heading, true]);
    }
  });

  it('has no form, button, input or client directive anywhere on the rendered page', async () => {
    empty();
    const markup = renderToStaticMarkup(await careerPage({}));

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      '<dialog',
      'onclick',
      'href=',
    ]) {
      expect([control, markup.toLowerCase().includes(control)]).toEqual([control, false]);
    }
  });
});
