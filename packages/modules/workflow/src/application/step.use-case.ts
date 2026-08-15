import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addStep } from '../domain/definition.js';
import { definedOf } from '../domain/defined.js';
import type { BranchCondition } from '../domain/condition.js';
import type { BranchRule, LocalizedName } from '../domain/workflow-vocabulary.js';
import { notFound, refusedBy } from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * One step of a version: who is asked, when in the order, and under what rule.
 *
 * Split from `definition.use-case.ts` at the file-size budget, along the seam Phase 16B created.
 * Every other configuration command touches one aggregate; this one reads a second — an approval
 * group — because a step may name a list rather than a person, and that is the whole of why it grew.
 */

export interface AddStepCommand extends Command {
  readonly commandName: 'workflow.add-step';
  readonly workflowVersionId: string;
  /** The branch this approver belongs to. Several steps may share one; all are asked at once. */
  readonly ordinal: number;
  readonly name: LocalizedName;
  /** Exactly one of these two. A person, or a list Workflow keeps. */
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  /** How this branch ends. Absent means `unanimous`, which is what every 16A step is. */
  readonly branchRule?: BranchRule;
  /** A minimum number of responses before the rule is evaluated. Absent means one. */
  readonly quorum?: number;
  /** What must hold for this branch to run at all. Absent means it always runs. */
  readonly condition?: readonly BranchCondition[];
}

/**
 * Adding a step to a draft.
 *
 * **`approverKind` is derived from which approver the caller named, never sent.** A caller who could
 * send the kind could send one that disagrees with the field they filled in, and the handler would
 * have to pick a reading. Naming a group makes it a group step; naming a person makes it a person
 * step; naming both or neither is refused by the domain, with a reason that says which mistake it
 * was. `role` is not reachable from this command at all — there is no field it could arrive in.
 *
 * **Ordinal uniqueness is gone, and its absence is the branch.** 16A refused a second step at one
 * ordinal because an ordinal was a position. It is now a branch: two approvers at ordinal 2 are two
 * people asked at the same moment, which is the whole of parallel approval. Contiguity of the
 * *distinct* ordinals is still checked, by the domain, when the version is published.
 *
 * **The group is checked to exist, and that check is not authorization.** A template naming a group
 * that is not there would publish and then refuse every approval started from it, which is a
 * configuration mistake found at the worst possible moment. Whether the group is *empty* is
 * deliberately not checked here: its membership at publication is not its membership when an
 * approval starts, and the empty case is refused where it actually matters.
 */
export const addStepHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<AddStepCommand, { readonly stepTemplateId: string }> => ({
  commandName: 'workflow.add-step',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const version = await dependencies.stores.versions.byId(
        transaction,
        command.workflowVersionId,
      );

      if (version === undefined) return notFound('workflow-version');

      if (command.approverGroupId !== undefined) {
        const group = await dependencies.stores.groups.byId(transaction, command.approverGroupId);

        if (group === undefined) return notFound('workflow-approval-group');
      }

      const added = addStep(version, {
        stepTemplateId: uuidV7(),
        ordinal: command.ordinal,
        name: command.name,
        approverKind: command.approverGroupId === undefined ? 'membership' : 'group',
        ...definedOf({
          approverMembershipId: command.approverMembershipId,
          approverGroupId: command.approverGroupId,
          branchRule: command.branchRule,
          quorum: command.quorum,
          condition: command.condition,
        }),
      });

      if (!added.ok) return refusedBy(added.error);

      await dependencies.stores.versions.insertTemplate(transaction, added.value);
      return success({ stepTemplateId: added.value.stepTemplateId });
    }),
});
