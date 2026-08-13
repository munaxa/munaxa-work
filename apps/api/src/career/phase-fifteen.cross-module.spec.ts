import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ASSIGNMENT_ID,
  CONNECTION,
  EMPLOYEE_ID,
  OTHER_POSITION_ID,
  POSITION_ID,
  TODAY,
  UNIT_ID,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  named,
  reasonOf,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';
import type {
  CareerSummaryView,
  DevelopmentPlanDetailView,
  SuccessionPlanDetailView,
} from '@work/career';

/**
 * The mandatory Phase 15 scenario: one career, end to end, through everything real.
 *
 * Real dispatcher, real Career handlers, real PostgreSQL repositories, real row-level security, and
 * the **production** `CareerEmployment`, `CareerOrganization` and `CareerLearning` adapters running
 * inside their real bounded service grants. Employment, Organization and Learning answer as query
 * handlers on the same dispatcher, so the shape of every published contract Career consumes is under
 * test here rather than mocked away.
 *
 * The point of running it as one story rather than as twenty independent cases: a career is a
 * sequence, and the interesting failures are between the steps. A plan that could be created but not
 * activated, a nomination confirmable for somebody whose employment ended, a course item attached to
 * a colleague's assignment — none of those show up in a test that arranges its own state.
 *
 * **Nothing in this file seeds Career state directly.** Every row is written by the command that
 * owns it, through the adapters. A fixture that reached into the tables could arrange a succession
 * plan for a position no adapter ever confirmed, and every assertion built on it would then be about
 * a state the product cannot reach.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 cross-module scenario');

suite('phase 15 — a career, through the real adapters', () => {
  let harness: CrossModuleHarness;

  beforeAll(async () => {
    // The unprivileged role: a superuser bypasses every row-level security policy, and a suite that
    // connected as one would report isolation it never gave the database a chance to enforce.
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  /**
   * The whole sequence, in order, as one test.
   *
   * Split into `it` blocks it would need shared mutable state between them, and vitest gives no
   * ordering guarantee worth relying on for that. One story, asserted at every step.
   */
  it('runs the whole flow: path, plan, development, succession, readiness and mobility', async () => {
    // ---------------------------------------------------------------------------------------
    // 1–2. A career path, and the stages along it. The stage names a position, and the
    // production Organization adapter confirms it through the exact-identifier filter.
    // ---------------------------------------------------------------------------------------
    const { pathId } = await send<{ pathId: string }>(harness, {
      commandName: 'career.create-path',
      code: 'finance',
      name: named('Finance', 'المالية'),
      kind: 'management',
      effectiveFrom: '2026-01-01',
    });

    await send(harness, {
      commandName: 'career.add-stage',
      pathId,
      sequence: 1,
      name: named('Finance manager', 'مدير مالي'),
      targetPositionId: POSITION_ID,
    });

    // A stage naming a position Organization does not have is refused — the adapter answered, and
    // the answer was no. This is the permitted case's refusal, beside it.
    expect(
      reasonOf(
        await attempt(harness, {
          commandName: 'career.add-stage',
          pathId,
          sequence: 2,
          name: named('Nowhere', 'لا مكان'),
          targetPositionId: '01900000-0000-7000-8000-00000000dead',
        }),
      ),
    ).toBe('career.rejection.position-not-found');

    // 3. Published.
    await send(harness, { commandName: 'career.publish-path', pathId, expectedVersion: 1 });

    // ---------------------------------------------------------------------------------------
    // 4–5. A career plan for a real employment, confirmed through the production Employment
    // adapter, then activated.
    // ---------------------------------------------------------------------------------------
    const { careerPlanId } = await send<{ careerPlanId: string }>(harness, {
      commandName: 'career.create-plan',
      employmentId: EMPLOYEE_ID,
      startedOn: '2026-03-01',
      targetDate: '2027-03-01',
    });

    await send(harness, {
      commandName: 'career.move-plan',
      careerPlanId,
      to: 'active',
      expectedVersion: 1,
    });

    // ---------------------------------------------------------------------------------------
    // 6–7. A development plan, a Career-owned objective, and a course item that **references**
    // Learning. The production Learning adapter confirms the assignment is this person's.
    // ---------------------------------------------------------------------------------------
    const { developmentPlanId } = await send<{ developmentPlanId: string }>(harness, {
      commandName: 'career.create-development-plan',
      employmentId: EMPLOYEE_ID,
      careerPlanId,
      startedOn: '2026-03-05',
      cycleLabel: '2026',
    });

    await send(harness, {
      commandName: 'career.add-development-item',
      developmentPlanId,
      category: 'experience',
      kind: 'project',
      title: 'Lead the year-end close',
      targetDate: '2026-12-31',
    });

    const { developmentItemId } = await send<{ developmentItemId: string }>(harness, {
      commandName: 'career.add-development-item',
      developmentPlanId,
      category: 'education',
      kind: 'course',
      title: 'Advanced financial reporting',
      learningAssignmentId: ASSIGNMENT_ID,
    });

    /**
     * **Somebody else's assignment is refused**, and this is what the narrowed port bought.
     *
     * `PEER_ASSIGNMENT_ID` exists in Learning and belongs to a colleague. The original
     * `assignmentExists(assignmentId)` would have accepted it: the assignment is real. Asking
     * `assignmentIsFor(employmentId, assignmentId)` through `learning.read-history` refuses it,
     * because it is not this person's.
     */
    expect(
      reasonOf(
        await attempt(harness, {
          commandName: 'career.add-development-item',
          developmentPlanId,
          category: 'education',
          kind: 'course',
          title: 'A colleague’s course',
          learningAssignmentId: '01900000-0000-7000-8000-00000000c008',
        }),
      ),
    ).toBe('career.rejection.learning-assignment-not-found');

    await send(harness, {
      commandName: 'career.move-development-plan',
      developmentPlanId,
      to: 'active',
      expectedVersion: 1,
    });

    // ---------------------------------------------------------------------------------------
    // 8. Talent pool and membership. Both people are real employments, confirmed.
    // ---------------------------------------------------------------------------------------
    const { talentPoolId } = await send<{ talentPoolId: string }>(harness, {
      commandName: 'career.create-pool',
      code: 'future-finance-leaders',
      name: named('Future finance leaders', 'قادة المالية المستقبليون'),
      kind: 'leadership',
    });

    await send(harness, {
      commandName: 'career.add-to-pool',
      talentPoolId,
      employmentId: EMPLOYEE_ID,
      from: '2026-03-10',
      reason: 'Ran the migration end to end',
    });

    // ---------------------------------------------------------------------------------------
    // 9. Succession: a plan for the position, a nomination, and a confirmation.
    // ---------------------------------------------------------------------------------------
    const { successionPlanId } = await send<{ successionPlanId: string }>(harness, {
      commandName: 'career.create-succession-plan',
      positionId: POSITION_ID,
      reviewOn: '2026-12-01',
    });

    const { successorId } = await send<{ successorId: string }>(harness, {
      commandName: 'career.nominate-successor',
      successionPlanId,
      employmentId: EMPLOYEE_ID,
      rank: 1,
    });

    // Somebody whose employment ended cannot be put forward. The adapter reported the status; the
    // handler refused on it.
    expect(
      reasonOf(
        await attempt(harness, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: '01900000-0000-7000-8000-00000000c003',
        }),
      ),
    ).toBe('career.rejection.employment-not-active');

    await send(harness, {
      commandName: 'career.activate-succession-plan',
      successionPlanId,
      expectedVersion: 1,
    });

    await send(harness, {
      commandName: 'career.confirm-successor',
      successorId,
      expectedVersion: 1,
    });

    // ---------------------------------------------------------------------------------------
    // 10. Readiness — stated by a person, against a tenant-configured level.
    // ---------------------------------------------------------------------------------------
    const { readinessLevelId } = await send<{ readinessLevelId: string }>(harness, {
      commandName: 'career.define-readiness-level',
      code: 'ready-now',
      name: named('Ready now', 'جاهز الآن'),
      ordinal: 4,
    });

    await send(harness, {
      commandName: 'career.record-readiness',
      employmentId: EMPLOYEE_ID,
      readinessLevelId,
      successionPlanId,
      assessedOn: '2026-06-01',
      rationale: 'Led the close without support',
    });

    // ---------------------------------------------------------------------------------------
    // 11. Mobility — a recommendation, and a decision that moves nobody.
    // ---------------------------------------------------------------------------------------
    const { mobilityRecommendationId } = await send<{ mobilityRecommendationId: string }>(harness, {
      commandName: 'career.recommend-move',
      employmentId: EMPLOYEE_ID,
      kind: 'promotion',
      targetPositionId: OTHER_POSITION_ID,
      targetUnitId: UNIT_ID,
      rationale: 'Ready for a broader remit',
      validUntil: '2026-09-01',
    });

    const employmentBefore = harness.facts.employments.map((held) => ({ ...held }));

    await send(harness, {
      commandName: 'career.decide-move',
      mobilityRecommendationId,
      to: 'accepted',
      note: 'Agreed at the September review',
      expectedVersion: 1,
    });

    /**
     * **Accepting a promotion recommendation moved nobody.**
     *
     * The upstream facts are byte-for-byte what they were before the decision: same status, same
     * position, same unit. Career recommends and executes nothing (ADR-0072), and there is no
     * adapter method through which it could have done otherwise.
     */
    expect(harness.facts.employments).toEqual(employmentBefore);

    // ---------------------------------------------------------------------------------------
    // 12–13. Read it all back: history preserved, derived values correct for a stated day.
    // ---------------------------------------------------------------------------------------
    const bench = await ask<SuccessionPlanDetailView>(harness, {
      queryName: 'career.read-succession-plan',
      successionPlanId,
      asOf: TODAY,
    });

    expect(bench.successors).toHaveLength(1);
    expect(bench.successors[0]?.status).toBe('confirmed');
    expect(bench.successors[0]?.rank).toBe(1);
    expect(bench.plan.reviewDue).toBe(false);
    // No criticality anywhere on the view, though the Organization stub returns one on every
    // `PositionView`. The adapter discards it, and Career stores no copy (AD-004, D-4).
    expect(JSON.stringify(bench)).not.toContain('critical');

    const development = await ask<DevelopmentPlanDetailView>(harness, {
      queryName: 'career.read-development-plan',
      developmentPlanId,
      asOf: TODAY,
    });

    expect(development.items).toHaveLength(2);
    expect(development.mix).toEqual({
      experience: 1,
      exposure: 0,
      education: 1,
      mixVerdict: 'NOT VERIFIED',
    });
    // The course item kept Learning's identifier and no status Career invented.
    const course = development.items.find(
      (item: DevelopmentPlanDetailView['items'][number]) => item.kind === 'course',
    );

    expect(course?.developmentItemId).toBe(developmentItemId);
    expect(course?.learningAssignmentId).toBe(ASSIGNMENT_ID);
    expect(course?.status).toBe('planned');

    const summary = await ask<CareerSummaryView>(harness, {
      queryName: 'career.read-summary',
      employmentId: EMPLOYEE_ID,
      asOf: TODAY,
    });

    expect(summary.plan?.careerPlanId).toBe(careerPlanId);
    expect(summary.openPoolMemberships).toHaveLength(1);
    expect(summary.openNominations).toHaveLength(0); // confirmed, not still nominated
    expect(summary.latestReadiness?.readinessLevelId).toBe(readinessLevelId);
    expect(summary.activeDevelopmentPlan?.developmentPlanId).toBe(developmentPlanId);
    expect(summary.asOf).toBe(TODAY);
  });
});
