import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type { CandidateView, RequisitionView, VacancyView } from '@work/recruitment/contracts';

import { textIn, type Language } from './locale';

/**
 * The sections of the recruitment screen, one component each.
 *
 * Split from the page so neither outgrows the size and complexity budgets the standards set — and
 * because each answers a different question, which is exactly the seam a reader wants.
 *
 * Three things this screen does deliberately:
 *
 * **It shows a requisition's remaining headcount**, because that is the control the whole module
 * turns on: hiring is authorized in advance, and what is left is the number somebody acts on.
 *
 * **It shows identifiers for organizational references, not names.** A unit's name is
 * Organization's to resolve, and this screen has not asked it. Rendering a truncated identifier is
 * honest; caching a name here would be a second answer that goes stale on the first rename.
 *
 * **It says what Recruitment does not hold.** The boundaries section is not decoration: it is where
 * a customer's administrator learns that a candidate is not a person, that a proposed offer is not
 * pay, and that there is no candidate portal in this phase — instead of concluding a field is
 * missing.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
const short = (id: string | undefined): string => (id === undefined ? '—' : `${id.slice(0, 8)}…`);

export const RequisitionsSection = ({
  t,
  requisitions,
  unavailable,
}: SectionProps & {
  readonly requisitions: readonly RequisitionView[];
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('recruitment.label.requisitions')}</h2>

    {unavailable ? (
      <p className="text-sm opacity-70">{t('recruitment.label.unavailable')}</p>
    ) : requisitions.length === 0 ? (
      <p className="text-sm opacity-70">{t('recruitment.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {requisitions.map((requisition) => (
          <li key={requisition.requisitionId} className="flex flex-wrap gap-3">
            <span className="font-medium">{requisition.requisitionNumber}</span>
            <span className="opacity-70">
              {t(`recruitment.status.requisition.${requisition.status}`)}
            </span>
            <span className="opacity-70">
              {t('recruitment.label.headcount')}: {requisition.headcountRequested} ·{' '}
              {t('recruitment.label.filled')}: {requisition.headcountFilled} ·{' '}
              {t('recruitment.label.remaining')}: {requisition.headcountRemaining}
            </span>
            <span className="opacity-50">{short(requisition.unitId)}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const VacanciesSection = ({
  t,
  language,
  vacancies,
}: SectionProps & { readonly vacancies: readonly VacancyView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('recruitment.label.vacancies')}</h2>

    {vacancies.length === 0 ? (
      <p className="text-sm opacity-70">{t('recruitment.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {vacancies.map((vacancy) => (
          <li key={vacancy.vacancyId} className="flex flex-wrap gap-3">
            <span className="font-medium">{textIn(vacancy.title, language)}</span>
            <span className="opacity-70">{t(`recruitment.status.vacancy.${vacancy.status}`)}</span>
            <span className="opacity-50">{vacancy.openedOn ?? '—'}</span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/**
 * Candidates, with the one thing this screen must not get wrong: an anonymized candidate is shown
 * as the redacted record it now is, rather than hidden. The record survived on purpose.
 */
export const CandidatesSection = ({
  t,
  language,
  candidates,
}: SectionProps & { readonly candidates: readonly CandidateView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('recruitment.label.candidates')}</h2>

    {candidates.length === 0 ? (
      <p className="text-sm opacity-70">{t('recruitment.label.empty')}</p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm">
        {candidates.map((candidate) => (
          <li key={candidate.candidateId} className="flex flex-wrap gap-3">
            <span className="font-medium">{candidate.candidateNumber}</span>
            <span>{textIn(candidate.displayName, language)}</span>
            <span className="opacity-70">
              {t(`recruitment.status.candidate.${candidate.status}`)}
            </span>
            <span className="opacity-50">
              {t('recruitment.label.source')}: {candidate.sourceCode}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-medium">{t('recruitment.label.boundaries')}</h2>
    <ul className="flex flex-col gap-1 text-sm opacity-80">
      <li>{t('recruitment.label.boundaryPerson')}</li>
      <li>{t('recruitment.label.boundaryCompensation')}</li>
      <li>{t('recruitment.label.boundaryPortal')}</li>
      <li>{t('recruitment.label.boundaryDocuments')}</li>
    </ul>
  </Card>
);
