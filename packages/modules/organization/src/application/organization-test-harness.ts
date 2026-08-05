import {
  Dispatcher,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type Query,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork, permitting } from '@work/testing';

import { inMemoryOrganizationStores } from './in-memory-stores.js';
import { NoAssignmentsYet } from './no-assignments.js';
import { organizationModule } from './organization-module.js';
import { ALL_ORGANIZATION_PERMISSIONS } from './organization-permissions.js';
import type { Clock, FilledHeadcountPort, OrganizationStores } from './organization-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness the module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the
 * pipeline is where tenancy and authorization are applied — a test that bypassed it would prove
 * a handler works for a caller who was never checked.
 *
 * Shared rather than repeated per suite so every test file exercises an identically configured
 * module; a harness that differed slightly between files would make a failure in one of them
 * mean nothing about the others.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward, and set to a fixed instant so nothing is flaky. */
export const testClock = {
  value: new Date('2026-08-06T09:00:00Z'),
  reset(): void {
    this.value = new Date('2026-08-06T09:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = ALL_ORGANIZATION_PERMISSIONS;

/** Dates the structure tests share, so a reader can follow a reorganization across a suite. */
export const JANUARY = new Date('2026-01-01T00:00:00Z');
export const MARCH = new Date('2026-03-01T00:00:00Z');
export const JUNE = new Date('2026-06-01T00:00:00Z');
export const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

export interface Harness {
  readonly stores: OrganizationStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
}

/**
 * A filled-headcount port a test can set, standing in for Employment's assignment events.
 *
 * The production adapter answers zero because there genuinely are no assignments until Phase 5.
 * The establishment projection still has to be right when a real count arrives, and a test that
 * could only ever see zero would prove nothing about the arithmetic.
 */
export class StubbedFilledHeadcount implements FilledHeadcountPort {
  private readonly counts = new Map<string, number>();

  public set(positionId: string, unitId: string, filled: number): void {
    this.counts.set(`${positionId}|${unitId}`, filled);
  }

  public filledFor(positionId: string, unitId: string): Promise<number> {
    return Promise.resolve(this.counts.get(`${positionId}|${unitId}`) ?? 0);
  }
}

export const harnessFor = (
  tenantId: string,
  granted: readonly string[] = ALL,
  filled: FilledHeadcountPort = new NoAssignmentsYet(),
): Harness => harnessWithStores(tenantId, inMemoryOrganizationStores(), granted, filled);

/** A harness sharing an existing store, for the cross-tenant tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: OrganizationStores,
  granted: readonly string[] = ALL,
  filled: FilledHeadcountPort = new NoAssignmentsYet(),
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const dispatcher = new Dispatcher(permitting(...granted));
  // The same deferred seam the composition root uses, so import is exercised through the real
  // dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = {
    send: (command) => dispatcher.send(command),
  };
  const module = organizationModule({ unitOfWork: work, stores, filled, clock }, sender);

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  for (const handler of module.eventHandlers ?? []) {
    work.events.register(handler);
  }
  return { stores, work, dispatcher };
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
