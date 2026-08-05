import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  createDomainEvent,
  runInContext,
  uuidV7,
  type DomainEvent,
  type EventHandler,
} from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresUnitOfWork } from './postgres-unit-of-work.js';

/**
 * Proves the three properties a Unit of Work exists to guarantee, against a real database:
 * the tenant is transaction-local, events publish only after commit, and a failure leaves
 * neither rows nor events behind.
 *
 * Never skipped in CI — a suite that quietly skips itself on the machine that gates merges
 * reports success for a property nobody checked.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error('Unit of Work tests require a database. Set TEST_DATABASE_URL.');
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('PostgresUnitOfWork', () => {
  let pool: Pool;
  let dispatcher: InProcessEventDispatcher;
  let unitOfWork: PostgresUnitOfWork;
  let published: DomainEvent[];

  const tenantId = uuidV7();
  const context = { tenantId, correlationId: uuidV7(), actor: 'user:tester' };

  const recorder = (eventName: string): EventHandler => ({
    eventName,
    handle: (event) => {
      published.push(event);
      return Promise.resolve();
    },
  });

  const anEvent = (eventName: string): DomainEvent =>
    createDomainEvent(
      { eventName, eventVersion: 1, payload: { ok: true }, occurredAt: new Date() },
      { aggregateType: 'Probe', aggregateId: uuidV7() },
      context,
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION });
    await pool.query('drop table if exists uow_probe');
    await pool.query('create table uow_probe (id uuid primary key, tenant_id uuid not null)');
  });

  beforeEach(() => {
    published = [];
    dispatcher = new InProcessEventDispatcher();
    unitOfWork = new PostgresUnitOfWork(pool, dispatcher);
  });

  afterAll(async () => {
    await pool.query('drop table if exists uow_probe');
    await pool.end();
  });

  it('sets the tenant for the transaction', async () => {
    const observed = await runInContext(context, async () =>
      unitOfWork.execute(async (transaction) => {
        const rows = await transaction.execute<{ tenant: string | null }>(
          `select current_setting('app.tenant_id', true) as tenant`,
        );
        return rows[0]?.tenant;
      }),
    );

    expect(observed).toBe(tenantId);
  });

  it('releases the tenant setting with the transaction, so a pooled connection cannot carry it', async () => {
    await runInContext(context, async () => unitOfWork.execute(() => Promise.resolve(null)));

    // A fresh checkout of the same pool must not see the previous transaction's tenant.
    const result = await pool.query<{ tenant: string | null }>(
      `select current_setting('app.tenant_id', true) as tenant`,
    );

    expect(result.rows[0]?.tenant === null || result.rows[0]?.tenant === '').toBe(true);
  });

  it('refuses to run outside a tenant context', async () => {
    await expect(unitOfWork.execute(() => Promise.resolve(null))).rejects.toThrow(
      /no tenant context/,
    );
  });

  it('publishes collected events after the transaction commits', async () => {
    dispatcher.register(recorder('probe.created'));

    await runInContext(context, async () =>
      unitOfWork.execute(async (transaction) => {
        transaction.collect([anEvent('probe.created')]);
        await transaction.execute('insert into uow_probe values ($1, $2)', [uuidV7(), tenantId]);
        return null;
      }),
    );

    expect(published).toHaveLength(1);
    expect(published[0]?.eventName).toBe('probe.created');
  });

  it('publishes nothing when the transaction fails, and writes nothing either', async () => {
    dispatcher.register(recorder('probe.created'));
    const before = await pool.query<{ count: string }>('select count(*) from uow_probe');

    await expect(
      runInContext(context, async () =>
        unitOfWork.execute(async (transaction) => {
          transaction.collect([anEvent('probe.created')]);
          await transaction.execute('insert into uow_probe values ($1, $2)', [uuidV7(), tenantId]);
          throw new Error('business rule rejected this');
        }),
      ),
    ).rejects.toThrow('business rule rejected this');

    const after = await pool.query<{ count: string }>('select count(*) from uow_probe');

    expect(published).toHaveLength(0);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('does not publish before the commit — a handler cannot observe an uncommitted write', async () => {
    let rowsVisibleToHandler = -1;

    dispatcher.register({
      eventName: 'probe.created',
      handle: async () => {
        // Reading on a different connection: only committed rows are visible.
        const result = await pool.query<{ count: string }>('select count(*) from uow_probe');
        rowsVisibleToHandler = Number(result.rows[0]?.count ?? -1);
      },
    });

    const before = Number(
      (await pool.query<{ count: string }>('select count(*) from uow_probe')).rows[0]?.count ?? 0,
    );

    await runInContext(context, async () =>
      unitOfWork.execute(async (transaction) => {
        transaction.collect([anEvent('probe.created')]);
        await transaction.execute('insert into uow_probe values ($1, $2)', [uuidV7(), tenantId]);
        return null;
      }),
    );

    // The handler ran after commit, so it saw the row. Had it run inside the transaction it
    // would have seen the old count on this separate connection.
    expect(rowsVisibleToHandler).toBe(before + 1);
  });

  it('surfaces a handler failure without rolling back the committed write', async () => {
    dispatcher.register({
      eventName: 'probe.created',
      handle: () => Promise.reject(new Error('notification service is down')),
    });
    const before = Number(
      (await pool.query<{ count: string }>('select count(*) from uow_probe')).rows[0]?.count ?? 0,
    );

    await expect(
      runInContext(context, async () =>
        unitOfWork.execute(async (transaction) => {
          transaction.collect([anEvent('probe.created')]);
          await transaction.execute('insert into uow_probe values ($1, $2)', [uuidV7(), tenantId]);
          return null;
        }),
      ),
    ).rejects.toThrow(AggregateError);

    const after = Number(
      (await pool.query<{ count: string }>('select count(*) from uow_probe')).rows[0]?.count ?? 0,
    );

    // The fact happened and is durable. The notification did not, and the caller is told.
    expect(after).toBe(before + 1);
  });
});
