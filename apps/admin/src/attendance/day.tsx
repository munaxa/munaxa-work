import type { ReactNode } from 'react';
import type { AttendanceDayView, AttendanceExceptionView } from '@work/attendance/contracts';
import type { EmploymentView } from '@work/employment/contracts';

import {
  AttendanceSection,
  Boundaries,
  Cell,
  Clear,
  Duration,
  Fact,
  Facts,
  Isolated,
  Note,
  Reference,
  Row,
  Rows,
  Term,
  Verdict,
  type AttendanceProps,
} from './frame';
import { count, instant, minutes, reference } from './exact';
import { nameIn, type Language } from './locale';
import { EXCEPTION_STATE_TONE, LEAVE_TONE, SEVERITY_TONE } from './tones';

/**
 * One attendance day, opened.
 *
 * Until this route existed the product could list an attendance day and never examine one: there
 * was no way to see which punches produced a figure, what the domain flagged about it, or whether
 * a correction was outstanding. A day whose row does not open is a report.
 *
 * **One read answers it.** `attendance.read-day` returns the day, its events — superseded included
 * — and its exceptions together, from one moment. Rebuilding that from three list requests would be
 * three permission outcomes and three moments assembled into a page claiming to describe one day.
 *
 * **The day is the subject, and its subject is a pair.** An attendance day is addressed by
 * `(employmentId, attendanceDate)`, which is what the contract takes and what the route carries.
 *
 * **Nothing here computes.** Expected against worked is two published figures side by side, not a
 * comparison. Lateness is an exception the module raised, carrying its own minutes and its own
 * severity and its own sentence in both languages.
 */

export interface DayProps extends AttendanceProps {
  readonly language: Language;
}

/** What the day says about itself and who it belongs to. */
export const DayIdentity = ({
  t,
  language,
  attendanceDay,
  employment,
}: DayProps & {
  readonly attendanceDay: AttendanceDayView;
  readonly employment: EmploymentView | undefined;
}): ReactNode => (
  <Facts>
    <Fact
      label={t('attendance.label.employment')}
      value={<Reference value={reference(attendanceDay.employmentId)} />}
    />
    <Fact
      label={t('attendance.label.person')}
      value={
        employment?.personName === undefined
          ? t('admin.label.notResolved')
          : nameIn(employment.personName as { en: string; ar: string }, language)
      }
    />
    <Fact
      label={t('attendance.label.employmentNumber')}
      value={<Reference value={reference(employment?.employmentNumber)} />}
    />
    <Fact label={t('attendance.label.zone')} value={<Isolated>{attendanceDay.zone}</Isolated>} />
    <Fact
      label={t('attendance.label.dayKind')}
      value={<Term t={t} group="dayKind" value={attendanceDay.dayKind} tone="muted" />}
    />
    <Fact
      label={t('attendance.label.leaveState')}
      value={
        <Term
          t={t}
          group="leave"
          value={attendanceDay.leaveState}
          tone={LEAVE_TONE[attendanceDay.leaveState]}
        />
      }
    />
  </Facts>
);

