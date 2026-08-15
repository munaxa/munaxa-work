import type { Transaction } from '@work/kernel';

import type { ApprovalGroupMemberState, ApprovalGroupState } from '../domain/approval-group.js';
import { byIdentifier, paged, refuseDuplicate } from './in-memory-tables.js';
import type { Paged, WorkflowStores } from './workflow-ports.js';

/**
 * The approval-group store the application suites run against.
 *
 * Split from `in-memory-stores.ts` at the file-size budget, along the seam the schema already has:
 * these are the two tables Phase 16B added, and the only ones in this module a row is ever deleted
 * from. The two indexes it stands for are `workflow_approval_group_code_idx` — one code per tenant —
 * and `workflow_approval_group_member_idx` — one row per membership per group.
 */

const sorted = <TState>(
  rows: readonly TState[],
  keyOf: (state: TState) => string,
): readonly TState[] => [...rows].sort(byIdentifier(keyOf));

/**
 * Groups and their members: two tables, one store, and the two indexes that arbitrate them.
 *
 * A code is unique per tenant and a membership appears once per group — both facts about a *set*,
 * both refused here exactly as `workflow_approval_group_code_idx` and
 * `workflow_approval_group_member_idx` refuse them.
 *
 * **A member is removed rather than kept**, which is the one place this module deletes anything. A
 * group is a list an organization edits; it is not an append-only fact, and the decisions and
 * history entries that *are* still have no removal anywhere in this file.
 */
export const approvalGroupStore = (): WorkflowStores['groups'] => {
  const groups = new Map<string, ApprovalGroupState>();
  const members = new Map<string, ApprovalGroupMemberState>();
  const membersIn = (approvalGroupId: string): readonly ApprovalGroupMemberState[] =>
    sorted(
      [...members.values()].filter((member) => member.approvalGroupId === approvalGroupId),
      (row) => row.membershipId,
    );

  return {
    byId: (_transaction: Transaction, id: string) => Promise.resolve(groups.get(id)),
    byCode: (_transaction: Transaction, code: string) =>
      Promise.resolve([...groups.values()].find((held) => held.code === code)),
    search: (_transaction: Transaction, page: Paged) =>
      Promise.resolve(
        paged(
          sorted([...groups.values()], (row) => row.approvalGroupId),
          page,
        ),
      ),
    insert: (_transaction: Transaction, state: ApprovalGroupState) => {
      refuseDuplicate(
        'workflow_approval_group_code_idx',
        [...groups.values()].some((held) => held.code === state.code),
      );
      groups.set(state.approvalGroupId, state);
      return Promise.resolve();
    },
    membersOf: (_transaction: Transaction, approvalGroupId: string) =>
      Promise.resolve(membersIn(approvalGroupId)),
    membersOfAll: (_transaction: Transaction, approvalGroupIds: readonly string[]) =>
      Promise.resolve(
        sorted(
          [...members.values()].filter((member) =>
            approvalGroupIds.includes(member.approvalGroupId),
          ),
          (row) => `${row.approvalGroupId}:${row.membershipId}`,
        ),
      ),
    insertMember: (_transaction: Transaction, state: ApprovalGroupMemberState) => {
      refuseDuplicate(
        'workflow_approval_group_member_idx',
        membersIn(state.approvalGroupId).some((held) => held.membershipId === state.membershipId),
      );
      members.set(state.approvalGroupMemberId, state);
      return Promise.resolve();
    },
    memberById: (_transaction: Transaction, approvalGroupMemberId: string) =>
      Promise.resolve(members.get(approvalGroupMemberId)),
    removeMember: (_transaction: Transaction, approvalGroupMemberId: string) => {
      members.delete(approvalGroupMemberId);
      return Promise.resolve();
    },
  };
};
