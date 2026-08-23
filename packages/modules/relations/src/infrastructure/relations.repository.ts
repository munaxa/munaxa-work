import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import type {
  AccessEventStore,
  Page,
  Paged,
  ViolationCategoryStore,
  ViolationStore,
} from '../application/relations-ports.js';
import {
  violationCategoryState,
  violationCategoryValues,
  violationState,
  violationValues,
  VIOLATION_COLUMNS,
  accessEventValues,
  type ViolationCategoryRow,
  type ViolationRow,
} from './relation-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/**
 * The catalogue, the violations and the access trail, in PostgreSQL.
 *
 * **Two of the three repositories have no update and no delete**, and that is not an omission to be
 * filled in later: a disciplinary record and its access trail are evidence, and a class with no
 * method that could rewrite one is the cheapest guarantee that nothing does. The database refuses it
 * as well, with a trigger — this is the same rule stated where a developer meets it first.
 *
 * Every statement is bound to `transaction.tenantId`, and row-level security filters again beneath
 * it. Neither is the other's backup: the bind keeps a defect from reading across tenants, and RLS
 * keeps a *missing* bind from doing so.
 */

export class PostgresViolationCategoryRepository
  extends Repository<ViolationCategoryRow & { version: number }>
  implements ViolationCategoryStore
{
  public constructor() {
    super('relation_violation_category');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ViolationCategoryState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : violationCategoryState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<ViolationCategoryState | undefined> {
    const rows = await transaction.execute<ViolationCategoryRow>(
      `select * from relation_violation_category
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : violationCategoryState(rows[0]);
  }

  /**
   * Ordered by `(sequence, code)`.
   *
   * Two columns rather than one, so ordering is deterministic **without** forcing `sequence` to be
   * unique — a tenant inserting an entry between two others should not have to renumber its
   * catalogue, and two entries sharing a rank must still come back in the same order every time.
   */
  public async all(
    transaction: Transaction,
    includeInactive: boolean,
  ): Promise<readonly ViolationCategoryState[]> {
    const rows = await transaction.execute<ViolationCategoryRow>(
      `select * from relation_violation_category
         where tenant_id = $1 and deleted_at is null
           and ($2::boolean or active)
         order by sequence, code`,
      [transaction.tenantId, includeInactive],
    );

    return rows.map(violationCategoryState);
  }

  public insert(transaction: Transaction, state: ViolationCategoryState): Promise<void> {
    return insertRow(
      transaction,
      'relation_violation_category',
      violationCategoryValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: ViolationCategoryState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.violationCategoryId,
      expected,
      mutable(violationCategoryValues(state, transaction.tenantId)),
    );
  }
}

/**
 * Recorded violations. **Insert and read. There is no update and no delete.**
 *
 * `forEmployment` is the only collection read and it takes an employment, so nothing here can
 * enumerate a tenant's disciplinary matters at large. Ordered newest conduct first, then by
 * identifier so a page boundary never lands in the middle of two violations that share a date.
 */
export class PostgresViolationRepository implements ViolationStore {
  public async byId(transaction: Transaction, id: string): Promise<ViolationRecord | undefined> {
    const rows = await transaction.execute<ViolationRow>(
      `select ${VIOLATION_COLUMNS} from relation_violation
         where tenant_id = $1 and id = $2 and deleted_at is null`,
      [transaction.tenantId, id],
    );

    return rows[0] === undefined ? undefined : violationState(rows[0]);
  }

  /**
   * One employment's violations of one category, inside a civil-date window.
   *
   * **Bounded at the database by both ends of the window**, so a ten-year history is not loaded to
   * answer a question about six months of it. `between` is inclusive on both sides, which is the
   * boundary rule the domain states and the tests assert in both directions.
   *
   * Unpaged, and bounded by the window rather than by a limit: a page boundary in the middle of a
   * count would produce a smaller number rather than a truncated list, and a wrong count is worse
   * than a slow one. Ordered so the caller receives a deterministic sequence.
   */
  public async inCategoryWindow(
    transaction: Transaction,
    employmentId: string,
    violationCategoryId: string,
    window: { readonly from: string; readonly to: string },
  ): Promise<readonly ViolationRecord[]> {
    const rows = await transaction.execute<ViolationRow>(
      `select ${VIOLATION_COLUMNS} from relation_violation
         where tenant_id = $1 and employment_id = $2 and violation_category_id = $3
           and occurred_on between $4::date and $5::date
           and deleted_at is null
         order by occurred_on, id`,
      [transaction.tenantId, employmentId, violationCategoryId, window.from, window.to],
    );

    return rows.map(violationState);
  }

  public forEmployment(
    transaction: Transaction,
    employmentId: string,
    paged: Paged,
  ): Promise<Page<ViolationRecord>> {
    return pageOf<ViolationRow, ViolationRecord>(
      transaction,
      {
        select: `select ${VIOLATION_COLUMNS} from relation_violation
                   where tenant_id = $1 and employment_id = $2 and deleted_at is null
                   order by occurred_on desc, id desc
                   limit $3 offset $4`,
        count: `select count(*)::text as total from relation_violation
                  where tenant_id = $1 and employment_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, employmentId],
        limit: paged.limit,
        offset: paged.offset,
      },
      violationState,
    );
  }

  public insert(transaction: Transaction, state: ViolationRecord): Promise<void> {
    return insertRow(
      transaction,
      'relation_violation',
      violationValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

/** The access trail. **Insert only** — an audit table with an update method is not an audit table. */
export class PostgresAccessEventRepository implements AccessEventStore {
  public insert(transaction: Transaction, state: AccessEventState): Promise<void> {
    return insertRow(
      transaction,
      'relation_violation_access_event',
      accessEventValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
