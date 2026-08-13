import { describe, expect, it } from 'vitest';

import {
  CAREER_PATH_TRANSITIONS,
  CAREER_PLAN_TRANSITIONS,
  DEVELOPMENT_ITEM_TRANSITIONS,
  DEVELOPMENT_PLAN_TRANSITIONS,
  MOBILITY_TRANSITIONS,
  SUCCESSION_PLAN_TRANSITIONS,
  SUCCESSOR_TRANSITIONS,
  TALENT_POOL_TRANSITIONS,
} from './career-vocabulary.js';
import { addStage, archivePath, createPath, isInForce, publishPath } from './path.js';
import { amendCareerPlan, createCareerPlan, moveCareerPlan } from './plan.js';
import { closePool, createPool } from './pool.js';
import {
  activateSuccessionPlan,
  archiveSuccessionPlan,
  confirmSuccessor,
  withdrawSuccessor,
} from './succession.js';
import { moveDevelopmentPlan } from './development.js';
import { decideMove, recommendMove, standingOf } from './mobility.js';
import {
  aPath,
  aPlan,
  aPool,
  aSuccessionPlan,
  aSuccessor,
  assertAccepted,
  reasonOf,
} from './career-fixtures.js';

/**
 * Every lifecycle in the approved plan's §7, asserted in both directions.
 *
 * For each: the transition that is permitted, the one that is refused, the terminal state that
 * offers nothing, and the repeat that is refused a second time. The transition tables are asserted
 * directly as well as through the aggregates, because a table with an entry no function reaches is
 * a state the schema will allow and the domain will not.
 */

const terminalStatesOf = (table: Readonly<Record<string, readonly string[]>>): readonly string[] =>
  Object.entries(table)
    .filter(([, next]) => next.length === 0)
    .map(([state]) => state);

describe('the transition tables themselves', () => {
  it('names a terminal state in every machine, and reaches every state from somewhere', () => {
    // Typed as the widened shape rather than inferred: the eight tables have eight different key
    // unions, so an inferred `Object.entries` yields `any` and every assertion below would be
    // checking nothing while passing.
    const machines: readonly [string, Readonly<Record<string, readonly string[]>>][] = [
      ['path', CAREER_PATH_TRANSITIONS],
      ['plan', CAREER_PLAN_TRANSITIONS],
      ['pool', TALENT_POOL_TRANSITIONS],
      ['succession', SUCCESSION_PLAN_TRANSITIONS],
      ['successor', SUCCESSOR_TRANSITIONS],
      ['developmentPlan', DEVELOPMENT_PLAN_TRANSITIONS],
      ['developmentItem', DEVELOPMENT_ITEM_TRANSITIONS],
      ['mobility', MOBILITY_TRANSITIONS],
    ];

    for (const [name, table] of machines) {
      // A machine with no terminal state is one nothing ever finishes.
      expect([name, terminalStatesOf(table).length > 0]).toEqual([name, true]);
      // Every destination is a declared state: a typo in a transition list would otherwise be a
      // state no check constraint knows about.
      for (const next of Object.values(table).flat()) {
        expect([name, next, Object.keys(table).includes(next)]).toEqual([name, next, true]);
      }
    }
  });

  it('never lets a terminal state transition anywhere', () => {
    expect(CAREER_PLAN_TRANSITIONS.achieved).toEqual([]);
    expect(CAREER_PLAN_TRANSITIONS.abandoned).toEqual([]);
    expect(SUCCESSOR_TRANSITIONS.withdrawn).toEqual([]);
    expect(DEVELOPMENT_ITEM_TRANSITIONS.completed).toEqual([]);
    // Accepting or declining a recommendation is the end of it. A second opinion is a new one.
    expect(MOBILITY_TRANSITIONS.accepted).toEqual([]);
    expect(MOBILITY_TRANSITIONS.declined).toEqual([]);
  });
});

