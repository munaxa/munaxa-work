import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedOptionalCode,
  checkedText,
  type Metadata,
} from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { signAgreesWithKind, type LedgerKind, type LedgerSource } from './leave-vocabulary.js';

/**
 * A movement of leave, and the whole of what a balance is made of.
 *
 * **The ledger is authoritative; the balance is a projection.** Every figure this module publishes
 * is a sum of these rows, and the projection beside it exists only so the sum does not have to be
 * recomputed on every read. When the two disagree, the ledger is right — which is why the
 * projection carries a digest and a stale mark and the ledger carries neither.
 *
 * **Inserted and read. There is no update and no delete.** Not in the domain, not on the
 * repository, not in the migration. A balance somebody disputes is a sum of rows, and a row that
 * could be edited is not evidence. A correction is a **reversal plus a replacement** — two new
 * signed rows — so the arithmetic that produced yesterday's figure is still visible after today's
 * correction. This is the same guarantee `attendance_time_event` gives (ADR-0052), applied to
 * money-adjacent arithmetic where it matters more.
 *
 * **Minutes are signed**, so a balance is `sum(minutes)`: one expression that cannot disagree with
 * itself, rather than a case statement per kind that eventually will. The sign convention is
 * enforced by a check constraint as well as here, because a convention living only in application
 * code is one that any future path around that code silently breaks.
 *
 * **`sourceKind` and `sourceId` are the idempotency key**, with `kind`. A unique index over the
 * three makes every writer safe to retry: an accrual run repeated writes nothing, an approval
 * retried consumes once, and a leave-year close rerun produces no second carry pair. That is what
 * lets this module have bounded, restartable runs instead of a scheduler nobody can interrupt.
 *
 * **`balanceBeforeMinutes` and `balanceAfterMinutes` are captured at the moment of writing**, which
 * is what makes "what did this adjustment change" answerable without replaying the ledger (§25).
 */

export interface LedgerEntryState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly kind: LedgerKind;
  /** Signed. Credits positive, consumption and expiry negative. Never zero. */
  readonly minutes: number;
  /** The civil date the movement belongs to. May be back-dated; distinct from `recordedAt`. */
  readonly effectiveOn: string;
  /** When it was written. Distinct from `effectiveOn`, always. */
  readonly recordedAt: Date;
  readonly sourceKind: LedgerSource;
  readonly sourceId: string;
  readonly reversesEntryId?: string;
  readonly leavePolicyId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly balanceBeforeMinutes: number;
  readonly balanceAfterMinutes: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface WriteLedgerEntry {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly kind: LedgerKind;
  readonly minutes: number;
  readonly effectiveOn: string;
  readonly sourceKind: LedgerSource;
  readonly sourceId: string;
  readonly reversesEntryId?: string;
  readonly leavePolicyId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  /** The balance the writer read before this entry. The entry records what it moved it to. */
  readonly balanceBeforeMinutes: number;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;

export const ledgerEntry = (
  request: WriteLedgerEntry,
  recordedAt: Date,
): LeaveResult<LedgerEntryState> => {
  const movement = checkedMovement(request);

  if (!movement.ok) return movement;

  const annotation = checkedAnnotation(request);

  if (!annotation.ok) return annotation;

  return accept({
    id: uuidV7(recordedAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    leaveTypeId: request.leaveTypeId,
    leaveYearStart: request.leaveYearStart,
    kind: request.kind,
    minutes: request.minutes,
    effectiveOn: movement.value.effectiveOn,
    recordedAt,
    sourceKind: request.sourceKind,
    sourceId: request.sourceId,
    ...(request.reversesEntryId === undefined ? {} : { reversesEntryId: request.reversesEntryId }),
    ...(request.leavePolicyId === undefined ? {} : { leavePolicyId: request.leavePolicyId }),
    ...annotation.value,
    balanceBeforeMinutes: request.balanceBeforeMinutes,
    balanceAfterMinutes: request.balanceBeforeMinutes + request.minutes,
    metadata: request.metadata ?? {},
    version: 0,
  });
};

const checkedMovement = (
  request: WriteLedgerEntry,
): LeaveResult<{ readonly effectiveOn: string }> => {
  if (!Number.isInteger(request.minutes)) {
    return refuse('minutes_not_whole', { field: 'minutes' });
  }
  if (request.minutes === 0) return refuse('ledger_entry_moves_nothing');
  if (!signAgreesWithKind(request.kind, request.minutes)) {
    return refuse('ledger_sign_disagrees_with_kind', { kind: request.kind });
  }
  return checkedCivilDate(request.effectiveOn, 'effectiveOn').ok
    ? accept({ effectiveOn: request.effectiveOn })
    : refuse('date_malformed', { field: 'effectiveOn' });
};

/**
 * The reason and the note.
 *
 * An adjustment **must** carry a reason code: a manual movement of somebody's leave balance with no
 * stated reason is the one entry in this table nobody can defend later, and the database refuses it
 * too.
 */
const checkedAnnotation = (
  request: WriteLedgerEntry,
): LeaveResult<{ readonly reasonCode?: string; readonly note?: string }> => {
  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;
  if (request.kind === 'adjustment' && reason.value === undefined) {
    return refuse('adjustment_requires_a_reason');
  }

  const note = checkedText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  return accept({
    ...(reason.value === undefined ? {} : { reasonCode: reason.value }),
    ...(note.value === undefined ? {} : { note: note.value }),
  });
};

/**
 * The reversal of an entry: the same movement with the opposite sign, naming what it reverses.
 *
 * A reversal rather than a deletion, and a *new row* rather than a flag on the old one, because
 * "this was consumed and then given back" and "this was never consumed" are different facts about a
 * person's year and a report has to be able to tell them apart.
 *
 * The kind is `reversal` rather than the original kind negated, so a sum by kind still reads
 * correctly: consumption stays what was consumed, and reversals are their own line.
 */
export const reversalOf = (
  original: LedgerEntryState,
  context: {
    readonly sourceKind: LedgerSource;
    readonly sourceId: string;
    readonly effectiveOn: string;
    readonly balanceBeforeMinutes: number;
    readonly reasonCode?: string;
  },
  recordedAt: Date,
): LeaveResult<LedgerEntryState> =>
  ledgerEntry(
    {
      tenantId: original.tenantId,
      employmentId: original.employmentId,
      leaveTypeId: original.leaveTypeId,
      leaveYearStart: original.leaveYearStart,
      kind: 'reversal',
      minutes: -original.minutes,
      effectiveOn: context.effectiveOn,
      sourceKind: context.sourceKind,
      sourceId: context.sourceId,
      reversesEntryId: original.id,
      balanceBeforeMinutes: context.balanceBeforeMinutes,
      ...(original.leavePolicyId === undefined ? {} : { leavePolicyId: original.leavePolicyId }),
      ...(context.reasonCode === undefined ? {} : { reasonCode: context.reasonCode }),
    },
    recordedAt,
  );

/** The bucket an entry belongs to. Every sum in this module is scoped by exactly these three. */
export interface LedgerBucket {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
}

export const bucketOf = (entry: LedgerEntryState): LedgerBucket => ({
  employmentId: entry.employmentId,
  leaveTypeId: entry.leaveTypeId,
  leaveYearStart: entry.leaveYearStart,
});

export const bucketKey = (bucket: LedgerBucket): string =>
  `${bucket.employmentId}|${bucket.leaveTypeId}|${bucket.leaveYearStart}`;
