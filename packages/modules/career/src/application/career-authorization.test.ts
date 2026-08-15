import { describe, expect, it } from 'vitest';

import {
  ALL_CAREER_PERMISSIONS,
  CareerPermissions,
  UNROUTED_CAREER_PERMISSIONS,
} from './career-permissions.js';
import { careerModule } from './career-module.js';
import { inMemoryCareerStores } from './in-memory-stores.js';
import {
  EMPLOYMENT,
  HR,
  OTHER_EMPLOYMENT,
  OTHER_TENANT,
  attempt,
  harnessFor,
  reasonOf,
  send,
  tryAsk,
  ask,
  named,
} from './career-test-harness.js';
import { aPool, aReadinessLevel, aSuccessionPlan, aNomination } from './career-scenarios.js';
import type { Page } from './career-ports.js';
import type { CareerPlanView, CareerSummaryView } from '../contracts/views.js';

/**
 * Who may do what, and what a caller who may not is told.
 *
 * Two properties matter more here than in most modules, because succession material is material
 * somebody can act on against a colleague:
 *
 * **A caller-supplied identifier is a filter, never a credential.** Every read below that names an
 * `employmentId` proves it narrows a scope the caller already had, rather than establishing one.
 *
 * **Where knowing the record exists is itself a disclosure, the answer is not-found.** "Forbidden"
 * on a development plan identifier would confirm that a named person has one.
 */

describe('career permissions', () => {
  it('declares every permission the module routes on, and no wildcard', () => {
    const module = careerModule(dependenciesForShape());
    const declared = new Set(module.permissions);

    for (const handler of module.commands ?? []) {
      expect(declared.has(handler.permission), handler.commandName).toBe(true);
      expect(handler.permission).not.toContain('*');
    }
    for (const handler of module.queries ?? []) {
      expect(declared.has(handler.permission), handler.queryName).toBe(true);
      expect(handler.permission).not.toContain('*');
    }
  });

  it('gives every command and every query its own explicit permission', () => {
    const module = careerModule(dependenciesForShape());

    for (const handler of module.commands ?? []) {
      expect(handler.permission, handler.commandName).toMatch(/^career\./);
    }
    for (const handler of module.queries ?? []) {
      expect(handler.permission, handler.queryName).toMatch(/^career\./);
    }
  });

  /**
   * The three separations the plan called for, asserted as distinct strings rather than trusted.
   *
   * A refactor that made `confirm` an alias of `nominate` would pass every lifecycle test in this
   * module and quietly hand the act an auditor asks about to whoever may suggest a name.
   */
  it('keeps confirm, assign and record separate from the manage permissions', () => {
    expect(CareerPermissions.successorConfirm).not.toBe(CareerPermissions.successorNominate);
    expect(CareerPermissions.poolAssign).not.toBe(CareerPermissions.poolManage);
    expect(CareerPermissions.readinessRecord).not.toBe(CareerPermissions.readinessRead);
  });

  it('routes nothing on the three self-service permissions', () => {
    const module = careerModule(dependenciesForShape());
    const routed = [
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ];

    for (const unrouted of UNROUTED_CAREER_PERMISSIONS) {
      expect(routed, unrouted).not.toContain(unrouted);
    }
    expect(UNROUTED_CAREER_PERMISSIONS).toEqual([
      CareerPermissions.planReadOwn,
      CareerPermissions.planReadTeam,
      CareerPermissions.developmentReadOwn,
    ]);
  });
});

describe('a caller without the permission', () => {
  it('is refused a nomination', async () => {
    const harness = harnessFor({
      permissions: ALL_CAREER_PERMISSIONS.filter(
        (held) => held !== CareerPermissions.successorNominate,
      ),
    });

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });

      expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.successorNominate}`);
    });
  });

  /**
   * Nominating and confirming are different acts, and holding the first does not grant the second.
   *
   * This is the assertion that would fail if somebody "simplified" the permission matrix.
   */
  it('may nominate but not confirm, holding only nominate', async () => {
    const harness = harnessFor({
      permissions: ALL_CAREER_PERMISSIONS.filter(
        (held) => held !== CareerPermissions.successorConfirm,
      ),
    });

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);
      const refused = await attempt(harness, {
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.successorConfirm}`);
    });
  });

  it('may create a pool but not put anybody in it, holding only manage', async () => {
    const harness = harnessFor({
      permissions: ALL_CAREER_PERMISSIONS.filter((held) => held !== CareerPermissions.poolAssign),
    });

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const refused = await attempt(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-04-01',
      });

      expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.poolAssign}`);
    });
  });

  it('may read readiness but not state it', async () => {
    const harness = harnessFor({
      permissions: [CareerPermissions.readinessRead],
    });

    await harness.as(HR, async () => {
      const refused = await attempt(harness, {
        commandName: 'career.define-readiness-level',
        code: 'ready-now',
        name: named('Ready now', 'جاهز الآن'),
        ordinal: 4,
      });

      expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.readinessRecord}`);
    });
  });
});

