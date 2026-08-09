import { uuidV7, type EventOrigin } from '@work/kernel';

import { AttendanceAggregate, checkedOptionalCode, definedOnly } from './attendance-aggregate.js';
import { AttendanceEvents } from './attendance-events.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import { DAY_TRANSITIONS, type DayState } from './attendance-vocabulary.js';
import {
  isBlocking,
  type AttendanceDayState,
  type DayExceptionState,
} from './attendance-day-state.js';
import { CALCULATION_VERSION, type CalculationResult } from './calculation.js';

/**
 * The calculated working day.
 *
 * **A derivation, not a fact somebody recorded.** Everything on it comes from events, a schedule, a
 * roster, a policy and what Leave could say — all of which are still present — so recalculating
 * replaces it rather than editing it, and the replacement can be proved correct.
 *
 * The aggregate exists for the two things that are *not* derived: the state machine, and the human
 * sign-off. Both need one transaction with the day's exceptions, because a day approved while a
 * blocking exception is open is a screen showing "closed" over a question nobody answered.
 */

export interface OpenDay {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly zone: string;
}

export class AttendanceDay extends AttendanceAggregate {
  private constructor(private day: AttendanceDayState) {
    super(day.id, day.tenantId, day.version, 'AttendanceDay');
  }

  /**
   * Opens a day before anything has been calculated.
   *
   * Ingestion does this, not the calculator, and the ordering is deliberate: a day that only came
   * into existence when somebody calculated it is a day the reconciliation query cannot find when
   * the calculation never ran. `pending` with `inputsChangedAt` set is precisely the row that says
   * "there is work here nobody has done".
   */
  public static open(request: OpenDay, occurredAt: Date): AttendanceDay {
    return new AttendanceDay({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      employmentId: request.employmentId,
      attendanceDate: request.attendanceDate,
      zone: request.zone,
      dayKind: 'unscheduled',
      expectedMinutes: 0,
      expectedBreakMinutes: 0,
      workedMinutes: 0,
      breakMinutesTaken: 0,
      paidBreakMinutes: 0,
      regularCandidateMinutes: 0,
      overtimeCandidateMinutes: 0,
      unpaidMinutes: 0,
      absenceMinutes: 0,
      leaveState: 'unknown',
      leaveMinutes: 0,
      state: 'pending',
      calculationVersion: CALCULATION_VERSION,
      inputsDigest: '',
      inputsChangedAt: occurredAt,
      metadata: {},
      version: 0,
    });
  }

  public static rehydrate(state: AttendanceDayState): AttendanceDay {
    return new AttendanceDay(state);
  }

  public get state(): DayState {
    return this.day.state;
  }

  public get attendanceDate(): string {
    return this.day.attendanceDate;
  }

  public get employmentId(): string {
    return this.day.employmentId;
  }

  public get wasApproved(): boolean {
    return this.day.approvedAt !== undefined;
  }

  public get isStale(): boolean {
    return (
      this.day.inputsChangedAt !== undefined &&
      (this.day.calculatedAt === undefined ||
        this.day.inputsChangedAt.getTime() > this.day.calculatedAt.getTime())
    );
  }

  /**
   * Records that an input moved.
   *
   * Called in the same transaction as the change — an ingested event, an applied correction, a
   * published policy, a roster edit. Never afterwards and never from an event handler: a mark that
   * could be written separately is the mark that will be missing for exactly the day somebody
   * later disputes (ADR-0053).
   */
  public markStale(occurredAt: Date): void {
    this.day = { ...this.day, inputsChangedAt: occurredAt };
  }

