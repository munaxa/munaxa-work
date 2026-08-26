import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadDay, loadDayDetail } from '../../../../../attendance/api';
import {
  attendanceTranslator,
  directionOf,
  isLanguage,
  type Language,
} from '../../../../../attendance/locale';
import { Isolated, Term } from '../../../../../attendance/frame';
import { day as civilDay } from '../../../../../attendance/exact';
import {
  DayBoundaries,
  DayFigures,
  DayIdentity,
  DayProvenance,
  ExceptionsSection,
} from '../../../../../attendance/day';
import { CorrectionsSection, EventsSection } from '../../../../../attendance/punches';
import { DAY_TONE } from '../../../../../attendance/tones';

/**
 * One attendance day, opened.
 *
 * **The subject is a pair.** An attendance day is addressed by `(employmentId, attendanceDate)` —
 * which is exactly what `attendance.read-day` takes and exactly what `AttendanceDaySnapshot`
 * answers — so the route carries both and asks the module the question the module already answers.
 *
 * **One read, not three.** The snapshot is the day, its events including the superseded ones, and
 * its exceptions, together and from one moment. Rebuilding that from `/days`, `/events` and
 * `/exceptions` would be three permission outcomes and three moments assembled into a page claiming
 * to describe one day.
 *
 * **A 404 and a 403 are different answers, and the route acts on the difference.** A day the module
 * does not have renders Next's not-found page; a refused one renders the withheld state here rather
 * than claiming the day does not exist.
 *
 * **`?lang=` switches language and direction together**, as everywhere else.
 */

export const metadata: Metadata = { title: 'Attendance day' };

interface PageProps {
  readonly params: Promise<{
    readonly employmentId: string;
    readonly attendanceDate: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const BackToAttendance = ({
  t,
  language,
}: {
  readonly t: (key: string) => string;
  readonly language: Language;
}): ReactNode => (
  <a
    href={`/attendance?lang=${language}`}
    className="text-xs text-muted-foreground underline underline-offset-4"
  >
    {t('attendance.label.backToAttendance')}
  </a>
);

/** The five regions of the day, apart from the route so the route stays a route. */
const DaySections = ({
  t,
  language,
  detail,
}: {
  readonly t: ReturnType<typeof attendanceTranslator>;
  readonly language: Language;
  readonly detail: Awaited<ReturnType<typeof loadDayDetail>>;
}): ReactNode => (
  <Stack gap={8}>
    <DayFigures t={t} language={language} attendanceDay={detail.snapshot.day} />
    <ExceptionsSection t={t} exceptions={detail.snapshot.exceptions} />
    <EventsSection t={t} language={language} events={detail.snapshot.events} />
    <CorrectionsSection
      t={t}
      language={language}
      corrections={detail.corrections}
      scopedToEmployment
    />
    <DayProvenance t={t} language={language} attendanceDay={detail.snapshot.day} />
  </Stack>
);

const AttendanceDayPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { employmentId, attendanceDate } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = attendanceTranslator(language);

  const answer = await loadDay(employmentId, attendanceDate);

  if (answer.kind === 'missing') notFound();

  if (answer.kind === 'refused') {
    return (
      <div dir={directionOf(language)} lang={language}>
        <Page width="wide">
          <PageHeader
            above={<BackToAttendance t={t} language={language} />}
            title={t('attendance.label.day')}
          />
          <EmptyState
            title={t('admin.notice.sectionWithheld')}
            description={t('attendance.notice.unauthenticated')}
          />
          <DayBoundaries t={t} />
        </Page>
      </div>
    );
  }

  const detail = await loadDayDetail(answer.value);
  const attendanceDay = detail.snapshot.day;

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={<BackToAttendance t={t} language={language} />}
          title={
            <>
              {t('attendance.label.day')}{' '}
              <Isolated>{civilDay(attendanceDay.attendanceDate)}</Isolated>
            </>
          }
          description={t('attendance.label.dayLead')}
          actions={
            <Term
              t={t}
              group="day"
              value={attendanceDay.state}
              tone={DAY_TONE[attendanceDay.state]}
            />
          }
        />

        <DayIdentity
          t={t}
          language={language}
          attendanceDay={attendanceDay}
          employment={detail.employment}
        />

        <DaySections t={t} language={language} detail={detail} />

        <DayBoundaries t={t} />
      </Page>
    </div>
  );
};

export default AttendanceDayPage;
