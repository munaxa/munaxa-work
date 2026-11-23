/**
 * Keeping a signed-in person signed in, and in the tenant they chose (MW-007).
 *
 * Pure on purpose: no `next/*`, no React, no environment. The middleware, the refresh page, the
 * tenant picker and the tests all decide through these functions, so the browser test exercises
 * the same decisions production makes rather than a copy of them.
 *
 * **Why the portal cannot refresh on the server.** Identity sets two cookies (munaxa-identity
 * `apps/api/src/auth/cookies.ts`): the access token in `__Host-mx_session` (`Path=/`, 15 minutes)
 * and the refresh token in `__Secure-mx_refresh`, scoped to `Path=/api/auth/refresh` so that it is
 * attached to no other request on the shared origin. The browser therefore never sends the refresh
 * token to this portal, and that is the design working: the portal never holds the long-lived
 * credential. On the shared origin (`work.test.munaxa.com`) the load balancer routes `/api/auth/*`
 * to Identity, so the *browser* can post to `/api/auth/refresh` — same origin, an origin Identity
 * trusts — and receive a new access cookie. This module decides when to send it there and what to
 * do with the answer.
 *
 * **"A refresh may exist" is all the portal can know.** The refresh cookie is invisible here. So an
 * absent or expired access cookie on a page navigation sends the browser through the refresh page
 * once, marked by a short-lived cookie so that a browser with no refresh token is not bounced in a
 * loop: the second time round the page renders its signed-out state, which links to sign-in.
 */

/** Platform's access cookie. The name is `@munaxa/auth`'s `SESSION_COOKIE`, not ours. */
export const PLATFORM_SESSION_COOKIE = '__Host-mx_session';

/** Which of the caller's tenants this browser chose. A selection, never an authority. */
export const TENANT_SELECTION_COOKIE = 'munaxa_work_tenant';

/** Set while a refresh is being attempted, so that a failed one is not retried in a loop. */
export const REFRESH_ATTEMPT_COOKIE = 'munaxa_work_refresh_attempt';

/** Long enough for one round trip through the refresh page; short enough to retry on next use. */
export const REFRESH_ATTEMPT_SECONDS = 60;

/** Identity's refresh endpoint, on the shared origin. */
export const IDENTITY_REFRESH_PATH = '/api/auth/refresh';

/** The portal's own session pages. */
export const REFRESH_PAGE = '/session/refresh';
export const TENANT_PAGE = '/session/tenant';

/**
 * Refresh this long before the token's own expiry, so that a page rendered just before the
 * deadline does not call the API with a token that expires in flight.
 */
export const EXPIRY_MARGIN_MS = 30_000;

/** The attributes every cookie this portal writes carries. */
export const PORTAL_COOKIE = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

/** How long a tenant choice is remembered. It is a preference, re-validated on every use. */
export const TENANT_SELECTION_SECONDS = 60 * 60 * 24 * 30;

/** C0 controls and DEL, which browsers strip before parsing and so can hide a `//`. */
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * A same-origin path to return to, or `/`.
 *
 * The same rules as Identity's `safeReturnTo`: a path on this origin and nothing else. An absolute
 * URL, `//host`, a backslash (which browsers read as `/`) or a control character would make the
 * refresh page an open redirect.
 */
export const safeReturnTo = (requested: string | undefined): string =>
  requested !== undefined &&
  requested.startsWith('/') &&
  !requested.startsWith('//') &&
  !requested.includes('\\') &&
  !hasControlCharacter(requested)
    ? requested
    : '/';

/**
 * When the access token says it expires, in milliseconds, or `undefined` when it cannot be read.
 *
 * **A routing hint, never an authorization.** The token is not verified here and nothing is
 * granted on what this returns: the API verifies every token on every request. Reading `exp` only
 * lets the portal refresh before it sends a token the API is about to refuse, instead of after.
 */
export const accessTokenExpiresAt = (token: string): number | undefined => {
  const payload = token.split('.')[1];
  if (payload === undefined || payload === '') return undefined;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64));
    if (typeof claims !== 'object' || claims === null) return undefined;
    const exp = (claims as { readonly exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1_000 : undefined;
  } catch {
    return undefined;
  }
};

/** Whether this access cookie can still be sent, as far as the portal can tell. */
export const isUsable = (token: string | undefined, nowMs: number): boolean => {
  if (token === undefined || token.trim() === '') return false;
  const expiresAt = accessTokenExpiresAt(token);
  // An unreadable token is passed on, not refreshed: the API is the judge of it.
  return expiresAt === undefined || expiresAt - EXPIRY_MARGIN_MS > nowMs;
};

const isPage = (pathname: string): boolean =>
  !pathname.startsWith('/_next') &&
  !pathname.startsWith('/api/') &&
  !pathname.startsWith('/session/') &&
  !/\.[a-z0-9]+$/i.test(pathname);

