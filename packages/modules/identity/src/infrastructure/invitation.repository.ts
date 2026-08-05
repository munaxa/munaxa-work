import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { InvitationQuery, InvitationStore } from '../application/identity-ports.js';
import type { InvitationState } from '../domain/invitation.js';
import type { InvitationStatus, PortalKey } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface InvitationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly email: string;
  readonly portals: readonly string[];
  readonly status: string;
  readonly issued_at: Date;
  readonly expires_at: Date;
  readonly accepted_at: Date | null;
  readonly accepted_by_workforce_user_id: string | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, email, portals, status, issued_at, expires_at, accepted_at, ' +
  'accepted_by_workforce_user_id, version';

const toState = (row: InvitationRow): InvitationState => ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  portals: row.portals as readonly PortalKey[],
  status: row.status as InvitationStatus,
  issuedAt: row.issued_at,
  expiresAt: row.expires_at,
  ...(row.accepted_at === null ? {} : { acceptedAt: row.accepted_at }),
  ...(row.accepted_by_workforce_user_id === null
    ? {}
    : { acceptedByWorkforceUserId: row.accepted_by_workforce_user_id }),
  version: asVersion(row.version),
});

export class InvitationRepository
  extends Repository<InvitationRow & { id: string; version: number }>
  implements InvitationStore
{
  public constructor() {
    super('invitation');
  }

  public async byId(transaction: Transaction, id: string): Promise<InvitationState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /**
   * The live invitation for an address, if there is one.
   *
   * Matched case-insensitively, against the same expression the partial unique index uses, so
   * the read and the constraint agree. They would otherwise disagree exactly once — when
   * somebody re-invites `Sara@` after `sara@` — and the insert would fail with a constraint
   * error the caller was told could not happen.
   */
  public async pendingForEmail(
    transaction: Transaction,
    email: string,
  ): Promise<InvitationState | undefined> {
    const rows = await transaction.execute<InvitationRow>(
      `select ${COLUMNS} from invitation
        where tenant_id = $1 and lower(email) = lower($2)
          and status = 'pending' and deleted_at is null`,
      [transaction.tenantId, email],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async list(
    transaction: Transaction,
    query: InvitationQuery,
  ): Promise<{ readonly items: readonly InvitationState[]; readonly total: number }> {
    const scope = 'tenant_id = $1 and deleted_at is null';
    const filter = query.status === undefined ? '' : ' and status = $2';
    const scoped =
      query.status === undefined ? [transaction.tenantId] : [transaction.tenantId, query.status];

    const rows = await transaction.execute<InvitationRow>(
      `select ${COLUMNS} from invitation
        where ${scope}${filter}
        order by id desc limit $${String(scoped.length + 1)} offset $${String(scoped.length + 2)}`,
      [...scoped, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: number | string }>(
      `select count(*)::int as total from invitation where ${scope}${filter}`,
      scoped,
    );

    return { items: rows.map(toState), total: asVersion(counted[0]?.total ?? 0) };
  }

  public async insert(transaction: Transaction, state: InvitationState): Promise<void> {
    await insertRow(
      transaction,
      'invitation',
      {
        id: state.id,
        tenant_id: state.tenantId,
        email: state.email,
        portals: [...state.portals],
        status: state.status,
        issued_at: state.issuedAt,
        expires_at: state.expiresAt,
        accepted_at: state.acceptedAt ?? null,
        accepted_by_workforce_user_id: state.acceptedByWorkforceUserId ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: InvitationState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      status: state.status,
      accepted_at: state.acceptedAt ?? null,
      accepted_by_workforce_user_id: state.acceptedByWorkforceUserId ?? null,
    });
  }
}