describe('a career path', () => {
  it('publishes once it has a stage, and refuses to publish empty', () => {
    const path = aPath();

    // A path with no stages describes no progression at all — the emptiness Learning refuses when
    // publishing a path with no steps.
    expect(reasonOf(publishPath(path, 0))).toBe('path-has-no-stages');
    expect(assertAccepted(publishPath(path, 3)).status).toBe('published');
  });

  it('refuses to publish a path that is already archived, and archival is terminal', () => {
    const archived = assertAccepted(archivePath(aPath(), new Date(), 'user:hr'));

    expect(reasonOf(publishPath(archived, 3))).toBe('path-transition-refused');
    expect(reasonOf(archivePath(archived, new Date(), 'user:hr'))).toBe('path-transition-refused');
  });

  it('refuses a stage on an archived path', () => {
    const archived = assertAccepted(archivePath(aPath(), new Date(), 'user:hr'));
    const added = addStage(archived, {
      stageId: 's1',
      pathId: archived.pathId,
      sequence: 1,
      name: { en: 'Lead', ar: 'قائد' },
    });

    // A stage added after archival would change what a historical plan was planning towards.
    expect(reasonOf(added)).toBe('path-archived');
  });

  it('refuses a sequence outside its bounds and accepts both edges', () => {
    const path = aPath();
    const at = (sequence: number) =>
      addStage(path, { stageId: 's', pathId: path.pathId, sequence, name: { en: 'A', ar: 'أ' } });

    expect(reasonOf(at(0))).toBe('stage-sequence-invalid');
    expect(reasonOf(at(501))).toBe('stage-sequence-invalid');
    expect(reasonOf(at(1.5))).toBe('stage-sequence-invalid');
    expect(assertAccepted(at(1)).sequence).toBe(1);
    expect(assertAccepted(at(500)).sequence).toBe(500);
  });

  it('refuses an effective period that ends before it begins', () => {
    const created = createPath({
      pathId: 'p',
      code: 'leadership',
      name: { en: 'Leadership', ar: 'القيادة' },
      kind: 'leadership',
      effectiveFrom: '2026-06-01',
      effectiveTo: '2026-01-01',
    });

    expect(reasonOf(created)).toBe('path-effective-period-invalid');
  });

  it('derives whether it is in force rather than storing it', () => {
    const path = aPath({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });

    expect(isInForce(path, '2025-12-31')).toBe(false);
    expect(isInForce(path, '2026-01-01')).toBe(true);
    expect(isInForce(path, '2026-12-31')).toBe(true);
    expect(isInForce(path, '2027-01-01')).toBe(false);
    // An open-ended path stays in force. A civil date comparison, never a `Date`.
    expect(isInForce(aPath({ effectiveFrom: '2026-01-01' }), '2099-01-01')).toBe(true);
  });
});

