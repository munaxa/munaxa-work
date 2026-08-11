import type { INestApplication } from '@nestjs/common';

import { http } from './performance-api.fixture.js';

/**
 * The configuration and the cycle every Performance API suite starts from, driven **entirely over
 * HTTP**.
 *
 * Nothing here inserts a row. Each step is a real request through the real controller, the real
 * validation pipe and the real repositories, so a suite that reaches an interesting state has
 * already proved that the ordinary path to it works. Seeding directly would let a security test
 * pass against a database state no client could ever have produced.
 */

/** The global prefix and version the application setup applies. Written once, not per request. */
export const BASE = '/api/v1/performance';

export const NAME = { en: 'Annual', ar: 'سنوي' };

export interface Configured {
  readonly ratingScaleId: string;
  readonly templateId: string;
  readonly competencyIds: readonly string[];
  readonly meetsLevelId: string;
  readonly cycleId: string;
}

interface Identified {
  readonly ratingScaleId?: string;
  readonly frameworkId?: string;
  readonly competencyId?: string;
  readonly templateId?: string;
  readonly cycleId?: string;
  readonly goalId?: string;
  readonly reviewId?: string;
  readonly assessmentId?: string;
  readonly calibrationSessionId?: string;
  readonly feedbackId?: string;
  readonly reviewerAssignmentId?: string;
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

const scaleLevels = [
  { code: 'needs-improvement', name: NAME, ordinal: 1, minimumScore: 100, maximumScore: 199 },
  { code: 'developing', name: NAME, ordinal: 2, minimumScore: 200, maximumScore: 299 },
  { code: 'meets', name: NAME, ordinal: 3, minimumScore: 300, maximumScore: 399 },
  { code: 'exceeds', name: NAME, ordinal: 4, minimumScore: 400, maximumScore: 500 },
];

interface ScaleListing {
  readonly items: readonly {
    readonly ratingScaleId: string;
    readonly levels: readonly { readonly ratingLevelId: string; readonly ordinal: number }[];
  }[];
}

const competenciesOf = async (
  application: INestApplication,
  frameworkId: string,
): Promise<readonly string[]> => {
  const ids: string[] = [];

  for (const [index, code] of ['collaboration', 'delivery'].entries()) {
    const competency = await post(application, `${BASE}/frameworks/${frameworkId}/competencies`, {
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

    ids.push(competency.competencyId ?? '');
  }
  return ids;
};

interface Vocabulary {
  readonly ratingScaleId: string;
  readonly frameworkId: string;
  readonly competencyIds: readonly string[];
}

/** The scale and the framework, which the template then names. */
const vocabularyOf = async (application: INestApplication): Promise<Vocabulary> => {
  const scale = await post(application, `${BASE}/rating-scales`, {
    code: 'annual-1-5',
    name: NAME,
    minimumScore: 100,
    maximumScore: 500,
    effectiveFrom: '2026-01-01',
    levels: scaleLevels,
  });
  const framework = await post(application, `${BASE}/frameworks`, {
    code: 'core',
    frameworkVersion: 1,
    name: NAME,
    weighted: false,
    effectiveFrom: '2026-01-01',
  });

  return {
    ratingScaleId: scale.ratingScaleId ?? '',
    frameworkId: framework.frameworkId ?? '',
    competencyIds: await competenciesOf(application, framework.frameworkId ?? ''),
  };
};

/** A scale, a framework, two competencies, a weighted template, and an open cycle. */
export const configure = async (application: INestApplication): Promise<Configured> => {
  const vocabulary = await vocabularyOf(application);
  const template = await post(application, `${BASE}/templates`, {
    code: 'annual',
    name: NAME,
    ratingScaleId: vocabulary.ratingScaleId,
    competencyFrameworkId: vocabulary.frameworkId,
    requiresSelfAssessment: true,
    requiresPeerAssessment: false,
    requiresCalibration: false,
    goalWeightTotalBasisPoints: 10_000,
    components: [
      { component: 'goals', weightBasisPoints: 6000 },
      { component: 'competencies', weightBasisPoints: 4000 },
    ],
  });
  const cycle = await post(application, `${BASE}/cycles`, {
    code: 'annual-2026',
    name: NAME,
    reviewTemplateId: template.templateId ?? '',
    kind: 'annual',
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
  });

  await post(application, `${BASE}/cycles/${cycle.cycleId ?? ''}/status`, {
    expectedVersion: 1,
    status: 'open',
  });

  const listing = (await http(application).get(`${BASE}/rating-scales`).expect(200))
    .body as ScaleListing;

  return {
    ratingScaleId: vocabulary.ratingScaleId,
    templateId: template.templateId ?? '',
    competencyIds: vocabulary.competencyIds,
    meetsLevelId:
      listing.items[0]?.levels.find((level) => level.ordinal === 3)?.ratingLevelId ?? '',
    cycleId: cycle.cycleId ?? '',
  };
};

/** Enrol one employment and return the review it produced. */
export const enrol = async (
  application: INestApplication,
  cycleId: string,
  employmentId: string,
): Promise<string> => {
  await post(application, `${BASE}/cycles/${cycleId}/participants`, {
    employmentIds: [employmentId],
  });

  const listing = (await http(application).get(`${BASE}/reviews?cycleId=${cycleId}`).expect(200))
    .body as { readonly items: readonly { readonly reviewId: string }[] };

  return listing.items[0]?.reviewId ?? '';
};
