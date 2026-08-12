/**
 * The per-review detail a benchmark fixture needs: assessments, the panel, the working, calibration
 * decisions, nine-box placements, feedback and progress history.
 *
 * Split from `measure-performance-seed.mjs` at the file-size budget. The division is a real one
 * rather than an arbitrary cut: everything here is written for a **bounded slice** of the population
 * rather than for all of it, because these are per-review reads whose cost does not depend on how
 * many other reviews carry the same rows. The cycle-wide tables — reviews and goals — are seeded in
 * full next door, because the reads over those genuinely do scale.
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/** The owner pool, supplied once by the seed module. Same reasoning as its own `admin`. */
let admin;

export const writeWith = (pool) => {
  admin = pool;
};

export const seedAssessments = async (tenantId, batch) => {
  const rows = [];
  const values = [];

  for (const { reviewId, employmentId, manager } of batch) {
    // Three assessments per review — self, peer, manager — because that is what a template
    // requiring both produces, and the detail read fetches all three.
    for (const [kind, assessor] of [
      ['self', employmentId],
      ['peer', manager],
      ['manager', manager],
    ]) {
      const at = values.length;

      values.push(uuidV7(), tenantId, reviewId, kind, assessor);
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, 'submitted', ` +
          `370, 400, 370, now(), 'user:benchmark', ${AUDIT})`,
      );
    }
  }
  await admin.query(
    `insert into performance_assessment
       (id, tenant_id, review_id, assessment_kind, assessor_employment_id, status,
        goal_score, competency_score, overall_score, submitted_at, submitted_by,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

export const seedPanel = async (tenantId, batch) => {
  const rows = [];
  const values = [];

  for (const { reviewId, manager } of batch) {
    const at = values.length;

    values.push(uuidV7(), tenantId, reviewId, manager);
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, 'peer', 'submitted', now(), now(), ` +
        `'user:benchmark', ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into performance_reviewer_assignment
       (id, tenant_id, review_id, reviewer_employment_id, role, status, requested_at, responded_at,
        requested_by, created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

export const seedWorking = async (tenantId, batch) => {
  const rows = [];
  const values = [];

  for (const { reviewId } of batch) {
    for (const [component, weight, score] of [
      ['goals', 6000, 350],
      ['competencies', 4000, 400],
    ]) {
      const at = values.length;

      values.push(uuidV7(), tenantId, reviewId, component, weight, score);
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}::int, true, $${at + 6}::int, ` +
          `$${at + 5}::int, $${at + 6}::int, '[]'::jsonb, now(), ${AUDIT})`,
      );
    }
  }
  await admin.query(
    `insert into performance_review_component_score
       (id, tenant_id, review_id, component, weight_basis_points, included, score,
        denominator_basis_points, contributed_score, excluded_items, calculated_at,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

/** Calibration decisions, nine-box placements, feedback and snapshots for the completed slice. */
export const seedOutcomes = async (tenantId, cycleId, sessionId, ratingLevelId, batch, offset) => {
  const decisions = [];
  const placements = [];
  const feedback = [];
  const decisionValues = [];
  const placementValues = [];
  const feedbackValues = [];

  for (const [index, { reviewId, employmentId, manager }] of batch.entries()) {
    const ordinal = offset + index;

    if (ordinal % 10 === 0) {
      const at = decisionValues.length;

      decisionValues.push(uuidV7(), tenantId, sessionId, reviewId, ratingLevelId);
      // A calibrated score without the level it lands in is a number nobody can read back, and the
      // column is not nullable for that reason.
      decisions.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, 400, 350, $${at + 5}::uuid, ` +
          `'Moderated', now(), 'user:benchmark', ${AUDIT})`,
      );

      const placedAt = placementValues.length;

      placementValues.push(uuidV7(), tenantId, cycleId, reviewId, employmentId);
      placements.push(
        `($${placedAt + 1}, $${placedAt + 2}, $${placedAt + 3}, $${placedAt + 4}, ` +
          `$${placedAt + 5}, 3, 2, '3-2', now(), 'user:benchmark', ${AUDIT})`,
      );
    }

    const feedbackAt = feedbackValues.length;

    feedbackValues.push(uuidV7(), tenantId, employmentId, manager);
    feedback.push(
      `($${feedbackAt + 1}, $${feedbackAt + 2}, $${feedbackAt + 3}, $${feedbackAt + 4}, ` +
        `'praise', 'manager', 'Carried the release', now(), ${AUDIT})`,
    );
  }

  if (decisions.length > 0) {
    await admin.query(
      `insert into performance_calibration_decision
         (id, tenant_id, calibration_session_id, review_id, original_score, calibrated_score,
          calibrated_rating_level_id, reason, decided_at, decided_by,
          created_at, created_by, updated_at, updated_by, version)
       values ${decisions.join(', ')}`,
      decisionValues,
    );
    await admin.query(
      `insert into performance_talent_placement
         (id, tenant_id, cycle_id, review_id, employment_id, performance_band, potential_band,
          box_code, placed_at, placed_by,
          created_at, created_by, updated_at, updated_by, version)
       values ${placements.join(', ')}`,
      placementValues,
    );
  }
  await admin.query(
    `insert into performance_feedback
       (id, tenant_id, subject_employment_id, author_employment_id, kind, visibility, body,
        given_at, created_at, created_by, updated_at, updated_by, version)
     values ${feedback.join(', ')}`,
    feedbackValues,
  );
};

/** Twelve progress entries per goal for a small slice: a year of monthly updates. */
export const seedProgress = async (tenantId, goals) => {
  const rows = [];
  const values = [];

  for (const { goalId } of goals) {
    for (let month = 1; month <= 12; month += 1) {
      const at = values.length;

      // The exact measurement, at the magnitude that breaks a double. It is stored as `bigint`, and
      // a benchmark that seeded a small number would never exercise the string path the driver uses.
      values.push(uuidV7(), tenantId, goalId, month * 800, '9007199254740993');
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}::int, $${at + 5}::bigint, ` +
          `now(), 'user:benchmark', ${AUDIT})`,
      );
    }
  }
  await admin.query(
    `insert into performance_goal_progress
       (id, tenant_id, goal_id, progress_basis_points, observed_value, recorded_at, recorded_by,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};
