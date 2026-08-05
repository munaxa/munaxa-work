import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { EmploymentLinkStore } from '../application/identity-ports.js';
import type { EmploymentLinkState } from '../domain/employment-link.js';
import type { EmploymentLinkStatus } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface LinkRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly employment_id: string;
  readonly is_primary: boolean;
  readonly status: string;
  readonly linked_at: Date;
  readonly unlinked_at: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, membership_id, employment_id, is_primary, status, linked_at, unlinked_at, version';

const toState = (row: LinkRow): EmploymentLinkState => ({
  id: row.id,
  tenantId: row.tenant_id,
  membershipId: row.membership_id,
  employmentId: row.employment_id,
  isPrimary: row.is_primary,
  status: row.status as EmploymentLinkStatus,
  linkedAt: row.linked_at,
  ...(row.unlinked_at === null ? {} : { unlinkedAt: row.unlinked_at }),
  version: asVersion(row.version),
});

export class EmploymentLinkRepository
  extends Repository<LinkRow & { id: string; version: number }>
  implements EmploymentLinkStore
{
  public constructor() {
    super('employment_link');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<EmploymentLinkState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /** Every job this member holds or has held here. Concurrent employment is ordinary (AD-006). */
  public async forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<readonly EmploymentLinkState[]> {
    const rows = await transaction.execute<LinkRow>(
      `select ${COLUMNS} from employment_link
        where tenant_id = $1 and membership_id = $2 and deleted_at is null
        order by is_primary desc, linked_at desc`,
      [transaction.tenantId, membershipId],
    );
    return rows.map(toState);
  }

  /**
   * The incumbent primary, which the application service demotes before promoting another.
   *
   * The partial unique index makes two primaries impossible even if this read raced; this exists
   * so the demotion is an ordinary domain event rather than a caught constraint violation.
   */
  public async primaryFor(
    transaction: Transaction,
    membershipId: string,
  ): Promise<EmploymentLinkState | undefined> {
    const rows = await transaction.execute<LinkRow>(
      `select ${COLUMNS} from employment_link
        where tenant_id = $1 and membership_id = $2
          and is_primary and status = 'linked' and deleted_at is null`,
      [transaction.tenantId, membershipId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async insert(transaction: Transaction, state: EmploymentLinkState): Promise<void> {
    await insertRow(
      transaction,
      'employment_link',
      {
        id: state.id,
        tenant_id: state.tenantId,
        membership_id: state.membershipId,
        employment_id: state.employmentId,
        is_primary: state.isPrimary,
        status: state.status,
        linked_at: state.linkedAt,
        unlinked_at: state.unlinkedAt ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: EmploymentLinkState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      is_primary: state.isPrimary,
      status: state.status,
      unlinked_at: state.unlinkedAt ?? null,
    });
  }
}
