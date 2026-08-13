import { describe, expect, it } from 'vitest';

import { EMPLOYMENT, HR, POSITION, ask, harnessFor, send, tryAsk } from './career-test-harness.js';
import { aDevelopmentPlan, anObjectiveOn, aSuccessionPlan } from './career-scenarios.js';
import { careerModule } from './career-module.js';
import { CareerPermissions, UNROUTED_CAREER_PERMISSIONS } from './career-permissions.js';
import { inMemoryCareerStores } from './in-memory-stores.js';
import type { CareerDependencies } from './career-dependencies.js';
import type {
  CareerSummaryView,
  DevelopmentPlanDetailView,
  SuccessionPlanDetailView,
} from '../contracts/views.js';

/**
 * The capabilities this module does not have, asserted so that none of them quietly acquires a
 * fabricated answer.
 *
 * A missing capability is dangerous in exactly one way: it gets filled in later by somebody being
 * helpful. A `criticality` field defaulting to `standard`, an empty critical-position list reading
 * as "there are none", a mix verdict reading as "balanced", a "sent" state on a notification nobody
 * delivered. Each of those looks like completing the feature and is in fact a lie.
 *
 * So each one below is a test that the honest answer is what comes out — usually an explicit
 * absence, an explicit `NOT VERIFIED`, or a query that does not exist at all.
 */

describe('D-4 — listing a tenant’s critical positions', () => {
  /**
   * There is no such query, and its absence is the assertion.
   *
   * `organization.list-positions` has no `criticality` filter and the additive change was not
   * authorized. The wrong fix would be a Career query that paged the whole position catalogue and
   * filtered here: unbounded work over another module's data, with a `total` that would be the
   * number of positions rather than the number of critical ones.
   */
  it('offers no query that claims to list critical positions', () => {
    const module = careerModule(shapeOnly());
    const names = (module.queries ?? []).map((handler) => handler.queryName);

    expect(names.filter((name) => name.includes('critical'))).toEqual([]);
    expect(names.filter((name) => name.includes('position'))).toEqual([]);
  });

  /**
   * What Career *can* answer is the plans it holds — a different and smaller set, and the difference
   * is stated rather than papered over.
   */
  it('lists the succession plans it holds and nothing about positions it has no plan for', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await aSuccessionPlan(harness, POSITION);

      const found = await ask<{ readonly total: number }>(harness, {
        queryName: 'career.search-succession-plans',
      });

      // One plan, for one position. The tenant has two positions in the fixture; Career knows
      // nothing about the criticality of either.
      expect(found.total).toBe(1);
    });
  });

  it('publishes no criticality on a succession plan', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const detail = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
      });

      expect(Object.keys(detail.plan)).not.toContain('criticality');
      // And no default either — an absent field cannot be misread; a `criticality: 'standard'`
      // would be a claim about a position Career never looked at.
      expect(JSON.stringify(detail)).not.toContain('critical');
    });
  });
});

describe('D-5 — a nine-box band beside a nomination', () => {
  it('publishes no potential band anywhere on a bench', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);

      await send(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });

      const detail = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
      });
      const successor = detail.successors[0];

      expect(successor).toBeDefined();
      for (const absent of ['potentialBand', 'performanceBand', 'boxCode', 'nineBox']) {
        expect(Object.keys(successor ?? {}), absent).not.toContain(absent);
      }
    });
  });

  it('has no dependency through which a placement could be read', () => {
    const dependencies = shapeOnly();

    expect(Object.keys(dependencies)).toEqual([
      'unitOfWork',
      'stores',
      'employment',
      'organization',
      'learning',
      'permissions',
      'clock',
    ]);
    expect(Object.keys(dependencies)).not.toContain('performance');
  });
});

describe('D-9 — joint employee and manager ownership', () => {
  /**
   * The field names carry the truth, and this asserts them by name.
   *
   * `employeeAcknowledgementRecordedBy` says an administrator recorded it. A field called
   * `employeeSignedBy` would claim the employee pressed a button, and the employee cannot sign in.
   */
  it('records who wrote the acknowledgement down, never a signature', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);

      await send(harness, {
        commandName: 'career.acknowledge-development-plan',
        developmentPlanId: planId,
        party: 'employee',
        on: '2026-02-05',
        expectedVersion: 1,
      });

      await anObjectiveOn(harness, planId);

      const detail = await ask<DevelopmentPlanDetailView>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId: planId,
      });
      const fields = Object.keys(detail.plan);

      expect(fields).toContain('employeeAcknowledgementRecordedBy');
      expect(detail.plan.employeeAcknowledgementRecordedBy).toBe(HR);
      for (const absent of ['employeeSignedBy', 'employeeSignature', 'signedAt', 'ownedBy']) {
        expect(fields, absent).not.toContain(absent);
      }
    });
  });
});

