import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadAttendanceRegister,
  loadDay,
  loadDayDetail,
  registerAnsweredNothing,
  windowEnding,
} from './api';
import { EMPLOYMENT_A, ON_DATE, aSnapshot } from './attendance.fixture';

/**
 * What the attendance screens ask for, and what they do when they get no answer.
 *
 * **Behavioural** — refused, missing and empty must survive the round trip as three different
 * values, because the screens render them as three different things. On an attendance screen "no
 * punches" against a caller who merely lacks `attendance.event.read` is the most misleading thing
 * the product could print.
 *
 * **Structural** — read against the source, because four properties are about what this file is
 * *allowed to do*. The day must come from the module's own composite rather than being rebuilt from
 * three lists; no request may name a caller; no page may be indexed; and no read may be issued per
 * row. None of those shows up in rendered output.
 */

const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/** The same file with its prose removed: the comments explain the very defects asserted against. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every path this file constructs, and nothing else. */
const REQUESTS = [...SOURCE.matchAll(/(?:read|outcome)<[^(]*\(\s*[`']([^`']*)[`']/g)].map(
  (match) => match[1] ?? '',
);

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refused = (): Response => new Response('', { status: 403 });
const missing = (): Response => new Response('', { status: 404 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the attendance screens are allowed to ask for', () => {
  it('constructs the requests this slice was authorized to make, and no others', () => {
    expect(REQUESTS).toEqual([
      '/attendance/dashboard?onDate=${onDate}',
      '/attendance/exceptions?state=open&${PAGE}',
      '/attendance/days?${dates}&${PAGE}',
      '/attendance/corrections?${PAGE}',
      '/attendance/reconciliation',
      '/attendance/roster?from=${range.from}&to=${range.to}',
      '/attendance/shifts',
      '/attendance/schedules',
      '/attendance/imports',
      '/attendance/days/${employmentId}/${attendanceDate}',
      '/employments/${employmentId}',
      '/attendance/shifts',
      '/attendance/corrections?employmentId=${employmentId}&${PAGE}',
    ]);
  });

  /**
   * The day is the module's own composite, not three lists stitched together.
   *
   * `attendance.read-day` returns the day, its events and its exceptions from one moment. Rebuilding
   * that would be three permission outcomes and three moments assembled into a page claiming to
   * describe one day — and would silently drop the superseded events, which only that read returns.
   */
  it('reads a day from the one bounded read, never from the list endpoints', () => {
    expect(CODE).toContain('/attendance/days/${employmentId}/${attendanceDate}');
    expect(CODE).not.toMatch(/loadDayDetail[\s\S]*?\/attendance\/events/);
    expect(CODE).not.toMatch(/loadDayDetail[\s\S]*?\/attendance\/exceptions/);
    expect(REQUESTS.filter((path) => path.includes('/attendance/events'))).toHaveLength(0);
  });

  /** Every read is a `GET`. This slice is read-only, and the absence is the guarantee. */
  it('sends no method and therefore no write', () => {
    expect(CODE).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(CODE).not.toMatch(/\bbody:/);
  });

  it('never sends a caller, an actor or a membership', () => {
    expect(CODE).not.toMatch(/\b(actor|actingAs|onBehalfOf|callerId|membershipId|principal)\b/);
  });

  it('indexes no page and describes no row as the subject', () => {
    expect(CODE).not.toMatch(/\.items\s*\[\s*0\s*\]/);
    expect(CODE).not.toMatch(/\bitems\s*\[\s*0\s*\]/);
    expect(CODE).not.toMatch(/\.\s*(find|at|slice)\s*\(\s*0\s*\)/);
  });

  it('issues no request inside a map over rows', () => {
    expect(CODE).not.toMatch(/\.map\([^)]*=>\s*(read|outcome|fetch)\b/);
    expect(CODE).not.toMatch(/for\s*\(.*of\s+\w+\.items[\s\S]{0,200}?(read|outcome|fetch)</);
  });

  it('carries the server total rather than the row count', () => {
    expect(CODE).toContain('total: page.total');
    expect(CODE).not.toMatch(/total:\s*\w+\.items\.length/);
  });

  /** No attendance value is worked out in this layer. */
  it('computes no attendance figure', () => {
    expect(CODE).not.toMatch(/workedMinutes\s*[-+*/]/);
    expect(CODE).not.toMatch(/expectedMinutes\s*[-+*/]/);
    expect(CODE).not.toMatch(/\/\s*100|percent|Percentage/i);
  });

  it('never caches a page saying when a named person came and went', () => {
    // The property moved when every read was routed through one seam, and it is asserted where it
    // now lives rather than restated here: a copy of the string in each module would pass long
    // after the seam stopped setting it. What this file owes is proof that these reads go through
    // that seam at all.
    const shell = readFileSync(new URL('../shell/api-request.ts', import.meta.url), 'utf8');

    expect(shell).toContain("cache: 'no-store'");
    expect(CODE).toMatch(/from '\.\.\/shell\/api-request'/);
  });
});

describe('what the attendance screens do with the answers', () => {
  it('keeps refused and empty apart across the register', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('/attendance/exceptions') ? refused() : json({ items: [], total: 0 }),
        ),
      ),
    );

    const register = await loadAttendanceRegister(ON_DATE);

    expect(register.exceptions).toBeUndefined();
    expect(register.days).toEqual({ items: [], total: 0 });
    expect(registerAnsweredNothing(register)).toBe(false);
  });

  it('reports that nothing answered only when nothing did', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(refused())),
    );

    expect(registerAnsweredNothing(await loadAttendanceRegister(ON_DATE))).toBe(true);
  });

  /**
   * A 404 and a 403 are different answers, and the route acts on the difference.
   *
   * A loader that collapsed both would render a not-found page at a caller who merely lacks
   * `attendance.read` — telling them the day does not exist, which is the opposite of true.
   */
  it('tells a missing day from a refused one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(missing())),
    );
    expect(await loadDay(EMPLOYMENT_A, ON_DATE)).toEqual({ kind: 'missing' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(refused())),
    );
    expect(await loadDay(EMPLOYMENT_A, ON_DATE)).toEqual({ kind: 'refused' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(aSnapshot()))),
    );
    expect((await loadDay(EMPLOYMENT_A, ON_DATE)).kind).toBe('ok');
  });

  /** The register is nine reads, whatever the page size. */
  it('issues one request per section of the register', async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [], total: 0 })));
    vi.stubGlobal('fetch', fetcher);

    await loadAttendanceRegister(ON_DATE);

    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  /** The day detail is three reads beside the snapshot, none of them per row. */
  it('reads the employment once, by identifier, and never scans a list for it', async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [], total: 0 })));
    vi.stubGlobal('fetch', fetcher);

    await loadDayDetail(aSnapshot());

    const urls = fetcher.mock.calls.map(([url]) => String(url));

    expect(urls).toHaveLength(3);
    expect(urls.some((url) => url.endsWith(`/employments/${EMPLOYMENT_A}`))).toBe(true);
    expect(urls.some((url) => url.includes('/employments?'))).toBe(false);
  });

  /** The list range is a default for a request, and it is computed from the date asked for. */
  it('derives the list window from the date it was given, not from a clock of its own', () => {
    expect(windowEnding('2026-08-24', 30)).toEqual({ from: '2026-07-25', to: '2026-08-24' });
    expect(windowEnding('2026-01-05', 10)).toEqual({ from: '2025-12-26', to: '2026-01-05' });
  });
});
