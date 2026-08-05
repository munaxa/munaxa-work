import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { MembershipQuery, TenantMembershipStore } from '../application/identity-ports.js';
import type { MembershipStatus } from '../domain/identity-vocabulary.js';
import type { TenantMembershipState } from '../domain/tenant-membership.js';

import { asVersion, insertRow } from './row-writer.js';

/**
 * Memberships, tenant-filtered in the query and tenant-isolated by the database beneath it.
 *
 * This is the table the request pipeline reads before it does anything else, so its shape is
 * driven by that: `tenant_membership_user_status_idx` covers "given this person, which tenants",
 * which is the only question asked on the hot path.
 */

interface MembershipRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly workforce_user_id: string;
  readonly status: string;
  readonly invited_at: Date | null;
  readonly joined_at: Date | null;
  readonly ended_at: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, workforce_user_id, status, invited_at, joined_at, ended_at, version';

const toState = (row: MembershipRow): TenantMembershipState => ({
  id: row.id,
  tenantId: row.tenant_id,
  workforceUserId: row.workforce_user_id,
  status: row.status as MembershipStatus,
  ...(row.invited_at === null ? {} : { invitedAt: row.invited_at }),
  ...(row.joined_at === null ? {} : { joinedAt: row.joined_at }),
  ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
  version: asVersion(row.version),
});

export class TenantMembershipRepository
  extends Repository<MembershipRow & { id: string; version: number }>
  implements TenantMembershipStore
{
  public constructor() {
    super('tenant_membership');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<TenantMembershipState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /** This person's membership of the tenant in context. At most one exists, by unique index. */
  public async byUser(
    transaction: Transaction,
    workforceUserId: string,
  ): Promise<TenantMembershipState | undefined> {
    const rows = await transaction.execute<MembershipRow>(
      `select ${COLUMNS} from tenant_membership
        where workforce_user_id = $1 and tenant_id = $2 and deleted_at is null`,
      [workforceUserId, transaction.tenantId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /**
   * The membership register, paged. Ordered by identifier, which is UUIDv7 and therefore orders
   * by creation — so "most recently admitted first" costs no extra column and no extra index.
   */
  public async list(
    transaction: Transaction,
    query: MembershipQuery,
  ): Promise<{ readonly items: readonly TenantMembershipState[]; readonly total: number }> {
    const scope = 'tenant_id = $1 and deleted_at is null';
    const filter = query.status === undefined ? '' : ' and status = $2';
    const scoped =
      query.status === undefined ? [transaction.tenantId] : [transaction.tenantId, query.status];

    const rows = await transaction.execute<MembershipRow>(
      `select ${COLUMNS} from tenant_membership
        where ${scope}${filter}
        order by id desc limit $${String(scoped.length + 1)} offset $${String(scoped.length + 2)}`,
      [...scoped, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: number | string }>(
      `select count(*)::int as total from tenant_membership where ${scope}${filter}`,
      scoped,
    );

    return { items: rows.map(toState), total: asVersion(counted[0]?.total ?? 0) };
  }

  public async insert(transaction: Transaction, state: TenantMembershipState): Promise<void> {
    await insertRow(
      transaction,
      'tenant_membership',
      {
        id: state.id,
        tenant_id: state.tenantId,
        workforce_user_id: state.workforceUserId,
        status: state.status,
        invited_at: state.invitedAt ?? null,
        joined_at: state.joinedAt ?? null,
        ended_at: state.endedAt ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: TenantMembershipState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      status: state.status,
      invited_at: state.invitedAt ?? null,
      joined_at: state.joinedAt ?? null,
      ended_at: state.endedAt ?? null,
    });
  }
}
