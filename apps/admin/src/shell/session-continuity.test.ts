import { describe, expect, it } from 'vitest';

import {
  EXPIRY_MARGIN_MS,
  REFRESH_PAGE,
  accessTokenExpiresAt,
  chosenTenant,
  isTenantId,
  refreshAndReturn,
  safeReturnTo,
  sessionDecision,
  tenantSelectionHeader,
  type BrowserEnvironment,
  type SessionRequest,
} from './session-continuity';

/**
 * Session continuity and tenant selection, decided without a browser (MW-007).
 *
 * The browser half — real cookies, a real redirect, a real `fetch` to the refresh endpoint — is
 * `session-continuity.browser.test.ts`. This suite pins each decision on its own.
 */

const MINUTE = 60_000;
const TOKEN_LIFETIME = 15 * MINUTE;

/** A token shaped like Identity's: three base64url parts, `exp` in seconds. Unsigned: never verified here. */
const tokenExpiringAt = (expiresAtMs: number): string => {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256' })}.${encode({ sub: 'subject', exp: Math.floor(expiresAtMs / 1_000) })}.signature`;
};

const page = (overrides: Partial<SessionRequest> = {}): SessionRequest => ({
  method: 'GET',
  pathname: '/people',
  search: '?lang=ar',
  accessToken: undefined,
  attempted: false,
  nowMs: Date.UTC(2026, 10, 23, 9),
  ...overrides,
});

describe('the decision before a page renders', () => {
  it('sends a navigation with no access cookie through the refresh page, keeping the page', () => {
    expect(sessionDecision(page())).toEqual({
      kind: 'refresh',
      location: `${REFRESH_PAGE}?returnTo=${encodeURIComponent('/people?lang=ar')}`,
    });
  });

  it('passes a navigation whose token is still good', () => {
    const now = Date.UTC(2026, 10, 23, 9);
    const decision = sessionDecision(
      page({ nowMs: now, accessToken: tokenExpiringAt(now + TOKEN_LIFETIME) }),
    );

    expect(decision).toEqual({ kind: 'pass' });
  });

  it('refreshes a token about to expire, before the API refuses it', () => {
    const now = Date.UTC(2026, 10, 23, 9);
    const decision = sessionDecision(
      page({ nowMs: now, accessToken: tokenExpiringAt(now + EXPIRY_MARGIN_MS - 1_000) }),
    );

    expect(decision.kind).toBe('refresh');
  });

  it('does not loop: a navigation that just came back from a failed refresh passes', () => {
    expect(sessionDecision(page({ attempted: true }))).toEqual({ kind: 'pass' });
  });

  it('spends the attempt marker once a refresh has produced a usable token', () => {
    const now = Date.UTC(2026, 10, 23, 9);
    const decision = sessionDecision(
      page({ nowMs: now, attempted: true, accessToken: tokenExpiringAt(now + TOKEN_LIFETIME) }),
    );

    expect(decision).toEqual({ kind: 'pass', clearAttempt: true });
  });

  it.each([
    ['an API call', { pathname: '/api/health' }],
    ['a framework asset', { pathname: '/_next/static/chunk.js' }],
    ['a static file', { pathname: '/favicon.ico' }],
    ['the refresh page itself', { pathname: '/session/refresh' }],
    ['the tenant picker', { pathname: '/session/tenant' }],
    ['a form post', { method: 'POST' }],
  ])('leaves %s alone', (_case, overrides) => {
    expect(sessionDecision(page(overrides))).toEqual({ kind: 'pass' });
  });

  it('passes a token it cannot read, because the API is its judge', () => {
    expect(sessionDecision(page({ accessToken: 'opaque' }))).toEqual({ kind: 'pass' });
    expect(accessTokenExpiresAt('a.%%%.c')).toBeUndefined();
  });
});

describe('where the refresh page may return to', () => {
  it.each([
    ['/people?lang=ar', '/people?lang=ar'],
    ['https://evil.example/', '/'],
    ['//evil.example/', '/'],
    ['/\\evil.example', '/'],
    ['/\t/evil.example', '/'],
    [undefined, '/'],
  ])('%s → %s', (requested, expected) => {
    expect(safeReturnTo(requested)).toBe(expected);
  });
});

