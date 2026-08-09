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

import { recruitmentModule } from './recruitment-module.js';
import { inMemoryRecruitmentStores } from './in-memory-stores.js';
import { ALL_RECRUITMENT_PERMISSIONS } from './recruitment-permissions.js';
import type {
  Clock,
  CreateEmploymentForHire,
  CreatePersonForHire,
  EmploymentDirectoryPort,
  MatchedPerson,
  OrganizationDirectoryPort,
  PeopleDirectoryPort,
  RecruitmentStores,
} from './recruitment-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness this module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the pipeline
 * is where tenancy and authorization are applied — a test that bypassed it would prove a handler
 * works for a caller who was never checked.
 *
 * The three cross-module ports are **fakes with the properties that matter**, not mocks. People can
 * be told somebody was merged or that two records share an address; Employment can be told a create
 * fails. Those are the refusals and the failures this module owes its callers, and a test asserting
 * on a mock call would prove none of them.
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

export const ALL = ALL_RECRUITMENT_PERMISSIONS;

/**
 * A stand-in for People.
 *
 * It answers what the real adapter answers and nothing more: who matches a contact point, whether a
 * record was merged away, and the person a hire created. No other attribute of a person is reachable
 * from this module, in the fake or in production.
 */
export class FakePeople implements PeopleDirectoryPort {
  public readonly created: CreatePersonForHire[] = [];

  private readonly people = new Map<string, MatchedPerson>();

  private readonly contacts = new Map<string, string[]>();

  public add(email: string, personId: string = uuidV7()): string {
    this.people.set(personId, { personId, status: 'active' });
    this.contacts.set(email.toLowerCase(), [
      ...(this.contacts.get(email.toLowerCase()) ?? []),
      personId,
    ]);
    return personId;
  }

  public merge(personId: string, into: string): void {
    const existing = this.people.get(personId);

    if (existing !== undefined) {
      this.people.set(personId, { ...existing, mergedIntoPersonId: into });
    }
  }

  public findByContact(email: string): Promise<readonly MatchedPerson[]> {
    const ids = this.contacts.get(email.toLowerCase()) ?? [];

    return Promise.resolve(
      ids.map((id) => this.people.get(id)).filter((person) => person !== undefined),
    );
  }

  public find(personId: string): Promise<MatchedPerson | undefined> {
    return Promise.resolve(this.people.get(personId));
  }

  public create(request: CreatePersonForHire): Promise<MatchedPerson> {
    this.created.push(request);
    return Promise.resolve({ personId: this.add(request.email), status: 'active' });
  }
}

/** A stand-in for Organization: the units that exist, and nothing else. */
export class FakeOrganization implements OrganizationDirectoryPort {
  private readonly units = new Set<string>();

  public add(unitId: string = uuidV7()): string {
    this.units.add(unitId);
    return unitId;
  }

  public unitExists(unitId: string): Promise<boolean> {
    return Promise.resolve(this.units.has(unitId));
  }
}

/**
 * A stand-in for Employment.
 *
 * `failNext` is the important capability: the hire saga's whole point is what happens when the
 * employment step does not complete, and a fake that always succeeds would leave that untested.
 */
export class FakeEmployment implements EmploymentDirectoryPort {
  public readonly created: CreateEmploymentForHire[] = [];

  public failNext = false;

  private readonly employments = new Set<string>();

  public add(employmentId: string = uuidV7()): string {
    this.employments.add(employmentId);
    return employmentId;
  }

  public exists(employmentId: string): Promise<boolean> {
    return Promise.resolve(this.employments.has(employmentId));
  }

  public create(request: CreateEmploymentForHire): Promise<{ readonly employmentId: string }> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('Employment refused the create.'));
    }
    this.created.push(request);
    return Promise.resolve({ employmentId: this.add() });
  }
}

