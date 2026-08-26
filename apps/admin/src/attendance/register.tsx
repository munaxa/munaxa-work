import type { ReactNode } from 'react';
import { KpiGrid, StatCard } from '@munaxa/ui';
import type {
  AttendanceDashboardView,
  AttendanceDayView,
  AttendanceExceptionView,
} from '@work/attendance/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Duration,
  Identifier,
  Isolated,
  Note,
  Refused,
  Row,
  Rows,
  AttendanceSection,
  Term,
  Verdict,
  When,
  shownOf,
  type AttendanceProps,
} from './frame';
import { DASH, count, day, instant, minutes, reference } from './exact';
import type { Language } from './locale';
import { DAY_TONE, EXCEPTION_STATE_TONE, LEAVE_TONE, SEVERITY_TONE } from './tones';
import type { Listing, Reconciliation } from './api';

/**
 * The attendance register: what today looks like, what is wrong with it, and which days to open.
 *
 * The screen this replaced was ten stacked cards in the order the reads happened to be issued. It
 * opened nothing, showed six rows of nine thousand with no indication that anything was omitted,
 * rendered every employment as the same eight truncated characters, and — because five of its
 * catalogue keys were stored flat and containing dots — printed `attendance.label.boundary.money`
 * to customers in both languages.
 *
 * The order here is an attendance administrator's own: today's six counts, then **the exception
 * queue**, because that is the work, then the days behind it, then what is not being recalculated,
 * and only then the rota and the definitions people are measured against.
 *
 * **Every figure is the server's.** The six overview figures are `AttendanceDashboardView`'s own
 * counts; every duration is the minutes the module published; the totals beside each section are
 * `PagedResult.total`. Nothing here works out who was late.
 */

export interface RegisterProps extends AttendanceProps {
  readonly language: Language;
}

/** The address of one attendance day. The subject is the pair the contract takes. */
export const dayHref = (employmentId: string, attendanceDate: string, language: Language): string =>
  `/attendance/days/${employmentId}/${attendanceDate}?lang=${language}`;

/** The six figures the register opens with, each one counted by the database. */
export const AttendanceOverview = ({
  t,
  dashboard,
}: AttendanceProps & { readonly dashboard: AttendanceDashboardView | undefined }): ReactNode => (
  <KpiGrid cols={{ base: 2, md: 6 }}>
    <StatCard
      label={t('attendance.label.expected')}
      value={dashboard === undefined ? DASH : count(dashboard.expected)}
    />
    <StatCard
      label={t('attendance.label.present')}
      value={dashboard === undefined ? DASH : count(dashboard.present)}
    />
    <StatCard
      label={t('attendance.label.late')}
      value={dashboard === undefined ? DASH : count(dashboard.late)}
    />
    <StatCard
      label={t('attendance.label.pendingExplanation')}
      value={dashboard === undefined ? DASH : count(dashboard.absencePendingExplanation)}
    />
    <StatCard
      label={t('attendance.label.openExceptions')}
      value={dashboard === undefined ? DASH : count(dashboard.openExceptions)}
    />
    <StatCard
      label={t('attendance.label.awaitingRecalculation')}
      value={dashboard === undefined ? DASH : count(dashboard.awaitingRecalculation)}
    />
  </KpiGrid>
);

const EXCEPTION_HEADINGS = [
  'attendance.label.open',
  'attendance.label.date',
  'attendance.label.employment',
  'attendance.label.flag',
  'attendance.label.severity',
  'attendance.label.state',
  'attendance.label.minutesColumn',
] as const;

/**
 * One flagged day.
 *
 * The sentence is the module's own and is rendered as a sentence rather than a code in a pill. The
 * severity carries the tone, because the same kind can be configured to different severities by a
 * tenant's policy and colouring it by kind would override the customer's own judgement.
 */
const ExceptionRow = ({
  t,
  language,
  exception,
}: RegisterProps & { readonly exception: AttendanceExceptionView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={dayHref(exception.employmentId, exception.attendanceDate, language)}
        className="underline underline-offset-4"
      >
        {t('attendance.label.open')}
      </a>
    </Cell>
    <When>
      <Isolated>{day(exception.attendanceDate)}</Isolated>
    </When>
    <Identifier value={reference(exception.employmentId)} />
    <Cell>
      <Verdict t={t} kind={exception.kind} />
    </Cell>
    <Cell>
      <Term
        t={t}
        group="severity"
        value={exception.severity}
        tone={SEVERITY_TONE[exception.severity]}
      />
    </Cell>
    <Cell>
      <Term
        t={t}
        group="exceptionState"
        value={exception.state}
        tone={EXCEPTION_STATE_TONE[exception.state]}
      />
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, exception.minutes)}</Duration>
    </Cell>
  </Row>
);