/** A fake Identity: rotates the refresh token, issues a fifteen-minute access token. */
const identity = (clock: { now: number }, jar: Map<string, string>) => {
  let refreshes = 0;
  let revoked = false;
  const environment: BrowserEnvironment = {
    fetch: () => {
      if (revoked || !jar.has('refresh')) return Promise.resolve({ ok: false, status: 401 });
      refreshes += 1;
      jar.set('refresh', `refresh-${refreshes}`);
      jar.set('access', tokenExpiringAt(clock.now + TOKEN_LIFETIME));
      return Promise.resolve({ ok: true, status: 200 });
    },
    replace: (url) => {
      jar.set('location', url);
    },
  };
  return {
    environment,
    refreshes: (): number => refreshes,
    revoke: (): void => {
      revoked = true;
    },
  };
};

describe('a session used for more than an hour', () => {
  it('stays signed in across five token lifetimes, returning to each page', async () => {
    const start = Date.UTC(2026, 10, 23, 9);
    const clock = { now: start };
    const jar = new Map<string, string>([
      ['refresh', 'refresh-0'],
      ['access', tokenExpiringAt(start + TOKEN_LIFETIME)],
    ]);
    const fake = identity(clock, jar);

    for (let minute = 0; minute <= 75; minute += 5) {
      clock.now = start + minute * MINUTE;
      const asked = page({
        search: `?at=${minute}`,
        accessToken: jar.get('access'),
        nowMs: clock.now,
      });
      const decision = sessionDecision(asked);

      if (decision.kind === 'refresh') {
        const returnTo = new URLSearchParams(decision.location.split('?')[1]).get('returnTo') ?? '';
        const outcome = await refreshAndReturn(
          { returnTo, signInUrl: '/api/auth/login', refreshPath: '/api/auth/refresh' },
          fake.environment,
        );
        expect([minute, outcome, jar.get('location')]).toEqual([
          minute,
          'refreshed',
          `/people?at=${minute}`,
        ]);
      }
      expect(sessionDecision({ ...asked, accessToken: jar.get('access') }).kind).toBe('pass');
    }

    // Seventy-five minutes of use on fifteen-minute tokens: the first token and five renewals.
    expect(fake.refreshes()).toBe(5);
    expect(clock.now - start).toBeGreaterThanOrEqual(60 * MINUTE);
  });

  it('sends a revoked session to sign-in, returning to the same page afterwards', async () => {
    const clock = { now: Date.UTC(2026, 10, 23, 9) };
    const jar = new Map<string, string>([['refresh', 'refresh-0']]);
    const fake = identity(clock, jar);
    fake.revoke();

    const outcome = await refreshAndReturn(
      { returnTo: '/payroll', signInUrl: '/api/auth/login', refreshPath: '/api/auth/refresh' },
      fake.environment,
    );

    expect(outcome).toBe('signed-out');
    expect(jar.get('location')).toBe('/api/auth/login?returnTo=%2Fpayroll');
  });

  it('returns to the page when Identity is unavailable, rather than signing the person out', async () => {
    const replaced: string[] = [];
    const outcome = await refreshAndReturn(
      { returnTo: '/payroll', signInUrl: '/api/auth/login', refreshPath: '/api/auth/refresh' },
      {
        fetch: () => Promise.resolve({ ok: false, status: 503 }),
        replace: (url) => {
          replaced.push(url);
        },
      },
    );

    expect([outcome, replaced]).toEqual(['unavailable', ['/payroll']]);
  });
});

describe('the tenant selection', () => {
  const A = '01920000-0000-7000-8000-0000000000aa';
  const B = '01920000-0000-7000-8000-0000000000bb';

  it('remembers only a tenant the API listed for this principal', () => {
    expect(chosenTenant(B, [A, B])).toBe(B);
    expect(chosenTenant(B.toUpperCase(), [A, B])).toBe(B);
    expect(chosenTenant('01920000-0000-7000-8000-0000000000cc', [A, B])).toBeUndefined();
    expect(chosenTenant('not-a-tenant', ['not-a-tenant'])).toBeUndefined();
    expect(chosenTenant(undefined, [A])).toBeUndefined();
  });

  it('reads only identifier-shaped values', () => {
    expect(isTenantId(A)).toBe(true);
    expect(isTenantId('x; Path=/')).toBe(false);
  });

  it('is written HttpOnly, Secure, SameSite=Lax on the whole site', () => {
    expect(tenantSelectionHeader(A)).toMatch(
      /^munaxa_work_tenant=01920000-0000-7000-8000-0000000000aa; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Lax$/,
    );
    expect(tenantSelectionHeader(undefined)).toContain('Max-Age=0');
  });
});
