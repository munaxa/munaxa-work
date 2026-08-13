import type { INestApplication } from '@nestjs/common';

import { http } from './learning-api.fixture.js';

/**
 * The catalogue every Learning API suite starts from, driven **entirely over HTTP**.
 *
 * Nothing here inserts a row. Each step is a real request through the real controller, the real
 * validation pipe and the real repositories, so a suite that reaches an interesting state has
 * already proved that the ordinary path to it works. Seeding directly would let a security test
 * pass against a database state no client could ever have produced.
 */

/** The global prefix and version the application setup applies. Written once, not per request. */
export const BASE = '/api/v1/learning';

export const NAME = { en: 'Fire safety', ar: 'السلامة من الحرائق' };

interface Identified {
  readonly categoryId?: string;
  readonly courseId?: string;
  readonly courseVersionId?: string;
  readonly versionNumber?: number;
  readonly assessmentId?: string;
  readonly pathId?: string;
  readonly stepId?: string;
  readonly mandatoryRuleId?: string;
  readonly assignmentId?: string;
  readonly enrolmentId?: string;
  readonly resultId?: string;
  readonly certificationId?: string;
  readonly instructorId?: string;
  readonly created?: boolean;
}

/** Sends a request and fails loudly, so a broken step names itself rather than the next one. */
export const post = async (
  application: INestApplication,
  path: string,
  body: unknown,
  actor?: string,
): Promise<Identified> => {
  const sent = http(application)
    .post(path)
    .send(body as object);
  const response = await (actor === undefined ? sent : sent.set('x-test-actor', actor));

  if (response.status >= 400) {
    throw new Error(`POST ${path} → ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return response.body as Identified;
};

export interface PublishedCourse {
  readonly courseId: string;
  readonly courseVersionId: string;
}

export interface CourseOptions {
  readonly code?: string;
  readonly requiresAssessment?: boolean;
  readonly certificationValidMonths?: number;
}

/** A course with one published version — the smallest catalogue anybody can be enrolled onto. */
export const aPublishedCourse = async (
  application: INestApplication,
  options: CourseOptions = {},
): Promise<PublishedCourse> => {
  const course = await post(application, `${BASE}/courses`, {
    code: options.code ?? 'fire-safety',
    name: NAME,
    delivery: 'classroom',
  });
  const courseId = course.courseId ?? '';
  const version = await post(application, `${BASE}/courses/${courseId}/versions`, {
    expectedVersion: 1,
    title: NAME,
    requiresAssessment: options.requiresAssessment ?? false,
    certificationValidMonths: options.certificationValidMonths ?? 12,
  });

  return { courseId, courseVersionId: version.courseVersionId ?? '' };
};

/** A requirement over one unit, recurring annually. The audience is confirmed upstream. */
export const aMandatoryRule = async (
  application: INestApplication,
  courseId: string,
  organizationUnitId: string,
): Promise<string> => {
  const rule = await post(application, `${BASE}/mandatory-rules`, {
    courseId,
    name: NAME,
    kind: 'safety',
    audience: 'organization_unit',
    organizationUnitId,
    effectiveFrom: '2024-01-01',
    recurrenceMonths: 12,
    dueWithinDays: 30,
  });

  return rule.mandatoryRuleId ?? '';
};

/** Somebody enrolled on a published course. Returns the enrolment at version 1. */
export const anEnrolment = async (
  application: INestApplication,
  employmentId: string,
  courseId: string,
): Promise<string> => {
  const enrolment = await post(application, `${BASE}/enrolments`, { employmentId, courseId });

  return enrolment.enrolmentId ?? '';
};
