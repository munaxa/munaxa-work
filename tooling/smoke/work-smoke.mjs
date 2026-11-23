#!/usr/bin/env node
/**
 * Munaxa Work smoke test (MW-006). Node built-ins only; see tooling/smoke/README.md.
 *
 * Probes, in order, each reported PASS or FAIL with its HTTP status and nothing else:
 *   health-ready          GET /health/ready answers 200 {"status":"ok"}
 *   unauthenticated       a Work API read with no credential answers 401
 *   persona-read          the reader persona's read answers 200
 *   forbidden             the limited persona's request for a grant it lacks answers 403
 *   entitlements          the reader's licensed read is not refused by licensing (402)
 *   admin-signed-in       the admin renders the signed-in page for the reader's session
 *   cross-tenant          the reader naming a tenant it is not a member of is refused
 *   logout-revocation     after Identity logout the reader's token answers 401 within the
 *                         revocation cache window
 *
 * Exit code: 0 when every probe passed, 1 when any failed, 2 when the inputs are incomplete.
 * Nothing secret is printed: every line goes through tooling/smoke/redact.mjs.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createRedactor } from './redact.mjs';

export const SESSION_COOKIE = '__Host-mx_session';
export const REFRESH_COOKIE = '__Secure-mx_refresh';
export const TENANT_HEADER = 'x-munaxa-tenant';
const SIGNED_OUT_TEXT = ['You are not signed in', 'No workspace for this account'];

export class ConfigurationError extends Error {}

const trimSlash = (value) => value.replace(/\/+$/, '');
const number = (value, fallback) => {
  const parsed = Number(value);
  return value === undefined || value === '' || !Number.isFinite(parsed) ? fallback : parsed;
};

const persona = (env, prefix, missing) => {
  const tokenFile = env[`${prefix}_TOKEN_FILE`];
  const identifier = env[`${prefix}_IDENTIFIER`];
  const password = env[`${prefix}_PASSWORD`];
  if (tokenFile) return { tokenFile };
  if (identifier && password) return { identifier, password };
  missing.push(`${prefix}_IDENTIFIER and ${prefix}_PASSWORD, or ${prefix}_TOKEN_FILE`);
  return undefined;
};

/** Reads the inputs from the environment. Throws ConfigurationError naming what is missing. */
export const loadConfig = (env) => {
  const missing = [];
  if (!env.WORK_BASE_URL) missing.push('WORK_BASE_URL');
  if (!env.SMOKE_OTHER_TENANT_ID) missing.push('SMOKE_OTHER_TENANT_ID');
  const reader = persona(env, 'SMOKE_READER', missing);
  const limited = persona(env, 'SMOKE_LIMITED', missing);
  if (missing.length > 0) throw new ConfigurationError(`Missing inputs: ${missing.join('; ')}.`);

  const work = trimSlash(env.WORK_BASE_URL);
  const api = trimSlash(env.WORK_API_BASE_URL || work);
  const identity = trimSlash(env.IDENTITY_BASE_URL || work);
  return {
    api,
    admin: trimSlash(env.ADMIN_BASE_URL || work),
    identity,
    identityOrigin: env.IDENTITY_ORIGIN || new URL(identity).origin,
    organisation: env.IDENTITY_ORGANISATION || undefined,
    healthUrl: env.WORK_HEALTH_URL || `${api}/health/ready`,
    tenantId: env.SMOKE_TENANT_ID || undefined,
    otherTenantId: env.SMOKE_OTHER_TENANT_ID,
    readPath: env.SMOKE_READ_PATH || '/api/v1/organization/unit-types',
    forbiddenMethod: (env.SMOKE_FORBIDDEN_METHOD || 'GET').toUpperCase(),
    forbiddenPath: env.SMOKE_FORBIDDEN_PATH || '/api/v1/payroll/groups',
    adminPath: env.SMOKE_ADMIN_PATH || '/?lang=en',
    adminDataPath: env.SMOKE_ADMIN_DATA_PATH || '/organization?lang=en',
    adminSignedInText: env.SMOKE_ADMIN_SIGNED_IN_TEXT || 'Enterprise HR administration',
    revocationWaitMs: number(env.SMOKE_REVOCATION_WAIT_SECONDS, 10) * 1000,
    pollIntervalMs: number(env.SMOKE_POLL_INTERVAL_MS, 1000),
    timeoutMs: number(env.SMOKE_TIMEOUT_MS, 10_000),
    reader,
    limited,
  };
};

