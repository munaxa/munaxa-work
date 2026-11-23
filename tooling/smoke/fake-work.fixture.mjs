/**
 * A fake Work host for the smoke tests: Identity's /api/auth, the Work API and the admin on one
 * node:http server, as the Testing ALB serves them on work.<env>. Each `faults` flag breaks one
 * behaviour so a test can prove the matching probe fails.
 */

import { createServer } from 'node:http';

/** JWT-shaped on purpose: the redaction tests must catch them by shape as well as by value. */
export const READER_TOKEN =
  'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJyZWFkZXItcGVyc29uYSJ9.c2lnbmF0dXJlLXJlYWRlcg';
export const LIMITED_TOKEN =
  'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJsaW1pdGVkLXBlcnNvbmEifQ.c2lnbmF0dXJlLWxpbWl0ZWQ';
export const READER_REFRESH = 'refresh-secret-reader-0123456789';
export const LIMITED_REFRESH = 'refresh-secret-limited-0123456789';
export const READER_PASSWORD = 'Reader-Password-Synthetic-1!';
export const LIMITED_PASSWORD = 'Limited-Password-Synthetic-2!';
export const TENANT = 'tenant-a';
export const OTHER_TENANT = 'tenant-b';

const USERS = {
  'reader@example.test': {
    password: READER_PASSWORD,
    token: READER_TOKEN,
    refresh: READER_REFRESH,
  },
  'limited@example.test': {
    password: LIMITED_PASSWORD,
    token: LIMITED_TOKEN,
    refresh: LIMITED_REFRESH,
  },
};

const readBody = async (request) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text;
};

const cookiesOf = (request) =>
  Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((pair) => pair.trim().split('='))
      .filter(([name]) => name)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join('='))]),
  );

export const startFakeWork = async (faults = {}) => {
  const revokedAt = new Map();
  const requests = [];
  const origin = () => `http://127.0.0.1:${server.address().port}`;

  const isRevoked = (token) => {
    const at = revokedAt.get(token);
    return at !== undefined && Date.now() - at >= (faults.revocationDelayMs ?? 0);
  };

  const handle = async (request, response) => {
    const url = new URL(request.url, 'http://fake');
    const body = await readBody(request);
    requests.push({ method: request.method, path: url.pathname, headers: request.headers });
    const json = (status, value, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(JSON.stringify(value));
    };
    const html = (status, text) => {
      response.writeHead(status, { 'content-type': 'text/html' });
      response.end(`<html><body>${text}</body></html>`);
    };

    if (url.pathname === '/health/ready') {
      return faults.notReady ? json(503, { status: 'down' }) : json(200, { status: 'ok' });
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (request.headers.origin !== origin()) return json(403, { code: 'AUTH_UNTRUSTED_ORIGIN' });
      const { identifier, password } = JSON.parse(body);
      const user = USERS[identifier];
      if (user === undefined || user.password !== password || faults.loginFails) {
        // A hostile answer: the body echoes a token, which the script must not print.
        return json(401, {
          code: faults.loginEchoesToken ? READER_TOKEN : 'AUTH_INVALID_CREDENTIALS',
        });
      }
      return json(
        200,
        { ok: true },
        {
          'set-cookie': [
            `__Host-mx_session=${encodeURIComponent(user.token)}; Path=/; HttpOnly; Secure`,
            `__Secure-mx_refresh=${encodeURIComponent(user.refresh)}; Path=/api/auth/refresh; HttpOnly`,
          ],
        },
      );
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = cookiesOf(request)['__Host-mx_session'];
      if (token && !faults.logoutDoesNotRevoke) revokedAt.set(token, Date.now());
      return json(200, { ok: true });
    }
    if (url.pathname.startsWith('/api/v1/')) {
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
      const known = token === READER_TOKEN || token === LIMITED_TOKEN;
      if (faults.unauthenticatedAllowed && token === undefined) return json(200, { items: [] });
      if (!known || isRevoked(token)) return json(401, { message: 'Not authenticated.' });
      const tenant = request.headers['x-munaxa-tenant'];
      if (tenant !== undefined && tenant !== TENANT && faults.crossTenantNotFound) {
        return json(404, { message: 'Not found.' });
      }
      if (tenant !== undefined && tenant !== TENANT && faults.crossTenantForbidden) {
        return json(403, { message: 'Forbidden' });
      }
      if (tenant !== undefined && tenant !== TENANT && faults.crossTenantOtherUnauthorized) {
        return json(401, { message: 'Not authenticated.' });
      }
      if (tenant !== undefined && tenant !== TENANT && !faults.crossTenantLeaks) {
        return json(401, { message: 'No tenant resolved for this principal.' });
      }
      if (faults.licenceRefuses) return json(402, { reason: 'NO_SUBSCRIPTION', status: 'NONE' });
      if (url.pathname === '/api/v1/payroll/groups' && token === LIMITED_TOKEN) {
        return faults.forbiddenAllowed
          ? json(200, { items: [] })
          : json(403, { message: 'Forbidden' });
      }
      if (faults.readFails) return json(500, { message: 'boom' });
      return json(200, { items: [], echo: token });
    }
    const signedIn =
      cookiesOf(request)['__Host-mx_session'] === READER_TOKEN && !faults.adminSignedOut;
    if (url.pathname === '/') {
      return html(200, signedIn ? 'Enterprise HR administration' : 'You are not signed in');
    }
    if (url.pathname === '/organization') {
      return html(200, signedIn ? 'Units' : 'You are not signed in');
    }
    return html(404, 'Not found');
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: origin(),
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

/** The environment a Testing operator would export, pointed at the fake host. */
export const smokeEnvironment = (url, overrides = {}) => ({
  WORK_BASE_URL: url,
  SMOKE_TENANT_ID: TENANT,
  SMOKE_OTHER_TENANT_ID: OTHER_TENANT,
  SMOKE_READER_IDENTIFIER: 'reader@example.test',
  SMOKE_READER_PASSWORD: READER_PASSWORD,
  SMOKE_LIMITED_IDENTIFIER: 'limited@example.test',
  SMOKE_LIMITED_PASSWORD: LIMITED_PASSWORD,
  SMOKE_REVOCATION_WAIT_SECONDS: '2',
  SMOKE_POLL_INTERVAL_MS: '50',
  SMOKE_TIMEOUT_MS: '5000',
  ...overrides,
});
