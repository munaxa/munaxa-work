import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { OrganizationCalendar } from '../domain/organization-calendar.js';
import type { CalendarDayKind, OrganizationStatus } from '../domain/organization-vocabulary.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Defining organizational calendars and the particular dates that are exceptions to them.
 *
 * Attendance and Leave consume these from Phase 8. Organization states the shape of the working
 * week and its exceptions, and calculates nothing.
 *
 * No command here seeds a holiday, and none ever will. Which dates a country observes is country
 * pack content (Phase 11.1) or the tenant's own decision, loaded through these commands like any
 * other data. A "seed Saudi holidays" command would be a country in this module's source, which
 * 00B prohibits outright.
 */

export interface DefineCalendarCommand extends Command {
  readonly commandName: 'organization.define-calendar';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly timeZone: string;
  readonly workingDays: readonly number[];
  readonly effectiveFrom: Date;
}

export interface CalendarChanged {
  readonly calendarId: string;
  readonly code: string;
  readonly status: OrganizationStatus;
}

export const defineCalendarHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<DefineCalendarCommand, CalendarChanged> => ({
  commandName: 'organization.define-calendar',
  permission: OrganizationPermissions.calendarManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (command.unitId !== undefined) {
        const unit = await dependencies.stores.units.byId(transaction, command.unitId);

        if (unit === undefined) return notFound<CalendarChanged>('unit');
      }

      const taken = await dependencies.stores.calendars.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<CalendarChanged>('calendar_code_taken');

      const defined = OrganizationCalendar.define(
        {
          tenantId: currentTenant(),
          code: command.code,
          name: command.name,
          ...(command.unitId === undefined ? {} : { unitId: command.unitId }),
          timeZone: command.timeZone,
          workingDays: command.workingDays,
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!defined.ok) return refusedBy(defined.error);

      await dependencies.stores.calendars.insert(transaction, defined.value.snapshot());
      transaction.collect(defined.value.pullEvents());
      return success({
        calendarId: defined.value.id,
        code: defined.value.code,
        status: defined.value.currentStatus,
      });
    }),
});

export interface AmendCalendarCommand extends Command {
  readonly commandName: 'organization.amend-calendar';
  readonly calendarId: string;
  readonly name?: Readonly<Record<string, string>>;
  readonly timeZone?: string;
  readonly workingDays?: readonly number[];
  readonly expectedVersion: number;
}

export const amendCalendarHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<AmendCalendarCommand, CalendarChanged> => ({
  commandName: 'organization.amend-calendar',
  permission: OrganizationPermissions.calendarManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.calendars.byId(transaction, command.calendarId);

      if (existing === undefined) return notFound<CalendarChanged>('calendar');

      const calendar = OrganizationCalendar.rehydrate(existing);
      const amended = calendar.amend(
        {
          ...(command.name === undefined ? {} : { name: command.name }),
          ...(command.timeZone === undefined ? {} : { timeZone: command.timeZone }),
          ...(command.workingDays === undefined ? {} : { workingDays: command.workingDays }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.calendars.update(
        transaction,
        calendar.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(calendar.pullEvents());
      return success({
        calendarId: calendar.id,
        code: calendar.code,
        status: calendar.currentStatus,
      });
    }),
});

export interface RecordCalendarDayCommand extends Command {
  readonly commandName: 'organization.record-calendar-day';
  readonly calendarId: string;
  /** `YYYY-MM-DD` in the calendar's own time zone. A holiday is a day in a place, not a moment. */
  readonly onDate: string;
  readonly kind: CalendarDayKind;
  readonly name: Readonly<Record<string, string>>;
}

export interface CalendarDayChanged {
  readonly calendarId: string;
  readonly onDate: string;
}

export const recordCalendarDayHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RecordCalendarDayCommand, CalendarDayChanged> => ({
  commandName: 'organization.record-calendar-day',
  permission: OrganizationPermissions.calendarManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.calendars.byId(transaction, command.calendarId);

      if (existing === undefined) return notFound<CalendarDayChanged>('calendar');

      const calendar = OrganizationCalendar.rehydrate(existing);
      const recorded = calendar.recordDay(
        { onDate: command.onDate, kind: command.kind, name: command.name },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!recorded.ok) return refusedBy(recorded.error);

      const stored = await dependencies.stores.calendars.dayOn(
        transaction,
        command.calendarId,
        command.onDate,
      );

      // Recording a date that already has an entry replaces it. A holiday is a fact about a
      // date, and two facts about the same date is what makes a working-day count ambiguous.
      await dependencies.stores.calendars.upsertDay(transaction, {
        id: stored?.id ?? uuidV7(dependencies.clock.now().getTime()),
        tenantId: currentTenant(),
        calendarId: command.calendarId,
        version: stored?.version ?? 0,
        ...recorded.value,
      });
      transaction.collect(calendar.pullEvents());
      return success({ calendarId: calendar.id, onDate: command.onDate });
    }),
});

export interface RemoveCalendarDayCommand extends Command {
  readonly commandName: 'organization.remove-calendar-day';
  readonly calendarId: string;
  readonly onDate: string;
}

export const removeCalendarDayHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RemoveCalendarDayCommand, CalendarDayChanged> => ({
  commandName: 'organization.remove-calendar-day',
  permission: OrganizationPermissions.calendarManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.calendars.byId(transaction, command.calendarId);

      if (existing === undefined) return notFound<CalendarDayChanged>('calendar');

      const day = await dependencies.stores.calendars.dayOn(
        transaction,
        command.calendarId,
        command.onDate,
      );

      if (day === undefined) return notFound<CalendarDayChanged>('calendar day');

      const calendar = OrganizationCalendar.rehydrate(existing);
      const removed = calendar.removeDay(
        command.onDate,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!removed.ok) return refusedBy(removed.error);

      await dependencies.stores.calendars.removeDay(
        transaction,
        command.calendarId,
        command.onDate,
      );
      transaction.collect(calendar.pullEvents());
      return success({ calendarId: calendar.id, onDate: command.onDate });
    }),
});
