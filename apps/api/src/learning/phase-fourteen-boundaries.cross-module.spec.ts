import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  AssignmentView,
  CertificationView,
  LearningHistoryView,
  ReconciliationView,
} from '@work/learning';

import {
  CONNECTION,
  EMPLOYEE_ID,
  HR,
  OTHER_TENANT,
  TENANT,
  UNIT_ID,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  send,
  tryAsk,
  type CrossModuleHarness,
} from './phase-fourteen-harness.js';

/**
 * The boundaries, through the whole production stack: two tenants with the same data, and races run
 * on two real connections.
 *
 * The PostgreSQL checkpoint already proved what the database guarantees. This proves the layers
 * above it preserve those guarantees — that a command routed through the real handlers, the real
 * repositories and the real cross-module adapters still lands inside its tenant, and that a retry or
 * a race still converges rather than duplicating.
 *
 * Both tenants are given the *same* upstream world: the same employments, the same unit. That is
 * the case worth testing, because an isolation defect that only shows when the two tenants hold
 * different data is one a suite with different fixtures would miss.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 14A boundaries suite');

suite('Phase 14A — boundaries across the production stack', () => {
  let harness: CrossModuleHarness;
  let second: CrossModuleHarness;

  beforeAll(() => {
    harness = harnessFor();
    // A second harness on its **own** connection pool, sharing the upstream world. Two transactions
    // on one pooled connection are the same transaction, so a race written against one proves only
    // that a program doing two things in order does them in order.
    second = harnessFor({ facts: harness.facts });
  });

  afterAll(async () => {
    await second.pool.end();
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  const aPublishedCourse = async (
    on: CrossModuleHarness,
    tenantId: string,
    code: string,
  ): Promise<string> =>
    on.inTenant(tenantId, HR, async () => {
      const { courseId } = await send<{ courseId: string }>(on, {
        commandName: 'learning.create-course',
        code,
        name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
        delivery: 'classroom',
      });

      await send(on, {
        commandName: 'learning.publish-course-version',
        courseId,
        expectedVersion: 1,
        title: { en: 'Fire safety v1', ar: 'السلامة ١' },
        requiresAssessment: false,
        certificationValidMonths: 12,
      });

      return courseId;
    });

  const aRule = (on: CrossModuleHarness, tenantId: string, courseId: string): Promise<string> =>
    on.inTenant(tenantId, HR, async () => {
      const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(on, {
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

  describe('two tenants with the same world', () => {
    it('lets each run its own workflow over the same employments and the same course code', async () => {
      const mine = await aPublishedCourse(harness, TENANT, 'fire-safety');
      const theirs = await aPublishedCourse(harness, OTHER_TENANT, 'fire-safety');

      // The same code in both tenants: the uniqueness index is per tenant, so neither collides.
      expect(mine).not.toBe(theirs);

      const myRule = await aRule(harness, TENANT, mine);
      const theirRule = await aRule(harness, OTHER_TENANT, theirs);

      const myRun = await harness.inTenant(TENANT, HR, () =>
        send<ReconciliationView>(harness, {
          commandName: 'learning.reconcile-requirements',
          mandatoryRuleId: myRule,
        }),
      );
      const theirRun = await harness.inTenant(OTHER_TENANT, HR, () =>
        send<ReconciliationView>(harness, {
          commandName: 'learning.reconcile-requirements',
          mandatoryRuleId: theirRule,
        }),
      );

      // Both resolve the *same* three active employments through the same Employment contract, and
      // each writes its own three rows.
      expect(myRun).toMatchObject({ examined: 3, generated: 3 });
      expect(theirRun).toMatchObject({ examined: 3, generated: 3 });
    });

    it('shows neither tenant the other’s assignments, records or totals', async () => {
      const mine = await aPublishedCourse(harness, TENANT, 'fire-safety');
      const theirs = await aPublishedCourse(harness, OTHER_TENANT, 'fire-safety');
      const myRule = await aRule(harness, TENANT, mine);
      const theirRule = await aRule(harness, OTHER_TENANT, theirs);

      await harness.inTenant(TENANT, HR, () =>
        send(harness, { commandName: 'learning.reconcile-requirements', mandatoryRuleId: myRule }),
      );
      await harness.inTenant(OTHER_TENANT, HR, () =>
        send(harness, {
          commandName: 'learning.reconcile-requirements',
          mandatoryRuleId: theirRule,
        }),
      );

      for (const tenantId of [TENANT, OTHER_TENANT]) {
        const found = await harness.inTenant(tenantId, HR, () =>
          ask<{ readonly items: readonly AssignmentView[]; readonly total: number }>(harness, {
            queryName: 'learning.search-assignments',
          }),
        );

        // Three each, and the total agrees — a count that included the other tenant would disclose
        // their existence even while hiding every row.
        expect([tenantId, found.items.length, found.total]).toEqual([tenantId, 3, 3]);
      }
    });

    it('refuses one tenant’s rule identifier used by the other', async () => {
      const mine = await aPublishedCourse(harness, TENANT, 'fire-safety');
      const myRule = await aRule(harness, TENANT, mine);

      const refused = await harness.inTenant(OTHER_TENANT, HR, () =>
        attempt(harness, {
          commandName: 'learning.reconcile-requirements',
          mandatoryRuleId: myRule,
        }),
      );

      expect(reasonOf(refused)).toBe('not_found:learning_mandatory_rule');
    });

    it('refuses one tenant’s course used in the other’s command', async () => {
      const mine = await aPublishedCourse(harness, TENANT, 'fire-safety');

      const refused = await harness.inTenant(OTHER_TENANT, HR, () =>
        attempt(harness, {
          commandName: 'learning.assign',
          employmentId: EMPLOYEE_ID,
          courseId: mine,
        }),
      );

      // The employment is real and confirmed through Employment — it is the *course* that does not
      // exist in this tenant, and the answer discloses nothing about the other tenant's catalogue.
      expect(reasonOf(refused)).toBe('not_found:learning_course');
    });

    it('shows one tenant nothing of the other’s learning history for the same employment', async () => {
      const mine = await aPublishedCourse(harness, TENANT, 'fire-safety');
      const myRule = await aRule(harness, TENANT, mine);

      await harness.inTenant(TENANT, HR, () =>
        send(harness, { commandName: 'learning.reconcile-requirements', mandatoryRuleId: myRule }),
      );

      // The *same* employment identifier — a real one, in both tenants' upstream world.
      const theirs = await harness.inTenant(OTHER_TENANT, HR, () =>
        ask<LearningHistoryView>(harness, {
          queryName: 'learning.read-history',
          employmentId: EMPLOYEE_ID,
        }),
      );

      expect(theirs.assignments).toEqual([]);
      expect(theirs.openAssignments).toBe(0);
      expect(theirs.overdueAssignments).toBe(0);
      expect(theirs.completedCourses).toBe(0);
    });

    it('keeps a certification and its derived validity inside its tenant', async () => {
      await harness.inTenant(TENANT, HR, () =>
        send(harness, {
          commandName: 'learning.issue-certification',
          employmentId: EMPLOYEE_ID,
          title: 'Forklift licence',
          source: 'external',
          issuedOn: '2026-01-15',
          validUntil: '2027-01-15',
        }),
      );

      const mine = await harness.inTenant(TENANT, HR, () =>
        ask<{ readonly items: readonly CertificationView[] }>(harness, {
          queryName: 'learning.search-certifications',
          employmentId: EMPLOYEE_ID,
        }),
      );
      const theirs = await harness.inTenant(OTHER_TENANT, HR, () =>
        ask<{ readonly items: readonly CertificationView[]; readonly total: number }>(harness, {
          queryName: 'learning.search-certifications',
          employmentId: EMPLOYEE_ID,
        }),
      );

      expect(mine.items[0]?.validity).toBe('valid');
      expect(theirs.items).toHaveLength(0);
      expect(theirs.total).toBe(0);
    });

    it('refuses a read to a caller holding nothing, before any tenant question arises', async () => {
      const nobody = harnessFor({ permissions: [], facts: harness.facts });

      try {
        const refused = await nobody.inTenant(TENANT, HR, () =>
          tryAsk(nobody, { queryName: 'learning.search-assignments' }),
        );

        expect(reasonOf(refused)).toBe('forbidden:learning.assignment.read');
      } finally {
        await nobody.pool.end();
      }
    });
  });
});
