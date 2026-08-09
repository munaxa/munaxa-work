import { uuidV7 } from '@work/kernel';

import {
  AttendanceAggregate,
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedMinutes,
  checkedOptionalWallClock,
  checkedWallClock,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import {
  MINUTES_PER_DAY,
  SEGMENT_KINDS,
  SHIFT_KINDS,
  crossesMidnight,
  minutesOfDay,
  type DefinitionStatus,
  type SegmentKind,
  type ShiftKind,
} from './attendance-vocabulary.js';

/**
 * A shift: the pattern of time a working day is expected to contain.
 *
 * **Wall-clock times, and no zone of its own.** `08:00` is not an instant, and which instant it is
 * depends on where the work happens — but two sites in two countries may run the same shift, so the
 * zone belongs to the *schedule* that places the shift, not to the shift itself (ADR-0055).
 *
 * **Immutable once published**, and that is the mechanism the whole model rests on. A supervisor
 * improving next quarter's pattern creates the *next* version; the published one stays exactly as
 * it was, because attendance days were calculated from it and somebody will dispute one
 * (ADR-0048's argument, applied to time rather than to a checklist).
 *
 * **`expectedMinutes` is authored rather than derived**, and that is deliberate. On a day the
 * clocks go forward, the interval between 08:00 and 17:00 is eight hours rather than nine; what was
 * *asked* of the person did not change, and a figure recomputed from the interval would silently
 * turn a transition night into an hour of absence.
 */

export interface ShiftState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: ShiftKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly crossesMidnight: boolean;
  readonly flexWindowMinutes?: number;
  readonly coreStartLocal?: string;
  readonly coreEndLocal?: string;
  readonly graceInMinutes: number;
  readonly graceOutMinutes: number;
  readonly expectedMinutes: number;
  readonly status: DefinitionStatus;
  readonly versionNumber: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface SegmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly shiftId: string;
  readonly sequence: number;
  readonly kind: SegmentKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly paid: boolean;
  readonly version: number;
}

export interface DefineShift {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly kind: ShiftKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly flexWindowMinutes?: number;
  readonly coreStartLocal?: string;
  readonly coreEndLocal?: string;
  readonly graceInMinutes?: number;
  readonly graceOutMinutes?: number;
  /** Defaults to the span between start and end, less any unpaid break the segments declare. */
  readonly expectedMinutes?: number;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

const MAX_GRACE_MINUTES = 240;
const MAX_FLEX_MINUTES = 720;

export class Shift extends AttendanceAggregate {
  private constructor(private state: ShiftState) {
    super(state.id, state.tenantId, state.version, 'AttendanceShift');
  }

  public static define(request: DefineShift, occurredAt: Date): AttendanceResult<Shift> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const times = checkedTimes(request);

    if (!times.ok) return times;

    const tolerances = checkedTolerances(request);

    if (!tolerances.ok) return tolerances;

    return accept(
      new Shift({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        ...identity.value,
        ...times.value,
        ...tolerances.value,
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: ShiftState): Shift {
    return new Shift(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public get code(): string {
    return this.state.code;
  }

  public get isEditable(): boolean {
    return this.state.status === 'draft';
  }

  /**
   * Publishes the shift, naming who published it.
   *
   * A shift with no work segment is refused. Publishing one produces days that expect nothing and
   * complete the moment they begin — which is worse than having no shift at all, because it looks
   * like an expectation was set.
   */
  public publish(
    workSegmentCount: number,
    publishedBy: string,
    occurredAt: Date,
  ): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'draft') return refuse('shift_not_draft');
    if (workSegmentCount === 0) return refuse('shift_has_no_work_segment');

    this.state = { ...this.state, status: 'published', publishedAt: occurredAt, publishedBy };
    return accept(this.state.status);
  }

  /** Replaced by a later published version. Days generated from it are untouched. */
  public supersede(): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'published') return refuse('shift_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state.status);
  }

  public snapshot(): ShiftState {
    return { ...this.state, version: this.version };
  }
}

const checkedIdentity = (
  request: DefineShift,
): AttendanceResult<Pick<ShiftState, 'code' | 'name' | 'kind' | 'metadata'>> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  if (!SHIFT_KINDS.includes(request.kind)) return refuse('shift_kind_unknown');

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    code: code.value,
    name: name.value,
    kind: request.kind,
    metadata: metadata.value,
  });
};

type ShiftTimes = Pick<
  ShiftState,
  'startLocal' | 'endLocal' | 'crossesMidnight' | 'expectedMinutes'
> &
  Partial<Pick<ShiftState, 'coreStartLocal' | 'coreEndLocal'>>;

