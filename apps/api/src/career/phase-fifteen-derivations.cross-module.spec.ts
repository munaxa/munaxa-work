import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  EMPLOYEE_ID,
  PEER_ID,
  POSITION_ID,
  TENANT,
  TODAY,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';
import type { MobilityRecommendationView, SuccessionPlanDetailView } from '@work/career';

/**
 * What Career computes at the moment somebody asks, and what it refuses to let anybody rewrite.
 *
 * Split from the end-to-end scenario because these are a different claim. The scenario proves the
 * sequence works; these prove that two of its answers are *derived* — `expired` from a stated day
 * against a stored `valid_until`, a due review from a stated day against a stored review date — and
 * that a third, a recorded nomination, survives the upstream fact that produced it changing.
 *
 * Nothing here is scheduled and nothing here is stored: `expired` is never written to a column, and
 * no job marks a review due. A stored flag would be right on the day it was written and wrong every
 * day after.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 derivation suite');

suite('phase 15 — derived at the boundary, through the real adapters', () => {
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

  /**
   * Derived values, against three stated days, on the row the scenario wrote.
   *
   * Nothing changed between the reads. `standing` is a function of `valid_until` and the day asked,
   * and it is the only place `expired` is ever produced — the stored status stays `proposed` (D-13).
   */
  it('derives expiry from the stated day, on either side of the boundary', async () => {
    const { mobilityRecommendationId } = await send<{ mobilityRecommendationId: string }>(harness, {
      commandName: 'career.recommend-move',
      employmentId: EMPLOYEE_ID,
      kind: 'lateral_move',
      validUntil: '2026-09-01',
    });

    const standingOn = async (asOf: string): Promise<string | undefined> => {
      const found = await ask<{ readonly items: readonly MobilityRecommendationView[] }>(harness, {
        queryName: 'career.search-recommendations',
        employmentId: EMPLOYEE_ID,
        asOf,
      });

      return found.items[0]?.standing;
    };

    expect(await standingOn('2026-08-31')).toBe('proposed');
    // The day it stops being current is inclusive: still proposed on `valid_until` itself.
    expect(await standingOn('2026-09-01')).toBe('proposed');
    expect(await standingOn('2026-09-02')).toBe('expired');

    const stored = await harness.rowsIn<{ status: string }>(
      TENANT,
      `select status from career_mobility_recommendation where id = $1`,
      [mobilityRecommendationId],
    );

    // Nothing wrote `expired`, and a check constraint would have refused it if anything tried.
    expect(stored[0]?.status).toBe('proposed');
  });

  /**
   * A succession review comes due because somebody asked, not because anything fired.
   *
   * There is no `JobPort` anywhere in this repository. `reviewDue` is a comparison between the day
   * stored and the day the caller stated, and the two reads below differ only in the day.
   */
  it('derives a due review from the stated day, with nothing scheduled', async () => {
    const { successionPlanId } = await send<{ successionPlanId: string }>(harness, {
      commandName: 'career.create-succession-plan',
      positionId: POSITION_ID,
      reviewOn: '2026-12-01',
    });

    await send(harness, {
      commandName: 'career.nominate-successor',
      successionPlanId,
      employmentId: EMPLOYEE_ID,
    });
    await send(harness, {
      commandName: 'career.activate-succession-plan',
      successionPlanId,
      expectedVersion: 1,
    });

    const on = async (asOf: string): Promise<boolean | undefined> => {
      const found = await ask<SuccessionPlanDetailView>(harness, {
        queryName: 'career.read-succession-plan',
        successionPlanId,
        asOf,
      });

      return found.plan.reviewDue;
    };

    expect(await on('2026-11-30')).toBe(false);
    expect(await on('2026-12-01')).toBe(true);
    expect(await on('2026-12-02')).toBe(true);
  });

  /**
   * The historical record does not follow the upstream fact.
   *
   * A nomination records that on a day, somebody put this person forward. If the employment later
   * ends, that remains what happened — the row is not rewritten, and the bench still shows it. This
   * is the difference between storing a *fact* and rendering a *join*.
   */
  it('keeps a nomination exactly as recorded after the upstream employment ends', async () => {
    const { successionPlanId } = await send<{ successionPlanId: string }>(harness, {
      commandName: 'career.create-succession-plan',
      positionId: POSITION_ID,
    });
    const { successorId } = await send<{ successorId: string }>(harness, {
      commandName: 'career.nominate-successor',
      successionPlanId,
      employmentId: PEER_ID,
    });

    const before = await ask<SuccessionPlanDetailView>(harness, {
      queryName: 'career.read-succession-plan',
      successionPlanId,
      asOf: TODAY,
    });

    // The upstream world changes underneath the record: this person leaves.
    for (const held of harness.facts.employments) {
      if (held.employmentId === PEER_ID) held.status = 'ended';
    }

    const after = await ask<SuccessionPlanDetailView>(harness, {
      queryName: 'career.read-succession-plan',
      successionPlanId,
      asOf: TODAY,
    });

    expect(after.successors).toEqual(before.successors);
    expect(after.successors[0]?.successorId).toBe(successorId);
    expect(after.successors[0]?.status).toBe('nominated');

    // And a *new* nomination for the same person is now refused — the current fact governs new
    // decisions, while the historical one governs the record.
    expect(
      reasonOf(
        await attempt(harness, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: PEER_ID,
        }),
      ),
    ).toBe('career.rejection.employment-not-active');
  });
});
