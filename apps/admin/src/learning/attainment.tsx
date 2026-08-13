import type { ReactNode } from 'react';
import type {
  CertificationView,
  InstructorView,
  LearningHistoryView,
} from '@work/learning/contracts';

import { civil, count } from './exact';
import {
  certificationActionsFor,
  certificationWithheldBecause,
  instructorActionsFor,
} from './lifecycle';
import {
  Actions,
  Empty,
  Figure,
  Section,
  Status,
  Table,
  named,
  short,
  yesNo,
  type SectionProps,
  type Translate,
} from './sections';

/**
 * What people hold, who teaches, and one person's record end to end.
 *
 * **Validity is derived on read and no column holds it.** The API computes it against a day it
 * names and echoes back; this screen shows both the final valid day and the state derived from it,
 * so an administrator can see that a certificate lapsing on the 1st reads `expiring_soon` today and
 * `expired` next month without anything having changed in the database. The alternative — a stored
 * flag — would need something to move it overnight, and `JobPort` has no adapter anywhere in this
 * repository: a forklift licence that lapsed in March would still read `valid` in June (ADR-0070).
 *
 * **`no_expiry` is a fourth state and not a blank.** A certificate that never lapses is a real
 * answer, and an empty cell would read as missing data on a screen somebody uses to decide whether
 * a person may operate machinery.
 *
 * **Supersession is shown as a status and not as a link.** A superseded certificate says it was
 * superseded; the identifier of the certificate that replaced it is a field the read contract does
 * not carry, so this screen says which rather than guessing. The relationship is set when the next
 * certificate is issued — there is no route that supersedes on its own, and no action here offers
 * to.
 *
 * **An evidence reference is an identifier and nothing more.** Nothing in this repository uploads,
 * stores, downloads or signs a URL for a document, so there is no link, no filename and no size on
 * this table: the whole of the Documents integration is that the reference was confirmed to exist.
 */

/**
 * One certificate, as a row.
 *
 * Its own component because the cells carry four different kinds of claim — two civil dates, a
 * derived validity, a lifecycle status and a reference that is deliberately not a link — and each
 * one has a reason it is rendered the way it is. Reading them inside a table body five levels deep
 * is how one of them quietly becomes a `Date` or an `<a href>`.
 */
const CertificationRow = ({
  t,
  certificate,
}: {
  readonly t: Translate;
  readonly certificate: CertificationView;
}): ReactNode => (
  <tr>
    <td>{short(certificate.employmentId)}</td>
    <td>{certificate.title}</td>
    <td>
      <Status t={t} group="certificationSource" status={certificate.source} />
    </td>
    {/* Civil dates, exactly as stored. The last valid day, not an instant. */}
    <td>{civil(certificate.issuedOn)}</td>
    <td>{civil(certificate.validUntil)}</td>
    <td>
      <Status t={t} group="validity" status={certificate.validity} />
    </td>
    <td>
      <Status t={t} group="certificationStatus" status={certificate.status} />
    </td>
    {/* A reference, never a link: no bytes exist and no URL is signed anywhere. */}
    <td>{short(certificate.evidenceDocumentId)}</td>
    <td>{short(certificate.issuedBy)}</td>
  </tr>
);

export const CertificationsSection = ({
  t,
  certifications,
  total,
  asOf,
}: SectionProps & {
  readonly certifications: readonly CertificationView[];
  readonly total: number;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Section
    t={t}
    title="certifications"
    total={total}
    shown={certifications.length}
    note="learning.notice.derivedExpiry"
  >
    <p className="text-xs opacity-70">{`${t('learning.label.asOf')}: ${civil(asOf)}`}</p>

    {certifications.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'employment',
            'title',
            'source',
            'issuedOn',
            'validUntil',
            'validity',
            'status',
            'evidence',
            'issuedBy',
          ]}
        >
          {certifications.map((certificate) => (
            <CertificationRow key={certificate.certificationId} t={t} certificate={certificate} />
          ))}
        </Table>

        <Actions
          t={t}
          actions={certificationActionsFor(certifications[0])}
          withheld={certificationWithheldBecause(certifications[0])}
        />
      </>
    )}
  </Section>
);

/**
 * Who delivers training.
 *
 * An internal instructor is named by their employment, which the module confirmed through
 * Employment; an external one is not in Employment at all, so their name lives on this row. That is
 * the whole distinction, and the note says the external record creates no employee.
 *
 * Deactivation is not deletion: a course delivered in 2023 by somebody who has since left is still
 * explainable, and a deleted instructor would make a completion record point at nothing.
 */
export const InstructorsSection = ({
  t,
  language,
  instructors,
  total,
}: SectionProps & {
  readonly instructors: readonly InstructorView[];
  readonly total: number;
}): ReactNode => (
  <Section
    t={t}
    title="instructors"
    total={total}
    shown={instructors.length}
    note="learning.notice.externalInstructor"
  >
    {instructors.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['employment', 'externalName', 'organization', 'active']}>
          {instructors.map((instructor) => (
            <tr key={instructor.instructorId}>
              <td>{short(instructor.employmentId)}</td>
              <td>{named(instructor.externalName, language)}</td>
              <td>{instructor.externalOrganization ?? '—'}</td>
              <td>{yesNo(instructor.active, t)}</td>
            </tr>
          ))}
        </Table>

        <Actions t={t} actions={instructorActionsFor(instructors[0])} withheld={undefined} />
      </>
    )}
  </Section>
);

/**
 * One person's learning record: what they were asked to do, what they sat, and what they hold.
 *
 * **Assembled on read from the authoritative rows.** Nothing maintains a summary — a materialized
 * one would need updating from six places, and the first missed update would be a compliance screen
 * confidently showing training somebody never did.
 *
 * The employment shown is whichever one the assignment queue surfaced, in one request. Reading the
 * history of every person in the queue would be one request per person, and on a real workforce
 * that is fifty.
 *
 * **This is not self-service.** The employment is an identifier this screen read from a listing an
 * administrator was already entitled to see; it is not a claim about who is asking, and the API
 * resolves the caller's scope before it looks at it at all.
 */
export const HistorySection = ({
  t,
  history,
}: SectionProps & { readonly history: LearningHistoryView | undefined }): ReactNode => (
  <Section t={t} title="history" note="learning.notice.selfServiceUnavailable">
    {history === undefined ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Figure t={t} label="employment" value={short(history.employmentId)} />
          <Figure t={t} label="asOf" value={civil(history.asOf)} />
          <Figure t={t} label="openAssignments" value={count(history.openAssignments)} />
          <Figure t={t} label="overdue" value={count(history.overdueAssignments)} />
          <Figure t={t} label="completedCourses" value={count(history.completedCourses)} />
          <Figure t={t} label="activeCertifications" value={count(history.activeCertifications)} />
          <Figure t={t} label="expiring" value={count(history.expiringCertifications)} />
        </dl>

        <Table t={t} headers={['course', 'status', 'completedOn', 'pinnedVersion']}>
          {history.enrolments.map((enrolment) => (
            <tr key={enrolment.enrolmentId}>
              <td>{short(enrolment.courseId)}</td>
              <td>
                <Status t={t} group="enrolmentStatus" status={enrolment.status} />
              </td>
              <td>{civil(enrolment.completedOn)}</td>
              <td>{short(enrolment.courseVersionId)}</td>
            </tr>
          ))}
        </Table>
      </>
    )}
  </Section>
);
