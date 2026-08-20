import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addStep } from '../domain/definition.js';
import { definedOf } from '../domain/defined.js';
import { serviceLevelTarget } from '../domain/service-level.js';
import type { BranchCondition } from '../domain/condition.js';
import type { ApproverKind, BranchRule, LocalizedName } from '../domain/workflow-vocabulary.js';
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
  /** Exactly one of these two. A person, or a list Workflow keeps. Neither, for a manager. */
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  /**
   * `manager`, and nothing else — the one kind that cannot be derived from an identifier.
   *
   * Every other kind is inferred from which approver field the caller filled in, because a caller who
   * could send the kind could send one that disagrees with the identifier beside it. A manager
   * template names **nobody**: whose manager it means is the requester and that is fixed rather than
   * configured (P-1), so there is no field it could be inferred from and it has to be stated. The
   * type admits one value, so `role` and `external` are unreachable here as they always were, and the
   * domain refuses this kind carrying either identifier.
   */
  readonly approverKind?: Extract<ApproverKind, 'manager'>;
  /**
   * How long this step is expected to take once it becomes awaiting. Absent means no due time.
   *
   * The unit is a `string` here rather than the domain's closed type, because a command is the
   * boundary an untrusted value arrives at: `serviceLevelTarget` is what turns it into a target or
   * into a refusal, and typing it narrowly would move that check to the caller's compiler.
   */
  readonly serviceLevel?: { readonly count: number; readonly unit: string };
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
 * **`approverKind` is derived from which approver the caller named — except for the one kind that
 * names nobody.** A caller who could send the kind freely could send one that disagrees with the
 * field they filled in, and the handler would have to pick a reading. Naming a group makes it a group
 * step; naming a person makes it a person step; naming both is refused by the domain, with a reason
 * that says which mistake it was. `manager` is the exception and has to be stated, because whose
 * manager it means is fixed rather than configured (P-1) and there is therefore no identifier to
 * infer it from — the field admits that one value and no other, so `role` and `external` remain
 * unreachable from this command exactly as they were.
 *
 * **A service-level target is checked here and stored as configuration.** Nothing schedules from it,
 * nothing fires when it passes, and no step becomes `expired`: what it buys is a question a reader
 * can ask later, answered from the target, the instant the step began waiting and an explicit reading
 * instant (D-16C-06).
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

      // Checked here, at the boundary an untrusted count and unit arrive at, rather than trusted into
      // a value object the domain would then have to re-check from a row.
      const configured = command.serviceLevel;
      const target =
        configured === undefined
          ? undefined
          : serviceLevelTarget(configured.count, configured.unit);

      if (target !== undefined && !target.ok) return refusedBy(target.error);

      const serviceLevel = target !== undefined && target.ok ? target.value : undefined;
      const added = addStep(version, {
        stepTemplateId: uuidV7(),
        ordinal: command.ordinal,
        name: command.name,
        approverKind: kindOf(command),
        ...definedOf({
          approverMembershipId: command.approverMembershipId,
          approverGroupId: command.approverGroupId,
          branchRule: command.branchRule,
          quorum: command.quorum,
          condition: command.condition,
          serviceLevel,
        }),
      });

      if (!added.ok) return refusedBy(added.error);

      await dependencies.stores.versions.insertTemplate(transaction, added.value);
      return success({ stepTemplateId: added.value.stepTemplateId });
    }),
});

/**
 * Which kind of approver this template names, from what the caller actually sent.
 *
 * `manager` is stated and the other two are derived, and the asymmetry is the point: a manager names
 * nobody, so there is nothing to derive it from. Naming a group *and* declaring a manager, or naming
 * a person *and* declaring one, both reach the domain as `manager` carrying an identifier — which is
 * refused with `step-approver-ambiguous` rather than resolved by precedence here.
 */
const kindOf = (command: AddStepCommand): ApproverKind => {
  if (command.approverKind === 'manager') return 'manager';
  return command.approverGroupId === undefined ? 'membership' : 'group';
};
