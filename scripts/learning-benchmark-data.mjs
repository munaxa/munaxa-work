/**
 * Seeding one tenant's whole learning position, for `measure-learning-performance.mjs`.
 *
 * Split from the measurements for the reason the file-size budget exists: what a benchmark *reads*
 * and how its fixture was *built* are two different concerns, and a reader checking whether the
 * compliance queue is measured honestly should not have to scroll past three hundred lines of
 * inserts to find it.
 *
 * Deliberately **not** through the command handlers: seeding a hundred thousand assignments through
 * the dispatcher would measure the seeding rather than the reads, and the reads are the point. The
 * rows written here are the rows the handlers write — same columns, same constraints, same triggers,
 * same check constraints. Anything the domain would have refused, PostgreSQL refuses here too, and
 * it did: `learning_assignment_satisfaction_check` rejected a satisfied assignment with no evidence
 * behind it until the seed supplied the enrolment that satisfied it, which is exactly the rule the
 * module exists to keep.
 *
 * **The proportions are the ones a real workforce has**, because selectivity is what a query plan
 * turns on. A population where everybody has completed everything measures a different index from
 * one where a fifth are overdue, and the second is the case a compliance screen is opened to see.
 *
 * **No impossible state is created to inflate a row count.** Every enrolment names a course version
 * that exists, every completion carries the day and the person who recorded it, every certificate
 * sourced from a completion names the enrolment it came from, and every mandatory assignment
 * carries the rule and the occurrence it belongs to.
 */

import { uuidV7 } from '../packages/kernel/dist/index.js';
import {
  DETAILED,
  OCCURRENCE,
  satisfyAssignments,
  seedAssignments,
  seedCertifications,
  seedEnrolments,
  seedResults,
  writeRecordsWith,
} from './learning-benchmark-records.mjs';

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

/**
 * The catalogue every tier shares.
 *
 * Fixed rather than scaled with the workforce, because a tenant's catalogue does not grow with its
 * headcount: a company of a hundred thousand runs the same forty courses as one of five hundred,
 * and the reads that scale are the ones over what people did with them.
 */
const COURSES = 40;
const VERSIONS_PER_COURSE = 2;
const PATHS = 5;
const STEPS_PER_PATH = 6;
const RULES = 8;
const INSTRUCTORS = 50;

/** The owner pool. The seed writes as the owner; the reads that follow pay the policy's cost. */
let admin;

export const seedTenant = async (pool, tenantId, employments) => {
  admin = pool;
  writeRecordsWith(pool);

  const categoryId = uuidV7();

  await admin.query(
    `insert into learning_course_category
       (id, tenant_id, code, name, metadata, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'safety', '{"en":"Safety","ar":"السلامة"}'::jsonb, '{}'::jsonb, ${AUDIT})`,
    [categoryId, tenantId],
  );

  const courses = await seedCatalogue(tenantId, categoryId);
  const paths = await seedPaths(tenantId, courses);
  const rules = await seedRules(tenantId, courses);

  await seedInstructors(tenantId);

  const population = await seedPopulation(tenantId, courses, rules, employments);

  return { categoryId, courses, paths, rules, ...population };
};

/**
 * The courses, their versions and one assessment each.
 *
 * Two versions per course with the second current: a course that has been revised is the ordinary
 * case, and it is the one that makes a completion still describable — an enrolment pins the version
 * somebody actually sat (AD-004), so a fixture with one version per course would never exercise
 * that.
 */
