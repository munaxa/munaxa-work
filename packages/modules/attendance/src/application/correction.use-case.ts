import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { AttendanceDay } from '../domain/attendance-day.js';
import {
  applyCorrection,
  decideCorrection,
  requestCorrection,
  withdrawCorrection,
  type CorrectionRequestState,
} from '../domain/correction.js';
import { recordTimeEvent } from '../domain/time-event.js';
import type { CorrectionKind, EventKind } from '../domain/attendance-vocabulary.js';
import { civilDateAt } from '../domain/zoned-time.js';

import { currentActor, currentTenant, notFound, refusedBy } from './attendance-context.js';
import { DEFAULT_ZONE, zoneFor } from './expectation-resolution.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Correcting attendance without ever rewriting what was captured.
 *
 * The chain, and every link survives:
 *
 * ```
 * original event  ──►  request  ──►  decision by a named human  ──►
 * new event (supersedes the original)  ──►  the day is marked stale  ──►  recalculation
 * ```
 *
 * **Applying a correction inserts an event; it never updates one.** The superseded event stays in
 * the table, stays readable, and simply leaves the day's arithmetic (ADR-0052). That is the
 * difference between a corrected record and a rewritten one, and it is what somebody disputing a
 * month's pay depends on.
 *
 * **Recalculation is not triggered by an event.** The day is marked in this transaction and the
 * reconciliation query finds it, because event delivery here is at-most-once (ADR-0053).
 */

export interface CorrectionAffected {
  readonly correctionId: string;
  readonly state: string;
  readonly resultingEventId?: string;
}

export interface RequestCorrectionCommand extends Command {
  readonly commandName: 'attendance.request-correction';
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: CorrectionKind;
  readonly targetEventId?: string;
  readonly proposedKind?: EventKind;
  readonly proposedOccurredAt?: Date;
  readonly proposedMinutes?: number;
  readonly reasonCode: string;
  readonly justification: string;
}

export const requestCorrectionHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<RequestCorrectionCommand, CorrectionAffected> => ({
  commandName: 'attendance.request-correction',
  permission: AttendancePermissions.correctionRequest,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(
        command.employmentId,
        command.attendanceDate,
      );

      if (employment === undefined) return notFound<CorrectionAffected>('employment');

      const requested = requestCorrection(
        {
          tenantId: currentTenant(),
          ...command,
          // From the authenticated context, never from the body. A requester a caller could name is
          // a requester a caller could impersonate.
          requestedBy: currentActor(),
        },
        dependencies.clock.now(),
      );

      if (!requested.ok) return refusedBy(requested.error);

      await dependencies.stores.corrections.insert(transaction, requested.value);
      return success({ correctionId: requested.value.id, state: requested.value.state });
    }),
});

export interface DecideCorrectionCommand extends Command {
  readonly commandName: 'attendance.decide-correction';
  readonly correctionId: string;
  readonly approve: boolean;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * Approving or rejecting, and applying what was approved in the same transaction.
 *
 * **Self-approval is refused** even when the caller holds both permissions, because a control that
 * depends on nobody being granted two roles is a control that fails the first time somebody is —
 * and on a small team somebody always is. The database says the same thing with a check constraint.
 */
export const decideCorrectionHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<DecideCorrectionCommand, CorrectionAffected> => ({
  commandName: 'attendance.decide-correction',
  permission: AttendancePermissions.correctionApprove,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.corrections.byId(transaction, command.correctionId);

      if (state === undefined) return notFound<CorrectionAffected>('correction');

      const now = dependencies.clock.now();
      const decided = decideCorrection(
        state,
        {
          approve: command.approve,
          decidedBy: currentActor(),
          ...(command.note === undefined ? {} : { note: command.note }),
        },
        now,
      );

      if (!decided.ok) return refusedBy(decided.error);
      if (!command.approve) {
        await dependencies.stores.corrections.update(
          transaction,
          decided.value,
          command.expectedVersion,
        );
        return success({ correctionId: decided.value.id, state: decided.value.state });
      }
      return applyApproved(transaction, dependencies, decided.value, command.expectedVersion, now);
    }),
});

/**
 * Carries out an approved correction.
 *
 * A `remove_event` produces a superseding event of the *opposite* nature — it is recorded as a
 * correction whose only job is to take the original out of the arithmetic — rather than deleting
 * anything. A `manual_day` and an `overtime` request record the decision and mark the day; they
 * write no punch, because inventing one would put a time nobody stood at a door into the record.
 */
