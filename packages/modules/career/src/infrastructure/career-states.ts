import { uuidV7 } from '@work/kernel';

import { addStage, createPath } from '../domain/path.js';
import { createCareerPlan } from '../domain/plan.js';
import { addToPool, createPool } from '../domain/pool.js';
import { defineReadinessLevel, recordReadiness } from '../domain/readiness.js';
import { createSuccessionPlan, nominate } from '../domain/succession.js';
import { addDevelopmentItem, createDevelopmentPlan } from '../domain/development.js';
import { recommendMove } from '../domain/mobility.js';
import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { CareerPlanState } from '../domain/plan.js';
import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type { ReadinessAssessmentState, ReadinessLevelState } from '../domain/readiness.js';
import type { SuccessionPlanState, SuccessorState } from '../domain/succession.js';
import type { DevelopmentItemState, DevelopmentPlanState } from '../domain/development.js';
import type { MobilityRecommendationState } from '../domain/mobility.js';

/**
 * Domain states for the repository suites, built **through the domain's own constructors**.
 *
 * Not hand-written object literals. A literal could describe a state the domain refuses — a
 * confirmed successor with no confirmation day, an item that is both a course and a project — and a
 * persistence test built on one would be asserting that the database stores something the
 * application can never produce. Going through `createPath`, `nominate` and the rest means every
 * fixture is a state that actually exists.
 *
 * These are *states*, not commands: the repository suites test persistence, and the application
 * suites already tested the decisions. Where a state needs a transition applied, the suite applies
 * the domain function itself and writes the result.
 */

export const NOW = new Date('2026-08-13T09:00:00.000Z');
export const TODAY = '2026-08-13';

export const HR = 'user:career-hr';
export const ASSESSOR = 'user:career-assessor';

export const EMPLOYMENT = '01930000-0000-7000-8000-00000000e001';
export const OTHER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e002';
export const POSITION = '01930000-0000-7000-8000-00000000f001';
export const OTHER_POSITION = '01930000-0000-7000-8000-00000000f002';
export const UNIT = '01930000-0000-7000-8000-00000000d001';
export const LEARNING_ASSIGNMENT = '01930000-0000-7000-8000-00000000a001';

const named = (en: string, ar: string): { readonly en: string; readonly ar: string } => ({
  en,
  ar,
});

