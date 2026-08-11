import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { Requisition, requisitionDecision } from '../domain/requisition.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { allocateNumber } from './recruitment-numbering.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Requisitions: raising the authority to hire, and deciding on it.
 *
 * **The approval is real** (ADR-0045). `decide` records a row naming the human being who decided,
 * taken from the authenticated context, in the same transaction as the status change. Nothing here
 * consults `AutoApprovingPort`: its record is honest about being automatic, and an automatic
 * approval of a control that authorizes headcount spending is not an approval.
 *
 * A decision is **never amended**. `reverse` writes another row pointing at the one it reverses and
 * returns the requisition for a fresh decision — which is the correction mechanism the approved
 * decision requires, and is refused once hiring has begun, because unmaking the authority for a
 * hire that already happened would leave the hire unauthorized rather than undone.
 *
 * **The migration path to Workflow (Phase 16)**: the aggregate already models `pending_approval`,
 * the row already carries `approvalId`, and Workflow supplies routing, delegation and escalation by
 * requesting through `ApprovalPort` and calling `decide` on the outcome. No table and no state
 * changes.
 */

export interface CreateRequisitionCommand extends Command {
  readonly commandName: 'recruitment.create-requisition';
  readonly positionId: string;
  readonly unitId: string;
  readonly costCenterId?: string;
  readonly headcountRequested: number;
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
  readonly requestedByEmploymentId: string;
  readonly hiringManagerEmploymentId?: string;
  readonly metadata?: Metadata;
}

export interface RequisitionCreated {
  readonly requisitionId: string;
  readonly requisitionNumber: string;
}

export const createRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CreateRequisitionCommand, RequisitionCreated> => ({
  commandName: 'recruitment.create-requisition',
  permission: RecruitmentPermissions.requisitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      // Existence only, through a bounded grant: naming a unit on a requisition does not make the
      // recruiter somebody who may browse the organization chart (ADR-0043).
      const unitExists = await dependencies.organization.unitExists(command.unitId);

      if (!unitExists) return notFound<RequisitionCreated>('organization unit');

      const now = dependencies.clock.now();
      const number = await allocateNumber(transaction, dependencies, 'requisition', 'REQ', now);
      const requisition = Requisition.create(
        {
          tenantId: currentTenant(),
          requisitionNumber: number,
          ...requisitionFields(command),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!requisition.ok) return refusedBy(requisition.error);

      await dependencies.stores.requisitions.insert(transaction, requisition.value.snapshot());
      transaction.collect(requisition.value.pullEvents());
      return success({
        requisitionId: requisition.value.id,
        requisitionNumber: number,
      });
    }),
});

/** The fields a create carries, hoisted so the handler stays inside its budget. */
const requisitionFields = (
  command: CreateRequisitionCommand,
): Omit<Parameters<typeof Requisition.create>[0], 'tenantId' | 'requisitionNumber'> => ({
  positionId: command.positionId,
  unitId: command.unitId,
  ...(command.costCenterId === undefined ? {} : { costCenterId: command.costCenterId }),
  headcountRequested: command.headcountRequested,
  reasonCode: command.reasonCode,
  ...(command.priorityCode === undefined ? {} : { priorityCode: command.priorityCode }),
  ...(command.targetStartDate === undefined ? {} : { targetStartDate: command.targetStartDate }),
  requestedByEmploymentId: command.requestedByEmploymentId,
  ...(command.hiringManagerEmploymentId === undefined
    ? {}
    : { hiringManagerEmploymentId: command.hiringManagerEmploymentId }),
  ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
});

export interface RequisitionAffected {
  readonly requisitionId: string;
  readonly status: string;
}

export interface SubmitRequisitionCommand extends Command {
  readonly commandName: 'recruitment.submit-requisition';
  readonly requisitionId: string;
  readonly expectedVersion: number;
}

export const submitRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<SubmitRequisitionCommand, RequisitionAffected> => ({
  commandName: 'recruitment.submit-requisition',
  permission: RecruitmentPermissions.requisitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withRequisition(transaction, dependencies, command, (requisition, now) => {
        const submitted = requisition.submit(originOfCurrentRequest(), now);

        return submitted.ok ? success(undefined) : refusedBy(submitted.error);
      }),
    ),
});

export interface DecideRequisitionCommand extends Command {
  readonly commandName: 'recruitment.decide-requisition';
  readonly requisitionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly reasonCode?: string;
  readonly note?: string;
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
        const decided = requisition.decide(command.decision, originOfCurrentRequest(), now);

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

/**
 * Load, act, persist — the shape every requisition command shares.
 *
 * Written once because it precedes all six, and a check that has to be remembered in six handlers
 * is a check that will be missing from one.
 */
export const withRequisition = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  command: { readonly requisitionId: string; readonly expectedVersion: number },
  act: (
    requisition: Requisition,
    now: Date,
  ) => Promise<ReturnType<typeof success<undefined>>> | ReturnType<typeof success<undefined>>,
): Promise<Result<RequisitionAffected, HandlerFailure>> => {
  const state = await dependencies.stores.requisitions.byId(transaction, command.requisitionId);

  if (state === undefined) return notFound<RequisitionAffected>('requisition');

  const requisition = Requisition.rehydrate(state);
  const acted = await act(requisition, dependencies.clock.now());

  if (!acted.ok) return acted;

  await dependencies.stores.requisitions.update(
    transaction,
    requisition.snapshot(),
    command.expectedVersion,
  );
  transaction.collect(requisition.pullEvents());
  return success({ requisitionId: requisition.id, status: requisition.status });
};