/** The secrets in a configuration: what the redactor must know before the first line. */
export const secretsOf = (config) =>
  [config.reader, config.limited].filter(Boolean).flatMap((entry) => [entry.password]);

const cookieValue = (setCookies, name) => {
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === name) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
};

const createClient = (config, fetchImpl) => {
  const send = async (method, url, { token, tenant, cookies, json, origin } = {}) => {
    const headers = { accept: 'application/json, text/html;q=0.9' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (tenant) headers[TENANT_HEADER] = tenant;
    if (origin) headers.origin = origin;
    if (cookies) {
      headers.cookie = Object.entries(cookies)
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join('; ');
    }
    if (json !== undefined) headers['content-type'] = 'application/json';
    const response = await fetchImpl(url, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    const setCookies =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    return { status: response.status, text, setCookies };
  };
  return { send };
};

/** A session for one persona: from Identity sign-in, or from a token file. */
const openSession = async (config, client, entry, redactor, readFile) => {
  if (entry.tokenFile) {
    const token = readFile(entry.tokenFile).trim();
    if (token === '') throw new Error('the token file is empty');
    redactor.add(token);
    return { token, refresh: undefined };
  }
  const body = { identifier: entry.identifier, password: entry.password };
  if (config.organisation) body.organisation = config.organisation;
  const response = await client.send('POST', `${config.identity}/api/auth/login`, {
    json: body,
    origin: config.identityOrigin,
  });
  const token = cookieValue(response.setCookies, SESSION_COOKIE);
  const refresh = cookieValue(response.setCookies, REFRESH_COOKIE);
  redactor.add(token);
  redactor.add(refresh);
  if (response.status !== 200 || token === undefined) {
    let code = '';
    try {
      code = JSON.parse(response.text).code ?? '';
    } catch {
      code = '';
    }
    throw new Error(`Identity sign-in answered ${response.status}${code ? ` ${code}` : ''}`);
  }
  return { token, refresh };
};

const expectStatus = (response, expected) =>
  expected.includes(response.status)
    ? { ok: true, detail: `${response.status}` }
    : { ok: false, detail: `expected ${expected.join(' or ')}, got ${response.status}` };

const isReady = (response) => {
  if (response.status !== 200) return { ok: false, detail: `expected 200, got ${response.status}` };
  try {
    if (JSON.parse(response.text).status === 'ok') return { ok: true, detail: '200' };
  } catch {
    // An HTML 200 is the admin answering a path the API never saw; reported below.
  }
  return { ok: false, detail: '200 but not the API readiness body {"status":"ok"}' };
};

/**
 * Runs every probe. Never throws for a failed probe; returns { passed, failed, skipped, results }.
 * `io` is injectable for tests: fetch, write (one redacted line), sleep, readFile, now.
 */
export const runSmoke = async (config, io) => {
  const redactor = io.redactor ?? createRedactor(secretsOf(config));
  const write = (line) => io.write(redactor.redact(line));
  const client = createClient(config, io.fetch);
  const sessions = {};
  const results = [];

  const probe = async (name, run) => {
    const started = io.now();
    let outcome;
    try {
      outcome = await run();
    } catch (error) {
      outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const label = outcome.skipped ? 'SKIP' : outcome.ok ? 'PASS' : 'FAIL';
    results.push({ name, ...outcome });
    write(`${label} ${name}: ${outcome.detail} (${Math.round(io.now() - started)} ms)`);
  };

  const session = async (key) => {
    if (sessions[key] === undefined) {
      sessions[key] = openSession(config, client, config[key], redactor, io.readFile).catch(
        (error) => ({ error }),
      );
    }
    const opened = await sessions[key];
    if (opened.error) throw new Error(`no ${key} session: ${opened.error.message}`);
    return opened;
  };
  const read = (token, tenant = config.tenantId) =>
    client.send('GET', `${config.api}${config.readPath}`, { token, tenant });

  await probe('health-ready', async () =>
    config.healthUrl === 'skip'
      ? { ok: true, skipped: true, detail: 'WORK_HEALTH_URL=skip' }
      : isReady(await client.send('GET', config.healthUrl)),
  );
  await probe('unauthenticated', async () => expectStatus(await read(undefined), [401]));
  await probe('persona-read', async () =>
    expectStatus(await read((await session('reader')).token), [200]),
  );
  await probe('forbidden', async () => {
    const { token } = await session('limited');
    const response = await client.send(
      config.forbiddenMethod,
      `${config.api}${config.forbiddenPath}`,
      { token, tenant: config.tenantId, json: config.forbiddenMethod === 'GET' ? undefined : {} },
    );
    return expectStatus(response, [403]);
  });
  await probe('entitlements', async () => {
    const response = await read((await session('reader')).token);
    if (response.status === 402) {
      let reason = 'unknown';
      try {
        reason = JSON.parse(response.text).reason ?? reason;
      } catch {
        reason = 'unknown';
      }
      return { ok: false, detail: `402 licence refused the read (reason ${reason})` };
    }
    return expectStatus(response, [200]);
  });
  await probe('admin-signed-in', async () => {
    const { token } = await session('reader');
    const cookies = { [SESSION_COOKIE]: token };
    const home = await client.send('GET', `${config.admin}${config.adminPath}`, { cookies });
    if (home.status !== 200) return { ok: false, detail: `home expected 200, got ${home.status}` };
    if (!home.text.includes(config.adminSignedInText)) {
      return { ok: false, detail: 'home rendered without the signed-in content' };
    }
    const data = await client.send('GET', `${config.admin}${config.adminDataPath}`, { cookies });
    if (data.status !== 200)
      return { ok: false, detail: `data page expected 200, got ${data.status}` };
    const signedOut = SIGNED_OUT_TEXT.find((text) => data.text.includes(text));
    return signedOut
      ? { ok: false, detail: `data page rendered "${signedOut}"` }
      : { ok: true, detail: '200 signed in' };
  });
  await probe('cross-tenant', async () => {
    const response = await read((await session('reader')).token, config.otherTenantId);
    return response.status >= 200 && response.status < 300
      ? { ok: false, detail: `another tenant's read answered ${response.status}` }
      : expectStatus(response, [401, 403, 404]);
  });
  await probe('logout-revocation', async () => {
    const { token, refresh } = await session('reader');
    const before = await read(token);
    if (before.status !== 200)
      return { ok: false, detail: `before logout expected 200, got ${before.status}` };
    const logout = await client.send('POST', `${config.identity}/api/auth/logout`, {
      cookies: { [SESSION_COOKIE]: token, [REFRESH_COOKIE]: refresh },
      origin: config.identityOrigin,
      json: {},
    });
    if (logout.status !== 200) return { ok: false, detail: `logout answered ${logout.status}` };
    const loggedOutAt = io.now();
    for (;;) {
      const after = await read(token);
      const waited = io.now() - loggedOutAt;
      if (after.status === 401) return { ok: true, detail: `401 after ${Math.round(waited)} ms` };
      if (waited >= config.revocationWaitMs) {
        return {
          ok: false,
          detail: `still ${after.status} ${Math.round(waited)} ms after logout (window ${config.revocationWaitMs} ms)`,
        };
      }
      await io.sleep(config.pollIntervalMs);
    }
  });

  const failed = results.filter((result) => !result.ok).length;
  const skipped = results.filter((result) => result.skipped).length;
  const passed = results.length - failed - skipped;
  write(
    `${failed === 0 ? 'OK' : 'FAILED'}: ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );
  return { passed, failed, skipped, results };
};

export const main = async (env = process.env) => {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    process.stderr.write(`work-smoke: ${error.message} See tooling/smoke/README.md.\n`);
    return 2;
  }
  const redactor = createRedactor(secretsOf(config));
  const fail = (error) => {
    process.stderr.write(`work-smoke: ${redactor.redact(String(error))}\n`);
    return 1;
  };
  const summary = await runSmoke(config, {
    fetch: globalThis.fetch,
    redactor,
    write: (line) => process.stdout.write(`${line}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readFile: (path) => readFileSync(path, 'utf8'),
    now: () => performance.now(),
  }).catch(fail);
  return typeof summary === 'number' ? summary : summary.failed === 0 ? 0 : 1;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      // Only a defect in the script reaches here; the pattern rules still apply to its message.
      process.stderr.write(`work-smoke: ${createRedactor().redact(String(error))}\n`);
      process.exitCode = 1;
    },
  );
}
