import { describe, expect, it } from 'vitest';

import {
  ASSESSOR,
  EMPLOYMENT,
  POSITION,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  send,
} from './career-test-harness.js';
import { aReadinessLevel } from './career-scenarios.js';
import type { ReadinessHistoryView } from './career-record-queries.js';

/**
 * The facts this module keeps rather than overwrites.
 *
 * A readiness assessment, a pool membership period and a withdrawn nomination are all answers to
 * "what did we think, and when did it change" — the question a succession review asks a year later.
 * A product that reconstructed any of them from mutable current state would be able to answer only
 * "what do we think now", which is a different and much less useful thing.
 */

describe('a readiness assessment', () => {
  /**
   * A correction is a new assessment. The store has no `update` method, so this is enforced by
   * absence rather than by a rule somebody has to remember — and the database refuses it again with
   * a trigger (D-14).
   */
  it('appends a correction and preserves the statement it corrected', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const notReady = await aReadinessLevel(harness, 'not-ready', 1);
      const readyNow = await aReadinessLevel(harness, 'ready-now', 4);

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: notReady,
        positionId: POSITION,
        assessedOn: '2026-03-01',
        rationale: 'Needs a larger team first',
      });

      harness.clock.advanceTo(new Date('2026-09-01T09:00:00Z'));

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: readyNow,
        positionId: POSITION,
        assessedOn: '2026-09-01',
        rationale: 'Ran the migration end to end',
      });

      const history = await ask<ReadinessHistoryView>(harness, {
        queryName: 'career.read-readiness-history',
        employmentId: EMPLOYMENT,
      });

      expect(history.assessments).toHaveLength(2);
      expect(history.latest?.readinessLevelId).toBe(readyNow);
      // The earlier statement is still there, whole, with its own rationale and its own day.
      expect(history.assessments[1]?.readinessLevelId).toBe(notReady);
      expect(history.assessments[1]?.rationale).toBe('Needs a larger team first');
      expect(history.assessments[1]?.assessedOn).toBe('2026-03-01');
    });
  });

  /**
   * Two assessments on the same civil day resolve to the one recorded later.
   *
   * That is the point of an append-only trail: the second is the correction, and a tie broken the
   * other way would return the superseded statement as current.
   */
  it('breaks a same-day tie on the instant it was recorded', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const first = await aReadinessLevel(harness, 'not-ready', 1);
      const second = await aReadinessLevel(harness, 'ready-now', 4);

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: first,
        positionId: POSITION,
        assessedOn: '2026-08-13',
      });

      harness.clock.advanceTo(new Date('2026-08-13T16:00:00Z'));

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: second,
        positionId: POSITION,
        assessedOn: '2026-08-13',
      });

      const history = await ask<ReadinessHistoryView>(harness, {
        queryName: 'career.read-readiness-history',
        employmentId: EMPLOYMENT,
      });

      expect(history.latest?.readinessLevelId).toBe(second);
      expect(history.assessments).toHaveLength(2);
    });
  });

  it('records the authenticated assessor, never a name from the command', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const levelId = await aReadinessLevel(harness);

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: levelId,
        positionId: POSITION,
        assessedOn: '2026-08-13',
        // A caller supplying this must not be believed: it is not a field the handler reads.
        assessedBy: 'user:somebody-else',
      });

      const [held] = harness.stores.tables.assessments;

      expect(held?.assessedBy).toBe(ASSESSOR);
    });
  });

  it('refuses an assessment that is about nothing', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const levelId = await aReadinessLevel(harness);
      const refused = await attempt(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: levelId,
        assessedOn: '2026-08-13',
      });

      expect(reasonOf(refused)).toBe('career.rejection.readiness-subject-required');
    });
  });

  it('refuses an assessment against a level that was retired', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const levelId = await aReadinessLevel(harness);

      await send(harness, {
        commandName: 'career.deactivate-readiness-level',
        readinessLevelId: levelId,
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: levelId,
        positionId: POSITION,
        assessedOn: '2026-08-13',
      });

      expect(reasonOf(refused)).toBe('career.rejection.readiness-level-not-found');
    });
  });

  /** No score, no percentage, no derived level — the whole of ADR-0074 at the boundary. */
  it('publishes the statement and no number computed from it', async () => {
    const harness = harnessFor();

    await harness.as(ASSESSOR, async () => {
      const levelId = await aReadinessLevel(harness);

      await send(harness, {
        commandName: 'career.record-readiness',
        employmentId: EMPLOYMENT,
        readinessLevelId: levelId,
        positionId: POSITION,
        assessedOn: '2026-08-13',
      });

      const history = await ask<ReadinessHistoryView>(harness, {
        queryName: 'career.read-readiness-history',
        employmentId: EMPLOYMENT,
      });
      const fields = Object.keys(history.latest ?? {});

      for (const absent of ['score', 'percentage', 'weight', 'derivedLevel', 'confidence']) {
        expect(fields, absent).not.toContain(absent);
      }
    });
  });
});
