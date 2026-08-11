import { describe, expect, it } from 'vitest';
import {
  defineRatingScale,
  retireRatingScale,
  type DefineRatingLevelRequest,
} from './rating-scale.js';
import { defineCompetency, defineFramework } from './competency-framework.js';
import { defineTemplate } from './review-template.js';

/**
 * Configuration: the rating scale, the competency framework and the review template.
 *
 * Every rule asserted here is about a *set* of rows — levels that tile a scale, competency scores
 * that rise with their ordinals, component weights that total 10,000 — and none of them can be a
 * check constraint, because a constraint cannot see the sibling rows. This file is the first of the
 * three places each of those rules is enforced.
 */

const NAME = { en: 'Annual', ar: 'سنوي' };

const day = (iso: string): Date => new Date(iso);

describe('the rating scale', () => {
  const levels: readonly DefineRatingLevelRequest[] = [
    {
      ratingLevelId: 'l1',
      code: 'needs-improvement',
      name: NAME,
      ordinal: 1,
      minimumScore: 100,
      maximumScore: 249,
    },
    {
      ratingLevelId: 'l2',
      code: 'meets',
      name: NAME,
      ordinal: 2,
      minimumScore: 250,
      maximumScore: 399,
    },
    {
      ratingLevelId: 'l3',
      code: 'exceeds',
      name: NAME,
      ordinal: 3,
      minimumScore: 400,
      maximumScore: 500,
    },
  ];
  /** The same three bands with one of them moved, so a gap and an overlap differ by one number. */
  const startingAt = (ordinal: number, minimumScore: number): readonly DefineRatingLevelRequest[] =>
    levels.map((level) => (level.ordinal === ordinal ? { ...level, minimumScore } : level));
  const request = {
    ratingScaleId: 'scale-1',
    code: 'annual-1-5',
    name: NAME,
    minimumScore: 100,
    maximumScore: 500,
    effectiveFrom: day('2026-01-01'),
    levels,
  };

  it('accepts levels that tile the scale exactly', () => {
    const defined = defineRatingScale(request);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    expect(defined.value.levels.map((level) => level.ordinal)).toEqual([1, 2, 3]);
    expect(defined.value.scale.active).toBe(true);
  });

  it('refuses a gap between two bands', () => {
    const gapped = defineRatingScale({ ...request, levels: startingAt(2, 300) });

    expect(gapped.ok).toBe(false);
    // A gap would leave a legitimate score corresponding to no rating at all, and the review that
    // produced it could not be told to anybody.
    if (!gapped.ok) expect(gapped.error.reason).toBe('rating-scale-levels-not-contiguous');
  });

  it('refuses an overlap as readily as a gap', () => {
    const overlapping = defineRatingScale({ ...request, levels: startingAt(2, 200) });

    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok)
      expect(overlapping.error.reason).toBe('rating-scale-levels-not-contiguous');
  });

  it('refuses levels that do not reach the ends of the scale', () => {
    const short = defineRatingScale({
      ...request,
      levels: levels.filter((level) => level.ordinal < 3),
    });

    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.reason).toBe('rating-scale-levels-do-not-span');
  });

  it('retires a scale without touching anything already rated against it', () => {
    const defined = defineRatingScale(request);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    const retired = retireRatingScale(defined.value.scale, day('2026-12-31'));

    expect(retired.ok).toBe(true);
    if (!retired.ok) return;

    expect(retired.value.active).toBe(false);
    expect(retired.value.effectiveTo).toEqual(day('2026-12-31'));
    expect(retireRatingScale(retired.value, day('2027-01-01')).ok).toBe(false);
  });
});

