import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Imported camelCase and *called* rather than rendered as JSX: it is an async server component, so
// a test awaits it to get the element tree. PascalCase would be the JSX convention, which the
// portal's naming rule reserves for values used as components — and this one never is.
import workflowPage from '../app/workflow/page';
import { translator } from './locale';

/**
 * The route itself, rendered as Next renders it.
 *
 * The section suites assert each workspace in isolation; this asserts the three things only the page
 * owns — that `?lang=ar` switches the language *and* the direction of the `<main>` element together,
 * that every workspace is actually mounted on it rather than merely importable, and that the whole
 * rendered page offers nothing to click.
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

describe('the /workflow route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders left to right in English, with the English heading', async () => {
    empty();
    const markup = renderToStaticMarkup(await workflowPage({}));

    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toContain('dir="rtl"');
    expect(markup).toContain(en('workflow.label.workflow'));
  });

  it('renders right to left for ?lang=ar, with the Arabic heading', async () => {
    empty();
    const markup = renderToStaticMarkup(
      await workflowPage({ searchParams: Promise.resolve({ lang: 'ar' }) }),
    );

    expect(markup).toContain('dir="rtl"');
    expect(markup).not.toContain('dir="ltr"');
    expect(markup).toContain(ar('workflow.label.workflow'));
    expect(markup).not.toContain(en('workflow.label.workflow'));
  });

  it('falls back to English for an unknown language rather than rendering keys', async () => {
    empty();
    const markup = renderToStaticMarkup(
      await workflowPage({ searchParams: Promise.resolve({ lang: 'fr' }) }),
    );

    expect(markup).toContain('dir="ltr"');
    expect(markup).not.toContain('workflow.label.');
    expect(markup).not.toContain('workflow.withheld.');
  });

  it('mounts every workspace on the page, not merely in the imports', async () => {
    empty();
    const markup = renderToStaticMarkup(await workflowPage({}));

    for (const heading of [
      'workflow.label.overview',
      'workflow.label.definitions',
      'workflow.label.versions',
      'workflow.label.steps',
      'workflow.label.instances',
      'workflow.label.instanceSteps',
      'workflow.label.approvalStatus',
      'workflow.label.history',
      'workflow.label.pending',
      'workflow.label.decided',
      'workflow.label.statusNotices',
    ]) {
      expect([heading, markup.includes(en(heading))]).toEqual([heading, true]);
    }
  });

  /**
   * Nothing on this page is actionable, and the assertion is over the whole rendered route.
   *
   * The API has nine commands. A control here would be either a second UI architecture introduced
   * for one module, or a button that does nothing — and the second is worse than the sentence in the
   * status section that says the server decides.
   */
  it('has no form, button, input, link or client directive anywhere', async () => {
    empty();
    const markup = renderToStaticMarkup(await workflowPage({})).toLowerCase();

    for (const control of [
      '<form',
      '<button',
      '<input',
      '<select',
      '<textarea',
      '<dialog',
      'onclick',
      'onsubmit',
      'href=',
      'use client',
    ]) {
      expect([control, markup.includes(control)]).toEqual([control, false]);
    }
  });

  /**
   * The routes this phase deferred, asserted as an absence in what the page renders.
   *
   * There is no navigation component here to enumerate them, which is the point: a page that linked
   * to `/workflow/my-team` would be a page promising a capability that resolves no reporting line.
   */
  it('links to no deferred route', async () => {
    empty();
    const markup = renderToStaticMarkup(await workflowPage({})).toLowerCase();

    for (const route of [
      '/workflow/me',
      '/workflow/my-team',
      '/workflow/groups',
      '/workflow/roles',
      '/workflow/escalations',
      '/workflow/sla',
      '/workflow/analytics',
    ]) {
      expect([route, markup.includes(route)]).toEqual([route, false]);
    }
  });

  /** An empty tenant renders the whole page, and says the service answered. */
  it('renders every section for a tenant with nothing in it', async () => {
    empty();
    const markup = renderToStaticMarkup(await workflowPage({}));

    expect(markup).toContain(en('workflow.notice.empty'));
    expect(markup).not.toContain(en('workflow.notice.failed'));
  });

  /** And a service that will not answer says so rather than rendering an organization of zeroes. */
  it('reports an unreachable service as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const markup = renderToStaticMarkup(await workflowPage({}));

    expect(markup).toContain(en('workflow.notice.failed'));
  });
});
