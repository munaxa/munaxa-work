import 'reflect-metadata';

import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
  type WorkModule,
} from '@work/kernel';
import {
  ALL_EMPLOYMENT_PERMISSIONS,
  FakeOrganization as FakeEmploymentOrganization,
  FakePeople,
  employmentModule,
  inMemoryEmploymentStores,
} from '@work/employment';
import {
  ALL_COMPENSATION_PERMISSIONS,
  FixedClock,
  compensationModule,
  inMemoryCompensationStores,
} from '@work/compensation';
import { InMemoryUnitOfWork } from '@work/testing';

import {
  CompensationEmploymentDirectory,
  CompensationOrganizationDirectory,
  type Asking,
} from './compensation.composition.js';

/**
 * The wiring the cross-module suite runs against: Employment and Compensation on **one real
 * dispatcher**, connected by the real adapter the composition root builds.
 *
 * Apart from the assertions because it is a composition rather than a test, and because the
 * assertions are the part worth reading. Only the database, People and Organization are fakes here;
 * `CompensationEmploymentDirectory` and `CompensationOrganizationDirectory` are the production
 * classes, and every cross-module call goes through the real bounded service grant.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-06-15T09:00:00Z');

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

export interface Wired {
  readonly dispatcher: Dispatcher;
  readonly people: FakePeople;
  readonly employmentUnavailable: () => void;
  readonly employmentRestored: () => void;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export const wire = (): Wired => {
  const dispatcher = new Dispatcher(
    permitting(...ALL_EMPLOYMENT_PERMISSIONS, ...ALL_COMPENSATION_PERMISSIONS),
  );
  const work = new InMemoryUnitOfWork(TENANT);
  const people = new FakePeople();
  const clock = new FixedClock(NOW);
  let available = true;

  /**
   * The seam every adapter asks through.
   *
   * `available` is what the honest-failure assertion flips: an Employment that throws must become
   * "the employment could not be confirmed" and therefore a refusal, never a compensation record
   * written against an employment nobody checked.
   */
  const asking: Asking = {
    ask: <TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> => {
      if (!available && query.queryName.startsWith('employment.')) {
        throw new Error('Employment is unavailable.');
      }
      return dispatcher.ask<TResult>(query);
    },
  };

  register(dispatcher, modulesFor({ dispatcher, work, people, asking, clock }));

  return {
    dispatcher,
    people,
    employmentUnavailable: () => {
      available = false;
    },
    employmentRestored: () => {
      available = true;
    },
    as: (actor, body) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, body),
  };
};

interface Wiring {
  readonly dispatcher: Dispatcher;
  readonly work: InMemoryUnitOfWork;
  readonly people: FakePeople;
  readonly asking: Asking;
  readonly clock: FixedClock;
}

const modulesFor = (wiring: Wiring): readonly WorkModule[] => [
  employmentModule(
    {
      unitOfWork: wiring.work,
      stores: inMemoryEmploymentStores(),
      people: wiring.people,
      organization: new FakeEmploymentOrganization(),
      clock: wiring.clock,
    },
    { send: (command) => wiring.dispatcher.send(command) },
  ),
  compensationModule({
    unitOfWork: wiring.work,
    stores: inMemoryCompensationStores(),
    // The production adapters, not fakes. This is the point of the suite.
    employment: new CompensationEmploymentDirectory(wiring.asking),
    organization: new CompensationOrganizationDirectory(wiring.asking),
    clock: wiring.clock,
  }),
];

const register = (dispatcher: Dispatcher, modules: readonly WorkModule[]): void => {
  for (const module of modules) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
};

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  wired: Wired,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const trySend = (
  wired: Wired,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => wired.dispatcher.send(command as never);

export const ask = async <TResult>(
  wired: Wired,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};
