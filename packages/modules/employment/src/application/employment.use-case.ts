import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { Employment } from '../domain/employment.js';
import type { CreateEmployment } from '../domain/employment.js';
import { employmentNumberFrom, seriesKeyFor } from '../domain/employment-number.js';
import { statusRecord } from '../domain/status-record.js';
import type { Metadata } from '../domain/employment-aggregate.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  originOfCurrentRequest,
  refusedBy,
} from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import {
  checkEmployablePerson,
  employmentFrom,
  loadWritableEmployment,
} from './employment-guard.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * Creating and maintaining an Employment.
 *
 * Two things about `create` are worth reading closely.
 *
 * **The number is allocated here, not supplied.** The caller never sends one (ADR-0039). The
 * counter is locked, incremented and formatted inside the same transaction as the insert, so a
 * create that fails consumes nothing and leaves no gap in a customer's numbering — which a
 * PostgreSQL sequence could not promise, and which matters because an employee number is a thing
 * customers audit.
 *
 * **A second open employment is refused.** A person may hold many employments over a career
 * (AD-004) and the schema holds them, but only one at a time is open. That is what makes a retried
 * create fail deterministically rather than quietly producing a second employment for one human
 * being: the check is here, and the partial unique index refuses it again when two requests race.
 * Enabling genuine concurrent employments later is dropping that index — no data is reshaped.
 */

export interface CreateEmploymentCommand extends Command {
  readonly commandName: 'employment.create-employment';
  readonly personId: string;
  /** The customer's own number, for a migration. Never the generated one — that is not a caller's. */
  readonly externalEmployeeNumber?: string;
  readonly employmentTypeCode: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  /** Carried forward on a rehire so accrued service is not silently reset. */
  readonly originalHireDate?: string;
  readonly startDate: string;
  readonly metadata?: Metadata;
}

export interface EmploymentCreated {
  readonly employmentId: string;
  readonly employmentNumber: string;
  readonly personId: string;
}

export const createEmploymentHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<CreateEmploymentCommand, EmploymentCreated> => ({
  commandName: 'employment.create-employment',
  permission: EmploymentPermissions.employmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const now = dependencies.clock.now();
      const person = await checkEmployablePerson(dependencies, command.personId, now);

      if (!person.ok) return person;

      const open = await dependencies.stores.employments.openForPerson(
        transaction,
        command.personId,
      );

      // Checked here as well as by the partial unique index, so the caller gets "this person is
      // already employed" rather than a constraint violation they cannot act on.
      if (open !== undefined) return conflicted('person_already_employed');

      const seriesKey = seriesKeyFor(command.startDate);
      const next = await dependencies.stores.numbers.allocate(transaction, seriesKey);
      const employment = Employment.create(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          employmentNumber: employmentNumberFrom(seriesKey, next),
          employmentTypeCode: command.employmentTypeCode,
          startDate: command.startDate,
          ...optionalCreateFields(command),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!employment.ok) return refusedBy(employment.error);

      await dependencies.stores.employments.insert(transaction, employment.value.snapshot());
      transaction.collect(employment.value.pullEvents());
      await recordTransition(transaction, dependencies, {
        employmentId: employment.value.id,
        toStatus: 'draft',
        effectiveFrom: now,
      });

      return success({
        employmentId: employment.value.id,
        employmentNumber: employment.value.employmentNumber,
        personId: employment.value.personId,
      });
    }),
});

/** The optional facts a create may carry, hoisted so the handler stays inside its budget. */
const optionalCreateFields = (command: CreateEmploymentCommand): Partial<CreateEmployment> => ({
  ...(command.externalEmployeeNumber === undefined
    ? {}
    : { externalEmployeeNumber: command.externalEmployeeNumber }),
  ...(command.employmentCategoryCode === undefined
    ? {}
    : { employmentCategoryCode: command.employmentCategoryCode }),
  ...(command.employmentClassCode === undefined
    ? {}
    : { employmentClassCode: command.employmentClassCode }),
  ...(command.originalHireDate === undefined ? {} : { originalHireDate: command.originalHireDate }),
  ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
});

/**
 * Appends one entry to the status history.
 *
 * Shared by every transition, including the creation itself, so an employment's history begins at
 * the moment it began rather than at the first change somebody happened to make afterwards. The
 * actor comes from the authenticated context, never from the command.
 */
export const recordTransition = async (
  transaction: Transaction,
  dependencies: EmploymentDependencies,
  entry: {
    readonly employmentId: string;
    readonly fromStatus?: 'draft' | 'pending_approval' | 'active' | 'suspended' | 'ended';
    readonly toStatus: 'draft' | 'pending_approval' | 'active' | 'suspended' | 'ended';
    readonly reasonCode?: string;
    readonly note?: string;
    readonly effectiveFrom: Date;
  },
): Promise<void> => {
  await dependencies.stores.statusHistory.insert(
    transaction,
    statusRecord(
      {
        tenantId: currentTenant(),
        employmentId: entry.employmentId,
        ...(entry.fromStatus === undefined ? {} : { fromStatus: entry.fromStatus }),
        toStatus: entry.toStatus,
        ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
        ...(entry.note === undefined ? {} : { note: entry.note }),
        effectiveFrom: entry.effectiveFrom,
        recordedBy: currentActor(),
      },
      dependencies.clock.now(),
    ),
  );
};

export interface AmendEmploymentCommand extends Command {
  readonly commandName: 'employment.amend-employment';
  readonly employmentId: string;
  readonly employmentTypeCode?: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  readonly externalEmployeeNumber?: string;
  /** A correction, refused once the employment is in force. */
  readonly startDate?: string;
  readonly expectedVersion: number;
}

export interface EmploymentAffected {
  readonly employmentId: string;
}

export const amendEmploymentHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<AmendEmploymentCommand, EmploymentAffected> => ({
  commandName: 'employment.amend-employment',
  permission: EmploymentPermissions.employmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!loaded.ok) return loaded;

      const employment = employmentFrom(loaded.value);
      const amended = employment.amend(
        {
          ...(command.employmentTypeCode === undefined
            ? {}
            : { employmentTypeCode: command.employmentTypeCode }),
          ...(command.employmentCategoryCode === undefined
            ? {}
            : { employmentCategoryCode: command.employmentCategoryCode }),
          ...(command.employmentClassCode === undefined
            ? {}
            : { employmentClassCode: command.employmentClassCode }),
          ...(command.externalEmployeeNumber === undefined
            ? {}
            : { externalEmployeeNumber: command.externalEmployeeNumber }),
          ...(command.startDate === undefined ? {} : { startDate: command.startDate }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.employments.update(
        transaction,
        employment.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(employment.pullEvents());
      return success({ employmentId: employment.id });
    }),
});

export interface ReviseEmploymentMetadataCommand extends Command {
  readonly commandName: 'employment.revise-metadata';
  readonly employmentId: string;
  readonly metadata: Metadata;
  readonly expectedVersion: number;
}

export const reviseEmploymentMetadataHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<ReviseEmploymentMetadataCommand, EmploymentAffected> => ({
  commandName: 'employment.revise-metadata',
  permission: EmploymentPermissions.employmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!loaded.ok) return loaded;

      const employment = employmentFrom(loaded.value);
      const revised = employment.reviseMetadata(
        command.metadata,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.employments.update(
        transaction,
        employment.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(employment.pullEvents());
      return success({ employmentId: employment.id });
    }),
});
