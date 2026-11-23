import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Page, launchChrome, pause, type Browser } from '../testing/browser-session/chrome';
import {
  TENANT_A,
  TENANT_B,
  TOKEN_REAL_SECONDS,
  startWorkOrigin,
  type WorkOrigin,
} from '../testing/browser-session/work-origin';

/**
 * MW-007 in a real browser: a session survives more than an hour of use, and a tenant choice is
 * remembered only when it is the person's own.
 *
 * Real Chrome, real cookies with their real attributes (`__Host-`, `Secure`, `HttpOnly`, a refresh
 * cookie path-scoped to `/api/auth/refresh`), real 307s and a real `fetch` from the page — the
 * pieces a unit test cannot hold to account. Time is compressed (see `work-origin.ts`): each
 * fifteen-minute access token lives three real seconds in the cookie jar, and the browser's own
 * expiry removes it, so every cycle below is a genuine lapse followed by a genuine refresh.
 */

const MINUTE = 60_000;
const CYCLES = 5;

interface Seen {
  readonly path: string;
  readonly state: string;
  readonly tenant: string;
  readonly returnTo: string;
}

const PROBE = `({
  path: location.pathname + location.search,
  state: document.body ? (document.body.dataset.state || '') : '',
  tenant: document.body ? (document.body.dataset.tenant || '') : '',
  returnTo: document.body ? decodeURIComponent(document.body.dataset.returnTo || '') : '',
})`;

let browser: Browser;
let origin: WorkOrigin;
let page: Page;

beforeAll(async () => {
  origin = await startWorkOrigin();
  browser = await launchChrome();
  page = await Page.open(browser);
}, 30_000);

afterAll(async () => {
  page.close();
  browser.close();
  await origin.close();
});

/** Navigates and waits until the page that settles is the one `settled` describes. */
const visit = async (path: string, settled: (seen: Seen) => boolean): Promise<Seen | undefined> => {
  await page.navigate(`${origin.origin}${path}`);
  return page.until<Seen>(PROBE, (seen) => seen !== undefined && settled(seen));
};

const cookie = async (name: string): Promise<string | undefined> => {
  const { cookies } = (await page.send('Network.getCookies', { urls: [origin.origin] })) as {
    readonly cookies: readonly { readonly name: string; readonly value: string }[];
  };
  return cookies.find((entry) => entry.name === name)?.value;
};

describe('an Admin session in a real browser', () => {
  it('signs in by way of the refresh page and lands on the page that was asked for', async () => {
    // No cookies at all: the middleware sends the browser to refresh, Identity refuses (no refresh
    // token), the page sends it to sign-in with the page as `returnTo`, and sign-in returns it.
    const seen = await visit('/people?lang=ar', (s) => s.state === 'signed-in');

    expect(seen).toMatchObject({ path: '/people?lang=ar', state: 'signed-in' });
    expect(origin.refreshes()).toBe(0);
  });

  it('remembers a tenant chosen from the picker, and only that one', async () => {
    await visit('/people?before=picker', (s) => s.state === 'signed-in');
    await visit('/session/tenant?returnTo=%2Fpeople', (s) => s.state === 'picker');
    await page.evaluate(`document.querySelector('button[data-tenant="${TENANT_B}"]').click()`);
    const seen = await page.until<Seen>(
      PROBE,
      (s) => s?.path === '/people' && s.state === 'signed-in',
    );

    expect(seen?.tenant).toBe(TENANT_B);
    expect(await cookie('munaxa_work_tenant')).toBe(TENANT_B);
  });

  it('stays signed in, in the chosen tenant, across more than an hour of fifteen-minute tokens', async () => {
    const startedAt = origin.simulatedNow();
    const refreshesBefore = origin.refreshes();

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      // Let the access cookie lapse in the browser, then use the portal again.
      await pause(TOKEN_REAL_SECONDS * 1_000 + 400);
      expect(await cookie('__Host-mx_session')).toBeUndefined();

      const seen = await visit(
        `/people?cycle=${cycle}`,
        (s) => s.path === `/people?cycle=${cycle}` && s.state !== '' && s.state !== 'refreshing',
      );

      expect(seen).toEqual({
        path: `/people?cycle=${cycle}`,
        state: 'signed-in',
        tenant: TENANT_B,
        returnTo: '',
      });
    }

    const elapsed = origin.simulatedNow() - startedAt;
    const lifetimes = origin.issued.slice(-CYCLES).map((token) => token.expiresAt - token.issuedAt);

    expect(origin.refreshes() - refreshesBefore).toBe(CYCLES);
    expect(elapsed).toBeGreaterThanOrEqual(60 * MINUTE);
    expect(lifetimes.reduce((total, lifetime) => total + lifetime, 0)).toBeGreaterThanOrEqual(
      60 * MINUTE,
    );
    // The refresh token never reached a portal page: it is path-scoped to Identity's endpoint.
    expect(await page.evaluate<string>('document.cookie')).toBe('');
  }, 60_000);

  it('ignores a tenant cookie the browser made up, and refuses to remember one', async () => {
    const forged = '01920000-0000-7000-8000-0000000000ff';
    await page.send('Network.setCookie', {
      name: 'munaxa_work_tenant',
      value: forged,
      url: origin.origin,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });

    const seen = await visit('/people?forged=1', (s) => s.state === 'signed-in');
    expect(seen?.tenant).toBe('');

    // Rewrite a picker form to name the forged tenant: the server checks it and forgets the choice.
    await visit('/people?before=picker', (s) => s.state === 'signed-in');
    await visit('/session/tenant?returnTo=%2Fpeople', (s) => s.state === 'picker');
    await page.evaluate(
      `(() => { const form = document.querySelector('form'); form.tenantId.value = '${forged}'; form.submit(); })()`,
    );
    await page.until<Seen>(PROBE, (s) => s?.state === 'picker');

    expect(await cookie('munaxa_work_tenant')).toBeUndefined();
    expect([TENANT_A, TENANT_B]).not.toContain(forged);
  });

  it('ends a revoked session at sign-in, returning to the page, and does not loop', async () => {
    origin.revokeEverything();
    await pause(TOKEN_REAL_SECONDS * 1_000 + 400);

    const atSignIn = await visit('/payroll?after=revocation', (s) => s.state === 'sign-in');
    expect(atSignIn?.returnTo).toBe('/payroll?after=revocation');

    // The attempt marker is still set, so the page renders signed out instead of bouncing again.
    const again = await visit('/payroll', (s) => s.state === 'signed-out');
    expect(again?.path).toBe('/payroll');
  });
});
