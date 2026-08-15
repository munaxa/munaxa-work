/**
 * The **records** half of the Career benchmark fixture: what people actually did, as opposed to what
 * the tenant configured.
 *
 * Split from `career-benchmark-data.mjs` at the file-size budget, along the seam Phase 14A used for
 * the same reason. The division is a real one: next door builds the handful of ladders, pools and
 * readiness levels a tenant of any size has, and this builds the rows that grow with the workforce —
 * the plans, the memberships, the benches, the nominations, the statements, the development and the
 * recommendations.
 *
 * **The proportions are the ones a real workforce has**, because selectivity is what a query plan
 * turns on: about a third of employments carry a career plan, a tenth sit in a talent pool, a
 * twentieth are nominated somewhere, a tenth have a development plan, and a twentieth have a
 * recommendation open. A population where everybody is on an active plan measures a different index
 * from one where a third are, and the second is the case a succession screen is opened to see.
 *
 * **No impossible state is created to inflate a row count.** Every successor names a succession plan
 * that exists, every membership names a pool, every development item names a plan, and every
 * confirmed successor carries the day and the **named human** who confirmed it —
 * `career_successor_confirmation_check` refuses `system:auto-approval` here exactly as it refuses it
 * in production (ADR-0072).
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';

import { TODAY, insertAll } from './career-benchmark-data.mjs';

/**
 * A third of the workforce on a career plan, and one open plan per person at most.
 *
 * `career_plan_active_idx` is a partial unique index over the open statuses, so a second active plan
 * for the same employment is refused by the database. The fixture writes one per person and closes a
 * fifth of them, which is what makes `status` selective rather than uniform.
 */
export const seedPlans = async (admin, tenantId, people, paths) => {
  const published = paths.filter((path) => path.status === 'published');
  const plans = people
    .filter((_, index) => index % 3 === 0)
    .map((employmentId, index) => ({
      careerPlanId: uuidV7(),
      employmentId,
      pathId: published[index % published.length].pathId,
      status: index % 5 === 0 ? 'achieved' : 'active',
    }));

  await insertAll(
    admin,
    'career_plan',
    [
      'id',
      'tenant_id',
      'employment_id',
      'path_id',
      'status',
      'started_on',
      'closed_on',
      'closed_by',
    ],
    plans.map((plan) => [
      plan.careerPlanId,
      tenantId,
      plan.employmentId,
      plan.pathId,
      plan.status,
      '2026-02-28',
      plan.status === 'achieved' ? TODAY : null,
      plan.status === 'achieved' ? 'user:benchmark' : null,
    ]),
  );
  return plans;
};

/** A tenth of the workforce in a pool, a fifth of those already out again. */
export const seedMemberships = async (admin, tenantId, people, pools) => {
  const open = pools.filter((pool) => pool.status === 'active');
  const memberships = people
    .filter((_, index) => index % 10 === 0)
    .map((employmentId, index) => ({
      membershipId: uuidV7(),
      employmentId,
      talentPoolId: open[index % open.length].talentPoolId,
      ended: index % 5 === 0,
    }));

  await insertAll(
    admin,
    'career_pool_membership',
    [
      'id',
      'tenant_id',
      'talent_pool_id',
      'employment_id',
      'from_date',
      'to_date',
      'added_by',
      'removed_by',
    ],
    memberships.map((membership) => [
      membership.membershipId,
      tenantId,
      membership.talentPoolId,
      membership.employmentId,
      '2026-02-28',
      membership.ended ? '2026-07-31' : null,
      'user:benchmark',
      membership.ended ? 'user:benchmark' : null,
    ]),
  );
  return memberships;
};

/**
 * One succession plan per position, most of them active.
 *
 * `career_succession_plan_active_idx` refuses a second active plan for one position, so the fixture
 * writes exactly one per position and archives a tenth — which keeps the status filter selective and
 * exercises the partial index the way production does.
 */
export const seedSuccession = async (admin, tenantId, positions) => {
  const plans = positions.map((positionId, index) => ({
    successionPlanId: uuidV7(),
    positionId,
    status: index % 10 === 0 ? 'archived' : 'active',
    // A third carry a review date already past, so `reviewOnOrBefore` finds rows rather than none.
    reviewOn: index % 3 === 0 ? '2026-06-30' : '2027-06-30',
  }));

  await insertAll(
    admin,
    'career_succession_plan',
    ['id', 'tenant_id', 'position_id', 'status', 'review_on', 'archived_at', 'archived_by'],
    plans.map((plan) => [
      plan.successionPlanId,
      tenantId,
      plan.positionId,
      plan.status,
      plan.reviewOn,
      plan.status === 'archived' ? new Date() : null,
      plan.status === 'archived' ? 'user:benchmark' : null,
    ]),
  );
  return plans;
};

/**
 * A twentieth of the workforce nominated, spread across the benches.
 *
 * A confirmed nomination carries `confirmed_on` and a **named human** in `confirmed_by`:
 * `career_successor_confirmation_check` refuses `system:auto-approval`, and the fixture does not get
 * an exemption from a rule the module exists to keep (ADR-0072).
 */
