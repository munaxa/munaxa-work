import type { ReactNode } from 'react';

import { Section, type SectionProps } from './sections';

/**
 * What this product does not do, said once and plainly.
 *
 * A screen that simply lacked these would read as an unfinished screen. Naming them is the
 * difference between a missing dependency and a bug — and it stops a later reader from building a
 * control, a report or a decision on top of a capability that is not there.
 *
 * Each entry is a **documented absence**, not a feature waiting to be switched on, and none of them
 * has a placeholder success state anywhere on this page: there is no readiness score rendered as
 * "pending", no nine-box cell rendered as "—" beside a legend, no document link that would 404, and
 * no "my career" tab that would show an administrator's data.
 *
 * The list is written against the module's own catalogue, so the wording is the module's rather than
 * the portal's, and the Arabic is gated by `check-localization` alongside the English.
 *
 * Three of these are worth the words even though something adjacent does exist:
 *
 * - A **succession review** has a `reviewOn` date and a `reviewDue` flag, and nothing fires on
 *   either. The flag is the answer to a query somebody ran, against a day they stated.
 * - A **mobility recommendation** has a `validUntil` and a `standing` that reads `expired`, and
 *   nothing expires it. The same row reads as current if asked about an earlier day.
 * - A **development mix** is counted across three categories, and no rule judges the proportion.
 *   The verdict the API returns is the literal `NOT VERIFIED`, and this screen prints it.
 */

/**
 * The eight absences the module states, plus the four this screen must add for itself.
 *
 * The first eight are the domain's own `career.withheld.*` catalogue, written in Checkpoint 4. The
 * last four are portal-level facts: this Admin app has no mutation architecture, no file transfer,
 * no notification surface and no analytics — and a Career screen is not the place to introduce any
 * of them.
 */
const NOT_VERIFIED = [
  'career.withheld.selfService',
  'career.withheld.criticalPositions',
  'career.withheld.ninebox',
  'career.withheld.scheduledReview',
  'career.withheld.mobilityExpiry',
  'career.withheld.developmentMix',
  'career.withheld.evidenceDocument',
  'career.withheld.recommendationsOnly',
] as const;

export const StatusSection = ({ t }: SectionProps): ReactNode => (
  <Section t={t} title="statusNotices">
    <ul className="flex flex-col gap-2 text-sm">
      {NOT_VERIFIED.map((key) => (
        <li key={key} className="opacity-70">
          {t(key)}
        </li>
      ))}
      {/* The portal's own limitation, stated beside the module's. */}
      <li className="opacity-70">{t('career.notice.actionsAreApi')}</li>
      <li className="opacity-70">{t('career.notice.identifiersNotNames')}</li>
      <li className="opacity-70">{t('career.notice.derivedAtRead')}</li>
    </ul>
  </Section>
);
