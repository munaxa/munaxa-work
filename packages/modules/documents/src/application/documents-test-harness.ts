import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryDocumentsStores } from './in-memory-stores.js';
import { documentsModule } from './documents-module.js';
import { ALL_DOCUMENTS_PERMISSIONS } from './documents-permissions.js';
import {
  storageUnavailable,
  type Clock,
  type IdentifierFacts,
  type OwnerDirectoryPort,
  type PersonIdentifierPort,
  type StorageAccessPort,
} from './documents-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and controllable fakes for the two cross-module reads and the database.
 *
 * **Storage is not faked.** The default is `storageUnavailable`, which is what production has: no
 * adapter, no URL, `available: false`. A suite that wants to prove the *authorization order* can
 * install `respondingStorage()`, which is a recording double for the port and still not an object
 * store — it returns a marker string so a test can assert a URL was requested only after the access
 * was recorded. No test anywhere asserts that a real file was fetched, because none can be.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-11T09:00:00Z');

export const ADMINISTRATOR = 'user:documents-administrator';
export const VERIFIER = 'user:documents-verifier';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/** Who exists, as the owning modules would answer. An owner absent here is refused, not invented. */
export class FakeOwners implements OwnerDirectoryPort {
  private readonly known = new Set<string>();

  public add(ownerType: string, ownerId: string): void {
    this.known.add(`${ownerType}:${ownerId}`);
  }

  public exists(ownerType: string, ownerId: string): Promise<boolean> {
    return Promise.resolve(this.known.has(`${ownerType}:${ownerId}`));
  }
}

/**
 * People's identifier facts, as People would answer them.
 *
 * The D-1a boundary made testable: a suite changes the expiry *here*, and the document's view moves
 * with it — which is the property that matters, because Documents stores no copy of it.
 */
export class FakeIdentifiers implements PersonIdentifierPort {
  private readonly facts = new Map<string, IdentifierFacts>();

  public set(personId: string, facts: IdentifierFacts): void {
    this.facts.set(`${personId}:${facts.personIdentifierId}`, facts);
  }

  public factsFor(
    personId: string,
    personIdentifierId: string,
  ): Promise<IdentifierFacts | undefined> {
    return Promise.resolve(this.facts.get(`${personId}:${personIdentifierId}`));
  }
}

/**
 * A storage port that answers, for the suites that assert the authorization *order*.
 *
 * It records what it was asked for and returns a marker, never a URL that resolves to anything. It
 * is not an object store and does not pretend to be one; the default harness has no storage at all.
 */
export interface RecordingStorage extends StorageAccessPort {
  readonly requested: readonly string[];
}

export const respondingStorage = (): RecordingStorage => {
  const requested: string[] = [];

  return {
    available: true,
    requested,
    signedUrl: (request) => {
      requested.push(request.storageReference);
      return Promise.resolve(`signed-url-double:${request.storageReference}`);
    },
  };
};

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly owners: FakeOwners;
  readonly identifiers: FakeIdentifiers;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly storage?: StorageAccessPort;
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_DOCUMENTS_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const owners = new FakeOwners();
  const identifiers = new FakeIdentifiers();
  const module = documentsModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores: inMemoryDocumentsStores(),
    owners,
    identifiers,
    storage: options.storage ?? storageUnavailable,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    owners,
    identifiers,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.send(command as never);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const tryAsk = (
  harness: Harness,
  query: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.ask(query as never);
