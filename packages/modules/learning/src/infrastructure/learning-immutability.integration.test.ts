import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  TENANT_A,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';

/**
 * The three shapes in this module that are records of things that happened, and the triggers that
 * refuse to let them change.
 *
 * A published course version, a recorded assessment result and an ended enrolment are all frozen at
 * the table, from **any** path — including SQL nobody wrote in TypeScript. The domain refuses each
 * one too; this is the guarantee that survives a script, a migration or a console.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning immutability suite');

const COURSE = '01930000-0000-7000-8000-00000000c001';
const VERSION = '01930000-0000-7000-8000-00000000e001';
const EMPLOYMENT = '01930000-0000-7000-8000-000000000e01';

suite('learning immutability', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const seedCourse = async (): Promise<void> => {
    await fixture.admin.query(
      `insert into learning_course
         (id, tenant_id, code, name, delivery, status, ${AUDIT_COLUMNS})
       values ($1, $2, 'fire-safety', '{"en":"Fire safety","ar":"السلامة"}'::jsonb,
               'classroom', 'draft', ${AUDIT_VALUES})`,
      [COURSE, TENANT_A],
    );
    await fixture.admin.query(
      `insert into learning_course_version
         (id, tenant_id, course_id, version_number, title, requires_assessment,
          published_at, published_by, ${AUDIT_COLUMNS})
       values ($1, $2, $3, 1, '{"en":"v1","ar":"v1"}'::jsonb, false, now(), 'user:test',
               ${AUDIT_VALUES})`,
      [VERSION, TENANT_A, COURSE],
    );
  };

  describe('what the triggers refuse', () => {
    const enrol = async (status = 'enrolled'): Promise<string> => {
      // The completion columns are computed here rather than in a `case` over a parameter: PostgreSQL
      // deduces one type per placeholder, and the same `$5` compared to a string and used as a
      // status is the "inconsistent types deduced" error this repository has already paid for once.
      const ended = status === 'completed';
      const created = await fixture.admin.query<{ id: string }>(
        `insert into learning_enrolment
           (id, tenant_id, employment_id, course_id, course_version_id, status, enrolled_at,
            enrolled_by, completed_by, completed_on, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, $4, $5, now(), 'user:test', $6, $7::date,
                 ${AUDIT_VALUES})
         returning id`,
        [
          TENANT_A,
          EMPLOYMENT,
          COURSE,
          VERSION,
          status,
          ended ? 'user:manager' : null,
          ended ? '2026-03-01' : null,
        ],
      );

      return created.rows[0]?.id ?? '';
    };

    it('refuses any edit of a published course version', async () => {
      await seedCourse();
      await expect(
        fixture.admin.query(
          `update learning_course_version set duration_minutes = 60 where id = $1`,
          [VERSION],
        ),
      ).rejects.toThrow(/learning_course_version_immutable/);
      await expect(
        fixture.admin.query('delete from learning_course_version where id = $1', [VERSION]),
      ).rejects.toThrow(/learning_course_version_immutable/);
    });

    it('refuses any edit of a recorded assessment result', async () => {
      await seedCourse();

      const enrolmentId = await enrol();
      const assessment = await fixture.admin.query<{ id: string }>(
        `insert into learning_assessment
           (id, tenant_id, course_version_id, title, kind, required, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, '{"en":"Quiz","ar":"اختبار"}'::jsonb, 'quiz', true,
                 ${AUDIT_VALUES})
         returning id`,
        [TENANT_A, VERSION],
      );
      const result = await fixture.admin.query<{ id: string }>(
        `insert into learning_assessment_result
           (id, tenant_id, assessment_id, enrolment_id, employment_id, outcome, assessed_on,
            assessed_by, recorded_at, ${AUDIT_COLUMNS})
         values (app_uuid_v7(), $1, $2, $3, $4, 'failed', date '2026-03-01', 'user:assessor',
                 now(), ${AUDIT_VALUES})
         returning id`,
        [TENANT_A, assessment.rows[0]?.id, enrolmentId, EMPLOYMENT],
      );

      await expect(
        fixture.admin.query(
          `update learning_assessment_result set outcome = 'passed' where id = $1`,
          [result.rows[0]?.id],
        ),
      ).rejects.toThrow(/learning_assessment_result_immutable/);
    });

    it('refuses an edit of a completed enrolment while permitting a soft delete', async () => {
      await seedCourse();

      const completed = await enrol('completed');

      await expect(
        fixture.admin.query(`update learning_enrolment set status = 'failed' where id = $1`, [
          completed,
        ]),
      ).rejects.toThrow(/learning_enrolment_immutable/);
      await expect(
        fixture.admin.query('delete from learning_enrolment where id = $1', [completed]),
      ).rejects.toThrow(/learning_enrolment_immutable/);

      const withdrawn = await fixture.admin.query(
        `update learning_enrolment
            set deleted_at = now(), deleted_by = 'user:test', updated_at = now(), version = 2
          where id = $1`,
        [completed],
      );

      expect(withdrawn.rowCount).toBe(1);
    });

    it('leaves an open enrolment editable, because it has not ended', async () => {
      await seedCourse();

      const open = await enrol();
      const started = await fixture.admin.query(
        `update learning_enrolment set status = 'in_progress', started_at = now(), version = 2
          where id = $1`,
        [open],
      );

      expect(started.rowCount).toBe(1);
    });

    it('refuses a second open enrolment for the same person on the same course', async () => {
      await seedCourse();
      await enrol();

      await expect(enrol()).rejects.toThrow(/learning_enrolment_open_idx/);
    });

    it('refuses a second certification issued from one completed enrolment', async () => {
      await seedCourse();

      const enrolmentId = await enrol('completed');
      const issue = (): Promise<unknown> =>
        fixture.admin.query(
          `insert into learning_certification
             (id, tenant_id, employment_id, enrolment_id, course_id, title, source, status,
              issued_on, issued_by, ${AUDIT_COLUMNS})
           values (app_uuid_v7(), $1, $2, $3, $4, 'Fire safety', 'learning_completion', 'active',
                   date '2026-08-12', 'user:test', ${AUDIT_VALUES})`,
          [TENANT_A, EMPLOYMENT, enrolmentId, COURSE],
        );

      await issue();
      // Two of the same qualification with two identifiers would be counted twice by every report.
      await expect(issue()).rejects.toThrow(/learning_certification_enrolment_idx/);
    });
  });
});
