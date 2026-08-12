import { uuidV7 } from '@work/kernel';

import { HR, send, type Harness } from './learning-test-harness.js';

/**
 * The setup every application suite needs, written once.
 *
 * Each helper goes through the **real dispatcher and the real handlers**, never straight into a
 * store. A fixture that seeded a row directly would set up states the commands cannot produce, and
 * the suite would then be testing a situation this product cannot reach.
 */

export const EMPLOYMENT = uuidV7();
export const OTHER_EMPLOYMENT = uuidV7();
export const UNIT = uuidV7();
export const POSITION = uuidV7();

/** Registers the employments the suites act on. Employment answers only for what is registered. */
export const withWorkforce = (harness: Harness): void => {
  harness.employment.add({
    employmentId: EMPLOYMENT,
    status: 'active',
    active: true,
    organizationUnitId: UNIT,
    positionId: POSITION,
  });
  harness.employment.add({
    employmentId: OTHER_EMPLOYMENT,
    status: 'active',
    active: true,
    organizationUnitId: UNIT,
  });
  harness.organization.add(UNIT);
};

export interface PublishedCourse {
  readonly courseId: string;
  readonly courseVersionId: string;
  /** The course's optimistic version after publication, for a caller that wants to move it again. */
  readonly version: number;
}

export interface CourseOptions {
  readonly code?: string;
  readonly requiresAssessment?: boolean;
  readonly certificationValidMonths?: number;
}

/** A course with one published version — the shape everything downstream needs. */
export const aPublishedCourse = async (
  harness: Harness,
  options: CourseOptions = {},
): Promise<PublishedCourse> => {
  const { courseId } = await send<{ courseId: string }>(harness, {
    commandName: 'learning.create-course',
    code: options.code ?? 'fire-safety',
    name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
    delivery: 'classroom',
  });
  const published = await send<{ courseVersionId: string }>(harness, {
    commandName: 'learning.publish-course-version',
    courseId,
    expectedVersion: 1,
    title: { en: 'Fire safety v1', ar: 'السلامة من الحرائق ١' },
    requiresAssessment: options.requiresAssessment ?? false,
    ...(options.certificationValidMonths === undefined
      ? {}
      : { certificationValidMonths: options.certificationValidMonths }),
  });

  return { courseId, courseVersionId: published.courseVersionId, version: 2 };
};

export interface RuleOptions {
  readonly audience?: 'everybody' | 'organization_unit' | 'position';
  readonly organizationUnitId?: string;
  readonly positionId?: string;
  readonly effectiveFrom?: string;
  readonly recurrenceMonths?: number;
  readonly dueWithinDays?: number;
}

export const aMandatoryRule = async (
  harness: Harness,
  courseId: string,
  options: RuleOptions = {},
): Promise<string> => {
  const { mandatoryRuleId } = await send<{ mandatoryRuleId: string }>(harness, {
    commandName: 'learning.define-mandatory-rule',
    courseId,
    name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
    kind: 'safety',
    audience: options.audience ?? 'everybody',
    effectiveFrom: options.effectiveFrom ?? '2024-01-01',
    recurrenceMonths: options.recurrenceMonths ?? 12,
    dueWithinDays: options.dueWithinDays ?? 30,
    ...(options.organizationUnitId === undefined
      ? {}
      : { organizationUnitId: options.organizationUnitId }),
    ...(options.positionId === undefined ? {} : { positionId: options.positionId }),
  });

  return mandatoryRuleId;
};

export interface CompletedCourse extends PublishedCourse {
  readonly enrolmentId: string;
}

/**
 * Somebody enrolled, started and completed — through the commands, in order.
 *
 * Deliberately not a seeded row: the lifecycle is what makes a completion mean anything, and a
 * fixture that skipped it would let a suite assert on a state no caller can reach.
 */
export const aCompletedCourse = async (
  harness: Harness,
  course: PublishedCourse,
  completedOn: string,
  employmentId: string = EMPLOYMENT,
): Promise<CompletedCourse> => {
  const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
    commandName: 'learning.enrol',
    employmentId,
    courseId: course.courseId,
  });

  await send(harness, {
    commandName: 'learning.start-enrolment',
    enrolmentId,
    expectedVersion: 1,
  });
  await send(harness, {
    commandName: 'learning.complete-enrolment',
    enrolmentId,
    expectedVersion: 2,
    completedOn,
  });

  return { ...course, enrolmentId };
};

/** Runs the reconciliation command as HR, which is what an administrator pressing the button does. */
export const reconcile = (
  harness: Harness,
  mandatoryRuleId: string,
  limit?: number,
): Promise<{
  readonly generated: number;
  readonly alreadyPresent: number;
  readonly notDue: number;
  readonly examined: number;
  readonly more: boolean;
}> =>
  harness.as(HR, () =>
    send(harness, {
      commandName: 'learning.reconcile-requirements',
      mandatoryRuleId,
      ...(limit === undefined ? {} : { limit }),
    }),
  );