/** What was expected of the day, beside what the module recorded. Two published sets, not a sum. */
export const DayFigures = ({
  t,
  language,
  attendanceDay,
}: DayProps & { readonly attendanceDay: AttendanceDayView }): ReactNode => (
  <AttendanceSection title={t('attendance.label.dayFigures')}>
    <Facts>
      <Fact
        label={t('attendance.label.expectedStart')}
        value={<Isolated>{instant(attendanceDay.expectedStartAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.expectedEnd')}
        value={<Isolated>{instant(attendanceDay.expectedEndAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.expectedMinutes')}
        value={<Duration>{minutes(t, attendanceDay.expectedMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.firstIn')}
        value={<Isolated>{instant(attendanceDay.firstInAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.lastOut')}
        value={<Isolated>{instant(attendanceDay.lastOutAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.workedMinutes')}
        value={<Duration>{minutes(t, attendanceDay.workedMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.regularCandidate')}
        value={<Duration>{minutes(t, attendanceDay.regularCandidateMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.overtimeMinutes')}
        value={<Duration>{minutes(t, attendanceDay.overtimeCandidateMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.absenceMinutes')}
        value={<Duration>{minutes(t, attendanceDay.absenceMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.breakTaken')}
        value={<Duration>{minutes(t, attendanceDay.breakMinutesTaken)}</Duration>}
      />
      <Fact
        label={t('attendance.label.paidBreak')}
        value={<Duration>{minutes(t, attendanceDay.paidBreakMinutes)}</Duration>}
      />
      <Fact
        label={t('attendance.label.leaveMinutes')}
        value={<Duration>{minutes(t, attendanceDay.leaveMinutes)}</Duration>}
      />
    </Facts>
    <Note t={t} message="attendance.notice.minutesAsPublished" />
  </AttendanceSection>
);

/** How the figure was reached and who signed it off — what makes a disputed day explainable. */
export const DayProvenance = ({
  t,
  language,
  attendanceDay,
}: DayProps & { readonly attendanceDay: AttendanceDayView }): ReactNode => (
  <AttendanceSection title={t('attendance.label.provenance')}>
    <Facts>
      <Fact
        label={t('attendance.label.calculatedAt')}
        value={<Isolated>{instant(attendanceDay.calculatedAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.changedAt')}
        value={<Isolated>{instant(attendanceDay.inputsChangedAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.calculationVersion')}
        value={<Isolated>{count(attendanceDay.calculationVersion)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.inputsDigest')}
        value={<Reference value={attendanceDay.inputsDigest} />}
      />
      <Fact
        label={t('attendance.label.approvedAt')}
        value={<Isolated>{instant(attendanceDay.approvedAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.approvedBy')}
        value={<Reference value={reference(attendanceDay.approvedBy)} />}
      />
      <Fact
        label={t('attendance.label.lockedAt')}
        value={<Isolated>{instant(attendanceDay.lockedAt, language)}</Isolated>}
      />
      <Fact
        label={t('attendance.label.version')}
        value={<Isolated>{count(attendanceDay.version)}</Isolated>}
      />
    </Facts>
    {attendanceDay.inputsChangedAt === undefined ? undefined : (
      <Note t={t} message="attendance.notice.recalculationIsApi" />
    )}
  </AttendanceSection>
);

/**
 * What the module flagged about this day.
 *
 * Each row is the domain's own sentence, its own severity and its own minutes. Nothing here decides
 * that somebody was late, by how much, or how serious it is.
 */
export const ExceptionsSection = ({
  t,
  exceptions,
}: AttendanceProps & { readonly exceptions: readonly AttendanceExceptionView[] }): ReactNode => {
  const title = t('attendance.label.exceptions');

  if (exceptions.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noExceptions" />;
  }

  return (
    <AttendanceSection title={title} description={<Isolated>{count(exceptions.length)}</Isolated>}>
      <Rows
        headings={[
          t('attendance.label.flag'),
          t('attendance.label.severity'),
          t('attendance.label.state'),
          t('attendance.label.minutesColumn'),
          t('attendance.label.reason'),
        ]}
        numeric={[3]}
      >
        {exceptions.map((exception) => (
          <Row key={exception.exceptionId}>
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
            <Cell>
              <Reference value={reference(exception.resolutionReasonCode)} />
            </Cell>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.verdictsAreTheDomains" />
    </AttendanceSection>
  );
};

/** What the day record does not do. */
const DAY_BOUNDARIES = [
  'attendance.notice.verdictsAreTheDomains',
  'attendance.notice.noDeviceStatus',
  'attendance.label.boundary.money',
  'attendance.label.boundary.location',
  'attendance.label.boundary.leave',
  'admin.notice.readOnly',
] as const;

export const DayBoundaries = ({ t }: AttendanceProps): ReactNode => (
  <Boundaries t={t} keys={DAY_BOUNDARIES} />
);