const checkedTimes = (request: DefineShift): AttendanceResult<ShiftTimes> => {
  const startLocal = checkedWallClock(request.startLocal, 'startLocal');

  if (!startLocal.ok) return startLocal;

  const endLocal = checkedWallClock(request.endLocal, 'endLocal');

  if (!endLocal.ok) return endLocal;

  const core = checkedCore(request);

  if (!core.ok) return core;

  const overnight = crossesMidnight(startLocal.value, endLocal.value);
  const span = overnight
    ? MINUTES_PER_DAY - minutesOfDay(startLocal.value) + minutesOfDay(endLocal.value)
    : minutesOfDay(endLocal.value) - minutesOfDay(startLocal.value);
  const expected = checkedMinutes(request.expectedMinutes ?? span, 'expectedMinutes', {
    min: 0,
    max: MINUTES_PER_DAY,
  });

  if (!expected.ok) return expected;

  return accept({
    startLocal: startLocal.value,
    endLocal: endLocal.value,
    crossesMidnight: overnight,
    expectedMinutes: expected.value,
    ...core.value,
  });
};

/** Core hours belong to a flexible shift, and both ends are needed or neither. */
const checkedCore = (
  request: DefineShift,
): AttendanceResult<Partial<Pick<ShiftState, 'coreStartLocal' | 'coreEndLocal'>>> => {
  const coreStart = checkedOptionalWallClock(request.coreStartLocal, 'coreStartLocal');

  if (!coreStart.ok) return coreStart;

  const coreEnd = checkedOptionalWallClock(request.coreEndLocal, 'coreEndLocal');

  if (!coreEnd.ok) return coreEnd;

  if ((coreStart.value === undefined) !== (coreEnd.value === undefined)) {
    return refuse('core_hours_incomplete');
  }
  if (coreStart.value !== undefined && request.kind !== 'flexible') {
    return refuse('core_hours_need_a_flexible_shift');
  }
  return accept({
    ...(coreStart.value === undefined ? {} : { coreStartLocal: coreStart.value }),
    ...(coreEnd.value === undefined ? {} : { coreEndLocal: coreEnd.value }),
  });
};

type ShiftTolerances = Pick<ShiftState, 'graceInMinutes' | 'graceOutMinutes'> &
  Partial<Pick<ShiftState, 'flexWindowMinutes'>>;

const checkedTolerances = (request: DefineShift): AttendanceResult<ShiftTolerances> => {
  const graceIn = checkedMinutes(request.graceInMinutes ?? 0, 'graceInMinutes', {
    min: 0,
    max: MAX_GRACE_MINUTES,
  });

  if (!graceIn.ok) return graceIn;

  const graceOut = checkedMinutes(request.graceOutMinutes ?? 0, 'graceOutMinutes', {
    min: 0,
    max: MAX_GRACE_MINUTES,
  });

  if (!graceOut.ok) return graceOut;

  // A flex window on a fixed shift is a rule nobody would find, and a flexible shift without one
  // is a fixed shift wearing the wrong name. The database says the same thing.
  if ((request.kind === 'flexible') !== (request.flexWindowMinutes !== undefined)) {
    return refuse('flex_window_needs_a_flexible_shift');
  }
  if (request.flexWindowMinutes === undefined) {
    return accept({ graceInMinutes: graceIn.value, graceOutMinutes: graceOut.value });
  }

  const flex = checkedMinutes(request.flexWindowMinutes, 'flexWindowMinutes', {
    min: 0,
    max: MAX_FLEX_MINUTES,
  });

  if (!flex.ok) return flex;

  return accept({
    graceInMinutes: graceIn.value,
    graceOutMinutes: graceOut.value,
    flexWindowMinutes: flex.value,
  });
};

export interface DefineSegment {
  readonly tenantId: string;
  readonly shiftId: string;
  readonly sequence: number;
  readonly kind: SegmentKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly paid?: boolean;
}

/**
 * One segment of a shift: worked time, or a break.
 *
 * A split shift is two `work` segments with a gap between them, and the gap is neither a break nor
 * worked time — it is simply not part of the shift, which is what a split shift means.
 */
export const shiftSegment = (
  request: DefineSegment,
  occurredAt: Date,
): AttendanceResult<SegmentState> => {
  if (!SEGMENT_KINDS.includes(request.kind)) return refuse('segment_kind_unknown');
  if (!Number.isInteger(request.sequence) || request.sequence < 1) {
    return refuse('segment_sequence_out_of_range');
  }

  const startLocal = checkedWallClock(request.startLocal, 'startLocal');

  if (!startLocal.ok) return startLocal;

  const endLocal = checkedWallClock(request.endLocal, 'endLocal');

  if (!endLocal.ok) return endLocal;

  // A work segment is worked time by definition; the flag exists for breaks, where paid and unpaid
  // are genuinely different answers to what the day is worth.
  const paid = request.kind === 'work' ? true : (request.paid ?? false);

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    shiftId: request.shiftId,
    sequence: request.sequence,
    kind: request.kind,
    startLocal: startLocal.value,
    endLocal: endLocal.value,
    paid,
    version: 0,
  });
};
