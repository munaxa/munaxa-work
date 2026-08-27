import type { ReactNode } from 'react';
import type { AttendanceDayView } from '@work/attendance/contracts';
import type { DocumentView } from '@work/documents/contracts';
import type { LearningHistoryView } from '@work/learning/contracts';
import type { LeaveBalanceView, LeaveTypeView } from '@work/leave/contracts';
import type { IssuedLetterView } from '@work/letters/contracts';

import type { Language } from '../shell/locale';

import {
  Cell,
  DASH,
  Fact,
  Facts,
  Isolated,
  NothingToShow,
  RecordSection,
  Row,
  Rows,
  Status,
  Withheld,
  minutes,
  orDash,
  type SectionProps,
  type Tone,
} from './record-frame';
import { dayOf, short, textIn } from './record-locale';
import type { EmployeeRecord } from './record-api';

/**
 * What has happened to this employment: documents filed against it, letters issued about it, leave
 * it holds, days it worked and training it was asked to do.
 *
 * **Five modules, five permissions, five answers.** A caller who may read documents but not leave
 * sees the documents and a withheld leave section, and the difference is legible on the page rather
 * than inferred from an empty table.
 *
 * **The documents section lists documents and offers no file.** This product stores no bytes:
 * `StoragePort` has no adapter anywhere in the repository, so there is nothing to open, nothing to
 * download and no size to report. The notice says that, because a document row with no way to read
 * it looks like a broken link rather than a deliberate boundary.
 *
 * **Every minute carries its unit, and no other.** Leave and Attendance both publish whole minutes
 * and both ship the word for one in both languages. A screen that divided by sixty would be the
 * second place in this product that decided what a working day is.
 */

/** How Documents' own expiry vocabulary reads on a record. The meaning is the module's. */
const EXPIRY_TONE: Readonly<Record<string, Tone>> = {
  expired: 'danger',
  expiring_soon: 'warning',
  valid: 'success',
  no_expiry: 'muted',
};

