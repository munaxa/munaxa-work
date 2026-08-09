import { success, type Command, type CommandHandler } from '@work/kernel';

import type { EmploymentStatus } from '../domain/employment-vocabulary.js';

import { originOfCurrentRequest, refusedBy } from './employment-context.js';
import { EmploymentPermissions } from './employment-permissions.js';
import { employmentFrom, loadWritableEmployment } from './employment-guard.js';
import { recordTransition, type EmploymentAffected } from './employment.use-case.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * The lifecycle: submit, activate, suspend, reinstate — and, separately, end.
 *
 * **Ending is a different command with a different permission**, and that is the design rather
 * than an accident of decomposition. Every other transition is reversible: a suspension is lifted,
 * a submission is withdrawn, an activation can be followed by a suspension. Ending is terminal, it
 * is what final settlement and end-of-service calculations read, and a returning employee is a
 * *new* employment rather than a reopened one (AD-004). Folding it into a generic
 * `change-status` would mean anybody who can stand somebody down can also dismiss them.
 *
 * Every transition writes a status-history entry in the same transaction as the status change.
 * Not afterwards, and not from an event handler: a history that could be written separately is a
 * history that can be missing for exactly the change somebody later disputes.
 */

export interface ChangeEmploymentStatusCommand extends Command {
  readonly commandName: 'employment.change-status';
  readonly employmentId: string;
  readonly status: Exclude<EmploymentStatus, 'ended'>;
  /** A tenant-supplied code. Why somebody was suspended is not a sentence this product ships. */
  readonly reasonCode?: string;
  readonly note?: string;
  /** When the change takes effect. Defaults to now; back-dating a correction is ordinary. */
  readonly effectiveFrom?: Date;
  readonly expectedVersion: number;
}

export const changeEmploymentStatusHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<ChangeEmploymentStatusCommand, EmploymentAffected> => ({
  commandName: 'employment.change-status',
  permission: EmploymentPermissions.employmentStatusChange,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!loaded.ok) return loaded;

      const employment = employmentFrom(loaded.value);
      const from = employment.status;
      const now = dependencies.clock.now();
      const changed = employment.transitionTo(
        command.status,
        command.reasonCode,
        originOfCurrentRequest(),
        now,
      );

      if (!changed.ok) return refusedBy(changed.error);

      await dependencies.stores.employments.update(
        transaction,
        employment.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(employment.pullEvents());
      await recordTransition(transaction, dependencies, {
        employmentId: employment.id,
        fromStatus: from,
        toStatus: command.status,
        ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
        ...(command.note === undefined ? {} : { note: command.note }),
        effectiveFrom: command.effectiveFrom ?? now,
      });
      return success({ employmentId: employment.id });
    }),
});

export interface EndEmploymentCommand extends Command {
  readonly commandName: 'employment.end-employment';
  readonly employmentId: string;
  readonly endDate: string;
  /** Resignation, dismissal, end of contract — a tenant or country-pack code, never ours (00B). */
  readonly endReasonCode: string;
  readonly note?: string;
  readonly expectedVersion: number;
}

export interface EmploymentEnded {
  readonly employmentId: string;
  readonly endDate: string;
}

/**
 * Ends an employment.
 *
 * This phase establishes the employment's **final state** and the data later domains need from it.
 * It is deliberately not offboarding: no exit interview, no clearance, no asset return, no final
 * settlement. Those belong to Offboarding (Phase 11.2), which will orchestrate the exit *around*
 * this transition — and which needs this to already be the single authoritative answer to "is this
 * person still employed, and if not, from when and why".
 *
 * The open assignments and reporting lines are **not** closed here, and that is deliberate rather
 * than an omission. An assignment records where somebody worked during a period; closing it at
 * termination would be recording a transfer that never happened. The employment's own end date is
 * what bounds all of it, and every read resolves placement through the employment's status first.
 */
export const endEmploymentHandler = (
  dependencies: EmploymentDependencies,
): CommandHandler<EndEmploymentCommand, EmploymentEnded> => ({
  commandName: 'employment.end-employment',
  permission: EmploymentPermissions.employmentEnd,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritableEmployment(
        transaction,
        dependencies.stores,
        command.employmentId,
      );

      if (!loaded.ok) return loaded;

      const employment = employmentFrom(loaded.value);
      const from = employment.status;
      const now = dependencies.clock.now();
      const ended = employment.end(
        {
          endDate: command.endDate,
          endReasonCode: command.endReasonCode,
          ...(command.note === undefined ? {} : { note: command.note }),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!ended.ok) return refusedBy(ended.error);

      await dependencies.stores.employments.update(
        transaction,
        employment.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(employment.pullEvents());
      await recordTransition(transaction, dependencies, {
        employmentId: employment.id,
        fromStatus: from,
        toStatus: 'ended',
        reasonCode: command.endReasonCode,
        ...(command.note === undefined ? {} : { note: command.note }),
        effectiveFrom: new Date(`${ended.value}T00:00:00.000Z`),
      });
      return success({ employmentId: employment.id, endDate: ended.value });
    }),
});
