import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type { DuplicateCandidateView, PersonView } from '@work/people/contracts';

import { textIn, type Language } from './locale';

/**
 * The sections of the people screen, one component each.
 *
 * Split from the page so neither outgrows the size and complexity budgets the standards set — and
 * because each of these is the answer to a different question, which is exactly the seam a reader
 * wants.
 *
 * Two things this screen does deliberately:
 *
 * **It says when something is hidden.** A person whose sensitive fields were withheld renders a
 * note saying so, rather than a blank cell that reads as missing data. The API states it
 * (`sensitiveWithheld`) precisely so a screen does not have to guess.
 *
 * **It shows no identifier at all.** Not even the masked form. A register listing is a screen
 * somebody leaves open on a shared desk, and the last four digits of a national identifier are
 * still four digits of one. The masked value belongs on a person's own page, behind a deliberate
 * navigation.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const RegisterSection = ({
  t,
  language,
  people,
  unavailable,
  asOf,
}: SectionProps & {
  readonly people: readonly PersonView[];
  readonly unavailable: boolean;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-medium">{t('people.label.register')}</h2>
      <span className="text-xs opacity-60">
        {t('people.label.asOf')}: {asOf ?? '—'}
      </span>
    </div>
    <p className="text-sm opacity-70">{t('people.hint.nameHasHistory')}</p>
    {unavailable ? (
      <p className="text-sm opacity-70">{t('people.empty.unavailable')}</p>
    ) : people.length === 0 ? (
      <p className="text-sm opacity-70">{t('people.empty.register')}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li
            key={person.personId}
            className="flex flex-col gap-1 border-s-2 border-s-current/10 ps-3"
          >
            <span className="font-medium">{textIn(person.legalName, language)}</span>
            <span className="text-xs opacity-70">
              {t('people.label.personNumber')}: {person.personNumber} ·{' '}
              {t(`people.status.${person.status}`)}
            </span>
            {person.sensitiveWithheld ? (
              <span className="text-xs opacity-60">{t('people.hint.sensitiveWithheld')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/**
 * The review queue.
 *
 * It shows the *reason* and the confidence rather than the values that matched, for the same
 * reason the refusal does: a screen listing "these two share national identifier 1234567890" would
 * put a national identifier on a page that is, by construction, shown to somebody who is not sure
 * whose it is.
 */
export const DuplicatesSection = ({
  t,
  duplicates,
}: Pick<SectionProps, 't'> & {
  readonly duplicates: readonly DuplicateCandidateView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('people.label.duplicates')}</h2>
    <p className="text-sm opacity-70">{t('people.hint.duplicatesNeedReview')}</p>
    {duplicates.length === 0 ? (
      <p className="text-sm opacity-70">{t('people.empty.duplicates')}</p>
    ) : (
      <ul className="flex flex-col gap-2">
        {duplicates.map((candidate) => (
          <li key={candidate.candidateId} className="flex flex-col gap-1 text-sm">
            <span>{t(`people.duplicate.reason.${candidate.reason}`)}</span>
            <span className="text-xs opacity-70">
              {t('people.label.confidence')}: {String(candidate.confidence)}% ·{' '}
              {t(`people.duplicate.${candidate.status}`)}
            </span>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

/** What this register does not hold, stated on the screen rather than only in a document. */
export const BoundariesSection = ({ t }: Pick<SectionProps, 't'>): ReactNode => (
  <Card className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-medium">{t('people.label.person')}</h2>
    <p className="text-sm opacity-70">{t('people.hint.identityIsPermanent')}</p>
    <p className="text-sm opacity-70">{t('people.hint.noEmployment')}</p>
    <p className="text-sm opacity-70">{t('people.hint.identifierMasked')}</p>
  </Card>
);
