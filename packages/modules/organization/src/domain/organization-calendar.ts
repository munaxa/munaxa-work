import { map, uuidV7, type EventOrigin } from '@work/kernel';

import {
  OrganizationAggregate,
  checkedCode,
  nameFrom,
  type BilingualName,
} from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import {
  CALENDAR_DAY_KINDS,
  isIsoWeekday,
  type CalendarDayKind,
  type IsoWeekday,
  type OrganizationStatus,
} from './organization-vocabulary.js';

/**
 * An organizational calendar: which days this part of the organization works, and which
 * particular dates it does not.
 *
 * Attendance and Leave consume these from Phase 8 onward. Organization does not calculate
 * attendance and holds no entitlement — it states the shape of the working week and the
 * exceptions to it, and stops there.
 *
 * **Nothing in this file knows a single holiday.** Not Eid, not National Day, not a weekend.
 * The working week is `workingDays`, supplied by the tenant, and the holidays are rows the
 * tenant or a country pack writes. That is 00B's rule made structural: a customer in Amman and
 * one in Riyadh disagree about both, the disagreement is data, and adding a country must never
 * be a change to this file.
 *
 * Dates are stored as calendar days rather than instants, and the calendar carries its own time
 * zone. A holiday is a *day in a place*, not a moment: storing it as an instant makes it land on
 * the wrong date for anybody east or west of whoever entered it.
 */

export interface CalendarDay {
  /** The civil date, as `YYYY-MM-DD` in the calendar's own time zone. */
  readonly onDate: string;
  readonly kind: CalendarDayKind;
  readonly name: BilingualName;
}

