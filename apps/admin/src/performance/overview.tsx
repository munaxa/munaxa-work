import type { ReactNode } from 'react';
import type { CycleView, GoalView, ReviewView } from '@work/performance/contracts';

import { Figure, Section, type SectionProps } from './sections';

/**
 * The overview: how far the cycle has got, counted from what the API returned.
 *
 * **Every figure here has a source.** Each is a count of rows the listings already fetched for this
 * cycle, or the server's own total — never a KPI invented because a dashboard looked sparse without
 * one. There is no "engagement score", no "on-track percentage" and no trend, because nothing in
 * this product produces any of them and a number with no source is a number somebody will act on.
 *
 * The counts are over the **page** the API returned, and the page size is stated beside the totals
 * in each listing. That is a real limitation and it is better than the alternative: fetching a
 * tenant's whole review set into a browser to count it is the thing §15 and §16 exist to prevent,
 * and a screen that did it would fall over on the first customer with a real workforce.
 */

export const OverviewSection = ({
  t,
  cycle,
  cycles,
  reviews,
  reviewsTotal,
  goalsTotal,
  unavailable,
}: SectionProps & {
  readonly cycle: CycleView | undefined;
  readonly cycles: readonly CycleView[];
  readonly reviews: readonly ReviewView[];
  readonly reviewsTotal: number;
  readonly goalsTotal: number;
  readonly unavailable: boolean;
}): ReactNode => {
  if (unavailable) {
    return (
      <Section t={t} title="overview">
        <p className="text-sm opacity-70">{t('performance.notice.unauthenticated')}</p>
      </Section>
    );
  }

  const open = cycles.filter(
    (each) => each.status === 'open' || each.status === 'in_progress',
  ).length;
  const completed = reviews.filter((review) => review.status === 'completed').length;
  const awaitingManager = reviews.filter((review) => review.status === 'manager_assessment').length;
  // Scored but not yet completed: what a calibration panel would be looking at.
  const awaitingCalibration = reviews.filter(
    (review) => review.calculatedScore !== undefined && review.status !== 'completed',
  ).length;

  return (
    <Section t={t} title="overview" note="performance.notice.noNotifications">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Figure t={t} label="openCycles" value={open} />
        <Figure t={t} label="cycle" value={cycle?.code ?? '—'} />
        {/* The server's own totals, not the length of a page. */}
        <Figure t={t} label="reviewsInProgress" value={reviewsTotal} />
        <Figure t={t} label="goalsActive" value={goalsTotal} />
        <Figure t={t} label="reviewsCompleted" value={completed} />
        <Figure t={t} label="awaitingManager" value={awaitingManager} />
        <Figure t={t} label="awaitingCalibration" value={awaitingCalibration} />
        <Figure t={t} label="total" value={cycle?.participantCount ?? 0} />
      </dl>
    </Section>
  );
};

/**
 * What this product does not do, said once and plainly.
 *
 * A screen that simply lacked these would read as an unfinished screen. Saying that nothing delivers
 * a notification, nothing runs on a schedule, no document bytes exist, no reviewer is anonymous and
 * no manager can see their own queue is the difference between a missing dependency and a bug — and
 * it stops a later reader from building a control on top of a capability that is not there.
 */
export const UnavailableSection = ({ t }: SectionProps): ReactNode => (
  <Section t={t} title="status">
    <ul className="flex flex-col gap-2 text-sm">
      {[
        'performance.notice.readTeamUnavailable',
        'performance.notice.noNotifications',
        'performance.notice.noSchedule',
        'performance.notice.noDocumentBytes',
        'performance.notice.notAnonymous',
        'performance.notice.noOkr',
      ].map((key) => (
        <li key={key} className="opacity-70">
          {t(key)}
        </li>
      ))}
    </ul>
  </Section>
);

/** The goals of one cycle, filtered by the server. Never filtered here. */
export const filteredGoals = (goals: readonly GoalView[]): readonly GoalView[] => goals;