export const seedSuccessors = async (admin, tenantId, people, succession, levels) => {
  const open = succession.filter((plan) => plan.status === 'active');
  const successors = people
    .filter((_, index) => index % 20 === 0)
    .map((employmentId, index) => ({
      successorId: uuidV7(),
      employmentId,
      successionPlanId: open[index % open.length].successionPlanId,
      readinessLevelId: levels[index % levels.length].readinessLevelId,
      status: index % 4 === 0 ? 'confirmed' : index % 9 === 0 ? 'withdrawn' : 'nominated',
      rank: (index % 50) + 1,
    }));

  await insertAll(
    admin,
    'career_successor',
    [
      'id',
      'tenant_id',
      'succession_plan_id',
      'employment_id',
      'readiness_level_id',
      'rank',
      'status',
      'nominated_on',
      'nominated_by',
      'confirmed_on',
      'confirmed_by',
      'withdrawn_on',
      'withdrawn_by',
      'withdrawal_reason',
    ],
    successors.map((successor) => [
      successor.successorId,
      tenantId,
      successor.successionPlanId,
      successor.employmentId,
      successor.readinessLevelId,
      successor.rank,
      successor.status,
      '2026-02-28',
      'user:benchmark',
      successor.status === 'confirmed' ? TODAY : null,
      successor.status === 'confirmed' ? 'user:benchmark-hr' : null,
      successor.status === 'withdrawn' ? TODAY : null,
      successor.status === 'withdrawn' ? 'user:benchmark' : null,
      successor.status === 'withdrawn' ? 'left the organization' : null,
    ]),
  );
  return successors;
};

/** Two statements per nominated person, so the history read has something to order. */
export const seedAssessments = async (admin, tenantId, people, succession, levels) => {
  const open = succession.filter((plan) => plan.status === 'active');
  const rows = people
    .filter((_, index) => index % 20 === 0)
    .flatMap((employmentId, index) =>
      ['2026-03-31', '2026-06-30'].map((assessedOn) => [
        uuidV7(),
        tenantId,
        employmentId,
        levels[index % levels.length].readinessLevelId,
        open[index % open.length].successionPlanId,
        assessedOn,
        'user:benchmark-assessor',
        // The instant the statement was written down, which is not the day it is about. Both are
        // stored because an assessment is immutable and its ordering is by the day somebody
        // assessed, not by when the row happened to be inserted.
        new Date(),
      ]),
    );

  await insertAll(
    admin,
    'career_readiness_assessment',
    [
      'id',
      'tenant_id',
      'employment_id',
      'readiness_level_id',
      'succession_plan_id',
      'assessed_on',
      'assessed_by',
      'recorded_at',
    ],
    rows,
  );
};

/** A tenth of the workforce on a development plan, most of them active. */
export const seedDevelopment = async (admin, tenantId, people) => {
  const plans = people
    .filter((_, index) => index % 10 === 0)
    .map((employmentId, index) => ({
      developmentPlanId: uuidV7(),
      employmentId,
      status: index % 6 === 0 ? 'completed' : 'active',
    }));

  await insertAll(
    admin,
    'career_development_plan',
    [
      'id',
      'tenant_id',
      'employment_id',
      'status',
      'started_on',
      'employee_acknowledged_on',
      'employee_acknowledgement_recorded_by',
      'closed_on',
      'closed_by',
    ],
    plans.map((plan) => [
      plan.developmentPlanId,
      tenantId,
      plan.employmentId,
      plan.status,
      '2026-02-28',
      '2026-03-05',
      'user:benchmark',
      plan.status === 'completed' ? TODAY : null,
      plan.status === 'completed' ? 'user:benchmark' : null,
    ]),
  );
  return plans;
};

/**
 * Three items per development plan, one of each category.
 *
 * The categories are even across the three because nothing validates the proportion — the 70-20-10
 * mix is counted and never judged (D-12), so a fixture skewed to imply a balance would be asserting
 * a rule this product does not have.
 *
 * A third carry a target date already past, so `targetOnOrBefore` finds rows rather than none.
 */
export const seedItems = async (admin, tenantId, development) => {
  const categories = ['experience', 'exposure', 'education'];
  const rows = development.flatMap((plan, index) =>
    categories.map((category, offset) => {
      // A **course** item takes its progress from Learning, and
      // `career_development_item_course_status_check` refuses Career recording a completion for one
      // (ADR-0073). Only the Career-owned kinds are ever moved on here — the constraint caught this
      // fixture writing a completed course, which is the rule working rather than an obstacle.
      const course = category === 'education';
      const completed = !course && (index + offset) % 4 === 0;

      return [
        uuidV7(),
        tenantId,
        plan.developmentPlanId,
        category,
        course ? 'course' : 'project',
        `item ${String(offset)}`,
        course ? uuidV7() : null,
        (index + offset) % 3 === 0 ? '2026-06-30' : '2027-06-30',
        completed ? 'completed' : 'planned',
        completed ? TODAY : null,
        completed ? 'user:benchmark' : null,
      ];
    }),
  );

  await insertAll(
    admin,
    'career_development_item',
    [
      'id',
      'tenant_id',
      'development_plan_id',
      'category',
      'kind',
      'title',
      'learning_assignment_id',
      'target_date',
      'status',
      'completed_on',
      'completed_by',
    ],
    rows,
  );
};

/** A twentieth of the workforce with a recommendation, most still proposed. */
export const seedRecommendations = async (admin, tenantId, people, positions) => {
  const rows = people
    .filter((_, index) => index % 20 === 0)
    .map((employmentId, index) => [
      uuidV7(),
      tenantId,
      employmentId,
      index % 5 === 0 ? 'promotion' : 'lateral_move',
      positions[index % positions.length],
      index % 4 === 0 ? 'accepted' : 'proposed',
      '2026-02-28',
      'user:benchmark',
      // Half already past their validity, so `standing` derives `expired` for a real share of them.
      index % 2 === 0 ? '2026-06-30' : '2027-06-30',
      index % 4 === 0 ? TODAY : null,
      index % 4 === 0 ? 'user:benchmark' : null,
    ]);

  await insertAll(
    admin,
    'career_mobility_recommendation',
    [
      'id',
      'tenant_id',
      'employment_id',
      'kind',
      'target_position_id',
      'status',
      'recommended_on',
      'recommended_by',
      'valid_until',
      'decided_on',
      'decided_by',
    ],
    rows,
  );
};
