/**
 * The built-app checks against stand-in servers: one that behaves as the fixed portal does, and
 * the defects they exist to catch. Run with: node --test tooling/smoke/
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';

import {
  ATTEMPT_COOKIE,
  refreshRedirectFindings,
  runChecks,
  sameOrigin,
} from './admin-built-app.mjs';

const MARKER = `${ATTEMPT_COOKIE}=1; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=lax`;

/** A portal as the real middleware answers, with `defect` changing one behaviour. */
const portal = (defect = '') =>
  createServer((request, response) => {
    // The raw request target: `new URL()` would read `//evil.example/people` as a host.
    const raw = request.url ?? '/';
    const signedOutPage =
      request.method === 'GET' &&
      !raw.startsWith('/session/') &&
      !(request.headers.cookie ?? '').includes(`${ATTEMPT_COOKIE}=`);
    if (defect === 'powered-by') response.setHeader('x-powered-by', 'Next.js');
    if (signedOutPage) {
      if (defect === 'relative-location-500') {
        response.writeHead(500).end('Internal Server Error');
        return;
      }
      const returnTo = raw.startsWith('//') ? '/' : raw;
      // As the fixed middleware answers under `next start`: absolute, on the Host the browser
      // used, with the scheme the load balancer forwarded; Next writes loopback as `localhost`.
      const port = request.socket.localPort;
      const host =
        defect === 'localhost-location'
          ? `localhost:${port}`
          : (request.headers.host ?? '').replace(/^127\.0\.0\.1(?=:|$)/, 'localhost');
      const scheme = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const location =
        defect === 'open-redirect' && raw.startsWith('//')
          ? `http:${raw}`
          : `${scheme}://${host}/session/refresh?returnTo=${encodeURIComponent(returnTo)}`;
      response.writeHead(307, {
        location,
        'cache-control': defect === 'cacheable' ? 'public' : 'no-store',
        'set-cookie': defect === 'weak-cookie' ? `${ATTEMPT_COOKIE}=1; Path=/` : MARKER,
      });
      response.end();
      return;
    }
    if (request.method === 'POST' && defect === 'post-redirected') {
      response.writeHead(307, { location: '/session/refresh?returnTo=%2Fpeople' }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html>');
  });

const servers = [];
const start = async (defect) => {
  const server = portal(defect);
  servers.push(server);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${server.address().port}`;
};
after(() => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))));

const failing = (lines) =>
  lines.filter((line) => line.startsWith('FAIL')).map((line) => line.split(/[ :]/)[1]);

describe('admin built-app checks', () => {
  it('pass against a portal that behaves as the fixed middleware does', async () => {
    const { passed, lines } = await runChecks(await start());
    assert.deepEqual(failing(lines), []);
    assert.equal(passed, true);
    assert.equal(lines.length, 9);
  });

  it('fail on the MW-007 High: a signed-out visit answering 500', async () => {
    const { passed, lines } = await runChecks(await start('relative-location-500'));
    assert.equal(passed, false);
    assert.deepEqual(failing(lines), [
      'signed-out-root',
      'signed-out-deep',
      'behind-load-balancer',
      'no-open-redirect',
    ]);
  });

  it('fail only behind-load-balancer when Location is on the localhost Next runs on', async () => {
    const { lines } = await runChecks(await start('localhost-location'));
    assert.deepEqual(failing(lines), ['behind-load-balancer']);
  });

  for (const [defect, check] of [
    ['open-redirect', 'no-open-redirect'],
    ['cacheable', 'signed-out-root'],
    ['weak-cookie', 'signed-out-root'],
    ['post-redirected', 'post-passes'],
    ['powered-by', 'no-powered-by'],
  ]) {
    it(`fail ${check} on ${defect}`, async () => {
      const { passed, lines } = await runChecks(await start(defect));
      assert.equal(passed, false);
      assert.ok(failing(lines).includes(check), lines.join('\n'));
    });
  }

  it('report an unreachable app as a failure, not a pass', async () => {
    const { passed, lines } = await runChecks('http://127.0.0.1:9');
    assert.equal(passed, false);
    assert.ok(lines.every((line) => line.startsWith('FAIL')));
  });
});

describe('refreshRedirectFindings', () => {
  const base = 'http://127.0.0.1:3001';
  const ok = {
    status: 307,
    headers: {
      location: '/session/refresh?returnTo=%2Fpeople',
      'cache-control': 'private, no-store',
      'set-cookie': [MARKER],
    },
  };

  it('accepts a relative or an absolute same-origin Location', () => {
    assert.deepEqual(refreshRedirectFindings(base, ok, '/people'), []);
    const absolute = {
      ...ok,
      headers: { ...ok.headers, location: `${base}${ok.headers.location}` },
    };
    assert.deepEqual(refreshRedirectFindings(base, absolute, '/people'), []);
  });

  it('counts the loopback names as one origin, and nothing else', () => {
    assert.ok(sameOrigin('http://localhost:3001/a', 'http://127.0.0.1:3001'));
    assert.ok(!sameOrigin('http://localhost:3002/a', 'http://127.0.0.1:3001'));
    assert.ok(!sameOrigin('https://localhost:3001/a', 'http://127.0.0.1:3001'));
    assert.ok(!sameOrigin('http://evil.example:3001/a', 'http://127.0.0.1:3001'));
  });

  it('refuses a protocol-relative returnTo', () => {
    const response = {
      ...ok,
      headers: { ...ok.headers, location: '/session/refresh?returnTo=%2F%2Fevil.example' },
    };
    assert.match(refreshRedirectFindings(base, response, undefined).join(), /not a same-origin/);
  });
});
