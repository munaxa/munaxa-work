import { success, type Query, type QueryHandler } from '@work/kernel';

import type { CareerSummaryView } from '../contracts/views.js';
import { civilDateOf } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import {
  careerPlanView,
  developmentPlanView,
  mobilityRecommendationView,
  poolMembershipView,
  readinessAssessmentView,
  successorView,
} from './career-views.js';
import { personScopeFor } from './authorization.js';
import { pageOf } from './career-paging.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * One person's career position, assembled on read.
 *
 * **Not a table** (D-16, ADR-0008). A materialized summary needs something to maintain it, and
 * nothing in this repository runs — the same conclusion Phases 12, 13 and 14A each reached, and the
 * shape Phase 14A measured holding at 100,000 employments.
 *
 * **Six bounded reads, all of Career's own rows, none of them per-row.** There is no loop here that
 * calls another module once per membership or once per nomination; the N+1 that would produce is the
 * exact shape §19 flagged as suspect before a line of this was written.
 *
 * **What this summary deliberately does not contain**, stated rather than left to be noticed:
 *
 * - **No nine-box band, no potential band, no high-potential flag.** Performance owns talent
 *   placement (ADR-0073), and the bounded read that would fetch one person's was not authorized
 *   (D-5). Consuming the unpaged `talent-matrix` here would load a whole cycle to answer a question
 *   about one person. `NOT VERIFIED`.
 * - **No position criticality.** Organization owns it (AD-004), and there is no filter to ask with
 *   (D-4). `NOT VERIFIED`.
 * - **No learning record.** Learning publishes `read-history`, and a consumer wanting it asks
 *   Learning; copying it through here would put a second, staler answer to "what has this person
 *   completed" inside a career summary.
 * - **No readiness score.** `latestReadiness` is the most recent *statement*, returned whole. It is
 *   a selection, not a computation: nothing averages two assessors' views into a third that neither
 *   of them holds (ADR-0074).
 */

export interface ReadCareerSummary extends Query {
  readonly queryName: 'career.read-summary';
  readonly employmentId: string;
  readonly asOf?: string;
}

/** The most this summary lists of any one collection. A summary is not a listing. */
const SUMMARY_LIMIT = 20;

export const readCareerSummaryHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadCareerSummary, CareerSummaryView> => ({
  queryName: 'career.read-summary',
  permission: CareerPermissions.planRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const scope = await personScopeFor(dependencies, CareerPermissions.planRead);

      // A caller with no scope gets an empty summary rather than a forbidden: the shape is the same
      // for a person with nothing recorded and a caller who may not see it, which is the point.
      if (scope.kind === 'none') return success(emptySummary(query.employmentId, asOf));

      const bounded = pageOf({ size: SUMMARY_LIMIT });
      const { employmentId } = query;
      const plan = await dependencies.stores.plans.activeFor(transaction, employmentId);
      const memberships = await dependencies.stores.memberships.search(
        transaction,
        { employmentId, openOnly: true },
        bounded,
      );
      const nominations = await dependencies.stores.successors.search(
        transaction,
        { employmentId, status: 'nominated' },
        bounded,
      );
      const history = await dependencies.stores.assessments.historyFor(transaction, employmentId);
      const development = await dependencies.stores.developmentPlans.activeFor(
        transaction,
        employmentId,
      );
      const open = await dependencies.stores.mobility.search(
        transaction,
        { employmentId, status: 'proposed' },
        bounded,
      );
      const [latest] = history;

      return success({
        employmentId,
        openPoolMemberships: memberships.items.map(poolMembershipView),
        openNominations: nominations.items.map(successorView),
        openRecommendations: open.items.map((held) => mobilityRecommendationView(held, asOf)),
        asOf,
        ...(plan === undefined ? {} : { plan: careerPlanView(plan) }),
        ...(latest === undefined ? {} : { latestReadiness: readinessAssessmentView(latest) }),
        ...(development === undefined
          ? {}
          : { activeDevelopmentPlan: developmentPlanView(development) }),
      });
    }),
});

/**
 * What a caller with no scope sees.
 *
 * Deliberately identical to the summary of somebody with nothing recorded. A distinguishable
 * "you may not see this" would confirm that there *is* something to see, which for succession
 * material is the disclosure itself.
 */
const emptySummary = (employmentId: string, asOf: string): CareerSummaryView => ({
  employmentId,
  openPoolMemberships: [],
  openNominations: [],
  openRecommendations: [],
  asOf,
});
