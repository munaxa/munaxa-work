import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PortalAssignmentStore } from '../application/identity-ports.js';
import type { PortalAssignmentState } from '../domain/portal-assignment.js';
import type { PortalAssignmentStatus, PortalKey } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface PortalRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly portal: string;
  readonly status: string;
  readonly granted_at: Date;
  readonly revoked_at: Date | null;
  readonly version: number | string;
}

const COLUMNS = 'id, tenant_id, membership_id, portal, status, granted_at, revoked_at, version';

const toState = (row: PortalRow): PortalAssignmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  membershipId: row.membership_id,
  portal: row.portal as PortalKey,
  status: row.status as PortalAssignmentStatus,
  grantedAt: row.granted_at,
  ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  version: asVersion(row.version),
});

export class PortalAssignmentRepository
  extends Repository<PortalRow & { id: string; version: number }>
  implements PortalAssignmentStore
{
  public constructor() {
    super('portal_assignment');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<PortalAssignmentState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /**
   * One row per member per portal, granted or revoked. Revoking does not delete it, so this
   * finds the revoked row too and re-grants it rather than accumulating a second history.
   */
  public async forMembershipAndPortal(
    transaction: Transaction,
    membershipId: string,
    portal: PortalKey,
  ): Promise<PortalAssignmentState | undefined> {
    const rows = await transaction.execute<PortalRow>(
      `select ${COLUMNS} from portal_assignment
        where tenant_id = $1 and membership_id = $2 and portal = $3 and deleted_at is null`,
      [transaction.tenantId, membershipId, portal],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<readonly PortalAssignmentState[]> {
    const rows = await transaction.execute<PortalRow>(
      `select ${COLUMNS} from portal_assignment
        where tenant_id = $1 and membership_id = $2 and deleted_at is null
        order by portal`,
      [transaction.tenantId, membershipId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: PortalAssignmentState): Promise<void> {
    await insertRow(
      transaction,
      'portal_assignment',
      {
        id: state.id,
        tenant_id: state.tenantId,
        membership_id: state.membershipId,
        portal: state.portal,
        status: state.status,
        granted_at: state.grantedAt,
        revoked_at: state.revokedAt ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: PortalAssignmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      status: state.status,
      revoked_at: state.revokedAt ?? null,
    });
  }
}