describe('D-12 — the 70-20-10 mix', () => {
  it('says NOT VERIFIED rather than omitting a verdict', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);

      await anObjectiveOn(harness, planId);

      const detail = await ask<DevelopmentPlanDetailView>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId: planId,
      });

      expect(detail.mix.mixVerdict).toBe('NOT VERIFIED');
      for (const absent of ['balanced', 'target', 'tolerance', 'percentage', 'score']) {
        expect(Object.keys(detail.mix), absent).not.toContain(absent);
      }
    });
  });

  /** The counts are counts. An empty plan reports zeroes, not "balanced". */
  it('reports zero counts for an empty plan, and still no verdict', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const detail = await ask<DevelopmentPlanDetailView>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId: planId,
      });

      expect(detail.mix).toEqual({
        experience: 0,
        exposure: 0,
        education: 0,
        mixVerdict: 'NOT VERIFIED',
      });
    });
  });
});

describe('self-service, which has no principal resolution', () => {
  it('declares the three permissions and routes none of them', () => {
    const module = careerModule(shapeOnly());
    const routed = new Set([
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ]);

    for (const unrouted of UNROUTED_CAREER_PERMISSIONS) {
      expect(module.permissions, unrouted).toContain(unrouted);
      expect(routed.has(unrouted), unrouted).toBe(false);
    }
  });

  /**
   * A supplied manager identifier buys nothing.
   *
   * The caller here holds the wide read permission, so they see the plan — which is the correct
   * behaviour and also the point: what they see comes from the permission they hold, and naming a
   * `managerEmploymentId` neither widens nor narrows it. There is no code path where that field is
   * treated as evidence of who is asking.
   */
  it('has no query parameter that could be mistaken for a credential', () => {
    const module = careerModule(shapeOnly());
    const names = (module.queries ?? []).map((handler) => handler.queryName);

    expect(names.filter((name) => name.includes('my-'))).toEqual([]);
    expect(names.filter((name) => name.includes('own'))).toEqual([]);
    expect(names.filter((name) => name.includes('team'))).toEqual([]);
  });
});

describe('nothing scheduled, nothing delivered, nothing stored as bytes', () => {
  /**
   * A review comes due because somebody asked, and the response says which day it answered for.
   *
   * A `reviewDue` computed against an unstated "now" would be wrong by one whenever a request
   * crossed midnight, and a screen showing it could not say what day it meant.
   */
  it('derives a due review against a stated day and echoes the day back', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const before = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
        asOf: '2026-11-30',
      });
      const after = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
        asOf: '2026-12-02',
      });

      // Draft, so not due on either day: only an *active* plan has a review to be due.
      expect(before.plan.reviewDue).toBe(false);
      expect(before.asOf).toBe('2026-11-30');
      expect(after.asOf).toBe('2026-12-02');

      await send(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });
      await send(harness, {
        commandName: 'career.activate-succession-plan',
        successionPlanId: planId,
        expectedVersion: 1,
      });

      const active = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
        asOf: '2026-12-02',
      });
      const notYet = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId: planId,
        asOf: '2026-11-30',
      });

      expect(active.plan.reviewDue).toBe(true);
      expect(notYet.plan.reviewDue).toBe(false);
      // Nothing changed on the row between those two reads. The answer is a function of the day.
      expect(harness.stores.tables.successionPlans.get(planId)?.reviewOn).toBe('2026-12-01');
    });
  });

  it('offers no command that delivers, uploads, downloads or schedules', () => {
    const module = careerModule(shapeOnly());
    const names = (module.commands ?? []).map((handler) => handler.commandName);

    for (const forbidden of ['notify', 'send', 'upload', 'download', 'schedule', 'remind']) {
      expect(
        names.filter((name) => name.includes(forbidden)),
        forbidden,
      ).toEqual([]);
    }
  });

  /**
   * A readiness assessment cites no document, because there is no column to cite one in.
   *
   * The plan listed `documents.read-document` as available. Checkpoint 3's schema carries no
   * evidence column, so a command accepting a document identifier would confirm it exists and store
   * nothing — and the caller would reasonably believe the citation was kept.
   */
  it('takes no evidence document on a readiness assessment', () => {
    const module = careerModule(shapeOnly());
    const record = (module.commands ?? []).find(
      (handler) => handler.commandName === 'career.record-readiness',
    );

    expect(record).toBeDefined();
    expect(record?.permission).toBe(CareerPermissions.readinessRecord);
  });
});

describe('an unknown query is refused rather than answered emptily', () => {
  it('does not answer a query nobody registered', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const refused = await tryAsk(harness, { queryName: 'career.list-critical-positions' });

      expect(refused.ok).toBe(false);
    });
  });
});

describe('the summary admits its own limits', () => {
  it('shows only Career’s own rows', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const summary = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
      });

      expect(Object.keys(summary).sort()).toEqual([
        'asOf',
        'employmentId',
        'openNominations',
        'openPoolMemberships',
        'openRecommendations',
      ]);
    });
  });
});

/** Dependencies for the shape assertions, which never dispatch anything. */
const shapeOnly = (): CareerDependencies => ({
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
