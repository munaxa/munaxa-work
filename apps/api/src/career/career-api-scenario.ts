import type { INestApplication } from '@nestjs/common';

import { http, type CreatedBody } from './career-api.fixture.js';
import { EMPLOYEE_ID, POSITION_ID } from './phase-fifteen-upstream.js';

/**
 * The Career state every API suite starts from, driven **entirely over HTTP**.
 *
 * Nothing here inserts a row. Each step is a real request through the real controller, the real
 * validation pipe and the real repositories, so a suite that reaches an interesting state has
 * already proved that the ordinary path to it works. Seeding directly would let a security test pass
 * against a database state no client could ever have produced — and in this module the state
 * somebody would be tempted to seed is a confirmed successor, which a check constraint refuses to
 * anybody who is not a named human.
 */

/** The global prefix and version the application setup applies. Written once, not per request. */
export const BASE = '/api/v1/career';

export const NAME = { en: 'Finance', ar: 'المالية' };

/** Sends a request and fails loudly, so a broken step names itself rather than the next one. */
export const post = async (
  application: INestApplication,
  path: string,
  body: unknown,
  actor?: string,
): Promise<CreatedBody> => {
  const sent = http(application)
    .post(path)
    .send(body as object);
  const response = await (actor === undefined ? sent : sent.set('x-test-actor', actor));

  if (response.status >= 400) {
    throw new Error(`POST ${path} → ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return response.body as CreatedBody;
};

/** A published path with one stage naming a real position. The smallest ladder anybody can be on. */
export const aPublishedPath = async (
  application: INestApplication,
  code = 'finance',
): Promise<string> => {
  const created = await post(application, `${BASE}/paths`, {
    code,
    name: NAME,
    kind: 'management',
    effectiveFrom: '2026-01-01',
  });
  const pathId = created.pathId ?? '';

  await post(application, `${BASE}/paths/${pathId}/stages`, {
    sequence: 1,
    name: { en: 'Finance manager', ar: 'مدير مالي' },
    targetPositionId: POSITION_ID,
  });
  await post(application, `${BASE}/paths/${pathId}/publication`, { expectedVersion: 1 });
  return pathId;
};

/** A career plan at version 1, in draft. */
export const aCareerPlan = async (
  application: INestApplication,
  employmentId = EMPLOYEE_ID,
): Promise<string> => {
  const created = await post(application, `${BASE}/plans`, {
    employmentId,
    startedOn: '2026-03-01',
  });

  return created.careerPlanId ?? '';
};

/** An open talent pool. */
export const aTalentPool = async (
  application: INestApplication,
  code = 'future-finance-leaders',
): Promise<string> => {
  const created = await post(application, `${BASE}/pools`, {
    code,
    name: { en: 'Future leaders', ar: 'قادة المستقبل' },
    kind: 'leadership',
  });

  return created.talentPoolId ?? '';
};

/** A succession plan for a real position, in draft at version 1. */
export const aSuccessionPlan = async (
  application: INestApplication,
  positionId = POSITION_ID,
  reviewOn?: string,
): Promise<string> => {
  const created = await post(application, `${BASE}/succession-plans`, {
    positionId,
    ...(reviewOn === undefined ? {} : { reviewOn }),
  });

  return created.successionPlanId ?? '';
};

/** A readiness level. Its ordinal is a number a human chose, never a computed score. */
export const aReadinessLevel = async (
  application: INestApplication,
  code = 'ready-now',
  ordinal = 1,
): Promise<string> => {
  const created = await post(application, `${BASE}/readiness/levels`, {
    code,
    name: { en: 'Ready now', ar: 'جاهز الآن' },
    ordinal,
  });

  return created.readinessLevelId ?? '';
};

/** A development plan with one Career-owned item, active. */
export const anActiveDevelopmentPlan = async (
  application: INestApplication,
  employmentId = EMPLOYEE_ID,
): Promise<string> => {
  const created = await post(application, `${BASE}/development-plans`, {
    employmentId,
    startedOn: '2026-03-05',
  });
  const developmentPlanId = created.developmentPlanId ?? '';

  await post(application, `${BASE}/development-plans/${developmentPlanId}/items`, {
    category: 'experience',
    kind: 'project',
    title: 'Lead the year-end close',
  });
  await post(application, `${BASE}/development-plans/${developmentPlanId}/status`, {
    to: 'active',
    expectedVersion: 1,
  });
  return developmentPlanId;
};

/** A proposed mobility recommendation, at version 1. */
export const aRecommendation = async (
  application: INestApplication,
  validUntil?: string,
): Promise<string> => {
  const created = await post(application, `${BASE}/mobility-recommendations`, {
    employmentId: EMPLOYEE_ID,
    kind: 'lateral_move',
    ...(validUntil === undefined ? {} : { validUntil }),
  });

  return created.mobilityRecommendationId ?? '';
};
