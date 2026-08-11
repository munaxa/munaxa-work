import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  AttendanceDashboardView,
  AttendanceDayView,
  AttendanceExceptionView,
  TimeEventView,
} from '@work/attendance/contracts';

import type { Language } from './locale';

/**
 * The operational half of the attendance screen: what happened, and what needs a human.
 *
 * Four things this screen does deliberately.
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked. Rendering a truncated
 * identifier is honest; caching a name here would be a second answer that goes stale on the first
 * correction.
 *
 * **It shows what is awaiting recalculation.** That number is the one on this page that reveals a
 * *failure*: event delivery in this product is at-most-once, and a day whose inputs moved is found
 * by asking rather than by being told. Showing the count turns a silent gap into something somebody
 * can act on.
 *
 * **It shows minutes, never money.** `overtimeCandidateMinutes` is rendered as minutes and labelled
 * a candidate, because what worked time is worth is Compensation's and Payroll's (ADR-0054).
 *
 * **It shows an unknown leave state as unknown.** Not as "no leave", and not as a blank — the
 * difference is whether somebody's record says they were absent without leave or says the question
 * is still open (ADR-0056).
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/** Minutes, rendered as minutes. No conversion to a rate, an amount or a decimal of a day. */
export const minutes = (t: Translate, value: number): string =>
  t('attendance.label.minutes').replace('{minutes}', String(value));

const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const DashboardSection = ({
  t,
  dashboard,
  unavailable,
}: SectionProps & {
  readonly dashboard: AttendanceDashboardView | undefined;
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.dashboard')}</h2>

    {unavailable || dashboard === undefined ? (
      <p className="text-sm opacity-70">{t('attendance.label.unavailable')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Figure t={t} label="expected" value={dashboard.expected} />
        <Figure t={t} label="present" value={dashboard.present} />
        <Figure t={t} label="late" value={dashboard.late} />
        <Figure t={t} label="pendingExplanation" value={dashboard.absencePendingExplanation} />
        <Figure t={t} label="openExceptions" value={dashboard.openExceptions} />
        {/* The failure number, shown beside the rest rather than hidden in an operations view. */}
        <Figure t={t} label="awaitingRecalculation" value={dashboard.awaitingRecalculation} />
      </dl>
    )}
  </Card>
);

const Figure = ({
  t,
  label,
  value,
}: {
  readonly t: Translate;
  readonly label: string;
  readonly value: number;
}): ReactNode => (
  <div className="flex flex-col">
    <dt className="opacity-70">{t(`attendance.label.${label}`)}</dt>
    <dd className="text-xl font-semibold">{value}</dd>
  </div>
);

export const DaysSection = ({
  t,
  days,
}: SectionProps & { readonly days: readonly AttendanceDayView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.days')}</h2>

    {days.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {days.map((day) => (
          <li key={day.attendanceDayId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{day.attendanceDate}</span>
            <span className="font-mono opacity-70">{short(day.employmentId)}</span>
            <span>{t(`attendance.day.${day.state}`)}</span>
            <span className="opacity-70">
              {t('attendance.label.workedMinutes')}: {minutes(t, day.workedMinutes)}
            </span>
            <span className="opacity-70">
              {t('attendance.label.expectedMinutes')}: {minutes(t, day.expectedMinutes)}
            </span>
            <span className="opacity-70">
              {t('attendance.label.overtimeMinutes')}: {minutes(t, day.overtimeCandidateMinutes)}
            </span>
            <span className="opacity-70">
              {t('attendance.label.leave')}: {t(`attendance.leave.${day.leaveState}`)}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const ExceptionsSection = ({
  t,
  exceptions,
}: SectionProps & { readonly exceptions: readonly AttendanceExceptionView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.exceptions')}</h2>

    {exceptions.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {exceptions.map((exception) => (
          <li key={exception.exceptionId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{exception.attendanceDate}</span>
            <span className="font-mono opacity-70">{short(exception.employmentId)}</span>
            <span>{t(`attendance.exception.${exception.kind}`)}</span>
            <span className="opacity-70">{exception.severity}</span>
            {exception.minutes === undefined ? null : (
              <span className="opacity-70">{minutes(t, exception.minutes)}</span>
            )}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/**
 * Raw punches.
 *
 * The device reference is shown because an administrator diagnosing a reader needs it. The
 * coordinates are **not**: they are punch evidence a tenant chose to capture, and putting them on a
 * list screen would make a location trail out of rows nobody scoped for one (ADR-0055).
 */
export const PunchesSection = ({
  t,
  language,
  events,
}: SectionProps & { readonly events: readonly TimeEventView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.punches')}</h2>

    {events.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {events.map((event) => (
          <li key={event.eventId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{event.attendanceDate}</span>
            <span className="font-mono opacity-70">{short(event.employmentId)}</span>
            <span>{event.kind}</span>
            <span className="opacity-70">{instant(event.occurredAt, language)}</span>
            <span className="opacity-70">{event.zone}</span>
            <span className="opacity-70">{event.source}</span>
            {event.deviceReference === undefined ? null : (
              <span className="font-mono opacity-70">{event.deviceReference}</span>
            )}
            {event.supersedesEventId === undefined ? null : (
              <span className="opacity-70">↩ {short(event.supersedesEventId)}</span>
            )}
          </li>
        ))}
      </ul>
    )}
  </Card>
);
