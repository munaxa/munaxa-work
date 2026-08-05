import type { DomainEvent } from '../domain/domain-event.js';

/**
 * One transaction, one tenant, one batch of events.
 *
 * The Unit of Work is where three rules meet, and it exists so no module has to remember any of
 * them:
 *
 * 1. **The tenant is set on the transaction**, not on the connection, so a pooled connection
 *    cannot carry one request's tenant into another's (ADR-0030).
 * 2. **Events publish after commit.** Recorded during the work, handed over only once the
 *    transaction is durable. A consumer never reacts to a change that rolled back.
 * 3. **Nothing partially applies.** Either every write and every event happens, or none does.
 *
 * The interface lives in the kernel and knows nothing about PostgreSQL, Prisma or any driver;
 * the adapter that does lives in infrastructure.
 */

/** The work to perform inside the transaction. Returns whatever the caller needs. */
export type TransactionalWork<TResult> = (transaction: Transaction) => Promise<TResult>;

/**
 * A handle to the open transaction. Repositories receive it; nothing else should hold one, and
 * nothing may keep one past the call that created it.
 */
export interface Transaction {
  readonly tenantId: string;
  /** Queues an event for publication after this transaction commits. */
  collect(events: readonly DomainEvent[]): void;
  /** Executes a statement inside the transaction. */
  execute<TRow>(statement: string, parameters?: readonly unknown[]): Promise<readonly TRow[]>;
}

export interface UnitOfWork {
  /**
   * Runs `work` in a transaction scoped to the current tenant, commits, and only then publishes
   * the events collected during it. A failure rolls back and publishes nothing.
   */
  execute<TResult>(work: TransactionalWork<TResult>): Promise<TResult>;
}

/** Receives events after the transaction that produced them has committed. */
export interface EventHandler<TPayload = unknown> {
  readonly eventName: string;
  handle(event: DomainEvent<TPayload>): Promise<void>;
}

export interface EventDispatcher {
  register(handler: EventHandler): void;
  dispatch(events: readonly DomainEvent[]): Promise<void>;
}
