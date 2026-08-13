/**
 * What a workforce has actually done: the requirements it carries, the courses it sat, the outcomes
 * assessors recorded and the certificates it holds.
 *
 * Split from `learning-benchmark-data.mjs` at the file-size budget. The division is a real one
 * rather than an arbitrary cut: next door is the **catalogue**, which is fixed at every tier because
 * a tenant's course list does not grow with its headcount. Everything here is written **per
 * employment**, and it is what the benchmark's queue reads actually scan.
 *
 * The order the functions run in is the order the domain requires — an assignment before the
 * enrolment that satisfies it, an enrolment before the certificate issued from it — because the
 * check constraints refuse any other, and satisfying them is the point rather than an obstacle.
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * The occurrence every mandatory assignment in this fixture belongs to. A civil date (ADR-0071).
 *
 * Exported because the rule's `effective_from` next door must be the same day: an occurrence key is
 * derived from the rule's own start and recurrence, so a fixture whose two halves disagreed would
 * write assignments belonging to an occurrence the rule never opens.
 */
export const OCCURRENCE = '2024-01-01';

/**
 * How many enrolments carry recorded assessment results.
 *
 * A bounded slice rather than all of them, for one reason: reading one enrolment's results is a
 * **per-enrolment** read whose cost does not depend on how many other enrolments have them. Seeding
 * a hundred thousand would add minutes to a benchmark to measure the same index lookup. The reads
 * that genuinely scale — the queues, the totals, reconciliation — run over the full population.
 */
export const DETAILED = 2_000;

/** The owner pool, supplied once by the catalogue module. Same reasoning as its own `admin`. */
let admin;

export const writeRecordsWith = (pool) => {
  admin = pool;
};

/**
 * One mandatory assignment each, plus a direct one for every fifth person.
 *
 * A fifth are given a due date already past, so the compliance queue has genuinely overdue rows to
 * find rather than being a filter that matches everything or nothing. Overdue is derived from this
 * date and the day somebody asks (ADR-0071) — no column holds it, here or anywhere.
 */
