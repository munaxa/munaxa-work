import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type DomainEvent,
  type PermissionChecker,
  type Transaction,
  type TransactionalWork,
  type UnitOfWork,
} from '@work/kernel';

/**
 * Test doubles for the foundation.
 *
 * Shared rather than re-invented per module, because a fake that behaves subtly differently
 * from the real thing is worse than no fake: every test passes and the difference surfaces in
 * production. These fakes keep the properties that matter — events publish only on commit,
 * nothing survives a rollback — and drop only the database.
 */

/** Collects what was published, so a test can assert on facts rather than on mock calls. */
export class RecordingDispatcher extends InProcessEventDispatcher {
  public readonly published: DomainEvent[] = [];

  public override async dispatch(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    await super.dispatch(events);
  }

  public publishedNames(): readonly string[] {
    return this.published.map((event) => event.eventName);
  }
}

/**
 * An in-memory Unit of Work that keeps the commit semantics. Work that throws publishes
 * nothing, exactly as the PostgreSQL implementation behaves.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  public constructor(
    private readonly tenantId: string,
    private readonly dispatcher: RecordingDispatcher = new RecordingDispatcher(),
  ) {}

  public get events(): RecordingDispatcher {
    return this.dispatcher;
  }

  public async execute<TResult>(work: TransactionalWork<TResult>): Promise<TResult> {
    const collected: DomainEvent[] = [];
    const transaction: Transaction = {
      tenantId: this.tenantId,
      collect: (events) => collected.push(...events),
      execute: () => Promise.resolve([]),
    };

    const result = await work(transaction);
    await this.dispatcher.dispatch(collected);
    return result;
  }
}

export const allowAll: PermissionChecker = { holds: () => Promise.resolve(true) };
export const denyAll: PermissionChecker = { holds: () => Promise.resolve(false) };

/** Grants exactly the listed permissions, which is how a permission test should be written. */
export const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

/** Runs work inside a tenant context, for tests that do not care which tenant. */
export const inTestTenant = <TResult>(work: () => TResult, tenantId: string = uuidV7()): TResult =>
  runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:test' }, work);
