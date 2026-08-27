import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { directionOf, isLanguage, type Language } from '../../../shell/locale';
import { loadEmployment, loadRecord, type EmployeeRecord } from '../../../employment/record-api';
import { nameIn } from '../../../employment/locale';
import { recordTranslator, short } from '../../../employment/record-locale';
import { EmploymentSummary, employmentTone } from '../../../employment/record-summary';
import {
  ContractsSection,
  IdentitySection,
  PlacementSection,
} from '../../../employment/record-identity';
import {
  AttendanceSection,
  DocumentsSection,
  LeaveSection,
  LearningSection,
  LettersSection,
} from '../../../employment/record-operations';
import {
  AssetsSection,
  BoundariesNote,
  CareerSection,
  RelationsSection,
} from '../../../employment/record-governance';
import { Isolated, Status } from '../../../employment/record-frame';

/**
 * One employee, as an HR administrator needs to see them.
 *
 * This is the screen the product did not have. Before it, `people` listed people and `employment`
 * listed employments, eleven other modules held facts about the same human being, and no surface
 * anywhere joined them — so the central object of an HR product had no page.
 *
 * **It is keyed on the employment, not the person.** Every operational module in this product
 * references an employment and none references a person: attendance, leave, letters, custody,
 * disciplinary records and career all hang off the relationship rather than the human. A record
 * keyed on the person would have had to choose one of somebody's employments to show, and choosing
 * is exactly what the architecture refuses to do.
 *
 * **`?asOf=` resolves the whole answer, not a filter.** A placement, a name and a profile are all
 * effective-dated, so "what did this record say last March" is a question this page can answer
 * rather than a query somebody runs by hand.
 *
 * **`?lang=` switches language and direction together.** Direction follows language here exactly as
 * it does in the shell, and never as a separate control.
 *
 * **Presentation only.** It consumes published contracts and holds no business logic: no rule about
 * who may see a date of birth, no idea what makes a custody outstanding, nothing that decides
 * whether a document has expired. Every one of those lives in the module that owns it, and a screen
 * that reimplemented one would be a second, weaker answer to a question the API already decided.
 */

export const metadata: Metadata = { title: 'Employee record' };

interface PageProps {
  readonly params: Promise<{ readonly employmentId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Whether a single module answered anything at all.
 *
 * When none did — the ordinary state of a deployment with no Platform authentication adapter — the
 * record says so once, at the top, instead of repeating the same sentence under twelve headings.
 */
const answeredNothing = (record: EmployeeRecord): boolean =>
  [
    record.profile,
    record.assignments,
    record.reportingLines,
    record.contracts,
    record.documents,
    record.letters,
    record.balances,
    record.attendanceDays,
    record.career,
    record.learning,
    record.violations,
    record.clearance,
  ].every((answer) => answer === undefined);

/**
 * The record's twelve sections, or the one sentence that replaces all of them.
 *
 * When no module answered — the ordinary state of a deployment with no Platform authentication
 * adapter — the record says so once. Twelve headings each carrying the same apology is what that
 * state used to look like, and it read as a broken screen rather than a locked one.
 */
const RecordBody = ({
  t,
  language,
  record,
}: {
  readonly t: ReturnType<typeof recordTranslator>;
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode =>
  answeredNothing(record) ? (
    <EmptyState
      title={t('admin.record.nothingReadable')}
      description={t('admin.notice.notSignedIn')}
    />
  ) : (
    <Stack gap={8}>
      <IdentitySection t={t} language={language} record={record} />
      <PlacementSection t={t} language={language} record={record} />
      <ContractsSection t={t} record={record} />
      <DocumentsSection t={t} language={language} record={record} />
      <LettersSection t={t} record={record} />
      <LeaveSection t={t} language={language} record={record} />
      <AttendanceSection t={t} record={record} />
      <CareerSection t={t} record={record} />
      <LearningSection t={t} record={record} />
      <RelationsSection t={t} record={record} />
      <AssetsSection t={t} record={record} />
    </Stack>
  );

const EmployeeRecordPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { employmentId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const asOf = single(parameters['asOf']);
  const t = recordTranslator(language);

  const employment = await loadEmployment(employmentId, asOf);

  // Asked first and on its own: an identifier the API will not resolve is a 404, not a page of
  // thirteen refusals. `notFound()` renders the route's own `not-found.tsx`.
  if (employment === undefined) notFound();

  const record = await loadRecord(employment, asOf);
  const name = nameIn(employment.personName, language);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/employment?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('admin.record.backToDirectory')}
            </a>
          }
          title={name ?? short(employment.personId)}
          description={
            <>
              {t('admin.label.asOf')}: <Isolated>{employment.asOf}</Isolated>
            </>
          }
          actions={
            <Status tone={employmentTone(employment.status)}>
              {t(`employment.status.${employment.status}`)}
            </Status>
          }
        />

        <EmploymentSummary t={t} language={language} record={record} />

        <RecordBody t={t} language={language} record={record} />

        <BoundariesNote t={t} />
      </Page>
    </div>
  );
};

export default EmployeeRecordPage;
