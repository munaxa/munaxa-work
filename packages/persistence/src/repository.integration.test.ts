import { Pool } from 'pg';
import {
  ConcurrencyException,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
} from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresUnitOfWork } from './postgres-unit-of-work.js';
import { Repository, auditForInsert } from './repository.js';

/** Proves the four properties the base class exists to guarantee, against a real database. */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error('Repository tests require a database. Set TEST_DATABASE_URL.');
}

interface ProbeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly label: string;
  readonly version: number;
  readonly deleted_at: Date | null;
}

class ProbeRepository extends Repository<ProbeRow> {
  public constructor() {
    super('repo_probe');
  }

  public async insert(transaction: Transaction, label: string): Promise<string> {
    const id = uuidV7();
    const audit = auditForInsert(new Date());

    await transaction.execute(
      `insert into repo_probe
         (id, tenant_id, label, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        transaction.tenantId,
        label,
        audit.created_at,
        audit.created_by,
        audit.updated_at,
        audit.updated_by,
        audit.deleted_at,
        audit.deleted_by,
        audit.version,
      ],
    );
    return id;
  }

  public find(transaction: Transaction, id: string): Promise<ProbeRow | undefined> {
    return this.findRow(transaction, id);
  }

  public findIncludingDeleted(transaction: Transaction, id: string): Promise<ProbeRow | undefined> {
    return this.findRow(transaction, id, { includeDeleted: true });
  }

  public rename(
    transaction: Transaction,
    id: string,
    label: string,
    version: number,
  ): Promise<number> {
    return this.updateRow(transaction, id, version, { label });
  }

  public remove(transaction: Transaction, id: string, version: number): Promise<void> {
    return this.softDeleteRow(transaction, id, version);
  }

  public restore(transaction: Transaction, id: string): Promise<void> {
    return this.restoreRow(transaction, id);
  }
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('Repository', () => {
  let pool: Pool;
  let unitOfWork: PostgresUnitOfWork;
  const repository = new ProbeRepository();
  const tenantId = uuidV7();
  const otherTenantId = uuidV7();
  const context = {
    tenantId,
    correlationId: uuidV7(),
    actor: 'user:tester',
    userId: 'user:auditor',
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION });
    await pool.query('drop table if exists repo_probe');
    await pool.query(`
      create table repo_probe (
        id uuid primary key,
        tenant_id uuid not null,
        label text not null,
        created_at timestamptz not null,
        created_by text not null,
        updated_at timestamptz not null,
        updated_by text not null,
        deleted_at timestamptz,
        deleted_by text,
        version integer not null
      )`);
  });

  beforeEach(() => {
    unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  });

  afterAll(async () => {
    await pool.query('drop table if exists repo_probe');
    await pool.end();
  });

  const inTenant = <T>(work: (transaction: Transaction) => Promise<T>, id = tenantId): Promise<T> =>
    runInContext({ ...context, tenantId: id }, () => unitOfWork.execute(work));

  it('writes audit columns without the caller supplying them', async () => {
    const row = await inTenant(async (transaction) => {
      const id = await repository.insert(transaction, 'first');
      return repository.find(transaction, id);
    });

    expect(row?.version).toBe(1);
    const stored = await pool.query<{ created_by: string }>(
      'select created_by from repo_probe where id = $1',
      [row?.id],
    );
    expect(stored.rows[0]?.created_by).toBe('user:auditor');
  });

  it('refuses a write from a stale version rather than overwriting it', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'original'));

    await inTenant((transaction) => repository.rename(transaction, id, 'first writer', 1));

    await expect(
      inTenant((transaction) => repository.rename(transaction, id, 'second writer', 1)),
    ).rejects.toThrow(ConcurrencyException);

    const row = await inTenant((transaction) => repository.find(transaction, id));
    expect(row?.label).toBe('first writer');
  });

  it('advances the version on every write', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'v1'));
    const version = await inTenant((transaction) => repository.rename(transaction, id, 'v2', 1));

    expect(version).toBe(2);
  });

  it('hides a soft deleted row from ordinary reads but keeps the data', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'to delete'));
    await inTenant((transaction) => repository.remove(transaction, id, 1));

    expect(await inTenant((transaction) => repository.find(transaction, id))).toBeUndefined();
    expect(
      await inTenant((transaction) => repository.findIncludingDeleted(transaction, id)),
    ).toMatchObject({ label: 'to delete' });
  });

  it('records who deleted, and restores what was deleted', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'recoverable'));
    await inTenant((transaction) => repository.remove(transaction, id, 1));

    const deleted = await pool.query<{ deleted_by: string }>(
      'select deleted_by from repo_probe where id = $1',
      [id],
    );
    expect(deleted.rows[0]?.deleted_by).toBe('user:auditor');

    await inTenant((transaction) => repository.restore(transaction, id));
    expect(await inTenant((transaction) => repository.find(transaction, id))).toBeDefined();
  });

  it('does not find another tenant is row, even by its exact identifier', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'tenant a'));

    const seen = await inTenant((transaction) => repository.find(transaction, id), otherTenantId);

    expect(seen).toBeUndefined();
  });

  it('cannot update another tenant is row', async () => {
    const id = await inTenant((transaction) => repository.insert(transaction, 'tenant a'));

    await expect(
      inTenant((transaction) => repository.rename(transaction, id, 'stolen', 1), otherTenantId),
    ).rejects.toThrow(ConcurrencyException);

    const row = await inTenant((transaction) => repository.find(transaction, id));
    expect(row?.label).toBe('tenant a');
  });
});
