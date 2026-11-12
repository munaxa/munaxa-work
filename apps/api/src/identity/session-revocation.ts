import { createHash } from 'node:crypto';

/**
 * Whether the Platform session behind a verified access token is still live (WK-02, ADR-0080).
 *
 * A JWT that verifies proves Identity issued it and that it has not expired. It cannot prove the
 * person has not signed out since, revoked that session from another device, reset their password
 * or been locked out — that state lives only in Identity, and before this a Work API honoured a
 * signed-out token for up to fifteen and a half minutes. This asks Identity's
 * `GET /api/auth/introspect`, which decides with the same gate (`resolvePrincipal`) every Identity
 * route uses, so there is one definition of "revoked" across the products.
 *
 * **The guarantee.** A positive answer is reused for at most `cacheMs`, measured from the moment
 * the question was *sent*, so every request this instance accepts is backed by an answer Identity
 * computed after `requestTime − cacheMs`. Hence: once Identity has committed a revocation at time R,
 * no request this instance receives after `R + cacheMs` is accepted with a token of that session.
 * Every instance asks Identity independently, so the bound holds per instance with no
 * coordination, and Identity's database is the only source of truth.
 *
 * **What can never happen.**
 * - A negative answer is never replaced by a positive one. It is kept until the token expires; a
 *   revoked session cannot be un-revoked in Identity, so the answer cannot change.
 * - A failure is never an answer. Timeout, network error, any status but 200, a body that is not
 *   exactly the expected shape, or an answer about some other subject, organisation or session:
 *   the request is refused and nothing is cached. This is fail-closed in every environment, not
 *   only in production; the only way to skip the check is to configure it off, which production
 *   refuses at startup.
 * - The token never reaches a log, an error or a cache key. Cache keys are SHA-256 digests.
 */

export interface SessionClaims {
  readonly sub: string;
  readonly tid: string;
  readonly sid: string;
  /** Seconds since the epoch. Nothing is cached past it. */
  readonly exp: number;
}

export interface SessionStatus {
  /** True only when Identity said, recently enough, that this exact session is live. */
  isActive(token: string, claims: SessionClaims): Promise<boolean>;
}

export type UnavailableReason =
  'timeout' | 'network' | `status-${number}` | 'malformed' | 'mismatch';

export interface IdentitySessionStatusOptions {
  readonly url: string;
  readonly cacheMs: number;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  /** Milliseconds since the epoch. Bound by tests. */
  readonly now?: () => number;
  /** The most digests held. The oldest are dropped first; a dropped entry is simply asked again. */
  readonly maxEntries?: number;
  /** Told why Identity could not answer. Never told the token. */
  readonly onUnavailable?: (reason: UnavailableReason) => void;
}

interface Entry {
  readonly active: boolean;
  /** Epoch milliseconds after which the entry is not used. */
  readonly until: number;
}

interface InFlight {
  readonly startedAt: number;
  readonly answer: Promise<boolean | undefined>;
}

const DEFAULT_MAX_ENTRIES = 10_000;

const digestOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Identity's answer about this token, or why it is not one. An "active" about anything but this
 * token's own subject, organisation and session is not an answer to the question that was asked.
 */
const answerFrom = (body: unknown, claims: SessionClaims): boolean | 'malformed' | 'mismatch' => {
  if (!isRecord(body) || typeof body.active !== 'boolean') return 'malformed';
  if (!body.active) return false;
  const same = body.sub === claims.sub && body.tid === claims.tid && body.sid === claims.sid;
  return same ? true : 'mismatch';
};

export class IdentitySessionStatus implements SessionStatus {
  readonly #url: string;
  readonly #cacheMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #maxEntries: number;
  readonly #onUnavailable: ((reason: UnavailableReason) => void) | undefined;
  readonly #entries = new Map<string, Entry>();
  readonly #inFlight = new Map<string, InFlight>();

  public constructor(options: IdentitySessionStatusOptions) {
    this.#url = options.url;
    this.#cacheMs = options.cacheMs;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#onUnavailable = options.onUnavailable;
  }

  public async isActive(token: string, claims: SessionClaims): Promise<boolean> {
    const key = digestOf(token);
    const now = this.#now();
    const cached = this.#cached(key, now);
    if (cached !== undefined) return cached;

    // Join a question already on its way only if it was sent recently enough that its answer could
    // still be reused; otherwise ask again. Either way the answer was computed by Identity after
    // `now - cacheMs`, which is the guarantee.
    const pending = this.#inFlight.get(key);
    if (pending !== undefined && now - pending.startedAt <= this.#cacheMs) {
      return (await pending.answer) === true;
    }

    const answer = this.#ask(token, claims);
    this.#inFlight.set(key, { startedAt: now, answer });
    try {
      const active = await answer;
      if (active !== undefined) this.#remember(key, active, now, claims.exp);
      // A negative recorded meanwhile (by a later question about the same token) wins.
      return active === true && this.#entries.get(key)?.active !== false;
    } finally {
      if (this.#inFlight.get(key)?.answer === answer) this.#inFlight.delete(key);
    }
  }

  /** A remembered answer still usable at `now`, or `undefined` to ask. A negative never lapses. */
  #cached(key: string, now: number): boolean | undefined {
    const cached = this.#entries.get(key);
    if (cached === undefined) return undefined;
    if (!cached.active) return false;
    if (now < cached.until) return true;
    this.#entries.delete(key);
    return undefined;
  }

  /** `true`, `false`, or `undefined` for "Identity could not say", which refuses and is not kept. */
  async #ask(token: string, claims: SessionClaims): Promise<boolean | undefined> {
    const response = await this.#request(token);
    if (typeof response === 'string') return this.#unavailable(response);

    if (response.status !== 200) {
      // Drain without reading it into anything: the body is not needed and must not be logged.
      await response.body?.cancel().catch(() => undefined);
      return this.#unavailable(`status-${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return this.#unavailable('malformed');
    }
    const answer = answerFrom(body, claims);
    return typeof answer === 'boolean' ? answer : this.#unavailable(answer);
  }

  async #request(token: string): Promise<Response | 'timeout' | 'network'> {
    try {
      return await this.#fetch(this.#url, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return timedOut ? 'timeout' : 'network';
    }
  }

  #remember(key: string, active: boolean, askedAt: number, exp: number): void {
    const expiresAt = exp * 1_000;
    const existing = this.#entries.get(key);
    if (existing !== undefined && !existing.active) return;

    const until = active ? Math.min(askedAt + this.#cacheMs, expiresAt) : expiresAt;
    if (active && until <= this.#now()) return;

    this.#entries.delete(key);
    this.#entries.set(key, { active, until });
    this.#evict();
  }

  /** Oldest first. Dropping a negative entry is safe: the next question gets the same answer. */
  #evict(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) return;
      this.#entries.delete(oldest);
    }
  }

  /** Reports why Identity could not say, and returns the "could not say" answer. */
  #unavailable(reason: UnavailableReason): undefined {
    try {
      this.#onUnavailable?.(reason);
    } catch {
      // A reporter that throws must not turn a refusal into a 500.
    }
    return undefined;
  }
}

/** For a deployment that configured the check off. Accepts everything a signature accepts. */
export const SESSION_STATUS_UNCHECKED: SessionStatus = {
  isActive: () => Promise.resolve(true),
};
