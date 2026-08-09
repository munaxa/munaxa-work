import { success, type Command, type CommandHandler } from '@work/kernel';

import { Shift, shiftSegment } from '../domain/shift.js';
import type { SegmentKind, ShiftKind } from '../domain/attendance-vocabulary.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  refusedBy,
} from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Defining a shift, giving it segments, and freezing it.
 *
 * **Publishing is a separate permission from drafting**, on the argument ADR-0048 made for plan
 * versions and which applies with more force here: a published shift is what a hundred people are
 * measured against every morning, and improving next quarter's pattern is ordinary work.
 */

export interface ShiftAffected {
  readonly shiftId: string;
  readonly code: string;
  readonly status: string;
}

export interface DefineShiftCommand extends Command {
  readonly commandName: 'attendance.define-shift';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly kind: ShiftKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly flexWindowMinutes?: number;
  readonly coreStartLocal?: string;
  readonly coreEndLocal?: string;
  readonly graceInMinutes?: number;
  readonly graceOutMinutes?: number;
  readonly expectedMinutes?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

export const defineShiftHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<DefineShiftCommand, ShiftAffected> => ({
  commandName: 'attendance.define-shift',
  permission: AttendancePermissions.scheduleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.shifts.byCode(transaction, command.code);

      // Checked here as well as by the unique index, so the caller gets "that code is taken"
      // rather than a constraint violation they cannot act on.
      if (existing !== undefined) return conflicted('shift_code_taken');

      const shift = Shift.define(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!shift.ok) return refusedBy(shift.error);

      await dependencies.stores.shifts.insert(transaction, shift.value.snapshot());
      return success({
        shiftId: shift.value.id,
        code: shift.value.code,
        status: shift.value.status,
      });
    }),
});

export interface AddSegmentCommand extends Command {
  readonly commandName: 'attendance.add-shift-segment';
  readonly shiftId: string;
  readonly sequence: number;
  readonly kind: SegmentKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly paid?: boolean;
}

/** Adding a segment. Refused on a published shift — the rule the whole model rests on. */
export const addSegmentHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<AddSegmentCommand, ShiftAffected> => ({
  commandName: 'attendance.add-shift-segment',
  permission: AttendancePermissions.scheduleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.shifts.byId(transaction, command.shiftId);

      if (state === undefined) return notFound<ShiftAffected>('shift');
      if (state.status !== 'draft') return conflicted('shift_not_draft');

      const segment = shiftSegment(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!segment.ok) return refusedBy(segment.error);

      await dependencies.stores.segments.insert(transaction, segment.value);
      return success({ shiftId: state.id, code: state.code, status: state.status });
    }),
});

export interface PublishShiftCommand extends Command {
  readonly commandName: 'attendance.publish-shift';
  readonly shiftId: string;
  readonly expectedVersion: number;
}

export const publishShiftHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<PublishShiftCommand, ShiftAffected> => ({
  commandName: 'attendance.publish-shift',
  permission: AttendancePermissions.schedulePublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.shifts.byId(transaction, command.shiftId);

      if (state === undefined) return notFound<ShiftAffected>('shift');

      const segments = await dependencies.stores.segments.forShift(transaction, state.id);
      const shift = Shift.rehydrate(state);
      const published = shift.publish(
        segments.filter((segment) => segment.kind === 'work').length,
        currentActor(),
        dependencies.clock.now(),
      );

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.shifts.update(
        transaction,
        shift.snapshot(),
        command.expectedVersion,
      );
      return success({ shiftId: shift.id, code: shift.code, status: shift.status });
    }),
});