export const ExceptionsSection = ({
  t,
  language,
  exceptions,
}: RegisterProps & {
  readonly exceptions: Listing<AttendanceExceptionView> | undefined;
}): ReactNode => {
  const title = t('attendance.label.exceptions');

  if (exceptions === undefined) return <Refused t={t} title={title} />;
  if (exceptions.items.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noExceptions" />;
  }

  return (
    <AttendanceSection title={title} description={shownOf(exceptions)}>
      <Rows headings={EXCEPTION_HEADINGS.map(t)} numeric={[6]}>
        {exceptions.items.map((exception) => (
          <ExceptionRow
            key={exception.exceptionId}
            t={t}
            language={language}
            exception={exception}
          />
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.verdictsAreTheDomains" />
    </AttendanceSection>
  );
};

const DAY_HEADINGS = [
  'attendance.label.open',
  'attendance.label.date',
  'attendance.label.employment',
  'attendance.label.dayKind',
  'attendance.label.state',
  'attendance.label.expectedMinutes',
  'attendance.label.workedMinutes',
  'attendance.label.overtimeMinutes',
  'attendance.label.leaveState',
  'attendance.label.calculatedAt',
] as const;

const DayRow = ({
  t,
  language,
  attendanceDay,
}: RegisterProps & { readonly attendanceDay: AttendanceDayView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={dayHref(attendanceDay.employmentId, attendanceDay.attendanceDate, language)}
        className="underline underline-offset-4"
      >
        {t('attendance.label.open')}
      </a>
    </Cell>
    <When>
      <Isolated>{day(attendanceDay.attendanceDate)}</Isolated>
    </When>
    <Identifier value={reference(attendanceDay.employmentId)} />
    <Cell>
      <Term t={t} group="dayKind" value={attendanceDay.dayKind} tone="muted" />
    </Cell>
    <Cell>
      <Term t={t} group="day" value={attendanceDay.state} tone={DAY_TONE[attendanceDay.state]} />
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, attendanceDay.expectedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, attendanceDay.workedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, attendanceDay.overtimeCandidateMinutes)}</Duration>
    </Cell>
    <Cell>
      <Term
        t={t}
        group="leave"
        value={attendanceDay.leaveState}
        tone={LEAVE_TONE[attendanceDay.leaveState]}
      />
    </Cell>
    <When>
      {attendanceDay.inputsChangedAt === undefined ? (
        <Isolated>{instant(attendanceDay.calculatedAt, language)}</Isolated>
      ) : (
        <span className="text-warning-foreground">
          {t('attendance.label.awaitingRecalculation')}
        </span>
      )}
    </When>
  </Row>
);

export const DaysSection = ({
  t,
  language,
  days,
}: RegisterProps & { readonly days: Listing<AttendanceDayView> | undefined }): ReactNode => {
  const title = t('attendance.label.days');

  if (days === undefined) return <Refused t={t} title={title} />;
  if (days.items.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noDays" />;
  }

  return (
    <AttendanceSection title={title} description={shownOf(days)}>
      <Rows headings={DAY_HEADINGS.map(t)} numeric={[5, 6, 7]}>
        {days.items.map((attendanceDay) => (
          <DayRow
            key={attendanceDay.attendanceDayId}
            t={t}
            language={language}
            attendanceDay={attendanceDay}
          />
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.daysAreServerOrdered" />
      <Note t={t} message="attendance.notice.leaveUnknownIsNotNone" />
    </AttendanceSection>
  );
};

/**
 * The number that grows when something is quietly not working.
 *
 * A day whose inputs moved after it was last calculated is a figure that no longer follows from
 * them, and the module refuses to freeze a period containing one. It is shown and never acted on:
 * recalculating is a `POST`.
 */
export const ReconciliationSection = ({
  t,
  language,
  reconciliation,
}: RegisterProps & { readonly reconciliation: Reconciliation | undefined }): ReactNode => {
  const title = t('attendance.label.awaitingRecalculation');

  if (reconciliation === undefined) return <Refused t={t} title={title} />;
  if (reconciliation.total === 0) {
    return <Clear t={t} title={title} message="attendance.label.noneAwaiting" />;
  }

  return (
    <AttendanceSection
      title={title}
      description={<Isolated>{count(reconciliation.total)}</Isolated>}
    >
      <Rows
        headings={[
          t('attendance.label.open'),
          t('attendance.label.date'),
          t('attendance.label.employment'),
          t('attendance.label.state'),
          t('attendance.label.changedAt'),
        ]}
      >
        {reconciliation.days.map((stale) => (
          <Row key={stale.attendanceDayId}>
            <Cell>
              <a
                href={dayHref(stale.employmentId, stale.attendanceDate, language)}
                className="underline underline-offset-4"
              >
                {t('attendance.label.open')}
              </a>
            </Cell>
            <When>
              <Isolated>{day(stale.attendanceDate)}</Isolated>
            </When>
            <Identifier value={reference(stale.employmentId)} />
            <Cell>
              <Term t={t} group="day" value={stale.state} tone={DAY_TONE[stale.state]} />
            </Cell>
            <When>
              <Isolated>{instant(stale.inputsChangedAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.recalculationIsApi" />
    </AttendanceSection>
  );
};

/** What the register does not do, said rather than left as an absence. */
const REGISTER_BOUNDARIES = [
  'attendance.label.boundary.employment',
  'attendance.label.boundary.money',
  'attendance.label.boundary.location',
  'attendance.label.boundary.leave',
  'attendance.label.boundary.notifications',
  'attendance.notice.noDeviceStatus',
  'attendance.notice.identifiersNotNames',
  'admin.notice.readOnly',
] as const;

export const RegisterBoundaries = ({ t }: AttendanceProps): ReactNode => (
  <Boundaries t={t} keys={REGISTER_BOUNDARIES} />
);
