import { success, type Command, type CommandHandler } from '@work/kernel';

import { requisitionDecision } from '../domain/requisition-decision.js';
import {
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { withRequisition, type RequisitionAffected } from './requisition.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Deciding a requisition, and reversing that decision.
 *
 * Separate from raising and submitting one because they are separate acts by separate people:
 * `requisition.approve` is the control that commits headcount and the person who asked for it does
 * not hold it. The aggregate moves and the *evidence* is an immutable row written beside it in the
 * same transaction — the status answers "where is this now", the decision row answers "who decided,
 * when, and did anybody undo it", and a headcount audit asks the second.
 */

export interface DecideRequisitionCommand extends Command {
  readonly commandName: 'recruitment.decide-requisition';
  readonly requisitionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reasonCode?: string;
  readonly note?: string;
  /**
   * The routed approval this decision came from, when one did.
   *
   * Absent for a decision made directly in Recruitment, which is still the ordinary case. When
   * present it is Workflow's approval identifier, stored in the column this module has reserved for
   * it since Phase 6 — **an opaque value, not a foreign key** (ADR-0042). Recruitment does not read
   * it, join on it or interpret it; it records which routed approval authorized the headcount, so a
   * later audit can trace the decision back to the chain that produced it.
   *
   * It is never taken to mean the decision is already made: the aggregate's own lifecycle rule
   * decides that, exactly as it does without one.
   */
  readonly approvalId?: string;
  readonly expectedVersion: number;
}

/**
 * The decision.
 *
 * Guarded by `recruitment.requisition.approve`, which the person who raised the request does not
 * automatically hold — separation of duties on the control that commits headcount.
 */
export const decideRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<DecideRequisitionCommand, RequisitionAffected> => ({
  commandName: 'recruitment.decide-requisition',
  permission: RecruitmentPermissions.requisitionApprove,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withRequisition(transaction, dependencies, command, async (requisition, now) => {
        const decided = requisition.decide(
          command.decision,
          originOfCurrentRequest(),
          now,
          command.approvalId,
        );

        if (!decided.ok) return refusedBy(decided.error);

        await dependencies.stores.decisions.insert(
          transaction,
          requisitionDecision(
            {
              tenantId: currentTenant(),
              requisitionId: requisition.id,
              decision: command.decision,
              ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
              ...(command.note === undefined ? {} : { note: command.note }),
              // The authenticated human, never a value the caller supplied.
              decidedBy: currentActor(),
              decidedAt: now,
            },
            now,
          ),
        );
        return success(undefined);
      }),
    ),
});

export interface ReverseRequisitionDecisionCommand extends Command {
  readonly commandName: 'recruitment.reverse-requisition-decision';
  readonly requisitionId: string;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * Reverses a decision.
 *
 * The correction mechanism, and the only one: the decision that was made stands as a row, and this
 * writes another naming it. That is what "immutable once recorded except through an explicit
 * correction mechanism" means in a schema rather than in a policy document.
 */
export const reverseRequisitionDecisionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<ReverseRequisitionDecisionCommand, RequisitionAffected> => ({
  commandName: 'recruitment.reverse-requisition-decision',
  permission: RecruitmentPermissions.requisitionApprove,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withRequisition(transaction, dependencies, command, async (requisition, now) => {
        const decisions = await dependencies.stores.decisions.forRequisition(
          transaction,
          requisition.id,
        );
        const latest = [...decisions]
          .filter((decision) => decision.decision !== 'reversed')
          .sort((left, right) => left.decidedAt.getTime() - right.decidedAt.getTime())
          .at(-1);

        if (latest === undefined) return notFound<undefined>('requisition decision');

        const reversed = requisition.reverseDecision(originOfCurrentRequest(), now);

        if (!reversed.ok) return refusedBy(reversed.error);

        await dependencies.stores.decisions.insert(
          transaction,
          requisitionDecision(
            {
              tenantId: currentTenant(),
              requisitionId: requisition.id,
              decision: 'reversed',
              ...(command.note === undefined ? {} : { note: command.note }),
              decidedBy: currentActor(),
              decidedAt: now,
              reversesId: latest.id,
            },
            now,
          ),
        );
        return success(undefined);
      }),
    ),
});