export interface OrganizationCalendarState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualName;
  /** The unit this calendar applies to. Absent means it applies tenant-wide. */
  readonly unitId?: string;
  readonly timeZone: string;
  /** ISO weekdays that are ordinarily worked. Tenant configuration; there is no default here. */
  readonly workingDays: readonly IsoWeekday[];
  readonly status: OrganizationStatus;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface DefineCalendar {
  readonly tenantId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly timeZone: string;
  readonly workingDays: readonly number[];
  readonly effectiveFrom: Date;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class OrganizationCalendar extends OrganizationAggregate {
  private constructor(private state: OrganizationCalendarState) {
    super(state.id, state.tenantId, state.version, 'OrganizationCalendar');
  }

  /** Checks in sequence, first failure returned. See `OrganizationUnit.create` for why. */
  public static define(
    request: DefineCalendar,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationCalendar> {
    const code = checkedCode(request.code);

    if (!code.ok) return code;

    const name = nameFrom(request.name);

    if (!name.ok) return name;

    const timeZone = checkedTimeZone(request.timeZone);

    if (!timeZone.ok) return timeZone;

    const workingDays = checkedWorkingDays(request.workingDays);

    if (!workingDays.ok) return workingDays;

    const calendar = new OrganizationCalendar({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      code: code.value,
      name: name.value,
      ...(request.unitId === undefined ? {} : { unitId: request.unitId }),
      timeZone: timeZone.value,
      workingDays: workingDays.value,
      status: 'active',
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    calendar.raise(
      OrganizationEvents.calendarDefined,
      {
        calendarId: calendar.id,
        code: code.value,
        unitId: request.unitId ?? null,
        timeZone: timeZone.value,
      },
      origin,
      occurredAt,
    );
    return accept(calendar);
  }

  public static rehydrate(state: OrganizationCalendarState): OrganizationCalendar {
    return new OrganizationCalendar(state);
  }

  public get code(): string {
    return this.state.code;
  }

  public get timeZone(): string {
    return this.state.timeZone;
  }

  public get workingDays(): readonly IsoWeekday[] {
    return this.state.workingDays;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  /**
   * Whether an ISO weekday is ordinarily worked. A particular date may still be overridden by a
   * calendar day, which is what `organization_calendar_day` records — and resolving the two is
   * Attendance's job, not this aggregate's.
   */
  public ordinarilyWorks(weekday: IsoWeekday): boolean {
    return this.state.workingDays.includes(weekday);
  }

  public amend(
    changes: {
      readonly name?: Readonly<Record<string, string>>;
      readonly timeZone?: string;
      readonly workingDays?: readonly number[];
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationCalendarState> {
    if (this.state.status === 'closed') return refuse('calendar_closed');

    const name = optionalName(changes.name);

    if (!name.ok) return name;

    const timeZone = optionalTimeZone(changes.timeZone);

    if (!timeZone.ok) return timeZone;

    const workingDays = optionalWorkingDays(changes.workingDays);

    if (!workingDays.ok) return workingDays;

    this.state = {
      ...this.state,
      ...(name.value === undefined ? {} : { name: name.value }),
      ...(timeZone.value === undefined ? {} : { timeZone: timeZone.value }),
      ...(workingDays.value === undefined ? {} : { workingDays: workingDays.value }),
    };
    this.raise(
      OrganizationEvents.calendarAmended,
      { calendarId: this.id, changed: Object.keys(changes) },
      origin,
      occurredAt,
    );
    return accept(this.state);
  }

  /**
   * Records what one date is.
   *
   * The aggregate validates and raises; the day itself is a row, because a calendar with twenty
   * years of holidays loaded as one aggregate is an aggregate nobody can save.
   */
  public recordDay(
    day: {
      readonly onDate: string;
      readonly kind: CalendarDayKind;
      readonly name: Readonly<Record<string, string>>;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<CalendarDay> {
    if (this.state.status === 'closed') return refuse('calendar_closed');
    if (!ISO_DATE.test(day.onDate)) return refuse('calendar_date_malformed', { date: day.onDate });
    if (!CALENDAR_DAY_KINDS.includes(day.kind)) {
      return refuse('calendar_day_kind_unknown', { kind: day.kind });
    }

    return map(nameFrom(day.name), (name) => {
      this.raise(
        OrganizationEvents.calendarDayRecorded,
        { calendarId: this.id, onDate: day.onDate, kind: day.kind },
        origin,
        occurredAt,
      );
      return { onDate: day.onDate, kind: day.kind, name };
    });
  }

  public removeDay(
    onDate: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<string> {
    if (!ISO_DATE.test(onDate)) return refuse('calendar_date_malformed', { date: onDate });

    this.raise(
      OrganizationEvents.calendarDayRemoved,
      { calendarId: this.id, onDate },
      origin,
      occurredAt,
    );
    return accept(onDate);
  }

  public close(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationStatus> {
    if (this.state.status === 'closed') return refuse('calendar_closed');

    this.state = { ...this.state, status: 'closed', effectiveTo };
    this.raise(
      OrganizationEvents.calendarAmended,
      { calendarId: this.id, changed: ['status'], effectiveTo },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public snapshot(): OrganizationCalendarState {
    return { ...this.state, version: this.version };
  }
}

/**
 * An IANA zone, checked by asking the platform rather than against a list we would have to
 * maintain — and which would be wrong within a year, because zones genuinely change.
 */
const checkedTimeZone = (value: string): OrganizationResult<string> => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return accept(value);
  } catch {
    return refuse('time_zone_unknown', { timeZone: value });
  }
};

/**
 * A working week with no working days is not a calendar, it is a mistake with a save button.
 * Seven working days is legitimate — continuous operations exist — so only the empty case is
 * refused.
 */
const checkedWorkingDays = (
  values: readonly number[],
): OrganizationResult<readonly IsoWeekday[]> => {
  const invalid = values.find((value) => !isIsoWeekday(value));

  if (invalid !== undefined) return refuse('weekday_out_of_range', { weekday: String(invalid) });

  const unique = [...new Set(values)].filter(isIsoWeekday).sort((left, right) => left - right);

  if (unique.length === 0) return refuse('working_week_empty');
  return accept(unique);
};

const optionalName = (
  value: Readonly<Record<string, string>> | undefined,
): OrganizationResult<BilingualName | undefined> =>
  value === undefined ? accept(undefined) : nameFrom(value);

const optionalTimeZone = (value: string | undefined): OrganizationResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedTimeZone(value);

const optionalWorkingDays = (
  values: readonly number[] | undefined,
): OrganizationResult<readonly IsoWeekday[] | undefined> =>
  values === undefined ? accept(undefined) : checkedWorkingDays(values);
