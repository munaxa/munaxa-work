import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  IDENTITY_REFRESH_PATH,
  PLATFORM_SESSION_COOKIE,
  REFRESH_ATTEMPT_COOKIE,
  REFRESH_PAGE,
  TENANT_PAGE,
  TENANT_SELECTION_COOKIE,
  chosenTenant,
  refreshAndReturn,
  refreshAttemptHeader,
  safeReturnTo,
  sessionDecision,
  tenantSelectionHeader,
} from '../../shell/session-continuity';

/**
 * One origin, as `work.test.munaxa.com` is one origin: the Admin portal's session decisions and a
 * stand-in Identity behind `/api/auth/*`, exactly as the load balancer routes them.
 *
 * The portal half runs the production decisions — `sessionDecision`, `safeReturnTo`,
 * `chosenTenant`, the cookie attributes — and serves `refreshAndReturn` to the browser from its own
 * source, so the browser executes the code the refresh page runs. What it does not run is Next
 * itself; the routing around those decisions is a few lines below.
 *
 * Identity is reduced to its cookie contract (munaxa-identity `apps/api/src/auth/cookies.ts`): an
 * access token in `__Host-mx_session` on `/`, a rotating refresh token in `__Secure-mx_refresh`
 * scoped to `/api/auth/refresh`, the origin check on the refresh post, and a 401 that clears both.
 *
 * **Time is simulated.** One real second is `scale` simulated milliseconds, so a fifteen-minute
 * token lives `TOKEN_REAL_SECONDS` in the browser's cookie jar and an hour passes in seconds. The
 * browser's own cookie expiry does the expiring; nothing is deleted by the test.
 */

export const TOKEN_SIMULATED_MS = 15 * 60_000;
export const TOKEN_REAL_SECONDS = 3;
const SCALE = TOKEN_SIMULATED_MS / (TOKEN_REAL_SECONDS * 1_000);
const REFRESH_COOKIE = '__Secure-mx_refresh';
const SIGN_IN_PATH = '/api/auth/login';

export const TENANT_A = '01920000-0000-7000-8000-0000000000aa';
export const TENANT_B = '01920000-0000-7000-8000-0000000000bb';

export interface Issued {
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface WorkOrigin {
  readonly origin: string;
  /** Every access token Identity issued, in simulated time. */
  readonly issued: readonly Issued[];
  refreshes(): number;
  simulatedNow(): number;
  /** Revokes every refresh token and closes sign-in, as an administrator ending a session would. */
  revokeEverything(): void;
  close(): Promise<void>;
}

const cookiesOf = (request: IncomingMessage): Map<string, string> =>
  new Map(
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.includes('='))
      .map((part) => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)]),
  );

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const html = (response: ServerResponse, body: string, status = 200): void => {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`<!doctype html><html><head><meta charset="utf-8"></head>${body}</html>`);
};

const readForm = async (request: IncomingMessage): Promise<URLSearchParams> => {
  let raw = '';
  for await (const chunk of request) raw += String(chunk);
  return new URLSearchParams(raw);
};

