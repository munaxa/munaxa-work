/**
 * The one place this portal talks to the Work API, and the one place it decides what an answer
 * meant.
 *
 * Two jobs, and they belong together because the second is a consequence of the first.
 *
 * **It forwards the caller's own credential.** Every read is made *as the signed-in person*, not
 * as the portal: the Platform access token goes out as `Authorization: Bearer`, and the tenant the
 * browser selected goes out as a selection header the API is free to refuse. The portal holds no
 * credential of its own and has no way to act as anybody — there is no service account here, and
 * a request with no session simply carries no authorization and is refused, which is correct.
 *
 * **It keeps the answers apart.** Before this, every read collapsed to `undefined`, so a screen
 * could not tell "nobody is signed in" from "you may not read this" from "there is nothing here" —
 * and rendered the same empty state for all three. That is the difference between a person
 * learning they need to sign in and a person concluding the product is broken. The vocabulary
 * below is deliberately wider than HTTP status codes, because the two 401s the API returns mean
 * genuinely different things to a reader:
 *
 * ```text
 * no session at all             → 'unauthenticated'   sign in
 * 401 "Not authenticated."      → 'unauthenticated'   the token expired or was refused
 * 401 "No tenant resolved…"     → 'no-membership'     signed in, but not a member here
 * 403                           → 'forbidden'         a member, without this permission
 * 404                           → 'missing'           no such record
 * 2xx                           → 'ok'
 * anything else, or no answer   → 'unavailable'       the API, not the caller
 * ```
 *
 * `no-membership` is the one worth dwelling on. The API answers 401 rather than 403 for a
 * principal with no usable membership on purpose — saying "you are not a member of that tenant"
 * would confirm the tenant exists — so the status alone cannot distinguish it from an expired
 * token. The body can, and a reader who is signed in needs to be told that signing in again will
 * not help.
 */

import { loadPortalProcessEnvironment } from '@work/config';

import { authorization, selectedTenant, TENANT_HEADER } from './platform-session';

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** What a read answered. Wider than `undefined`, which is the whole point. */
export type ApiOutcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  /** Nobody is signed in, or the credential was refused. Signing in is the remedy. */
  | { readonly kind: 'unauthenticated' }
  /** Signed in, and a member of no tenant this request could act in. Signing in again will not help. */
  | { readonly kind: 'no-membership' }
  /** A member of this tenant, without the permission the operation requires. */
  | { readonly kind: 'forbidden' }
  /** No such record — or one the owning module answers 404 for deliberately. */
  | { readonly kind: 'missing' }
  /** The API did not answer, or answered with a fault of its own. Not the caller's doing. */
  | { readonly kind: 'unavailable' };

/** The states a screen renders, which is the outcome vocabulary minus the value. */
export type ApiState = ApiOutcome<unknown>['kind'];

/**
 * The API's own words for a principal it authenticated but could not place in a tenant.
 *
 * Matched loosely on purpose: the guard's message is the contract this reads, and a portal that
 * broke on a full stop would be worse than one that occasionally reports the more general state.
 */
const NO_TENANT = 'no tenant resolved';

const refusalFrom = async (response: Response): Promise<'unauthenticated' | 'no-membership'> => {
  try {
    const body = await response.text();

    return body.toLowerCase().includes(NO_TENANT) ? 'no-membership' : 'unauthenticated';
  } catch {
    return 'unauthenticated';
  }
};

/**
 * The headers one request carries.
 *
 * Assembled per request rather than once per process: a module-level value would be one caller's
 * credential shared by everybody the server answered afterwards.
 */
const headersFor = async (): Promise<HeadersInit> => {
  const credential = await authorization();
  const tenant = await selectedTenant();

  return {
    ...(credential === undefined ? {} : { authorization: credential }),
    // Sent only when this browser actually chose one. An absent header lets the API resolve a
    // single membership by itself, which is the ordinary case and the one that needs no choosing.
    ...(tenant === undefined ? {} : { [TENANT_HEADER]: tenant }),
  };
};

/**
 * Reads one path from the API as the signed-in caller.
 *
 * `cache: 'no-store'` on every read, unchanged: this is one tenant's live data, and a cached page
 * of somebody's personal file is a page of personal data sitting somewhere nobody chose. It matters
 * more now than before — a cached response would be one *person's* answer served to another.
 */
export const apiOutcome = async <TValue>(path: string): Promise<ApiOutcome<TValue>> => {
  const credential = await authorization();

  // Answered without asking: an unauthenticated read would be refused, and sending it anyway
  // would put a request the API must reject on every screen a signed-out person opens.
  if (credential === undefined) return { kind: 'unauthenticated' };

  try {
    const response = await fetch(`${BASE}/api/v1${path}`, {
      cache: 'no-store',
      headers: await headersFor(),
    });

    if (response.ok) return { kind: 'ok', value: (await response.json()) as TValue };
    if (response.status === 401) return { kind: await refusalFrom(response) };
    if (response.status === 403) return { kind: 'forbidden' };
    if (response.status === 404) return { kind: 'missing' };
    return { kind: 'unavailable' };
  } catch {
    // The API was unreachable. Not a refusal, and saying so is what stops an outage from reading
    // as "you have no permission".
    return { kind: 'unavailable' };
  }
};

/**
 * The value, or nothing.
 *
 * Kept for the sections that genuinely have one thing to say either way — a section is present or
 * it is absent — while the route that *defines* a screen asks `apiOutcome` and acts on the reason.
 */
export const apiRead = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await apiOutcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};
