import type { ReactNode } from 'react';
import type { AttendanceDayView } from '@work/attendance/contracts';
import type { DocumentView } from '@work/documents/contracts';
import type { LearningHistoryView } from '@work/learning/contracts';
import type { LeaveBalanceView } from '@work/leave/contracts';
import type { IssuedLetterView } from '@work/letters/contracts';

import type { Language } from '../shell/locale';

import {
  Cell,
  DASH,
  Empty,
  Fact,
  Facts,
  Row,
  Rows,
  Section,
  Withheld,
  orDash,
  type SectionProps,
} from './record-frame';
import { dayOf, textIn } from './record-locale';
import type { EmployeeRecord } from './record-api';

/**
 * What has happened to this employment: documents filed against it, letters issued about it, leave
 * it holds, days it worked and training it was asked to do.
 *
 * **Five modules, five permissions, five answers.** A caller who may read documents but not leave
 * sees the documents section and a withheld leave section, and the difference is legible on the
 * page rather than inferred from an empty table.
 *
 * **The documents section lists documents and offers no file.** This product stores no bytes:
 * `StoragePort` has no adapter anywhere in the repository, so there is nothing to open, nothing to
 * download and no size to report. The notice says that, because a document row with no way to read
 * it looks like a broken link rather than a deliberate boundary.
 *
 * **Leave is minutes and attendance is minutes.** Both modules publish whole minutes and neither
 * publishes hours or days; this screen renders the number the module returned and converts nothing.
 * A screen that divided by sixty would be the second place in the product that decided what a
 * working day is.
 */

const DocumentRows = ({
  t,
  language,
  documents,
}: SectionProps & {
  readonly language: Language;
  readonly documents: readonly DocumentView[];
}): ReactNode => (
  <Rows
    headings={[
      t('documents.label.title'),
      t('documents.label.status'),
      t('documents.label.verificationState'),
      t('documents.label.expiryDate'),
      t('documents.label.expires'),
      t('documents.label.versionCount'),
    ]}
  >
    {documents.map((document) => (
      <Row key={document.documentId}>
        <Cell>{textIn(document.title, language) ?? DASH}</Cell>
        <Cell>{t(`documents.status.${document.status}`)}</Cell>
        <Cell>{t(`documents.verification.${document.verificationState}`)}</Cell>
        <Cell>{orDash(document.expiryDate?.gregorian)}</Cell>
        <Cell>{t(`documents.expiry.${document.expiryState}`)}</Cell>
        <Cell>{document.versionCount}</Cell>
      </Row>
    ))}
  </Rows>
);

