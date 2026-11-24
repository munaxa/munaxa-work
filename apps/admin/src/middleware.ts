import { NextResponse, type NextRequest } from 'next/server';

import {
  PLATFORM_SESSION_COOKIE,
  PORTAL_COOKIE,
  REFRESH_ATTEMPT_COOKIE,
  REFRESH_ATTEMPT_SECONDS,
  sessionDecision,
} from './shell/session-continuity';

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

  // An absolute URL on the request's own origin: Next's middleware adapter parses `Location` with
  // `new URL()` and no base, so a relative one throws and every lapsed visit becomes a 500. Next
  // then sends a same-host redirect relative again, so behind the load balancer (where this
  // process sees `localhost`) the browser still stays on the public origin its cookies belong to.
  // `decision.location` is always a path of this portal, built from `safeReturnTo`.
  const response = NextResponse.redirect(new URL(decision.location, request.nextUrl), 307);
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
