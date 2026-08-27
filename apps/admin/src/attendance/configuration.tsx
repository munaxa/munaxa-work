import type { ReactNode } from 'react';
import type {
  ImportBatchView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
} from '@work/attendance/contracts';

import {
  AttendanceSection,
  Cell,
  Clear,
  Duration,
  Identifier,
  Isolated,
  Named,
  Note,
  Reference,
  Refused,
  Row,
  Rows,
  Term,
  When,
  shiftNamesOf,
  type AttendanceProps,
} from './frame';
import { count, day, instant, minutes, reference, wallClock } from './exact';
import { nameIn, type Language } from './locale';
import { DEFINITION_TONE } from './tones';

/**
 * What people are measured against: the rota, the shifts and the schedules.
 *
 * This is configuration rather than work, so it sits below the register. It is here at all because
 * an exception nobody can trace to a shift is an accusation — the grace period that decided
 * somebody arrived late lives on the shift, and the zone that decided which civil day a punch
 * belongs to lives on the schedule.
 *
 * **A schedule's zone is shown and never applied.** `startLocal` and `endLocal` are wall-clock
 * strings that mean nothing without it; rendering them through a date function in this process
 * would file a night shift against the wrong day, which is the failure ADR-0055 exists to prevent.
 *
 * **Nothing statutory ships.** Every grace period and tolerance is configuration a tenant or a
 * country pack supplies, so a tenant that configured none gets an empty list and the screen says so
 * rather than suggesting any.
 */

export interface ConfigurationProps extends AttendanceProps {
  readonly language: Language;
}

