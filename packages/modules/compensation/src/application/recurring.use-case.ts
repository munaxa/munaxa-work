import { success, type Command, type CommandHandler } from '@work/kernel';

import { writeAssignment } from './assignment-writer.js';
import { closePeriod, recordChange } from './recurring-writer.js';
import { currentActor, currentTenant, notFound, refusedBy } from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationDependencies } from './compensation-dependencies.js';
import type { Metadata } from '../domain/compensation-aggregate.js';
import type { MoneyInput } from '../domain/money-amount.js';

/**
 * Assigning, amending and ending recurring compensation — the module's authoritative writes.
 *
 * **A change never rewrites a value.** Amending closes the period it supersedes at the new
 * effective date and inserts a new row, which is what lets a payroll re-run for a closed period
 * produce that period's figure. Ending closes the open period and writes nothing else.
 *
 * **Retroactive and future-dated changes are both ordinary.** A raise effective 1 March entered on
 * 20 April supersedes the period it lands in and records both timestamps; a raise effective next
 * quarter is stored immediately, is visible through `compensation.future-changes`, and does not
 * affect what `at(today)` returns.
 *
 * **Nothing here computes a financial impact.** A retroactive raise means Payroll owes a
 * difference; calculating it depends on what was actually paid and which periods are closed, and
 * both are Payroll's facts. Compensation states the corrected truth and publishes `changed-since`
 * so Payroll can find it.
 */

export interface AssignRecurringCommand extends Command {
  readonly commandName: 'compensation.assign-recurring';
  readonly employmentId: string;
  readonly componentId: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly payGradeId?: string;
  readonly payScaleId?: string;
  readonly salaryStepId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly metadata?: Metadata;
}

export interface RecurringAssigned {
  readonly recurringId: string;
  readonly approvalState: string;
  /** The period this one closed, where it superseded one. */
  readonly supersededId?: string;
}

export const assignRecurringHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<AssignRecurringCommand, RecurringAssigned> => ({
  commandName: 'compensation.assign-recurring',
  permission: CompensationPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const written = await writeAssignment(dependencies, transaction, command, 'assigned');

      if (!written.ok) return refusedBy<RecurringAssigned>(written.error);

      return success(written.value);
    }),
});

export interface AmendRecurringCommand extends Command {
  readonly commandName: 'compensation.amend-recurring';
  readonly recurringId: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * A change to what somebody already receives.
 *
 * Takes the component and the employment from the record being amended rather than from the
 * command, so an amendment cannot quietly move an entitlement to a different person or a different
 * component. `expectedVersion` is checked against the period being superseded: two administrators
 * amending the same period race, and the loser is **refused rather than merged**.
 */
export const amendRecurringHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<AmendRecurringCommand, RecurringAssigned> => ({
  commandName: 'compensation.amend-recurring',
  permission: CompensationPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.recurring.byId(transaction, command.recurringId);

      if (existing === undefined) return notFound<RecurringAssigned>('recurring compensation');
      if (existing.version !== command.expectedVersion) {
        return refusedBy<RecurringAssigned>({
          reason: 'concurrent_modification',
          messageKey: 'compensation.rejection.concurrent_modification',
        });
      }

      const written = await writeAssignment(
        dependencies,
        transaction,
        {
          employmentId: existing.employmentId,
          componentId: existing.componentId,
          amount: command.amount,
          effectiveFrom: command.effectiveFrom,
          ...(existing.payGradeId === undefined ? {} : { payGradeId: existing.payGradeId }),
          ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
          ...(command.note === undefined ? {} : { note: command.note }),
        },
        'amended',
      );

      if (!written.ok) return refusedBy<RecurringAssigned>(written.error);

      return success(written.value);
    }),
});

export interface EndRecurringCommand extends Command {
  readonly commandName: 'compensation.end-recurring';
  readonly recurringId: string;
  readonly effectiveTo: string;
  readonly reasonCode?: string;
  readonly expectedVersion: number;
}

export interface RecurringEnded {
  readonly recurringId: string;
  readonly effectiveTo: string;
}

/**
 * Closing an entitlement.
 *
 * **Nothing is deleted.** The period keeps its amount and gains an end date, so what somebody was
 * entitled to before it closed stays answerable — which is precisely what a termination settlement
 * or a statutory end-of-service calculation will later need to read.
 */
export const endRecurringHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<EndRecurringCommand, RecurringEnded> => ({
  commandName: 'compensation.end-recurring',
  permission: CompensationPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.recurring.byId(transaction, command.recurringId);

      if (existing === undefined) return notFound<RecurringEnded>('recurring compensation');
      if (existing.version !== command.expectedVersion) {
        return refusedBy<RecurringEnded>({
          reason: 'concurrent_modification',
          messageKey: 'compensation.rejection.concurrent_modification',
        });
      }

      const ended = await closePeriod(dependencies, transaction, existing, command.effectiveTo);

      if (!ended.ok) return refusedBy<RecurringEnded>(ended.error);

      const recorded = await recordChange(dependencies, transaction, currentTenant(), {
        employmentId: existing.employmentId,
        componentId: existing.componentId,
        subjectKind: 'recurring',
        subjectId: existing.id,
        changeKind: 'ended',
        previous: existing,
        next: ended.value,
        effectiveFrom: command.effectiveTo,
        actor: currentActor(),
        ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
      });

      if (!recorded.ok) return refusedBy<RecurringEnded>(recorded.error);

      return success({ recurringId: existing.id, effectiveTo: command.effectiveTo });
    }),
});
