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

import { onboardingModule } from './onboarding-module.js';
import { inMemoryOnboardingStores } from './in-memory-stores.js';
import { ALL_ONBOARDING_PERMISSIONS } from './onboarding-permissions.js';
import type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForOnboarding,
  OnboardingStores,
  PeopleDirectoryPort,
  PersonForOnboarding,
} from './onboarding-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness this module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the pipeline
 * is where tenancy and authorization are applied — a test that bypassed it would prove a handler
 * works for a caller who was never checked.
 *
 * The two cross-module ports are **fakes with the properties that matter**, not mocks. Employment
 * can be told an employment has ended or that a manager is on the reporting line; People can be told
 * a record was merged away. Those are the refusals this module owes its callers, and a test
 * asserting on a mock call would prove none of them.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward, and fixed so nothing is flaky. */
export const testClock = {
  value: new Date('2026-08-10T09:00:00Z'),
  reset(): void {
    this.value = new Date('2026-08-10T09:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = ALL_ONBOARDING_PERMISSIONS;

/**
 * A stand-in for Employment.
 *
 * It answers what the real adapter answers and nothing more: whether an employment exists in this
 * tenant, its person, its status, its start date, and who its manager is. No other employment fact
 * is reachable from this module, in the fake or in production.
 */
export class FakeEmployment implements EmploymentDirectoryPort {
  private readonly employments = new Map<string, EmploymentForOnboarding>();

  public add(
    overrides: Partial<EmploymentForOnboarding> & { readonly personId: string },
  ): EmploymentForOnboarding {
    const employment: EmploymentForOnboarding = {
      employmentId: overrides.employmentId ?? uuidV7(),
      personId: overrides.personId,
      status: overrides.status ?? 'active',
      startDate: overrides.startDate ?? '2026-09-01',
      ...(overrides.managerEmploymentId === undefined
        ? {}
        : { managerEmploymentId: overrides.managerEmploymentId }),
    };

    this.employments.set(employment.employmentId, employment);
    return employment;
  }

  public end(employmentId: string): void {
    const existing = this.employments.get(employmentId);

    if (existing !== undefined) {
      this.employments.set(employmentId, { ...existing, status: 'ended' });
    }
  }

  public find(employmentId: string): Promise<EmploymentForOnboarding | undefined> {
    return Promise.resolve(this.employments.get(employmentId));
  }

  public liveEmployments(limit: number): Promise<readonly EmploymentForOnboarding[]> {
    return Promise.resolve(
      [...this.employments.values()].filter((one) => one.status !== 'ended').slice(0, limit),
    );
  }
}

/** A stand-in for People: existence, and whether the record was merged away. Never a name. */
export class FakePeople implements PeopleDirectoryPort {
  private readonly people = new Map<string, PersonForOnboarding>();

  public add(personId: string = uuidV7()): string {
    this.people.set(personId, { personId, status: 'active' });
    return personId;
  }

  public merge(personId: string, into: string): void {
    const existing = this.people.get(personId);

    if (existing !== undefined) {
      this.people.set(personId, { ...existing, mergedIntoPersonId: into });
    }
  }

  public find(personId: string): Promise<PersonForOnboarding | undefined> {
    return Promise.resolve(this.people.get(personId));
  }
}

export interface Harness {
  readonly stores: OnboardingStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
  readonly employment: FakeEmployment;
  readonly people: FakePeople;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness =>
  harnessWithStores(tenantId, inMemoryOnboardingStores(), granted);

/** A harness sharing existing stores and fakes, for the cross-tenant and concurrency tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: OnboardingStores,
  granted: readonly string[] = ALL,
  shared?: { readonly employment?: FakeEmployment; readonly people?: FakePeople },
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const permissions: PermissionChecker = permitting(...granted);
  const dispatcher = new Dispatcher(permissions);
  const employment = shared?.employment ?? new FakeEmployment();
  const people = shared?.people ?? new FakePeople();
  // The same deferred seam the composition root uses, so reconciliation is exercised through the
  // real dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = { send: (command) => dispatcher.send(command) };
  const module = onboardingModule({ unitOfWork: work, stores, employment, people, clock }, sender);

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  return { stores, work, dispatcher, employment, people };
};

/**
 * Dispatch helpers.
 *
 * The index signature is what lets a test write a command as an inline literal: without it,
 * TypeScript narrows the literal to bare `Command` and rejects every field the command carries.
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

/** An employment that exists in the fakes, as Recruitment's hire would have left it. */
export const anEmployment = (
  harness: Harness,
  overrides: Partial<EmploymentForOnboarding> = {},
): EmploymentForOnboarding =>
  harness.employment.add({ personId: harness.people.add(), ...overrides });

export interface PublishedPlan {
  readonly planId: string;
  readonly planVersionId: string;
}

/**
 * A plan with one published version holding two tasks: one required, owned by the employee, and one
 * optional, owned by the IT queue.
 *
 * Published through the real commands rather than written into the store, because "a published
 * version is immutable" and "an instance copies its tasks" are the rules several suites are about,
 * and a fixture that wrote rows directly would quietly disable them.
 */
export const aPublishedPlan = async (
  harness: Harness,
  code = `joiner-${uuidV7().slice(-8)}`,
): Promise<PublishedPlan> => {
  const plan = expected<{ planId: string }>(
    await send(harness, {
      commandName: 'onboarding.create-plan',
      code,
      name: { en: 'Corporate joiner', ar: 'موظف جديد' },
    }),
    'create a plan',
  );
  const version = expected<{ planVersionId: string }>(
    await send(harness, {
      commandName: 'onboarding.draft-plan-version',
      planId: plan.planId,
    }),
    'draft a version',
  );

  expected(
    await send(harness, {
      commandName: 'onboarding.define-task-template',
      planVersionId: version.planVersionId,
      code: 'sign-contract',
      sequence: 1,
      title: { en: 'Sign the contract', ar: 'توقيع العقد' },
      kind: 'checklist',
      ownerKind: 'employee',
      required: true,
      dueAnchor: 'employment_start',
      dueOffsetDays: -3,
    }),
    'define the first template',
  );
  expected(
    await send(harness, {
      commandName: 'onboarding.define-task-template',
      planVersionId: version.planVersionId,
      code: 'issue-laptop',
      sequence: 2,
      title: { en: 'Issue a laptop', ar: 'تسليم حاسوب' },
      kind: 'external',
      ownerKind: 'role',
      ownerRole: 'it',
      required: false,
      dueAnchor: 'employment_start',
      dueOffsetDays: 1,
    }),
    'define the second template',
  );
  expected(
    await send(harness, {
      commandName: 'onboarding.publish-plan-version',
      planVersionId: version.planVersionId,
      expectedVersion: 1,
    }),
    'publish the version',
  );
  return { planId: plan.planId, planVersionId: version.planVersionId };
};