export const DocumentsSection = ({
  t,
  language,
  record,
}: SectionProps & {
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode => {
  const documents = record.documents;

  if (documents === undefined) return <Withheld t={t} title={t('admin.record.documents')} />;
  if (documents.length === 0) return <Empty t={t} title={t('admin.record.documents')} />;

  return (
    <Section title={t('admin.record.documents')}>
      <DocumentRows t={t} language={language} documents={documents} />
      <p className="text-xs opacity-70">{t('admin.notice.noDocumentContent')}</p>
    </Section>
  );
};

const LetterRows = ({
  t,
  letters,
}: SectionProps & { readonly letters: readonly IssuedLetterView[] }): ReactNode => (
  <Rows
    headings={[
      t('letters.label.reference'),
      t('letters.label.issuedAt'),
      t('letters.label.locale'),
      t('letters.label.signature'),
      t('letters.label.superseded'),
    ]}
  >
    {letters.map((letter) => (
      <Row key={letter.issuedLetterId}>
        <Cell>{letter.referenceNumber}</Cell>
        <Cell>{letter.issuedAt.gregorian}</Cell>
        <Cell>{letter.locale}</Cell>
        <Cell>{t(`letters.signature.${letter.signatureState}`)}</Cell>
        <Cell>{letter.supersededById === undefined ? DASH : dayOf(letter.supersededAt)}</Cell>
      </Row>
    ))}
  </Rows>
);

export const LettersSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode => {
  const letters = record.letters;

  if (letters === undefined) return <Withheld t={t} title={t('admin.record.letters')} />;
  if (letters.length === 0) return <Empty t={t} title={t('admin.record.letters')} />;

  return (
    <Section title={t('admin.record.letters')}>
      <LetterRows t={t} letters={letters} />
    </Section>
  );
};

const BalanceRows = ({
  t,
  balances,
}: SectionProps & { readonly balances: readonly LeaveBalanceView[] }): ReactNode => (
  <Rows
    headings={[
      t('leave.label.leaveYear'),
      t('leave.label.opening'),
      t('leave.label.accrued'),
      t('leave.label.consumed'),
      t('leave.label.available'),
      t('leave.label.stale'),
    ]}
  >
    {balances.map((balance) => (
      <Row key={`${balance.leaveTypeId}-${balance.leaveYearStart}`}>
        <Cell>{balance.leaveYearStart}</Cell>
        <Cell>{balance.openingMinutes}</Cell>
        <Cell>{balance.accruedMinutes}</Cell>
        <Cell>{balance.consumedMinutes}</Cell>
        <Cell>{balance.availableMinutes}</Cell>
        <Cell>{balance.inputsChangedAt === undefined ? DASH : t('leave.label.stale')}</Cell>
      </Row>
    ))}
  </Rows>
);

export const LeaveSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode => {
  const balances = record.balances;

  if (balances === undefined) return <Withheld t={t} title={t('admin.record.leave')} />;
  if (balances.length === 0) return <Empty t={t} title={t('admin.record.leave')} />;

  return (
    <Section title={t('admin.record.leave')}>
      <BalanceRows t={t} balances={balances} />
      <p className="text-xs opacity-70">{t('leave.label.minutes')}</p>
    </Section>
  );
};

const DayRows = ({
  t,
  days,
}: SectionProps & { readonly days: readonly AttendanceDayView[] }): ReactNode => (
  <Rows
    headings={[
      t('attendance.label.date'),
      t('attendance.label.state'),
      t('attendance.label.expectedMinutes'),
      t('attendance.label.workedMinutes'),
      t('attendance.label.absenceMinutes'),
      t('attendance.label.leave'),
    ]}
  >
    {days.map((day) => (
      <Row key={day.attendanceDayId}>
        <Cell>{day.attendanceDate}</Cell>
        <Cell>{t(`attendance.day.${day.state}`)}</Cell>
        <Cell>{day.expectedMinutes}</Cell>
        <Cell>{day.workedMinutes}</Cell>
        <Cell>{day.absenceMinutes}</Cell>
        <Cell>{t(`attendance.leave.${day.leaveState}`)}</Cell>
      </Row>
    ))}
  </Rows>
);

export const AttendanceSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode => {
  const days = record.attendanceDays;

  if (days === undefined) return <Withheld t={t} title={t('admin.record.attendance')} />;
  if (days.length === 0) return <Empty t={t} title={t('admin.record.attendance')} />;

  return (
    <Section title={t('admin.record.attendance')}>
      <DayRows t={t} days={days} />
    </Section>
  );
};

/** The counts Learning publishes about one employment. Every one is the module's own figure. */
const LearningFacts = ({
  t,
  history,
}: SectionProps & { readonly history: LearningHistoryView }): ReactNode => (
  <Facts>
    <Fact label={t('learning.label.openAssignments')} value={history.openAssignments} />
    <Fact label={t('learning.label.overdue')} value={history.overdueAssignments} />
    <Fact label={t('learning.label.completedCourses')} value={history.completedCourses} />
    <Fact label={t('learning.label.activeCertifications')} value={history.activeCertifications} />
    <Fact label={t('learning.label.expiring')} value={history.expiringCertifications} />
    <Fact label={t('learning.label.asOf')} value={history.asOf} />
  </Facts>
);

export const LearningSection = ({
  t,
  record,
}: SectionProps & { readonly record: EmployeeRecord }): ReactNode =>
  record.learning === undefined ? (
    <Withheld t={t} title={t('admin.record.learning')} />
  ) : (
    <Section title={t('admin.record.learning')}>
      <LearningFacts t={t} history={record.learning} />
    </Section>
  );
