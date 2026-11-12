import { describe, expect, it } from 'vitest';

import { IdentitySessionStatus, type UnavailableReason } from './session-revocation.js';

/**
 * The revocation check on its own, against a scripted Identity and a controlled clock (WK-02).
 *
 * What is proved here is the part only this class owns: how long an answer is trusted, that a
 * refusal is never undone by a later or earlier answer, that every failure refuses and is not
 * remembered, and that the token never leaves the request it was sent in. That Identity answers
 * correctly after each kind of revocation is proved in munaxa-identity's own suite; the two
 * together are the guarantee ADR-0080 states.
 */

const INTROSPECTION_URL = 'https://id.example.test/api/auth/introspect';
const T0 = 1_800_000_000_000;
const CLAIMS = { sub: 'acct-1', tid: 'org-1', sid: 'sess-1', exp: T0 / 1_000 + 900 };
const TOKEN = 'header.payload.signature-of-a-real-looking-token';

interface Scripted {
  readonly fetch: typeof fetch;
  readonly calls: { url: string; init: RequestInit }[];
  /** What Identity answers next. Mutable so a test can revoke mid-flight. */
  state: { active: boolean; status: number; body?: unknown; throws?: Error; delayMs?: number };
}

const identity = (): Scripted => {
  const scripted: Scripted = {
    calls: [],
    state: { active: true, status: 200 },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      scripted.calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        init: init ?? {},
      });
      const { active, status, body, throws, delayMs } = scripted.state;
      if (delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (throws !== undefined) throw throws;
      // Decided when the request *arrives*, as Identity decides it, after any delay.
      const answer =
        body ?? (scripted.state.active && active ? { active: true, ...CLAIMS } : { active: false });
      return new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  return scripted;
};

