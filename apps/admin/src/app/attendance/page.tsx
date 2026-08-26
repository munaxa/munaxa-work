import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadAttendanceRegister, registerAnsweredNothing } from '../../attendance/api';
import {
  attendanceTranslator,
  directionOf,
  isLanguage,
  type Language,
} from '../../attendance/locale';
import { todayIn } from '../../attendance/exact';
import {
  AttendanceOverview,
  DaysSection,
  ExceptionsSection,
  ReconciliationSection,
  RegisterBoundaries,
} from '../../attendance/register';
import {
  ImportsSection,
  RosterSection,
  SchedulesSection,
  ShiftsSection,
} from '../../attendance/configuration';
import { CorrectionsSection } from '../../attendance/punches';

/**
 * Attendance, as work rather than as ten cards.
 *
 * The screen this replaced stacked ten `Card`s down one column in the order the reads happened to
 * be issued, opened nothing at all, showed six rows of nine thousand with nothing saying so,
 * rendered every employment as the same eight truncated characters, and printed five raw catalogue
 * keys to customers in both languages.
 *
 * The order here is an attendance administrator's own: today's six counts, then **the exception
 * queue**, because that is the work rather than the register behind it, then the days, then what is
 * quietly not being recalculated, and only then the rota and the definitions people are measured
 * against.
 *
 * **Every figure is the server's.** The overview is the dashboard's own counts, every duration is
 * the minutes the module published, and the totals beside each section are `PagedResult.total`.
 * Nothing here decides who was late — the module raised an exception carrying its own minutes, its
 * own severity and its own sentence.
 *
 * **`?lang=ar`** switches language *and* direction together.
 *
 * **It offers no control.** Recording a punch, resolving an exception, deciding a correction,
 * recalculating, approving and locking a day are writes, and a request from this portal carries no
 * principal, so a button here would post unauthenticated and answer 401.
 */

export const metadata: Metadata = { title: 'Attendance' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const AttendancePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = attendanceTranslator(language);
  const register = await loadAttendanceRegister(todayIn(new Date()));

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('attendance.label.attendance')}
          description={t('attendance.label.attendanceLead')}
        />

        {registerAnsweredNothing(register) ? (
          <EmptyState
            title={t('attendance.label.nothingReadable')}
            description={t('attendance.notice.unauthenticated')}
          />
        ) : (
          <>
            <AttendanceOverview t={t} dashboard={register.dashboard} />

            <Stack gap={8}>
              <ExceptionsSection t={t} language={language} exceptions={register.exceptions} />
              <DaysSection t={t} language={language} days={register.days} />
              <ReconciliationSection
                t={t}
                language={language}
                reconciliation={register.reconciliation}
              />
              <CorrectionsSection t={t} language={language} corrections={register.corrections} />
              <RosterSection
                t={t}
                language={language}
                roster={register.roster}
                shifts={register.shifts}
              />
              <ShiftsSection t={t} language={language} shifts={register.shifts} />
              <SchedulesSection t={t} language={language} schedules={register.schedules} />
              <ImportsSection t={t} language={language} imports={register.imports} />
            </Stack>
          </>
        )}

        <RegisterBoundaries t={t} />
      </Page>
    </div>
  );
};

export default AttendancePage;
