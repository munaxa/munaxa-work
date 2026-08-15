import type { ReactNode } from 'react';
import type { CareerSummaryView } from '@work/career/contracts';

import { civil, count } from './exact';
import { Empty, Figure, Section, Status, short, type SectionProps } from './sections';

/**
 * The overview: where a tenant's career and succession position stands, counted from what the API
 * returned.
 *
 * **Every figure here has a source.** Each is either the server's own total or a count of rows the
 * listings already fetched — never a KPI invented because a dashboard looked sparse. There is no
 * "bench coverage percentage", no readiness score, no high-potential count and no trend, because
 * nothing in this product produces any of them and a succession number with no source is a number
 * somebody will act on when deciding who replaces a director.
 *
 * **`asOf` is displayed.** The derived answers on this page — a path's `inForce`, a bench's
 * `reviewDue`, an item's `overdue`, a recommendation's `standing` — are all functions of a day, and
 * the API says which day it used. A screen that showed "review due" without saying what "due" was
 * measured from would be a succession claim with no date on it.
 */

export const OverviewSection = ({
  t,
  pathsTotal,
  plansTotal,
  poolsTotal,
  membershipsTotal,
  successionPlansTotal,
  recommendationsTotal,
  levelCount,
  asOf,
  unavailable,
}: SectionProps & {
  readonly pathsTotal: number;
  readonly plansTotal: number;
  readonly poolsTotal: number;
  readonly membershipsTotal: number;
  readonly successionPlansTotal: number;
  readonly recommendationsTotal: number;
  readonly levelCount: number;
  readonly asOf: string | undefined;
  readonly unavailable: boolean;
}): ReactNode => {
  if (unavailable) {
    return (
      <Section t={t} title="overview">
        <p className="text-sm opacity-70">{t('career.notice.unauthenticated')}</p>
      </Section>
    );
  }

  return (
    <Section t={t} title="overview" note="career.notice.countsAreOfThisPage">
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        {/* The server's own totals, not the length of a page. */}
        <Figure t={t} label="paths" value={count(pathsTotal)} />
        <Figure t={t} label="plans" value={count(plansTotal)} />
        <Figure t={t} label="pools" value={count(poolsTotal)} />
        <Figure t={t} label="memberships" value={count(membershipsTotal)} />
        <Figure t={t} label="succession" value={count(successionPlansTotal)} />
        <Figure t={t} label="mobility" value={count(recommendationsTotal)} />
        <Figure t={t} label="levels" value={count(levelCount)} />
        {/* The day the derived answers were computed against, exactly as the API reported it. */}
        <Figure t={t} label="asOf" value={civil(asOf)} />
      </dl>
    </Section>
  );
};

/**
 * One person's standing, as the API's own summary query answered it.
 *
 * **The employment is a subject, not an identity.** It is the employment the plan listing happened
 * to surface, read by an administrator who could already see the plan. It is emphatically not "the
 * signed-in employee": this product cannot resolve a principal to an employment (ADR-0032), and a
 * screen that presented this as somebody's own career would be inventing that resolution. There is
 * no route here for it and no picker, and the status section says so.
 *
 * Every value below is the server's. The open memberships, the open nominations, the latest
 * readiness statement and the active development plan were selected by the API against the day it
 * reports, and nothing here filters, counts or re-derives them.
 */
export const SummarySection = ({
  t,
  summary,
}: SectionProps & { readonly summary: CareerSummaryView | undefined }): ReactNode => (
  <Section t={t} title="summary" note="career.notice.identifiersNotNames">
    {summary === undefined ? (
      <Empty t={t} />
    ) : (
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Figure t={t} label="employment" value={short(summary.employmentId)} />
        <Figure t={t} label="asOf" value={civil(summary.asOf)} />
        <Figure
          t={t}
          label="plans"
          value={
            summary.plan === undefined ? (
              '—'
            ) : (
              <Status t={t} group="careerPlanStatus" status={summary.plan.status} />
            )
          }
        />
        <Figure t={t} label="openPools" value={count(summary.openPoolMemberships.length)} />
        <Figure t={t} label="openNominations" value={count(summary.openNominations.length)} />
        <Figure
          t={t}
          label="openRecommendations"
          value={count(summary.openRecommendations.length)}
        />
        <Figure
          t={t}
          label="latestReadiness"
          value={
            // The level the assessor named. Never a score, never a band, and never a percentage —
            // the identifier is shown because resolving it to a rung is the levels table's job.
            summary.latestReadiness === undefined
              ? '—'
              : short(summary.latestReadiness.readinessLevelId)
          }
        />
        <Figure
          t={t}
          label="developmentPlans"
          value={
            summary.activeDevelopmentPlan === undefined ? (
              '—'
            ) : (
              <Status
                t={t}
                group="developmentPlanStatus"
                status={summary.activeDevelopmentPlan.status}
              />
            )
          }
        />
      </dl>
    )}
  </Section>
);
