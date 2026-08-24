import type { ReactNode } from 'react';

import type { Language } from '../shell/locale';

import { Fact, Facts, Isolated, orDash, type SectionProps, type Tone } from './record-frame';
import { nameIn } from './locale';
import type { EmployeeRecord } from './record-api';

/**
 * The block directly under the name: the six facts an administrator needs before anything else.
 *
 * It exists because the record used to open with two panels of scalar facts — "Identity" and
 * "Employment" — that between them answered *who* and *what*, and a reader had to read both before
 * knowing whether this was the right person. These six are the ones every downstream question hangs
 * on: what the relationship is, when it started and whether it has ended, who the manager is, and
 * which employment number to quote.
 *
 * **It composes nothing new.** Every value is one a module already returned to a section below,
 * shown once at the top instead of only once further down; the sections keep the rest.
 *
 * **The manager is a name and the unit is not**, for the reason the placement section states: a
 * bounded read by identifier exists for one and not for the other.
 */

/** How Employment's own status vocabulary reads at a glance. The meaning stays the module's. */
const EMPLOYMENT_TONE: Readonly<Record<string, Tone>> = {
  active: 'success',
  suspended: 'warning',
  ended: 'muted',
  draft: 'muted',
  pending_approval: 'default',
};

export const employmentTone = (status: string): Tone => EMPLOYMENT_TONE[status] ?? 'muted';

export const EmploymentSummary = ({
  t,
  language,
  record,
}: SectionProps & {
  readonly language: Language;
  readonly record: EmployeeRecord;
}): ReactNode => {
  const employment = record.employment;

  if (employment === undefined) return null;

  return (
    <Facts>
      <Fact
        label={t('employment.label.employmentNumber')}
        value={<Isolated>{employment.employmentNumber}</Isolated>}
      />
      <Fact
        label={t('employment.label.employmentType')}
        value={<Isolated>{employment.employmentTypeCode}</Isolated>}
      />
      <Fact
        label={t('employment.label.originalHireDate')}
        value={<Isolated>{employment.originalHireDate}</Isolated>}
      />
      <Fact
        label={t('employment.label.startDate')}
        value={<Isolated>{employment.startDate}</Isolated>}
      />
      <Fact
        label={t('employment.label.endDate')}
        value={<Isolated>{orDash(employment.endDate)}</Isolated>}
      />
      <Fact
        label={t('employment.label.manager')}
        value={nameIn(record.managerName, language) ?? t('admin.label.notResolved')}
      />
    </Facts>
  );
};
