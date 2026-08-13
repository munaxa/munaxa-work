import { describe, expect, it } from 'vitest';

import {
  EMPLOYMENT,
  HR,
  LEARNING_ASSIGNMENT,
  attempt,
  harnessFor,
  reasonOf,
  send,
} from './career-test-harness.js';
import {
  aCourseItemOn,
  aDevelopmentPlan,
  aNomination,
  aSuccessionPlan,
} from './career-scenarios.js';
import { careerModule } from './career-module.js';
import { applicationSources, shapeDependencies, withoutComments } from './career-shape.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * What this module refuses to become.
 *
 * Every assertion here is a *negative*, and each one guards a boundary that a reasonable, helpful
 * change would cross. They are written against the application layer rather than the domain because
 * this is the layer where a handler could reach a port, and a port is where a read becomes a write.
 */

describe('Career recommends and executes nothing', () => {
  /**
   * The structural guarantee, asserted structurally.
   *
   * Career cannot promote, transfer or change a salary because there is no port through which it
   * could — not because no handler currently tries. `CareerDependencies` is the whole of what a
   * handler can reach, and every port on it offers reads only.
   */
  it('declares no dependency that could write outside Career', () => {
    const declared: CareerDependencies = {
      unitOfWork: { execute: () => Promise.reject(new Error('unused')) },
      stores: harnessFor().stores,
      employment: {
        factsFor: () => Promise.resolve(undefined),
        inPosition: () => Promise.resolve([]),
      },
      organization: {
        positionExists: () => Promise.resolve(false),
        unitExists: () => Promise.resolve(false),
      },
      learning: { assignmentExists: () => Promise.resolve(false) },
      permissions: { holds: () => Promise.resolve(false) },
      clock: { now: () => new Date() },
    };

    expect(Object.keys(declared.employment)).toEqual(['factsFor', 'inPosition']);
    expect(Object.keys(declared.organization)).toEqual(['positionExists', 'unitExists']);
    expect(Object.keys(declared.learning)).toEqual(['assignmentExists']);
  });

  it('offers no command that names an employment action', () => {
    const module = careerModule(shapeDependencies());

    for (const handler of module.commands ?? []) {
      for (const forbidden of ['promote', 'transfer', 'salary', 'pay', 'terminate', 'assign-to']) {
        expect(handler.commandName, handler.commandName).not.toContain(forbidden);
      }
    }
  });

  /**
   * `promotion` is a recommendation *kind* and never an act.
   *
   * Recommending one records an opinion. This asserts that the row that results carries no effective
   * date, no assignment identifier and nothing else that could be mistaken for the move having
   * happened.
   */
  it('records a promotion recommendation as an opinion and nothing else', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const { mobilityRecommendationId } = await send<{ mobilityRecommendationId: string }>(
        harness,
        { commandName: 'career.recommend-move', employmentId: EMPLOYMENT, kind: 'promotion' },
      );

      await send(harness, {
        commandName: 'career.decide-move',
        mobilityRecommendationId,
        to: 'accepted',
        expectedVersion: 1,
      });

      const held = harness.stores.tables.mobility.get(mobilityRecommendationId);
      const fields = Object.keys(held ?? {});

      expect(held?.status).toBe('accepted');
      for (const absent of ['effectiveDate', 'assignmentId', 'salary', 'newPositionId']) {
        expect(fields, absent).not.toContain(absent);
      }
    });
  });

  it('changes nothing about an employment when a successor is confirmed', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);
      const before = await harness.employment.factsFor(EMPLOYMENT);

      await send(harness, {
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: 1,
      });

      expect(await harness.employment.factsFor(EMPLOYMENT)).toEqual(before);
    });
  });
});

describe('a decision is Career’s; an observation stays where it was made', () => {
  /**
   * Stated as a source assertion because a column, a field or a port added later is exactly the kind
   * of change that passes review — it looks like filling a gap.
   */
  it('stores and computes no criticality, potential band, nine-box or score', () => {
    for (const { name, text } of applicationSources()) {
      const code = withoutComments(text);

      for (const forbidden of [
        'criticality',
        'potentialBand',
        'potential_band',
        'nineBox',
        'nine_box',
        'boxCode',
        'highPotentialScore',
        'readinessScore',
      ]) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares no Performance port at all', () => {
    for (const { name, text } of applicationSources()) {
      expect(withoutComments(text), name).not.toMatch(/PerformancePort|talent-matrix/);
    }
  });

  it('keeps a course item as a reference with no status Career invented', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const itemId = await aCourseItemOn(harness, planId);
      const held = harness.stores.tables.developmentItems.get(itemId);

      expect(held?.learningAssignmentId).toBe(LEARNING_ASSIGNMENT);
      expect(held?.status).toBe('planned');
      expect(Object.keys(held ?? {})).not.toContain('completedOn');
    });
  });

  /**
   * ADR-0073 made executable: Career never records progress on something Learning owns.
   *
   * Two answers to "did they finish the course" would disagree the first time somebody withdrew
   * from the enrolment, and the copy here would be the stale one.
   */
  it('refuses to record progress on a course item', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const itemId = await aCourseItemOn(harness, planId);
      const refused = await attempt(harness, {
        commandName: 'career.move-development-item',
        developmentItemId: itemId,
        to: 'completed',
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe('career.rejection.item-owned-by-learning');
    });
  });

  it('refuses a course item whose Learning assignment does not exist', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId: planId,
        category: 'education',
        kind: 'course',
        title: 'A course nobody was assigned',
        learningAssignmentId: 'no-such-assignment',
      });

      expect(reasonOf(refused)).toBe('career.rejection.learning-assignment-not-found');
    });
  });

  it('refuses a non-course item that names a Learning assignment', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.add-development-item',
        developmentPlanId: planId,
        category: 'experience',
        kind: 'project',
        title: 'A project pretending to be a course',
        learningAssignmentId: LEARNING_ASSIGNMENT,
      });

      expect(reasonOf(refused)).toBe('career.rejection.only-a-course-item-references-learning');
    });
  });

  it('creates no Career course, training assignment, enrolment or learning path', () => {
    const module = careerModule(shapeDependencies());
    const names = (module.commands ?? []).map((handler) => handler.commandName);

    for (const forbidden of ['course', 'enrol', 'training', 'certification']) {
      expect(
        names.filter((name) => name.includes(forbidden)),
        forbidden,
      ).toEqual([]);
    }
  });
});
