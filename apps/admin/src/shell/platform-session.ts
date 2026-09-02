import { cookies } from 'next/headers';

/**
 * The authenticated caller's credential, as it reaches this portal.
 *
 * **The cookie is Platform's, and its name and semantics are Platform's too.** `@munaxa/auth`
 * defines `__Host-mx_session` and sets it with the access token as its value; it is `httpOnly`,
 * `secure` and `__Host-` prefixed, which is not configurable there and must not be reinvented
 * here. This portal reads it and nothing else: it does not issue it, refresh it, validate it or
 * decode it. Refresh lives at Platform's own endpoint, path-scoped so the long-lived credential
 * is not attached to any request this application makes.
 *
 * **Why this file exists at all.** Reading a cookie is one line; keeping the *rules* about it in
 * one place is the point. There are three, and each closes a specific way a portal leaks a
 * credential:
 *
 * - **It is read on the server, and only on the server.** `next/headers` is unavailable in a
 *   client component, so a change that tried to reach the token from the browser would not
 *   compile. Nothing here is ever passed to a client component as a prop.
 * - **The token is never returned to a caller that could render it.** `authorization()` yields a
 *   header value, and the one thing anybody does with a header value is send it. There is
 *   deliberately no accessor that hands back the raw token.
 * - **Its absence is a state, not an error.** Signed out is the ordinary condition of a portal
 *   nobody has signed into yet, and it renders a sign-in prompt rather than a stack trace.
 *
 * Until Platform's authentication service is deployed, nothing sets this cookie and every read
 * answers "signed out" — which is honest, and is what the sign-in state says.
 */

/** Platform's session cookie. The name is `@munaxa/auth`'s `SESSION_COOKIE`, not ours. */
export const PLATFORM_SESSION_COOKIE = '__Host-mx_session';

/**
 * Which of the caller's tenants this browser last chose.
 *
 * Work's own cookie rather than Platform's, because the choice is Work's concept: Platform has no
 * opinion about which Munaxa Work tenant somebody is looking at. It carries a *selection* and
 * never an authority — the API resolves the caller's active memberships from stored rows and uses
 * this only to narrow that set (ADR-0032). A browser that invents a value here reaches a tenant it
 * is not a member of exactly as far as it would have without one: nowhere.
 */
export const TENANT_SELECTION_COOKIE = 'munaxa_work_tenant';

/** The header the API reads a tenant *selection* from. Never a grant. */
export const TENANT_HEADER = 'x-munaxa-tenant';

/**
 * The `Authorization` header for the current request, or nothing when nobody is signed in.
 *
 * Returns the assembled header rather than the token so that the only available use of it is the
 * correct one.
 */
export const authorization = async (): Promise<string | undefined> => {
  const session = (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;

  return session === undefined || session.trim() === '' ? undefined : `Bearer ${session}`;
};

/** The tenant this browser selected, if it has selected one. */
export const selectedTenant = async (): Promise<string | undefined> => {
  const chosen = (await cookies()).get(TENANT_SELECTION_COOKIE)?.value;

  return chosen === undefined || chosen.trim() === '' ? undefined : chosen.trim();
};

/** Whether a credential is present at all. What the shell asks to decide what to render. */
export const isSignedIn = async (): Promise<boolean> => (await authorization()) !== undefined;
