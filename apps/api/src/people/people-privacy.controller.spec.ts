import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  ContactsController,
  DuplicatesController,
  HmacIdentifierDigest,
  IdentifiersController,
  PeopleController,
  PeopleDispatcher,
  PeoplePermissions,
  PersonLifecycleController,
  PersonalDetailsController,
  ProfileController,
  TransferController,
  inMemoryPeopleStores,
  peopleModule,
  type PeopleStores,
} from '@work/people';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * The privacy model, asserted **through HTTP**.
 *
 * The module's own suite proves the redaction at the application layer. This proves it survives
 * the transport: that a masked identifier is masked in the JSON that actually leaves the process,
 * that a withheld section is absent from the response body rather than merely from a view object,
 * and that a caller who may not write is refused with 403 before their payload is even validated.
 *
 * The last of those is the ordering that matters most, and it is easy to get wrong: an
 * unauthorized caller must learn nothing about whether their body was well formed.
 */

const TENANT = uuidV7();
const NATIONAL_ID = '0000012345';

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const SARA = { en: 'Sara Al-Amri', ar: 'سارة العامري' };

/** A disclosure log the test can read back, standing in for the structured logger. */
class RecordingLog {
  public readonly recorded: string[] = [];

  public recordDisclosure(disclosure: { readonly identifierType: string }): void {
    this.recorded.push(disclosure.identifierType);
  }
}

interface Harness {
  readonly application: INestApplication;
  readonly stores: PeopleStores;
  readonly disclosures: RecordingLog;
}

const applicationWith = async (
  checker: PermissionChecker,
  stores: PeopleStores = inMemoryPeopleStores(),
): Promise<Harness> => {
  const dispatcher = new Dispatcher(checker);
  const disclosures = new RecordingLog();
  const module = peopleModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores,
      permissions: checker,
      digest: new HmacIdentifierDigest('a-test-key-long-enough-to-be-a-key-000000'),
      disclosure: disclosures,
      clock: { now: () => new Date('2026-08-06T09:00:00Z') },
    },
    { send: (command) => dispatcher.send(command) },
  );

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  const testing = await Test.createTestingModule({
    controllers: [
      DuplicatesController,
      TransferController,
      PersonLifecycleController,
      IdentifiersController,
      ContactsController,
      PersonalDetailsController,
      ProfileController,
      PeopleController,
    ],
    providers: [
      { provide: PeopleDispatcher, useValue: new PeopleDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  application.use((_request: unknown, _response: unknown, next: () => void) => {
    runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, next);
  });
  configureApplication(application, environment);
  await application.init();
  return { application, stores, disclosures };
};

const serverOf = (application: INestApplication): Server => application.getHttpServer() as Server;

const ALL = Object.values(PeoplePermissions);

const without = (...withheld: readonly string[]): readonly string[] =>
  ALL.filter((permission) => !withheld.includes(permission));

let open: INestApplication[] = [];

const started = async (granted: readonly string[], stores?: PeopleStores): Promise<Harness> => {
  const harness = await applicationWith(permitting(...granted), stores);

  open.push(harness.application);
  return harness;
};

afterEach(async () => {
  await Promise.all(open.map((application) => application.close()));
  open = [];
});

/** A person with a national identifier and a note, shared by the tests below. */
const seeded = async (harness: Harness): Promise<string> => {
  const created = await request(serverOf(harness.application))
    .post('/api/v1/people')
    .send({ personNumber: 'E-1001', legalName: SARA, dateOfBirth: '1990-03-14' })
    .expect(201);
  const personId = (created.body as { personId: string }).personId;

  await request(serverOf(harness.application))
    .post(`/api/v1/people/${personId}/identifiers`)
    .send({ identifierType: 'national-id', value: NATIONAL_ID })
    .expect(201);
  await request(serverOf(harness.application))
    .post(`/api/v1/people/${personId}/notes`)
    .send({ categoryCode: 'wellbeing', body: 'Requested a quiet workspace.' })
    .expect(201);
  return personId;
};

describe('the People API and personal data', () => {
  it('masks an identifier in the response body for a caller without the value permission', async () => {
    const full = await started(ALL);
    const personId = await seeded(full);
    const limited = await started(without(PeoplePermissions.identifierReadValue), full.stores);
    const profile = await request(serverOf(limited.application))
      .get(`/api/v1/people/${personId}/profile`)
      .expect(200);

    const body = JSON.stringify(profile.body);

    expect(body).toContain('••••2345');
    expect(body).not.toContain(NATIONAL_ID);
  });

  it('shows the value to a caller holding it, and records the disclosure', async () => {
    const full = await started(ALL);
    const personId = await seeded(full);
    const profile = await request(serverOf(full.application))
      .get(`/api/v1/people/${personId}/profile`)
      .expect(200);

    expect(JSON.stringify(profile.body)).toContain(NATIONAL_ID);
    expect(full.disclosures.recorded).toContain('national-id');
  });

  it('omits a withheld section from the response body and names it in `withheld`', async () => {
    const full = await started(ALL);
    const personId = await seeded(full);
    const limited = await started(without(PeoplePermissions.noteRead), full.stores);
    const profile = await request(serverOf(limited.application))
      .get(`/api/v1/people/${personId}/profile`)
      .expect(200);

    const body = profile.body as { notes?: unknown; withheld: readonly string[] };

    expect(body.notes).toBeUndefined();
    expect(body.withheld).toContain('notes');
    expect(JSON.stringify(body)).not.toContain('quiet workspace');
  });

  it('withholds sensitive fields from a search rather than from the detail read alone', async () => {
    const full = await started(ALL);

    await seeded(full);

    const limited = await started(without(PeoplePermissions.sensitiveRead), full.stores);
    const found = await request(serverOf(limited.application)).get('/api/v1/people').expect(200);

    expect(JSON.stringify(found.body)).not.toContain('1990-03-14');
    expect(JSON.stringify(found.body)).toContain('"sensitiveWithheld":true');
  });

  it('refuses a write the caller may not perform with 403, and names the permission', async () => {
    const limited = await started(without(PeoplePermissions.noteWrite));
    const full = await started(ALL);
    const personId = await seeded(full);
    const refused = await request(serverOf(limited.application))
      .post(`/api/v1/people/${personId}/notes`)
      .send({ categoryCode: 'general', body: 'A note.' })
      .expect(403);

    expect(refused.body).toMatchObject({ status: 403 });
    expect(JSON.stringify(refused.body)).toContain(PeoplePermissions.noteWrite);
  });

  it('carries no identifier value, note or date of birth out through the export', async () => {
    const full = await started(ALL);

    await seeded(full);

    const exported = await request(serverOf(full.application))
      .get('/api/v1/people/export')
      .expect(200);
    const body = JSON.stringify(exported.body);

    expect(body).not.toContain(NATIONAL_ID);
    expect(body).not.toContain('quiet workspace');
    expect(body).not.toContain('1990-03-14');
    expect(body).toContain('سارة العامري');
  });
});
