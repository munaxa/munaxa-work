import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { adjustment } from '../domain/adjustment.js';
import { writeAssignment } from './assignment-writer.js';
import { recordChange } from './recurring-writer.js';
import {
  employmentFor,
  inForceRecord,
  initialApprovalState,
  planFor,
} from './assignment-context.js';
import { accept, type CompensationResult } from '../domain/compensation-rejection.js';
import type { MoneyAmount, MoneyInput } from '../domain/money-amount.js';
import { currentActor, currentTenant, refusedBy } from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationDependencies } from './compensation-dependencies.js';
import type { Metadata } from '../domain/compensation-aggregate.js';
import type { ApprovalState } from '../domain/compensation-vocabulary.js';
import type { RecurringState } from '../domain/recurring.js';

/**
 * Recording an adjustment — the **reason beside a compensation change**, never a second way to
 * store one.
 *
 * The adjustment row and the effective-dated supersession it explains are written in **one
 * transaction**, so a reason without its change, or a change without its reason, cannot exist. That
 * is the whole point of the aggregate boundary here: an adjustment that recorded intent while the
 * amount stayed the same would be a note nobody could act on, and a supersession without its
 * adjustment would be a salary change with no explanation.
 *
 * **It never mutates a historical row.** The previous period is closed at the adjustment's
 * effective date and keeps its amount; the new amount opens a new period.
 *
 * Behind `compensation.adjust` rather than `compensation.manage`, because this is the movement no
 * rule produced — which makes it the one an auditor reads first, and the reasons on it are
 * separately visible from the figures.
 */

export interface RecordAdjustmentCommand extends Command {
  readonly commandName: 'compensation.record-adjustment';
  readonly employmentId: string;
  readonly componentId: string;
  readonly adjustmentType: string;
  readonly newAmount: MoneyInput;
  readonly effectiveFrom: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly metadata?: Metadata;
}

export interface AdjustmentRecorded {
  readonly adjustmentId: string;
  readonly recurringId: string;
  readonly approvalState: string;
}

export const recordAdjustmentHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<RecordAdjustmentCommand, AdjustmentRecorded> => ({
  commandName: 'compensation.record-adjustment',
  permission: CompensationPermissions.adjust,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const recorded = await writeAdjustment(dependencies, transaction, command);

      if (!recorded.ok) return refusedBy<AdjustmentRecorded>(recorded.error);

      return success(recorded.value);
    }),
});

/**
 * The adjustment and the change it explains, in one transaction.
 *
 * The order matters: the previous amount is read **before** the supersession, because afterwards
 * the previous period has an end date and its amount is exactly what the adjustment is recording as
 * the "from".
 */
const writeAdjustment = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: RecordAdjustmentCommand,
): Promise<CompensationResult<AdjustmentRecorded>> => {
  const employment = await employmentFor(dependencies, command.employmentId, command.effectiveFrom);

  if (!employment.ok) return employment;

  const plan = await planFor(dependencies, transaction, employment.value, command.effectiveFrom);

  if (!plan.ok) return plan;

  const previous = await inForceRecord(
    dependencies,
    transaction,
    command.employmentId,
    command.componentId,
    command.effectiveFrom,
  );
  const written = await writeAssignment(
    dependencies,
    transaction,
    {
      employmentId: command.employmentId,
      componentId: command.componentId,
      amount: command.newAmount,
      effectiveFrom: command.effectiveFrom,
      reasonCode: command.reasonCode,
      note: command.note,
      source: 'adjustment',
      ...(previous?.payGradeId === undefined ? {} : { payGradeId: previous.payGradeId }),
    },
    'amended',
  );

  if (!written.ok) return written;

  return explain(dependencies, transaction, command, {
    planId: plan.value.id,
    approvalState: initialApprovalState(plan.value),
    recurringId: written.value.recurringId,
    previous,
  });
};

interface Explanation {
  readonly planId: string;
  readonly approvalState: ApprovalState;
  readonly recurringId: string;
  readonly previous: RecurringState | undefined;
}

/** The reason record itself, and the history row beside it. */
const explain = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: RecordAdjustmentCommand,
  context: Explanation,
): Promise<CompensationResult<AdjustmentRecorded>> => {
  const { previous } = context;
  const built = adjustment(
    {
      tenantId: currentTenant(),
      employmentId: command.employmentId,
      componentId: command.componentId,
      adjustmentType: command.adjustmentType,
      newAmount: command.newAmount,
      currencyCode: command.newAmount.currencyCode,
      currencyExponent: command.newAmount.currencyExponent,
      effectiveFrom: command.effectiveFrom,
      reasonCode: command.reasonCode,
      note: command.note,
      requestedBy: currentActor(),
      approvalState: context.approvalState,
      recurringId: context.recurringId,
      ...(previous === undefined ? {} : { previousAmount: asInput(previous.amount) }),
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
    },
    dependencies.clock.now(),
  );

  if (!built.ok) return built;

  await dependencies.stores.adjustments.insert(transaction, built.value);

  const logged = await recordChange(dependencies, transaction, currentTenant(), {
    employmentId: command.employmentId,
    componentId: command.componentId,
    subjectKind: 'adjustment',
    subjectId: built.value.id,
    changeKind: 'adjusted',
    next: built.value,
    effectiveFrom: command.effectiveFrom,
    actor: currentActor(),
    reasonCode: command.reasonCode,
    source: 'adjustment',
    ...(previous === undefined ? {} : { previous }),
  });

  if (!logged.ok) return logged;

  return accept({
    adjustmentId: built.value.id,
    recurringId: context.recurringId,
    approvalState: built.value.approvalState,
  });
};

/** The previous amount, in the shape the adjustment takes: exact minor units as a string. */
const asInput = (amount: MoneyAmount): MoneyInput => ({
  amountMinor: amount.amountMinor.toString(),
  currencyCode: amount.currencyCode,
  currencyExponent: amount.currencyExponent,
});
