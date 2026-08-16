import type { Transaction } from '@work/kernel';

import { membersOf } from '../domain/approval-group.js';
import { resolutionDateOf } from '../domain/manager.js';
import type { GroupSnapshot, ManagerSnapshot } from '../domain/branch-plan.js';
import type { WorkflowStepTemplateState } from '../domain/definition.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * The world as it stands at the instant an approval is raised, read once and copied.
 *
 * Two functions, one rule, and the rule is AD-003's: **an approval already under way follows the
 * facts it started on**. A group's membership and a requester's manager are both things an
 * organization edits, and both would otherwise change underneath a live approval — so each is read
 * exactly once, here, and copied onto the steps. From that moment neither is consulted again: editing
 * a list, emptying it, or reorganizing a reporting line changes nothing about who was asked, and "why
 * am I being asked this?" is answered by a step that exists rather than by how things stand today.
 *
 * Split out of `instance.use-case.ts` at the file-size budget, and the seam is a real one: everything
 * here is *reading the world before the domain plans*, while what is left there is the command, the
 * plan and the writes. The two snapshots are the same kind of act and belong beside each other.
 *
 * **Neither interprets what it read.** Both hand the answer to the domain exactly as it arrived —
 * `planSteps` turns an empty group into `branch-group-empty` and an unresolvable manager into one of
 * four named refusals. A snapshot function that decided what an answer *meant* would be the second
 * place those rules lived.
 *
 * **Neither fails open.** A group that resolves to nobody and a manager who cannot be found both
 * refuse the whole start. Skipping the step is the one outcome that must never happen: an approval
 * that quietly dropped a stage somebody configured completes while looking like a process, and nobody
 * finds out a director was never asked.
 */

/**
 * Every group the version names, as its membership stands **right now**.
 *
 * `membersOfAll` reads every group in one call rather than one per group, so raising an approval
 * costs the same whether the process names one list or five. `membersOf` supplies the order and the
 * de-duplication: a person on a list twice is asked once and counted once, and two instances started
 * from one group produce their steps in the same sequence.
 *
 * A group named by a template that no longer exists resolves to **nothing here**, deliberately — the
 * domain refuses the start with `branch-group-unresolved`, which is a refusal a caller can act on,
 * rather than this function silently omitting an approver.
 */
export const snapshotGroups = async (
  dependencies: WorkflowDependencies,
  transaction: Transaction,
  templates: readonly WorkflowStepTemplateState[],
): Promise<readonly GroupSnapshot[]> => {
  const named = [
    ...new Set(
      templates
        .map((template) => template.approverGroupId)
        .filter((groupId): groupId is string => groupId !== undefined),
    ),
  ];

  if (named.length === 0) return [];

  const members = await dependencies.stores.groups.membersOfAll(transaction, named);

  return named.map((approvalGroupId) => ({
    approvalGroupId,
    members: membersOf(members.filter((member) => member.approvalGroupId === approvalGroupId)),
  }));
};

/**
 * The requester's manager, read **once** — and only when the process actually names one.
 *
 * This is the whole of Workflow's use of the reporting line, and every restraint in it is deliberate.
 *
 * **Once.** A `manager` step means the *requester's* manager (P-1), so two of them in one process are
 * the same person, and asking twice would be asking one question twice at the cost of a second
 * cross-module call on every approval a tenant raises.
 *
 * **Only when named.** A process of named approvers and groups makes no cross-module call at all, so
 * raising an approval against every version configured before this phase costs exactly what it did.
 *
 * **The date is UTC and it is the approval's own start** (P-6, D-16C-11). `resolutionDateOf` is the
 * one conversion in this module, and the instant it converts is the same `at` the instance is stamped
 * with — so an approval raised half an hour before midnight cannot find one manager in Riyadh and
 * another in Los Angeles.
 *
 * **No reporting line composed is not a skipped step.** Until Checkpoint 7 wires the adapter, no
 * composition can answer this honestly — so a version naming a manager is refused by `planSteps` with
 * `manager-not-resolved`, and a version naming none is unaffected.
 */
export const snapshotManager = async (
  dependencies: WorkflowDependencies,
  templates: readonly WorkflowStepTemplateState[],
  requesterMembershipId: string,
  at: Date,
): Promise<ManagerSnapshot | undefined> => {
  if (!templates.some((template) => template.approverKind === 'manager')) return undefined;
  if (dependencies.reportingLine === undefined) return undefined;

  const resolution = await dependencies.reportingLine.managerOf(
    requesterMembershipId,
    resolutionDateOf(at),
  );

  return { requesterMembershipId, resolution };
};
