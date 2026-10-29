import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AsymmetricSigner } from '@munaxa/crypto';
import {
  REVOCATION_LIST_FORMAT,
  armorLicense,
  issueLicense,
  issueRevocationList,
  type LicensePayload,
} from '@munaxa/licensing';
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
const revocations = join(directory, 'work.revocations');

/** A signed revocation list naming `licenseIds`, numbered `sequence`. */
function revocationList(sequence: number, licenseIds: readonly string[], signer = issuer): string {
  return issueRevocationList(
    {
      format: REVOCATION_LIST_FORMAT,
      product: 'work',
      sequence,
      issuedAt: '2026-06-01T00:00:00.000Z',
      revoked: licenseIds.map((licenseId) => ({
        licenseId,
        revokedAt: '2026-06-01T00:00:00.000Z',
        reason: 'CONTRACT_ENDED' as const,
      })),
    },
    signer,
  );
}

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
const revocableEnvironment = loadEnvironment({
  DATABASE_URL: 'postgresql://work@localhost:5432/work',
  LICENSING_MODE: 'LICENSE_FILE',
  LICENSE_FILE_PATH: path,
  LICENSE_PUBLIC_KEYS: JSON.stringify([{ kid: pair.kid, publicKey: pair.publicKey }]),
  LICENSE_INSTALLATION_ID: 'inst-1',
  LICENSE_REVOCATION_PATH: revocations,
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

describe('offline revocation (platform ADR-0022)', () => {
  const guardWith = (store: MemoryLicensingStateStore) =>
    new EntitlementGuard(reflector(), new LicenceSource(revocableEnvironment, store));
  const seeded = () => {
    const store = new MemoryLicensingStateStore();
    // A licensing_state row exists once a check has written it.
    store.rows.set(TENANT, { snapshot: null, lastObservedAt: new Date(0), revocationList: null });
    return store;
  };

  it('a licence the delivered list names is suspended: reads stay, writes stop', async () => {
    writeFileSync(path, licence());
    writeFileSync(revocations, revocationList(2, ['lic_1']));
    const guard = guardWith(seeded());
    await expect(asTenant(() => guard.canActivate(http('GET')))).resolves.toBe(true);
    expect((await refusal(guard, 'POST')).getStatus()).toBe(402);
  });

  it('a list that does not name this licence changes nothing', async () => {
    writeFileSync(path, licence());
    writeFileSync(revocations, revocationList(2, ['lic_someone_else']));
    const guard = guardWith(seeded());
    await expect(asTenant(() => guard.canActivate(http('POST')))).resolves.toBe(true);
  });

  it('a revocation sticks: deleting the file or offering an older list does not undo it', async () => {
    writeFileSync(path, licence());
    writeFileSync(revocations, revocationList(3, ['lic_1']));
    const store = seeded();
    await refusal(guardWith(store), 'POST');
    expect(store.sequences.get(TENANT)).toBe(3);

    // A new process (restart), the file now gone: the persisted list still applies.
    rmSync(revocations);
    expect((await refusal(guardWith(store), 'POST')).getStatus()).toBe(402);

    // An older list, which did not yet name the licence, is not taken.
    writeFileSync(revocations, revocationList(2, []));
    expect((await refusal(guardWith(store), 'POST')).getStatus()).toBe(402);
    expect(store.sequences.get(TENANT)).toBe(3);
  });

  it('a forged list is not taken, and grants nothing it did not already have', async () => {
    writeFileSync(path, licence());
    const forger = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    // The same key id, a different key: what a forger would try.
    const stranger = new AsymmetricSigner('ES256', [
      {
        kid: pair.kid,
        privateKey: forger.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKey: forger.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    ]);
    // Persist a real revocation first, then offer a forged, newer list that would lift it.
    writeFileSync(revocations, revocationList(2, ['lic_1']));
    const store = seeded();
    await refusal(guardWith(store), 'POST');
    writeFileSync(revocations, revocationList(9, [], stranger));
    expect((await refusal(guardWith(store), 'POST')).getStatus()).toBe(402);
    expect(store.sequences.get(TENANT)).toBe(2);
  });

  it('a kept list that no longer verifies fails closed: the licence is suspended', async () => {
    writeFileSync(path, licence());
    rmSync(revocations, { force: true });
    const store = seeded();
    const tampered = revocationList(2, []).replace(/\.[^.]+$/, '.AAAA');
    store.rows.set(TENANT, {
      snapshot: null,
      lastObservedAt: new Date(0),
      revocationList: tampered,
    });
    expect((await refusal(guardWith(store), 'POST')).getStatus()).toBe(402);
  });

  it('without a revocation path, a valid licence works as before', async () => {
    writeFileSync(path, licence());
    const guard = new EntitlementGuard(
      reflector(),
      new LicenceSource(licensedEnvironment, new MemoryLicensingStateStore()),
    );
    await expect(asTenant(() => guard.canActivate(http('POST')))).resolves.toBe(true);
  });
});
