import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import attendancePage from '../app/attendance/page';
import attendanceLoading from '../app/attendance/loading';
import dayPage from '../app/attendance/days/[employmentId]/[attendanceDate]/page';
import dayNotFound from '../app/attendance/days/[employmentId]/[attendanceDate]/not-found';
import { DESTINATIONS, isCurrent } from '../shell/navigation';

import { attendanceTranslator } from './locale';
import { EMPLOYMENT_A, ON_DATE, aDayDetail, aFullRegister, aSnapshot } from './attendance.fixture';

/**
 * Both routes, end to end: a request in, Attendance's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the
 * routes work — that both parameters are read, that the day is resolved before anything else is
 * asked, that a missing day is a 404 while a refused one is not, and that direction follows
 * language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1';

const en = attendanceTranslator('en');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const register = aFullRegister();
const detail = aDayDetail();

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/attendance/dashboard', () => register.dashboard],
  ['/attendance/reconciliation', () => register.reconciliation],
  [`/attendance/days/${EMPLOYMENT_A}/${ON_DATE}`, aSnapshot],
  ['/attendance/days', () => register.days],
  ['/attendance/exceptions', () => register.exceptions],
  ['/attendance/corrections', () => detail.corrections],
  ['/attendance/roster', () => register.roster],
  ['/attendance/shifts', () => register.shifts],
  ['/attendance/schedules', () => register.schedules],
  ['/employments/', () => detail.employment],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = input.slice(BASE.length).split('?')[0] ?? '';
    const hit = ANSWERS.find(([fragment]) => path.startsWith(fragment));

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const answerWith = (status: number): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status })));
};

const markupOf = (node: ReactNode): string => renderToStaticMarkup(node);

const attendance = async (lang?: string): Promise<string> =>
  markupOf(
    (await attendancePage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const day = async (lang?: string): Promise<string> =>
  markupOf(
    (await dayPage({
      params: Promise.resolve({ employmentId: EMPLOYMENT_A, attendanceDate: ON_DATE }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the attendance register route', () => {
  it('puts the counts, the exception queue and the definitions on one page', async () => {
    answerEverything();

    const markup = await attendance();

    expect(markup).toContain('412');
    expect(markup).toContain(en('attendance.exception.late_arrival'));
    expect(markup).toContain('Day shift A');
    expect(markup).toContain(`/attendance/days/${EMPLOYMENT_A}/${ON_DATE}?lang=en`);
    expect(markup).toContain('dir="ltr"');
  });

  it('renders right to left in Arabic, and switches the language with it', async () => {
    answerEverything();

    const markup = await attendance('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
    expect(markup).toContain('الوردية الصباحية أ');
  });

  it('says the refusal once, never that no attendance was recorded', async () => {
    answerWith(401);

    const markup = await attendance();

    expect(markup).toContain(en('attendance.label.nothingReadable'));
    expect(markup).not.toContain(en('attendance.label.noDays'));
  });

  it('is reachable from the shell, and the day route keeps it current', () => {
    const destination = DESTINATIONS.find((entry) => entry.key === 'attendance');

    expect(destination?.href).toBe('/attendance');
    if (destination === undefined) return;
    expect(isCurrent(destination, `/attendance/days/${EMPLOYMENT_A}/${ON_DATE}`)).toBe(true);
    expect(isCurrent(destination, '/leave')).toBe(false);
  });

  it('holds the layout still while it waits, and shows no placeholder figure', () => {
    const markup = markupOf(attendanceLoading());

    expect(markup).toContain('aria-busy="true"');
    expect(markup.replaceAll(/<[^>]*>/g, '')).toBe('');
  });
});

describe('the attendance day route', () => {
  it('resolves one day from both parameters and renders its evidence', async () => {
    answerEverything();

    const markup = await day();

    expect(markup).toContain('466 min');
    expect(markup).toContain(en('attendance.exception.late_arrival'));
    expect(markup).toContain(en('attendance.label.replaced'));
    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain('TERM-04');
  });

  /**
   * The distinction the loader exists to keep, proved through the route.
   *
   * A 404 throws Next's not-found; a 403 does not, and renders the withheld state instead of
   * telling a caller who merely lacks a permission that the day does not exist.
   */
  it('throws not-found for a missing day and renders withheld for a refused one', async () => {
    answerWith(404);
    await expect(day()).rejects.toThrow();

    answerWith(403);
    const markup = await day();

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).not.toContain(en('attendance.label.dayNotFound'));
  });

  it('offers a way back and names the day when there is genuinely none', () => {
    const markup = markupOf(dayNotFound());

    expect(markup).toContain(en('attendance.label.dayNotFound'));
    expect(markup).toContain('href="/attendance"');
  });

  it('renders right to left in Arabic', async () => {
    answerEverything();

    const markup = await day('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });
});
