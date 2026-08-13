import { describe, expect, it } from 'vitest';

import * as vocabulary from './career-vocabulary.js';
import * as development from './development.js';
import * as mobility from './mobility.js';
import * as pool from './pool.js';
import * as readiness from './readiness.js';
import * as succession from './succession.js';
import { AUTO_APPROVAL } from './career-vocabulary.js';
import {
  anItem,
  aPlan,
  aPool,
  aSuccessionPlan,
  assertAccepted,
  reasonOf,
} from './career-fixtures.js';

/**
 * The three ADRs, asserted against the code rather than described in prose.
 *
 * These are the tests that would fail if somebody made the module *more useful* in the way each ADR
 * refuses. They are deliberately the first file in the suite: every other test checks that Career
 * does its job, and these check that it does not quietly start doing another module's.
 */

describe('ADR-0072 — a recommendation is advisory, and Career writes nothing outside itself', () => {
  it('offers no function that could change an employment, a position or a salary', () => {
    // The whole exported surface, read rather than assumed. A `transfer`, `promote` or `assign`
    // here would be the module growing a write path to Employment, which is the one thing
    // ADR-0072 exists to prevent.
    const surface = [
      ...Object.keys(mobility),
      ...Object.keys(succession),
      ...Object.keys(development),
      ...Object.keys(pool),
    ].map((name) => name.toLowerCase());

    for (const forbidden of ['transfer', 'promote', 'assign', 'salary', 'pay', 'terminate']) {
      expect([forbidden, surface.some((name) => name.includes(forbidden))]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it('accepts a mobility recommendation without producing anything but a decided recommendation', () => {
    const recommended = assertAccepted(
      mobility.recommendMove({
        mobilityRecommendationId: 'm1',
        employmentId: 'e1',
        kind: 'promotion',
        targetPositionId: 'p9',
        on: '2026-08-01',
        by: 'user:hr',
      }),
    );
    const accepted = assertAccepted(
      mobility.decideMove(recommended, { to: 'accepted', on: '2026-08-05', by: 'user:director' }),
    );

    // The row records agreement and carries no destination effect: the target position is the same
    // identifier it was suggested against, and nothing names an assignment, an effective date or a
    // letter.
    expect(accepted.status).toBe('accepted');
    expect(accepted.targetPositionId).toBe('p9');
    expect(Object.keys(accepted)).not.toContain('assignmentId');
    expect(Object.keys(accepted)).not.toContain('effectiveDate');
  });

  it('stores no position criticality anywhere', () => {
    const plan = assertAccepted(
      succession.createSuccessionPlan({ successionPlanId: 's1', positionId: 'p1' }),
    );

    // Organization owns criticality (AD-004). A succession plan names the position and knows
    // nothing else about it — a copy here would be the staler of two answers.
    expect(Object.keys(plan)).toEqual(
      expect.not.arrayContaining(['criticality', 'critical', 'positionTitle', 'grade']),
    );
    expect(Object.keys(vocabulary)).not.toContain('POSITION_CRITICALITIES');
  });

  it('refuses system:auto-approval on every act that commits to something', () => {
    const nominated = succession.nominate(aSuccessionPlan(), {
      successorId: 'x1',
      employmentId: 'e1',
      on: '2026-08-01',
      by: AUTO_APPROVAL,
    });
    const confirmed = succession.confirmSuccessor(
      assertAccepted(
        succession.nominate(aSuccessionPlan(), {
          successorId: 'x2',
          employmentId: 'e1',
          on: '2026-08-01',
          by: 'user:hr',
        }),
      ),
      { on: '2026-08-02', by: AUTO_APPROVAL },
    );
    const acknowledged = development.acknowledgeDevelopmentPlan(aPlan(), {
      by: 'employee',
      on: '2026-08-02',
      recordedBy: AUTO_APPROVAL,
    });
    const stated = readiness.recordReadiness({
      readinessAssessmentId: 'r1',
      employmentId: 'e1',
      readinessLevelId: 'l1',
      positionId: 'p1',
      assessedOn: '2026-08-01',
      assessedBy: AUTO_APPROVAL,
      at: new Date('2026-08-01T09:00:00.000Z'),
    });

    // `AutoApprovingPort` says in its own comment that it pretends nothing. Recording it against a
    // succession decision would be a fabricated approval on the module's most consequential record.
    expect(reasonOf(nominated)).toBe('nomination-requires-a-person');
    expect(reasonOf(confirmed)).toBe('confirmation-requires-a-person');
    expect(reasonOf(acknowledged)).toBe('acknowledgement-requires-a-person');
    expect(reasonOf(stated)).toBe('readiness-requires-a-person');
  });
});

describe('ADR-0073 — a decision is Career’s; an observation stays where it was made', () => {
  it('computes no potential band, no box code and no high-potential flag', () => {
    const words = Object.keys(vocabulary).map((name) => name.toLowerCase());

    for (const forbidden of ['potential_band', 'potentialband', 'boxcode', 'ninebox', 'nine_box']) {
      expect([forbidden, words.some((name) => name.includes(forbidden))]).toEqual([
        forbidden,
        false,
      ]);
    }
    // `high_potential` survives as a *pool kind* — a name a tenant gave a pool — and nothing in the
    // module branches on it. That is the distinction the ADR draws.
    expect(vocabulary.TALENT_POOL_KINDS).toContain('high_potential');
  });

  it('refuses to move a development item whose progress Learning owns', () => {
    const course = assertAccepted(
      development.addDevelopmentItem(aPlan(), {
        developmentItemId: 'i1',
        category: 'education',
        kind: 'course',
        title: 'Fire safety',
        learningAssignmentId: 'la-1',
      }),
    );

    // Career recording `completed` here would be a second answer to "did they finish the course",
    // and the two would disagree the first time somebody withdrew from the enrolment.
    for (const to of ['in_progress', 'completed', 'cancelled'] as const) {
      expect([
        to,
        reasonOf(development.moveDevelopmentItem(course, { to, on: '2026-09-01', by: 'user:hr' })),
      ]).toEqual([to, 'item-owned-by-learning']);
    }
  });

  it('moves an item Career genuinely owns', () => {
    const coaching = assertAccepted(
      development.addDevelopmentItem(aPlan(), {
        developmentItemId: 'i2',
        category: 'exposure',
        kind: 'coaching',
        title: 'Monthly coaching',
      }),
    );
    const started = assertAccepted(
      development.moveDevelopmentItem(coaching, {
        to: 'in_progress',
        on: '2026-09-01',
        by: 'user:hr',
      }),
    );

    // Coaching, mentoring, projects and stretch assignments have no owner anywhere else in this
    // repository. They are the reason a development plan is a Career aggregate at all.
    expect(started.status).toBe('in_progress');
  });

  it('requires a Learning assignment on a course item and refuses one anywhere else', () => {
    const orphan = development.addDevelopmentItem(aPlan(), {
      developmentItemId: 'i3',
      category: 'education',
      kind: 'course',
      title: 'A course with no assignment',
    });
    const impostor = development.addDevelopmentItem(aPlan(), {
      developmentItemId: 'i4',
      category: 'experience',
      kind: 'project',
      title: 'A project pretending to be a course',
      learningAssignmentId: 'la-2',
    });

    expect(reasonOf(orphan)).toBe('course-item-requires-a-learning-assignment');
    expect(reasonOf(impostor)).toBe('only-a-course-item-references-learning');
  });

  it('keeps a pool membership as a period rather than deleting it', () => {
    const added = assertAccepted(
      pool.addToPool(aPool(), {
        membershipId: 'pm1',
        employmentId: 'e1',
        from: '2026-01-01',
        by: 'user:hr',
      }),
    );
    const removed = assertAccepted(
      pool.removeFromPool(added, {
        on: '2026-06-30',
        by: 'user:hr',
        reason: 'Moved to a new team',
      }),
    );

    // A review a year later asks "who did we invest in and what happened to them", and a deleted
    // row cannot answer it.
    expect([removed.from, removed.to]).toEqual(['2026-01-01', '2026-06-30']);
    expect(pool.wasMemberOn(removed, '2026-03-01')).toBe(true);
    // Inclusive of both ends: somebody removed on the 30th was in the pool on the 30th.
    expect(pool.wasMemberOn(removed, '2026-06-30')).toBe(true);
    expect(pool.wasMemberOn(removed, '2026-07-01')).toBe(false);
  });
});

describe('ADR-0074 — readiness is stated, and no formula is invented', () => {
  it('exposes no function that derives a readiness level', () => {
    const surface = Object.keys(readiness).map((name) => name.toLowerCase());

    for (const forbidden of ['compute', 'derive', 'calculate', 'score', 'evaluate']) {
      expect([forbidden, surface.some((name) => name.includes(forbidden))]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it('carries no score, weight or input reference on an assessment', () => {
    const stated = assertAccepted(
      readiness.recordReadiness({
        readinessAssessmentId: 'r1',
        employmentId: 'e1',
        readinessLevelId: 'l1',
        positionId: 'p1',
        assessedOn: '2026-08-01',
        assessedBy: 'user:director',
        rationale: 'Ran the Riyadh integration end to end',
        at: new Date('2026-08-01T09:00:00.000Z'),
      }),
    );

    // The inputs a derivation would have used — a potential band, a completion count, tenure — are
    // absent by construction. There is nothing on this row a later reader could mistake for one.
    for (const absent of ['score', 'weight', 'potentialBand', 'completionCount', 'tenureMonths']) {
      expect(Object.keys(stated)).not.toContain(absent);
    }
    expect(stated.assessedBy).toBe('user:director');
  });

  it('counts development items by category and returns no verdict', () => {
    const items = [
      anItem({ developmentItemId: 'a', category: 'experience' }),
      anItem({ developmentItemId: 'b', category: 'experience' }),
      anItem({ developmentItemId: 'c', category: 'exposure' }),
    ];
    const counts = development.categoryCountsOf(items);

    // Three numbers a tenant can judge for themselves. No percentage, no target, no tolerance and
    // no balanced/unbalanced field — the 70-20-10 rule was never specified (D-12).
    expect(counts).toEqual({ experience: 2, exposure: 1, education: 0 });
    for (const absent of ['balanced', 'target', 'tolerance', 'ratio', 'percentage', 'verdict']) {
      expect(Object.keys(counts)).not.toContain(absent);
    }
  });

  it('never refuses a plan for being unbalanced', () => {
    // Every item in one category — as far from 70-20-10 as a plan can get — and the plan activates.
    const plan = aPlan();
    const activated = development.moveDevelopmentPlan(plan, 3, {
      to: 'active',
      on: '2026-08-01',
      by: 'user:hr',
    });

    expect(assertAccepted(activated).status).toBe('active');
  });
});
