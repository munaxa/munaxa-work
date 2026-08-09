import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { EmploymentContract } from '../domain/employment-contract.js';
import { supersessionAt } from '../domain/versioned-child.js';
import type { EmploymentContractState } from '../domain/employment-contract.js';
import type { ProbationOutcome } from '../domain/employment-vocabulary.js';

import {
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import { loadWritableEmployment } from './employment-guard.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Recording an employment's contract, and concluding its probation.
 *
 * A renewal is a **new contract period** rather than an edit, for the reason every timeline in
 * this module exists: which terms applied on the date a decision was taken is a question asked
 * after the terms have changed. An amended row answers it with today's terms and no warning.
 *
 * Nothing here computes anything. A notice period is what the parties agreed; whether a statutory
 * minimum overrides it belongs to a country pack (Phase 11.1). A probation length is recorded and
 * never validated against a legal maximum, because the maximum differs by market and by
 * industry — the architecture holds the shape and the country pack holds the law (00B).
 */

export interface RecordContractCommand extends Command {
  readonly commandName: 'employment.record-contract';
  readonly employmentId: string;
  readonly contractNumber?: string;
  readonly contractTypeCode: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly probationEndDate?: string;
  readonly noticePeriodDays?: number;
  readonly workingHoursPerWeek?: number;
  /** A reference into the document store. Employment holds no bytes and owns no documents (§24). */
  readonly documentReference?: string;
  readonly effectiveFrom?: Date;
}

export interface ContractAffected {
  readonly employmentId: string;
  readonly contractId: string;
}

export const recordContractHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<RecordContractCommand, ContractAffected> => ({
  commandName: 'employment.record-contract',
  permission: EmploymentPermissions.contractManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!employment.ok) return employment;

      const now = dependencies.clock.now();
      const effectiveFrom = command.effectiveFrom ?? now;
      const existing = await dependencies.stores.contracts.forEmployment(
        transaction,
        command.employmentId,
      );
      const closed = await closeSuperseded(transaction, dependencies, existing, effectiveFrom, now);

      if (closed !== undefined) return closed;

      const contract = EmploymentContract.record(
        {
          tenantId: currentTenant(),
          employmentId: command.employmentId,
          ...optionalTerms(command),
          contractTypeCode: command.contractTypeCode,
          startDate: command.startDate,
          effectiveFrom,
        },
        originOfCurrentRequest(),
        now,
      );

      if (!contract.ok) return refusedBy(contract.error);

      await dependencies.stores.contracts.insert(transaction, contract.value.snapshot());
      transaction.collect(contract.value.pullEvents());
      return success({ employmentId: command.employmentId, contractId: contract.value.id });
    }),
});

const optionalTerms = (command: RecordContractCommand): Record<string, string | number> => ({
  ...(command.contractNumber === undefined ? {} : { contractNumber: command.contractNumber }),
  ...(command.endDate === undefined ? {} : { endDate: command.endDate }),
  ...(command.probationEndDate === undefined ? {} : { probationEndDate: command.probationEndDate }),
  ...(command.noticePeriodDays === undefined ? {} : { noticePeriodDays: command.noticePeriodDays }),
  ...(command.workingHoursPerWeek === undefined
    ? {}
    : { workingHoursPerWeek: command.workingHoursPerWeek }),
  ...(command.documentReference === undefined
    ? {}
    : { documentReference: command.documentReference }),
});

const closeSuperseded = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  existing: readonly EmploymentContractState[],
  effectiveFrom: Date,
  now: Date,
): Promise<Result<ContractAffected, HandlerFailure> | undefined> => {
  const { superseded } = supersessionAt(existing, effectiveFrom);

  if (superseded === undefined) return undefined;

  const previous = EmploymentContract.rehydrate(superseded);
  const closed = previous.closeAt(effectiveFrom, originOfCurrentRequest(), now);

  if (!closed.ok) return refusedBy(closed.error);

  await dependencies.stores.contracts.update(transaction, previous.snapshot(), superseded.version);
  transaction.collect(previous.pullEvents());
  return undefined;
};

export interface ConcludeProbationCommand extends Command {
  readonly commandName: 'employment.conclude-probation';
  readonly employmentId: string;
  readonly contractId: string;
  readonly outcome: ProbationOutcome;
  readonly expectedVersion: number;
}

/**
 * Records that a probation passed or was waived.
 *
 * There is no "failed" outcome, and its absence is the design. A probation somebody did not pass
 * **ends the employment**, through `end-employment` with its own reason, its own permission and its
 * own events. Recording a failure here instead would leave the employment reading `active` while
 * the business believed it was over — and payroll reads `active`.
 */
export const concludeProbationHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<ConcludeProbationCommand, ContractAffected> => ({
  commandName: 'employment.conclude-probation',
  permission: EmploymentPermissions.contractManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!employment.ok) return employment;

      const state = await dependencies.stores.contracts.byId(transaction, command.contractId);

      if (state === undefined || state.employmentId !== command.employmentId) {
        return notFound('contract');
      }

      const contract = EmploymentContract.rehydrate(state);
      const concluded = contract.concludeProbation(
        command.outcome,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!concluded.ok) return refusedBy(concluded.error);

      await dependencies.stores.contracts.update(
        transaction,
        contract.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(contract.pullEvents());
      return success({ employmentId: command.employmentId, contractId: contract.id });
    }),
});
