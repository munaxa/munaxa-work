import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The portal's half of authenticated access: what it sends, and what it makes of the answer.
 *
 * Two properties are under test and neither is about HTTP plumbing.
 *
 * **A request carries the caller's own credential, or none.** There is no service account in this
 * portal and no credential of its own, so a signed-out reader is refused rather than served as
 * somebody. The token is read from Platform's `httpOnly` cookie on the server, never handled by
 * the browser, and never returned to anything that could render it.
 *
 * **A refusal keeps its reason.** Every read used to collapse to `undefined`, so "sign in",
 * "you are not a member here", "you lack this permission" and "there is nothing here" arrived as
 * one indistinguishable blank. The suite below is mostly about telling them apart, because that
 * distinction is the whole product difference between a person who can act and a person who
 * concludes the system is broken.
 */

const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: (): Promise<{ get: (name: string) => { value: string } | undefined }> =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { value };
      },
    }),
}));

vi.mock('@work/config', () => ({
  loadPortalProcessEnvironment: (): { WORK_API_URL: string } => ({
    WORK_API_URL: 'http://api.test',
  }),
}));

const { apiOutcome, apiRead } = await import('./api-request.js');
const { PLATFORM_SESSION_COOKIE, TENANT_SELECTION_COOKIE } = await import('./platform-session.js');

/** One recorded request, so the suite can assert what actually went out. */
interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
}

let sent: Sent[] = [];

const answering = (status: number, body: unknown = {}, text = ''): ReturnType<typeof vi.fn> =>
  vi.fn((url: string, init: { headers?: Record<string, string> }) => {
    sent.push({ url, headers: init.headers ?? {} });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(text),
    });
  });

const signedIn = (token = 'a-platform-access-token'): void => {
  cookieJar.set(PLATFORM_SESSION_COOKIE, token);
};

beforeEach(() => {
  cookieJar.clear();
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the portal sends', () => {
  it('forwards the Platform session as a bearer credential', async () => {
    signedIn('the-token');
    vi.stubGlobal('fetch', answering(200, { items: [] }));

    await apiOutcome('/people');

    expect(sent[0]?.headers).toMatchObject({ authorization: 'Bearer the-token' });
  });

  it('sends no tenant header until this browser has chosen one', async () => {
    signedIn();
    vi.stubGlobal('fetch', answering(200));

    await apiOutcome('/people');

    // A single membership resolves without being named. Sending a header regardless would be the
    // portal choosing a tenant, which is the one thing selection may never become.
    expect(Object.keys(sent[0]?.headers ?? {})).toEqual(['authorization']);
  });

  it('forwards the tenant this browser selected, as a selection', async () => {
    signedIn();
    cookieJar.set(TENANT_SELECTION_COOKIE, '01920000-0000-7000-8000-0000000000aa');
    vi.stubGlobal('fetch', answering(200));

    await apiOutcome('/people');

    expect(sent[0]?.headers['x-munaxa-tenant']).toBe('01920000-0000-7000-8000-0000000000aa');
  });

  it('reads live data every time, because this is one tenant’s personal data', async () => {
    signedIn();
    let init: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        init = options;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }),
    );

    await apiOutcome('/people');

    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('addresses the API configured for the deployment', async () => {
    signedIn();
    vi.stubGlobal('fetch', answering(200));

    await apiOutcome('/people/123');

    expect(sent[0]?.url).toBe('http://api.test/api/v1/people/123');
  });
});

describe('a reader who is not signed in', () => {
  it('is unauthenticated, and no request is made at all', async () => {
    const fetcher = answering(200);
    vi.stubGlobal('fetch', fetcher);

    expect(await apiOutcome('/people')).toEqual({ kind: 'unauthenticated' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('is unauthenticated when the cookie is present but empty', async () => {
    cookieJar.set(PLATFORM_SESSION_COOKIE, '   ');
    vi.stubGlobal('fetch', answering(200));

    expect(await apiOutcome('/people')).toEqual({ kind: 'unauthenticated' });
  });

  it('cannot be made a caller by selecting a tenant', async () => {
    // A tenant selection is not a credential, and a browser that sets one is still nobody.
    cookieJar.set(TENANT_SELECTION_COOKIE, '01920000-0000-7000-8000-0000000000aa');
    const fetcher = answering(200);
    vi.stubGlobal('fetch', fetcher);

    expect(await apiOutcome('/people')).toEqual({ kind: 'unauthenticated' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('what an answer meant', () => {
  beforeEach(() => {
    signedIn();
  });

  it('carries the value when the API answered', async () => {
    vi.stubGlobal('fetch', answering(200, { items: [1, 2] }));

    expect(await apiOutcome('/people')).toEqual({ kind: 'ok', value: { items: [1, 2] } });
  });

  it('is unauthenticated when the API refused the credential', async () => {
    vi.stubGlobal('fetch', answering(401, {}, 'Not authenticated.'));

    expect(await apiOutcome('/people')).toEqual({ kind: 'unauthenticated' });
  });

  it('is a missing membership when the API authenticated but resolved no tenant', async () => {
    // The API answers 401 rather than 403 here on purpose — "you are not a member of that tenant"
    // would confirm the tenant exists — so only the body distinguishes it from an expired token,
    // and a signed-in reader needs to know that signing in again will not help.
    vi.stubGlobal('fetch', answering(401, {}, 'No tenant resolved for this principal.'));

    expect(await apiOutcome('/people')).toEqual({ kind: 'no-membership' });
  });

  it('is forbidden when the caller is a member without the permission', async () => {
    vi.stubGlobal('fetch', answering(403));

    expect(await apiOutcome('/people')).toEqual({ kind: 'forbidden' });
  });

  it('is missing when there is no such record', async () => {
    vi.stubGlobal('fetch', answering(404));

    expect(await apiOutcome('/people/nope')).toEqual({ kind: 'missing' });
  });

  it.each([500, 502, 503, 418])(
    'is unavailable on %s — the API, not the caller',
    async (status) => {
      vi.stubGlobal('fetch', answering(status));

      expect(await apiOutcome('/people')).toEqual({ kind: 'unavailable' });
    },
  );

  it('is unavailable when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    expect(await apiOutcome('/people')).toEqual({ kind: 'unavailable' });
  });

  it('never collapses a refusal into an empty result', async () => {
    for (const [status, body] of [
      [401, 'Not authenticated.'],
      [403, ''],
      [500, ''],
    ] as const) {
      vi.stubGlobal('fetch', answering(status, {}, body));
      const answer = await apiOutcome('/people');

      expect(answer.kind).not.toBe('ok');
      expect(answer).not.toEqual({ kind: 'ok', value: undefined });
    }
  });

  it('falls back to unauthenticated when a 401 carries no readable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        sent.push({ url: '', headers: {} });
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({}),
          text: () => Promise.reject(new Error('no body')),
        });
      }),
    );

    expect(await apiOutcome('/people')).toEqual({ kind: 'unauthenticated' });
  });
});

describe('the value-or-nothing read that sections use', () => {
  it('answers the value when the API answered', async () => {
    signedIn();
    vi.stubGlobal('fetch', answering(200, { total: 3 }));

    expect(await apiRead('/people')).toEqual({ total: 3 });
  });

  it.each([
    ['not signed in', undefined, 200],
    ['refused', 'a-token', 403],
    ['unreachable', 'a-token', 500],
  ])('answers nothing when %s', async (_description, token, status) => {
    if (token !== undefined) signedIn(token);
    vi.stubGlobal('fetch', answering(status));

    expect(await apiRead('/people')).toBeUndefined();
  });
});
