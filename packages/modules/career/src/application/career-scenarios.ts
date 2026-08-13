import {
  EMPLOYMENT,
  LEARNING_ASSIGNMENT,
  POSITION,
  named,
  send,
  type Harness,
} from './career-test-harness.js';

/**
 * The arrangements the suites share, as commands through the real dispatcher.
 *
 * **Never by writing to a store directly.** A fixture that reached into `stores.tables` could
 * arrange a state the handlers would refuse — an active succession plan with an empty bench, a
 * course item with no Learning assignment behind it — and every assertion built on it would then be
 * about a state the product cannot reach. Going through the dispatcher means every fixture is also,
 * incidentally, a test that the path used to build it works.
 */

export const aPublishedPath = async (harness: Harness, code = 'engineering'): Promise<string> => {
  const { pathId } = await send<{ pathId: string }>(harness, {
    commandName: 'career.create-path',
    code,
    name: named('Engineering', 'الهندسة'),
    kind: 'technical',
    effectiveFrom: '2026-01-01',
  });

  await send(harness, {
    commandName: 'career.add-stage',
    pathId,
    sequence: 1,
    name: named('Senior engineer', 'مهندس أول'),
  });
  await send(harness, { commandName: 'career.publish-path', pathId, expectedVersion: 1 });
  return pathId;
};

export const aStageOn = async (
  harness: Harness,
  pathId: string,
  sequence: number,
): Promise<string> => {
  const { stageId } = await send<{ stageId: string }>(harness, {
    commandName: 'career.add-stage',
    pathId,
    sequence,
    name: named('Principal engineer', 'مهندس رئيسي'),
  });

  return stageId;
};

export const aCareerPlan = async (harness: Harness, employmentId = EMPLOYMENT): Promise<string> => {
  const { careerPlanId } = await send<{ careerPlanId: string }>(harness, {
    commandName: 'career.create-plan',
    employmentId,
    startedOn: '2026-03-01',
  });

  return careerPlanId;
};

export const anActiveCareerPlan = async (
  harness: Harness,
  employmentId = EMPLOYMENT,
): Promise<string> => {
  const careerPlanId = await aCareerPlan(harness, employmentId);

  await send(harness, {
    commandName: 'career.move-plan',
    careerPlanId,
    to: 'active',
    expectedVersion: 1,
  });
  return careerPlanId;
};

export const aPool = async (harness: Harness, code = 'graduates'): Promise<string> => {
  const { talentPoolId } = await send<{ talentPoolId: string }>(harness, {
    commandName: 'career.create-pool',
    code,
    name: named('Graduates', 'الخريجون'),
    kind: 'graduate',
  });

  return talentPoolId;
};

export const aReadinessLevel = async (
  harness: Harness,
  code = 'ready-now',
  ordinal = 4,
): Promise<string> => {
  const { readinessLevelId } = await send<{ readinessLevelId: string }>(harness, {
    commandName: 'career.define-readiness-level',
    code,
    name: named('Ready now', 'جاهز الآن'),
    ordinal,
  });

  return readinessLevelId;
};

export const aSuccessionPlan = async (harness: Harness, positionId = POSITION): Promise<string> => {
  const { successionPlanId } = await send<{ successionPlanId: string }>(harness, {
    commandName: 'career.create-succession-plan',
    positionId,
    reviewOn: '2026-12-01',
  });

  return successionPlanId;
};

export const aNomination = async (
  harness: Harness,
  successionPlanId: string,
  employmentId = EMPLOYMENT,
): Promise<string> => {
  const { successorId } = await send<{ successorId: string }>(harness, {
    commandName: 'career.nominate-successor',
    successionPlanId,
    employmentId,
  });

  return successorId;
};

export const aDevelopmentPlan = async (
  harness: Harness,
  employmentId = EMPLOYMENT,
): Promise<string> => {
  const { developmentPlanId } = await send<{ developmentPlanId: string }>(harness, {
    commandName: 'career.create-development-plan',
    employmentId,
    startedOn: '2026-02-01',
  });

  return developmentPlanId;
};

/** A Career-owned objective. Coaching, a project, a stretch assignment — never a course. */
export const anObjectiveOn = async (
  harness: Harness,
  developmentPlanId: string,
  targetDate?: string,
): Promise<string> => {
  const { developmentItemId } = await send<{ developmentItemId: string }>(harness, {
    commandName: 'career.add-development-item',
    developmentPlanId,
    category: 'experience',
    kind: 'project',
    title: 'Lead the platform migration',
    ...(targetDate === undefined ? {} : { targetDate }),
  });

  return developmentItemId;
};

/** A reference to Learning's assignment, and nothing else Career keeps about it. */
export const aCourseItemOn = async (
  harness: Harness,
  developmentPlanId: string,
): Promise<string> => {
  const { developmentItemId } = await send<{ developmentItemId: string }>(harness, {
    commandName: 'career.add-development-item',
    developmentPlanId,
    category: 'education',
    kind: 'course',
    title: 'Finance for non-financial managers',
    learningAssignmentId: LEARNING_ASSIGNMENT,
  });

  return developmentItemId;
};

export const aRecommendation = async (harness: Harness, validUntil?: string): Promise<string> => {
  const { mobilityRecommendationId } = await send<{ mobilityRecommendationId: string }>(harness, {
    commandName: 'career.recommend-move',
    employmentId: EMPLOYMENT,
    kind: 'lateral_move',
    targetPositionId: POSITION,
    ...(validUntil === undefined ? {} : { validUntil }),
  });

  return mobilityRecommendationId;
};
