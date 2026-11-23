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
    if (decision.clearAttempt === true) passing.cookies.delete(REFRESH_ATTEMPT_COOKIE);
    return passing;
  }

  // A relative `Location`, deliberately: behind the load balancer the request URL this process
  // sees is not the public origin, and an absolute redirect built from it would leave the origin
  // the session cookies belong to. Browsers resolve a relative `Location` against the page.
  const response = new NextResponse(null, {
    status: 307,
    headers: { location: decision.location, 'cache-control': 'no-store' },
  });
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
