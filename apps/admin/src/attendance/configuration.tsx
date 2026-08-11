import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  CorrectionView,
  ImportBatchView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
} from '@work/attendance/contracts';

import { textIn, type Language } from './locale';
import { short, type Translate } from './sections';

/**
 * The configuration half of the attendance screen: what people are measured against, who changed
 * what, and what the last import did.
 *
 * **A schedule's zone is on the screen, prominently.** It is what makes a shift's wall-clock times
 * mean anything, and an administrator comparing two schedules needs to see that one runs in Riyadh
 * and the other in London — the difference is nine hours of somebody's day (ADR-0055).
 *
 * **The boundaries section is not filler.** A customer's administrator who cannot find contracted
 * hours or a pay rate on this screen should learn that Attendance does not hold them, rather than
 * conclude a field is missing and open a ticket.
 */

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const ShiftsSection = ({
  t,
  language,
  shifts,
}: SectionProps & { readonly shifts: readonly ShiftView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.shifts')}</h2>

    {shifts.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {shifts.map((shift) => (
          <li key={shift.shiftId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{shift.code}</span>
            <span>{textIn(shift.name, language)}</span>
            <span className="opacity-70">{shift.kind}</span>
            <span className="opacity-70">
              {shift.startLocal}–{shift.endLocal}
              {shift.crossesMidnight ? ' (+1)' : ''}
            </span>
            <span className="opacity-70">{shift.status}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const SchedulesSection = ({
  t,
  language,
  schedules,
}: SectionProps & { readonly schedules: readonly ScheduleView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.schedules')}</h2>

    {schedules.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {schedules.map((schedule) => (
          <li key={schedule.scheduleId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{schedule.code}</span>
            <span>{textIn(schedule.name, language)}</span>
            {/* The zone, shown rather than assumed. It is what the wall-clock times mean. */}
            <span className="font-mono">{schedule.zone}</span>
            <span className="opacity-70">
              {t('attendance.label.cycle')}: {schedule.cycleLengthDays} · {schedule.cycleAnchorDate}
            </span>
            <span className="opacity-70">{schedule.status}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const RosterSection = ({
  t,
  roster,
}: SectionProps & { readonly roster: readonly RosterEntryView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.roster')}</h2>

    {roster.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {roster.map((entry) => (
          <li key={entry.rosterEntryId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{entry.onDate}</span>
            <span className="font-mono opacity-70">{short(entry.employmentId)}</span>
            <span>{entry.kind}</span>
            {entry.reasonCode === undefined ? null : (
              <span className="font-mono opacity-70">{entry.reasonCode}</span>
            )}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const CorrectionsSection = ({
  t,
  corrections,
}: SectionProps & { readonly corrections: readonly CorrectionView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.corrections')}</h2>

    {corrections.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {corrections.map((correction) => (
          <li key={correction.correctionId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{correction.attendanceDate}</span>
            <span className="font-mono opacity-70">{short(correction.employmentId)}</span>
            <span>{correction.kind}</span>
            <span className="opacity-70">{correction.state}</span>
            <span className="opacity-70">
              {t('attendance.label.requestedBy')}: {short(correction.requestedBy)}
            </span>
            {/* Who decided it — never the same person, which the database also refuses. */}
            <span className="opacity-70">
              {t('attendance.label.decidedBy')}: {short(correction.decidedBy)}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const ImportsSection = ({
  t,
  imports,
}: SectionProps & { readonly imports: readonly ImportBatchView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.imports')}</h2>

    {imports.length === 0 ? (
      <p className="text-sm opacity-70">{t('attendance.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {imports.map((batch) => (
          <li key={batch.batchId} className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="font-mono">{batch.sourceLabel ?? batch.source}</span>
            <span className="opacity-70">
              {t('attendance.label.rows')}: {batch.rowsSubmitted}
            </span>
            <span className="opacity-70">
              {t('attendance.label.created')}: {batch.rowsCreated}
            </span>
            {/* Skipped is the number that proves a re-run deduplicated rather than duplicated. */}
            <span className="opacity-70">
              {t('attendance.label.skipped')}: {batch.rowsSkipped}
            </span>
            <span className="opacity-70">
              {t('attendance.label.failed')}: {batch.rowsFailed}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const BOUNDARIES = ['employment', 'money', 'location', 'leave', 'notifications'] as const;

export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('attendance.label.boundaries')}</h2>

    <ul className="flex flex-col gap-2 text-sm opacity-80">
      {BOUNDARIES.map((boundary) => (
        <li key={boundary}>{t(`attendance.label.boundary.${boundary}`)}</li>
      ))}
    </ul>
  </Card>
);
