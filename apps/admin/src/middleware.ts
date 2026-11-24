import { NextResponse, type NextRequest } from 'next/server';

import {
  PLATFORM_SESSION_COOKIE,
  PORTAL_COOKIE,
  REFRESH_ATTEMPT_COOKIE,
  REFRESH_ATTEMPT_SECONDS,
  sessionDecision,
} from './shell/session-continuity';

/** `host[:port]`: letters, digits, dots and hyphens only, so no userinfo, path or second host. */
const HOST_HEADER = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?$/;

/**
 * The origin the browser is on: the request's `Host` with the scheme Next derived (it honours the
 * load balancer's `X-Forwarded-Proto`). A malformed or missing `Host` falls back to `nextUrl`.
 *
 * `Host` is the client's own claim, so a forged one only redirects that client to the host it
 * named, and the answer is `no-store`. In Testing and production the load balancer forwards a
 * request to this service only for the portal's hostname.
 */
export const publicOrigin = (request: NextRequest): string => {
  const host = request.headers.get('host')?.trim().toLowerCase();
  if (host === undefined || !HOST_HEADER.test(host)) return request.nextUrl.origin;
  try {
    // Rejects what the pattern lets through but a URL cannot hold, such as port 99999.
    return new URL(`${request.nextUrl.protocol}//${host}`).origin;
  } catch {
    return request.nextUrl.origin;
  }
};

/**
 * Keeps a session alive across the access token's fifteen-minute life (MW-007).
 *
 * Every page navigation is checked before it renders. When the access cookie has lapsed and no
 * refresh was just attempted, the browser is sent through `/session/refresh`, which renews the
 * cookie at Identity and comes back to the page that was asked for. Everything else passes
 * untouched: this decides nothing about access, which stays the API's on every request.
 */
export const middleware = (request: NextRequest): NextResponse => {
  const decision = sessionDecision({
    method: request.method,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    accessToken: request.cookies.get(PLATFORM_SESSION_COOKIE)?.value,
    attempted: request.cookies.has(REFRESH_ATTEMPT_COOKIE),
    nowMs: Date.now(),
  });

  if (decision.kind === 'pass') {
    const passing = NextResponse.next();
    // Cleared with the attributes it was set with: `cookies.delete` sends a bare cookie (no
    // `Secure`, `HttpOnly` or `SameSite`), which a browser may refuse to let replace this one.
    if (decision.clearAttempt === true)
      passing.cookies.set(REFRESH_ATTEMPT_COOKIE, '', { ...PORTAL_COOKIE, maxAge: 0 });
    return passing;
  }

  // An absolute URL: Next's middleware adapter parses `Location` with `new URL()` and no base,
  // so a relative one throws and every lapsed visit becomes a 500. Absolute on the *public* origin,
  // though, not on `request.nextUrl`: under `next start` that is `http(s)://localhost:<port>`
  // whatever the browser asked for, and Next sends it as is. Behind the load balancer that sent
  // every signed-out visit to `https://localhost:3001/session/refresh` (found by the built-app
  // check, Wave 2 R-2). `decision.location` is always a path of this portal (`safeReturnTo`).
  const response = NextResponse.redirect(new URL(decision.location, publicOrigin(request)), 307);
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(REFRESH_ATTEMPT_COOKIE, '1', {
    ...PORTAL_COOKIE,
    maxAge: REFRESH_ATTEMPT_SECONDS,
  });
  return response;
};

export const config = {
  // Pages only. Assets and the framework's own routes never carry a decision worth making.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