describe('the competency framework', () => {
  const framework = (weighted: boolean) =>
    defineFramework({
      frameworkId: 'framework-1',
      code: 'core',
      frameworkVersion: 1,
      name: NAME,
      weighted,
      effectiveFrom: day('2026-01-01'),
    });
  const competency = {
    competencyId: 'competency-1',
    code: 'collaboration',
    name: NAME,
    category: 'core',
    displayOrder: 1,
    levels: [
      { competencyLevelId: 'cl-1', ordinal: 1, name: NAME, score: 100 },
      { competencyLevelId: 'cl-2', ordinal: 2, name: NAME, score: 300 },
    ],
  };

  it('invents no weight for a framework that carries none', () => {
    const defined = framework(false);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    const unweighted = defineCompetency(defined.value, competency);

    expect(unweighted.ok).toBe(true);
    if (!unweighted.ok) return;

    // The third approved scoring decision, at the point of configuration: there is no weight, so
    // there is no number for an aggregate to mistake for one.
    expect(unweighted.value.competency.weightBasisPoints).toBeUndefined();

    const supplied = defineCompetency(defined.value, { ...competency, weightBasisPoints: 5000 });

    expect(supplied.ok).toBe(false);
    if (!supplied.ok) expect(supplied.error.reason).toBe('competency-weight-not-permitted');
  });

  it('requires a weight where the framework says it has them', () => {
    const defined = framework(true);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    const missing = defineCompetency(defined.value, competency);

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.reason).toBe('competency-weight-required');
  });

  it('refuses levels whose scores do not rise with their ordinals', () => {
    const defined = framework(false);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    const inverted = defineCompetency(defined.value, {
      ...competency,
      levels: [
        { competencyLevelId: 'cl-1', ordinal: 1, name: NAME, score: 300 },
        { competencyLevelId: 'cl-2', ordinal: 2, name: NAME, score: 100 },
      ],
    });

    expect(inverted.ok).toBe(false);
    // A framework whose "outstanding" scores below its "developing" would rate somebody down for
    // doing better, and nothing at assessment time could recover from it.
    if (!inverted.ok) expect(inverted.error.reason).toBe('competency-levels-not-ascending');
  });
});

describe('the review template', () => {
  const request = {
    templateId: 'template-1',
    code: 'annual',
    name: NAME,
    ratingScaleId: 'scale-1',
    competencyFrameworkId: 'framework-1',
    requiresSelfAssessment: true,
    requiresPeerAssessment: false,
    requiresCalibration: true,
    goalWeightTotalBasisPoints: 10_000,
    components: [
      { templateComponentId: 'tc-1', component: 'goals', weightBasisPoints: 6000 },
      { templateComponentId: 'tc-2', component: 'competencies', weightBasisPoints: 4000 },
    ],
  };

  it('accepts components that total 10,000', () => {
    const defined = defineTemplate(request);

    expect(defined.ok).toBe(true);
    if (!defined.ok) return;

    expect(defined.value.components).toHaveLength(2);
  });

  it('refuses components that do not', () => {
    const defined = defineTemplate({
      ...request,
      components: [
        { templateComponentId: 'tc-1', component: 'goals', weightBasisPoints: 6000 },
        { templateComponentId: 'tc-2', component: 'competencies', weightBasisPoints: 3000 },
      ],
    });

    expect(defined.ok).toBe(false);
    if (!defined.ok) {
      // The first approved scoring decision. No check constraint can see across rows, so this is
      // the first of the three places the rule is enforced.
      expect(defined.error.reason).toBe('review-template-component-weights-not-total');
      expect(defined.error.detail).toEqual({ total: '9000', required: '10000' });
    }
  });

  it('refuses a weighted competency component with no framework behind it', () => {
    const { competencyFrameworkId: _omitted, ...without } = request;
    const defined = defineTemplate(without);

    expect(defined.ok).toBe(false);
    if (!defined.ok)
      expect(defined.error.reason).toBe('review-template-competencies-without-framework');
  });

  it('refuses peer assessment with no minimum response count', () => {
    const defined = defineTemplate({ ...request, requiresPeerAssessment: true });

    expect(defined.ok).toBe(false);
    if (!defined.ok) expect(defined.error.reason).toBe('review-template-peer-minimum-required');
  });
});
