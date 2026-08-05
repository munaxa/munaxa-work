import type { Pool, PoolClient } from 'pg';
import {
  currentTenantId,
  type DomainEvent,
  type EventDispatcher,
  type Transaction,
  type TransactionalWork,
  type UnitOfWork,
} from '@work/kernel';

/**
 * The PostgreSQL Unit of Work.
 *
 * Everything that must be true of a write in this system is true here, once, so that no module
 * has to remember it:
 *
 * - The tenant is set with `set_config(..., true)` — transaction-local. On a pooled connection a
 *   session-level setting would survive the checkout and silently apply one request's tenant to
 *   the next request's queries, which is worse than having no row-level security at all,
 *   because it fails *open* and looks like it is working.
 * - Events are collected during the work and dispatched only after `commit` returns. Nothing
 *   outside can react to a change that then rolls back.
 * - A failure rolls back and dispatches nothing.
 *
 * Handler failures after commit do not roll anything back — they cannot, the transaction is
 * durable — so they surface as an error to the caller while the write stands. That is the honest
 * outcome: the business fact happened, and something downstream needs attention.
 */
export class PostgresUnitOfWork implements UnitOfWork {
  public constructor(
    private readonly pool: Pool,
    private readonly dispatcher: EventDispatcher,
  ) {}

  public async execute<TResult>(work: TransactionalWork<TResult>): Promise<TResult> {
    const tenantId = currentTenantId();
    const client = await this.pool.connect();
    const collected: DomainEvent[] = [];

    try {
      await client.query('begin');
      // Transaction-local: released at commit or rollback, never carried by the pooled
      // connection into whatever request checks it out next.
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);

      const result = await work(transactionFor(client, tenantId, collected));

      await client.query('commit');
      // Only now. Before this line the facts are not durable.
      await this.dispatcher.dispatch(collected);
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const transactionFor = (
  client: PoolClient,
  tenantId: string,
  collected: DomainEvent[],
): Transaction => ({
  tenantId,
  collect: (events) => {
    collected.push(...events);
  },
  execute: async <TRow>(statement: string, parameters: readonly unknown[] = []) => {
    const result = await client.query<Record<string, unknown>>(statement, [...parameters]);
    return result.rows as TRow[];
  },
});