export interface SessionRequest {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly accessToken: string | undefined;
  /** Whether the refresh-attempt marker is present. */
  readonly attempted: boolean;
  readonly nowMs: number;
}

export type SessionDecision =
  /** Render the page. `clearAttempt` when a refresh just succeeded and its marker is spent. */
  | { readonly kind: 'pass'; readonly clearAttempt?: true }
  | { readonly kind: 'refresh'; readonly location: string };

/**
 * What to do with one request before the page renders.
 *
 * Only a page navigation is redirected. An asset, an API call or the session pages themselves
 * always pass, and so does a request that already went through the refresh page once.
 */
export const sessionDecision = (request: SessionRequest): SessionDecision => {
  const navigation = request.method === 'GET' || request.method === 'HEAD';

  if (!navigation || !isPage(request.pathname)) return { kind: 'pass' };
  if (isUsable(request.accessToken, request.nowMs)) {
    // The refresh worked. Forget the attempt now, so the next lapse is refreshed too, rather than
    // being mistaken for this one failing.
    return request.attempted ? { kind: 'pass', clearAttempt: true } : { kind: 'pass' };
  }
  if (request.attempted) return { kind: 'pass' };

  const returnTo = safeReturnTo(`${request.pathname}${request.search}`);
  return { kind: 'refresh', location: `${REFRESH_PAGE}?returnTo=${encodeURIComponent(returnTo)}` };
};

/** Where the refresh page sends the browser for each outcome. */
export interface RefreshPlan {
  readonly returnTo: string;
  readonly signInUrl: string | undefined;
  readonly refreshPath: string;
}

export interface BrowserEnvironment {
  readonly fetch: (
    input: string,
    init: {
      method: string;
      credentials: 'same-origin';
      headers: Record<string, string>;
      body: string;
    },
  ) => Promise<{ readonly ok: boolean; readonly status: number }>;
  readonly replace: (url: string) => void;
}

export type RefreshOutcome = 'refreshed' | 'signed-out' | 'unavailable';

/**
 * Runs in the browser: renew the access cookie at Identity, then go back where the person was.
 *
 * **Self-contained on purpose.** It names nothing outside its own body, because the browser test
 * serves it to a real browser from its source text, exactly as the refresh page runs it.
 *
 * - renewed → back to the page that was asked for, now with a fresh access cookie;
 * - refused (401: no refresh token, or a revoked one) → to sign-in, returning to the same page;
 * - Identity unavailable or rate-limited → back to the page, which says it is signed out; the
 *   attempt marker stops this from becoming a loop, and the next navigation tries again.
 */
export const refreshAndReturn = async (
  plan: RefreshPlan,
  environment: BrowserEnvironment,
): Promise<RefreshOutcome> => {
  let status = 0;
  try {
    const response = await environment.fetch(plan.refreshPath, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    status = response.ok ? 200 : response.status;
  } catch {
    status = 0;
  }

  if (status === 200) {
    environment.replace(plan.returnTo);
    return 'refreshed';
  }
  if (status === 401 && plan.signInUrl !== undefined) {
    const separator = plan.signInUrl.includes('?') ? '&' : '?';
    environment.replace(
      `${plan.signInUrl}${separator}returnTo=${encodeURIComponent(plan.returnTo)}`,
    );
    return 'signed-out';
  }
  environment.replace(plan.returnTo);
  return status === 401 ? 'signed-out' : 'unavailable';
};

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a Work tenant identifier. Shape only: membership is the API's. */
export const isTenantId = (value: string | undefined): value is string =>
  value !== undefined && TENANT_ID.test(value.trim());

/**
 * The tenant to remember, or `undefined` to remember none.
 *
 * Checked against the tenants the API just listed for this principal, on the server. A value the
 * browser made up — or a tenant the person has since left — is never written.
 */
export const chosenTenant = (
  requested: string | undefined,
  memberOf: readonly string[],
): string | undefined => {
  if (!isTenantId(requested)) return undefined;
  const wanted = requested.trim().toLowerCase();
  return memberOf.find((tenantId) => tenantId.toLowerCase() === wanted);
};

/** A `Set-Cookie` value for the tenant selection, for a server that has no cookie API of its own. */
export const tenantSelectionHeader = (tenantId: string | undefined): string =>
  tenantId === undefined
    ? `${TENANT_SELECTION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`
    : `${TENANT_SELECTION_COOKIE}=${tenantId}; Path=/; Max-Age=${TENANT_SELECTION_SECONDS}; Secure; HttpOnly; SameSite=Lax`;

/** A `Set-Cookie` value for the refresh-attempt marker, or one that clears it. */
export const refreshAttemptHeader = (set: boolean): string =>
  `${REFRESH_ATTEMPT_COOKIE}=${set ? '1' : ''}; Path=/; Max-Age=${set ? REFRESH_ATTEMPT_SECONDS : 0}; Secure; HttpOnly; SameSite=Lax`;
