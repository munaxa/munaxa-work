import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type { EmploymentHistoryView, EmploymentView } from '@work/employment/contracts';

import { dateOf, nameIn, type Language } from './locale';

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
 * **It shows identifiers for organizational references, not names.** A unit's name is
 * Organization's to resolve, and this screen has not asked it. Rendering a truncated identifier is
 * honest; caching a name here would be a second answer that goes stale on the first rename.
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
  <Card className="flex flex-col gap-3 p-6">
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-medium">{t('employment.label.workforce')}</h2>
      <span className="text-xs opacity-60">
        {t('employment.label.asOf')}: {asOf ?? '—'}
      </span>
    </div>

    {unavailable ? (
      <p className="text-sm opacity-70">{t('employment.label.unavailable')}</p>
    ) : employments.length === 0 ? (
      <p className="text-sm opacity-70">{t('employment.label.empty')}</p>
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-60">
          <tr>
            <th scope="col" className="py-1 text-start font-normal">
              {t('employment.label.employmentNumber')}
            </th>
            <th scope="col" className="py-1 text-start font-normal">
              {t('employment.label.person')}
            </th>
            <th scope="col" className="py-1 text-start font-normal">
              {t('employment.label.status')}
            </th>
            <th scope="col" className="py-1 text-start font-normal">
              {t('employment.label.unit')}
            </th>
            <th scope="col" className="py-1 text-start font-normal">
              {t('employment.label.manager')}
            </th>
          </tr>
        </thead>
        <tbody>
          {employments.map((employment) => (
            <tr key={employment.employmentId} className="border-t border-current/10">
              <td className="py-1 font-mono text-xs">{employment.employmentNumber}</td>
              <td className="py-1">
                {nameIn(employment.personName, language) ?? short(employment.personId)}
              </td>
              <td className="py-1">{t(`employment.status.${employment.status}`)}</td>
              <td className="py-1 font-mono text-xs">{short(employment.assignment?.unitId)}</td>
              <td className="py-1 font-mono text-xs">{short(employment.managerEmploymentId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const TimelineSection = ({
  t,
  history,
}: SectionProps & { readonly history: EmploymentHistoryView | undefined }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('employment.label.history')}</h2>

    {history === undefined ? (
      <p className="text-sm opacity-70">{t('employment.label.empty')}</p>
    ) : (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t('employment.label.statusHistory')}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {history.statusHistory.map((entry) => (
              <li key={entry.recordId} className="flex flex-wrap gap-2 opacity-80">
                <span>{dateOf(entry.effectiveFrom)}</span>
                <span>
                  {entry.fromStatus === undefined
                    ? t(`employment.status.${entry.toStatus}`)
                    : `${t(`employment.status.${entry.fromStatus}`)} → ${t(`employment.status.${entry.toStatus}`)}`}
                </span>
                <span className="text-xs opacity-60">
                  {t('employment.label.recordedBy')}: {entry.recordedBy}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t('employment.label.assignments')}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {history.assignments.map((assignment) => (
              <li key={assignment.assignmentId} className="flex flex-wrap gap-2 opacity-80">
                <span>
                  {dateOf(assignment.effectiveFrom)} → {dateOf(assignment.effectiveTo)}
                </span>
                <span className="font-mono text-xs">{short(assignment.unitId)}</span>
                <span className="text-xs opacity-60">{assignment.assignmentType}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    )}
  </Card>
);

/**
 * What Employment does not hold, stated on the screen.
 *
 * An administrator who cannot find work location here should learn *why* rather than conclude the
 * product forgot it — and the same for leave status, salary and the exit process. Every line here
 * is a boundary the architecture keeps, written where somebody meets it.
 */
export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-medium">{t('employment.label.boundaries')}</h2>
    <ul className="flex list-disc flex-col gap-1 text-sm opacity-80 ps-5">
      {['leave', 'payroll', 'location', 'offboarding'].map((key) => (
        <li key={key}>{t(`employment.boundary.${key}`)}</li>
      ))}
    </ul>
  </Card>
);
