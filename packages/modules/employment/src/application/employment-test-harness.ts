import {
  Dispatcher,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork, permitting } from '@work/testing';

import { employmentModule } from './employment-module.js';
import { inMemoryEmploymentStores } from './in-memory-stores.js';
import { ALL_EMPLOYMENT_PERMISSIONS } from './employment-permissions.js';
import type {
  Clock,
  EmployablePerson,
  EmploymentStores,
  OrganizationDirectoryPort,
  PersonDirectoryPort,
} from './employment-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness the module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the pipeline
 * is where tenancy and authorization are applied — a test that bypassed it would prove a handler
 * works for a caller who was never checked.
 *
 * The two cross-module ports are **fakes with the properties that matter**, not mocks. The person
 * directory can be told that somebody was merged, and the organization directory can be told a
 * unit does not exist, because those are the two refusals this module owes its callers and a test
 * asserting on a mock call would prove neither.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward, and fixed so nothing is flaky. */
export const testClock = {
  value: new Date('2026-08-09T09:00:00Z'),
  reset(): void {
    this.value = new Date('2026-08-09T09:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = ALL_EMPLOYMENT_PERMISSIONS;

/** Dates the timeline tests share, so a reader can follow a transfer across a suite. */
export const JANUARY = new Date('2026-01-01T00:00:00Z');
export const MARCH = new Date('2026-03-01T00:00:00Z');
export const JUNE = new Date('2026-06-01T00:00:00Z');
export const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

/**
 * A stand-in for People.
 *
 * It answers what the real adapter answers: whether the person exists in the caller's tenant,
 * whether the record has been merged into another, and their name when the caller may read it.
 * Nothing else about a person is reachable from this module, in the fake or in production.
 */
export class FakePeople implements PersonDirectoryPort {
  private readonly people = new Map<string, EmployablePerson>();

  public add(personId: string, name?: Readonly<Record<string, string>>): string {
    this.people.set(personId, {
      personId,
      status: 'active',
      ...(name === undefined ? {} : { legalName: name }),
    });
    return personId;
  }

  public merge(personId: string, into: string): void {
    const existing = this.people.get(personId);

    if (existing !== undefined) {
      this.people.set(personId, { ...existing, mergedIntoPersonId: into });
    }
  }

  public find(personId: string): Promise<EmployablePerson | undefined> {
    return Promise.resolve(this.people.get(personId));
  }
}

/** A stand-in for Organization: the units that exist, and nothing else. */
export class FakeOrganization implements OrganizationDirectoryPort {
  private readonly units = new Set<string>();

  public add(unitId: string): string {
    this.units.add(unitId);
    return unitId;
  }

  public unitExists(unitId: string): Promise<boolean> {
    return Promise.resolve(this.units.has(unitId));
  }
}

export interface Harness {
  readonly stores: EmploymentStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
  readonly people: FakePeople;
  readonly organization: FakeOrganization;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness =>
  harnessWithStores(tenantId, inMemoryEmploymentStores(), granted);

/** A harness sharing existing stores, for the cross-tenant tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: EmploymentStores,
  granted: readonly string[] = ALL,
  shared?: { readonly people?: FakePeople; readonly organization?: FakeOrganization },
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const permissions: PermissionChecker = permitting(...granted);
  const dispatcher = new Dispatcher(permissions);
  const people = shared?.people ?? new FakePeople();
  const organization = shared?.organization ?? new FakeOrganization();
  // The same deferred seam the composition root uses, so import is exercised through the real
  // dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = { send: (command) => dispatcher.send(command) };
  const module = employmentModule(
    { unitOfWork: work, stores, people, organization, clock },
    sender,
  );

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  return { stores, work, dispatcher, people, organization };
};

/**
 * Dispatch helpers.
 *
 * The index signature is what lets a test write a command as an inline literal: without it,
 * TypeScript narrows the literal to bare `Command` and rejects every field the command carries.
 * The dispatcher's own signature stays strict; this widening lives in the tests only.
 */
export const send = <TResult>(
  harness: Harness,
  command: Command & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.send<TResult>(command);

export const ask = <TResult>(
  harness: Harness,
  query: Query & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.ask<TResult>(query);

/** Runs work inside a tenant context, as the request pipeline does in production. */
export const asTenant = <TResult>(
  tenantId: string,
  work: () => Promise<TResult>,
): Promise<TResult> =>
  runInContext({ tenantId, correlationId: uuidV7(), actor: `user:${uuidV7()}` }, work);

export interface CreatedEmployment {
  readonly employmentId: string;
  readonly employmentNumber: string;
  readonly personId: string;
}

/**
 * Creates an employment for a new person, which almost every test needs first.
 *
 * The person is registered with the fake directory in the same call, because an employment
 * without one is refused — which is the rule, not a fixture inconvenience.
 */
export const anEmployment = async (
  harness: Harness,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<CreatedEmployment> => {
  const personId = harness.people.add(uuidV7(), { en: 'Sara Al-Amri', ar: 'سارة العامري' });
  const created = await send<CreatedEmployment>(harness, {
    commandName: 'employment.create-employment',
    personId,
    employmentTypeCode: 'full-time',
    startDate: '2026-01-15',
    ...extra,
  });

  if (!created.ok) {
    throw new Error(`Could not create an employment: ${JSON.stringify(created.error)}`);
  }
  return created.value;
};

/** Creates an employment and activates it, which is the state most rules are about. */
export const anActiveEmployment = async (
  harness: Harness,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<CreatedEmployment> => {
  const employment = await anEmployment(harness, extra);
  const activated = await send(harness, {
    commandName: 'employment.change-status',
    employmentId: employment.employmentId,
    status: 'active',
    expectedVersion: 1,
  });

  if (!activated.ok) throw new Error('Could not activate the employment.');
  return employment;
};
