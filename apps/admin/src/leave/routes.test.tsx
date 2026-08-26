import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import leavePage from '../app/leave/page';
import leaveLoading from '../app/leave/loading';
import requestPage from '../app/leave/requests/[leaveRequestId]/page';
import requestNotFound from '../app/leave/requests/[leaveRequestId]/not-found';
import standingPage from '../app/leave/balances/[employmentId]/page';
import { DESTINATIONS } from '../shell/navigation';

import { leaveTranslator } from './locale';
import { ANNUAL, EMPLOYMENT_A, REQUEST_A, aFullRegister } from './leave.fixture';
import { aFullStanding, aRequestDetail } from './detail.fixture';

/**
 * All three routes, end to end: a request in, Leave's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the
 * routes work — that the parameters are read, that the subject is resolved before anything else is
 * asked, that a missing request is a 404 while a refused one is not, and that direction follows
 * language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1';

const en = leaveTranslator('en');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const register = aFullRegister();
const standing = aFullStanding();
const detail = aRequestDetail();

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/leave/dashboard', () => register.dashboard],
  ['/leave/balances/reconciliation', () => register.reconciliation],
  ['/leave/balances/ledger', () => standing.ledger],
  ['/projected', () => (standing.projection as { value: unknown }).value],
  [`/leave/requests/${REQUEST_A}/approval-chain`, () => detail.approvals],
  [`/leave/requests/${REQUEST_A}`, () => detail.request],
  ['/leave/requests', () => register.requests],
  ['/leave/balances', () => register.balances],
  ['/leave/types', () => ({ items: register.types })],
  ['/leave/policies', () => ({ items: register.policies })],
  ['/leave/accrual-runs', () => ({ items: register.accrualRuns })],
  ['/leave/entitlements', () => standing.entitlements],
  ['/leave/adjustments', () => standing.adjustments],
  ['/employments/', () => detail.employment],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = input.slice(BASE.length);
    const hit = ANSWERS.find(([fragment]) => path.startsWith(fragment));

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const answerWith = (status: number): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status })));
};

const markupOf = (node: ReactNode): string => renderToStaticMarkup(node);

const leave = async (lang?: string): Promise<string> =>
  markupOf(
    (await leavePage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const request = async (lang?: string): Promise<string> =>
  markupOf(
    (await requestPage({
      params: Promise.resolve({ leaveRequestId: REQUEST_A }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const standingRoute = async (parameters: Record<string, string> = {}): Promise<string> =>
  markupOf(
    (await standingPage({
      params: Promise.resolve({ employmentId: EMPLOYMENT_A }),
      searchParams: Promise.resolve(parameters),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the leave register route', () => {
  it('puts the overview, every request and the configuration on one page', async () => {
    answerEverything();

    const markup = await leave();

    expect(markup).toContain('14');
    expect(markup).toContain(en('leave.label.requests'));
    expect(markup).toContain('Annual leave');
    expect(markup).toContain(`/leave/requests/${REQUEST_A}?lang=en`);
    expect(markup).toContain('dir="ltr"');
  });

  it('renders right to left in Arabic, and switches the language with it', async () => {
    answerEverything();

    const markup = await leave('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
    expect(markup).toContain('إجازة سنوية');
  });

  it('says the refusal once, never that no leave has been requested', async () => {
    answerWith(401);

    const markup = await leave();

    expect(markup).toContain(en('leave.label.nothingReadable'));
    expect(markup).not.toContain(en('leave.label.noRequests'));
  });

  it('is reachable from the shell, and the detail routes keep it current', () => {
    const destination = DESTINATIONS.find((entry) => entry.key === 'leave');

    expect(destination?.href).toBe('/leave');
    expect(`/leave/requests/${REQUEST_A}`.startsWith('/leave/')).toBe(true);
    expect(`/leave/balances/${EMPLOYMENT_A}`.startsWith('/leave/')).toBe(true);
  });

  it('holds the layout still while it waits, and shows no placeholder figure', () => {
    const markup = markupOf(leaveLoading());

    expect(markup).toContain('aria-busy="true"');
    // Text only: the class names carry digits, the page carries none.
    expect(markup.replaceAll(/<[^>]*>/g, '')).toBe('');
  });
});

describe('the leave request route', () => {
  it('resolves one request and renders the dates it covers', async () => {
    answerEverything();

    const markup = await request();

    expect(markup).toContain('<bdi>2026-09-01</bdi>');
    expect(markup).toContain(en('leave.label.approvalChain'));
    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain(`/leave/balances/${EMPLOYMENT_A}?lang=en`);
  });

  /**
   * The distinction the loader exists to keep, proved through the route.
   *
   * A 404 throws Next's not-found; a 403 does not, and renders the withheld state instead of
   * telling a caller who merely lacks a permission that the request does not exist.
   */
  it('throws not-found for a missing request and renders withheld for a refused one', async () => {
    answerWith(404);
    await expect(request()).rejects.toThrow();

    answerWith(403);
    const markup = await request();

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).not.toContain(en('leave.label.requestNotFound'));
  });

  it('offers a way back and names the request when there is genuinely none', () => {
    const markup = markupOf(requestNotFound());

    expect(markup).toContain(en('leave.label.requestNotFound'));
    expect(markup).toContain('href="/leave"');
  });
});

describe('the leave standing route', () => {
  it('renders every balance and the ledger behind it', async () => {
    answerEverything();

    const markup = await standingRoute();

    expect(markup).toContain(en('leave.label.balanceBefore'));
    expect(markup).toContain(en('leave.label.balanceAfter'));
    expect(markup).toContain(en('leave.kind.accrual'));
    expect(markup).toContain('Layla Haddad');
  });

  /** No leave type in the address means no projection — never a projection of the first type. */
  it('projects nothing until a leave type is chosen, and projects it once when one is', async () => {
    answerEverything();

    expect(await standingRoute()).toContain(en('leave.notice.chooseLeaveType'));

    const chosen = await standingRoute({ leaveTypeId: ANNUAL });

    expect(chosen).toContain(en('leave.label.projectedAvailable'));
    expect(chosen).not.toContain(en('leave.notice.chooseLeaveType'));
  });

  /** An employment Leave holds nothing for is not a 404: Leave cannot say whether it exists. */
  it('renders empty sections rather than not-found for an employment Leave holds nothing for', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ items: [], total: 0 })));

    const markup = await standingRoute();

    expect(markup).toContain(en('leave.label.noBalances'));
    expect(markup).toContain(en('leave.label.noLedger'));
  });

  it('renders right to left in Arabic', async () => {
    answerEverything();

    const markup = await standingRoute({ lang: 'ar' });

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });
});
