/**
 * Seeding a whole annual cycle, for `measure-performance.mjs`.
 *
 * Split from the measurements for the reason the file-size budget exists: what a benchmark *reads*
 * and how its fixture was *built* are two different concerns, and a reader checking whether the
 * manager queue is measured honestly should not have to scroll past four hundred lines of inserts
 * to find it.
 *
 * Deliberately **not** through the command handlers: seeding a hundred thousand reviews through the
 * dispatcher would measure the seeding rather than the reads, and the reads are the point. The rows
 * written here are the rows the handlers write — same columns, same constraints, same triggers, same
 * check constraints. Anything the domain would have refused, PostgreSQL refuses here too, and it
 * did: a completed review with no rating level was rejected by
 * `performance_review_completed_score_check` until the seed supplied one.
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';
import {
  seedAssessments,
  seedOutcomes,
  seedPanel,
  seedProgress,
  seedWorking,
  writeWith,
} from './measure-performance-detail.mjs';

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * Seeds one tenant's whole annual cycle with multi-row inserts.
 *
 * Deliberately **not** through the command handlers: seeding a hundred thousand reviews through the
 * dispatcher would measure the seeding rather than the reads, and the reads are the point. The rows
 * it writes are the rows the handlers write — same columns, same constraints, same triggers, same
 * check constraints. Anything the domain would have refused, PostgreSQL refuses here too.
 */
/**
 * The pool every insert runs on, supplied by the caller.
 *
 * Held in a module variable rather than threaded through fifteen functions. The seed writes as the
 * **owner**, not as the unprivileged benchmark role: creating a fixture is not the operation under
 * measurement, and the reads that follow are the ones that must pay the policy's cost.
 */
let admin;

export const seedTenant = async (pool, tenantId, employments) => {
  admin = pool;
  writeWith(pool);

  const scaleId = uuidV7();
  const frameworkId = uuidV7();
  const templateId = uuidV7();
  const cycleId = uuidV7();

  await admin.query(
    `insert into performance_rating_scale
       (id, tenant_id, code, name, minimum_score, maximum_score, effective_from, active, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'annual', '{"en":"Annual","ar":"سنوي"}'::jsonb, 100, 500,
             date '2026-01-01', true, '{}'::jsonb, ${AUDIT})`,
    [scaleId, tenantId],
  );
  await admin.query(
    `insert into performance_rating_level
       (id, tenant_id, performance_rating_scale_id, code, name, ordinal,
        minimum_score, maximum_score,
        created_at, created_by, updated_at, updated_by, version)
     select gen_random_uuid(), $2, $1, 'level-' || n, '{"en":"Level","ar":"مستوى"}'::jsonb, n,
            100 * n, 100 * n + 99, ${AUDIT}
     from generate_series(1, 4) n`,
    [scaleId, tenantId],
  );
  await admin.query(
    `insert into performance_competency_framework
       (id, tenant_id, code, framework_version, name, weighted, effective_from, active, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'core', 1, '{"en":"Core","ar":"أساسي"}'::jsonb, false,
             date '2026-01-01', true, '{}'::jsonb, ${AUDIT})`,
    [frameworkId, tenantId],
  );

  const competencyIds = await seedCompetencies(tenantId, frameworkId);

  await admin.query(
    `insert into performance_review_template
       (id, tenant_id, code, name, rating_scale_id, competency_framework_id,
        requires_self_assessment, requires_peer_assessment, requires_calibration,
        goal_weight_total_basis_points, minimum_peer_responses, active, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'annual', '{"en":"Annual","ar":"سنوي"}'::jsonb, $3, $4,
             true, true, false, 10000, 3, true, '{}'::jsonb, ${AUDIT})`,
    [templateId, tenantId, scaleId, frameworkId],
  );
  await admin.query(
    `insert into performance_review_template_component
       (id, tenant_id, template_id, component, weight_basis_points,
        created_at, created_by, updated_at, updated_by, version)
     values (gen_random_uuid(), $2, $1, 'goals', 6000, ${AUDIT}),
            (gen_random_uuid(), $2, $1, 'competencies', 4000, ${AUDIT})`,
    [templateId, tenantId],
  );
  await admin.query(
    `insert into performance_cycle
       (id, tenant_id, code, name, review_template_id, kind, status, period_start, period_end,
        metadata, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'annual-2026', '{"en":"Annual","ar":"سنوي"}'::jsonb, $3, 'annual',
             'in_progress', date '2026-01-01', date '2026-12-31', '{}'::jsonb, ${AUDIT})`,
    [cycleId, tenantId, templateId],
  );

  const { rows: levels } = await admin.query(
    `select id from performance_rating_level
       where tenant_id = $1 and performance_rating_scale_id = $2 order by ordinal limit 1`,
    [tenantId, scaleId],
  );
  // A completed review must carry a rating level: a check constraint refuses one without, and
  // that refusal is the point — a completed review with no rating is a rating nobody can read
  // back. The seed satisfies the constraint rather than working around it.
  const seeded = await seedPopulation(tenantId, cycleId, scaleId, levels[0].id, employments);

  return { ...seeded, cycleId, scaleId, templateId, frameworkId, competencyIds };
};

const seedCompetencies = async (tenantId, frameworkId) => {
  const ids = [];

  for (let index = 1; index <= 8; index += 1) {
    const competencyId = uuidV7();

    ids.push(competencyId);
    await admin.query(
      `insert into performance_competency
         (id, tenant_id, framework_id, code, name, category, display_order, active,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, '{"en":"Competency","ar":"جدارة"}'::jsonb, 'core', $5, true,
               ${AUDIT})`,
      [competencyId, tenantId, frameworkId, `competency-${index}`, index],
    );
  }
  return ids;
};

