import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addApprovalGroupMember, createApprovalGroup } from '../domain/approval-group.js';
import type { LocalizedName } from '../domain/workflow-vocabulary.js';
import { conflicted, notFound, refusedBy } from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * The lists a tenant keeps of who approves what.
 *
 * **Three named commands and no `updateGroup`.** Naming a list, putting somebody on it and taking
 * somebody off it are three acts with three different consequences, and a generic mutation carrying
 * a members array would make "replace the finance approvers" a single unreviewable write in which
 * nobody could tell afterwards who had been removed.
 *
 * **A group has no lifecycle**, so there is no activate, no archive and no status command here. It
 * is a list; a list nobody wants any more has its members removed. Inventing `active | archived`
 * would add a vocabulary and a transition table to express something nobody asked for.
 *
 * **Editing a group cannot reach an approval already running.** Group membership is resolved once,
 * when an instance starts, and copied onto its steps — so nothing in this file can change who is
 * being asked to decide something today. That is AD-003 applied to the one thing that could
 * otherwise move underneath a live approval, and `instance.use-case.ts` is where the snapshot is
 * taken.
 *
 * **`workflow.group.manage` is its own permission and `workflow.definition.manage` does not imply
 * it.** Whoever may edit a group changes who approves, which is a different authority from writing
 * the process itself.
 */

export interface CreateApprovalGroupCommand extends Command {
  readonly commandName: 'workflow.create-approval-group';
  readonly code: string;
  readonly name: LocalizedName;
}

export interface ApprovalGroupCreated {
  readonly approvalGroupId: string;
}

/**
 * Naming a list.
 *
 * It starts **empty** and is deliberately allowed to: a tenant names the group before filling it,
 * exactly as a definition exists before its steps do. What is refused is *using* an empty one — an
 * instance that would start with a branch nobody was asked to decide is refused at the start, where
 * the emptiness actually matters.
 *
 * The code's uniqueness is the index's. The pre-read here turns the collision into a conflict a
 * caller can read, and the index is what settles two administrators naming the same list at once.
 */
export const createApprovalGroupHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<CreateApprovalGroupCommand, ApprovalGroupCreated> => ({
  commandName: 'workflow.create-approval-group',
  permission: WorkflowPermissions.groupManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const made = createApprovalGroup({
        approvalGroupId: uuidV7(),
        code: command.code,
        name: command.name,
      });

      if (!made.ok) return refusedBy(made.error);

      const taken = await dependencies.stores.groups.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted('workflow_approval_group_code_taken');

      await dependencies.stores.groups.insert(transaction, made.value);
      return success({ approvalGroupId: made.value.approvalGroupId });
    }),
});

export interface AddGroupMemberCommand extends Command {
  readonly commandName: 'workflow.add-group-member';
  readonly approvalGroupId: string;
  /** A membership identifier. Opaque here: Identity owns membership, and nothing resolves one. */
  readonly membershipId: string;
}

export interface GroupMemberAdded {
  readonly approvalGroupMemberId: string;
}

/**
 * Putting somebody on a list.
 *
 * **The membership is taken as given and never resolved.** Workflow does not ask Identity whether
 * this person exists, holds a position or reports to anybody: an approver is a membership named
 * individually, and a lookup here would be the first half of the directory this product has
 * committed not to build. A membership that does not exist produces a group nobody can be asked
 * from, which surfaces at instance start rather than as a cross-module read on every edit.
 *
 * One row per membership per group is the index's, for the reason the domain states and deliberately
 * does not check: two administrators can add the same person in the same instant, and a
 * read-then-write check would let both through.
 */
export const addGroupMemberHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<AddGroupMemberCommand, GroupMemberAdded> => ({
  commandName: 'workflow.add-group-member',
  permission: WorkflowPermissions.groupManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const group = await dependencies.stores.groups.byId(transaction, command.approvalGroupId);

      if (group === undefined) return notFound('workflow-approval-group');

      const added = addApprovalGroupMember(group, {
        approvalGroupMemberId: uuidV7(),
        membershipId: command.membershipId,
        at: dependencies.clock.now(),
      });

      if (!added.ok) return refusedBy(added.error);

      const already = await dependencies.stores.groups.membersOf(
        transaction,
        command.approvalGroupId,
      );

      if (already.some((member) => member.membershipId === command.membershipId)) {
        return conflicted('workflow_approval_group_member_taken');
      }

      await dependencies.stores.groups.insertMember(transaction, added.value);
      return success({ approvalGroupMemberId: added.value.approvalGroupMemberId });
    }),
});

export interface RemoveGroupMemberCommand extends Command {
  readonly commandName: 'workflow.remove-group-member';
  readonly approvalGroupMemberId: string;
}

/**
 * Taking somebody off a list.
 *
 * **This is the one thing this module removes**, and the contrast is the point: a decision and a
 * history entry have no removal anywhere — not in a store, not in a repository, not at the table,
 * where a trigger refuses it — because an edited decision is not evidence. A group is not evidence.
 * It is a list of who to ask next time, and an organization edits it.
 *
 * It reaches nothing already running. Every approval under way holds its own copy of the approvers
 * it was started with, so somebody removed today keeps the step they were asked to decide
 * yesterday — which is the honest outcome: they *were* asked, and the timeline says so.
 */
export const removeGroupMemberHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<RemoveGroupMemberCommand, { readonly removed: true }> => ({
  commandName: 'workflow.remove-group-member',
  permission: WorkflowPermissions.groupManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const member = await dependencies.stores.groups.memberById(
        transaction,
        command.approvalGroupMemberId,
      );

      if (member === undefined) return notFound('workflow-approval-group-member');

      await dependencies.stores.groups.removeMember(transaction, command.approvalGroupMemberId);
      return success({ removed: true as const });
    }),
});