/** Script-safe JSON: nothing in it can close the script element it is written into. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

class Origin implements WorkOrigin {
  public origin = '';
  public readonly issued: Issued[] = [];
  private readonly started = Date.now();
  private readonly refreshTokens = new Set<string>();
  private readonly accessTokens = new Map<string, number>();
  private refreshCount = 0;
  private signInOpen = true;

  public constructor(private readonly server: Server) {}

  public refreshes(): number {
    return this.refreshCount;
  }

  public simulatedNow(): number {
    return Date.UTC(2026, 10, 23, 9) + (Date.now() - this.started) * SCALE;
  }

  public revokeEverything(): void {
    this.refreshTokens.clear();
    this.signInOpen = false;
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.origin);
    const route = `${request.method ?? 'GET'} ${url.pathname}`;

    const routes: Record<string, () => void | Promise<void>> = {
      [`POST ${IDENTITY_REFRESH_PATH}`]: () => {
        this.refresh(request, response);
      },
      [`GET ${SIGN_IN_PATH}`]: () => {
        this.signIn(url, response);
      },
      [`GET ${REFRESH_PAGE}`]: () => {
        this.refreshPage(url, response);
      },
      [`GET ${TENANT_PAGE}`]: () => {
        this.tenantPage(request, url, response);
      },
      [`POST ${TENANT_PAGE}`]: () => this.chooseTenant(request, response),
    };
    const handler = routes[route];
    if (handler !== undefined) {
      await handler();
      return;
    }
    this.page(request, url, response);
  }

  /** Identity: issue an access token and a refresh token, as sign-in and refresh both do. */
  private issue(response: ServerResponse): void {
    const now = this.simulatedNow();
    const access = `${encode({ alg: 'ES256' })}.${encode({ sub: 'tester', exp: Math.floor((now + TOKEN_SIMULATED_MS) / 1_000), jti: randomUUID() })}.signature`;
    const refresh = randomUUID();
    this.accessTokens.set(access, now + TOKEN_SIMULATED_MS);
    this.refreshTokens.add(refresh);
    this.issued.push({ issuedAt: now, expiresAt: now + TOKEN_SIMULATED_MS });
    response.setHeader('set-cookie', [
      `${PLATFORM_SESSION_COOKIE}=${access}; Path=/; Max-Age=${TOKEN_REAL_SECONDS}; Secure; HttpOnly; SameSite=Lax`,
      `${REFRESH_COOKIE}=${refresh}; Path=${IDENTITY_REFRESH_PATH}; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`,
    ]);
  }

  private refresh(request: IncomingMessage, response: ServerResponse): void {
    const presented = cookiesOf(request).get(REFRESH_COOKIE);
    // Identity's edge: a state-changing request from anywhere but a trusted origin is refused.
    if (request.headers.origin !== this.origin) {
      response.writeHead(403).end();
      return;
    }
    if (presented === undefined || !this.refreshTokens.delete(presented)) {
      response.setHeader('set-cookie', [
        `${PLATFORM_SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
        `${REFRESH_COOKIE}=; Path=${IDENTITY_REFRESH_PATH}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
      ]);
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"code":"AUTH_INVALID_CREDENTIALS"}');
      return;
    }
    this.refreshCount += 1;
    this.issue(response);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  }

  private signIn(url: URL, response: ServerResponse): void {
    const returnTo = safeReturnTo(url.searchParams.get('returnTo') ?? undefined);
    if (!this.signInOpen) {
      html(
        response,
        `<body data-state="sign-in" data-return-to="${encodeURIComponent(returnTo)}"></body>`,
      );
      return;
    }
    this.issue(response);
    response.writeHead(303, { location: returnTo }).end();
  }

  /** The refresh page: what `app/session/refresh/page.tsx` renders, with its client component inline. */
  private refreshPage(url: URL, response: ServerResponse): void {
    const plan = {
      returnTo: safeReturnTo(url.searchParams.get('returnTo') ?? undefined),
      signInUrl: SIGN_IN_PATH,
      refreshPath: IDENTITY_REFRESH_PATH,
    };
    html(
      response,
      `<body data-state="refreshing"><script type="module">
const refreshAndReturn = ${refreshAndReturn.toString()};
refreshAndReturn(${scriptJson(plan)}, {
  fetch: (input, init) => window.fetch(input, init),
  replace: (target) => window.location.replace(target),
});
</script></body>`,
    );
  }

  /** The Work API's view: a session it accepts, and the tenant a selection resolves to. */
  private resolved(request: IncomingMessage): { signedIn: boolean; tenant: string } {
    const jar = cookiesOf(request);
    const access = jar.get(PLATFORM_SESSION_COOKIE);
    const expiresAt = access === undefined ? undefined : this.accessTokens.get(access);
    const signedIn = expiresAt !== undefined && expiresAt > this.simulatedNow();
    const tenant = chosenTenant(jar.get(TENANT_SELECTION_COOKIE), [TENANT_A, TENANT_B]) ?? '';
    return { signedIn, tenant: signedIn ? tenant : '' };
  }

  /** Any portal page: the middleware's decision first, then what the page would show. */
  private page(request: IncomingMessage, url: URL, response: ServerResponse): void {
    const jar = cookiesOf(request);
    const decision = sessionDecision({
      method: request.method ?? 'GET',
      pathname: url.pathname,
      search: url.search,
      accessToken: jar.get(PLATFORM_SESSION_COOKIE),
      attempted: jar.has(REFRESH_ATTEMPT_COOKIE),
      nowMs: this.simulatedNow(),
    });
    if (decision.kind === 'refresh') {
      response
        .writeHead(307, { location: decision.location, 'set-cookie': refreshAttemptHeader(true) })
        .end();
      return;
    }
    if (decision.clearAttempt === true)
      response.setHeader('set-cookie', refreshAttemptHeader(false));
    const { signedIn, tenant } = this.resolved(request);
    html(
      response,
      `<body data-state="${signedIn ? 'signed-in' : 'signed-out'}" data-tenant="${tenant}"></body>`,
    );
  }

  /** The tenant picker: what `app/session/tenant/page.tsx` renders. */
  private tenantPage(request: IncomingMessage, url: URL, response: ServerResponse): void {
    const returnTo = safeReturnTo(url.searchParams.get('returnTo') ?? undefined);
    const { signedIn } = this.resolved(request);
    const forms = [TENANT_A, TENANT_B]
      .map(
        (tenantId) =>
          `<form method="post" action="${TENANT_PAGE}"><input type="hidden" name="tenantId" value="${tenantId}"><input type="hidden" name="returnTo" value="${returnTo}"><button type="submit" data-tenant="${tenantId}">choose</button></form>`,
      )
      .join('');
    html(response, `<body data-state="${signedIn ? 'picker' : 'signed-out'}">${forms}</body>`);
  }

  /** The `selectTenant` server action: checked against the principal's tenants, then remembered. */
  private async chooseTenant(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const form = await readForm(request);
    const { signedIn } = this.resolved(request);
    const tenant = signedIn
      ? chosenTenant(form.get('tenantId') ?? undefined, [TENANT_A, TENANT_B])
      : undefined;
    const location =
      tenant === undefined ? TENANT_PAGE : safeReturnTo(form.get('returnTo') ?? undefined);
    response.writeHead(303, { location, 'set-cookie': tenantSelectionHeader(tenant) }).end();
  }
}

/** Starts the origin on `localhost`, which a browser treats as secure, so `Secure` cookies work. */
export const startWorkOrigin = async (): Promise<WorkOrigin> => {
  const server = createServer();
  const origin = new Origin(server);
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void origin.handle(request, response).catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  origin.origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  return origin;
};
