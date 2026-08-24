import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import employeeRecordPage from '../app/employment/[employmentId]/page';

import {
  aBalance,
  aCareerSummary,
  aClearance,
  aContract,
  aDocument,
  aLeaveType,
  aLearningHistory,
  aProfile,
  aReportingLine,
  aViolation,
  anAssignment,
  anAttendanceDay,
  anEmployment,
  anIssuedLetter,
} from './record.fixture';

/**
 * The record route, end to end: a request in, twelve module responses, and the HTML a browser gets.
 *
 * The section suites prove each section renders what a module returned. Only this proves the whole
 * route works — that the parameters are read, that the employment is resolved before anything else
 * is asked, that twelve answers reach the twelve sections that consume them without one landing
 * under another's heading, and that direction follows language on the element that wraps all of it.
 *
 * `fetch` is stubbed and nothing else is. The components, the catalogues, the composition layer and
 * the page are all the real ones.
 */

const BASE = 'http://127.0.0.1:3000/api/v1';
const EMPLOYMENT_ID = '01900000-0000-7000-8000-00000000e001';

/**
 * What each module answers, as a table rather than a ladder.
 *
 * A table because the ladder it replaced was thirteen branches in one function. It is matched **in
 * order**, and the order carries meaning: an employment's child collections are listed before the
 * employment itself, because `/employments/:id/contracts` starts with `/employments/` too.
 * Anything not named here is a 404, which the record renders as a withheld section.
 */
const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/assignments', () => ({ items: [anAssignment()] })],
  ['/reporting-lines', () => ({ items: [aReportingLine()] })],
  ['/contracts', () => ({ items: [aContract()] })],
  ['/employments/', anEmployment],
  ['/people/', aProfile],
  ['/documents', () => ({ items: [aDocument()] })],
  ['/letters/issued', () => ({ items: [anIssuedLetter()] })],
  ['/leave/balances', () => ({ items: [aBalance()] })],
  ['/leave/types', () => ({ items: [aLeaveType()] })],
  ['/attendance/days', () => ({ items: [anAttendanceDay()] })],
  ['/career/summary', aCareerSummary],
  ['/learning/history', aLearningHistory],
  ['/relations/violations', () => ({ items: [aViolation()] })],
  ['/assets/custody/clearance', aClearance],
];

const answerFor = (path: string): unknown =>
  ANSWERS.find(([prefix]) => path.startsWith(prefix) || path.endsWith(prefix))?.[1]();

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const body = answerFor((input.slice(BASE.length).split('?')[0] ?? '').toString());

    return Promise.resolve(
      body === undefined
        ? new Response('', { status: 404 })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    );
  });
};

const render = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await employeeRecordPage({
      params: Promise.resolve({ employmentId: EMPLOYMENT_ID }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the employee record route', () => {
  it('puts one value from every module on one page', async () => {
    answerEverything();

    const markup = await render();

    for (const value of [
      'Layla Haddad', // people
      'EMP-000417', // employment
      '2021-03-01', // employment — the contract and the placement
      'Signed contract', // documents
      'LTR-2026-000091', // letters
      '7200', // leave — available minutes
      '2026-08-20', // attendance
      '11', // learning — completed courses
      'LATENESS', // relations
      'LT-00841', // assets — the tag, not an identifier
      '194', // assets — days outstanding
      'Annual leave', // leave — the tenant's own type name
    ]) {
      expect([value, markup.includes(value)]).toEqual([value, true]);
    }
  });

  it('opens left to right in English and right to left in Arabic', async () => {
    answerEverything();

    expect(await render()).toContain('dir="ltr"');

    answerEverything();

    const arabic = await render('ar');

    expect(arabic).toContain('dir="rtl"');
    expect(arabic).toContain('lang="ar"');
    // The Arabic legal name, not the English one falling through.
    expect(arabic).toContain('ليلى حداد');
  });

  /**
   * An identifier the API will not resolve is a 404, not a page of twelve refusals.
   *
   * `notFound()` throws Next's own control-flow error, which the framework turns into the route's
   * `not-found.tsx`. Asserting that it throws is asserting that the page did not render an employee
   * whose every section was withheld — which would look, to a reader, like a person with no data.
   */
  /**
   * The state a deployment with no Platform authentication adapter is actually in.
   *
   * The employment resolves — it has to, or the route is a 404 — and every other module refuses. The
   * record must say that once, not repeat it under twelve headings, which is what it used to do.
   */
  it('says once that nothing could be read, rather than twelve times', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(
        /\/employments\/[^/?]+(\?|$)/.test(input)
          ? new Response(JSON.stringify(anEmployment()), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('', { status: 401 }),
      ),
    );

    const markup = await render();
    const withheld = markup.split('This section was withheld').length - 1;

    expect(withheld).toBe(0);
    expect(markup).toContain('Nothing on this record could be read.');
    // The employment's own facts still stand: the reader knows who they are looking at.
    expect(markup).toContain('EMP-000417');
  });

  it('answers not found rather than rendering an employee nobody could read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));

    await expect(render()).rejects.toThrow();
  });

  it('asks nobody about any other employment', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await expect(render()).rejects.toThrow();
    // The employment is resolved first and on its own; nothing else was asked once it refused.
    expect(asked).toEqual([`${BASE}/employments/${EMPLOYMENT_ID}`]);
  });
});