export const RosterSection = ({
  t,
  language,
  roster,
  shifts,
}: ConfigurationProps & {
  readonly roster: readonly RosterEntryView[] | undefined;
  readonly shifts: readonly ShiftView[] | undefined;
}): ReactNode => {
  const title = t('attendance.label.roster');
  const names = shiftNamesOf(shifts, language);

  if (roster === undefined) return <Refused t={t} title={title} />;
  if (roster.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noRoster" />;
  }

  return (
    <AttendanceSection title={title} description={<Isolated>{count(roster.length)}</Isolated>}>
      <Rows
        headings={[
          t('attendance.label.date'),
          t('attendance.label.employment'),
          t('attendance.label.kind'),
          t('attendance.label.shift'),
          t('attendance.label.reason'),
        ]}
      >
        {roster.map((entry) => (
          <Row key={entry.rosterEntryId}>
            <When>
              <Isolated>{day(entry.onDate)}</Isolated>
            </When>
            <Identifier value={reference(entry.employmentId)} />
            <Cell>
              <Term t={t} group="roster" value={entry.kind} tone="muted" />
            </Cell>
            {entry.shiftId === undefined ? (
              <Cell>—</Cell>
            ) : (
              <Named name={names.get(entry.shiftId)} value={entry.shiftId} />
            )}
            <Cell>
              <Isolated>{reference(entry.reasonCode)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.windowIsADefault" />
    </AttendanceSection>
  );
};

const SHIFT_HEADINGS = [
  'attendance.label.code',
  'attendance.label.name',
  'attendance.label.kind',
  'attendance.label.shiftHours',
  'attendance.label.graceIn',
  'attendance.label.graceOut',
  'attendance.label.expectedDay',
  'attendance.label.status',
] as const;

const ShiftRow = ({
  t,
  language,
  shift,
}: ConfigurationProps & { readonly shift: ShiftView }): ReactNode => (
  <Row>
    <Cell>
      <Isolated>{shift.code}</Isolated>
    </Cell>
    <Cell>{nameIn(shift.name, language)}</Cell>
    <Cell>
      <Term t={t} group="shift" value={shift.kind} tone="muted" />
    </Cell>
    <When>
      <Isolated>{`${wallClock(shift.startLocal)}–${wallClock(shift.endLocal)}`}</Isolated>
      {shift.crossesMidnight ? (
        <span className="ms-1 text-xs text-muted-foreground">
          {t('attendance.label.crossesMidnight')}
        </span>
      ) : undefined}
    </When>
    <Cell numeric>
      <Duration>{minutes(t, shift.graceInMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, shift.graceOutMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, shift.expectedMinutes)}</Duration>
    </Cell>
    <Cell>
      <Term t={t} group="definition" value={shift.status} tone={DEFINITION_TONE[shift.status]} />
    </Cell>
  </Row>
);

export const ShiftsSection = ({
  t,
  language,
  shifts,
}: ConfigurationProps & { readonly shifts: readonly ShiftView[] | undefined }): ReactNode => {
  const title = t('attendance.label.shifts');

  if (shifts === undefined) return <Refused t={t} title={title} />;
  if (shifts.length === 0) return <Clear t={t} title={title} message="attendance.label.noShifts" />;

  return (
    <AttendanceSection title={title} description={<Isolated>{count(shifts.length)}</Isolated>}>
      <Rows headings={SHIFT_HEADINGS.map(t)} numeric={[4, 5, 6]}>
        {shifts.map((shift) => (
          <ShiftRow key={shift.shiftId} t={t} language={language} shift={shift} />
        ))}
      </Rows>
    </AttendanceSection>
  );
};

export const SchedulesSection = ({
  t,
  language,
  schedules,
}: ConfigurationProps & {
  readonly schedules: readonly ScheduleView[] | undefined;
}): ReactNode => {
  const title = t('attendance.label.schedules');

  if (schedules === undefined) return <Refused t={t} title={title} />;
  if (schedules.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noSchedules" />;
  }

  return (
    <AttendanceSection title={title} description={<Isolated>{count(schedules.length)}</Isolated>}>
      <Rows
        headings={[
          t('attendance.label.code'),
          t('attendance.label.name'),
          t('attendance.label.zone'),
          t('attendance.label.cycle'),
          t('attendance.label.anchor'),
          t('attendance.label.status'),
        ]}
        numeric={[3]}
      >
        {schedules.map((schedule) => (
          <Row key={schedule.scheduleId}>
            <Cell>
              <Isolated>{schedule.code}</Isolated>
            </Cell>
            <Cell>{nameIn(schedule.name, language)}</Cell>
            <Cell>
              <Isolated>{schedule.zone}</Isolated>
            </Cell>
            <Cell numeric>{count(schedule.cycleLengthDays)}</Cell>
            <When>
              <Isolated>{day(schedule.cycleAnchorDate)}</Isolated>
            </When>
            <Cell>
              <Term
                t={t}
                group="definition"
                value={schedule.status}
                tone={DEFINITION_TONE[schedule.status]}
              />
            </Cell>
          </Row>
        ))}
      </Rows>
    </AttendanceSection>
  );
};

/**
 * What arrived in bulk, and how much of it landed.
 *
 * Its own permission — `attendance.import` — because a batch's counts say how much of a customer's
 * turnstile data made it in, and the operator who runs imports is not always the one who reads
 * days. So this is a **third** refusal on the register, distinct from the other two.
 *
 * **This is a record of a batch, not a state of a device.** `rowsSubmitted`, `rowsCreated`,
 * `rowsSkipped` and `rowsFailed` are what one submission did; nothing here says a reader is
 * healthy, connected or silent, because the product publishes no such state (ADR-0057). A batch
 * that never arrived leaves no row, and this section does not invent one.
 */
export const ImportsSection = ({
  t,
  language,
  imports,
}: ConfigurationProps & {
  readonly imports: readonly ImportBatchView[] | undefined;
}): ReactNode => {
  const title = t('attendance.label.imports');

  if (imports === undefined) {
    return <Refused t={t} title={title} reason="attendance.notice.importsAreOwnPermission" />;
  }
  if (imports.length === 0) {
    return <Clear t={t} title={title} message="attendance.label.noImports" />;
  }

  return (
    <AttendanceSection title={title} description={<Isolated>{count(imports.length)}</Isolated>}>
      <Rows
        headings={[
          t('attendance.label.submitted'),
          t('attendance.label.importSource'),
          t('attendance.label.rows'),
          t('attendance.label.created'),
          t('attendance.label.skipped'),
          t('attendance.label.failed'),
          t('attendance.label.submittedBy'),
        ]}
        numeric={[2, 3, 4, 5]}
      >
        {imports.map((batch) => (
          <Row key={batch.batchId}>
            <When>
              <Isolated>{instant(batch.submittedAt, language)}</Isolated>
            </When>
            <Cell>
              <Term t={t} group="source" value={batch.source} tone="muted" />
            </Cell>
            <Cell numeric>{count(batch.rowsSubmitted)}</Cell>
            <Cell numeric>{count(batch.rowsCreated)}</Cell>
            <Cell numeric>{count(batch.rowsSkipped)}</Cell>
            <Cell numeric>{count(batch.rowsFailed)}</Cell>
            <Cell>
              <Reference value={reference(batch.submittedBy)} />
            </Cell>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="attendance.notice.noDeviceStatus" />
    </AttendanceSection>
  );
};
