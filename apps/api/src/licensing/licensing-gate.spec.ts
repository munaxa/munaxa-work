import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArgumentsHost } from '@nestjs/common';
import { AsymmetricSigner } from '@munaxa/crypto';
import {
  armorLicense,
  issueLicense,
  type EntitlementSnapshot,
  type LicensePayload,
} from '@munaxa/licensing';
import { loadEnvironment } from '@work/config';
import { NotEntitledException, runInContext, uuidV7 } from '@work/kernel';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProblemDetailsFilter } from '../errors/problem-details.filter.js';
import { CORE_MODULES, WorkFeature, featureFor } from './catalogue.js';
import { LicenceSource } from './licence.source.js';
import { MemoryLicensingStateStore } from './licensing-state.store.js';
import { LicensingGate } from './licensing.gate.js';
import { NO_USAGE_REPORTS } from './usage.reporter.js';

const TENANT = uuidV7();
const directory = mkdtempSync(join(tmpdir(), 'work-gate-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pair = {
  kid: 'lic-1',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const issuer = new AsymmetricSigner('ES256', [pair]);
const path = join(directory, 'work.license');

const terms = {
  schemaVersion: 1 as const,
  customerId: 'cus_1',
  tenantId: TENANT,
  product: 'work',
  subscriptionId: 'sub_1',
  plan: { code: 'business', version: 1 },
  status: 'ACTIVE' as const,
  trialEndsAt: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
  graceUntil: null,
  features: [WorkFeature.PAYROLL],
  limits: { employees: 2 },
};

function licence(overrides: Partial<LicensePayload> = {}): string {
  return armorLicense(
    issueLicense(
      {
        ...terms,
        deployment: 'ON_PREMISES',
        licenseId: 'lic_1',
        installationId: 'inst-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        notBefore: '2026-01-01T00:00:00.000Z',
        supersedes: null,
        ...overrides,
      },
      issuer,
    ),
  );
}

const fileEnvironment = loadEnvironment({
  DATABASE_URL: 'postgresql://work@localhost:5432/work',
  LICENSING_MODE: 'LICENSE_FILE',
  LICENSE_FILE_PATH: path,
  LICENSE_PUBLIC_KEYS: JSON.stringify([{ kid: pair.kid, publicKey: pair.publicKey }]),
  LICENSE_INSTALLATION_ID: 'inst-1',
});

const asTenant = <T>(work: () => Promise<T>): Promise<T> =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, work);

const gateFor = (file: string): LicensingGate => {
  writeFileSync(path, file);
  return new LicensingGate(
    new LicenceSource(fileEnvironment, new MemoryLicensingStateStore()),
    NO_USAGE_REPORTS,
  );
};

const command = (permission: string) => ({ kind: 'command' as const, name: 'x', permission });
const query = (permission: string) => ({ kind: 'query' as const, name: 'x', permission });

async function reasonOf(work: () => Promise<void>): Promise<string> {
  try {
    await asTenant(work);
  } catch (error) {
    if (error instanceof NotEntitledException) return error.reason;
    throw error;
  }
  return 'ADMITTED';
}

describe('the catalogue', () => {
  it('reads the module from the permission, and leaves core modules ungated', () => {
    expect(featureFor('payroll.calculate')).toBe('payroll');
    expect(featureFor('employment.manage')).toBeNull();
    for (const module of CORE_MODULES) expect(featureFor(`${module}.read`)).toBeNull();
  });

  it('refuses a module nobody has decided about rather than giving it away', () => {
    expect(featureFor('newmodule.read')).toBe('unlisted.newmodule');
  });
});

describe('LicensingGate', () => {
  it('admits the core modules and the modules the plan includes, and nothing else', async () => {
    const gate = gateFor(licence());
    expect(await reasonOf(() => gate.admit(command('employment.manage')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(command('payroll.calculate')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('recruitment.read')))).toBe(
      'FEATURE_NOT_INCLUDED',
    );
    expect(await reasonOf(() => gate.admit(query('newmodule.read')))).toBe('FEATURE_NOT_INCLUDED');
  });

  it('an ended term reads and changes nothing, in every module', async () => {
    const gate = gateFor(licence({ expiresAt: '2026-02-01T00:00:00.000Z' }));
    expect(await reasonOf(() => gate.admit(query('people.read')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('payroll.read')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
  });

  it('admits everything, and counts nothing, when the deployment is not licensed', async () => {
    const gate = new LicensingGate(
      new LicenceSource(
        loadEnvironment({ DATABASE_URL: 'postgresql://work@localhost/w' }),
        new MemoryLicensingStateStore(),
      ),
      NO_USAGE_REPORTS,
    );
    const countOpen = vi.fn(() => Promise.resolve(10_000));
    expect(await reasonOf(() => gate.admit(command('recruitment.manage')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admitHeadcount(1, countOpen))).toBe('ADMITTED');
    expect(countOpen).not.toHaveBeenCalled();
  });
});

describe('the licensed headcount', () => {
  it('admits up to the ceiling and refuses past it', async () => {
    const gate = gateFor(licence());
    expect(await reasonOf(() => gate.admitHeadcount(1, () => Promise.resolve(1)))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admitHeadcount(1, () => Promise.resolve(2)))).toBe(
      'QUOTA_EXCEEDED',
    );
  });

  it('counts nothing on an unlimited plan, and a plan that omits the limit licenses nobody', async () => {
    const countOpen = vi.fn(() => Promise.resolve(5));
    const unlimited = gateFor(licence({ limits: { employees: null } }));
    expect(await reasonOf(() => unlimited.admitHeadcount(1, countOpen))).toBe('ADMITTED');
    expect(countOpen).not.toHaveBeenCalled();
    const omitted = gateFor(licence({ limits: {} }));
    expect(await reasonOf(() => omitted.admitHeadcount(1, () => Promise.resolve(0)))).toBe(
      'QUOTA_EXCEEDED',
    );
  });

  it('a term that has ended adds nobody, whatever the count', async () => {
    const gate = gateFor(licence({ expiresAt: '2026-02-01T00:00:00.000Z' }));
    expect(await reasonOf(() => gate.admitHeadcount(1, () => Promise.resolve(0)))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
  });
});

describe('Munaxa Work against the central subscription service', () => {
  const HOUR = 3_600_000;
  const T0 = new Date('2026-10-26T12:00:00.000Z');
  const hosted = loadEnvironment({
    DATABASE_URL: 'postgresql://work@localhost:5432/work',
    LICENSING_MODE: 'CONTROL_PLANE',
    CONTROL_PLANE_URL: 'https://control.munaxa.test',
    CONTROL_PLANE_TOKEN: 'mxc_00000000-0000-4000-8000-000000000000_secret',
  });
  const snapshot = (overrides: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot => ({
    ...terms,
    deployment: 'SAAS',
    resolvedAt: T0.toISOString(),
    ...overrides,
  });

  const replies: ({ status: number; body?: unknown } | Error)[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? new Error('no scripted reply');
    if (reply instanceof Error) return Promise.reject(reply);
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
    return Promise.resolve({ status: reply.status, text: () => Promise.resolve(text) });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    replies.length = 0;
    calls.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const at = (hours: number, reply: { status: number; body?: unknown } | Error) => {
    vi.setSystemTime(T0.getTime() + hours * HOUR);
    replies.push(reply);
  };

  it('asks for this tenant only, with the credential, never following a redirect', async () => {
    const gate = new LicensingGate(
      new LicenceSource(hosted, new MemoryLicensingStateStore(), fetchImpl),
      NO_USAGE_REPORTS,
    );
    replies.push({ status: 200, body: snapshot() });
    expect(await reasonOf(() => gate.admit(command('payroll.calculate')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('recruitment.read')))).toBe(
      'FEATURE_NOT_INCLUDED',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://control.munaxa.test/api/v1/products/work/tenants/${TENANT}/entitlements`,
    );
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: 'Bearer mxc_00000000-0000-4000-8000-000000000000_secret',
    });
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('an outage degrades the last answer by age, and no subscription outlives no snapshot', async () => {
    const gate = new LicensingGate(
      new LicenceSource(hosted, new MemoryLicensingStateStore(), fetchImpl),
      NO_USAGE_REPORTS,
    );
    replies.push({ status: 200, body: snapshot() });
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe('ADMITTED');

    at(2, { status: 503 });
    // No growth: writes continue, hiring stops.
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admitHeadcount(1, () => Promise.resolve(0)))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
    at(48, new Error('connect ECONNREFUSED'));
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
    expect(await reasonOf(() => gate.admit(query('people.read')))).toBe('ADMITTED');

    at(49, { status: 404 });
    expect(await reasonOf(() => gate.admit(query('people.read')))).toBe('NO_SUBSCRIPTION');
    at(50, { status: 503 });
    expect(await reasonOf(() => gate.admit(query('people.read')))).toBe('NO_SUBSCRIPTION');
  });

  it('a refused credential is an outage, not a cancellation', async () => {
    const gate = new LicensingGate(
      new LicenceSource(hosted, new MemoryLicensingStateStore(), fetchImpl),
      NO_USAGE_REPORTS,
    );
    replies.push({ status: 200, body: snapshot() });
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe('ADMITTED');
    at(0.5, { status: 401 });
    expect(await reasonOf(() => gate.admit(command('people.manage')))).toBe('ADMITTED');
  });

  it('a restarted process bridges an outage with the answer an earlier one kept', async () => {
    const store = new MemoryLicensingStateStore();
    const first = new LicensingGate(new LicenceSource(hosted, store, fetchImpl), NO_USAGE_REPORTS);
    replies.push({ status: 200, body: snapshot() });
    expect(await reasonOf(() => first.admit(command('people.manage')))).toBe('ADMITTED');

    // A new process, started while the service is down.
    at(0.5, { status: 503 });
    const restarted = new LicensingGate(
      new LicenceSource(hosted, store, fetchImpl),
      NO_USAGE_REPORTS,
    );
    expect(await reasonOf(() => restarted.admit(command('people.manage')))).toBe('ADMITTED');
    at(48, { status: 503 });
    const later = new LicensingGate(new LicenceSource(hosted, store, fetchImpl), NO_USAGE_REPORTS);
    expect(await reasonOf(() => later.admit(command('people.manage')))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
    expect(await reasonOf(() => later.admit(query('people.read')))).toBe('ADMITTED');
  });

  it('a kept "no subscription" is not bridged by anything after a restart', async () => {
    const store = new MemoryLicensingStateStore();
    replies.push({ status: 200, body: snapshot() });
    await reasonOf(() =>
      new LicensingGate(new LicenceSource(hosted, store, fetchImpl), NO_USAGE_REPORTS).admit(
        query('people.read'),
      ),
    );
    at(0.1, { status: 404 });
    await reasonOf(() =>
      new LicensingGate(new LicenceSource(hosted, store, fetchImpl), NO_USAGE_REPORTS).admit(
        query('people.read'),
      ),
    );
    at(0.2, { status: 503 });
    const restarted = new LicensingGate(
      new LicenceSource(hosted, store, fetchImpl),
      NO_USAGE_REPORTS,
    );
    expect(await reasonOf(() => restarted.admit(query('people.read')))).toBe('NO_SUBSCRIPTION');
  });

  it('a clock wound back across a restart cannot make an ended term current', async () => {
    const store = new MemoryLicensingStateStore();
    const ended = snapshot({ expiresAt: '2026-11-01T00:00:00.000Z' });
    vi.setSystemTime(new Date('2026-11-10T00:00:00.000Z'));
    replies.push({ status: 200, body: ended });
    await reasonOf(() =>
      new LicensingGate(new LicenceSource(hosted, store, fetchImpl), NO_USAGE_REPORTS).admit(
        query('people.read'),
      ),
    );
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    replies.push({ status: 200, body: ended });
    const restarted = new LicensingGate(
      new LicenceSource(hosted, store, fetchImpl),
      NO_USAGE_REPORTS,
    );
    expect(await reasonOf(() => restarted.admit(command('people.manage')))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
  });

  it('a cancelled organisation exports its records and reaches nothing else', async () => {
    const gate = new LicensingGate(
      new LicenceSource(hosted, new MemoryLicensingStateStore(), fetchImpl),
      NO_USAGE_REPORTS,
    );
    replies.push({ status: 200, body: snapshot({ status: 'CANCELLED' }) });
    expect(await reasonOf(() => gate.admit(query('people.export')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('employment.export')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('payroll.export')))).toBe('ADMITTED');
    expect(await reasonOf(() => gate.admit(query('people.read')))).toBe('SUBSCRIPTION_RESTRICTED');
    expect(await reasonOf(() => gate.admit(command('people.export')))).toBe(
      'SUBSCRIPTION_RESTRICTED',
    );
    // An export of a module the plan never included is still refused.
    expect(await reasonOf(() => gate.admit(query('recruitment.export')))).toBe(
      'FEATURE_NOT_INCLUDED',
    );
  });

  it('notes each admitted operation for the hourly headcount report', async () => {
    const noteActivity = vi.fn();
    const gate = new LicensingGate(
      new LicenceSource(hosted, new MemoryLicensingStateStore(), fetchImpl),
      { noteActivity },
    );
    replies.push({ status: 200, body: snapshot() });
    await reasonOf(() => gate.admit(query('people.read')));
    await reasonOf(() => gate.admit(query('recruitment.read')));
    expect(noteActivity).toHaveBeenCalledTimes(1);
    expect(noteActivity).toHaveBeenCalledWith(TENANT);
  });
});

describe('the edge', () => {
  it('answers a licence refusal 402, with the reason and the customer-facing message', () => {
    const json = vi.fn();
    const response = { status: vi.fn(() => response), type: vi.fn(() => response), json };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: '/api/v1/payroll/runs', requestId: 'r1' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new ProblemDetailsFilter().catch(
      new NotEntitledException(
        'FEATURE_NOT_INCLUDED',
        "Your organisation's plan does not include this module.",
      ),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 402,
        reason: 'FEATURE_NOT_INCLUDED',
        detail: "Your organisation's plan does not include this module.",
      }),
    );
  });
});