const seedCatalogue = async (tenantId, categoryId) => {
  const courses = [];
  const versionRows = [];
  const versionValues = [];
  const assessmentRows = [];
  const assessmentValues = [];

  for (let index = 0; index < COURSES; index += 1) {
    const courseId = uuidV7();
    const versions = [];

    for (let number = 1; number <= VERSIONS_PER_COURSE; number += 1) {
      const courseVersionId = uuidV7();
      const assessmentId = uuidV7();
      const at = versionValues.length;

      versions.push(courseVersionId);
      versionValues.push(courseVersionId, tenantId, courseId, number);
      versionRows.push(
        `($${at + 1}, $${at + 2}, $${at + 3}, $${at + 4}::int, ` +
          `'{"en":"Fire safety","ar":"السلامة"}'::jsonb, null, null, 480, true, 12, ` +
          `now(), 'benchmark', '{}'::jsonb, ${AUDIT})`,
      );

      const assessmentAt = assessmentValues.length;

      assessmentValues.push(assessmentId, tenantId, courseVersionId);
      assessmentRows.push(
        `($${assessmentAt + 1}, $${assessmentAt + 2}, $${assessmentAt + 3}, ` +
          `'{"en":"Practical check","ar":"الفحص"}'::jsonb, 'practical', true, ` +
          `'{}'::jsonb, ${AUDIT})`,
      );
    }
    courses.push({ courseId, versions, current: versions[versions.length - 1] });
  }

  await insertCourses(tenantId, categoryId, courses);
  await admin.query(
    `insert into learning_course_version
       (id, tenant_id, course_id, version_number, title, objectives, content_reference,
        duration_minutes, requires_assessment, certification_valid_months,
        published_at, published_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${versionRows.join(', ')}`,
    versionValues,
  );
  // The course points at its newest version only once that version exists: the foreign key and
  // `learning_course_published_check` both refuse the other order, and refusing it is correct — a
  // published course with no current version is one nobody can enrol into.
  for (const course of courses) {
    await admin.query(
      `update learning_course set current_version_id = $1 where id = $2 and tenant_id = $3`,
      [course.current, course.courseId, tenantId],
    );
  }
  // Published last, and only where a current version exists. `learning_course_published_check`
  // refuses any other order, and refusing it is correct: a published course with no current
  // version is one nobody can enrol into, and a requirement pointing at it would oblige people to
  // do something impossible.
  await admin.query(
    `update learning_course set status = 'published'
       where tenant_id = $1 and current_version_id is not null`,
    [tenantId],
  );
  await admin.query(
    `insert into learning_assessment
       (id, tenant_id, course_version_id, title, kind, required, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${assessmentRows.join(', ')}`,
    assessmentValues,
  );
  return courses;
};