  /**
   * Replaces the derivation with a fresh one.
   *
   * A recalculated day returns to `calculated` even if somebody had approved it, and that is
   * deliberate rather than convenient: an input moved after the signature, and leaving the day
   * `approved` would let the signature cover something it never saw. The exception the calculation
   * raises says so out loud, and a human signs again.
   */
  public applyCalculation(
    result: CalculationResult,
    inputs: {
      readonly scheduleId?: string;
      readonly scheduleVersion?: number;
      readonly shiftId?: string;
      readonly rosterEntryId?: string;
      readonly policyId: string;
      readonly policyVersion: number;
      readonly zone: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): AttendanceResult<AttendanceDayState> {
    if (this.day.state === 'locked' && this.day.inputsDigest === result.inputsDigest) {
      // A locked day whose inputs have not moved is left alone. Recalculating it would churn the
      // row and the payable snapshot's basis for no change in the answer. The stale mark still
      // goes, or the day would sit in the reconciliation queue for ever asking to be redone.
      this.day = withoutKey(this.day, 'inputsChangedAt');
      return accept(this.day);
    }

    this.day = {
      // The stale mark is *removed* rather than set to undefined: the day has just been brought up
      // to date, and a key that still exists with an empty value would keep it in the
      // reconciliation query for ever.
      ...withoutKey(this.day, 'inputsChangedAt'),
      ...definedOnly(inputs),
      zone: inputs.zone,
      dayKind: result.dayKind,
      ...definedOnly({
        expectedStartAt: result.expectedStartAt,
        expectedEndAt: result.expectedEndAt,
        firstInAt: result.firstInAt,
        lastOutAt: result.lastOutAt,
      }),
      expectedMinutes: result.expectedMinutes,
      expectedBreakMinutes: result.expectedBreakMinutes,
      workedMinutes: result.workedMinutes,
      breakMinutesTaken: result.breakMinutesTaken,
      paidBreakMinutes: result.paidBreakMinutes,
      regularCandidateMinutes: result.regularCandidateMinutes,
      overtimeCandidateMinutes: result.overtimeCandidateMinutes,
      unpaidMinutes: result.unpaidMinutes,
      absenceMinutes: result.absenceMinutes,
      leaveState: result.leaveState,
      leaveMinutes: result.leaveMinutes,
      state: 'calculated',
      calculationVersion: result.calculationVersion,
      inputsDigest: result.inputsDigest,
      calculatedAt: occurredAt,
    };
    this.raise(
      AttendanceEvents.dayCalculated,
      {
        attendanceDayId: this.id,
        employmentId: this.day.employmentId,
        attendanceDate: this.day.attendanceDate,
        workedMinutes: this.day.workedMinutes,
      },
      origin,
      occurredAt,
    );
    return accept(this.day);
  }

  public beginReview(): AttendanceResult<DayState> {
    return this.moveTo('under_review');
  }

  /**
   * Signs the day off.
   *
   * Refused while a **blocking** exception is open, which is the only mechanical consequence a
   * severity has. A day whose clock-out never arrived has no defensible worked figure, and
   * approving one would put a number nobody can justify into a payable snapshot.
   */
  public approve(
    exceptions: readonly DayExceptionState[],
    approvedBy: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): AttendanceResult<DayState> {
    const blocking = exceptions.filter(isBlocking);

    if (blocking.length > 0) {
      return refuse('blocking_exceptions_open', { count: String(blocking.length) });
    }

    const moved = this.moveTo('approved');

    if (!moved.ok) return moved;

    this.day = { ...this.day, approvedAt: occurredAt, approvedBy };
    this.raise(
      AttendanceEvents.dayApproved,
      {
        attendanceDayId: this.id,
        employmentId: this.day.employmentId,
        attendanceDate: this.day.attendanceDate,
      },
      origin,
      occurredAt,
    );
    return accept(this.day.state);
  }

  /** Frozen into a payable snapshot. A later correction produces the next sequence, not an edit. */
  public lock(occurredAt: Date): AttendanceResult<DayState> {
    if (this.day.approvedAt === undefined) return refuse('day_not_approved');

    const moved = this.moveTo('locked');

    if (!moved.ok) return moved;

    this.day = { ...this.day, lockedAt: occurredAt };
    return accept(this.day.state);
  }

  public snapshot(): AttendanceDayState {
    return { ...this.day, version: this.version };
  }

  private moveTo(next: DayState): AttendanceResult<DayState> {
    const permitted = DAY_TRANSITIONS[this.day.state];

    if (!permitted.includes(next)) {
      return refuse('day_transition_not_permitted', { from: this.day.state, to: next });
    }
    this.day = { ...this.day, state: next };
    return accept(next);
  }
}

/** Removes one optional key entirely, which is not the same as setting it to `undefined`. */
const withoutKey = <TShape extends object, TKey extends keyof TShape>(
  shape: TShape,
  key: TKey,
): Omit<TShape, TKey> =>
  Object.fromEntries(Object.entries(shape).filter(([name]) => name !== key)) as Omit<TShape, TKey>;

/** One exception on a day, as the calculation found it. Resolved by a human or superseded by a re-run. */
export const dayException = (
  request: {
    readonly tenantId: string;
    readonly attendanceDayId: string;
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly kind: DayExceptionState['kind'];
    readonly severity: DayExceptionState['severity'];
    readonly minutes?: number;
    readonly detail?: string;
  },
  occurredAt: Date,
): DayExceptionState => ({
  id: uuidV7(occurredAt.getTime()),
  tenantId: request.tenantId,
  attendanceDayId: request.attendanceDayId,
  employmentId: request.employmentId,
  attendanceDate: request.attendanceDate,
  kind: request.kind,
  severity: request.severity,
  state: 'open',
  ...(request.minutes === undefined ? {} : { minutes: request.minutes }),
  ...(request.detail === undefined ? {} : { detail: request.detail }),
  version: 0,
});

/** Resolving or waiving an exception. Both name a human and a reason; neither deletes anything. */
export const resolveException = (
  exception: DayExceptionState,
  decision: {
    readonly state: 'resolved' | 'waived';
    readonly reasonCode: string;
    readonly resolvedBy: string;
  },
  occurredAt: Date,
): AttendanceResult<DayExceptionState> => {
  if (exception.state !== 'open') return refuse('exception_already_concluded');

  const reasonCode = checkedOptionalCode(decision.reasonCode, 'reasonCode');

  if (!reasonCode.ok) return reasonCode;

  return accept({
    ...exception,
    state: decision.state,
    ...(reasonCode.value === undefined ? {} : { resolutionReasonCode: reasonCode.value }),
    resolvedAt: occurredAt,
    resolvedBy: decision.resolvedBy,
  });
};
