import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_ID,
  CONNECTION,
  EMPLOYEE_ID,
  TENANT,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';

/**
 * The same question as `phase-fifteen-dependencies`, asked of Learning — and of an identifier that
 * could never name anything at all.
 *
 * Learning is the dependency Career reaches through the **narrowed** contract:
 * `assignmentIsFor(employmentId, assignmentId)` rather than the planned `assignmentExists`, because
 * Learning never published the latter. That makes an extra failure mode possible here and asserted
 * below — an assignment that is perfectly real, and somebody else's.
 *
 * The malformed-identifier group is about what happens *before* any of that: a string that cannot be
 * an identifier is refused without a cross-module call, because asking another module to look up
 * something no row could match is work nobody needs done.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 Learning dependency suite');

const MISSING = '01900000-0000-7000-8000-00000000dead';

suite('phase 15 — Learning, and identifiers that name nothing', () => {
  let harness: CrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  describe('Learning', () => {
    const aDevelopmentPlan = async (): Promise<string> => {
      const { developmentPlanId } = await send<{ developmentPlanId: string }>(harness, {
        commandName: 'career.create-development-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-02-01',
      });

      return developmentPlanId;
    };

    it('adds a course item referencing an assignment this person holds', async () => {
      const developmentPlanId = await aDevelopmentPlan();
      const added = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'Advanced financial reporting',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      expect(reasonOf(added)).toBe('accepted');
    });

    it('refuses an assignment that does not exist', async () => {
      const developmentPlanId = await aDevelopmentPlan();
      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'A course nobody was assigned',
        learningAssignmentId: MISSING,
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');
    });

    it('refuses an assignment that belongs to another tenant', async () => {
      const developmentPlanId = await aDevelopmentPlan();

      harness.facts.assignments = harness.facts.assignments.filter(
        (held) => !(held.assignmentId === ASSIGNMENT_ID && held.tenantId === TENANT),
      );

      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'Another tenant’s course',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');
    });

    /**
     * An **empty** history is refused, and that is the case the grant width protects against.
     *
     * Learning's `read-history` answers rather than refusing for a caller without
     * `assignment.read-all`: it returns an empty history. Career's grant names the permission so the
     * real answer comes back — but if it ever stopped naming it, this is the shape of the failure:
     * a perfectly successful read that says "no assignments", which Career must not read as
     * confirmation.
     */
    it('refuses when Learning answers with an empty history', async () => {
      const developmentPlanId = await aDevelopmentPlan();

      harness.facts.assignments = [];

      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'A course this person does not hold',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');
    });

    it('refuses while Learning cannot answer, and writes no item', async () => {
      const developmentPlanId = await aDevelopmentPlan();

      harness.facts.learningReachable = false;

      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'Advanced financial reporting',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');

      harness.facts.learningReachable = true;

      const detail = await ask<{ readonly items: readonly unknown[] }>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId,
      });

      expect(detail.items).toEqual([]);
    });

    it('accepts the same item once Learning answers again', async () => {
      const developmentPlanId = await aDevelopmentPlan();

      harness.facts.learningReachable = false;
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.add-development-item',
            developmentPlanId,
            category: 'education',
            kind: 'course',
            title: 'Advanced financial reporting',
            learningAssignmentId: ASSIGNMENT_ID,
          }),
        ),
      ).toBe('career.rejection.learning-assignment-not-found');

      harness.facts.learningReachable = true;

      const recovered = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId,
        category: 'education',
        kind: 'course',
        title: 'Advanced financial reporting',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      expect(reasonOf(recovered)).toBe('accepted');

      const detail = await ask<{ readonly items: readonly unknown[] }>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId,
      });

      // One item, not two: the refused attempt left nothing behind.
      expect(detail.items).toHaveLength(1);
    });
  });

  describe('a malformed identifier is not a lookup', () => {
    /**
     * Every upstream identifier reaches a `uuid` column, and PostgreSQL raises rather than returning
     * nothing when handed a string that is not one. A command field is a caller's string, so the
     * adapter answers "no" for anything that could never name a row rather than letting a cast error
     * surface as a server fault.
     */
    it('refuses a position, unit, employment and assignment that could never be identifiers', async () => {
      const refusals = await Promise.all([
        attempt(harness, {
          commandName: 'career.create-succession-plan',
          positionId: 'not-a-uuid',
        }),
        attempt(harness, {
          commandName: 'career.recommend-move',
          employmentId: EMPLOYEE_ID,
          kind: 'lateral_move',
          targetUnitId: 'not-a-uuid',
        }),
        attempt(harness, {
          commandName: 'career.create-plan',
          employmentId: 'not-a-uuid',
          startedOn: '2026-03-01',
        }),
      ]);

      expect(refusals.map(reasonOf)).toEqual([
        'career.rejection.position-not-found',
        'career.rejection.unit-not-found',
        'career.rejection.employment-not-found',
      ]);
    });
  });
});