const insertCourses = async (tenantId, categoryId, courses) => {
  const rows = [];
  const values = [];

  for (const [index, course] of courses.entries()) {
    const at = values.length;

    values.push(course.courseId, tenantId, `course-${index}`, categoryId);
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, '{"en":"Fire safety","ar":"السلامة"}'::jsonb, ` +
        `null, $${at + 4}, 'classroom', 'draft', null, null, null, '{}'::jsonb, ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into learning_course
       (id, tenant_id, code, name, description, category_id, delivery, status,
        current_version_id, archived_at, archived_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

/** Five published paths of six courses each. A position is an order, never a prerequisite. */
const seedPaths = async (tenantId, courses) => {
  const paths = [];
  const pathRows = [];
  const pathValues = [];
  const stepRows = [];
  const stepValues = [];

  for (let index = 0; index < PATHS; index += 1) {
    const pathId = uuidV7();
    const at = pathValues.length;

    paths.push(pathId);
    pathValues.push(pathId, tenantId, `path-${index}`);
    pathRows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, '{"en":"Induction","ar":"التعريف"}'::jsonb, ` +
        `null, 'role_based', 'published', null, null, '{}'::jsonb, ${AUDIT})`,
    );

    for (let step = 1; step <= STEPS_PER_PATH; step += 1) {
      const stepAt = stepValues.length;
      const course = courses[(index * STEPS_PER_PATH + step) % courses.length];

      stepValues.push(uuidV7(), tenantId, pathId, course.courseId, step);
      stepRows.push(
        `($${stepAt + 1}, $${stepAt + 2}, $${stepAt + 3}, $${stepAt + 4}, ` +
          `$${stepAt + 5}::smallint, false, '{}'::jsonb, ${AUDIT})`,
      );
    }
  }
  await admin.query(
    `insert into learning_path
       (id, tenant_id, code, name, description, kind, status, archived_at, archived_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${pathRows.join(', ')}`,
    pathValues,
  );
  await admin.query(
    `insert into learning_path_step
       (id, tenant_id, path_id, course_id, sequence, optional, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${stepRows.join(', ')}`,
    stepValues,
  );
  return paths;
};

/** Eight requirements over the catalogue, recurring annually, all still active. */
const seedRules = async (tenantId, courses) => {
  const rules = [];
  const rows = [];
  const values = [];

  for (let index = 0; index < RULES; index += 1) {
    const mandatoryRuleId = uuidV7();
    const at = values.length;

    rules.push({ mandatoryRuleId, courseId: courses[index].courseId });
    values.push(mandatoryRuleId, tenantId, courses[index].courseId);
    rows.push(
      `($${at + 1}, $${at + 2}, $${at + 3}, '{"en":"Annual safety","ar":"السلامة"}'::jsonb, ` +
        `'safety', 'everybody', null, null, date '${OCCURRENCE}', 12::smallint, 30::smallint, ` +
        `true, null, null, '{}'::jsonb, ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into learning_mandatory_rule
       (id, tenant_id, course_id, name, kind, audience, organization_unit_id, position_id,
        effective_from, recurrence_months, due_within_days, active, retired_at, retired_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
  return rules;
};

/** Fifty instructors: half colleagues, half from outside. Exactly one identity each. */
const seedInstructors = async (tenantId) => {
  const rows = [];
  const values = [];

  for (let index = 0; index < INSTRUCTORS; index += 1) {
    const at = values.length;
    const internal = index % 2 === 0;

    values.push(uuidV7(), tenantId, internal ? uuidV7() : null);
    rows.push(
      internal
        ? `($${at + 1}, $${at + 2}, $${at + 3}, null, null, null, true, '{}'::jsonb, ${AUDIT})`
        : `($${at + 1}, $${at + 2}, $${at + 3}, '{"en":"Academy","ar":"أكاديمية"}'::jsonb, ` +
            `'Civil Defence', 'training@example.org', true, '{}'::jsonb, ${AUDIT})`,
    );
  }
  await admin.query(
    `insert into learning_instructor
       (id, tenant_id, employment_id, external_name, external_organization, external_contact,
        active, metadata, created_at, created_by, updated_at, updated_by, version)
     values ${rows.join(', ')}`,
    values,
  );
};

/**
 * The workforce and what it has done: an assignment each, an enrolment for half, results for a
 * slice, and a certificate for everybody who finished.
 *
 * Written in batches of a thousand. The order is the order the domain requires — an assignment
 * before the enrolment that satisfies it, an enrolment before the certificate issued from it —
 * because the check constraints refuse any other, and satisfying them is the point rather than an
 * obstacle.
 */
const seedPopulation = async (tenantId, courses, rules, employments) => {
  const people = [];
  const enrolments = [];

  for (let written = 0; written < employments; written += 1_000) {
    const batch = Math.min(1_000, employments - written);
    const slice = [];

    for (let index = 0; index < batch; index += 1) {
      const ordinal = written + index;

      slice.push({
        employmentId: uuidV7(),
        ordinal,
        rule: rules[ordinal % rules.length],
        course: courses[ordinal % courses.length],
      });
    }
    people.push(...slice);
    await seedAssignments(tenantId, slice);
    enrolments.push(...(await seedEnrolments(tenantId, slice)));
  }

  const certifications = await seedCertifications(tenantId, enrolments);

  await seedResults(tenantId, enrolments.slice(0, DETAILED));
  await satisfyAssignments(tenantId, enrolments);
  return { people, enrolments, certifications };
};