export const seedAssignments = async (tenantId, slice) => {
  const rows = [];
  const values = [];

  for (const person of slice) {
    const at = values.length;
    // A fifth already past due, the rest ahead of it. Selectivity a real queue has.
    const dueOn = person.ordinal % 5 === 0 ? '2026-01-15' : '2027-06-30';

    values.push(
      uuidV7(),
      tenantId,
      person.employmentId,
      person.rule.courseId,
      person.rule.mandatoryRuleId,
      dueOn,
    );
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, 'mandatory_rule', $${at + 5}, null, ` +
        `date '${OCCURRENCE}', 'assigned', $${at + 6}::date, now(), 'benchmark', ` +
        `null, null, null, null, null, null, null, null, '{}'::jsonb, ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into learning_assignment
       (id, tenant_id, employment_id, course_id, source, mandatory_rule_id, path_id,
        occurrence_key, status, due_on, assigned_at, assigned_by,
        satisfied_by_enrolment_id, satisfied_by_certification_id, satisfied_at,
        waived_at, waived_by, waiver_reason, cancelled_at, cancelled_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

/**
 * An enrolment for every second person, on the course their requirement names.
 *
 * The status mix is the one a training year actually has in August: a fifth finished, a tenth in
 * progress, a twentieth ended without finishing, the rest enrolled and not yet started. A
 * population that had all completed would measure a different index selectivity from the one a
 * compliance screen meets.
 *
 * Each enrolment pins the course's **current** version, which is what makes a completion still
 * describable after the course is revised.
 */
export const seedEnrolments = async (tenantId, slice) => {
  const created = [];
  const rows = [];
  const values = [];

  for (const person of slice.filter((each) => each.ordinal % 2 === 0)) {
    const enrolmentId = uuidV7();
    const at = values.length;
    const status = statusFor(person.ordinal);
    const completed = status === 'completed';
    // Every derived value is computed here rather than by a `case` over a placeholder. A parameter
    // used both as a column value and inside a comparison makes PostgreSQL deduce two types for it
    // — "inconsistent types deduced for parameter" — and refuse the statement outright.
    const completedAt = completed ? new Date() : null;

    created.push({ ...person, enrolmentId, completed });
    values.push(
      enrolmentId,
      tenantId,
      person.employmentId,
      person.rule.courseId,
      versionOf(person, status),
      status,
      status === 'enrolled' ? null : new Date(),
      completedAt,
      completed ? 'user:benchmark' : null,
      completed ? '2026-06-30' : null,
    );
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, null, $${at + 6}, ` +
        `now(), 'benchmark', $${at + 7}::timestamptz, $${at + 8}::timestamptz, ` +
        `$${at + 9}, $${at + 10}::date, null, '{}'::jsonb, ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into learning_enrolment
       (id, tenant_id, employment_id, course_id, course_version_id, assignment_id, status,
        enrolled_at, enrolled_by, started_at, completed_at, completed_by, completed_on,
        outcome_note, metadata, created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
  return created;
};

const statusFor = (ordinal) => {
  if (ordinal % 10 === 0) return 'completed';
  if (ordinal % 10 === 2) return 'completed';
  if (ordinal % 10 === 4) return 'in_progress';
  if (ordinal % 10 === 6) return 'withdrawn';
  return 'enrolled';
};

/**
 * Which version somebody sat.
 *
 * A completion from earlier in the year pins the previous version; a current enrolment pins the
 * current one. Both are real states, and a fixture where every enrolment pinned the newest version
 * would never show the case AD-004 exists for.
 */
const versionOf = (person, status) =>
  status === 'completed' && person.ordinal % 4 === 0
    ? person.course.versions[0]
    : person.course.current;

/**
 * A certificate for everybody who finished, valid a year from the day they finished.
 *
 * A tenth are given an earlier expiry so the expiring queue has rows to find. Validity itself is
 * **not** stored: `valid`, `expiring_soon` and `expired` are derived from this date and the day
 * somebody asks (ADR-0070), which is why there is no status column to seed for them.
 */
export const seedCertifications = async (tenantId, enrolments) => {
  const finished = enrolments.filter((each) => each.completed);
  const created = [];

  for (let from = 0; from < finished.length; from += 1_000) {
    const batch = finished.slice(from, from + 1_000);
    const rows = [];
    const values = [];

    for (const enrolment of batch) {
      const certificationId = uuidV7();
      const at = values.length;
      // A tenth lapse within the notice window a screen asks about; the rest a year out.
      const validUntil = enrolment.ordinal % 10 === 0 ? '2026-09-01' : '2027-06-30';

      created.push({ certificationId, ...enrolment });
      values.push(
        certificationId,
        tenantId,
        enrolment.employmentId,
        enrolment.enrolmentId,
        enrolment.rule.courseId,
        validUntil,
      );
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, 'Fire safety', ` +
          `'learning_completion', 'active', date '2026-06-30', $${at + 6}::date, ` +
          `null, null, null, null, null, 'user:benchmark', '{}'::jsonb, ${AUDIT})`,
      );
    }
    await admin.query(
      `insert into learning_certification
         (id, tenant_id, employment_id, enrolment_id, course_id, title, source, status,
          issued_on, valid_until, supersedes_certification_id, evidence_document_id,
          revoked_at, revoked_by, revocation_reason, issued_by, metadata,
          created_at, created_by, updated_at, updated_by, version)
       values ${rows.join(', ')}`,
      values,
    );
  }
  return created;
};

/**
 * One recorded outcome per enrolment, for the bounded slice.
 *
 * **The marks are exact strings and the fixture writes them as text.** `18.50` is stored as
 * `18.50`, and the benchmark reads it back to prove the repository returns the characters the
 * assessor typed rather than a float's rendering of them. Nothing in this module parses a mark.
 */
export const seedResults = async (tenantId, enrolments) => {
  const marks = ['18.50', '20.00', '999999999999.0000', '7.25'];

  for (let from = 0; from < enrolments.length; from += 500) {
    const batch = enrolments.slice(from, from + 500);
    const rows = [];
    const values = [];

    for (const [index, enrolment] of batch.entries()) {
      const at = values.length;
      const assessmentId = await assessmentFor(tenantId, enrolment);

      values.push(
        uuidV7(),
        tenantId,
        assessmentId,
        enrolment.enrolmentId,
        enrolment.employmentId,
        marks[(from + index) % marks.length],
      );
      rows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}, $${at + 5}, 'passed', ` +
          `$${at + 6}, 'out of 20', date '2026-06-30', 'user:benchmark', null, now(), ` +
          `'{}'::jsonb, ${AUDIT})`,
      );
    }
    await admin.query(
      `insert into learning_assessment_result
         (id, tenant_id, assessment_id, enrolment_id, employment_id, outcome, raw_mark,
          raw_mark_scale, assessed_on, assessed_by, notes, recorded_at, metadata,
          created_at, created_by, updated_at, updated_by, version)
       values ${rows.join(', ')}`,
      values,
    );
  }
};

/** The assessment belonging to the version this enrolment pinned. Cached: forty rows, not N. */
const assessments = new Map();

const assessmentFor = async (tenantId, enrolment) => {
  const key = `${tenantId}:${enrolment.course.current}`;
  const held = assessments.get(key);

  if (held !== undefined) return held;

  const { rows } = await admin.query(
    `select id from learning_assessment where tenant_id = $1 and course_version_id = $2 limit 1`,
    [tenantId, enrolment.course.current],
  );

  assessments.set(key, rows[0].id);
  return rows[0].id;
};

/**
 * Closing the requirements the completions actually satisfied.
 *
 * `learning_assignment_satisfaction_check` refuses a satisfied assignment with nothing behind it,
 * and that refusal is the point: closing a compliance obligation with no evidence is
 * indistinguishable from quietly dismissing it. So this runs last, naming the enrolment that
 * earned each closure.
 */
export const satisfyAssignments = async (tenantId, enrolments) => {
  const finished = enrolments.filter((each) => each.completed);

  for (let from = 0; from < finished.length; from += 1_000) {
    const batch = finished.slice(from, from + 1_000);

    await admin.query(
      `update learning_assignment as a
          set status = 'satisfied', satisfied_by_enrolment_id = e.enrolment_id,
              satisfied_at = now(), version = a.version + 1
         from (select unnest($2::uuid[]) as employment_id, unnest($3::uuid[]) as enrolment_id) as e
        where a.tenant_id = $1 and a.employment_id = e.employment_id and a.status = 'assigned'`,
      [tenantId, batch.map((each) => each.employmentId), batch.map((each) => each.enrolmentId)],
    );
  }
};
