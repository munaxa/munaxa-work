import { send, type Harness } from './performance-test-harness.js';

/**
 * The setup every application suite shares, built **through the real commands** rather than by
 * writing rows.
 *
 * That is the point of it. A scenario that seeded the stores directly would prove the queries work
 * against data no command could have produced, and every invariant between here and the database
 * would go unexercised. Everything below goes through the dispatcher, the permission check and the
 * handlers, exactly as an administrator would.
 */

export const NAME = { en: 'Annual', ar: 'سنوي' };

export const MANAGER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e001';
export const EMPLOYEE_EMPLOYMENT = '01930000-0000-7000-8000-00000000e002';
export const PEER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e003';
export const OUTSIDER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e004';
export const DIRECTOR_EMPLOYMENT = '01930000-0000-7000-8000-00000000e005';
export const UNIT = '01930000-0000-7000-8000-00000000u001';
export const LEGAL_ENTITY = '01930000-0000-7000-8000-00000000l001';

/** A 1–5 scale in hundredths, with four contiguous bands. */
export const SCALE_LEVELS = [
  { code: 'needs-improvement', name: NAME, ordinal: 1, minimumScore: 100, maximumScore: 199 },
  { code: 'developing', name: NAME, ordinal: 2, minimumScore: 200, maximumScore: 299 },
  { code: 'meets', name: NAME, ordinal: 3, minimumScore: 300, maximumScore: 399 },
  { code: 'exceeds', name: NAME, ordinal: 4, minimumScore: 400, maximumScore: 500 },
];

export interface Configured {
  readonly ratingScaleId: string;
  readonly frameworkId: string;
  readonly competencyIds: readonly string[];
  readonly templateId: string;
}

export interface ConfigureOptions {
  readonly weightedFramework?: boolean;
  readonly goalWeight?: number;
  readonly competencyWeight?: number;
  readonly requiresCalibration?: boolean;
  readonly requiresPeerAssessment?: boolean;
  readonly minimumPeerResponses?: number;
  readonly goalWeightTotalBasisPoints?: number;
}

/** Registers the employments this module reads through Employment's published contract. */
export const registerWorkforce = (harness: Harness): void => {
  harness.employment.add({
    employmentId: MANAGER_EMPLOYMENT,
    status: 'active',
    active: true,
    managerEmploymentId: DIRECTOR_EMPLOYMENT,
    organizationUnitId: UNIT,
  });
  harness.employment.add({
    employmentId: EMPLOYEE_EMPLOYMENT,
    status: 'active',
    active: true,
    managerEmploymentId: MANAGER_EMPLOYMENT,
    organizationUnitId: UNIT,
    positionId: '01930000-0000-7000-8000-00000000p001',
  });
  harness.employment.add({
    employmentId: PEER_EMPLOYMENT,
    status: 'active',
    active: true,
    managerEmploymentId: MANAGER_EMPLOYMENT,
    organizationUnitId: UNIT,
  });
  harness.employment.add({
    employmentId: OUTSIDER_EMPLOYMENT,
    status: 'active',
    active: true,
    managerEmploymentId: DIRECTOR_EMPLOYMENT,
    organizationUnitId: '01930000-0000-7000-8000-00000000u002',
  });
  harness.employment.add({
    employmentId: DIRECTOR_EMPLOYMENT,
    status: 'active',
    active: true,
    organizationUnitId: UNIT,
  });
  harness.organization.govern(UNIT, LEGAL_ENTITY);
};

const defineScale = (harness: Harness): Promise<{ readonly ratingScaleId: string }> =>
  send(harness, {
    commandName: 'performance.define-rating-scale',
    code: 'annual-1-5',
    name: NAME,
    minimumScore: 100,
    maximumScore: 500,
    effectiveFrom: new Date('2026-01-01'),
    levels: SCALE_LEVELS,
  });

const defineFrameworkWith = async (
  harness: Harness,
  options: ConfigureOptions,
): Promise<{ readonly frameworkId: string; readonly competencyIds: readonly string[] }> => {
  const framework = await send<{ readonly frameworkId: string }>(harness, {
    commandName: 'performance.define-framework',
    code: 'core',
    frameworkVersion: 1,
    name: NAME,
    weighted: options.weightedFramework ?? false,
    effectiveFrom: new Date('2026-01-01'),
  });
  const competencyIds: string[] = [];

  for (const [index, code] of ['collaboration', 'delivery'].entries()) {
    const competency = await send<{ readonly competencyId: string }>(harness, {
      commandName: 'performance.define-competency',
      frameworkId: framework.frameworkId,
      code,
      name: NAME,
      category: 'core',
      displayOrder: index + 1,
      ...(options.weightedFramework === true ? { weightBasisPoints: 5000 } : {}),
      levels: [
        { ordinal: 1, name: NAME, score: 100 },
        { ordinal: 2, name: NAME, score: 300 },
        { ordinal: 3, name: NAME, score: 500 },
      ],
    });

    competencyIds.push(competency.competencyId);
  }

  return { frameworkId: framework.frameworkId, competencyIds };
};

const defineTemplateWith = (
  harness: Harness,
  ratingScaleId: string,
  frameworkId: string,
  options: ConfigureOptions,
): Promise<{ readonly templateId: string }> =>
  send(harness, {
    commandName: 'performance.define-template',
    code: 'annual',
    name: NAME,
    ratingScaleId,
    competencyFrameworkId: frameworkId,
    requiresSelfAssessment: true,
    requiresPeerAssessment: options.requiresPeerAssessment ?? false,
    requiresCalibration: options.requiresCalibration ?? false,
    goalWeightTotalBasisPoints: options.goalWeightTotalBasisPoints ?? 10_000,
    ...(options.minimumPeerResponses === undefined
      ? {}
      : { minimumPeerResponses: options.minimumPeerResponses }),
    components: [
      { component: 'goals', weightBasisPoints: options.goalWeight ?? 6000 },
      { component: 'competencies', weightBasisPoints: options.competencyWeight ?? 4000 },
    ],
  });