export interface Harness {
  readonly stores: RecruitmentStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
  readonly people: FakePeople;
  readonly organization: FakeOrganization;
  readonly employment: FakeEmployment;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness =>
  harnessWithStores(tenantId, inMemoryRecruitmentStores(), granted);

/** The three fakes, shared where a cross-tenant test supplied one and fresh otherwise. */
const fakesFor = (shared?: {
  readonly people?: FakePeople;
  readonly organization?: FakeOrganization;
  readonly employment?: FakeEmployment;
}): {
  readonly people: FakePeople;
  readonly organization: FakeOrganization;
  readonly employment: FakeEmployment;
} => ({
  people: shared?.people ?? new FakePeople(),
  organization: shared?.organization ?? new FakeOrganization(),
  employment: shared?.employment ?? new FakeEmployment(),
});

/** A harness sharing existing stores, for the cross-tenant tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: RecruitmentStores,
  granted: readonly string[] = ALL,
  shared?: {
    readonly people?: FakePeople;
    readonly organization?: FakeOrganization;
    readonly employment?: FakeEmployment;
  },
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const permissions: PermissionChecker = permitting(...granted);
  const dispatcher = new Dispatcher(permissions);
  const { people, organization, employment } = fakesFor(shared);
  // The same deferred seam the composition root uses, so import is exercised through the real
  // dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = { send: (command) => dispatcher.send(command) };
  const module = recruitmentModule(
    { unitOfWork: work, stores, people, organization, employment, clock },
    sender,
  );

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  return { stores, work, dispatcher, people, organization, employment };
};

/**
 * Dispatch helpers.
 *
 * The index signature is what lets a test write a command as an inline literal: without it,
 * TypeScript narrows the literal to bare `Command` and rejects every field the command carries. The
 * dispatcher's own signature stays strict; this widening lives in the tests only.
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

const expected = <TResult>(result: Result<TResult, HandlerFailure>, what: string): TResult => {
  if (!result.ok) throw new Error(`Could not ${what}: ${JSON.stringify(result.error)}`);
  return result.value;
};

/**
 * An approved requisition, which almost everything else needs first.
 *
 * The approval goes through the real command rather than being written into the store, because
 * "approval authorises hiring" is the rule under test in several suites and a fixture that faked it
 * would quietly disable them.
 */
export const anApprovedRequisition = async (
  harness: Harness,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly requisitionId: string }> => {
  const created = expected<{ requisitionId: string }>(
    await send(harness, {
      commandName: 'recruitment.create-requisition',
      positionId: uuidV7(),
      unitId: harness.organization.add(),
      headcountRequested: 1,
      reasonCode: 'growth',
      requestedByEmploymentId: harness.employment.add(),
      ...extra,
    }),
    'create a requisition',
  );

  expected(
    await send(harness, {
      commandName: 'recruitment.submit-requisition',
      requisitionId: created.requisitionId,
      expectedVersion: 1,
    }),
    'submit the requisition',
  );
  expected(
    await send(harness, {
      commandName: 'recruitment.decide-requisition',
      requisitionId: created.requisitionId,
      decision: 'approved',
      expectedVersion: 2,
    }),
    'approve the requisition',
  );
  return created;
};

/** A published vacancy against a fresh approved requisition. */
export const aPublishedVacancy = async (
  harness: Harness,
): Promise<{ readonly vacancyId: string; readonly requisitionId: string }> => {
  const requisition = await anApprovedRequisition(harness);
  const vacancy = expected<{ vacancyId: string }>(
    await send(harness, {
      commandName: 'recruitment.open-vacancy',
      requisitionId: requisition.requisitionId,
      title: { en: 'Field engineer', ar: 'مهندس ميداني' },
    }),
    'open a vacancy',
  );

  expected(
    await send(harness, {
      commandName: 'recruitment.publish-vacancy',
      vacancyId: vacancy.vacancyId,
      expectedVersion: 1,
    }),
    'publish the vacancy',
  );
  return { ...vacancy, requisitionId: requisition.requisitionId };
};

/** A candidate, with the address the fakes match on. */
export const aCandidate = async (
  harness: Harness,
  email = `applicant-${uuidV7()}@example.com`,
): Promise<{ readonly candidateId: string; readonly email: string }> => {
  const created = expected<{ candidateId: string }>(
    await send(harness, {
      commandName: 'recruitment.create-candidate',
      displayName: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' },
      email,
      sourceCode: 'referral',
    }),
    'create a candidate',
  );

  return { ...created, email };
};

/** An application on a published vacancy, which is where every pipeline test starts. */
export const anApplication = async (
  harness: Harness,
): Promise<{
  readonly applicationId: string;
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly requisitionId: string;
}> => {
  const vacancy = await aPublishedVacancy(harness);
  const candidate = await aCandidate(harness);
  const submitted = expected<{ applicationId: string }>(
    await send(harness, {
      commandName: 'recruitment.submit-application',
      candidateId: candidate.candidateId,
      vacancyId: vacancy.vacancyId,
      sourceCode: 'referral',
    }),
    'submit an application',
  );

  return { ...submitted, candidateId: candidate.candidateId, ...vacancy };
};
