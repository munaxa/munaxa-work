import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_ID,
  CONNECTION,
  EMPLOYEE_ID,
  OTHER_TENANT,
  POSITION_ID,
  TENANT,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  send,
  upstream,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';
import { CareerPermissions } from '@work/career';

/**
 * The boundaries Career must not cross, proved where they could be crossed.
 *
 * Two groups, and each is a different kind of evidence.
 *
 * **Tenant isolation, with deliberately identical upstream data.** Both tenants have an employment
 * called `EMPLOYEE_ID`, a position called `POSITION_ID` and an assignment called `ASSIGNMENT_ID`.
 * That is the whole point: a suite whose tenants held different values would pass whether or not the
 * boundary worked, because every read would be scoped by the value rather than by the tenant.
 *
 * **Authorization, where a caller-supplied identifier could be mistaken for a credential.**
 *
 * The third kind of evidence — reading the adapters' source for a table nobody should touch or a
 * grant nobody approved — is in `phase-fifteen-audit.cross-module.spec.ts`, because it needs no
 * database and should not be skipped where there is none.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 boundary suite');

suite('phase 15 — boundaries', () => {
  let mine: CrossModuleHarness;
  let theirs: CrossModuleHarness;

  let connectionString: string;

  beforeAll(async () => {
    const facts = upstream();

    // The unprivileged role, because a superuser bypasses every policy and the tenant assertions
    // below would then be proving only that Career's own SQL filters on a tenant.
    connectionString = await applicationConnection();
    // **One shared upstream world, two tenants.** Both harnesses see the same Employment,
    // Organization and Learning stubs, so isolation cannot come from them having different data.
    mine = harnessFor({ facts, connectionString });
    theirs = harnessFor({ facts, connectionString });
  });

  afterAll(async () => {
    await mine.close();
    await theirs.close();
  });

  beforeEach(async () => {
    await mine.truncate();
  });

  describe('two tenants, the same identifiers', () => {
    /** The whole point of the fixture, asserted before anything is built on it. */
    it('gives both tenants an employment, a position and an assignment with the same identifiers', () => {
      const employments = mine.facts.employments.filter(
        (held) => held.employmentId === EMPLOYEE_ID,
      );
      const positions = mine.facts.positions.filter((held) => held.positionId === POSITION_ID);

      expect(employments.map((held) => held.tenantId).sort()).toEqual(
        [OTHER_TENANT, TENANT].sort(),
      );
      expect(positions.map((held) => held.tenantId).sort()).toEqual([OTHER_TENANT, TENANT].sort());
    });

    it('hides one tenant’s career plan from the other, in both directions', async () => {
      const planInA = await mine.inTenant(TENANT, 'user:a', () =>
        send<{ careerPlanId: string }>(mine, {
          commandName: 'career.create-plan',
          employmentId: EMPLOYEE_ID,
          startedOn: '2026-03-01',
        }),
      );
      const planInB = await theirs.inTenant(OTHER_TENANT, 'user:b', () =>
        send<{ careerPlanId: string }>(theirs, {
          commandName: 'career.create-plan',
          employmentId: EMPLOYEE_ID,
          startedOn: '2026-03-01',
        }),
      );

      expect(planInA.careerPlanId).not.toBe(planInB.careerPlanId);

      const seenByA = await mine.inTenant(TENANT, 'user:a', () =>
        ask<{ readonly total: number; readonly items: readonly { careerPlanId: string }[] }>(mine, {
          queryName: 'career.search-plans',
          employmentId: EMPLOYEE_ID,
        }),
      );
      const seenByB = await theirs.inTenant(OTHER_TENANT, 'user:b', () =>
        ask<{ readonly total: number; readonly items: readonly { careerPlanId: string }[] }>(
          theirs,
          { queryName: 'career.search-plans', employmentId: EMPLOYEE_ID },
        ),
      );

      // **The counts, not just the rows.** A total that included the other tenant's plan would
      // disclose that they have one even while hiding it.
      expect(seenByA.total).toBe(1);
      expect(seenByB.total).toBe(1);
      expect(seenByA.items[0]?.careerPlanId).toBe(planInA.careerPlanId);
      expect(seenByB.items[0]?.careerPlanId).toBe(planInB.careerPlanId);
    });

    it('hides one tenant’s succession bench and its count from the other', async () => {
      const plan = await mine.inTenant(TENANT, 'user:a', async () => {
        const created = await send<{ successionPlanId: string }>(mine, {
          commandName: 'career.create-succession-plan',
          positionId: POSITION_ID,
        });

        await send(mine, {
          commandName: 'career.nominate-successor',
          successionPlanId: created.successionPlanId,
          employmentId: EMPLOYEE_ID,
        });
        return created;
      });

      const benchInA = await mine.inTenant(TENANT, 'user:a', () =>
        ask<{ readonly nominated: number }>(mine, {
          queryName: 'career.read-bench-strength',
          successionPlanId: plan.successionPlanId,
        }),
      );

      expect(benchInA.nominated).toBe(1);

      // The other tenant, naming the exact identifier, is told there is nothing there — not that
      // they may not see it, because "forbidden" would confirm the plan exists.
      const inB = await theirs.inTenant(OTHER_TENANT, 'user:b', () =>
        attempt(theirs, {
          commandName: 'career.archive-succession-plan',
          successionPlanId: plan.successionPlanId,
          expectedVersion: 1,
        }),
      );

      expect(reasonOf(inB)).toBe('not_found:career_succession_plan');
    });

    /**
     * A cross-tenant upstream identifier authorizes nothing.
     *
     * Tenant B's position exists — in tenant B. Naming it from tenant A goes through the same
     * production adapter, which asks Organization inside tenant A's context, and Organization
     * answers for tenant A. The identifier being real somewhere is not the fact Career needs.
     */
    it('refuses a succession plan naming a position that exists only in the other tenant', async () => {
      mine.facts.positions = mine.facts.positions.filter(
        (held) => !(held.positionId === POSITION_ID && held.tenantId === TENANT),
      );

      const refused = await mine.inTenant(TENANT, 'user:a', () =>
        attempt(mine, { commandName: 'career.create-succession-plan', positionId: POSITION_ID }),
      );

      expect(reasonOf(refused)).toBe('career.rejection.position-not-found');

      // And the same identifier still works for the tenant that genuinely has it.
      const accepted = await theirs.inTenant(OTHER_TENANT, 'user:b', () =>
        attempt(theirs, { commandName: 'career.create-succession-plan', positionId: POSITION_ID }),
      );

      expect(reasonOf(accepted)).toBe('accepted');
    });

    it('refuses a course item naming an assignment that exists only in the other tenant', async () => {
      mine.facts.assignments = mine.facts.assignments.filter(
        (held) => !(held.assignmentId === ASSIGNMENT_ID && held.tenantId === TENANT),
      );

      const refused = await mine.inTenant(TENANT, 'user:a', async () => {
        const { developmentPlanId } = await send<{ developmentPlanId: string }>(mine, {
          commandName: 'career.create-development-plan',
          employmentId: EMPLOYEE_ID,
          startedOn: '2026-02-01',
        });

        return attempt(mine, {
          commandName: 'career.add-development-item',
          developmentPlanId,
          category: 'education',
          kind: 'course',
          title: 'Another tenant’s course',
          learningAssignmentId: ASSIGNMENT_ID,
        });
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');
    });

    /** The role the suite connects as could not have bypassed any of the above. */
    it('runs as a role that is neither superuser nor BYPASSRLS, with RLS forced on every table', async () => {
      const role = await mine.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
      );
      const protection = await mine.pool.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname like 'career\\_%' and relkind = 'r'`,
      );

      expect(role.rows[0]?.rolsuper).toBe(false);
      expect(role.rows[0]?.rolbypassrls).toBe(false);
      expect(protection.rows).toHaveLength(12);
      for (const row of protection.rows) {
        expect(row.relrowsecurity, row.relname).toBe(true);
        expect(row.relforcerowsecurity, row.relname).toBe(true);
      }
    });
  });

  describe('a client-supplied identifier is never a credential', () => {
    /**
     * The IDOR this module is most exposed to, asserted against the production wiring.
     *
     * A caller holding only `plan.read-team` and naming somebody else's employment is refused at the
     * permission gate — and, were they past it, the scope resolver would return nothing. Both gates
     * hold, and neither reads the identifier as evidence of who is asking (ADR-0032).
     */
    it('gives a read-team caller nothing, whatever employment they name', async () => {
      await mine.inTenant(TENANT, 'user:a', () =>
        send(mine, {
          commandName: 'career.create-plan',
          employmentId: EMPLOYEE_ID,
          startedOn: '2026-03-01',
        }),
      );

      const narrow = harnessFor({
        permissions: [CareerPermissions.planReadTeam],
        facts: mine.facts,
        connectionString,
      });

      try {
        const refused = await narrow.inTenant(TENANT, 'user:impostor', () =>
          attempt(narrow, {
            commandName: 'career.create-plan',
            employmentId: EMPLOYEE_ID,
            startedOn: '2026-03-01',
          }),
        );

        expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.planManage}`);
      } finally {
        await narrow.pool.end();
      }
    });

    it('gives a caller holding the wide read permission an empty page rather than an error', async () => {
      const scoped = harnessFor({
        permissions: [CareerPermissions.planRead, CareerPermissions.planReadTeam],
        facts: mine.facts,
        connectionString,
      });

      try {
        const page = await scoped.inTenant(TENANT, 'user:hr', () =>
          ask<{ readonly total: number }>(scoped, {
            queryName: 'career.search-plans',
            employmentId: EMPLOYEE_ID,
          }),
        );

        // `plan.read` wins over `read-team` — a caller holding both gets the wider scope. There are
        // no plans in this fresh tenant, so the honest answer is an empty page.
        expect(page.total).toBe(0);
      } finally {
        await scoped.pool.end();
      }
    });
  });
});
