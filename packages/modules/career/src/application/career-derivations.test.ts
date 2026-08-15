import { describe, expect, it } from 'vitest';

import { EMPLOYMENT, HR, ask, attempt, harnessFor, reasonOf } from './career-test-harness.js';
import {
  aCourseItemOn,
  aDevelopmentPlan,
  anObjectiveOn,
  aRecommendation,
} from './career-scenarios.js';
import { applicationSources, withoutComments } from './career-shape.js';
import type { CareerSummaryView, DevelopmentPlanDetailView } from '../contracts/views.js';

/**
 * What this module refuses to become.
 *
 * Every assertion here is a *negative*, and each one guards a boundary that a reasonable, helpful
 * change would cross. They are written against the application layer rather than the domain because
 * this is the layer where a handler could reach a port, and a port is where a read becomes a write.
 */

describe('the 70-20-10 mix, which nobody specified', () => {
  /**
   * The verdict is an explicit constant rather than an omitted field.
   *
   * A response carrying counts and no verdict reads as "balanced" to a screen that forgot to check,
   * and the whole point of D-12 is that this product does not know what balanced means.
   */
  it('returns counts and an explicit NOT VERIFIED', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);

      await anObjectiveOn(harness, planId);
      await aCourseItemOn(harness, planId);

      const detail = await ask<DevelopmentPlanDetailView>(harness, {
        queryName: 'career.read-development-plan',
        developmentPlanId: planId,
      });

      expect(detail.mix).toEqual({
        experience: 1,
        exposure: 0,
        education: 1,
        mixVerdict: 'NOT VERIFIED',
      });
    });
  });

  it('never refuses a plan for being unbalanced', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);

      // Three items, all in one category. A 70-20-10 rule would call this lopsided; this product
      // has no rule, so it accepts them and counts them.
      await anObjectiveOn(harness, planId);
      await anObjectiveOn(harness, planId);
      await anObjectiveOn(harness, planId);

      const accepted = await attempt(harness, {
        commandName: 'career.move-development-plan',
        developmentPlanId: planId,
        to: 'active',
        expectedVersion: 1,
      });

      expect(reasonOf(accepted)).toBe('accepted');
    });
  });

  it('mentions no tolerance, target or weighting anywhere in the application layer', () => {
    for (const { name, text } of applicationSources()) {
      const code = withoutComments(text);

      for (const forbidden of ['tolerance', 'mixTarget', 'balanceVerdict', 'weighting']) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('nothing here is scheduled and nobody is told', () => {
  it('declares no job, scheduler, notification or storage port', () => {
    for (const { name, text } of applicationSources()) {
      const code = withoutComments(text);

      for (const forbidden of [
        'JobPort',
        'NotificationPort',
        'StoragePort',
        'schedule',
        'signedUrl',
        'sendNotification',
      ]) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  /**
   * Expiry is derived at the boundary and never written.
   *
   * A stored `expired` would need something to move it overnight, and nothing runs — which is why a
   * check constraint refuses the word at the table too.
   */
  it('never stores `expired`, and derives it on read', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const id = await aRecommendation(harness, '2026-09-01');
      const held = harness.stores.tables.mobility.get(id);

      expect(held?.status).toBe('proposed');

      const summary = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
        asOf: '2026-10-01',
      });

      expect(summary.openRecommendations[0]?.status).toBe('proposed');
      expect(summary.openRecommendations[0]?.standing).toBe('expired');

      // And on a day before it lapses, the same row reads as current. Nothing changed in between.
      const earlier = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
        asOf: '2026-08-20',
      });

      expect(earlier.openRecommendations[0]?.standing).toBe('proposed');
    });
  });
});

describe('the summary is derived, and admits what it cannot show', () => {
  it('carries no upstream fact Career does not own', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const summary = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
      });
      const fields = Object.keys(summary);

      for (const absent of [
        'criticality',
        'potentialBand',
        'nineBox',
        'learningHistory',
        'readinessScore',
        'personName',
      ]) {
        expect(fields, absent).not.toContain(absent);
      }
    });
  });

  it('echoes the day it answered for', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const summary = await ask<CareerSummaryView>(harness, {
        queryName: 'career.read-summary',
        employmentId: EMPLOYMENT,
      });

      expect(summary.asOf).toBe('2026-08-13');
    });
  });
});
