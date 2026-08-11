import { HR, ask, send, type CrossModuleHarness } from './phase-thirteen-harness.js';

/**
 * The configuration both Phase 13 cross-module suites start from: a rating scale, a competency
 * framework, two competencies and a template that weights goals against competencies.
 *
 * Shared rather than duplicated because the two suites must agree about it. They assert different
 * things — one follows a single employment end to end, the other probes the boundaries — but a rating
 * of 400 means what it means only if both were configured the same way, and two copies of this that
 * drifted would make the two suites' numbers quietly incomparable.
 *
 * Every step goes through the real commands on the real dispatcher against the real repositories.
 * Nothing is inserted directly.
 */

export const NAME = { en: 'Annual', ar: 'سنوي' };

export interface Configured {
  readonly ratingScaleId: string;
  readonly frameworkId: string;
  readonly templateId: string;
  readonly competencyIds: readonly string[];
  readonly meetsLevelId: string;
}

const defineScale = (harness: CrossModuleHarness): Promise<{ readonly ratingScaleId: string }> =>
  send(harness, {
    commandName: 'performance.define-rating-scale',
    code: 'annual-1-5',
    name: NAME,
    minimumScore: 100,
    maximumScore: 500,
    effectiveFrom: new Date('2026-01-01'),
    levels: [
      { code: 'needs-improvement', name: NAME, ordinal: 1, minimumScore: 100, maximumScore: 199 },
      { code: 'developing', name: NAME, ordinal: 2, minimumScore: 200, maximumScore: 299 },
      { code: 'meets', name: NAME, ordinal: 3, minimumScore: 300, maximumScore: 399 },
      { code: 'exceeds', name: NAME, ordinal: 4, minimumScore: 400, maximumScore: 500 },
    ],
  });

const defineCompetencies = async (
  harness: CrossModuleHarness,
  frameworkId: string,
): Promise<readonly string[]> => {
  const competencyIds: string[] = [];

  for (const [index, code] of ['collaboration', 'delivery'].entries()) {
    const competency = await send<{ readonly competencyId: string }>(harness, {
      commandName: 'performance.define-competency',
      frameworkId,
      code,
      name: NAME,
      category: 'core',
      displayOrder: index + 1,
      levels: [
        { ordinal: 1, name: NAME, score: 100 },
        { ordinal: 2, name: NAME, score: 300 },
        { ordinal: 3, name: NAME, score: 500 },
      ],
    });

    competencyIds.push(competency.competencyId);
  }

  return competencyIds;
};

/** The identifier of the level a 350 lands in, read back through the published query. */
const meetsLevelOf = async (harness: CrossModuleHarness): Promise<string> => {
  const scales = await ask<{
    readonly items: readonly {
      readonly levels: readonly { readonly ratingLevelId: string; readonly ordinal: number }[];
    }[];
  }>(harness, { queryName: 'performance.rating-scales' });

  return scales.items[0]?.levels.find((level) => level.ordinal === 3)?.ratingLevelId ?? '';
};

export const configure = async (harness: CrossModuleHarness): Promise<Configured> =>
  harness.as(HR, async () => {
    const scale = await defineScale(harness);
    const framework = await send<{ readonly frameworkId: string }>(harness, {
      commandName: 'performance.define-framework',
      code: 'core',
      frameworkVersion: 1,
      name: NAME,
      weighted: false,
      effectiveFrom: new Date('2026-01-01'),
    });
    const competencyIds = await defineCompetencies(harness, framework.frameworkId);
    const template = await send<{ readonly templateId: string }>(harness, {
      commandName: 'performance.define-template',
      code: 'annual',
      name: NAME,
      ratingScaleId: scale.ratingScaleId,
      competencyFrameworkId: framework.frameworkId,
      requiresSelfAssessment: true,
      requiresPeerAssessment: false,
      requiresCalibration: false,
      goalWeightTotalBasisPoints: 10_000,
      components: [
        { component: 'goals', weightBasisPoints: 6000 },
        { component: 'competencies', weightBasisPoints: 4000 },
      ],
    });

    return {
      ratingScaleId: scale.ratingScaleId,
      frameworkId: framework.frameworkId,
      templateId: template.templateId,
      competencyIds,
      meetsLevelId: await meetsLevelOf(harness),
    };
  });

/** A cycle on that template, opened — the state every review in either suite starts from. */
export const anOpenCycle = async (
  harness: CrossModuleHarness,
  templateId: string,
): Promise<string> =>
  harness.as(HR, async () => {
    const cycle = await send<{ readonly cycleId: string }>(harness, {
      commandName: 'performance.create-cycle',
      code: 'annual-2026',
      name: NAME,
      reviewTemplateId: templateId,
      kind: 'annual',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
    });

    await send(harness, {
      commandName: 'performance.move-cycle',
      cycleId: cycle.cycleId,
      expectedVersion: 1,
      status: 'open',
    });
    return cycle.cycleId;
  });
