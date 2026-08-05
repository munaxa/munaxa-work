import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DelegationStore } from '../application/identity-ports.js';
import type { DelegationState } from '../domain/delegation.js';
import type { DelegationStatus } from '../domain/identity-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface DelegationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly delegator_membership_id: string;
  readonly delegate_membership_id: string;
  readonly scope: string;
  readonly effective_from: Date;
  readonly effective_to: Date;
  readonly status: string;
  readonly reason: string;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, delegator_membership_id, delegate_membership_id, scope, effective_from, ' +
  'effective_to, status, reason, version';

const toState = (row: DelegationRow): DelegationState => ({
  id: row.id,
  tenantId: row.tenant_id,
  delegatorMembershipId: row.delegator_membership_id,
  delegateMembershipId: row.delegate_membership_id,
  scope: row.scope,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  status: row.status as DelegationStatus,
  reason: row.reason,
  version: asVersion(row.version),
});

export class DelegationRepository
  extends Repository<DelegationRow & { id: string; version: number }>
  implements DelegationStore
{
  public constructor() {
    super('delegation');
  }

  public async byId(transaction: Transaction, id: string): Promise<DelegationState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /**
   * What this person may act on, on somebody else's behalf, at a given instant.
   *
   * Filtered by the period rather than by the status, because a status is only as fresh as the
   * last sweep that ran. An approval routed from a stale `active` is an approval given by
   * somebody whose cover ended yesterday, and the sweep being an hour behind must not be able to
   * cause that. `revoked` is excluded explicitly: revocation is a decision, not a clock.
   */
  public async forDelegate(
    transaction: Transaction,
    membershipId: string,
    atInstant: Date,
  ): Promise<readonly DelegationState[]> {
    const rows = await transaction.execute<DelegationRow>(
      `select ${COLUMNS} from delegation
        where tenant_id = $1 and delegate_membership_id = $2
          and status <> 'revoked'
          and effective_from <= $3 and effective_to > $3
          and deleted_at is null
        order by effective_from`,
      [transaction.tenantId, membershipId, atInstant],
    );
    return rows.map(toState);
  }

  /** What this person has delegated away — the register they are accountable for. */
  public async forDelegator(
    transaction: Transaction,
    membershipId: string,
  ): Promise<readonly DelegationState[]> {
    const rows = await transaction.execute<DelegationRow>(
      `select ${COLUMNS} from delegation
        where tenant_id = $1 and delegator_membership_id = $2 and deleted_at is null
        order by effective_from desc`,
      [transaction.tenantId, membershipId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: DelegationState): Promise<void> {
    await insertRow(
      transaction,
      'delegation',
      {
        id: state.id,
        tenant_id: state.tenantId,
        delegator_membership_id: state.delegatorMembershipId,
        delegate_membership_id: state.delegateMembershipId,
        scope: state.scope,
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo,
        status: state.status,
        reason: state.reason,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DelegationState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, { status: state.status });
  }
}