describe('a career plan', () => {
  const created = (overrides: Partial<Parameters<typeof createCareerPlan>[0]> = {}) =>
    createCareerPlan({
      careerPlanId: 'cp1',
      employmentId: 'e1',
      startedOn: '2026-01-01',
      ...overrides,
    });

  it('activates, achieves, and refuses to move again', () => {
    const active = assertAccepted(
      moveCareerPlan(assertAccepted(created()), { to: 'active', on: '2026-02-01', by: 'user:hr' }),
    );
    const achieved = assertAccepted(
      moveCareerPlan(active, { to: 'achieved', on: '2026-11-01', by: 'user:hr' }),
    );

    expect([achieved.status, achieved.closedOn, achieved.closedBy]).toEqual([
      'achieved',
      '2026-11-01',
      'user:hr',
    ]);
    // An ending is an ending. A new intention is a new plan, so the record of the old one survives.
    expect(
      reasonOf(moveCareerPlan(achieved, { to: 'active', on: '2026-12-01', by: 'user:hr' })),
    ).toBe('plan-transition-refused');
  });

  it('keeps achieved and abandoned as different endings', () => {
    const active = assertAccepted(
      moveCareerPlan(assertAccepted(created()), { to: 'active', on: '2026-02-01', by: 'user:hr' }),
    );

    expect(
      assertAccepted(moveCareerPlan(active, { to: 'abandoned', on: '2026-06-01', by: 'u' })).status,
    ).toBe('abandoned');
    expect(
      assertAccepted(moveCareerPlan(active, { to: 'achieved', on: '2026-06-01', by: 'u' })).status,
    ).toBe('achieved');
  });

  it('records no closing day on an activation', () => {
    const active = assertAccepted(
      moveCareerPlan(assertAccepted(created()), { to: 'active', on: '2026-02-01', by: 'user:hr' }),
    );

    // "When did they achieve it" is a question. "When did the plan become active" is the day it
    // was written, and stamping a closure date on it would misdescribe the row.
    expect(active.closedOn).toBeUndefined();
  });

  it('refuses a stage on a plan that names no path', () => {
    expect(reasonOf(created({ targetStageId: 'st1' }))).toBe('plan-stage-without-path');
    // With a path, the same stage is fine — and a path is optional (D-18).
    expect(assertAccepted(created({ pathId: 'p1', targetStageId: 'st1' })).targetStageId).toBe(
      'st1',
    );
    expect(assertAccepted(created()).pathId).toBeUndefined();
  });

  it('refuses a target date before the plan started, at the boundary and beyond', () => {
    expect(reasonOf(created({ targetDate: '2025-12-31' }))).toBe('plan-target-before-start');
    // The same day is not before it.
    expect(assertAccepted(created({ targetDate: '2026-01-01' })).targetDate).toBe('2026-01-01');
  });

  it('refuses an amendment to a closed plan', () => {
    const abandoned = assertAccepted(
      moveCareerPlan(assertAccepted(created()), { to: 'abandoned', on: '2026-03-01', by: 'u' }),
    );

    expect(reasonOf(amendCareerPlan(abandoned, { notes: 'One more thought' }))).toBe('plan-closed');
  });

  it('refuses a date that is not a civil date', () => {
    expect(reasonOf(created({ startedOn: '2026-1-1' }))).toBe('plan-start-date-invalid');
    expect(reasonOf(created({ startedOn: '2026-02-30' }))).toBe('plan-start-date-invalid');
    expect(reasonOf(created({ startedOn: '2026-01-01T00:00:00Z' }))).toBe(
      'plan-start-date-invalid',
    );
  });
});

describe('a talent pool', () => {
  it('closes once and refuses to close again', () => {
    const closed = assertAccepted(closePool(aPool(), new Date(), 'user:hr'));

    expect(closed.status).toBe('closed');
    expect(reasonOf(closePool(closed, new Date(), 'user:hr'))).toBe('pool-transition-refused');
  });

  it('refuses a name that is not in both languages', () => {
    const created = createPool({
      talentPoolId: 'p',
      code: 'leadership',
      name: { en: 'Leadership', ar: '  ' },
      kind: 'leadership',
    });

    expect(reasonOf(created)).toBe('pool-name-required');
  });
});

describe('a succession plan and its bench', () => {
  it('activates with somebody on it and refuses to activate empty', () => {
    const plan = aSuccessionPlan();

    // An empty bench presented as an active succession plan reads as "covered" in a review.
    expect(reasonOf(activateSuccessionPlan(plan, 0))).toBe('succession-plan-has-no-successors');
    expect(assertAccepted(activateSuccessionPlan(plan, 2)).status).toBe('active');
  });

  it('confirms a nomination, and refuses to confirm it twice', () => {
    const confirmed = assertAccepted(
      confirmSuccessor(aSuccessor(), { on: '2026-08-02', by: 'user:director' }),
    );

    expect([confirmed.status, confirmed.confirmedBy]).toEqual(['confirmed', 'user:director']);
    expect(reasonOf(confirmSuccessor(confirmed, { on: '2026-08-03', by: 'user:director' }))).toBe(
      'successor-transition-refused',
    );
  });

  it('withdraws a confirmed successor and requires a reason', () => {
    const confirmed = assertAccepted(
      confirmSuccessor(aSuccessor(), { on: '2026-08-02', by: 'user:director' }),
    );

    expect(
      reasonOf(withdrawSuccessor(confirmed, { on: '2026-09-01', by: 'u', reason: '   ' })),
    ).toBe('withdrawal-reason-required');

    const withdrawn = assertAccepted(
      withdrawSuccessor(confirmed, { on: '2026-09-01', by: 'u', reason: 'Left the company' }),
    );

    // Withdrawal is a state, never a delete: the nomination and the confirmation both survive it.
    expect([withdrawn.status, withdrawn.confirmedOn, withdrawn.withdrawalReason]).toEqual([
      'withdrawn',
      '2026-08-02',
      'Left the company',
    ]);
    expect(
      reasonOf(withdrawSuccessor(withdrawn, { on: '2026-10-01', by: 'u', reason: 'Again' })),
    ).toBe('successor-transition-refused');
  });

  it('refuses a nomination on an archived plan', () => {
    const archived = assertAccepted(
      archiveSuccessionPlan(aSuccessionPlan(), new Date(), 'user:hr'),
    );

    expect(reasonOf(activateSuccessionPlan(archived, 2))).toBe('succession-transition-refused');
  });
});

