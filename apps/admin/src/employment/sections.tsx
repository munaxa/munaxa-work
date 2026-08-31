import type { ReactNode } from 'react';
import { Section, TBody, TD, TH, THead, TR, Table } from '@munaxa/ui';
import type { EmploymentView } from '@work/employment/contracts';

import { nameIn, type Language } from './locale';
import { Isolated, Status } from './record-frame';
import { employmentTone } from './record-summary';

/**
 * The sections of the employment screen, one component each.
 *
 * Split from the page so neither outgrows the size and complexity budgets the standards set — and
 * because each of these answers a different question, which is exactly the seam a reader wants.
 *
 * Three things this screen does deliberately:
 *
 * **It renders placement as at a date.** The `asOf` on the page is not a filter, it is the date the
 * whole answer is resolved at — which is what makes "which department was this person in last
 * March" a question the screen can put on the page rather than a query somebody runs by hand.
 *
 * **It shows no organizational identifiers.** A unit's name and a manager's name are other modules'
 * to resolve, and no bounded read by identifier exists for a unit. A column of `01900000…` is not a
 * column: it carries nothing a reader can use and costs the width a real value would have had. The
 * employee record shows the placement in full, with the notice that explains it — so the directory
 * carries the facts `EmploymentView` answers for directly, and the record carries the rest.
 *
 * **Every row opens.** The listing was a dead end until the employee record existed: a workforce of
 * ten thousand people that could not be opened is a report rather than a directory. The link
 * carries the reader's language and the date the answer was resolved at, so the record opens
 * showing the same day the list was showing.
 *
 * **It says what Employment does not hold.** The boundaries section is not decoration: it is the
 * place a customer's administrator learns that leave status is Leave's and that work location is
 * not modelled, instead of concluding the field is missing.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
const short = (id: string | undefined): string => (id === undefined ? '—' : `${id.slice(0, 8)}…`);

/** The record's address, carrying the reader's language and the date the list was resolved at. */
const recordHref = (employmentId: string, language: Language, asOf: string | undefined): string =>
  `/employment/${employmentId}?lang=${language}${asOf === undefined ? '' : `&asOf=${asOf}`}`;

/**
 * One row of the directory, and the two cells that open the record.
 *
 * Both the number and the name link, because a reader reaches for whichever they were looking at;
 * a row that is only clickable on one cell is a row people click twice.
 *
 * A plain anchor rather than `next/link`: every screen here is server-rendered with
 * `cache: 'no-store'`, so a client-side transition would fetch the same page from the same server,
 * and `next/link`'s default export is named `Link`, which this workspace's naming rule refuses.
 */
const WorkforceRow = ({
  t,
  language,
  employment,
  asOf,
}: SectionProps & {
  readonly employment: EmploymentView;
  readonly asOf: string | undefined;
}): ReactNode => {
  const href = recordHref(employment.employmentId, language, asOf);

  return (
    <TR>
      <TD className="font-mono text-xs">
        <a href={href} className="underline underline-offset-4">
          <Isolated>{employment.employmentNumber}</Isolated>
        </a>
      </TD>
      <TD className="font-medium">
        <a href={href} className="underline underline-offset-4">
          {nameIn(employment.personName, language) ?? short(employment.personId)}
        </a>
      </TD>
      <TD>
        <Status tone={employmentTone(employment.status)}>
          {t(`employment.status.${employment.status}`)}
        </Status>
      </TD>
      <TD>
        <Isolated>{employment.employmentTypeCode}</Isolated>
      </TD>
      <TD>
        <Isolated>{employment.startDate}</Isolated>
      </TD>
    </TR>
  );
};

export const WorkforceSection = ({
  t,
  language,
  employments,
  unavailable,
  asOf,
}: SectionProps & {
  readonly employments: readonly EmploymentView[];
  readonly unavailable: boolean;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Section>
    {unavailable ? (
      <p className="text-sm text-muted-foreground">{t('employment.label.unavailable')}</p>
    ) : employments.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('employment.label.empty')}</p>
    ) : (
      <>
        <p className="text-sm text-muted-foreground">
          {employments.length} · {t('employment.label.asOf')}:{' '}
          <Isolated>{asOf ?? employments[0]?.asOf ?? '—'}</Isolated>
        </p>
        <Table>
          <THead>
            <TR>
              <TH>{t('employment.label.employmentNumber')}</TH>
              <TH>{t('employment.label.person')}</TH>
              <TH>{t('employment.label.status')}</TH>
              <TH>{t('employment.label.employmentType')}</TH>
              <TH>{t('employment.label.startDate')}</TH>
            </TR>
          </THead>
          <TBody>
            {employments.map((employment) => (
              <WorkforceRow
                key={employment.employmentId}
                t={t}
                language={language}
                employment={employment}
                asOf={asOf}
              />
            ))}
          </TBody>
        </Table>
      </>
    )}
  </Section>
);

/**
 * What Employment does not hold, stated on the screen.
 *
 * An administrator who cannot find work location here should learn *why* rather than conclude the
 * product forgot it — and the same for leave status, salary and the exit process. Every line here
 * is a boundary the architecture keeps, written where somebody meets it.
 */
export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <footer className="border-t border-border pt-4">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {t('employment.label.boundaries')}
    </h2>
    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs text-muted-foreground">
      {['leave', 'payroll', 'location', 'offboarding'].map((key) => (
        <li key={key}>{t(`employment.boundary.${key}`)}</li>
      ))}
    </ul>
  </footer>
);
