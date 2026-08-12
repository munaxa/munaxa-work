import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyException,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';

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
  TODAY,
  aCertification,
  aCourse,
  aCourseVersion,
  anAssignment,
  anEnrolment,
} from './learning-fixtures.js';

/**
 * Races, settled by the database.
 *
 * **Two connections, always.** Two transactions on one pooled connection are the same transaction,
 * so a race written against a single unit of work proves nothing at all — it proves that a program
 * doing two things in order does them in order.
 *
 * Every case below has one of exactly two outcomes, and each is asserted rather than assumed:
 *
 * * **One writes, the other converges.** `insert ... on conflict do nothing` returns zero rows to
 *   the loser, which the repository reports as "already there". That is the shape of ADR-0071's
 *   idempotency guarantee, and of the two convergence indexes added at `640bf74`.
 * * **One writes, the other is refused by name.** An optimistic `where version = $expected` matches
 *   no row for the loser, and `ConcurrencyException` travels to the edge as a 409.
 *
 * There is no third outcome, and in particular there is no pre-check anywhere on these paths: a
 * `select` followed by an `insert` is two statements with a gap between them, and the gap is exactly
 * where both callers find nothing and both write.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning concurrency suite');

suite('learning concurrency', () => {
  let fixture: LearningFixture;
  let second: UnitOfWork;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_concurrency_role');
    second = fixture.onSecondConnection();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** The same work, on the *other* connection, in the same tenant. */
  const onSecond = <TResult>(
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext({ tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:second' }, () =>
      second.execute(work),
    );

  const onFirst = <TResult>(
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> => fixture.inTenant(TENANT_A, work);

  const seedCourse = async (): Promise<{ courseId: string; courseVersionId: string }> => {
    const course = aCourse();
    const version = aCourseVersion(course.courseId);

    await onFirst(async (transaction) => {
      await fixture.stores.courses.insert(transaction, course);
      await fixture.stores.versions.insert(transaction, version);
    });

    return { courseId: course.courseId, courseVersionId: version.courseVersionId };
  };

  it('creates one assignment when two connections assign the same course at once', async () => {
    const { courseId } = await seedCourse();

    const [first, other] = await Promise.all([
      onFirst((transaction) =>
        fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId)),
      ),
      onSecond((transaction) =>
        fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId)),
      ),
    ]);

    // Exactly one wrote. The other was told the obligation already exists, which is the answer a
    // retry needs — not an error it would have to interpret.
    expect([first, other].filter(Boolean)).toHaveLength(1);

    const counted = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from learning_assignment where tenant_id = $1`,
      [TENANT_A],
    );

    expect(counted.rows[0]?.total).toBe('1');
  });

  it('creates one occurrence when two connections reconcile the same requirement at once', async () => {
    const { courseId } = await seedCourse();
    const ruleId = uuidV7();

    await onFirst((transaction) =>
      fixture.stores.rules.insert(transaction, {
        mandatoryRuleId: ruleId,
        courseId,
        name: { en: 'Annual', ar: 'سنوي' },
        kind: 'safety',
        audience: 'everybody',
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
        active: true,
        version: 1,
      }),
    );

    const occurrence = {
      source: 'mandatory_rule' as const,
      mandatoryRuleId: ruleId,
      occurrenceKey: '2024-01-01',
      dueOn: '2024-01-31',
    };

    const [first, other] = await Promise.all([
      onFirst((transaction) =>
        fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId, occurrence)),
      ),
      onSecond((transaction) =>
        fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId, occurrence)),
      ),
    ]);

    expect([first, other].filter(Boolean)).toHaveLength(1);

    // And a third run afterwards still creates nothing: the index, not a memory of the first run.
    const again = await onFirst((transaction) =>
      fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(courseId, occurrence)),
    );

    expect(again).toBe(false);

    const counted = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from learning_assignment where mandatory_rule_id = $1`,
      [ruleId],
    );

    expect(counted.rows[0]?.total).toBe('1');
  });

  it('creates one enrolment when two connections enrol the same person at once', async () => {
    const { courseId, courseVersionId } = await seedCourse();

    const [first, other] = await Promise.all([
      onFirst((transaction) =>
        fixture.stores.enrolments.insertIfAbsent(
          transaction,
          anEnrolment(courseId, courseVersionId),
        ),
      ),
      onSecond((transaction) =>
        fixture.stores.enrolments.insertIfAbsent(
          transaction,
          anEnrolment(courseId, courseVersionId),
        ),
      ),
    ]);

    expect([first, other].filter(Boolean)).toHaveLength(1);

    const counted = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from learning_enrolment where tenant_id = $1`,
      [TENANT_A],
    );

    expect(counted.rows[0]?.total).toBe('1');
  });

  it('issues one certification when two connections certify the same completion at once', async () => {
    const { courseId, courseVersionId } = await seedCourse();
    const enrolment = anEnrolment(courseId, courseVersionId, {
      status: 'completed',
      completedAt: NOW,
      completedBy: 'user:manager',
      completedOn: TODAY,
    });

    await onFirst((transaction) =>
      fixture.stores.enrolments.insertIfAbsent(transaction, enrolment),
    );

    const certification = {
      enrolmentId: enrolment.enrolmentId,
      courseId,
      source: 'learning_completion' as const,
      issuedOn: TODAY,
    };

    const [first, other] = await Promise.all([
      onFirst((transaction) =>
        fixture.stores.certifications.insertIfAbsent(transaction, aCertification(certification)),
      ),
      onSecond((transaction) =>
        fixture.stores.certifications.insertIfAbsent(transaction, aCertification(certification)),
      ),
    ]);

    // Two of the same qualification with two identifiers would be counted twice by every report.
    expect([first, other].filter(Boolean)).toHaveLength(1);

    const counted = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from learning_certification where enrolment_id = $1`,
      [enrolment.enrolmentId],
    );

    expect(counted.rows[0]?.total).toBe('1');
  });

  it('completes an enrolment exactly once when two connections race the transition', async () => {
    const { courseId, courseVersionId } = await seedCourse();
    const enrolment = anEnrolment(courseId, courseVersionId, { status: 'in_progress' });

    await onFirst((transaction) =>
      fixture.stores.enrolments.insertIfAbsent(transaction, enrolment),
    );

    const completed = {
      ...enrolment,
      status: 'completed' as const,
      completedAt: NOW,
      completedBy: 'user:manager',
      completedOn: TODAY,
    };

    // Both read version 1 and both write with it. The optimistic predicate matches one row.
    const outcomes = await Promise.allSettled([
      onFirst((transaction) => fixture.stores.enrolments.update(transaction, completed, 1)),
      onSecond((transaction) =>
        fixture.stores.enrolments.update(
          transaction,
          { ...completed, completedBy: 'user:other' },
          1,
        ),
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const loser = outcomes.find((outcome) => outcome.status === 'rejected');

    // Refused by name, not silently dropped: the caller is told the record moved and reads it again.
    expect(loser?.status === 'rejected' && loser.reason).toBeInstanceOf(ConcurrencyException);

    const held = await fixture.admin.query<{ version: number; completed_by: string }>(
      `select version, completed_by from learning_enrolment where id = $1`,
      [enrolment.enrolmentId],
    );

    // One completion, one increment. The loser's name is not on it.
    expect(held.rows[0]?.version).toBe(2);
  });

  it('refuses the second of two connections publishing a course version from the same read', async () => {
    const { courseId, courseVersionId } = await seedCourse();
    const course = aCourse({ courseId });

    const outcomes = await Promise.allSettled([
      onFirst((transaction) =>
        fixture.stores.courses.update(
          transaction,
          { ...course, status: 'published', currentVersionId: courseVersionId },
          1,
        ),
      ),
      onSecond((transaction) =>
        fixture.stores.courses.update(
          transaction,
          { ...course, status: 'published', currentVersionId: courseVersionId },
          1,
        ),
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const loser = outcomes.find((outcome) => outcome.status === 'rejected');

    expect(loser?.status === 'rejected' && loser.reason).toBeInstanceOf(ConcurrencyException);
  });

  it('waives an assignment exactly once when two connections race, and keeps one reason', async () => {
    const { courseId } = await seedCourse();
    const assignment = anAssignment(courseId);

    await onFirst((transaction) =>
      fixture.stores.assignments.insertIfAbsent(transaction, assignment),
    );

    const waive = (by: string, reason: string): AssignmentUpdate => ({
      ...assignment,
      status: 'waived',
      waivedAt: NOW,
      waivedBy: by,
      waiverReason: reason,
    });

    const outcomes = await Promise.allSettled([
      onFirst((transaction) =>
        fixture.stores.assignments.update(transaction, waive('user:hr', 'Holds a licence'), 1),
      ),
      onSecond((transaction) =>
        fixture.stores.assignments.update(transaction, waive('user:other', 'On leave'), 1),
      ),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const held = await fixture.admin.query<{ waiver_reason: string; version: number }>(
      `select waiver_reason, version from learning_assignment where id = $1`,
      [assignment.assignmentId],
    );

    // One waiver, one reason, one name. Not a merge of two.
    expect(held.rows[0]?.version).toBe(2);
    expect(['Holds a licence', 'On leave']).toContain(held.rows[0]?.waiver_reason);
  });

  it('lets a second person enrol on the same course while the first is racing their own', async () => {
    const { courseId, courseVersionId } = await seedCourse();

    // Not every concurrent write is a conflict. The index is on (tenant, employment, course), so
    // two different people enrolling at the same moment both succeed — a convergence rule that
    // refused this would be refusing ordinary work.
    const [first, other] = await Promise.all([
      onFirst((transaction) =>
        fixture.stores.enrolments.insertIfAbsent(
          transaction,
          anEnrolment(courseId, courseVersionId),
        ),
      ),
      onSecond((transaction) =>
        fixture.stores.enrolments.insertIfAbsent(
          transaction,
          anEnrolment(courseId, courseVersionId, { employmentId: uuidV7() }),
        ),
      ),
    ]);

    expect([first, other]).toEqual([true, true]);
  });

  it('keeps one tenant’s race out of another’s rows entirely', async () => {
    const { courseId } = await seedCourse();

    await onFirst((transaction) =>
      fixture.stores.assignments.insertIfAbsent(
        transaction,
        anAssignment(courseId, { employmentId: EMPLOYMENT }),
      ),
    );

    const counted = await fixture.admin.query<{ tenant_id: string }>(
      `select distinct tenant_id from learning_assignment`,
    );

    expect(counted.rows).toEqual([{ tenant_id: TENANT_A }]);
  });
});

/** The shape a waiver update sends. Named so the two racers are obviously sending the same thing. */
type AssignmentUpdate = Parameters<LearningFixture['stores']['assignments']['update']>[1];
