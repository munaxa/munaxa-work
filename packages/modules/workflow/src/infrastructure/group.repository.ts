import { ConcurrencyException } from '@work/kernel';
import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ApprovalGroupMemberState, ApprovalGroupState } from '../domain/approval-group.js';
import type { ApprovalGroupStore, Page, Paged } from '../application/workflow-ports.js';
import {
  groupColumns,
  groupState,
  groupValues,
  memberColumns,
  memberState,
  memberValues,
  type GroupMemberRow,
  type GroupRow,
} from './workflow-group-rows.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * The lists a tenant keeps of who approves what, as two tables.
 *
 * One repository over both, because a member has no life outside the group it is on: it is created
 * against a group, read as part of one, and removed from one. There is no `search` over memberships
 * and no "which groups is this person on" — the second is the first question a directory answers,
 * and a group here is deliberately not a directory.
 *
 * **`membersOfAll` is one statement whatever the number of groups**, and that is the property this
 * class exists to guarantee. Starting an approval resolves every group the version names; a
 * per-group read would make raising one cost a query per list, so the identifiers go in as a single
 * `uuid[]` and PostgreSQL answers once. The plan suite asserts the shape rather than trusting the
 * comment.
 *
 * **Nothing here opens a transaction.** Every method takes the one the application's unit of work
 * established, so creating a group and putting three people on it is one commit or none.
 *
 * **Nothing here interprets a membership.** `membership_id` is Identity's identifier held as an
 * opaque value: no join, no lookup, no cross-module read, and no foreign key (ADR-0042).
 */
export class PostgresApprovalGroupRepository
  extends Repository<GroupRow & { version: number }>
  implements ApprovalGroupStore
{
  private readonly members = new PostgresGroupMemberRows();

  public constructor() {
    super('workflow_approval_group');
  }

  public async byId(transaction: Transaction, id: string): Promise<ApprovalGroupState | undefined> {
    const rows = await transaction.execute<GroupRow>(
      `select ${groupColumns('g')} from workflow_approval_group g
         where g.id = $1 and g.tenant_id = $2 and g.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : groupState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<ApprovalGroupState | undefined> {
    const rows = await transaction.execute<GroupRow>(
      `select ${groupColumns('g')} from workflow_approval_group g
         where g.code = $1 and g.tenant_id = $2 and g.deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : groupState(rows[0]);
  }

  /** Bounded, ordered by code then identifier, with the total counted over the same predicate. */
  public search(transaction: Transaction, paged: Paged): Promise<Page<ApprovalGroupState>> {
    const clause = 'g.tenant_id = $1 and g.deleted_at is null';

    return pageOf<GroupRow, ApprovalGroupState>(
      transaction,
      {
        select: `select ${groupColumns('g')} from workflow_approval_group g
                   where ${clause}
                   order by g.code, g.id
                   limit $2 offset $3`,
        count: `select count(*)::text as total from workflow_approval_group g where ${clause}`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      groupState,
    );
  }

  public insert(transaction: Transaction, state: ApprovalGroupState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_approval_group',
      groupValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public membersOf(
    transaction: Transaction,
    approvalGroupId: string,
  ): Promise<readonly ApprovalGroupMemberState[]> {
    return this.members.of(transaction, [approvalGroupId]);
  }

  public membersOfAll(
    transaction: Transaction,
    approvalGroupIds: readonly string[],
  ): Promise<readonly ApprovalGroupMemberState[]> {
    return this.members.of(transaction, approvalGroupIds);
  }

  public insertMember(transaction: Transaction, state: ApprovalGroupMemberState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_approval_group_member',
      memberValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public memberById(
    transaction: Transaction,
    approvalGroupMemberId: string,
  ): Promise<ApprovalGroupMemberState | undefined> {
    return this.members.byId(transaction, approvalGroupMemberId);
  }

  public removeMember(transaction: Transaction, approvalGroupMemberId: string): Promise<void> {
    return this.members.remove(transaction, approvalGroupMemberId);
  }
}

/**
 * The member rows, as their own `Repository` so the soft delete comes from the base class.
 *
 * A private collaborator rather than a second exported store: the application asks for one
 * `ApprovalGroupStore`, and a separate member repository would be a handle through which somebody
 * could edit a list without going through the group it belongs to.
 */
class PostgresGroupMemberRows extends Repository<GroupMemberRow & { version: number }> {
  public constructor() {
    super('workflow_approval_group_member');
  }

  /**
   * Every member of every named group, in one read.
   *
   * `= any($1::uuid[])` rather than a loop or an `in` list built from the identifiers: the statement
   * is the same shape whatever the number of groups, so it plans once and the number of round trips
   * does not grow with how many lists a process happens to name.
   *
   * Ordered by group and then by membership so a snapshot is deterministic — two instances started
   * from one group produce their steps in the same sequence, which is what makes a step identifier
   * comparable between runs.
   *
   * **The join is not decoration.** A member row outlives the soft delete of the list it is on, and a
   * store that handed those back would answer about a group `byId` refuses to return — so an approval
   * could start from a list that no longer exists, with the people who used to be on it. The join
   * makes the two reads agree: no group, no members.
   */
  public async of(
    transaction: Transaction,
    approvalGroupIds: readonly string[],
  ): Promise<readonly ApprovalGroupMemberState[]> {
    if (approvalGroupIds.length === 0) return [];

    const rows = await transaction.execute<GroupMemberRow>(
      `select ${memberColumns('m')} from workflow_approval_group_member m
         join workflow_approval_group g
           on g.id = m.approval_group_id and g.tenant_id = m.tenant_id and g.deleted_at is null
         where m.approval_group_id = any($1::uuid[]) and m.tenant_id = $2
           and m.deleted_at is null
         order by m.approval_group_id, m.membership_id`,
      [[...approvalGroupIds], transaction.tenantId],
    );

    return rows.map(memberState);
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ApprovalGroupMemberState | undefined> {
    const rows = await transaction.execute<GroupMemberRow>(
      `select ${memberColumns('m')} from workflow_approval_group_member m
         where m.id = $1 and m.tenant_id = $2 and m.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : memberState(rows[0]);
  }

  /**
   * Taking somebody off a list — the one removal in this module.
   *
   * **Soft, because the schema is built for it.** `workflow_approval_group_member_idx` is partial on
   * `deleted_at is null`, which is precisely what lets somebody removed today be added again
   * tomorrow; a hard delete would work as well until the day somebody wanted the row back, and every
   * other table in this repository keeps its history.
   *
   * The version is read rather than taken from the caller because the application's contract does not
   * carry one: removing a person from a list is not a contended edit, and the two administrators who
   * remove the same person at the same instant produce one soft delete and one
   * `ConcurrencyException` rather than a silent second write.
   */
  public async remove(transaction: Transaction, id: string): Promise<void> {
    const held = await this.byId(transaction, id);

    if (held === undefined) throw new ConcurrencyException(this.table, -1, -1);

    await this.softDeleteRow(transaction, id, held.version);
  }
}
