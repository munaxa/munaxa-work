import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';

/**
 * An in-memory model of Munaxa Identity for `session-revocation.instances.spec.ts`: it signs real
 * ES256 tokens, keeps sessions, accounts and refresh lineages, and answers
 * `GET /api/auth/introspect` over real HTTP with Identity's contract. That the real Identity holds
 * to these rules is proved in munaxa-identity (`token-introspection.integration.test.ts`).
 */

export const ISSUER = 'https://identity.test.invalid';
export const AUDIENCE = 'munaxa-work';
export const KID = 'identity-test';
export const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Identity's side: signs, keeps sessions, and answers introspection. */
export class IdentityStandIn {
  public readonly minted = new TokenService({
    signer: new AsymmetricSigner('ES256', [
      { kid: KID, privateKey: keys.privateKey, publicKey: keys.publicKey },
    ]),
    issuer: ISSUER,
    audience: [AUDIENCE],
  });
  public readonly accounts = new Map<string, { tid: string; ver: number; active: boolean }>();
  public readonly sessions = new Map<string, { sub: string; tid: string; revoked: boolean }>();
  /** refresh token → { sid, used } */
  public readonly refreshTokens = new Map<string, { sid: string; used: boolean }>();
  public mode: 'up' | 'unavailable' | 'slow' = 'up';
  public introspections = 0;
  private server: Server | undefined;
  public url = '';

  public async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.answer(request.headers.authorization, request.url ?? '').then(
        ({ status, body }) => {
          response.writeHead(status, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          });
          response.end(JSON.stringify(body));
        },
      );
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${String(port)}/api/auth/introspect`;
  }

  public async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private async answer(
    authorization: string | undefined,
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    this.introspections += 1;
    if (path !== '/api/auth/introspect') return { status: 404, body: {} };
    if (this.mode === 'unavailable') return { status: 503, body: { code: 'AUTH_UNAVAILABLE' } };
    if (this.mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1_000));
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (token === undefined) return { status: 200, body: { active: false } };
    try {
      const claims = this.minted.verifyAccessToken(token);
      return {
        status: 200,
        body: this.isLive(claims)
          ? { active: true, sub: claims.sub, tid: claims.tid, sid: claims.sid, exp: claims.exp }
          : { active: false },
      };
    } catch {
      return { status: 200, body: { active: false } };
    }
  }

  /** Identity's `resolvePrincipal`, in miniature: account active, version current, session live. */
  private isLive(claims: { sub: string; tid?: string; sid?: string; ver?: number }): boolean {
    const account = this.accounts.get(claims.sub);
    const session = claims.sid === undefined ? undefined : this.sessions.get(claims.sid);
    if (account === undefined || session === undefined) return false;
    return (
      account.active &&
      account.ver === claims.ver &&
      !session.revoked &&
      session.sub === claims.sub &&
      session.tid === claims.tid
    );
  }

  public signIn(sub: string, tid = 'org-a'): { access: string; refresh: string; sid: string } {
    if (!this.accounts.has(sub)) this.accounts.set(sub, { tid, ver: 1, active: true });
    const sid = `sess_${randomUUID()}`;
    this.sessions.set(sid, { sub, tid, revoked: false });
    return { access: this.mint(sub, sid), refresh: this.newRefresh(sid), sid };
  }

  /** Rotation with reuse detection, as Identity's `attemptRefresh` does it. */
  public refresh(token: string): { access: string; refresh: string } | undefined {
    const record = this.refreshTokens.get(token);
    if (record === undefined) return undefined;
    const session = this.sessions.get(record.sid);
    if (record.used) {
      if (session !== undefined) session.revoked = true; // two parties hold the lineage
      return undefined;
    }
    record.used = true;
    if (session === undefined || session.revoked) return undefined;
    const account = this.accounts.get(session.sub);
    if (account === undefined || !account.active) return undefined;
    return { access: this.mint(session.sub, record.sid), refresh: this.newRefresh(record.sid) };
  }

  public revoke(sid: string): void {
    const session = this.sessions.get(sid);
    if (session !== undefined) session.revoked = true;
  }

  /** Password reset or change: version bump and every session. */
  public resetPassword(sub: string): void {
    const account = this.accounts.get(sub);
    if (account !== undefined) account.ver += 1;
    for (const session of this.sessions.values()) if (session.sub === sub) session.revoked = true;
  }

  /** Lockdown: status first, sessions after (the order Identity's `disable` uses). */
  public lockDown(sub: string, alsoRevokeSessions = true): void {
    const account = this.accounts.get(sub);
    if (account !== undefined) account.active = false;
    if (alsoRevokeSessions) {
      for (const session of this.sessions.values()) if (session.sub === sub) session.revoked = true;
    }
  }

  public mint(sub: string, sid: string, ttlMs?: number): string {
    const account = this.accounts.get(sub);
    return this.minted.issueAccessToken({
      subject: sub,
      tenantId: (account?.tid ?? 'org-a') as never,
      tokenVersion: account?.ver ?? 1,
      sessionId: sid as never,
      authMethods: ['pwd', 'otp'],
      mfaSatisfied: true,
      permissions: ['work:organization:tenant-settings:read'],
      ...(ttlMs === undefined ? {} : { ttl: ttlMs }),
    }).token;
  }

  private newRefresh(sid: string): string {
    const token = randomBytes(24).toString('base64url');
    this.refreshTokens.set(token, { sid, used: false });
    return token;
  }
}
