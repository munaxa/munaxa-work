import { uuidV7 } from '@work/kernel';

import {
  AttendanceAggregate,
  bilingualFrom,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  checkedZone,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import { daysBetween, type DefinitionStatus } from './attendance-vocabulary.js';

/**
 * A schedule: shifts arranged over a repeating cycle, in an explicit time zone.
 *
 * **The zone is required, and it is the decision that lets Attendance resolve a local date without
 * a work-location model.** A shift written `08:00–17:00` is not a time until something says where;
 * this product has no location model and ADR-0041 explains why inventing one here would be worse
 * than the gap. So the zone belongs to the schedule — which is also the more correct answer, since
 * two teams in one tenant on two continents get two zones without either depending on where
 * Organization happens to have modelled them (ADR-0055).
 *
 * **A cycle rather than a set of dates.** `cycleLengthDays` with an anchor expresses a weekly rota
 * as seven positions, a four-week rotation as twenty-eight, and a fixed daily pattern as one — and,
 * unlike a materialised calendar, it answers "which shift applied on 3 March 2027" without anybody
 * having generated 2027 yet.
 *
 * **Immutable once published.** Improving a rota drafts the next version; the published one stays
 * as it was, because days were calculated from it.
 */

export interface ScheduleState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly zone: string;
  readonly cycleLengthDays: number;
  /** The civil date at which cycle position 0 begins. What makes a rotation reconstructable. */
  readonly cycleAnchorDate: string;
  readonly status: DefinitionStatus;
  readonly versionNumber: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

/** One position in the cycle. A position with no row is a rest day, and the absence is meaningful. */
export interface ScheduleDayState {
  readonly id: string;
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly cyclePosition: number;
  readonly shiftId: string;
  readonly version: number;
}

export interface DefineSchedule {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly zone: string;
  readonly cycleLengthDays: number;
  readonly cycleAnchorDate: string;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

const MAX_CYCLE_DAYS = 366;

export class Schedule extends AttendanceAggregate {
  private constructor(private state: ScheduleState) {
    super(state.id, state.tenantId, state.version, 'AttendanceSchedule');
  }

  public static define(request: DefineSchedule, occurredAt: Date): AttendanceResult<Schedule> {
    const code = checkedCode(request.code, 'code');

    if (!code.ok) return code;

    const name = bilingualFrom(request.name, 'name');

    if (!name.ok) return name;

    const zone = checkedZone(request.zone);

    if (!zone.ok) return zone;

    const anchor = checkedCivilDate(request.cycleAnchorDate, 'cycleAnchorDate');

    if (!anchor.ok) return anchor;

    if (
      !Number.isInteger(request.cycleLengthDays) ||
      request.cycleLengthDays < 1 ||
      request.cycleLengthDays > MAX_CYCLE_DAYS
    ) {
      return refuse('cycle_length_out_of_range');
    }

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new Schedule({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        code: code.value,
        name: name.value,
        zone: zone.value,
        cycleLengthDays: request.cycleLengthDays,
        cycleAnchorDate: anchor.value,
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: ScheduleState): Schedule {
    return new Schedule(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public get zone(): string {
    return this.state.zone;
  }

  public get isEditable(): boolean {
    return this.state.status === 'draft';
  }

  /**
   * Which cycle position a civil date falls on.
   *
   * Whole days from the anchor, wrapped. A negative difference — a date before the anchor — wraps
   * forward rather than producing a negative index, so a schedule anchored in the future still
   * answers for the past instead of throwing.
   */
  public positionOn(civilDate: string): number {
    const elapsed = daysBetween(this.state.cycleAnchorDate, civilDate);
    const length = this.state.cycleLengthDays;

    return ((elapsed % length) + length) % length;
  }

  public publish(
    dayCount: number,
    publishedBy: string,
    occurredAt: Date,
  ): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'draft') return refuse('schedule_not_draft');
    // A cycle with no working position expects nothing of anybody, for ever. That is a rest
    // pattern rather than a schedule, and publishing it as one hides the mistake.
    if (dayCount === 0) return refuse('schedule_has_no_working_day');

    this.state = { ...this.state, status: 'published', publishedAt: occurredAt, publishedBy };
    return accept(this.state.status);
  }

  public supersede(): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'published') return refuse('schedule_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state.status);
  }

  public snapshot(): ScheduleState {
    return { ...this.state, version: this.version };
  }
}

export const scheduleDay = (
  request: {
    readonly tenantId: string;
    readonly scheduleId: string;
    readonly cyclePosition: number;
    readonly shiftId: string;
    readonly cycleLengthDays: number;
  },
  occurredAt: Date,
): AttendanceResult<ScheduleDayState> => {
  if (
    !Number.isInteger(request.cyclePosition) ||
    request.cyclePosition < 0 ||
    request.cyclePosition >= request.cycleLengthDays
  ) {
    return refuse('cycle_position_out_of_range');
  }
  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    scheduleId: request.scheduleId,
    cyclePosition: request.cyclePosition,
    shiftId: request.shiftId,
    version: 0,
  });
};

/**
 * Which schedule an employment follows, from when.
 *
 * Effective-dated and non-overlapping: two schedules in force on one day is two answers to when
 * somebody was expected at work, and the system must be incapable of holding both. A *gap* is
 * legitimate and means the employment was unscheduled — a casual worker between engagements is a
 * real thing, and forcing a schedule onto them would invent absences.
 */
export interface ScheduleAssignmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly scheduleId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
  readonly version: number;
}

export interface AssignSchedule {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly scheduleId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export const scheduleAssignment = (
  request: AssignSchedule,
  occurredAt: Date,
): AttendanceResult<ScheduleAssignmentState> => {
  const from = checkedCivilDate(request.effectiveFrom, 'effectiveFrom');

  if (!from.ok) return from;

  const reasonCode = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reasonCode.ok) return reasonCode;

  if (request.effectiveTo !== undefined) {
    const to = checkedCivilDate(request.effectiveTo, 'effectiveTo');

    if (!to.ok) return to;
    if (to.value < from.value) return refuse('period_ends_before_it_begins');
  }
  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    scheduleId: request.scheduleId,
    effectiveFrom: from.value,
    ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
    ...(reasonCode.value === undefined ? {} : { reasonCode: reasonCode.value }),
    version: 0,
  });
};

/** The assignment in force on a civil date, or nothing. The read every calculation makes. */
export const assignmentOn = (
  assignments: readonly ScheduleAssignmentState[],
  civilDate: string,
): ScheduleAssignmentState | undefined =>
  assignments.find(
    (assignment) =>
      assignment.effectiveFrom <= civilDate &&
      (assignment.effectiveTo === undefined || civilDate <= assignment.effectiveTo),
  );

/** Whether a proposed period would overlap one already in force. Refused rather than merged. */
export const overlaps = (
  assignments: readonly ScheduleAssignmentState[],
  proposed: { readonly effectiveFrom: string; readonly effectiveTo?: string },
): boolean =>
  assignments.some(
    (assignment) =>
      (proposed.effectiveTo === undefined || assignment.effectiveFrom <= proposed.effectiveTo) &&
      (assignment.effectiveTo === undefined || proposed.effectiveFrom <= assignment.effectiveTo),
  );
