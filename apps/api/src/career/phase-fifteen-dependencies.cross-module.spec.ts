import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  EMPLOYEE_ID,
  OTHER_POSITION_ID,
  POSITION_ID,
  TENANT,
  UNIT_ID,
  applicationConnection,
  ask,
  attempt,
  careerRowsFor,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';

/**
 * What Career does when a module it depends on cannot answer.
 *
 * **The distinction this suite exists for**: "unavailable" and "absent" are different facts, and a
 * module that collapses them writes rows nobody can act on. A nomination accepted because Employment
 * was unreachable puts a name on a bench a succession review reads as covered. A succession plan
 * accepted because Organization was unreachable plans for a position that may not exist. A course
 * item accepted because Learning was unreachable references an assignment nobody was given.
 *
 * So every dependency gets four cases: the permitted one, the entity that is genuinely absent, the
 * entity that belongs to another tenant, and the module that cannot answer at all. And after each
 * failure, **the recovery** — because a module that refuses forever after one outage is its own
 * kind of defect, and because a refusal that left a partial write behind would only show up on the
 * retry.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 dependency suite');

const MISSING = '01900000-0000-7000-8000-00000000dead';

suite('phase 15 — dependencies that cannot answer', () => {
  let harness: CrossModuleHarness;

  beforeAll(async () => {
    // The unprivileged role: a superuser bypasses every row-level security policy, and a suite that
    // connected as one would report isolation it never gave the database a chance to enforce.
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  describe('Employment', () => {
    it('creates a plan for a real employment', async () => {
      const created = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(created)).toBe('accepted');
    });

    it('refuses a plan for an employment that does not exist', async () => {
      const refused = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: MISSING,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.employment-not-found');
      expect(await careerRowsFor(harness, MISSING)).toBe(0);
    });

    /**
     * Another tenant's employment is not this tenant's, even with the same identifier.
     *
     * The fixture gives both tenants an employment with **the same** `EMPLOYEE_ID` on purpose: if
     * this passed only because the identifiers differed, it would prove nothing about the boundary.
     */
    it('refuses a plan naming an employment that belongs to another tenant', async () => {
      // Remove it from this tenant only. The other tenant's row with the same identifier stays.
      harness.facts.employments = harness.facts.employments.filter(
        (held) => !(held.employmentId === EMPLOYEE_ID && held.tenantId === TENANT),
      );

      const refused = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.employment-not-found');
    });

    /**
     * **Unreachable is refused, not read as "nobody works here".**
     *
     * This is the assertion the whole suite turns on. `factsFor` returns `undefined` for a failed
     * read and for an absent employment alike, and the handler refuses on both — the difference
     * being that a *silent* empty answer would have let the plan through.
     */
    it('refuses while Employment cannot answer, and writes nothing', async () => {
      harness.facts.employmentReachable = false;

      const refused = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.employment-not-found');

      harness.facts.employmentReachable = true;
      expect(await careerRowsFor(harness, EMPLOYEE_ID)).toBe(0);
    });

    it('accepts the same command once Employment answers again', async () => {
      harness.facts.employmentReachable = false;

      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.create-plan',
            employmentId: EMPLOYEE_ID,
            startedOn: '2026-03-01',
          }),
        ),
      ).toBe('career.rejection.employment-not-found');

      harness.facts.employmentReachable = true;

      const recovered = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(recovered)).toBe('accepted');
      // One plan, not two: the refused attempt left nothing behind for this one to collide with.
      expect(await careerRowsFor(harness, EMPLOYEE_ID)).toBe(1);
    });
  });

  describe('Organization', () => {
    it('creates a succession plan for a real position', async () => {
      const created = await attempt(harness, {
        commandName: 'career.create-succession-plan',
        positionId: POSITION_ID,
      });

      expect(reasonOf(created)).toBe('accepted');
    });

    it('refuses a succession plan for a position that does not exist', async () => {
      const refused = await attempt(harness, {
        commandName: 'career.create-succession-plan',
        positionId: MISSING,
      });

      expect(reasonOf(refused)).toBe('career.rejection.position-not-found');
    });

    it('refuses a position that belongs to another tenant', async () => {
      harness.facts.positions = harness.facts.positions.filter(
        (held) => !(held.positionId === POSITION_ID && held.tenantId === TENANT),
      );

      const refused = await attempt(harness, {
        commandName: 'career.create-succession-plan',
        positionId: POSITION_ID,
      });

      expect(reasonOf(refused)).toBe('career.rejection.position-not-found');
    });

    /**
     * An empty page is "no such position", and an unreachable module is refused for the same
     * reason — but by a different route, and both matter.
     *
     * `positionExists` returns `false` for a failed read. A version that returned `true` on failure
     * "so the user is not blocked" would let a succession plan be written against nothing.
     */
    it('refuses while Organization cannot answer, and writes nothing', async () => {
      harness.facts.organizationReachable = false;

      const refused = await attempt(harness, {
        commandName: 'career.create-succession-plan',
        positionId: POSITION_ID,
      });

      expect(reasonOf(refused)).toBe('career.rejection.position-not-found');

      harness.facts.organizationReachable = true;

      const plans = await ask<{ readonly total: number }>(harness, {
        queryName: 'career.search-succession-plans',
      });

      expect(plans.total).toBe(0);
    });

    it('accepts the same command once Organization answers again', async () => {
      harness.facts.organizationReachable = false;
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.create-succession-plan',
            positionId: POSITION_ID,
          }),
        ),
      ).toBe('career.rejection.position-not-found');

      harness.facts.organizationReachable = true;
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.create-succession-plan',
            positionId: POSITION_ID,
          }),
        ),
      ).toBe('accepted');
    });

    /** The unit read is the same story, through a different published contract. */
    it('refuses a mobility recommendation naming an unknown unit, and accepts a known one', async () => {
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.recommend-move',
            employmentId: EMPLOYEE_ID,
            kind: 'lateral_move',
            targetUnitId: MISSING,
          }),
        ),
      ).toBe('career.rejection.unit-not-found');

      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'career.recommend-move',
            employmentId: EMPLOYEE_ID,
            kind: 'lateral_move',
            targetUnitId: UNIT_ID,
            targetPositionId: OTHER_POSITION_ID,
          }),
        ),
      ).toBe('accepted');
    });
  });
});
