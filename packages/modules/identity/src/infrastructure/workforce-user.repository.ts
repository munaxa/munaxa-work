import { ConcurrencyException, type Transaction } from '@work/kernel';
import { auditForUpdate } from '@work/persistence';

import type { WorkforceUserStore } from '../application/identity-ports.js';
import type { WorkforceUserState } from '../domain/workforce-user.js';
import type { WorkforceUserStatus } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

/**
 * The one repository in this product that does not filter by tenant, because the one table in
 * this product that has no tenant is the one it reads (ADR-0033).
 *
 * It therefore does not extend the shared `Repository` base: that base's contract is "every
 * read is tenant-filtered", and a subclass that quietly did not would make the base's guarantee
 * a lie for every other repository that relies on it. The exception is explicit, local and
 * visible in the type, rather than a flag on something general.
 *
 * The isolation that does apply is the database's: `workforce_user` carries a row-level security
 * policy permitting only rows reachable from a membership of the current tenant. So a query
 * written here that "forgot" the tenant still cannot see a person this tenant has never
 * admitted — which is the property that makes a tenant-less table safe rather than merely
 * convenient.
 */

interface WorkforceUserRow {
  readonly id: string;
  readonly platform_user_id: string;
  readonly status: string;
  readonly version: number | string;
}

const toState = (row: WorkforceUserRow): WorkforceUserState => ({
  id: row.id,
  platformUserId: row.platform_user_id,
  status: row.status as WorkforceUserStatus,
  version: asVersion(row.version),
});

const TABLE = 'workforce_user';

export class WorkforceUserRepository implements WorkforceUserStore {
  public async byId(transaction: Transaction, id: string): Promise<WorkforceUserState | undefined> {
    const rows = await transaction.execute<WorkforceUserRow>(
      `select id, platform_user_id, status, version from ${TABLE}
       where id = $1 and deleted_at is null`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /**
   * The lookup every authenticated request begins with. It is indexed uniquely on
   * `platform_user_id` because it runs before anything else the request does, on every request.
   */
  public async byPlatformUserId(
    transaction: Transaction,
    platformUserId: string,
  ): Promise<WorkforceUserState | undefined> {
    const rows = await transaction.execute<WorkforceUserRow>(
      `select id, platform_user_id, status, version from ${TABLE}
       where platform_user_id = $1 and deleted_at is null`,
      [platformUserId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async insert(transaction: Transaction, state: WorkforceUserState): Promise<void> {
    await insertRow(
      transaction,
      TABLE,
      { id: state.id, platform_user_id: state.platformUserId, status: state.status },
      new Date(),
    );
  }

  /**
   * Writes the version it read, in the `where` clause rather than after a preceding check.
   * A read followed by a write is two statements with a gap between them, and the gap is where
   * one administrator's suspension silently erases another's.
   */
  public async update(
    transaction: Transaction,
    state: WorkforceUserState,
    expected: number,
  ): Promise<void> {
    const audit = auditForUpdate(new Date());
    const rows = await transaction.execute<{ version: number }>(
      `update ${TABLE}
          set status = $3, updated_at = $4, updated_by = $5, version = version + 1
        where id = $1 and version = $2 and deleted_at is null
        returning version`,
      [state.id, expected, state.status, audit.updated_at, audit.updated_by],
    );

    if (rows.length === 0) {
      const current = await this.byId(transaction, state.id);
      throw new ConcurrencyException(TABLE, expected, current?.version ?? -1);
    }
  }
}
