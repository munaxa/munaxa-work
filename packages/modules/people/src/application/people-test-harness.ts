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

import { inMemoryPeopleStores } from './in-memory-stores.js';
import { peopleModule } from './people-module.js';
import { ALL_PEOPLE_PERMISSIONS } from './people-permissions.js';
import type { Clock, DisclosurePort, IdentifierDigestPort, PeopleStores } from './people-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness the module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the pipeline
 * is where tenancy and authorization are applied — a test that bypassed it would prove a handler
 * works for a caller who was never checked. That matters more here than in any previous module:
 * the redaction this module performs is driven by *what the caller holds*, so a test that skipped
 * the permission layer would be testing the unredacted path exclusively.
 *
 * The same `PermissionChecker` is given to the pipeline **and** to the dependencies, which is what
 * the composition root does, so a test granting a permission grants it in both places.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward, and fixed so nothing is flaky. */
export const testClock = {
  value: new Date('2026-08-06T09:00:00Z'),
  reset(): void {
    this.value = new Date('2026-08-06T09:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = ALL_PEOPLE_PERMISSIONS;

/** Dates the history tests share, so a reader can follow a name change across a suite. */
export const JANUARY = new Date('2026-01-01T00:00:00Z');
export const MARCH = new Date('2026-03-01T00:00:00Z');
export const JUNE = new Date('2026-06-01T00:00:00Z');
export const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

/**
 * A digest that is deterministic and obviously not a real one.
 *
 * The production adapter is a keyed HMAC. What the tests need is the *property* — the same type
 * and value always produce the same key, and a different value never does — and a fake that made
 * that property visible in a failure message is worth more here than a real hash nobody can read.
 */
export const testDigest: IdentifierDigestPort = {
  digest: (identifierType, normalizedValue) => `digest:${identifierType}:${normalizedValue}`,
};

/** Collects disclosures so a test can assert on the fact rather than on a mock call. */
export class RecordingDisclosureLog implements DisclosurePort {
  public readonly recorded: {
    readonly actor: string;
    readonly personId: string;
    readonly identifierType: string;
  }[] = [];

  public recordDisclosure(disclosure: {
    readonly tenantId: string;
    readonly actor: string;
    readonly personId: string;
    readonly identifierType: string;
    readonly at: Date;
  }): void {
    this.recorded.push({
      actor: disclosure.actor,
      personId: disclosure.personId,
      identifierType: disclosure.identifierType,
    });
  }
}

export interface Harness {
  readonly stores: PeopleStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
  readonly disclosures: RecordingDisclosureLog;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness =>
  harnessWithStores(tenantId, inMemoryPeopleStores(), granted);

/** A harness sharing an existing store, for the cross-tenant tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: PeopleStores,
  granted: readonly string[] = ALL,
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const permissions: PermissionChecker = permitting(...granted);
  const dispatcher = new Dispatcher(permissions);
  const disclosures = new RecordingDisclosureLog();
  // The same deferred seam the composition root uses, so import is exercised through the real
  // dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = { send: (command) => dispatcher.send(command) };
  const module = peopleModule(
    { unitOfWork: work, stores, permissions, digest: testDigest, disclosure: disclosures, clock },
    sender,
  );

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  for (const handler of module.eventHandlers ?? []) {
    work.events.register(handler);
  }
  return { stores, work, dispatcher, disclosures };
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

/** Creates a person and returns the identifier, which almost every test needs first. */
export const aPerson = async (
  harness: Harness,
  personNumber: string,
  legalName: Readonly<Record<string, string>> = { en: 'Sara Al-Amri', ar: 'سارة العامري' },
  extra: Readonly<Record<string, unknown>> = {},
): Promise<string> => {
  const created = await send<{ readonly personId: string }>(harness, {
    commandName: 'people.create-person',
    personNumber,
    legalName,
    ...extra,
  });

  if (!created.ok) throw new Error(`Could not create ${personNumber}: ${created.error.kind}`);
  return created.value.personId;
};
