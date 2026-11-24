import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { config, middleware } from './middleware';
import {
  PLATFORM_SESSION_COOKIE,
  REFRESH_ATTEMPT_COOKIE,
  REFRESH_ATTEMPT_SECONDS,
} from './shell/session-continuity';

/**
 * The real Admin middleware, called the way Next calls it: a `NextRequest` in, a `NextResponse` out.
 *
 * Next's adapter parses a redirect's `Location` with `new URL()` and no base, so a relative one
 * throws and the visitor gets a 500. These tests pin an absolute, same-origin `Location` and the
 * attempt marker; the decision table itself is `shell/session-continuity.test.ts`.
 */

const ORIGIN = 'https://work.test.munaxa.com';

const token = (expiresAtMs: number): string => {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256' })}.${encode({ sub: 'subject', exp: Math.floor(expiresAtMs / 1_000) })}.signature`;
};

const visit = (path: string, cookies: Record<string, string> = {}, method = 'GET'): NextRequest => {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: cookie === '' ? {} : { cookie },
  });
};

const setCookie = (response: Response, name: string): string | undefined =>
  response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));

describe('the Admin middleware', () => {
  it('sends a signed-out page visit to the refresh page with an absolute, same-origin Location', () => {
    const response = middleware(visit('/payroll?lang=ar'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe(ORIGIN);
    expect(`${location.pathname}${location.search}`).toBe(
      `/session/refresh?returnTo=${encodeURIComponent('/payroll?lang=ar')}`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('sets the attempt marker on that redirect, with the portal cookie attributes', () => {
    const marker = setCookie(middleware(visit('/people')), REFRESH_ATTEMPT_COOKIE) ?? '';

    expect(marker).toMatch(new RegExp(`^${REFRESH_ATTEMPT_COOKIE}=1;`));
    expect(marker).toContain(`Max-Age=${REFRESH_ATTEMPT_SECONDS}`);
    expect(marker).toContain('Path=/');
    expect(marker).toContain('Secure');
    expect(marker).toContain('HttpOnly');
    expect(marker.toLowerCase()).toContain('samesite=lax');
  });

  it('lets a visit with a usable access token through untouched', () => {
    const response = middleware(
      visit('/people', { [PLATFORM_SESSION_COOKIE]: token(Date.now() + 10 * 60_000) }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });

  it('clears the marker once a refresh has worked', () => {
    const response = middleware(
      visit('/people', {
        [PLATFORM_SESSION_COOKIE]: token(Date.now() + 10 * 60_000),
        [REFRESH_ATTEMPT_COOKIE]: '1',
      }),
    );

    expect(response.headers.get('x-middleware-next')).toBe('1');
    const cleared = setCookie(response, REFRESH_ATTEMPT_COOKIE) ?? '';
    expect(cleared).toMatch(new RegExp(`^${REFRESH_ATTEMPT_COOKIE}=;`));
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('HttpOnly');
  });

  it('does not bounce again after a refresh was just attempted', () => {
    const response = middleware(visit('/people', { [REFRESH_ATTEMPT_COOKIE]: '1' }));

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps an off-site return target out of the Location', () => {
    const response = middleware(visit('//evil.example/steal'));
    const location = new URL(response.headers.get('location') ?? '');

    expect(location.origin).toBe(ORIGIN);
    expect(location.searchParams.get('returnTo')?.startsWith('/')).toBe(true);
    expect(location.searchParams.get('returnTo')?.startsWith('//')).toBe(false);
  });

  it('never redirects a form post', () => {
    expect(middleware(visit('/session/tenant', {}, 'POST')).headers.get('x-middleware-next')).toBe(
      '1',
    );
  });

  it('applies to pages only', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico|api/).*)']);
  });
});