const applyApproved = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  correction: CorrectionRequestState,
  expectedVersion: number,
  now: Date,
): Promise<ReturnType<typeof success<CorrectionAffected>>> => {
  const resultingEventId = await writeCorrectionEvent(transaction, dependencies, correction, now);
  const applied = applyCorrection(correction, resultingEventId);
  const final = applied.ok ? applied.value : correction;

  await dependencies.stores.corrections.update(transaction, final, expectedVersion);
  await markDayStale(transaction, dependencies, correction, now);
  return success({
    correctionId: final.id,
    state: final.state,
    ...(resultingEventId === undefined ? {} : { resultingEventId }),
  });
};

/**
 * Writes the event an approved correction calls for — or none, when the correction is a removal.
 *
 * **A removal writes nothing.** The original event is not deleted, not edited, and not shadowed by
 * a tombstone punch that never happened: the *correction record* is the durable statement that it
 * no longer counts, and the calculation reads applied removals and leaves those events out of the
 * arithmetic. Inventing a compensating punch would put a time nobody stood at a door into the
 * event table, which is the one thing this table is for not doing (ADR-0052).
 */
const writeCorrectionEvent = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  correction: CorrectionRequestState,
  now: Date,
): Promise<string | undefined> => {
  if (correction.proposedKind === undefined || correction.proposedOccurredAt === undefined) {
    return undefined;
  }

  const zone = await zoneFor(transaction, dependencies, {
    employmentId: correction.employmentId,
    onDate: correction.attendanceDate,
    tenantZone: DEFAULT_ZONE,
  });
  const event = recordTimeEvent({
    tenantId: currentTenant(),
    employmentId: correction.employmentId,
    kind: correction.proposedKind,
    source: 'correction',
    // Keyed on the correction, so applying the same approved correction twice converges on one
    // event rather than punching somebody in twice.
    idempotencyKey: `correction:${correction.id}`,
    reportedAt: correction.proposedOccurredAt,
    receivedAt: now,
    zone,
    attendanceDate: civilDateAt(correction.proposedOccurredAt, zone),
    // A correction states the time deliberately; there is no client clock here to distrust, and
    // applying the skew rule would silently move an amended punch to the moment it was approved.
    clockSkewToleranceSeconds: Number.MAX_SAFE_INTEGER,
    ...(correction.targetEventId === undefined
      ? {}
      : { supersedesEventId: correction.targetEventId }),
    note: correction.justification,
  });

  if (!event.ok) return undefined;

  const existing = await dependencies.stores.events.byKey(transaction, event.value.eventKey);

  if (existing !== undefined) return existing.id;
  await dependencies.stores.events.insert(transaction, event.value);
  return event.value.id;
};

const markDayStale = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  correction: CorrectionRequestState,
  now: Date,
): Promise<void> => {
  const existing = await dependencies.stores.days.byDate(
    transaction,
    correction.employmentId,
    correction.attendanceDate,
  );

  if (existing === undefined) {
    const opened = AttendanceDay.open(
      {
        tenantId: currentTenant(),
        employmentId: correction.employmentId,
        attendanceDate: correction.attendanceDate,
        zone: DEFAULT_ZONE,
      },
      now,
    );

    await dependencies.stores.days.insert(transaction, opened.snapshot());
    return;
  }

  const day = AttendanceDay.rehydrate(existing);

  day.markStale(now);
  await dependencies.stores.days.update(transaction, day.snapshot(), existing.version);
};

export interface WithdrawCorrectionCommand extends Command {
  readonly commandName: 'attendance.withdraw-correction';
  readonly correctionId: string;
  readonly expectedVersion: number;
}

/** Withdrawing your own undecided request. The row stays; nothing is deleted. */
export const withdrawCorrectionHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<WithdrawCorrectionCommand, CorrectionAffected> => ({
  commandName: 'attendance.withdraw-correction',
  permission: AttendancePermissions.correctionRequest,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.corrections.byId(transaction, command.correctionId);

      if (state === undefined) return notFound<CorrectionAffected>('correction');

      const withdrawn = withdrawCorrection(state, currentActor());

      if (!withdrawn.ok) return refusedBy(withdrawn.error);

      await dependencies.stores.corrections.update(
        transaction,
        withdrawn.value,
        command.expectedVersion,
      );
      return success({ correctionId: withdrawn.value.id, state: withdrawn.value.state });
    }),
});
