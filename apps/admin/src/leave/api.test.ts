import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadLeaveRegister,
  loadRequest,
  loadRequestDetail,
  loadStanding,
  registerAnsweredNothing,
  standingAnsweredNothing,
} from './api';
import { ANNUAL, EMPLOYMENT_A, REQUEST_A } from './leave.fixture';
import { aRequestDetail } from './detail.fixture';

/**
 * What the leave screens ask for, and what they do when they get no answer.
 *
 * **Behavioural** — refused, missing and empty must survive the round trip as three different
 * values, because the screens render them as three different things: a withheld section, a
 * not-found page, and a sentence saying nothing is there. On a leave screen "no balance" against an
 * employment whose entitlement is 160 hours is the most misleading thing the product could print.
 *
 * **Structural** — read against the source, because three properties are about what this file is
 * *allowed to send* and one is about what it must never do. A read that named a caller would let
 * anybody holding the permission read as somebody else; a composition that indexed a page would
 * reintroduce the `runs[0]` defect another slice removed; and a request issued per row would turn
 * a page of fifty balances into fifty-one requests. None of those shows up in rendered output.
 */

const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/**
 * The same file with its prose removed.
 *
 * The structural assertions below are about what the *code* does, and the comments in that file
 * explain the very defects being asserted against — a scan for `items[0]` otherwise fails on the
 * sentence saying `items[0]` is what this composition does not do.
 */
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