/** Unwraps a domain result, failing loudly rather than persisting `undefined`. */
const accepted = <TState>(result: { ok: boolean; value?: TState; error?: unknown }): TState => {
  if (!result.ok || result.value === undefined) {
    throw new Error(`The domain refused a fixture state: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

export const aPath = (overrides: { code?: string } = {}): CareerPathState =>
  accepted(
    createPath({
      pathId: uuidV7(),
      code: overrides.code ?? 'engineering',
      name: named('Engineering', 'الهندسة'),
      kind: 'technical',
      effectiveFrom: '2026-01-01',
    }),
  );

export const aStage = (path: CareerPathState, sequence = 1): CareerStageState =>
  accepted(
    addStage(path, {
      stageId: uuidV7(),
      pathId: path.pathId,
      sequence,
      name: named('Senior engineer', 'مهندس أول'),
    }),
  );

export const aPlan = (
  overrides: { employmentId?: string; startedOn?: string; targetDate?: string } = {},
): CareerPlanState =>
  accepted(
    createCareerPlan({
      careerPlanId: uuidV7(),
      employmentId: overrides.employmentId ?? EMPLOYMENT,
      startedOn: overrides.startedOn ?? '2026-03-01',
      ...(overrides.targetDate === undefined ? {} : { targetDate: overrides.targetDate }),
    }),
  );

export const aPool = (code = 'graduates'): TalentPoolState =>
  accepted(
    createPool({
      talentPoolId: uuidV7(),
      code,
      name: named('Graduates', 'الخريجون'),
      kind: 'graduate',
    }),
  );

export const aMembership = (
  pool: TalentPoolState,
  overrides: { employmentId?: string; from?: string } = {},
): PoolMembershipState =>
  accepted(
    addToPool(pool, {
      membershipId: uuidV7(),
      employmentId: overrides.employmentId ?? EMPLOYMENT,
      from: overrides.from ?? '2026-01-05',
      by: HR,
      reason: 'Graduate scheme intake',
    }),
  );

export const aReadinessLevel = (code = 'ready-now', ordinal = 4): ReadinessLevelState =>
  accepted(
    defineReadinessLevel({
      readinessLevelId: uuidV7(),
      code,
      name: named('Ready now', 'جاهز الآن'),
      ordinal,
    }),
  );

export const aSuccessionPlan = (
  overrides: { positionId?: string; reviewOn?: string } = {},
): SuccessionPlanState =>
  accepted(
    createSuccessionPlan({
      successionPlanId: uuidV7(),
      positionId: overrides.positionId ?? POSITION,
      reviewOn: overrides.reviewOn ?? '2026-12-01',
    }),
  );

export const aNomination = (
  plan: SuccessionPlanState,
  overrides: { employmentId?: string; rank?: number; readinessLevelId?: string } = {},
): SuccessorState =>
  accepted(
    nominate(plan, {
      successorId: uuidV7(),
      employmentId: overrides.employmentId ?? EMPLOYMENT,
      on: TODAY,
      by: HR,
      ...(overrides.rank === undefined ? {} : { rank: overrides.rank }),
      ...(overrides.readinessLevelId === undefined
        ? {}
        : { readinessLevelId: overrides.readinessLevelId }),
    }),
  );

export const anAssessment = (
  level: ReadinessLevelState,
  overrides: { assessedOn?: string; at?: Date; rationale?: string; employmentId?: string } = {},
): ReadinessAssessmentState =>
  accepted(
    recordReadiness({
      readinessAssessmentId: uuidV7(),
      employmentId: overrides.employmentId ?? EMPLOYMENT,
      readinessLevelId: level.readinessLevelId,
      positionId: POSITION,
      assessedOn: overrides.assessedOn ?? '2026-03-01',
      assessedBy: ASSESSOR,
      at: overrides.at ?? NOW,
      ...(overrides.rationale === undefined ? {} : { rationale: overrides.rationale }),
    }),
  );

export const aDevelopmentPlan = (overrides: { employmentId?: string } = {}): DevelopmentPlanState =>
  accepted(
    createDevelopmentPlan({
      developmentPlanId: uuidV7(),
      employmentId: overrides.employmentId ?? EMPLOYMENT,
      startedOn: '2026-02-01',
      cycleLabel: '2026',
    }),
  );

/** A Career-owned objective — coaching, a project, a stretch assignment. Never a course. */
export const anObjective = (
  plan: DevelopmentPlanState,
  overrides: { targetDate?: string; category?: 'experience' | 'exposure' | 'education' } = {},
): DevelopmentItemState =>
  accepted(
    addDevelopmentItem(plan, {
      developmentItemId: uuidV7(),
      category: overrides.category ?? 'experience',
      kind: 'project',
      title: 'Lead the platform migration',
      ...(overrides.targetDate === undefined ? {} : { targetDate: overrides.targetDate }),
    }),
  );

/** A reference to Learning's assignment, and nothing else Career keeps about it (ADR-0073). */
export const aCourseItem = (plan: DevelopmentPlanState): DevelopmentItemState =>
  accepted(
    addDevelopmentItem(plan, {
      developmentItemId: uuidV7(),
      category: 'education',
      kind: 'course',
      title: 'Finance for non-financial managers',
      learningAssignmentId: LEARNING_ASSIGNMENT,
    }),
  );

export const aRecommendation = (
  overrides: { validUntil?: string; on?: string } = {},
): MobilityRecommendationState =>
  accepted(
    recommendMove({
      mobilityRecommendationId: uuidV7(),
      employmentId: EMPLOYMENT,
      kind: 'lateral_move',
      targetPositionId: POSITION,
      targetUnitId: UNIT,
      on: overrides.on ?? '2026-06-01',
      by: HR,
      ...(overrides.validUntil === undefined ? {} : { validUntil: overrides.validUntil }),
    }),
  );
