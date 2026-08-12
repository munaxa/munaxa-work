import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyException, uuidV7 } from '@work/kernel';

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
  aCourse,
  aCourseVersion,
  aPath,
  aPathStep,
  anAssignment,
} from './learning-fixtures.js';

/**
 * The repository contract, against a real PostgreSQL.
 *
 * Insert, read, update, list, page, filter, not-found, duplicate and optimistic concurrency — for
 * every store the application layer declares. The in-memory stores answer the same interface and
 * are useful for application behaviour, but they are **not evidence** for SQL types, indexes,
 * triggers or policies: only this suite is.
 *
 * Everything goes in through the repository and comes back out through it, so what is under test is
 * the round trip. A hand-written `insert` beside the mapper it was written with would agree with
 * itself and prove nothing.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning persistence suite');

suite('learning persistence', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_persistence_role');
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

  describe('the catalogue', () => {
    it('round-trips a course through insert, read by id and read by code', async () => {
      const course = aCourse({ description: { en: 'Annual', ar: 'سنوي' }, code: 'fire-safety' });

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);

        const byId = await fixture.stores.courses.byId(transaction, course.courseId);
        const byCode = await fixture.stores.courses.byCode(transaction, 'fire-safety');

        expect(byId).toEqual({ ...course, versionCount: 0 });
        expect(byCode?.courseId).toBe(course.courseId);
        expect(byId?.name).toEqual({ en: 'Fire safety', ar: 'السلامة من الحرائق' });
      });
    });

    it('answers nothing for an identifier that is not there', async () => {
      await inA(async (transaction) => {
        expect(await fixture.stores.courses.byId(transaction, uuidV7())).toBeUndefined();
        expect(await fixture.stores.courses.byCode(transaction, 'nothing')).toBeUndefined();
      });
    });

    it('counts a course’s versions from the versions themselves', async () => {
      const course = aCourse();

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.versions.insert(transaction, aCourseVersion(course.courseId));
        await fixture.stores.versions.insert(
          transaction,
          aCourseVersion(course.courseId, { versionNumber: 2 }),
        );

        const read = await fixture.stores.courses.byId(transaction, course.courseId);

        // Derived, not stored: a counter would need updating from the one place that publishes.
        expect(read?.versionCount).toBe(2);
        expect(
          await fixture.stores.versions.highestVersionNumber(transaction, course.courseId),
        ).toBe(2);
      });
    });

    it('filters and pages the catalogue, counting with the same predicate as the page', async () => {
      await inA(async (transaction) => {
        for (let index = 0; index < 5; index += 1) {
          await fixture.stores.courses.insert(
            transaction,
            aCourse({ code: `course-${String(index)}`, status: index < 3 ? 'draft' : 'archived' }),
          );
        }

        const drafts = await fixture.stores.courses.search(
          transaction,
          { status: 'draft' },
          { limit: 2, offset: 0 },
        );

        expect(drafts.items).toHaveLength(2);
        // The total is what was matched, not what was returned — a screen showing "1 of 40" for
        // forty rows is the bug this guards.
        expect(drafts.total).toBe(3);
      });
    });

    it('refuses a stale course update with the version it actually holds', async () => {
      const course = aCourse();

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.courses.update(transaction, { ...course, status: 'archived' }, 1);

        await expect(
          fixture.stores.courses.update(transaction, { ...course, status: 'draft' }, 1),
        ).rejects.toThrow(ConcurrencyException);
      });
    });

    it('keeps a course version’s exact configuration across the round trip', async () => {
      const course = aCourse();
      const version = aCourseVersion(course.courseId, {
        durationMinutes: 480,
        certificationValidMonths: 24,
        contentReference: 'opaque-key',
        objectives: { en: 'Objectives', ar: 'الأهداف' },
      });

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.versions.insert(transaction, version);

        expect(await fixture.stores.versions.byId(transaction, version.courseVersionId)).toEqual(
          version,
        );
      });
    });

    it('offers no update, no soft delete and no restore on a course version', () => {
      // AD-004 in the type system: a version repository that extended the shared base would inherit
      // `updateRow`, `softDeleteRow` and `restoreRow`, so it deliberately does not extend it. A
      // trigger refuses the same operations from any other path, which the immutability suite
      // proves against real SQL.
      const reachable = new Set([
        ...Object.getOwnPropertyNames(Object.getPrototypeOf(fixture.stores.versions)),
      ]);

      expect([...reachable].sort()).toEqual([
        'byId',
        'constructor',
        'forCourse',
        'highestVersionNumber',
        'insert',
      ]);
    });
  });

  describe('paths', () => {
    it('inserts steps, reads them in order, and frees the position when one is removed', async () => {
      const course = aCourse();
      const other = aCourse({ code: 'manual-handling' });
      const path = aPath();
      const step = aPathStep(path.pathId, course.courseId, { sequence: 1 });

      await inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.courses.insert(transaction, other);
        await fixture.stores.paths.insert(transaction, path);
        await fixture.stores.paths.insertStep(transaction, step);
        await fixture.stores.paths.insertStep(
          transaction,
          aPathStep(path.pathId, other.courseId, { sequence: 2 }),
        );

        expect(await fixture.stores.paths.stepsFor(transaction, path.pathId)).toHaveLength(2);
        expect((await fixture.stores.paths.byId(transaction, path.pathId))?.stepCount).toBe(2);

        await fixture.stores.paths.removeStep(transaction, step.stepId, NOW, 'user:test');

        // Soft-deleted: the partial unique index excludes it, so position 1 is free again.
        expect(await fixture.stores.paths.stepsFor(transaction, path.pathId)).toHaveLength(1);
        await fixture.stores.paths.insertStep(
          transaction,
          aPathStep(path.pathId, course.courseId, { sequence: 1 }),
        );
      });
    });
  });

  describe('assignments', () => {
    const seed = async (): Promise<string> => {
      const course = aCourse({ status: 'published' });

      return inA(async (transaction) => {
        await fixture.stores.courses.insert(transaction, {
          ...course,
          status: 'draft',
        });
        await fixture.stores.versions.insert(transaction, aCourseVersion(course.courseId));
        return course.courseId;
      });
    };

    it('writes once and converges on the second attempt', async () => {
      const courseId = await seed();
      const assignment = anAssignment(courseId, { dueOn: '2026-09-30' });

      await inA(async (transaction) => {
        expect(await fixture.stores.assignments.insertIfAbsent(transaction, assignment)).toBe(true);
        // A different identifier, the same obligation: the open-assignment index refuses it.
        expect(
          await fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId)),
        ).toBe(false);

        const open = await fixture.stores.assignments.openFor(transaction, EMPLOYMENT, courseId);

        expect(open?.assignmentId).toBe(assignment.assignmentId);
        expect(open?.dueOn).toBe('2026-09-30');
      });
    });

    it('reads a due-date queue with a civil date, not a timestamp', async () => {
      const courseId = await seed();

      await inA(async (transaction) => {
        await fixture.stores.assignments.insertIfAbsent(
          transaction,
          anAssignment(courseId, { dueOn: '2026-09-30' }),
        );
        await fixture.stores.assignments.insertIfAbsent(
          transaction,
          anAssignment(courseId, { employmentId: OTHER_EMPLOYMENT, dueOn: '2027-01-01' }),
        );

        const due = await fixture.stores.assignments.search(
          transaction,
          { dueOnOrBefore: '2026-12-31' },
          { limit: 10, offset: 0 },
        );

        expect(due.total).toBe(1);
        // The string that went in is the string that comes out. No timezone touched it.
        expect(due.items[0]?.dueOn).toBe('2026-09-30');
      });
    });

    it('applies an authorization bound as SQL, and an empty bound shows nothing', async () => {
      const courseId = await seed();

      await inA(async (transaction) => {
        await fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId));
        await fixture.stores.assignments.insertIfAbsent(
          transaction,
          anAssignment(courseId, { employmentId: OTHER_EMPLOYMENT }),
        );

        const mine = await fixture.stores.assignments.search(
          transaction,
          { employmentIdsIn: [EMPLOYMENT] },
          { limit: 10, offset: 0 },
        );
        const none = await fixture.stores.assignments.search(
          transaction,
          { employmentIdsIn: [] },
          { limit: 10, offset: 0 },
        );

        expect(mine.total).toBe(1);
        // An empty bound means "may see nothing" — the count agrees, so nothing leaks through it.
        expect(none.items).toHaveLength(0);
        expect(none.total).toBe(0);
      });
    });
  });
});