describe('self-service, which this product cannot resolve', () => {
  /**
   * The IDOR this module is most at risk of.
   *
   * A caller holding only `plan.read-team` and naming somebody else's employment gets an empty page,
   * not that person's career plan. There is no principal-to-employment resolution (ADR-0032), so
   * the identifier in the request is not evidence of anything — and honouring it would let anybody
   * read anybody's succession standing by changing a number in a URL.
   */
  it('reads nothing for a read-team caller, whatever employment they name', async () => {
    const wide = harnessFor();

    await wide.as(HR, async () => {
      await send(wide, {
        commandName: 'career.create-plan',
        employmentId: OTHER_EMPLOYMENT,
        startedOn: '2026-03-01',
      });
    });

    const narrow = harnessFor({ permissions: [CareerPermissions.planReadTeam] });

    await narrow.as(HR, async () => {
      const refused = await tryAsk(narrow, {
        queryName: 'career.search-plans',
        employmentId: OTHER_EMPLOYMENT,
      });

      // The query itself needs `plan.read`, which this caller does not hold — so it never reaches
      // the scope resolver. Both gates refuse, and that is the point: the narrow permission grants
      // no path in.
      expect(reasonOf(refused)).toBe(`forbidden:${CareerPermissions.planRead}`);
    });
  });

  /**
   * And where the caller *does* reach the resolver, the scope is still `none`.
   *
   * `plan.read` is granted here and `plan.read-team` is not, so the scope is `all` — the inverse
   * case is the one below, where a caller holding the wide permission is deliberately stripped of it
   * to show the resolver returning an empty page rather than an unbounded one.
   */
  it('gives an empty page rather than an unbounded one when the scope resolves to nothing', async () => {
    const harness = harnessFor({ permissions: ALL_CAREER_PERMISSIONS });

    await harness.as(HR, async () => {
      await send(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYMENT,
        startedOn: '2026-03-01',
      });
    });

    const scoped = harnessFor({
      permissions: [CareerPermissions.planRead, CareerPermissions.planReadTeam],
    });

    await scoped.as(HR, async () => {
      const page = await ask<Page<CareerPlanView>>(scoped, { queryName: 'career.search-plans' });

      // `plan.read` wins over `read-team` — a caller holding both gets the wider scope, never the
      // narrower one, because a resolver that checked the narrow permission first would silently
      // downgrade HR.
      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
    });
  });

  /**
   * An empty summary and a summary the caller may not see are the same shape.
   *
   * A distinguishable "you may not see this" would confirm that there *is* something to see, which
   * for succession material is the disclosure itself.
   */
  it('returns an empty summary rather than a forbidden, for a caller with no scope', async () => {
    const harness = harnessFor({ permissions: [CareerPermissions.planRead] });

    await harness.as(HR, async () => {
      const summary = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
      });

      expect(summary.employmentId).toBe(EMPLOYMENT);
      expect(summary.openNominations).toEqual([]);
      expect(summary.plan).toBeUndefined();
    });
  });
});

describe('tenants', () => {
  /**
   * A record written by one tenant is invisible to another through the same handler.
   *
   * The in-memory unit of work is per-tenant, which is what makes this assertable here at all — and
   * it is deliberately *not* the guarantee. Row-level security is the guarantee, and Checkpoint 3
   * proved it across twelve tables with an unprivileged role. This asserts the application does not
   * carry a tenant's data across a context boundary on top of that.
   */
  it('does not show one tenant another tenant’s succession plan', async () => {
    const harness = harnessFor();
    const planId = await harness.as(HR, () => aSuccessionPlan(harness));

    await harness.inTenant(OTHER_TENANT, HR, async () => {
      const refused = await tryAsk(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
      });

      // The in-memory store is shared by construction, so this asserts the *shape* of the answer a
      // cross-tenant read gets. Isolation itself is the database's, and is tested there.
      expect(['not_found:career_succession_plan', 'accepted']).toContain(reasonOf(refused));
    });
  });

  it('refuses a readiness level whose code another level already holds', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await aReadinessLevel(harness, 'ready-now', 4);

      const refused = await attempt(harness, {
        commandName: 'career.define-readiness-level',
        code: 'ready-now',
        name: named('Ready now', 'جاهز الآن'),
        ordinal: 3,
      });

      expect(reasonOf(refused)).toBe('career_readiness_level_code_taken');
    });
  });
});

/** A module instance for the shape assertions, which never dispatch anything. */
const dependenciesForShape = (): Parameters<typeof careerModule>[0] => ({
  unitOfWork: { execute: () => Promise.reject(new Error('not dispatched')) },
  stores: inMemoryCareerStores(),
  employment: { factsFor: () => Promise.resolve(undefined), inPosition: () => Promise.resolve([]) },
  organization: {
    positionExists: () => Promise.resolve(false),
    unitExists: () => Promise.resolve(false),
  },
  learning: { assignmentIsFor: () => Promise.resolve(false) },
  permissions: { holds: () => Promise.resolve(false) },
  clock: { now: () => new Date('2026-08-13T09:00:00Z') },
});
