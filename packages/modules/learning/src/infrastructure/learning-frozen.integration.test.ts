import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';
import {
  NOW,
  TODAY,
  aCourse,
  aCourseVersion,
  aResult,
  anAssessment,
  anEnrolment,
} from './learning-fixtures.js';

/**
 * What cannot change once it is written, proved through the repository *and* through raw SQL.
 *
 * Three shapes in this module are records of things that happened: a published course version, a
 * recorded assessment result, and an ended enrolment. The application layer refuses to change them
 * and the repositories offer no method that would — but an application-layer guarantee holds only
 * for callers who came through the application, and a migration, a console or a script does not.
 * So each case is exercised twice: once through the repository, and once as SQL nobody wrote in
 * TypeScript.
 *
 * **Every case is proved in both directions.** A trigger that refused everything would pass a suite
 * that only tested refusals, so each block also proves the operation that *is* permitted — a soft
 * delete of a row created in error, an open enrolment still moving through its lifecycle.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning frozen-records suite');

suite('learning frozen records', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_frozen_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const seed = async (): Promise<{ courseId: string; courseVersionId: string }> => {
    const course = aCourse();
    const version = aCourseVersion(course.courseId);

    await fixture.inTenant(TENANT_A, async (transaction) => {
      await fixture.stores.courses.insert(transaction, course);
      await fixture.stores.versions.insert(transaction, version);
    });

    return { courseId: course.courseId, courseVersionId: version.courseVersionId };
  };

  describe('a published course version', () => {
    it('refuses an update and a delete from raw SQL, as the unprivileged role', async () => {
      const { courseVersionId } = await seed();

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query(`update learning_course_version set duration_minutes = 60 where id = $1`, [
            courseVersionId,
          ]),
        ),
      ).rejects.toThrow(/learning_course_version_immutable/);

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query('delete from learning_course_version where id = $1', [courseVersionId]),
        ),
      ).rejects.toThrow(/learning_course_version_immutable/);
    });

    it('refuses even a soft delete, because a version is never withdrawn', async () => {
      const { courseVersionId } = await seed();

      // Unlike the other two, there is no permitted mutation at all here: AD-004 says historical
      // versions remain available, and a hidden one is not available.
      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query(
            `update learning_course_version set deleted_at = now(), deleted_by = 'u' where id = $1`,
            [courseVersionId],
          ),
        ),
      ).rejects.toThrow(/learning_course_version_immutable/);
    });

    it('still permits publishing the next version, which is how a course is corrected', async () => {
      const { courseId } = await seed();

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.versions.insert(
          transaction,
          aCourseVersion(courseId, { versionNumber: 2, title: { en: 'v2', ar: '٢' } }),
        );

        const versions = await fixture.stores.versions.forCourse(transaction, courseId);

        expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);
      });
    });
  });

  describe('a recorded assessment result', () => {
    const recordOne = async (): Promise<string> => {
      const { courseId, courseVersionId } = await seed();
      const assessment = anAssessment(courseVersionId);
      const enrolment = anEnrolment(courseId, courseVersionId);
      const result = aResult(assessment.assessmentId, enrolment.enrolmentId, { outcome: 'failed' });

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.assessments.insert(transaction, assessment);
        await fixture.stores.enrolments.insertIfAbsent(transaction, enrolment);
        await fixture.stores.results.insert(transaction, result);
      });

      return result.resultId;
    };

    it('refuses an update and a delete from raw SQL', async () => {
      const resultId = await recordOne();

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query(`update learning_assessment_result set outcome = 'passed' where id = $1`, [
            resultId,
          ]),
        ),
      ).rejects.toThrow(/learning_assessment_result_immutable/);

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query('delete from learning_assessment_result where id = $1', [resultId]),
        ),
      ).rejects.toThrow(/learning_assessment_result_immutable/);
    });

    it('still permits a later result, which is how a correction is made', async () => {
      const { courseId, courseVersionId } = await seed();
      const assessment = anAssessment(courseVersionId);
      const enrolment = anEnrolment(courseId, courseVersionId);

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.assessments.insert(transaction, assessment);
        await fixture.stores.enrolments.insertIfAbsent(transaction, enrolment);
        await fixture.stores.results.insert(
          transaction,
          aResult(assessment.assessmentId, enrolment.enrolmentId, {
            outcome: 'failed',
            assessedOn: '2026-08-01',
          }),
        );
        await fixture.stores.results.insert(
          transaction,
          aResult(assessment.assessmentId, enrolment.enrolmentId, {
            outcome: 'passed',
            assessedOn: TODAY,
          }),
        );

        const results = await fixture.stores.results.forEnrolment(
          transaction,
          enrolment.enrolmentId,
        );

        // Both are kept, latest first. Nothing was overwritten: the failure is still on the record.
        expect(results.map((result) => result.outcome)).toEqual(['passed', 'failed']);
      });
    });
  });

  describe('an ended enrolment', () => {
    const complete = async (): Promise<{ enrolmentId: string; courseId: string }> => {
      const { courseId, courseVersionId } = await seed();
      const enrolment = anEnrolment(courseId, courseVersionId, {
        status: 'completed',
        completedAt: NOW,
        completedBy: 'user:manager',
        completedOn: TODAY,
      });

      await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.enrolments.insertIfAbsent(transaction, enrolment),
      );

      return { enrolmentId: enrolment.enrolmentId, courseId };
    };

    it('refuses a status change through the repository', async () => {
      const { enrolmentId, courseId } = await complete();

      await expect(
        fixture.inTenant(TENANT_A, async (transaction) => {
          const held = await fixture.stores.enrolments.byId(transaction, enrolmentId);

          await fixture.stores.enrolments.update(
            transaction,
            {
              ...anEnrolment(courseId, held?.courseVersionId ?? ''),
              enrolmentId,
              status: 'failed',
            },
            1,
          );
        }),
      ).rejects.toThrow(/learning_enrolment_immutable/);
    });

    it('refuses an edit and a delete from raw SQL', async () => {
      const { enrolmentId } = await complete();

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query(
            `update learning_enrolment set completed_on = date '2020-01-01' where id = $1`,
            [enrolmentId],
          ),
        ),
      ).rejects.toThrow(/learning_enrolment_immutable/);

      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query('delete from learning_enrolment where id = $1', [enrolmentId]),
        ),
      ).rejects.toThrow(/learning_enrolment_immutable/);
    });

    it('permits a soft delete, so a row created in error can be withdrawn intact', async () => {
      const { enrolmentId } = await complete();

      const withdrawn = await fixture.asTenant(TENANT_A, (client) =>
        client.query(
          `update learning_enrolment
              set deleted_at = now(), deleted_by = 'user:test', updated_at = now(),
                  updated_by = 'user:test', version = version + 1
            where id = $1`,
          [enrolmentId],
        ),
      );

      expect(withdrawn.rowCount).toBe(1);

      // Withdrawn, not rewritten: every word of what it said is still in the row.
      const held = await fixture.admin.query<{ completed_on: string; status: string }>(
        `select to_char(completed_on, 'YYYY-MM-DD') as completed_on, status
           from learning_enrolment where id = $1`,
        [enrolmentId],
      );

      expect(held.rows[0]).toEqual({ completed_on: TODAY, status: 'completed' });
    });

    it('leaves an open enrolment fully editable, because it has not ended', async () => {
      const { courseId, courseVersionId } = await seed();
      const enrolment = anEnrolment(courseId, courseVersionId);

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.enrolments.insertIfAbsent(transaction, enrolment);
        await fixture.stores.enrolments.update(
          transaction,
          { ...enrolment, status: 'in_progress', startedAt: NOW },
          1,
        );

        const read = await fixture.stores.enrolments.byId(transaction, enrolment.enrolmentId);

        expect(read?.status).toBe('in_progress');
        expect(read?.version).toBe(2);
      });
    });
  });

  describe('the transaction boundary', () => {
    it('commits several repository writes together', async () => {
      const course = aCourse();
      const version = aCourseVersion(course.courseId);

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.versions.insert(transaction, version);
        await fixture.stores.courses.update(
          transaction,
          { ...course, status: 'published', currentVersionId: version.courseVersionId },
          1,
        );
      });

      const committed = await fixture.admin.query<{ status: string }>(
        `select status from learning_course where id = $1`,
        [course.courseId],
      );

      expect(committed.rows[0]?.status).toBe('published');
    });

    it('rolls back every write when one of them fails, leaving no partial state', async () => {
      const course = aCourse();
      const version = aCourseVersion(course.courseId);

      await expect(
        fixture.inTenant(TENANT_A, async (transaction) => {
          await fixture.stores.courses.insert(transaction, course);
          await fixture.stores.versions.insert(transaction, version);
          // A published course must name a current version. This one names none, so the check
          // constraint refuses it — and takes the two rows above with it.
          await fixture.stores.courses.update(transaction, { ...course, status: 'published' }, 1);
        }),
      ).rejects.toThrow(/learning_course_published_check/);

      const nothing = await fixture.admin.query(
        `select id from learning_course where id = $1
         union all select id from learning_course_version where id = $2`,
        [course.courseId, version.courseVersionId],
      );

      expect(nothing.rows).toHaveLength(0);
    });
  });
});
