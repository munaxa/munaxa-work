import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { BlackoutState, PolicyAssignmentState } from '../domain/policy-assignment.js';
import type {
  AssignmentStore,
  BlackoutStore,
  LeaveTypeStore,
  PolicyStore,
} from '../application/leave-ports.js';

import {
  ASSIGNMENT_COLUMNS,
  BLACKOUT_COLUMNS,
  POLICY_COLUMNS,
  TYPE_COLUMNS,
  assignmentValues,
  blackoutValues,
  policyValues,
  toAssignment,
  toBlackout,
  toPolicy,
  toType,
  typeValues,
  type AssignmentRow,
  type BlackoutRow,
  type LeavePolicyRow,
  type LeaveTypeRow,
} from './definition-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The four definition tables, in PostgreSQL.
 *
 * `candidates` is the one worth reading. It returns **every** assignment that could govern an
 * employment on a date, across all four scopes, **unranked** — because most-specific-wins is a
 * domain rule and a query that applied it in SQL would put the rule in two places. The tenant-scoped
 * rows are matched separately from the identified ones, since a tenant assignment has no scope
 * identifier and `scope_id = any(...)` would never match it.
 */
export class LeaveTypeRepository
  extends Repository<{ id: string; version: number }>
  implements LeaveTypeStore
{
  public constructor() {
    super('leave_type');
  }

  public async byId(transaction: Transaction, id: string): Promise<LeaveTypeState | undefined> {
    const rows = await transaction.execute<LeaveTypeRow>(
      `select ${TYPE_COLUMNS} from leave_type t
        where t.id = $1 and t.tenant_id = $2 and t.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toType(row);
  }

  public async byCode(transaction: Transaction, code: string): Promise<LeaveTypeState | undefined> {
    const rows = await transaction.execute<LeaveTypeRow>(
      `select ${TYPE_COLUMNS} from leave_type t
        where t.tenant_id = $1 and t.code = $2 and t.deleted_at is null
        order by t.version_number desc limit 1`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toType(row);
  }

  public async all(transaction: Transaction): Promise<readonly LeaveTypeState[]> {
    const rows = await transaction.execute<LeaveTypeRow>(
      `select ${TYPE_COLUMNS} from leave_type t
        where t.tenant_id = $1 and t.deleted_at is null order by t.code, t.version_number`,
      [transaction.tenantId],
    );
    return rows.map(toType);
  }

  public async insert(transaction: Transaction, state: LeaveTypeState): Promise<void> {
    await insertRow(transaction, 'leave_type', typeValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: LeaveTypeState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(typeValues(state)));
  }
}

export class LeavePolicyRepository
  extends Repository<{ id: string; version: number }>
  implements PolicyStore
{
  public constructor() {
    super('leave_policy');
  }

  public async byId(transaction: Transaction, id: string): Promise<LeavePolicyState | undefined> {
    const rows = await transaction.execute<LeavePolicyRow>(
      `select ${POLICY_COLUMNS} from leave_policy p
        where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPolicy(row);
  }

  public async forType(
    transaction: Transaction,
    leaveTypeId: string,
  ): Promise<readonly LeavePolicyState[]> {
    const rows = await transaction.execute<LeavePolicyRow>(
      `select ${POLICY_COLUMNS} from leave_policy p
        where p.tenant_id = $1 and p.leave_type_id = $2 and p.deleted_at is null
        order by p.version_number desc`,
      [transaction.tenantId, leaveTypeId],
    );
    return rows.map(toPolicy);
  }

  public async all(transaction: Transaction): Promise<readonly LeavePolicyState[]> {
    const rows = await transaction.execute<LeavePolicyRow>(
      `select ${POLICY_COLUMNS} from leave_policy p
        where p.tenant_id = $1 and p.deleted_at is null order by p.code, p.version_number`,
      [transaction.tenantId],
    );
    return rows.map(toPolicy);
  }

  public async insert(transaction: Transaction, state: LeavePolicyState): Promise<void> {
    await insertRow(transaction, 'leave_policy', policyValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: LeavePolicyState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(policyValues(state)));
  }
}

export class PolicyAssignmentRepository
  extends Repository<{ id: string; version: number }>
  implements AssignmentStore
{
  public constructor() {
    super('leave_policy_assignment');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<PolicyAssignmentState | undefined> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from leave_policy_assignment a
        where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toAssignment(row);
  }

  /**
   * Every assignment that could govern these scopes on this date, unranked.
   *
   * The tenant scope is matched by its *name* rather than by an identifier, because a tenant-scoped
   * row has none — `scope_id = any($2)` would silently exclude the broadest assignment there is.
   */
  public async candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PolicyAssignmentState[]> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from leave_policy_assignment a
        where a.tenant_id = $1 and a.deleted_at is null
          and (a.scope = 'tenant' or a.scope_id = any($2::uuid[]))
          and a.effective_from <= $3::date
          and (a.effective_to is null or a.effective_to >= $3::date)`,
      [transaction.tenantId, scopeIds, onDate],
    );
    return rows.map(toAssignment);
  }

  public async forPolicy(
    transaction: Transaction,
    leavePolicyId: string,
  ): Promise<readonly PolicyAssignmentState[]> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from leave_policy_assignment a
        where a.tenant_id = $1 and a.leave_policy_id = $2 and a.deleted_at is null
        order by a.effective_from`,
      [transaction.tenantId, leavePolicyId],
    );
    return rows.map(toAssignment);
  }

  public async insert(transaction: Transaction, state: PolicyAssignmentState): Promise<void> {
    await insertRow(transaction, 'leave_policy_assignment', assignmentValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PolicyAssignmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(assignmentValues(state)));
  }
}

export class BlackoutRepository implements BlackoutStore {
  public async between(
    transaction: Transaction,
    from: string,
    to: string,
  ): Promise<readonly BlackoutState[]> {
    const rows = await transaction.execute<BlackoutRow>(
      `select ${BLACKOUT_COLUMNS} from leave_blackout b
        where b.tenant_id = $1 and b.deleted_at is null
          and b.from_date <= $3::date and b.to_date >= $2::date
        order by b.from_date`,
      [transaction.tenantId, from, to],
    );
    return rows.map(toBlackout);
  }

  public async insert(transaction: Transaction, state: BlackoutState): Promise<void> {
    await insertRow(transaction, 'leave_blackout', blackoutValues(state), new Date());
  }
}