/**
 * The population: one review per employment, under 200 managers, with goals, assessments, working,
 * a panel, feedback and — for the completed tenth — a snapshot.
 *
 * Written in batches of a thousand. The shapes are the shapes the handlers produce; the proportions
 * are the ones a real annual cycle has, which matters because a queue over a population that is
 * entirely completed measures a different index selectivity from one that is mostly in progress.
 */
const seedPopulation = async (tenantId, cycleId, scaleId, ratingLevelId, employments) => {
  const managers = [];
  const reviews = [];
  const goals = [];

  for (let index = 0; index < 200; index += 1) {
    managers.push(`01900000-0000-7000-8000-${String(index).padStart(12, '0')}`);
  }

  for (let written = 0; written < employments; written += 1_000) {
    const batch = Math.min(1_000, employments - written);
    const rows = [];
    const values = [];

    for (let index = 0; index < batch; index += 1) {
      const at = values.length;
      const ordinal = written + index;
      const reviewId = uuidV7();
      const employmentId = uuidV7();

      reviews.push({ reviewId, employmentId, manager: managers[ordinal % managers.length] });
      // A tenth completed, a tenth scored and awaiting calibration, the rest in progress: the
      // proportions an annual cycle actually has in November.
      const status =
        ordinal % 10 === 0
          ? 'completed'
          : ordinal % 10 === 1
            ? 'calibration'
            : 'manager_assessment';
      const score = ordinal % 10 <= 1 ? 300 + (ordinal % 200) : null;

      const completedAt = status === 'completed' ? new Date() : null;

      // Every derived value is computed here rather than by a `case` over a placeholder. A
      // parameter used both as a `varchar` column value and inside a comparison makes PostgreSQL
      // deduce two types for it — "inconsistent types deduced for parameter" — and refuse the
      // statement outright.
      values.push(
        reviewId,
        tenantId,
        cycleId,
        employmentId,
        managers[ordinal % managers.length],
        scaleId,
        status,
        score,
        completedAt,
        completedAt === null ? null : 'user:benchmark',
        score === null ? null : new Date(),
        score === null ? null : ratingLevelId,
      );
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, $${at + 6}, $${at + 7}, ` +
          `$${at + 8}::int, $${at + 12}::uuid, $${at + 8}::int, $${at + 12}::uuid, ` +
          `$${at + 9}::timestamptz, $${at + 10}, $${at + 11}::timestamptz, ` +
          `false, '{}'::jsonb, ${AUDIT})`,
      );
    }
    await admin.query(
      `insert into performance_review
         (id, tenant_id, cycle_id, employment_id, manager_employment_id, rating_scale_id, status,
          calculated_score, calculated_rating_level_id, final_score, final_rating_level_id,
          completed_at, completed_by, scored_at,
          calibrated, metadata, created_at, created_by, updated_at, updated_by, version)
       values ${rows.join(', ')}`,
      values,
    );
    await seedGoals(tenantId, cycleId, reviews.slice(written, written + batch), goals);
  }

  await seedReviewDetail(tenantId, cycleId, ratingLevelId, reviews, goals);
  return { reviews, goals, managers };
};

/** Three goals per employment, so a goal list is a page of a realistic set. */
const seedGoals = async (tenantId, cycleId, batch, collected) => {
  const rows = [];
  const values = [];

  for (const { employmentId } of batch) {
    for (let index = 0; index < 3; index += 1) {
      const goalId = uuidV7();
      const at = values.length;

      collected.push({ goalId, employmentId });
      values.push(goalId, tenantId, cycleId, employmentId);
      rows.push(
        `($${at + 1}, $${at + 2}, 'individual', $${at + 4}, $${at + 3}, 'A goal', 'percentage', ` +
          `3400, 'active', date '2026-01-01', date '2026-12-31', 4500, '{}'::jsonb, ${AUDIT})`,
      );
    }
  }
  await admin.query(
    `insert into performance_goal
       (id, tenant_id, scope, employment_id, cycle_id, title, measurement,
        weight_basis_points, status, start_date, due_date, progress_basis_points, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

/**
 * The detail a review carries: assessments, working, a panel, feedback, progress and snapshots.
 *
 * Written for a bounded slice rather than the whole population — 2,000 reviews at every tier — for
 * one reason: these are **per-review reads**, and the cost of reading one review's assessments does
 * not depend on how many other reviews have them. Seeding a hundred thousand of each would add half
 * an hour to a benchmark to measure the same index lookup. The cycle-wide reads that *do* scale —
 * the queue, the goal lists, the matrix, reconciliation — run over the full population.
 */
const DETAILED = 2_000;

const seedReviewDetail = async (tenantId, cycleId, ratingLevelId, reviews, goals) => {
  const slice = reviews.slice(0, Math.min(DETAILED, reviews.length));
  const sessionId = uuidV7();

  await admin.query(
    `insert into performance_calibration_session
       (id, tenant_id, cycle_id, code, name, status,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'engineering', '{"en":"Engineering","ar":"الهندسة"}'::jsonb,
             'in_session', ${AUDIT})`,
    [sessionId, tenantId, cycleId],
  );

  for (let from = 0; from < slice.length; from += 500) {
    const batch = slice.slice(from, from + 500);

    await seedAssessments(tenantId, batch);
    await seedPanel(tenantId, batch);
    await seedWorking(tenantId, batch);
    await seedOutcomes(tenantId, cycleId, sessionId, ratingLevelId, batch, from);
  }
  await seedProgress(tenantId, goals.slice(0, 200));
  return sessionId;
};
