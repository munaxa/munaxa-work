import { success, type Command, type CommandHandler } from '@work/kernel';

import {
  approvalDecision,
  nextSequence,
  reversalPermitted,
  stateFromChain,
} from '../domain/approval.js';
import { recordChange } from './recurring-writer.js';
import { applyState, subjectOf } from './decision-subject.js';
import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  refusedBy,
} from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { SubjectKind } from '../domain/compensation-vocabulary.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * Deciding a compensation change, and reversing a decision.
 *
 * **`compensation.approve` is a separate permission from `compensation.manage`**, and the domain
 * refuses self-approval even for somebody holding both — as does a check constraint in the
 * database. A control that depends on nobody holding two roles is a control that fails the first
 * time somebody does.
 *
 * **A decision is inserted, never edited.** A wrong one is corrected by a **reversal**: a new row
 * naming the decision it reverses. Both stay in the chain, and neither counts toward the approvals
 * a plan requires.
 *
 * **A reversal is permitted only while the change is still future-dated.** Compensation cannot know
 * whether a payroll period has consumed a change that is already in force — that is Payroll's fact,
 * and asking for it would be a reverse dependency on a module that does not exist yet. So the rule
 * is expressed in terms this module can answer, and the remedy after that point is a **new
 * effective-dated change** rather than pretending an approval never happened.
 */

export interface DecideCompensationCommand extends Command {
  readonly commandName: 'compensation.decide';
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly decision: string;
  readonly comment?: string;
}

export interface CompensationDecided {
  readonly decisionId: string;
  readonly approvalState: string;
}

export const decideCompensationHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<DecideCompensationCommand, CompensationDecided> => ({
  commandName: 'compensation.decide',
  permission: CompensationPermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const subject = await subjectOf(
        dependencies,
        transaction,
        command.subjectKind,
        command.subjectId,
      );

      if (!subject.ok) return refusedBy<CompensationDecided>(subject.error);

      const { requestedBy, employmentId, effectiveFrom, approvalsRequired } = subject.value;
      const existing = await dependencies.stores.decisions.forSubject(
        transaction,
        command.subjectKind,
        command.subjectId,
      );

      const built = approvalDecision(
        {
          tenantId: currentTenant(),
          subjectKind: command.subjectKind,
          subjectId: command.subjectId,
          sequence: nextSequence(existing),
          decision: command.decision,
          decidedBy: currentActor(),
          requestedBy,
          ...(command.comment === undefined ? {} : { comment: command.comment }),
        },
        dependencies.clock.now(),
      );

      if (!built.ok) return refusedBy<CompensationDecided>(built.error);

      await dependencies.stores.decisions.insert(transaction, built.value);

      const chain = [...existing, built.value];
      const state = stateFromChain(chain, approvalsRequired);

      await applyState(
        dependencies,
        transaction,
        command.subjectKind as SubjectKind,
        command.subjectId,
        state,
      );

      const recorded = await recordChange(dependencies, transaction, currentTenant(), {
        employmentId,
        subjectKind: command.subjectKind as SubjectKind,
        subjectId: command.subjectId,
        changeKind: built.value.decision === 'approved' ? 'approved' : 'rejected',
        actor: currentActor(),
        ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
      });

      if (!recorded.ok) return refusedBy<CompensationDecided>(recorded.error);

      return success({ decisionId: built.value.id, approvalState: state });
    }),
});

export interface ReverseDecisionCommand extends Command {
  readonly commandName: 'compensation.reverse-decision';
  readonly decisionId: string;
  readonly comment?: string;
}

export const reverseDecisionHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<ReverseDecisionCommand, CompensationDecided> => ({
  commandName: 'compensation.reverse-decision',
  permission: CompensationPermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const original = await dependencies.stores.decisions.byId(transaction, command.decisionId);

      if (original === undefined) return notFound<CompensationDecided>('approval decision');

      const subject = await subjectOf(
        dependencies,
        transaction,
        original.subjectKind,
        original.subjectId,
      );

      if (!subject.ok) return refusedBy<CompensationDecided>(subject.error);

      const { requestedBy, employmentId, effectiveFrom, approvalsRequired } = subject.value;
      const today = dependencies.clock.now().toISOString().slice(0, 10);

      if (effectiveFrom !== undefined && !reversalPermitted(effectiveFrom, today)) {
        return conflicted<CompensationDecided>(
          'compensation.rejection.reversal_after_effective_date',
        );
      }

      const existing = await dependencies.stores.decisions.forSubject(
        transaction,
        original.subjectKind,
        original.subjectId,
      );
      const built = approvalDecision(
        {
          tenantId: currentTenant(),
          subjectKind: original.subjectKind,
          subjectId: original.subjectId,
          sequence: nextSequence(existing),
          // A reversal of an approval is itself recorded as a rejection of the subject, so the
          // chain reads as a sequence of decisions rather than as a special kind of row.
          decision: original.decision === 'approved' ? 'rejected' : 'approved',
          decidedBy: currentActor(),
          requestedBy,
          reversesDecisionId: original.id,
          ...(command.comment === undefined ? {} : { comment: command.comment }),
        },
        dependencies.clock.now(),
      );

      if (!built.ok) return refusedBy<CompensationDecided>(built.error);

      await dependencies.stores.decisions.insert(transaction, built.value);

      const state = stateFromChain([...existing, built.value], approvalsRequired);

      await applyState(dependencies, transaction, original.subjectKind, original.subjectId, state);

      const recorded = await recordChange(dependencies, transaction, currentTenant(), {
        employmentId,
        subjectKind: original.subjectKind,
        subjectId: original.subjectId,
        changeKind: 'approval_reversed',
        actor: currentActor(),
        ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
      });

      if (!recorded.ok) return refusedBy<CompensationDecided>(recorded.error);

      return success({ decisionId: built.value.id, approvalState: state });
    }),
});
