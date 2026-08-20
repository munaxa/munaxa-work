import {
  ConcurrencyException,
  currentContext,
  isMachineContext,
  isSystemContext,
  type AuditInformation,
  type Transaction,
} from '@work/kernel';

/**
 * The base every repository builds on.
 *
 * It exists so that four things are true of every table without any repository choosing to make
 * them true: the tenant is filtered, deleted rows stay hidden, audit columns are written, and a
 * write asserts the version it read.
 *
 * Repositories contain no business rules. This one contains no business vocabulary at all.
 */

export interface AuditColumns {
  readonly created_at: Date;
  readonly created_by: string;
  readonly updated_at: Date;
  readonly updated_by: string;
  readonly deleted_at: Date | null;
  readonly deleted_by: string | null;
  readonly version: number;
}

/**
 * The string every audit column records, for each of the three kinds of caller there are.
 *
 * A machine writes the subject the platform authenticated — `service:<clientId>`, `apikey:<keyId>`,
 * `system:<component>` — which is the same *shape* a system context already writes and deliberately
 * not the shape a person does. So "who wrote this row" is answerable for automatic work without a
 * membership existing anywhere, and a reader can tell the two apart at a glance rather than by
 * joining somewhere else to find out that the actor names nobody.
 */
const actorOf = (): string => {
  const context = currentContext();

  if (context === undefined) return 'system:unknown';
  if (isSystemContext(context)) return `system:${context.reason}`;
  if (isMachineContext(context)) return context.executionIdentity;
  return context.userId ?? context.actor;
};

/** Audit values for a new row. Written by infrastructure; a caller cannot supply them. */
export const auditForInsert = (now: Date): AuditColumns => ({
  created_at: now,
  created_by: actorOf(),
  updated_at: now,
  updated_by: actorOf(),
  deleted_at: null,
  deleted_by: null,
  version: 1,
});

export const auditForUpdate = (now: Date): Pick<AuditColumns, 'updated_at' | 'updated_by'> => ({
  updated_at: now,
  updated_by: actorOf(),
});

export abstract class Repository<TRow extends { id: string; version: number }> {
  protected constructor(protected readonly table: string) {}

  /**
   * Reads one row by identity. Soft-deleted rows are invisible: a deleted record that still
   * answers a lookup is how a terminated employee reappears in a payroll run.
   *
   * The tenant is filtered here *and* by row-level security. This filter makes the intent
   * legible in the query plan; the policy makes it true even if this line were ever wrong.
   */
  protected async findRow(
    transaction: Transaction,
    id: string,
    options: { readonly includeDeleted?: boolean } = {},
  ): Promise<TRow | undefined> {
    const deletedClause = options.includeDeleted === true ? '' : ' and deleted_at is null';
    const rows = await transaction.execute<TRow>(
      `select * from ${this.table} where id = $1 and tenant_id = $2${deletedClause}`,
      [id, transaction.tenantId],
    );
    return rows[0];
  }

  /**
   * Writes a row, refusing if it changed since it was read.
   *
   * The version predicate is in the `where` clause rather than a preceding read, because a read
   * followed by a write is two statements with a gap between them, and the gap is exactly where
   * the second approver's update disappears.
   */
  protected async updateRow(
    transaction: Transaction,
    id: string,
    expectedVersion: number,
    assignments: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    const fields: Record<string, unknown> = { ...assignments, ...auditForUpdate(new Date()) };
    const names = Object.keys(fields);
    const setClause = names
      .map((name, index) => `${name} = $${String(index + 4)}`)
      .concat('version = version + 1')
      .join(', ');

    const rows = await transaction.execute<{ version: number }>(
      `update ${this.table} set ${setClause}
       where id = $1 and tenant_id = $2 and version = $3 and deleted_at is null
       returning version`,
      [id, transaction.tenantId, expectedVersion, ...names.map((name) => fields[name])],
    );

    if (rows.length === 0) {
      const current = await this.findRow(transaction, id);
      throw new ConcurrencyException(this.table, expectedVersion, current?.version ?? -1);
    }
    return rows[0]?.version ?? expectedVersion + 1;
  }

  /**
   * Soft delete. There is no hard delete on this base class, deliberately: employment history,
   * payroll results and audit trails are evidence, and a system that can erase them cannot
   * answer for itself later.
   */
  protected async softDeleteRow(
    transaction: Transaction,
    id: string,
    expectedVersion: number,
  ): Promise<void> {
    const now = new Date();
    const rows = await transaction.execute<{ id: string }>(
      `update ${this.table}
         set deleted_at = $4, deleted_by = $5, updated_at = $4, updated_by = $5, version = version + 1
       where id = $1 and tenant_id = $2 and version = $3 and deleted_at is null
       returning id`,
      [id, transaction.tenantId, expectedVersion, now, actorOf()],
    );

    if (rows.length === 0) {
      const current = await this.findRow(transaction, id, { includeDeleted: true });
      throw new ConcurrencyException(this.table, expectedVersion, current?.version ?? -1);
    }
  }

  /** Restores a soft-deleted row, which is why deletion keeps the data rather than removing it. */
  protected async restoreRow(transaction: Transaction, id: string): Promise<void> {
    await transaction.execute(
      `update ${this.table}
         set deleted_at = null, deleted_by = null, updated_at = $3, updated_by = $4, version = version + 1
       where id = $1 and tenant_id = $2`,
      [id, transaction.tenantId, new Date(), actorOf()],
    );
  }
}

export const toAuditInformation = (row: AuditColumns): AuditInformation => ({
  createdAt: row.created_at,
  createdBy: row.created_by,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
  ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
  ...(row.deleted_by === null ? {} : { deletedBy: row.deleted_by }),
});