export const configure = async (
  harness: Harness,
  actor: string,
  options: ConfigureOptions = {},
): Promise<Configured> =>
  harness.as(actor, async () => {
    const scale = await defineScale(harness);
    const framework = await defineFrameworkWith(harness, options);
    const template = await defineTemplateWith(
      harness,
      scale.ratingScaleId,
      framework.frameworkId,
      options,
    );

    return {
      ratingScaleId: scale.ratingScaleId,
      frameworkId: framework.frameworkId,
      competencyIds: framework.competencyIds,
      templateId: template.templateId,
    };
  });

export interface Enrolled {
  readonly cycleId: string;
  readonly reviewId: string;
}

export const openCycleWith = async (
  harness: Harness,
  actor: string,
  templateId: string,
  employmentIds: readonly string[] = [EMPLOYEE_EMPLOYMENT],
): Promise<Enrolled> =>
  harness.as(actor, async () => {
    const cycle = await send<{ readonly cycleId: string }>(harness, {
      commandName: 'performance.create-cycle',
      code: 'annual-2026',
      name: NAME,
      reviewTemplateId: templateId,
      kind: 'annual',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      selfAssessmentDue: new Date('2027-01-15'),
    });

    await send(harness, {
      commandName: 'performance.move-cycle',
      cycleId: cycle.cycleId,
      expectedVersion: 1,
      status: 'open',
    });
    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle.cycleId,
      employmentIds,
    });

    const reviews = await harness.dispatcher.ask<{
      readonly items: readonly { readonly reviewId: string; readonly employmentId: string }[];
    }>({ queryName: 'performance.reviews', cycleId: cycle.cycleId } as never);
    const first = reviews.ok
      ? reviews.value.items.find((review) => review.employmentId === EMPLOYEE_EMPLOYMENT)
      : undefined;

    if (first === undefined) throw new Error('Enrolment produced no review for the employee.');

    return { cycleId: cycle.cycleId, reviewId: first.reviewId };
  });

export interface GoalSpec {
  readonly weightBasisPoints: number;
  readonly cancel?: boolean;
}

/** Creates goals for the employee in a cycle, moving each to `active` unless it is cancelled. */
export const createGoals = async (
  harness: Harness,
  actor: string,
  cycleId: string,
  specs: readonly GoalSpec[],
): Promise<readonly string[]> =>
  harness.as(actor, async () => {
    const ids: string[] = [];

    for (const [index, spec] of specs.entries()) {
      const goal = await send<{ readonly goalId: string }>(harness, {
        commandName: 'performance.create-goal',
        scope: 'individual',
        employmentId: EMPLOYEE_EMPLOYMENT,
        cycleId,
        title: `Goal ${String(index + 1)}`,
        measurement: 'numeric',
        weightBasisPoints: spec.weightBasisPoints,
        startDate: new Date('2026-01-01'),
        dueDate: new Date('2026-12-31'),
      });

      await send(harness, {
        commandName: 'performance.approve-goal',
        goalId: goal.goalId,
        expectedVersion: 1,
      });

      if (spec.cancel === true) {
        await send(harness, {
          commandName: 'performance.close-goal',
          goalId: goal.goalId,
          expectedVersion: 2,
          outcome: 'cancelled',
          reason: 'Deprioritized',
        });
      } else {
        await send(harness, {
          commandName: 'performance.move-goal',
          goalId: goal.goalId,
          expectedVersion: 2,
          status: 'active',
        });
      }
      ids.push(goal.goalId);
    }

    return ids;
  });

/**
 * One line a suite wants recorded.
 *
 * The optional fields accept an explicit `undefined` because a suite naturally writes
 * `goals[0]` — an indexed read under `noUncheckedIndexedAccess`. The commands themselves keep the
 * repository's strict `exactOptionalPropertyTypes` shape; this is a test-support convenience and
 * goes no further than this file.
 */
export interface AssessmentLine {
  readonly goalId?: string | undefined;
  readonly competencyId?: string | undefined;
  readonly score?: number | undefined;
  readonly exclusionReason?: string | undefined;
}

/** A manager assessment, filled in and submitted, exactly as the manager screen would. */
export const submitManagerAssessment = async (
  harness: Harness,
  actor: string,
  reviewId: string,
  lines: readonly AssessmentLine[],
): Promise<string> =>
  harness.as(actor, async () => {
    const started = await send<{ readonly assessmentId: string }>(harness, {
      commandName: 'performance.start-assessment',
      reviewId,
      assessmentKind: 'manager',
      assessorEmploymentId: MANAGER_EMPLOYMENT,
    });

    for (const line of lines) {
      await send(harness, {
        commandName: 'performance.record-assessment-item',
        assessmentId: started.assessmentId,
        itemKind: line.goalId === undefined ? 'competency' : 'goal',
        ...(line.goalId === undefined ? {} : { goalId: line.goalId }),
        ...(line.competencyId === undefined ? {} : { competencyId: line.competencyId }),
        ...(line.score === undefined ? {} : { score: line.score }),
        ...(line.exclusionReason === undefined ? {} : { exclusionReason: line.exclusionReason }),
      });
    }

    await send(harness, {
      commandName: 'performance.submit-assessment',
      assessmentId: started.assessmentId,
      expectedVersion: 1,
      overallComment: 'A strong year.',
    });

    return started.assessmentId;
  });
