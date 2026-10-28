import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AsymmetricSigner } from '@munaxa/crypto';
import { armorLicense, issueLicense, type LicensePayload } from '@munaxa/licensing';
import { loadEnvironment } from '@work/config';
import { runInContext, uuidV7 } from '@work/kernel';
import { afterAll, describe, expect, it } from 'vitest';

import { PUBLIC_ROUTE } from '../tenancy/public-route.decorator.js';
import { EntitlementGuard } from './entitlement.guard.js';
import { LicenceSource } from './licence.source.js';
import { MemoryLicensingStateStore } from './licensing-state.store.js';

const TENANT = uuidV7();
const directory = mkdtempSync(join(tmpdir(), 'work-licence-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pair = {
  kid: 'lic-1',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
};
const issuer = new AsymmetricSigner('ES256', [pair]);
const path = join(directory, 'work.license');

function licence(overrides: Partial<LicensePayload> = {}): string {
  return armorLicense(
    issueLicense(
      {
        schemaVersion: 1,
        customerId: 'cus_1',
        tenantId: TENANT,
        product: 'work',
        deployment: 'ON_PREMISES',
        subscriptionId: 'sub_1',
        plan: { code: 'enterprise', version: 1 },
        status: 'ACTIVE',
        trialEndsAt: null,
        expiresAt: '2099-01-01T00:00:00.000Z',
        graceUntil: null,
        features: [],
        limits: {},
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

const licensedEnvironment = loadEnvironment({
  DATABASE_URL: 'postgresql://work@localhost:5432/work',
  LICENSING_MODE: 'LICENSE_FILE',
  LICENSE_FILE_PATH: path,
  LICENSE_PUBLIC_KEYS: JSON.stringify([{ kid: pair.kid, publicKey: pair.publicKey }]),
  LICENSE_INSTALLATION_ID: 'inst-1',
});

function reflector(metadata: Record<string, unknown> = {}): Reflector {
  return { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
}

function http(method: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as ExecutionContext;
}

const asTenant = <T>(work: () => Promise<T>): Promise<T> =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, work);

async function refusal(guard: EntitlementGuard, method: string): Promise<HttpException> {
  try {
    await asTenant(() => guard.canActivate(http(method)));
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error(`${method} was allowed`);
}

describe('EntitlementGuard', () => {
  it('permits everything when this deployment is not licensed, as before', async () => {
    const source = new LicenceSource(
      loadEnvironment({ DATABASE_URL: 'postgresql://work@localhost/w' }),
      new MemoryLicensingStateStore(),
    );
    const guard = new EntitlementGuard(reflector(), source);
    await expect(asTenant(() => guard.canActivate(http('DELETE')))).resolves.toBe(true);
  });

  it('a valid licence permits reads and writes', async () => {
    writeFileSync(path, licence());
    const guard = new EntitlementGuard(
      reflector(),
      new LicenceSource(licensedEnvironment, new MemoryLicensingStateStore()),
    );
    await expect(asTenant(() => guard.canActivate(http('GET')))).resolves.toBe(true);
    await expect(asTenant(() => guard.canActivate(http('POST')))).resolves.toBe(true);
  });

  it('an ended licence is read-only, with 402 rather than 403', async () => {
    writeFileSync(path, licence({ expiresAt: '2026-02-01T00:00:00.000Z' }));
    const guard = new EntitlementGuard(
      reflector(),
      new LicenceSource(licensedEnvironment, new MemoryLicensingStateStore()),
    );
    await expect(asTenant(() => guard.canActivate(http('GET')))).resolves.toBe(true);
    const refused = await refusal(guard, 'PATCH');
    expect(refused.getStatus()).toBe(402);
  });

  it('a missing, foreign or other-tenant licence grants nothing, not even reads', async () => {
    for (const write of [
      () => rmSync(path, { force: true }),
      () => writeFileSync(path, licence({ installationId: 'another-server' })),
      () => writeFileSync(path, licence({ tenantId: uuidV7() })),
      () => writeFileSync(path, licence({ product: 'docs' })),
    ]) {
      write();
      const guard = new EntitlementGuard(
        reflector(),
        new LicenceSource(licensedEnvironment, new MemoryLicensingStateStore()),
      );
      expect((await refusal(guard, 'GET')).getStatus()).toBe(402);
    }
  });

  it('never asks about a public route', async () => {
    rmSync(path, { force: true });
    const guard = new EntitlementGuard(
      reflector({ [PUBLIC_ROUTE]: true }),
      new LicenceSource(licensedEnvironment, new MemoryLicensingStateStore()),
    );
    await expect(guard.canActivate(http('POST'))).resolves.toBe(true);
  });
});
