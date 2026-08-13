import type { ReactNode } from 'react';
import type { AssignmentView, CertificationView, CourseView } from '@work/learning/contracts';

import { civil, count } from './exact';
import { Figure, Section, type SectionProps } from './sections';

/**
 * The overview: where the tenant's training position stands, counted from what the API returned.
 *
 * **Every figure here has a source.** Each is either the server's own total or a count of rows the
 * listings already fetched — never a KPI invented because a dashboard looked sparse. There is no
 * "compliance percentage", no completion rate and no trend, because nothing in this product
 * produces any of them and a compliance number with no source is a number somebody will act on.
 *
 * The two derived counts — overdue requirements and lapsing certificates — are counts of a **page**,
 * and the page size sits beside the total in every listing. That is a real limitation and it is
 * better than the alternative: fetching a tenant's whole assignment set into a browser to count it
 * would fall over on the first customer with a real workforce.
 *
 * **`asOf` is displayed.** Both derived answers are functions of a day, and the API says which day
 * it used. A screen that showed "expiring soon" without saying what "soon" was measured from would
 * be a compliance claim with no date on it.
 */

export const OverviewSection = ({
  t,
  courses,
  coursesTotal,
  assignments,
  assignmentsTotal,
  certifications,
  certificationsTotal,
  enrolmentsTotal,
  rulesTotal,
  asOf,
  unavailable,
}: SectionProps & {
  readonly courses: readonly CourseView[];
  readonly coursesTotal: number;
  readonly assignments: readonly AssignmentView[];
  readonly assignmentsTotal: number;
  readonly certifications: readonly CertificationView[];
  readonly certificationsTotal: number;
  readonly enrolmentsTotal: number;
  readonly rulesTotal: number;
  readonly asOf: string | undefined;
  readonly unavailable: boolean;
}): ReactNode => {
  if (unavailable) {
    return (
      <Section t={t} title="overview">
        <p className="text-sm opacity-70">{t('learning.notice.unauthenticated')}</p>
      </Section>
    );
  }

  const published = courses.filter((course) => course.status === 'published').length;
  // The overdue answer the API computed against `asOf`. Not recomputed here — see `sections.tsx`.
  const overdue = assignments.filter((assignment) => assignment.overdue).length;
  const open = assignments.filter((assignment) => assignment.status === 'assigned').length;
  const expiring = certifications.filter(
    (certificate) => certificate.validity === 'expiring_soon',
  ).length;
  const expired = certifications.filter((certificate) => certificate.validity === 'expired').length;

  return (
    <Section t={t} title="overview" note="learning.notice.countsAreOfThisPage">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        {/* The server's own totals, not the length of a page. */}
        <Figure t={t} label="courses" value={count(coursesTotal)} />
        <Figure t={t} label="publishedVersions" value={count(published)} />
        <Figure t={t} label="compliance" value={count(rulesTotal)} />
        <Figure t={t} label="assignments" value={count(assignmentsTotal)} />
        <Figure t={t} label="enrolments" value={count(enrolmentsTotal)} />
        <Figure t={t} label="certifications" value={count(certificationsTotal)} />
        <Figure t={t} label="openAssignments" value={count(open)} />
        <Figure t={t} label="overdue" value={count(overdue)} />
        <Figure t={t} label="expiring" value={count(expiring)} />
        <Figure t={t} label="expired" value={count(expired)} />
        {/* The day both derived answers were computed against, exactly as the API reported it. */}
        <Figure t={t} label="asOf" value={civil(asOf)} />
      </dl>
    </Section>
  );
};

/**
 * What this product does not do, said once and plainly.
 *
 * A screen that simply lacked these would read as an unfinished screen. Saying that nothing runs on
 * a schedule, that no assessment is scored in aggregate, that no notification is delivered, that no
 * document bytes exist and that nobody can read their own record is the difference between a
 * missing dependency and a bug — and it stops a later reader from building a control on top of a
 * capability that is not there.
 *
 * Two of these are worth the words even though a database row exists for them. A notification
 * *intent* is recorded and nothing sends it; a document *reference* is confirmed and no bytes are
 * stored, served or signed. A record existing is not the same as the thing having happened, and
 * this list is where that difference is stated rather than left for somebody to discover.
 */
export const UnavailableSection = ({ t }: SectionProps): ReactNode => (
  <Section t={t} title="status">
    <ul className="flex flex-col gap-2 text-sm">
      {[
        'learning.notice.notScheduled',
        'learning.notice.noAggregateScore',
        'learning.notice.selfServiceUnavailable',
        'learning.notice.readTeamUnavailable',
        'learning.notice.noNotificationDelivery',
        'learning.notice.noDocumentBytes',
        'learning.notice.noCategoryListing',
        'learning.notice.noSupersessionLink',
      ].map((key) => (
        <li key={key} className="opacity-70">
          {t(key)}
        </li>
      ))}
    </ul>
  </Section>
);