const clock = (start = T0) => {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const statusWith = (
  scripted: Scripted,
  time: ReturnType<typeof clock>,
  options: { cacheMs?: number; timeoutMs?: number; maxEntries?: number } = {},
  reasons: UnavailableReason[] = [],
) =>
  new IdentitySessionStatus({
    url: INTROSPECTION_URL,
    cacheMs: options.cacheMs ?? 5_000,
    timeoutMs: options.timeoutMs ?? 2_000,
    fetch: scripted.fetch,
    now: time.now,
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    onUnavailable: (reason) => reasons.push(reason),
  });

describe('before and after revocation', () => {
  it('accepts a live session, sending only the bearer token to the configured URL', async () => {
    const scripted = identity();
    const status = statusWith(scripted, clock());

    expect(await status.isActive(TOKEN, CLAIMS)).toBe(true);
    expect(scripted.calls).toHaveLength(1);
    const [call] = scripted.calls;
    expect(call?.url).toBe(INTROSPECTION_URL);
    expect(call?.init.method).toBe('GET');
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect((call?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses the same token on the very next request once Identity says revoked (no cache)', async () => {
    const scripted = identity();
    const status = statusWith(scripted, clock(), { cacheMs: 0 });

    expect(await status.isActive(TOKEN, CLAIMS)).toBe(true);
    scripted.state.active = false;
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
  });

  it('reuses a positive answer for at most cacheMs, measured from when it was asked', async () => {
    const scripted = identity();
    const time = clock();
    const status = statusWith(scripted, time, { cacheMs: 5_000 });

    expect(await status.isActive(TOKEN, CLAIMS)).toBe(true);
    scripted.state.active = false; // revoked at T0, just after the answer

    time.advance(4_999);
    // Inside the window the earlier answer stands: this is the accepted, bounded delay.
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(true);
    expect(scripted.calls).toHaveLength(1);

    time.advance(1);
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
    expect(scripted.calls).toHaveLength(2);
  });

  it('never caches a positive answer beyond the token’s own expiry', async () => {
    const scripted = identity();
    const time = clock();
    const status = statusWith(scripted, time, { cacheMs: 30_000 });
    const shortLived = { ...CLAIMS, exp: T0 / 1_000 + 2 };

    expect(await status.isActive(TOKEN, shortLived)).toBe(true);
    time.advance(2_000);
    await status.isActive(TOKEN, shortLived);
    expect(scripted.calls).toHaveLength(2);
  });
});

describe('two independent Work API instances', () => {
  it('both stop accepting a revoked session within the window, with no coordination', async () => {
    const scripted = identity();
    const time = clock();
    const first = statusWith(scripted, time, { cacheMs: 5_000 });
    const second = statusWith(scripted, time, { cacheMs: 5_000 });

    expect(await first.isActive(TOKEN, CLAIMS)).toBe(true);
    time.advance(3_000);
    expect(await second.isActive(TOKEN, CLAIMS)).toBe(true);

    scripted.state.active = false; // revoked at T0+3s
    time.advance(2_000); // T0+5s: first's answer has lapsed, second's has 3s left
    expect(await first.isActive(TOKEN, CLAIMS)).toBe(false);
    expect(await second.isActive(TOKEN, CLAIMS)).toBe(true);
    time.advance(3_000); // T0+8s = revocation + cacheMs
    expect(await second.isActive(TOKEN, CLAIMS)).toBe(false);
  });

  it('a revocation seen by one instance is not undone by the other’s older answer', async () => {
    const scripted = identity();
    const time = clock();
    const first = statusWith(scripted, time);
    const second = statusWith(scripted, time);

    expect(await second.isActive(TOKEN, CLAIMS)).toBe(true);
    scripted.state.active = false;
    time.advance(5_000);
    expect(await first.isActive(TOKEN, CLAIMS)).toBe(false);
    expect(await second.isActive(TOKEN, CLAIMS)).toBe(false);
  });
});

describe('stale answers cannot restore authorization', () => {
  it('keeps a refusal until the token expires, even if Identity later said active', async () => {
    const scripted = identity();
    const time = clock();
    const status = statusWith(scripted, time, { cacheMs: 0 });

    scripted.state.active = false;
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
    // A stale replica, a restored backup, a misrouted response: none of them un-revokes.
    scripted.state.active = true;
    time.advance(60_000);
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
    expect(scripted.calls).toHaveLength(1);
  });

  it('an older in-flight positive answer that lands after a newer refusal still refuses', async () => {
    const scripted = identity();
    const time = clock();
    const status = statusWith(scripted, time, { cacheMs: 1_000 });

    scripted.state = { active: true, status: 200, body: { active: true, ...CLAIMS }, delayMs: 30 };
    const slow = status.isActive(TOKEN, CLAIMS);

    // Past the join window, so a new question is sent, and Identity now says revoked.
    time.advance(1_001);
    scripted.state = { active: false, status: 200 };
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);

    expect(await slow).toBe(false);
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
  });

  it('a clock stepped back does not let an older positive answer replace a refusal', async () => {
    // Within one instance a second question is only sent once the first answer's window has
    // passed, so the late positive is normally already stale. A wall clock stepped backwards
    // (an NTP correction) is the case where it is not, and the refusal must still win.
    const scripted = identity();
    const time = clock();
    const status = statusWith(scripted, time, { cacheMs: 1_000 });

    scripted.state = { active: true, status: 200, body: { active: true, ...CLAIMS }, delayMs: 30 };
    const slow = status.isActive(TOKEN, CLAIMS);

    time.advance(1_001);
    scripted.state = { active: false, status: 200 };
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);

    time.advance(-1_001);
    expect(await slow).toBe(false);
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
  });

  it('concurrent requests for one token share one question', async () => {
    const scripted = identity();
    scripted.state = { active: true, status: 200, delayMs: 10 };
    const status = statusWith(scripted, clock());

    const answers = await Promise.all(
      Array.from({ length: 20 }, () => status.isActive(TOKEN, CLAIMS)),
    );
    expect(answers.every(Boolean)).toBe(true);
    expect(scripted.calls).toHaveLength(1);
  });
});

describe('when Identity cannot answer', () => {
  const failures: [string, Scripted['state'], UnavailableReason][] = [
    [
      'a network error',
      { active: true, status: 200, throws: new TypeError('fetch failed') },
      'network',
    ],
    [
      'a timeout',
      {
        active: true,
        status: 200,
        throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
      },
      'timeout',
    ],
    ['a 503', { active: true, status: 503, body: { code: 'AUTH_UNAVAILABLE' } }, 'status-503'],
    ['a 500', { active: true, status: 500, body: 'boom' }, 'status-500'],
    ['a 429', { active: true, status: 429, body: {} }, 'status-429'],
    ['a redirect', { active: true, status: 302, body: '' }, 'status-302'],
    ['a body that is not JSON', { active: true, status: 200, body: '<html>' }, 'malformed'],
    ['an object with no "active"', { active: true, status: 200, body: { ok: true } }, 'malformed'],
    ['"active" as a string', { active: true, status: 200, body: { active: 'true' } }, 'malformed'],
    [
      'an answer about another subject',
      { active: true, status: 200, body: { active: true, ...CLAIMS, sub: 'acct-2' } },
      'mismatch',
    ],
    [
      'an answer about another organisation',
      { active: true, status: 200, body: { active: true, ...CLAIMS, tid: 'org-2' } },
      'mismatch',
    ],
    [
      'an answer about another session',
      { active: true, status: 200, body: { active: true, ...CLAIMS, sid: 'sess-2' } },
      'mismatch',
    ],
  ];

  it.each(failures)(
    'refuses on %s, remembers nothing, and says why without the token',
    async (_, state, reason) => {
      const scripted = identity();
      const reasons: UnavailableReason[] = [];
      const status = statusWith(scripted, clock(), {}, reasons);

      scripted.state = state;
      expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
      expect(reasons).toEqual([reason]);
      expect(JSON.stringify(reasons)).not.toContain(TOKEN);

      // Not cached: once Identity recovers, the next request is answered on its merits.
      scripted.state = { active: true, status: 200 };
      expect(await status.isActive(TOKEN, CLAIMS)).toBe(true);
      expect(scripted.calls).toHaveLength(2);
    },
  );

  it('a real timeout refuses within the configured bound', async () => {
    const hanging = (async (_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      })) as typeof fetch;
    const reasons: UnavailableReason[] = [];
    const status = new IdentitySessionStatus({
      url: INTROSPECTION_URL,
      cacheMs: 5_000,
      timeoutMs: 100,
      fetch: hanging,
      onUnavailable: (reason) => reasons.push(reason),
    });
    const started = Date.now();
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(reasons).toEqual(['timeout']);
  });

  it('a reporter that throws does not turn a refusal into an error', async () => {
    const scripted = identity();
    scripted.state = { active: true, status: 503 };
    const status = new IdentitySessionStatus({
      url: INTROSPECTION_URL,
      cacheMs: 5_000,
      timeoutMs: 2_000,
      fetch: scripted.fetch,
      onUnavailable: () => {
        throw new Error('logger down');
      },
    });
    expect(await status.isActive(TOKEN, CLAIMS)).toBe(false);
  });
});

describe('memory', () => {
  it('holds at most maxEntries digests, and an evicted refusal is simply asked again', async () => {
    const scripted = identity();
    scripted.state = { active: false, status: 200 };
    const status = statusWith(scripted, clock(), { maxEntries: 2 });

    for (const token of ['t1', 't2', 't3'])
      expect(await status.isActive(token, CLAIMS)).toBe(false);
    expect(scripted.calls).toHaveLength(3);
    // t1 was evicted; asking again still refuses.
    expect(await status.isActive('t1', CLAIMS)).toBe(false);
    expect(scripted.calls).toHaveLength(4);
    // t3 is still held.
    expect(await status.isActive('t3', CLAIMS)).toBe(false);
    expect(scripted.calls).toHaveLength(4);
  });
});
