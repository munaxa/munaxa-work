import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedOptionalCode,
  checkedText,
  type Metadata,
} from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import { ROSTER_KINDS, type RosterKind } from './attendance-vocabulary.js';

/**
 * An explicit statement about one employment on one date, overriding whatever the schedule says.
 *
 * This is where a public holiday lives, and that placement is a decision rather than an accident.
 * Organization owns calendars and publishes no read for them; 00B says the working week and the
 * public-holiday calendar are **country-pack** content, which Phase 11.1 supplies. Until then a
 * rest day is a schedule fact and a holiday is a roster entry a tenant records — and Attendance
 * builds no calendar of its own, because two owners of "is the 23rd a holiday" produce two answers
 * (the approved D-2 fallback).
 *
 * **Never edited in place once its day has been calculated.** Changing a past entry writes a
 * superseding one and marks the day for recalculation, so June cannot silently rewrite what March
 * meant. A plain shape rather than an aggregate: it has one invariant — one entry per employment
 * per date — and an index enforces it better than a class could.
 */

export interface RosterEntryState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly onDate: string;
  readonly kind: RosterKind;
  /** Required for `shift`, forbidden otherwise. The database says the same thing. */
  readonly shiftId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly swapOfEntryId?: string;
  readonly version: number;
}

export interface DefineRosterEntry {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly onDate: string;
  readonly kind: RosterKind;
  readonly shiftId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly swapOfEntryId?: string;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;

export const rosterEntry = (
  request: DefineRosterEntry,
  occurredAt: Date,
): AttendanceResult<RosterEntryState> => {
  if (!ROSTER_KINDS.includes(request.kind)) return refuse('roster_kind_unknown');

  const onDate = checkedCivilDate(request.onDate, 'onDate');

  if (!onDate.ok) return onDate;

  // A shift entry names a shift and nothing else does. An entry whose kind and reference disagree
  // is a day nobody can resolve — and the check is here as well as in the database because a
  // caller deserves a named refusal rather than a constraint violation.
  if ((request.kind === 'shift') !== (request.shiftId !== undefined)) {
    return refuse('roster_shift_reference_mismatch');
  }

  const reasonCode = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reasonCode.ok) return reasonCode;

  const note = checkedText(request.note, 'note', NOTE_LIMIT);

  if (!note.ok) return note;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    onDate: onDate.value,
    kind: request.kind,
    ...(request.shiftId === undefined ? {} : { shiftId: request.shiftId }),
    ...(reasonCode.value === undefined ? {} : { reasonCode: reasonCode.value }),
    ...(note.value === undefined ? {} : { note: note.value }),
    ...(request.swapOfEntryId === undefined ? {} : { swapOfEntryId: request.swapOfEntryId }),
    version: 0,
  });
};