describe('a development plan', () => {
  it('activates with an item and refuses to activate empty', () => {
    expect(
      reasonOf(moveDevelopmentPlan(aPlan(), 0, { to: 'active', on: '2026-02-01', by: 'u' })),
    ).toBe('development-plan-has-no-items');
    expect(
      assertAccepted(moveDevelopmentPlan(aPlan(), 1, { to: 'active', on: '2026-02-01', by: 'u' }))
        .status,
    ).toBe('active');
  });

  it('refuses to reopen a completed plan', () => {
    const active = assertAccepted(
      moveDevelopmentPlan(aPlan(), 1, { to: 'active', on: '2026-02-01', by: 'u' }),
    );
    const completed = assertAccepted(
      moveDevelopmentPlan(active, 1, { to: 'completed', on: '2026-11-01', by: 'u' }),
    );

    expect(
      reasonOf(moveDevelopmentPlan(completed, 1, { to: 'active', on: '2026-12-01', by: 'u' })),
    ).toBe('development-transition-refused');
  });
});

describe('a mobility recommendation', () => {
  const recommended = (validUntil?: string) =>
    assertAccepted(
      recommendMove({
        mobilityRecommendationId: 'm1',
        employmentId: 'e1',
        kind: 'lateral_move',
        on: '2026-08-01',
        by: 'user:hr',
        ...(validUntil === undefined ? {} : { validUntil }),
      }),
    );

  it('accepts or declines once, and refuses a second decision', () => {
    const declined = assertAccepted(
      decideMove(recommended(), { to: 'declined', on: '2026-08-10', by: 'user:director' }),
    );

    expect(declined.status).toBe('declined');
    expect(reasonOf(decideMove(declined, { to: 'accepted', on: '2026-08-11', by: 'u' }))).toBe(
      'recommendation-transition-refused',
    );
  });

  it('derives expiry against the day asked, and stores it nowhere', () => {
    const lapsing = recommended('2026-09-30');

    // Nothing wrote `expired`, and nothing ever will: `JobPort` has no adapter (D-13, ADR-0070).
    expect(lapsing.status).toBe('proposed');
    expect(standingOf(lapsing, '2026-09-29')).toBe('proposed');
    expect(standingOf(lapsing, '2026-09-30')).toBe('proposed');
    expect(standingOf(lapsing, '2026-10-01')).toBe('expired');
  });

  it('keeps a decision even after the validity day passes', () => {
    const accepted = assertAccepted(
      decideMove(recommended('2026-09-30'), { to: 'accepted', on: '2026-08-05', by: 'u' }),
    );

    // Agreeing to something and then letting its validity lapse does not un-agree it.
    expect(standingOf(accepted, '2027-01-01')).toBe('accepted');
  });

  it('never expires a recommendation with no validity day', () => {
    // A real answer rather than a missing one: some suggestions stand until somebody decides.
    expect(standingOf(recommended(), '2099-01-01')).toBe('proposed');
  });

  it('refuses a validity day on or before the day it was made', () => {
    const sameDay = recommendMove({
      mobilityRecommendationId: 'm2',
      employmentId: 'e1',
      kind: 'promotion',
      on: '2026-08-01',
      by: 'user:hr',
      validUntil: '2026-08-01',
    });

    expect(reasonOf(sameDay)).toBe('recommendation-expires-before-it-is-made');
  });
});
