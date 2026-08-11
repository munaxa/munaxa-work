import { uuidV7 } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedText,
  definedOnly,
  type Metadata,
} from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import {
  CORRECTION_KINDS,
  EVENT_KINDS,
  type CorrectionKind,
  type CorrectionState,
  type EventKind,
} from './attendance-vocabulary.js';

/**
 * A request to change what an attendance day says, and the decision on it.
 *
 * **The original event is never touched.** Applying a correction writes a *new* event carrying
 * `supersedesEventId`; the superseded one stays in the table, stays readable, and simply leaves the
 * day's arithmetic. That is the difference between a corrected record and a rewritten one, and it
 * is the property somebody disputing a month's pay depends on (ADR-0052).
 *
 * **Self-approval is refused by the domain**, not only by the permission model. A control that
 * depends on nobody being granted two roles is a control that fails the first time somebody is —
 * and on a small team somebody always is. The database says the same thing with a check constraint.
 */

export interface CorrectionRequestState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: CorrectionKind;
  readonly targetEventId?: string;
  readonly proposedKind?: EventKind;
  readonly proposedOccurredAt?: Date;
  readonly proposedMinutes?: number;
  readonly reasonCode: string;
  readonly justification: string;
  readonly state: CorrectionState;
  /** Taken from the authenticated context. A caller cannot name somebody else as the requester. */
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly decidedBy?: string;
  readonly decidedAt?: Date;
  readonly decisionNote?: string;
  /** The link from intent to effect, written when the correction is applied. */
  readonly resultingEventId?: string;
  /** Reserved for Workflow (Phase 16). Null while Attendance records the decision directly. */
  readonly approvalReference?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface RequestCorrection {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: CorrectionKind;
  readonly targetEventId?: string;
  readonly proposedKind?: EventKind;
  readonly proposedOccurredAt?: Date;
  readonly proposedMinutes?: number;
  readonly reasonCode: string;
  readonly justification: string;
  readonly requestedBy: string;
  readonly metadata?: Metadata;
}

const JUSTIFICATION_LIMIT = 1024;
const MAX_PROPOSED_MINUTES = 1440;

export const requestCorrection = (
  request: RequestCorrection,
  occurredAt: Date,
): AttendanceResult<CorrectionRequestState> => {
  const shape = checkedRequestShape(request);

  if (!shape.ok) return shape;

  const proposal = checkedProposal(request);

  if (!proposal.ok) return proposal;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    kind: request.kind,
    ...shape.value,
    ...proposal.value,
    state: 'requested',
    requestedBy: request.requestedBy,
    requestedAt: occurredAt,
    metadata: metadata.value,
    version: 0,
  });
};

const checkedRequestShape = (
  request: RequestCorrection,
): AttendanceResult<
  Pick<CorrectionRequestState, 'attendanceDate' | 'reasonCode' | 'justification'> &
    Partial<Pick<CorrectionRequestState, 'targetEventId'>>
> => {
  if (!CORRECTION_KINDS.includes(request.kind)) return refuse('correction_kind_unknown');

  const attendanceDate = checkedCivilDate(request.attendanceDate, 'attendanceDate');

  if (!attendanceDate.ok) return attendanceDate;

  const reasonCode = checkedCode(request.reasonCode, 'reasonCode');

  if (!reasonCode.ok) return reasonCode;

  const justification = checkedText(request.justification, 'justification', JUSTIFICATION_LIMIT);

  if (!justification.ok) return justification;
  // A correction with no reason is an edit. Both the code and the sentence are required, because
  // the code is what a report groups by and the sentence is what a person reads a year later.
  if (justification.value === undefined) return refuse('justification_required');

  // Amending or removing names what it acts on; adding does not, and must not — an `add_event`
  // pointing at an existing event is a request nobody can apply unambiguously.
  const targets = request.kind === 'amend_event' || request.kind === 'remove_event';

  if (targets !== (request.targetEventId !== undefined)) {
    return refuse('correction_target_mismatch');
  }
  return accept({
    attendanceDate: attendanceDate.value,
    reasonCode: reasonCode.value,
    justification: justification.value,
    ...(request.targetEventId === undefined ? {} : { targetEventId: request.targetEventId }),
  });
};

const checkedProposal = (
  request: RequestCorrection,
): AttendanceResult<
  Partial<Pick<CorrectionRequestState, 'proposedKind' | 'proposedOccurredAt' | 'proposedMinutes'>>
> => {
  if (request.proposedKind !== undefined && !EVENT_KINDS.includes(request.proposedKind)) {
    return refuse('event_kind_unknown');
  }
  if (!minutesAreSane(request.proposedMinutes)) {
    return refuse('minutes_out_of_range', { field: 'proposedMinutes' });
  }
  if (!proposalIsComplete(request)) return refuse('correction_proposal_incomplete');
  return accept(
    definedOnly({
      proposedKind: request.proposedKind,
      proposedOccurredAt: request.proposedOccurredAt,
      proposedMinutes: request.proposedMinutes,
    }),
  );
};

/** Whether the proposed minutes, if any, are a sensible duration. */
const minutesAreSane = (minutes: number | undefined): boolean =>
  minutes === undefined ||
  (Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_PROPOSED_MINUTES);

/**
 * Whether the request says what the record should become.
 *
 * Adding or amending an event has to. A request that proposes nothing is a complaint, and applying
 * it would be somebody guessing what was meant.
 */
const proposalIsComplete = (request: RequestCorrection): boolean =>
  (request.kind !== 'add_event' && request.kind !== 'amend_event') ||
  (request.proposedKind !== undefined && request.proposedOccurredAt !== undefined);

export interface Decision {
  readonly approve: boolean;
  readonly decidedBy: string;
  readonly note?: string;
}

/** Approving or rejecting. Refused when the decider is the requester, whatever they hold. */
export const decideCorrection = (
  correction: CorrectionRequestState,
  decision: Decision,
  occurredAt: Date,
): AttendanceResult<CorrectionRequestState> => {
  if (correction.state !== 'requested') return refuse('correction_already_decided');
  if (decision.decidedBy === correction.requestedBy) return refuse('correction_self_approval');

  const note = checkedText(decision.note, 'decisionNote', JUSTIFICATION_LIMIT);

  if (!note.ok) return note;

  return accept({
    ...correction,
    state: decision.approve ? 'approved' : 'rejected',
    decidedBy: decision.decidedBy,
    decidedAt: occurredAt,
    ...(note.value === undefined ? {} : { decisionNote: note.value }),
  });
};

/** Marks an approved correction as carried out, and records the event that carried it out. */
export const applyCorrection = (
  correction: CorrectionRequestState,
  resultingEventId: string | undefined,
): AttendanceResult<CorrectionRequestState> => {
  if (correction.state !== 'approved') return refuse('correction_not_approved');

  return accept({
    ...correction,
    state: 'applied',
    ...(resultingEventId === undefined ? {} : { resultingEventId }),
  });
};

/** Withdrawing what has not been decided. The request stays; nothing is deleted. */
export const withdrawCorrection = (
  correction: CorrectionRequestState,
  withdrawnBy: string,
): AttendanceResult<CorrectionRequestState> => {
  if (correction.state !== 'requested') return refuse('correction_already_decided');
  if (withdrawnBy !== correction.requestedBy) return refuse('correction_not_yours_to_withdraw');

  return accept({ ...correction, state: 'withdrawn' });
};
