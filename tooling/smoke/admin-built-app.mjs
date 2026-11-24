#!/usr/bin/env node
/**
 * Built-app check of the Work Admin portal (Wave 2 R-2). Node built-ins only.
 *
 * The browser test (apps/admin/src/shell/session-continuity.browser.test.ts) runs the real
 * middleware, but inside a stand-in server, not inside Next. The one High defect MW-007 had lived
 * exactly in that gap: a relative `Location` that Next's middleware adapter refused, so every
 * signed-out visit to the built app answered 500. This starts the production build with
 * `next start` and asks it, over plain HTTP, the questions that defect would have failed:
 *
 *   signed-out-root      GET / without a session: 307 to /session/refresh?returnTo=/, on this
 *                        origin, `no-store`, and the refresh-attempt marker set HttpOnly, Secure,
 *                        SameSite=Lax, Path=/
 *   signed-out-deep      GET /people?tab=a: returnTo keeps the path and query
 *   behind-load-balancer GET /people with `Host: work.test.munaxa.com` and
 *                        `X-Forwarded-Proto: https`, as the load balancer sends it: Location is on
 *                        https://work.test.munaxa.com, not on the localhost Next runs on
 *   no-open-redirect     GET //evil.example/people: any redirect stays on this origin, and one to
 *                        the refresh page carries a same-origin returnTo
 *   attempted-renders    GET / with the marker already set: 200 (the signed-out state), no loop
 *   post-passes          POST /people is not sent to the refresh page
 *   refresh-page         GET /session/refresh?returnTo=/people: 200 HTML
 *   tenant-page          GET /session/tenant: not a server error
 *   no-powered-by        no `x-powered-by` header
 *
 * Usage:
 *   node tooling/smoke/admin-built-app.mjs --start apps/admin   (after `pnpm build`)
 *   node tooling/smoke/admin-built-app.mjs --url http://127.0.0.1:3001
 * Exit code: 0 every check passed, 1 a check failed, 2 the app could not be started or reached.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REFRESH_PAGE = '/session/refresh';
export const ATTEMPT_COOKIE = 'munaxa_work_refresh_attempt';

/** One HTTP exchange without following redirects. Resolves { status, headers, body }. */
export const exchange = (base, path, { method = 'GET', headers = {} } = {}) =>
  new Promise((done, fail) => {
    const url = new URL(base);
    const req = httpRequest(
      { host: url.hostname, port: url.port, path, method, headers, timeout: 30_000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (body.length < 200_000) body += chunk;
        });
        res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout on ${method} ${path}`)));
    req.on('error', fail);
    req.end();
  });

const setCookies = (headers) => {
  const value = headers['set-cookie'];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
};

/** The host the load balancer forwards in Testing; any public name would do. */
export const PUBLIC_ORIGIN = 'https://work.test.munaxa.com';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether two URLs share an origin, counting the loopback names as one: Next writes
 * `localhost` for a request it received on 127.0.0.1, which is the same server.
 */
export const sameOrigin = (a, b) => {
  const [left, right] = [new URL(a), new URL(b)];
  const name = (url) => (LOOPBACK.has(url.hostname) ? 'localhost' : url.hostname);
  return left.protocol === right.protocol && name(left) === name(right) && left.port === right.port;
};

/**
 * The refresh redirect's findings, or [] when `response` is the redirect `returnTo` expects, on
 * `origin` (the server's own unless the request named a public host).
 */
export const refreshRedirectFindings = (base, response, returnTo, origin = base) => {
  const findings = [];
  if (response.status !== 307) return [`status ${response.status}, expected 307`];
  const location = response.headers.location;
  if (typeof location !== 'string') return ['307 without a Location'];
  let target;
  try {
    target = new URL(location, base);
  } catch {
    return [`Location ${JSON.stringify(location)} is not a URL`];
  }
  if (!sameOrigin(target, origin)) {
    findings.push(`Location ${location} is not on ${new URL(origin).origin}`);
  }
  if (target.pathname !== REFRESH_PAGE) findings.push(`Location path ${target.pathname}`);
  const actual = target.searchParams.get('returnTo');
  if (returnTo !== undefined && actual !== returnTo) {
    findings.push(`returnTo ${JSON.stringify(actual)}, expected ${JSON.stringify(returnTo)}`);
  }
  if (
    actual === null ||
    !actual.startsWith('/') ||
    actual.startsWith('//') ||
    actual.includes('\\')
  ) {
    findings.push(`returnTo ${JSON.stringify(actual)} is not a same-origin path`);
  }
  if (!String(response.headers['cache-control'] ?? '').includes('no-store')) {
    findings.push('redirect is cacheable (no `no-store`)');
  }
  const marker = setCookies(response.headers).find((cookie) =>
    cookie.startsWith(`${ATTEMPT_COOKIE}=`),
  );
  if (marker === undefined) {
    findings.push(`no ${ATTEMPT_COOKIE} cookie set`);
  } else {
    const attributes = marker.toLowerCase();
    for (const required of ['httponly', 'secure', 'samesite=lax', 'path=/']) {
      if (!attributes.split(';').some((part) => part.trim() === required)) {
        findings.push(`${ATTEMPT_COOKIE} lacks ${required}`);
      }
    }
  }
  return findings;
};

const redirectsToRefresh = (base, response) =>
  response.status >= 300 &&
  response.status < 400 &&
  typeof response.headers.location === 'string' &&
  new URL(response.headers.location, base).pathname === REFRESH_PAGE;

/** The checks, in order. Each resolves to a list of findings; empty is a pass. */
export const CHECKS = [
  [
    'signed-out-root',
    async (base) => refreshRedirectFindings(base, await exchange(base, '/'), '/'),
  ],
  [
    'signed-out-deep',
    async (base) =>
      refreshRedirectFindings(base, await exchange(base, '/people?tab=a'), '/people?tab=a'),
  ],
  [
    'behind-load-balancer',
    async (base) => {
      const response = await exchange(base, '/people', {
        headers: { host: new URL(PUBLIC_ORIGIN).host, 'x-forwarded-proto': 'https' },
      });
      return refreshRedirectFindings(base, response, '/people', PUBLIC_ORIGIN);
    },
  ],
  [
    'no-open-redirect',
    async (base) => {
      const response = await exchange(base, '//evil.example/people');
      // Not redirecting at all is safe too, as long as it is not a server error.
      if (response.status < 300 || response.status >= 400) {
        return response.status >= 500 ? [`status ${response.status}`] : [];
      }
      // Next may normalise the path itself (a 308 to `/evil.example/people`): a redirect must stay
      // on this origin, and one to the refresh page must carry a same-origin returnTo.
      const location = response.headers.location;
      if (typeof location !== 'string') return [`${response.status} without a Location`];
      const target = new URL(location, base);
      if (!sameOrigin(target, base)) return [`Location leaves the origin: ${location}`];
      return target.pathname === REFRESH_PAGE
        ? refreshRedirectFindings(base, response, undefined)
        : [];
    },
  ],
  [
    'attempted-renders',
    async (base) => {
      const response = await exchange(base, '/', { headers: { cookie: `${ATTEMPT_COOKIE}=1` } });
      return response.status === 200 ? [] : [`status ${response.status}, expected 200 (no loop)`];
    },
  ],
  [
    'post-passes',
    async (base) => {
      const response = await exchange(base, '/people', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '0' },
      });
      return redirectsToRefresh(base, response) ? ['POST was sent to the refresh page'] : [];
    },
  ],
  [
    'refresh-page',
    async (base) => {
      const response = await exchange(base, `${REFRESH_PAGE}?returnTo=%2Fpeople`);
      const findings = [];
      if (response.status !== 200) findings.push(`status ${response.status}, expected 200`);
      if (!String(response.headers['content-type'] ?? '').startsWith('text/html')) {
        findings.push(`content-type ${response.headers['content-type']}`);
      }
      return findings;
    },
  ],
  [
    'tenant-page',
    async (base) => {
      const response = await exchange(base, '/session/tenant');
      return response.status >= 500 ? [`status ${response.status}`] : [];
    },
  ],
  [
    'no-powered-by',
    async (base) =>
      (await exchange(base, `${REFRESH_PAGE}`)).headers['x-powered-by'] === undefined
        ? []
        : ['x-powered-by header present'],
  ],
];

/** Runs every check against `base`. Resolves { passed, lines }. */
export const runChecks = async (base, checks = CHECKS) => {
  const lines = [];
  let passed = true;
  for (const [name, check] of checks) {
    let findings;
    try {
      findings = await check(base);
    } catch (error) {
      findings = [`error: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (findings.length > 0) passed = false;
    const detail = findings.length === 0 ? '' : `: ${findings.join('; ')}`;
    lines.push(`${findings.length === 0 ? 'PASS' : 'FAIL'} ${name}${detail}`);
  }
  return { passed, lines };
};

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const waitUntilUp = async (base, child, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with ${child.exitCode}`);
    try {
      await exchange(base, REFRESH_PAGE);
      return;
    } catch {
      await new Promise((wait) => setTimeout(wait, 500));
    }
  }
  throw new Error(`no answer from ${base} within ${timeoutMs / 1_000}s`);
};

/** Starts `next start` for the built app in `appDir`. Resolves { base, stop }. */
export const startBuiltApp = async (appDir, { timeoutMs = 60_000 } = {}) => {
  const directory = resolve(appDir);
  const next = join(directory, 'node_modules', '.bin', 'next');
  if (!existsSync(join(directory, '.next', 'BUILD_ID'))) {
    throw new Error(`${directory} has no production build (.next/BUILD_ID); run the build first`);
  }
  if (!existsSync(next)) throw new Error(`${next} not found; install dependencies first`);
  const port = await freePort();
  const child = spawn(next, ['start', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: directory,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise((done) => {
      if (child.exitCode !== null) return done();
      child.once('exit', () => done());
      child.kill('SIGTERM');
    });
  try {
    await waitUntilUp(base, child, timeoutMs);
  } catch (error) {
    await stop();
    throw error;
  }
  return { base, stop };
};

const main = async (argv) => {
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const url = flag('--url');
  const appDir = flag('--start');
  if ((url === undefined) === (appDir === undefined)) {
    console.error('usage: admin-built-app.mjs --start <appDir> | --url <base>');
    return 2;
  }
  let app;
  try {
    app = url === undefined ? await startBuiltApp(appDir) : { base: url, stop: async () => {} };
  } catch (error) {
    console.error(`admin built app: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  try {
    const { passed, lines } = await runChecks(app.base);
    for (const line of lines) console.log(line);
    console.log(passed ? 'admin built app: all checks passed' : 'admin built app: FAILED');
    return passed ? 0 : 1;
  } finally {
    await app.stop();
  }
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
