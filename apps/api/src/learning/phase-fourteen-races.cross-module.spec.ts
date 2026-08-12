import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ReconciliationView } from '@work/learning';

import {
  CONNECTION,
  EMPLOYEE_ID,
  HR,
  TENANT,
  TODAY,
  UNIT_ID,
  harnessFor,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fourteen-harness.js';

/**
 * Races, run through the whole production stack on two real connections.
 *
 * The PostgreSQL checkpoint proved what the database guarantees. This proves the layers above it
 * preserve them: a command routed through the real handlers, the real repositories and the real
 * cross-module adapters still converges on one record rather than duplicating.
 *
 * **Two harnesses, two connection pools, one upstream world.** Two transactions on one pooled
 * connection are the same transaction, so a race written against a single harness proves only that a
 * program doing two things in order does them in order.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 14A race suite');

suite('Phase 14A — races across the production stack', () => {
  let harness: CrossModuleHarness;
  let second: CrossModuleHarness;

  beforeAll(() => {
    harness = harnessFor();
    second = harnessFor({ facts: harness.facts });
  });

  afterAll(async () => {
    await second.pool.end();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  const expectRowCount = async (table: string, total: number): Promise<void> => {
    const counted = await harness.pool.query<{ total: string }>(
      `select count(*)::text as total from ${table} where tenant_id = $1`,
      [TENANT],
    );

    expect([table, counted.rows[0]?.total]).toEqual([table, String(total)]);
  };

  const aPublishedCourse = (code: string): Promise<string> =>
    harness.inTenant(TENANT, HR, async () => {
      const { courseId } = await send<{ courseId: string }>(harness, {
        commandName: 'learning.create-course',
        code,
        name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
        delivery: 'classroom',
      });

      await send(harness, {
        commandName: 'learning.publish-course-version',
        courseId,
        expectedVersion: 1,
        title: { en: 'Fire safety v1', ar: 'السلامة ١' },
        requiresAssessment: false,
        certificationValidMonths: 12,
      });

      return courseId;
    });

  const aRule = (courseId: string): Promise<string> =>
    harness.inTenant(TENANT, HR, async () => {
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
        kind: 'safety',
        audience: 'organization_unit',
        organizationUnitId: UNIT_ID,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      return mandatoryRuleId;
    });

  describe('races across the production stack', () => {
    it('assigns once when two connections send the same command', async () => {
      const courseId = await aPublishedCourse('fire-safety');
      const command = {
        commandName: 'learning.assign',
        employmentId: EMPLOYEE_ID,
        courseId,
        dueOn: '2026-09-30',
      };

      const [mine, theirs] = await Promise.all([
        harness.inTenant(TENANT, HR, () =>
          send<{ assignmentId: string; created: boolean }>(harness, command),
        ),
        second.inTenant(TENANT, HR, () =>
          send<{ assignmentId: string; created: boolean }>(second, command),
        ),
      ]);

      expect([mine.created, theirs.created].filter(Boolean)).toHaveLength(1);
      expect(mine.assignmentId).toBe(theirs.assignmentId);
      await expectRowCount('learning_assignment', 1);
    });

    it('enrols once when two connections send the same command', async () => {
      const courseId = await aPublishedCourse('fire-safety');
      const command = { commandName: 'learning.enrol', employmentId: EMPLOYEE_ID, courseId };

      const outcomes = await Promise.all([
        harness.inTenant(TENANT, HR, () => send<{ created: boolean }>(harness, command)),
        second.inTenant(TENANT, HR, () => send<{ created: boolean }>(second, command)),
      ]);

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      await expectRowCount('learning_enrolment', 1);
    });

    it('completes once when two connections race the transition', async () => {
      const courseId = await aPublishedCourse('fire-safety');
      const { enrolmentId } = await harness.inTenant(TENANT, HR, () =>
        send<{ enrolmentId: string }>(harness, {
          commandName: 'learning.enrol',
          employmentId: EMPLOYEE_ID,
          courseId,
        }),
      );

      await harness.inTenant(TENANT, HR, () =>
        send(harness, {
          commandName: 'learning.start-enrolment',
          enrolmentId,
          expectedVersion: 1,
        }),
      );

      const complete = {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      };
      const outcomes = await Promise.allSettled([
        harness.inTenant(TENANT, HR, () => send(harness, complete)),
        second.inTenant(TENANT, HR, () => send(second, complete)),
      ]);

      // One completion. The loser is refused — by the optimistic version if it reached the update,
      // or by the transition table if it read the completed row first. Both are named refusals.
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

      const held = await harness.pool.query<{ version: number; status: string }>(
        `select version, status from learning_enrolment where id = $1`,
        [enrolmentId],
      );

      expect(held.rows[0]).toEqual({ version: 3, status: 'completed' });
    });

    it('issues one certification when two connections certify the same completion', async () => {
      const courseId = await aPublishedCourse('fire-safety');
      const { enrolmentId } = await harness.inTenant(TENANT, HR, async () => {
        const enrolled = await send<{ enrolmentId: string }>(harness, {
          commandName: 'learning.enrol',
          employmentId: EMPLOYEE_ID,
          courseId,
        });

        await send(harness, {
          commandName: 'learning.start-enrolment',
          enrolmentId: enrolled.enrolmentId,
          expectedVersion: 1,
        });
        await send(harness, {
          commandName: 'learning.complete-enrolment',
          enrolmentId: enrolled.enrolmentId,
          expectedVersion: 2,
          completedOn: TODAY,
        });
        return enrolled;
      });

      const issue = {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYEE_ID,
        enrolmentId,
        courseId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: TODAY,
      };

      const outcomes = await Promise.all([
        harness.inTenant(TENANT, HR, () => send<{ created: boolean }>(harness, issue)),
        second.inTenant(TENANT, HR, () => send<{ created: boolean }>(second, issue)),
      ]);

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      await expectRowCount('learning_certification', 1);
    });

    it('generates one occurrence when two connections reconcile the same requirement', async () => {
      const courseId = await aPublishedCourse('fire-safety');
      const mandatoryRuleId = await aRule(courseId);
      const command = { commandName: 'learning.reconcile-requirements', mandatoryRuleId };

      const [mine, theirs] = await Promise.all([
        harness.inTenant(TENANT, HR, () => send<ReconciliationView>(harness, command)),
        second.inTenant(TENANT, HR, () => send<ReconciliationView>(second, command)),
      ]);

      // Between them: three generated and three already present. Never six.
      expect(mine.generated + theirs.generated).toBe(3);
      expect(mine.alreadyPresent + theirs.alreadyPresent).toBe(3);
      await expectRowCount('learning_assignment', 3);

      // And a third run, afterwards, still creates nothing.
      const again = await harness.inTenant(TENANT, HR, () =>
        send<ReconciliationView>(harness, command),
      );

      expect(again).toMatchObject({ generated: 0, alreadyPresent: 3 });
    });
  });
});
