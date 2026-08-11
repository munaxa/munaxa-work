import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryPerformanceStores } from './in-memory-stores.js';
import { performanceModule } from './performance-module.js';
import { ALL_PERFORMANCE_PERMISSIONS } from './performance-permissions.js';
import {
  documentsUnavailable,
  type Clock,
  type DocumentReferencePort,
  type EmploymentFacts,
  type EmploymentPort,
  type NotificationIntentPort,
  type OrganizationPort,
} from './performance-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers, the real permission checker — and controllable doubles for the three cross-module reads
 * and the database.
 *
 * **Documents is not faked into working.** The default is `documentsUnavailable`, which is what
 * production has: no adapter, nothing resolvable. A suite that needs to prove a goal can *reference*
 * evidence installs `knownDocuments()`, which answers "yes, that identifier exists" and nothing
 * else. No test anywhere asserts that a file was fetched, because none can — `StoragePort` has no
 * implementation in this repository.
 *
 * **Notifications record and deliver nothing**, which is also what production has. The recorder is
 * inspectable so a suite can assert that an *intent* was created, and no suite asserts that anybody
 * was told, because nothing tells anybody (D-21).
 *
 * **The employment double answers the real contract**, including D-31's direct reports. It is
 * deliberately strict: an employment nobody registered does not exist, and a manager with no
 * registered reports has none. A permissive double here would hide precisely the authorization
 * defects the security suite exists to find.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-11T09:00:00Z');

export const HR = 'user:performance-hr';
export const MANAGER = 'user:performance-manager';
export const EMPLOYEE = 'user:performance-employee';
export const DIRECTOR = 'user:performance-director';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/**
 * Employment, as Employment would answer.
 *
 * `directReportsOf` is D-31's question, and the double answers it from the manager recorded on each
 * registered employment — the same relationship `employment.search` resolves from a reporting line.
 * The `limit` is honoured rather than ignored: a double that returned everything would let an
 * unbounded queue pass a test the production adapter would fail.
 */
export class FakeEmployment implements EmploymentPort {
  private readonly known = new Map<string, EmploymentFacts>();

  public add(facts: EmploymentFacts): void {
    this.known.set(facts.employmentId, facts);
  }

  public end(employmentId: string): void {
    const held = this.known.get(employmentId);

    if (held !== undefined)
      this.known.set(employmentId, { ...held, active: false, status: 'ended' });
  }

  public factsFor(employmentId: string): Promise<EmploymentFacts | undefined> {
    return Promise.resolve(this.known.get(employmentId));
  }

  public directReportsOf(
    managerEmploymentId: string,
    _asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]> {
    return Promise.resolve(
      [...this.known.values()]
        .filter((facts) => facts.managerEmploymentId === managerEmploymentId && facts.active)
        .slice(0, limit),
    );
  }

  public inUnit(
    organizationUnitId: string,
    _asOf: Date,
    limit: number,
  ): Promise<readonly EmploymentFacts[]> {
    return Promise.resolve(
      [...this.known.values()]
        .filter((facts) => facts.organizationUnitId === organizationUnitId && facts.active)
        .slice(0, limit),
    );
  }
}

export class FakeOrganization implements OrganizationPort {
  private readonly entities = new Map<string, string>();

  public govern(organizationUnitId: string, legalEntityId: string): void {
    this.entities.set(organizationUnitId, legalEntityId);
  }

  public governingLegalEntityOf(organizationUnitId: string): Promise<string | undefined> {
    return Promise.resolve(this.entities.get(organizationUnitId));
  }
}

/**
 * A document reference port that answers "that identifier exists".
 *
 * It resolves nothing, fetches nothing and returns no URL. Production has no adapter at all, and
 * this exists only so a suite can prove the *reference* path works without pretending storage does.
 */
export interface KnownDocuments extends DocumentReferencePort {
  add(documentId: string): void;
}

export const knownDocuments = (): KnownDocuments => {
  const known = new Set<string>();

  return {
    add: (documentId) => known.add(documentId),
    exists: (documentId) => Promise.resolve(known.has(documentId)),
  };
};

export interface RecordedIntent {
  readonly templateKey: string;
  readonly recipients: readonly string[];
}

/** Records what would have been sent. Nothing is sent; that is the whole point (D-21). */
export interface RecordingNotifications extends NotificationIntentPort {
  readonly recorded: readonly RecordedIntent[];
}

export const recordingNotifications = (): RecordingNotifications => {
  const recorded: RecordedIntent[] = [];

  return {
    recorded,
    intend: (request) => {
      recorded.push({ templateKey: request.templateKey, recipients: request.recipients });
      return Promise.resolve();
    },
  };
};

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employment: FakeEmployment;
  readonly organization: FakeOrganization;
  readonly documents: KnownDocuments;
  readonly notifications: RecordingNotifications;
  readonly stores: ReturnType<typeof inMemoryPerformanceStores>;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
  inTenant<TResult>(
    tenantId: string,
    actor: string,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly documents?: DocumentReferencePort;
  readonly tenantId?: string;
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_PERFORMANCE_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const employment = new FakeEmployment();
  const organization = new FakeOrganization();
  const documents = knownDocuments();
  const notifications = recordingNotifications();
  const stores = inMemoryPerformanceStores();
  const tenantId = options.tenantId ?? TENANT;
  const module = performanceModule({
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores,
    employment,
    organization,
    documents: options.documents ?? documents,
    notifications,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    employment,
    organization,
    documents,
    notifications,
    stores,
    as: (actor, work) => runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
    inTenant: (otherTenant, actor, work) =>
      runInContext({ tenantId: otherTenant, correlationId: uuidV7(), actor }, work),
  };
};

/** The default: production has no document adapter, so neither does the default harness. */
export const withoutDocuments = documentsUnavailable;

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

/** The reason a refusal gives, for assertions that care which rule refused. */
export const reasonOf = (result: Result<unknown, HandlerFailure>): string => {
  if (result.ok) return 'accepted';
  if (result.error.kind === 'rejected') return result.error.reason;
  if (result.error.kind === 'conflict') return result.error.reason;
  if (result.error.kind === 'not_found') return `not_found:${result.error.resource}`;
  if (result.error.kind === 'forbidden') return `forbidden:${result.error.permission}`;
  return 'validation';
};
