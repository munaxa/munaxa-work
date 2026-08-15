import { success, type Query, type QueryHandler } from '@work/kernel';

import { membersOf } from '../domain/approval-group.js';
import type { ApprovalGroupDetailView, ApprovalGroupView } from '../contracts/views.js';
import { notFound } from './workflow-context.js';
import { pageOf } from './workflow-paging.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import { asGroupMemberView, asGroupView } from './workflow-views.js';
import type { Page } from './workflow-ports.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Reading the lists a tenant keeps.
 *
 * **Two reads and no third.** The groups, and one group with its members. There is no "which groups
 * is this membership on" — that is the question a directory answers, and answering it here would
 * make Workflow the place other modules came to ask who somebody is.
 *
 * **`group.read` is its own permission**, held separately from `group.manage`: a list of who
 * approves capital expenditure is worth reading without being able to change it, and the two
 * capabilities are different risks.
 *
 * The member list is **ordered by membership identifier and de-duplicated by the domain**, so two
 * reads of one group agree and a person who somehow appeared twice is shown once. Both are
 * `membersOf`'s doing; nothing is sorted or filtered here.
 */

export interface SearchApprovalGroups extends Query {
  readonly queryName: 'workflow.search-approval-groups';
  readonly page?: number;
  readonly size?: number;
}

export const searchApprovalGroupsHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<SearchApprovalGroups, Page<ApprovalGroupView>> => ({
  queryName: 'workflow.search-approval-groups',
  permission: WorkflowPermissions.groupRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.groups.search(transaction, pageOf(query));

      // Bounded, and the total counted by the store rather than taken from this page's length.
      // Members are not read here: a list of twenty groups would otherwise be twenty-one reads, and
      // a group's membership is what the detail read is for.
      return success({ items: found.items.map(asGroupView), total: found.total });
    }),
});

export interface ReadApprovalGroup extends Query {
  readonly queryName: 'workflow.read-approval-group';
  readonly approvalGroupId: string;
}

/**
 * One group, with the memberships on it.
 *
 * Two store reads whatever the size of the list. The members are not paged, and that is a stated
 * limit rather than an oversight: a group is a list a person maintains by hand, and the branch it
 * expands into is asked all at once — a group large enough to need paging here would produce a
 * branch nobody could read either. If one ever does, the page belongs on both.
 */
export const readApprovalGroupHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<ReadApprovalGroup, ApprovalGroupDetailView> => ({
  queryName: 'workflow.read-approval-group',
  permission: WorkflowPermissions.groupRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const group = await dependencies.stores.groups.byId(transaction, query.approvalGroupId);

      if (group === undefined) return notFound('workflow-approval-group');

      const held = await dependencies.stores.groups.membersOf(transaction, query.approvalGroupId);
      // The domain's order and the domain's de-duplication, read back out. `membersOf` returns the
      // membership identifiers; the rows are then presented in that order, so what a screen shows
      // and what an instance start would ask are the same list in the same sequence.
      const ordered = membersOf(held);
      const rowOf = new Map(held.map((member) => [member.membershipId, member]));

      return success({
        group: asGroupView(group),
        members: ordered
          .map((membershipId) => rowOf.get(membershipId))
          .filter((member): member is (typeof held)[number] => member !== undefined)
          .map(asGroupMemberView),
      });
    }),
});
