import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWorkforce } from './api';
import { translator } from './locale';
import { WorkforceSection } from './sections';
import { ANOTHER_EMPLOYMENT_ID, anEmployment } from './record.fixture';

/**
 * The workforce directory, and the one thing it could not do until the employee record existed:
 * open a row.
 *
 * A listing of ten thousand people that cannot be opened is a report rather than a directory, and
 * that is what this screen was. The assertions here are about the link — that it exists on both the
 * cells a reader reaches for, that it carries the language, and that it carries the date the list
 * was resolved at, so the record opens showing the same day the list was showing.
 */

const en = translator('en');
const props = { t: en, language: 'en' } as const;

const html = (asOf?: string): string =>
  renderToStaticMarkup(
    <WorkforceSection {...props} employments={[anEmployment()]} unavailable={false} asOf={asOf} />,
  );

describe('the workforce directory', () => {
  /**
   * A column of shortened identifiers is not a column.
   *
   * The directory used to carry the organizational unit and the manager as `01900000…`: two of five
   * columns that told a reader nothing and cost the width a real value would have had. Neither has a
   * bounded lookup by identifier, so the directory carries what `EmploymentView` answers for
   * directly and the record carries the placement in full.
   */
  it('shows no shortened identifier anywhere', () => {
    expect(html()).not.toContain('01900000…');
  });

  it('states how many employments the answer holds, and the date it was resolved at', () => {
    const markup = html();

    expect(markup).toContain('1');
    expect(markup).toContain('2026-08-24');
  });

  it('opens the record from the employment number and from the name', () => {
    const markup = html();
    const href = '/employment/01900000-0000-7000-8000-00000000e001?lang=en';

    expect(markup.split(`href="${href}"`).length - 1).toBe(2);
    expect(markup).toContain('EMP-000417');
    expect(markup).toContain('Layla Haddad');
  });

  it('carries the date the list was resolved at into the record', () => {
    expect(html('2026-03-01')).toContain(
      'href="/employment/01900000-0000-7000-8000-00000000e001?lang=en&amp;asOf=2026-03-01"',
    );
  });

  it('offers no link at all when the API refused, rather than a row that opens nothing', () => {
    const markup = renderToStaticMarkup(
      <WorkforceSection {...props} employments={[]} unavailable asOf={undefined} />,
    );

    expect(markup).not.toContain('href=');
    expect(markup).toContain(en('employment.label.unavailable'));
  });

  it('distinguishes a refused listing from an empty one', () => {
    const refused = renderToStaticMarkup(
      <WorkforceSection {...props} employments={[]} unavailable asOf={undefined} />,
    );
    const empty = renderToStaticMarkup(
      <WorkforceSection {...props} employments={[]} unavailable={false} asOf={undefined} />,
    );

    expect(refused).toContain(en('employment.label.unavailable'));
    expect(empty).toContain(en('employment.label.empty'));
    expect(empty).not.toContain(en('employment.label.unavailable'));
  });
});

/**
 * The directory reads the workforce and nothing about any single row.
 *
 * It used to make a second request — the first page row's employment history — and render it under
 * a heading that named nobody, which put an arbitrary person's history on a tenant-wide screen.
 * The history now belongs to the employee record, keyed on the requested employment; this suite
 * pins the directory to one request so the arbitrary read cannot quietly come back.
 */
describe('what the directory asks the API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the listing alone, never a row’s history', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ ...anEmployment(), employmentId: ANOTHER_EMPLOYMENT_ID }, anEmployment()],
            total: 2,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    const workforce = await loadWorkforce();

    expect(workforce.employments).toHaveLength(2);
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain('/history');
  });
});