describe('what the leave screens are allowed to ask for', () => {
  it('constructs the requests this slice was authorized to make, and no others', () => {
    expect(REQUESTS).toEqual([
      '/leave/dashboard',
      '/leave/requests?${PAGE}',
      '/leave/balances?${PAGE}',
      '/leave/balances/reconciliation',
      '/leave/types',
      '/leave/policies',
      '/leave/accrual-runs',
      '/leave/requests/${leaveRequestId}',
      '/leave/requests/${request.leaveRequestId}/approval-chain',
      '/leave/types',
      '/employments/${request.employmentId}',
      '/leave/balances?${forEmployment}${narrowed}&${PAGE}',
      '/leave/balances/ledger?${forEmployment}${narrowed}&${PAGE}',
      '/leave/entitlements?${forEmployment}${narrowed}&${PAGE}',
      '/leave/adjustments?${forEmployment}${narrowed}&${PAGE}',
      '/leave/requests?${forEmployment}${narrowed}&${PAGE}',
      '/leave/types',
      '/employments/${employmentId}',
      '/leave/balances/${employmentId}/projected?leaveTypeId=${selected.leaveTypeId}&date=${selected.onDate}',
    ]);
  });

  /** Every read is a `GET`. This slice is read-only, and the absence is the guarantee. */
  it('sends no method and therefore no write', () => {
    expect(CODE).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    expect(CODE).not.toMatch(/\bbody:/);
  });

  /**
   * No request names a caller.
   *
   * Who is asking is the server's to decide from the authenticated principal. A screen that sent an
   * employment or a membership as *the caller* would let anybody holding the permission read as
   * somebody else — and every `employmentId` this file sends is a filter on a list, not an identity.
   */
  it('never sends a caller, an actor or a membership', () => {
    expect(CODE).not.toMatch(/\b(actor|actingAs|onBehalfOf|callerId|membershipId|principal)\b/);
  });

  /** The `runs[0]` defect, in this module's terms. */
  it('indexes no page and describes no row as the subject', () => {
    expect(CODE).not.toMatch(/\.items\s*\[\s*0\s*\]/);
    expect(CODE).not.toMatch(/\bitems\s*\[\s*0\s*\]/);
    expect(CODE).not.toMatch(/\.\s*(find|at|slice)\s*\(\s*0\s*\)/);
  });

  /** No lookup is issued per row, so a page of fifty balances is never fifty-one requests. */
  it('issues no request inside a map over rows', () => {
    expect(CODE).not.toMatch(/\.map\([^)]*=>\s*(read|outcome|fetch)\b/);
    expect(CODE).not.toMatch(/for\s*\(.*of\s+\w+\.items[\s\S]{0,200}?(read|outcome|fetch)</);
  });

  /** A page's total is the server's field, never the length of what arrived. */
  it('carries the server total rather than the row count', () => {
    expect(CODE).toContain('total: page.total');
    expect(CODE).not.toMatch(/total:\s*\w+\.items\.length/);
  });
});

describe('what the leave screens do with the answers', () => {
  it('keeps refused and empty apart across the register', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes('/leave/balances') ? refused() : json({ items: [], total: 0 }),
        ),
      ),
    );

    const register = await loadLeaveRegister();

    expect(register.balances).toBeUndefined();
    expect(register.reconciliation).toBeUndefined();
    expect(register.requests).toEqual({ items: [], total: 0 });
    expect(registerAnsweredNothing(register)).toBe(false);
  });

  it('reports that nothing answered only when nothing did', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(refused())),
    );

    expect(registerAnsweredNothing(await loadLeaveRegister())).toBe(true);
    expect(
      standingAnsweredNothing(await loadStanding(EMPLOYMENT_A, { onDate: '2026-08-25' })),
    ).toBe(true);
  });

  /**
   * A 404 and a 403 are different answers, and the route acts on the difference.
   *
   * Leave answers 404 rather than 403 for a request in another tenant, precisely so that a refusal
   * does not confirm somebody asked for leave. A loader that collapsed both into `undefined` would
   * render a not-found page at a caller who merely lacks `leave.read` — telling them the request
   * does not exist, which is the opposite of true.
   */
  it('tells a missing request from a refused one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(missing())),
    );
    expect(await loadRequest(REQUEST_A)).toEqual({ kind: 'missing' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(refused())),
    );
    expect(await loadRequest(REQUEST_A)).toEqual({ kind: 'refused' });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(aRequestDetail().request))),
    );
    expect((await loadRequest(REQUEST_A)).kind).toBe('ok');
  });

  it('tells a missing projection from a refused one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(url.includes('/projected') ? missing() : refused())),
    );

    const standing = await loadStanding(EMPLOYMENT_A, {
      leaveTypeId: ANNUAL,
      onDate: '2026-08-25',
    });

    expect(standing.projection).toEqual({ kind: 'missing' });
  });

  /** No leave type chosen means no projection requested — not a projection of the first type. */
  it('asks for no projection at all until a leave type is chosen', async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [], total: 0 })));
    vi.stubGlobal('fetch', fetcher);

    const standing = await loadStanding(EMPLOYMENT_A, { onDate: '2026-08-25' });

    expect(standing.projection).toBeUndefined();
    expect(fetcher.mock.calls.map(([url]) => String(url)).join(' ')).not.toContain('/projected');
  });

  /** One request per section, and one projection at most — never one per balance row. */
  it("issues one request per section of the standing, whatever the page's size", async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [], total: 0 })));
    vi.stubGlobal('fetch', fetcher);

    await loadStanding(EMPLOYMENT_A, { leaveTypeId: ANNUAL, onDate: '2026-08-25' });

    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  /** The request detail is three reads, and the employment read is one for one identifier. */
  it('reads the requester once, by identifier, and never scans a list for them', async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [] })));
    vi.stubGlobal('fetch', fetcher);

    await loadRequestDetail(aRequestDetail().request);

    const urls = fetcher.mock.calls.map(([url]) => String(url));

    expect(urls).toHaveLength(3);
    expect(urls.some((url) => url.endsWith(`/employments/${EMPLOYMENT_A}`))).toBe(true);
    expect(urls.some((url) => url.includes('/employments?'))).toBe(false);
  });

  it('narrows every section to the chosen leave type, and none of them when there is none', async () => {
    const fetcher = vi.fn((_url: string) => Promise.resolve(json({ items: [], total: 0 })));
    vi.stubGlobal('fetch', fetcher);

    await loadStanding(EMPLOYMENT_A, { leaveTypeId: ANNUAL, onDate: '2026-08-25' });
    const narrowed = fetcher.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('employmentId='));

    expect(narrowed).toHaveLength(5);
    for (const url of narrowed) expect(url).toContain(`leaveTypeId=${ANNUAL}`);
  });

  it('never caches a page holding a requester’s own words', () => {
    // The property moved when every read was routed through one seam, and it is asserted where it
    // now lives rather than restated here: a copy of the string in each module would pass long
    // after the seam stopped setting it. What this file owes is proof that these reads go through
    // that seam at all.
    const shell = readFileSync(new URL('../shell/api-request.ts', import.meta.url), 'utf8');

    expect(shell).toContain("cache: 'no-store'");
    expect(CODE).toMatch(/from '\.\.\/shell\/api-request'/);
  });
});
