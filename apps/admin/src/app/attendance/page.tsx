import type { ReactNode } from 'react';

import { loadAttendance } from '../../attendance/api';
import { directionOf, isLanguage, translator, type Language } from '../../attendance/locale';
import {
  DashboardSection,
  DaysSection,
  ExceptionsSection,
  PunchesSection,
} from '../../attendance/sections';
import {
  BoundariesSection,
  CorrectionsSection,
  ImportsSection,
  RosterSection,
  SchedulesSection,
  ShiftsSection,
} from '../../attendance/configuration';

/**
 * The attendance administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no
 * business logic of its own — no rule about when a day may be signed off, no idea which civil date
 * a punch belongs to. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is
 * never a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with the organization, people, employment, recruitment and
 * onboarding screens. Every mutation goes through the API; the write screens are Phase 18/19's, and
 * building them only here would make Attendance the one module with them. That includes
 * recalculation: the awaiting count is shown, and the `POST` that acts on it is an operator's or a
 * scheduler's.
 *
 * **There is no employee self-service and no manager self-service here**, and no mobile app. Those
 * are later phases, and a punch button on an administrator's screen would be the beginning of one
 * built in the wrong place.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const AttendancePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const attendance = await loadAttendance();

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('attendance.label.attendance')}</h1>
      </header>

      <DashboardSection
        t={t}
        language={language}
        dashboard={attendance.dashboard}
        unavailable={attendance.unavailable}
      />
      <DaysSection t={t} language={language} days={attendance.days} />
      <ExceptionsSection t={t} language={language} exceptions={attendance.exceptions} />
      <PunchesSection t={t} language={language} events={attendance.events} />
      <CorrectionsSection t={t} language={language} corrections={attendance.corrections} />
      <RosterSection t={t} language={language} roster={attendance.roster} />
      <ShiftsSection t={t} language={language} shifts={attendance.shifts} />
      <SchedulesSection t={t} language={language} schedules={attendance.schedules} />
      <ImportsSection t={t} language={language} imports={attendance.imports} />
      <BoundariesSection t={t} language={language} />
    </main>
  );
};

export default AttendancePage;