const VERIFICATION_TONE: Readonly<Record<string, Tone>> = {
  verified: 'success',
  rejected: 'danger',
  pending_verification: 'warning',
  unverified: 'muted',
};

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
    numeric={[5]}
  >
    {documents.map((document) => (
      <Row key={document.documentId}>
        <Cell>{textIn(document.title, language) ?? DASH}</Cell>
        <Cell>{t(`documents.status.${document.status}`)}</Cell>
        <Cell>
          <Status tone={VERIFICATION_TONE[document.verificationState]}>
            {t(`documents.verification.${document.verificationState}`)}
          </Status>
        </Cell>
        <Cell>
          <Isolated>{orDash(document.expiryDate?.gregorian)}</Isolated>
        </Cell>
        <Cell>
          <Status tone={EXPIRY_TONE[document.expiryState]}>
            {t(`documents.expiry.${document.expiryState}`)}
          </Status>
        </Cell>
        <Cell numeric>{document.versionCount}</Cell>
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
  if (documents.length === 0) return <NothingToShow t={t} title={t('admin.record.documents')} />;

  return (
    <RecordSection title={t('admin.record.documents')}>
      <DocumentRows t={t} language={language} documents={documents} />
      <p className="text-xs text-muted-foreground">{t('admin.notice.noDocumentContent')}</p>
    </RecordSection>
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
        <Cell>
          <Isolated>{letter.referenceNumber}</Isolated>
        </Cell>
        <Cell>
          <Isolated>{letter.issuedAt.gregorian}</Isolated>
        </Cell>
        <Cell>
          <Isolated>{letter.locale}</Isolated>
        </Cell>
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
  if (letters.length === 0) return <NothingToShow t={t} title={t('admin.record.letters')} />;

  return (
    <RecordSection title={t('admin.record.letters')}>
      <LetterRows t={t} letters={letters} />
    </RecordSection>
  );
};

const BalanceRows = ({
  t,
  language,
  balances,
  leaveTypes,
}: SectionProps & {
  readonly language: Language;
  readonly balances: readonly LeaveBalanceView[];
  readonly leaveTypes: readonly LeaveTypeView[];
}): ReactNode => (
  <Rows
    headings={[
      t('leave.label.leaveType'),
      t('leave.label.leaveYear'),
      t('leave.label.opening'),
      t('leave.label.accrued'),
      t('leave.label.consumed'),
      t('leave.label.available'),
      t('leave.label.status'),
    ]}
    numeric={[2, 3, 4, 5]}
  >
    {balances.map((balance) => (
      <Row key={`${balance.leaveTypeId}-${balance.leaveYearStart}`}>
        <Cell>{leaveTypeName(leaveTypes, balance.leaveTypeId, language)}</Cell>
        <Cell>
          <Isolated>{balance.leaveYearStart}</Isolated>
        </Cell>
        <Cell numeric>{minutes(t, 'leave.label.minutes', balance.openingMinutes)}</Cell>
        <Cell numeric>{minutes(t, 'leave.label.minutes', balance.accruedMinutes)}</Cell>
        <Cell numeric>{minutes(t, 'leave.label.minutes', balance.consumedMinutes)}</Cell>
        <Cell numeric>{minutes(t, 'leave.label.minutes', balance.availableMinutes)}</Cell>
        <Cell>
          {balance.inputsChangedAt === undefined ? (
            DASH
          ) : (
            <Status tone="warning">{t('leave.label.stale')}</Status>
          )}
        </Cell>
      </Row>
    ))}
  </Rows>
);

/**
 * A leave type's name, from the tenant's own configuration.
 *
 * Falls back to the shortened identifier rather than to a blank: a balance whose type could not be
 * resolved is still a real balance, and an empty cell would read as a rendering fault. It never
 * invents a name — the tenant's list is the only source, and if Leave did not answer there is none.
 */
const leaveTypeName = (
  leaveTypes: readonly LeaveTypeView[],
  leaveTypeId: string,
  language: Language,
): string => {
  const found = leaveTypes.find((leaveType) => leaveType.leaveTypeId === leaveTypeId);

  return textIn(found?.name, language) ?? short(leaveTypeId);
};

export const LeaveSection = ({
  t,
  language,
  record,
}: SectionProps & {
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode => {
  const balances = record.balances;

  if (balances === undefined) return <Withheld t={t} title={t('admin.record.leave')} />;
  if (balances.length === 0) return <NothingToShow t={t} title={t('admin.record.leave')} />;

  return (
    <RecordSection title={t('admin.record.leave')}>
      <BalanceRows
        t={t}
        language={language}
        balances={balances}
        leaveTypes={record.leaveTypes ?? []}
      />
    </RecordSection>
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
    numeric={[2, 3, 4]}
  >
    {days.map((day) => (
      <Row key={day.attendanceDayId}>
        <Cell>
          <Isolated>{day.attendanceDate}</Isolated>
        </Cell>
        <Cell>{t(`attendance.day.${day.state}`)}</Cell>
        <Cell numeric>{minutes(t, 'attendance.label.minutes', day.expectedMinutes)}</Cell>
        <Cell numeric>{minutes(t, 'attendance.label.minutes', day.workedMinutes)}</Cell>
        <Cell numeric>
          {day.absenceMinutes === 0
            ? DASH
            : minutes(t, 'attendance.label.minutes', day.absenceMinutes)}
        </Cell>
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
  if (days.length === 0) return <NothingToShow t={t} title={t('admin.record.attendance')} />;

  return (
    <RecordSection title={t('admin.record.attendance')}>
      <DayRows t={t} days={days} />
    </RecordSection>
  );
};

/** The counts Learning publishes about one employment. Every one is the module's own figure. */
const LearningFacts = ({
  t,
  history,
}: SectionProps & { readonly history: LearningHistoryView }): ReactNode => (
  <Facts>
    <Fact label={t('learning.label.openAssignments')} value={history.openAssignments} />
    <Fact
      label={t('learning.label.overdue')}
      value={
        history.overdueAssignments === 0 ? (
          history.overdueAssignments
        ) : (
          <Status tone="warning">{history.overdueAssignments}</Status>
        )
      }
    />
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
    <RecordSection title={t('admin.record.learning')}>
      <LearningFacts t={t} history={record.learning} />
    </RecordSection>
  );
