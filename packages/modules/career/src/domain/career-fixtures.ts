import type { CareerResult } from './career-rejection.js';
import type { DevelopmentItemState, DevelopmentPlanState } from './development.js';
import type { CareerPathState } from './path.js';
import type { TalentPoolState } from './pool.js';
import type { SuccessionPlanState, SuccessorState } from './succession.js';

/**
 * The states the domain suites start from, and the two helpers that read a result.
 *
 * Built as literals rather than by calling the factories, deliberately: a fixture that went through
 * `createPool` would make every test depend on `createPool` being correct, and a test of
 * `addToPool` would fail for a reason in a different file. Where a suite is testing a factory it
 * calls it directly; where it needs *a pool that exists*, it takes one from here.
 */

/** The value, or a failure that names the refusal rather than an undefined three assertions later. */
export const assertAccepted = <TValue>(result: CareerResult<TValue>): TValue => {
  if (!result.ok) throw new Error(`Expected acceptance, got: ${result.error.reason}`);
  return result.value;
};

/** The refusal reason, or `accepted` — so a test can assert which rule refused. */
export const reasonOf = (result: CareerResult<unknown>): string =>
  result.ok ? 'accepted' : result.error.reason;

const NAME = { en: 'Leadership', ar: 'القيادة' };

export const aPath = (overrides: Partial<CareerPathState> = {}): CareerPathState => ({
  pathId: 'path-1',
  code: 'leadership',
  name: NAME,
  kind: 'leadership',
  status: 'draft',
  effectiveFrom: '2026-01-01',
  version: 1,
  ...overrides,
});

export const aPool = (overrides: Partial<TalentPoolState> = {}): TalentPoolState => ({
  talentPoolId: 'pool-1',
  code: 'leadership',
  name: NAME,
  kind: 'leadership',
  status: 'active',
  version: 1,
  ...overrides,
});

export const aSuccessionPlan = (
  overrides: Partial<SuccessionPlanState> = {},
): SuccessionPlanState => ({
  successionPlanId: 'succession-1',
  positionId: 'position-1',
  status: 'draft',
  version: 1,
  ...overrides,
});

export const aSuccessor = (overrides: Partial<SuccessorState> = {}): SuccessorState => ({
  successorId: 'successor-1',
  successionPlanId: 'succession-1',
  employmentId: 'employment-1',
  status: 'nominated',
  nominatedOn: '2026-08-01',
  nominatedBy: 'user:hr',
  version: 1,
  ...overrides,
});

export const aPlan = (overrides: Partial<DevelopmentPlanState> = {}): DevelopmentPlanState => ({
  developmentPlanId: 'development-1',
  employmentId: 'employment-1',
  status: 'draft',
  startedOn: '2026-01-01',
  version: 1,
  ...overrides,
});

export const anItem = (overrides: Partial<DevelopmentItemState> = {}): DevelopmentItemState => ({
  developmentItemId: 'item-1',
  developmentPlanId: 'development-1',
  category: 'experience',
  kind: 'project',
  title: 'Lead the Riyadh integration',
  status: 'planned',
  version: 1,
  ...overrides,
});
