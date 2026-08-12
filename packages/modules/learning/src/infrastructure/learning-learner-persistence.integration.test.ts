import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';
import {
  EMPLOYMENT,
  NOW,
  OTHER_EMPLOYMENT,
  TODAY,
  aCertification,
  aCourse,
  aCourseVersion,
  aResult,
  aRule,
  anAssessment,
  anEnrolment,
} from './learning-fixtures.js';

/**
 * The learner half of the repository contract: enrolments, results, certifications and rules.
 *
 * The two cases that matter most here are about **exactness**. Learning holds no `bigint`, no
 * `numeric` and no money column — every number is a small integer the schema constrains — so the
 * only value a tenant can type freely is an assessment's raw mark, and it is a `varchar` that leaves
 * exactly as it arrived. One case writes a mark beyond what a double can hold and reads it back
 * character for character; a mapper that had parsed it would return a different number from the one
 * the assessor wrote down.
 *
 * The other is the civil dates. Six of them pass through these tables and not one becomes a `Date`:
 * a due date read at the process's local midnight would report training overdue a day early on any
 * server west of UTC.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning learner-persistence suite');

suite('learning learner persistence', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_learner_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(
    work: (
      transaction: Parameters<Parameters<LearningFixture['inTenant']>[1]>[0],
    ) => Promise<TResult>,
  ): Promise<TResult> => fixture.inTenant(TENANT_A, work);

  describe('enrolments and results', () => {
    it('reads the latest completion per employment in one statement', async () => {
      const course = aCourse();
      const version = aCourseVersion(course.courseId);

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.versions.insert(transaction, version);

        for (const [employmentId, on] of [
          [EMPLOYMENT, '2024-06-01'],
          [EMPLOYMENT, '2025-06-01'],
          [OTHER_EMPLOYMENT, '2023-01-01'],
        ] as const) {
          await fixture.stores.enrolments.insertIfAbsent(
            transaction,
            anEnrolment(course.courseId, version.courseVersionId, {
              employmentId,
              status: 'completed',
              completedOn: on,
              completedBy: 'user:manager',
              completedAt: NOW,
            }),
          );
        }

        const latest = await fixture.stores.enrolments.lastCompletionsOf(
          transaction,
          [EMPLOYMENT, OTHER_EMPLOYMENT],
          course.courseId,
        );

        expect(latest.get(EMPLOYMENT)).toBe('2025-06-01');
        expect(latest.get(OTHER_EMPLOYMENT)).toBe('2023-01-01');
        // An empty list is answered without a query at all: a round trip to learn nothing.
        const nobody = await fixture.stores.enrolments.lastCompletionsOf(
          transaction,
          [],
          course.courseId,
        );

        expect(nobody.size).toBe(0);
      });
    });

    it('keeps a raw mark exactly as typed, beyond what a double can hold', async () => {
      const course = aCourse();
      const version = aCourseVersion(course.courseId);
      const assessment = anAssessment(version.courseVersionId);
      const enrolment = anEnrolment(course.courseId, version.courseVersionId);
      // 2^53 + 1. A mark that went through `Number` would come back as 9007199254740992.
      const beyondSafe = '9007199254740993';

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.versions.insert(transaction, version);
        await fixture.stores.assessments.insert(transaction, assessment);
        await fixture.stores.enrolments.insertIfAbsent(transaction, enrolment);
        await fixture.stores.results.insert(
          transaction,
          aResult(assessment.assessmentId, enrolment.enrolmentId, {
            rawMark: beyondSafe,
            rawMarkScale: 'out of 10000000000000000',
          }),
        );

        const [read] = await fixture.stores.results.forEnrolment(
          transaction,
          enrolment.enrolmentId,
        );

        expect(read?.rawMark).toBe(beyondSafe);
        expect(read?.assessedOn).toBe(TODAY);
      });
    });
  });

  describe('certifications', () => {
    it('round-trips both civil dates and derives nothing on the way', async () => {
      const certification = aCertification({ validUntil: '2029-01-15' });

      await inA(async (transaction) => {
        await fixture.stores.certifications.insertIfAbsent(transaction, certification);

        const read = await fixture.stores.certifications.byId(
          transaction,
          certification.certificationId,
        );

        expect(read).toEqual(certification);
        // No `expired` and no `validity` column came back, because neither exists (ADR-0070).
        expect(Object.keys(read ?? {})).not.toContain('validity');
      });
    });

    it('answers the expiring queue with active certificates only', async () => {
      await inA(async (transaction) => {
        await fixture.stores.certifications.insertIfAbsent(
          transaction,
          aCertification({ validUntil: '2026-09-01' }),
        );
        await fixture.stores.certifications.insertIfAbsent(
          transaction,
          aCertification({
            employmentId: OTHER_EMPLOYMENT,
            validUntil: '2026-09-01',
            status: 'revoked',
            revokedAt: NOW,
            revokedBy: 'user:test',
            revocationReason: 'Withdrawn',
          }),
        );

        const expiring = await fixture.stores.certifications.search(
          transaction,
          { validUntilOnOrBefore: '2026-10-01' },
          { limit: 10, offset: 0 },
        );

        // A revoked certificate is not "expiring soon" — it is gone, and counting it would inflate
        // every renewal report.
        expect(expiring.total).toBe(1);
        expect(expiring.items[0]?.employmentId).toBe(EMPLOYMENT);
      });
    });

    it('finds nothing for an enrolment that produced no certificate', async () => {
      await inA(async (transaction) => {
        expect(
          await fixture.stores.certifications.forEnrolment(transaction, uuidV7()),
        ).toBeUndefined();
      });
    });
  });

  describe('rules and instructors', () => {
    it('lists active rules only when asked, and pages the rest', async () => {
      const course = aCourse();

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.rules.insert(transaction, aRule(course.courseId));
        await fixture.stores.rules.insert(
          transaction,
          aRule(course.courseId, { active: false, retiredAt: NOW, retiredBy: 'user:test' }),
        );

        const all = await fixture.stores.rules.all(transaction, false, { limit: 10, offset: 0 });
        const active = await fixture.stores.rules.all(transaction, true, { limit: 10, offset: 0 });

        expect(all.total).toBe(2);
        expect(active.total).toBe(1);
        expect(active.items[0]?.effectiveFrom).toBe('2024-01-01');
      });
    });

    it('keeps an external instructor’s name here and no employment against it', async () => {
      await inA(async (transaction) => {
        const instructor = {
          instructorId: uuidV7(),
          externalName: { en: 'Visiting trainer', ar: 'مدرّب زائر' },
          externalOrganization: 'Gulf Safety Institute',
          active: true,
          version: 1,
        };

        await fixture.stores.instructors.insert(transaction, instructor);

        const read = await fixture.stores.instructors.byId(transaction, instructor.instructorId);

        expect(read?.employmentId).toBeUndefined();
        expect(read?.externalName).toEqual({ en: 'Visiting trainer', ar: 'مدرّب زائر' });
      });
    });
  });
});
