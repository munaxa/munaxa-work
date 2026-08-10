import { describe, expect, it } from 'vitest';

import { CompensationPlan } from './compensation-plan.js';
import { CompensationComponent, chainIsCircular } from './compensation-component.js';
import { payGrade, salaryStructure } from './salary-structure.js';
import { payScale, salaryStep } from './pay-scale.js';
import { planAssignment, resolvePlan } from './plan-assignment.js';
import { checkedMoney, moneyView, resolvePercentage, sameCurrency } from './money-amount.js';
import type { CompensationResult } from './compensation-rejection.js';

/**
 * Money, and the configuration that constrains it: plans, components and the salary hierarchy.
 *
 * The property exercised hardest here is that **money stays exact** — on a three-decimal currency,
 * above 2^53, and under every rounding mode a component may state.
 */

const AT = new Date('2026-06-15T09:00:00Z');
const TENANT = '11111111-1111-7111-8111-111111111111';
const EMPLOYMENT = '22222222-2222-7222-8222-222222222222';
const COMPONENT = '33333333-3333-7333-8333-333333333333';
const PLAN = '44444444-4444-7444-8444-444444444444';

const unwrap = <TValue>(result: CompensationResult<TValue>): TValue => {
  if (!result.ok) throw new Error(`Refused: ${result.error.reason}`);
  return result.value;
};

const refusal = <TValue>(result: CompensationResult<TValue>): string => {
  if (result.ok) throw new Error('Expected a refusal.');
  return result.error.reason;
};

const jod = (minor: string) => ({ amountMinor: minor, currencyCode: 'JOD', currencyExponent: 3 });
const sar = (minor: string) => ({ amountMinor: minor, currencyCode: 'SAR', currencyExponent: 2 });

describe('money', () => {
  it('keeps a three-decimal currency exact', () => {
    const amount = unwrap(checkedMoney(jod('1234567'), 'amount'));

    expect(amount.amountMinor).toBe(1_234_567n);
    expect(moneyView(amount).amount).toBe('1234.567');
  });

  it('keeps an amount above 2^53 exact', () => {
    const huge = '90071992547409910';
    const amount = unwrap(checkedMoney({ ...jod(huge) }, 'amount'));

    // The number that would round if it ever passed through a JavaScript `number`.
    expect(amount.amountMinor.toString()).toBe(huge);
    expect(moneyView(amount).amountMinor).toBe(huge);
  });

  it('refuses an amount that is not whole minor units', () => {
    expect(refusal(checkedMoney({ ...jod('12.34') }, 'amount'))).toBe('amount_malformed');
  });

  it('refuses an empty amount rather than reading it as zero', () => {
    expect(refusal(checkedMoney({ ...jod('') }, 'amount'))).toBe('amount_malformed');
  });

  it('refuses an implausible exponent', () => {
    expect(
      refusal(checkedMoney({ amountMinor: '1', currencyCode: 'JOD', currencyExponent: 9 }, 'a')),
    ).toBe('currency_exponent_implausible');
  });

  it('does not treat two currencies as comparable', () => {
    expect(
      sameCurrency(unwrap(checkedMoney(jod('1'), 'a')), unwrap(checkedMoney(sar('1'), 'b'))),
    ).toBe(false);
  });
});

describe('percentage resolution', () => {
  const basis = { amountMinor: 1_000_000n, currencyCode: 'JOD', currencyExponent: 3 };

  it('resolves 40% exactly', () => {
    expect(unwrap(resolvePercentage(basis, 4000, 'half-up')).amountMinor).toBe(400_000n);
  });

  it('applies the stated rounding mode, and the modes differ', () => {
    const odd = { amountMinor: 5n, currencyCode: 'JOD', currencyExponent: 3 };

    expect(unwrap(resolvePercentage(odd, 5000, 'half-up')).amountMinor).toBe(3n);
    expect(unwrap(resolvePercentage(odd, 5000, 'half-even')).amountMinor).toBe(2n);
    expect(unwrap(resolvePercentage(odd, 5000, 'down')).amountMinor).toBe(2n);
    expect(unwrap(resolvePercentage(odd, 5000, 'up')).amountMinor).toBe(3n);
  });

  it('resolves in the currency of the basis, converting nothing', () => {
    expect(unwrap(resolvePercentage(basis, 4000, 'half-up')).currencyCode).toBe('JOD');
  });

  it('refuses implausible basis points', () => {
    expect(refusal(resolvePercentage(basis, -1, 'half-up'))).toBe('basis_points_out_of_range');
  });
});

describe('compensation plan', () => {
  const define = (overrides: Record<string, unknown> = {}) =>
    CompensationPlan.define(
      {
        tenantId: TENANT,
        code: 'standard',
        name: { en: 'Standard', ar: 'قياسي' },
        defaultCurrencyCode: 'JOD',
        defaultCurrencyExponent: 3,
        ...overrides,
      },
      AT,
    );

  it('drafts, then publishes', () => {
    const plan = unwrap(define());

    expect(plan.status).toBe('draft');
    expect(unwrap(plan.publish('user:hr', AT)).status).toBe('published');
  });

  it('refuses to publish twice — a published version is frozen', () => {
    const plan = unwrap(define());

    unwrap(plan.publish('user:hr', AT));
    expect(refusal(plan.publish('user:hr', AT))).toBe('plan_not_draft');
  });

  it('requires both languages', () => {
    expect(refusal(define({ name: { en: 'Standard', ar: '' } }))).toBe(
      'text_requires_both_languages',
    );
  });

  it('refuses a plan that requires approval and names no approver', () => {
    expect(refusal(define({ approvalRequired: true, approvalsRequired: 0 }))).toBe(
      'plan_requires_an_approver',
    );
  });

  it('defaults self-approval to refused', () => {
    expect(unwrap(define()).snapshot().selfApprovalPermitted).toBe(false);
  });

  it('refuses a country pack without a version', () => {
    expect(refusal(define({ countryPackId: 'jo-labour' }))).toBe('country_pack_version_required');
  });
});

describe('compensation component', () => {
  const define = (overrides: Record<string, unknown> = {}) =>
    CompensationComponent.define(
      {
        tenantId: TENANT,
        code: 'basic',
        name: { en: 'Basic', ar: 'أساسي' },
        kind: 'base',
        calculationBasis: 'fixed_amount',
        roundingMode: 'half-up',
        payrollTreatmentCode: 'ordinary',
        ...overrides,
      },
      AT,
    );

  it('refuses `deduction` as a kind — it is out of scope for this phase', () => {
    expect(refusal(define({ kind: 'deduction' }))).toBe('component_kind_unknown');
  });

  it('refuses a percentage that names no basis', () => {
    expect(refusal(define({ calculationBasis: 'percentage_of_component' }))).toBe(
      'percentage_requires_a_basis',
    );
  });

  it('refuses a fixed amount that carries a basis', () => {
    expect(refusal(define({ basisComponentId: COMPONENT, percentageBasisPoints: 4000 }))).toBe(
      'fixed_amount_takes_no_basis',
    );
  });

  it('refuses a kind and a recurrence that disagree', () => {
    expect(refusal(define({ kind: 'one_time', recurrence: 'recurring' }))).toBe(
      'component_recurrence_disagrees_with_kind',
    );
  });

  it('refuses a rounding mode it does not know, rather than defaulting one', () => {
    expect(refusal(define({ roundingMode: 'bankers' }))).toBe('rounding_mode_unknown');
  });

  it('detects a circular percentage chain', () => {
    const chain = [
      { id: 'a', basisComponentId: 'b' },
      { id: 'b', basisComponentId: 'a' },
    ];

    expect(chainIsCircular({ id: 'c', basisComponentId: 'a' }, chain)).toBe(true);
    expect(chainIsCircular({ id: 'c' }, chain)).toBe(false);
  });

  it('does not call an acyclic chain circular', () => {
    const chain = [{ id: 'a' }];

    expect(chainIsCircular({ id: 'b', basisComponentId: 'a' }, chain)).toBe(false);
  });
});

describe('salary hierarchy', () => {
  const range = { minimum: jod('500000'), midpoint: jod('750000'), maximum: jod('1000000') };

  it('accepts a structure with no grades — every level is optional', () => {
    const structure = unwrap(
      salaryStructure(
        {
          tenantId: TENANT,
          code: 'main',
          name: { en: 'Main', ar: 'رئيسي' },
          effectiveFrom: '2026-01-01',
        },
        AT,
      ),
    );

    expect(structure.status).toBe('draft');
  });

  it('accepts a grade with no structure', () => {
    const grade = unwrap(
      payGrade(
        {
          tenantId: TENANT,
          code: 'c',
          name: { en: 'C', ar: 'ج' },
          range,
          effectiveFrom: '2026-01-01',
        },
        AT,
      ),
    );

    expect(grade.salaryStructureId).toBeUndefined();
    expect(grade.range.midpoint.amountMinor).toBe(750_000n);
  });

  it('refuses a grade whose midpoint sits outside its own range', () => {
    expect(
      refusal(
        payGrade(
          {
            tenantId: TENANT,
            code: 'c',
            name: { en: 'C', ar: 'ج' },
            range: { minimum: jod('500000'), midpoint: jod('100000'), maximum: jod('900000') },
            effectiveFrom: '2026-01-01',
          },
          AT,
        ),
      ),
    ).toBe('range_out_of_order');
  });

  it('refuses a range whose bounds are in different currencies', () => {
    expect(
      refusal(
        payGrade(
          {
            tenantId: TENANT,
            code: 'c',
            name: { en: 'C', ar: 'ج' },
            range: { minimum: jod('1'), midpoint: jod('2'), maximum: sar('3') },
            effectiveFrom: '2026-01-01',
          },
          AT,
        ),
      ),
    ).toBe('range_currencies_differ');
  });

  it('keeps a progression model as a code and acts on none of it', () => {
    const scale = unwrap(
      payScale(
        {
          tenantId: TENANT,
          payGradeId: PLAN,
          code: 'c1',
          name: { en: 'C1', ar: 'ج١' },
          range,
          progressionModel: 'annual',
          effectiveFrom: '2026-01-01',
        },
        AT,
      ),
    );

    expect(scale.progressionModel).toBe('annual');
  });

  it('refuses a step with two parents, and one with none', () => {
    const base = { tenantId: TENANT, stepNumber: 1, amount: jod('1'), effectiveFrom: '2026-01-01' };

    expect(refusal(salaryStep({ ...base, payScaleId: PLAN, payGradeId: PLAN }, AT))).toBe(
      'step_requires_exactly_one_parent',
    );
    expect(refusal(salaryStep(base, AT))).toBe('step_requires_exactly_one_parent');
  });
});

describe('plan assignment', () => {
  const assignment = (scope: string, scopeId: string | undefined, planId: string) =>
    unwrap(
      planAssignment(
        {
          tenantId: TENANT,
          compensationPlanId: planId,
          scope,
          effectiveFrom: '2026-01-01',
          ...(scopeId === undefined ? {} : { scopeId }),
        },
        AT,
      ),
    );

  const subject = { employmentId: EMPLOYMENT, unitId: 'unit-1', legalEntityId: 'entity-1' };

  it('resolves the most specific scope', () => {
    const resolved = unwrap(
      resolvePlan(
        [assignment('tenant', undefined, 'plan-t'), assignment('unit', 'unit-1', 'plan-u')],
        subject,
        '2026-06-01',
      ),
    );

    expect(resolved?.compensationPlanId).toBe('plan-u');
  });

  it('refuses a tie rather than breaking it', () => {
    expect(
      refusal(
        resolvePlan(
          [assignment('unit', 'unit-1', 'plan-a'), assignment('unit', 'unit-1', 'plan-b')],
          subject,
          '2026-06-01',
        ),
      ),
    ).toBe('plan_assignment_ambiguous');
  });

  it('answers "none configured" rather than inventing one', () => {
    expect(unwrap(resolvePlan([], subject, '2026-06-01'))).toBeUndefined();
  });

  it('refuses a tenant scope that names somebody', () => {
    expect(
      refusal(
        planAssignment(
          {
            tenantId: TENANT,
            compensationPlanId: PLAN,
            scope: 'tenant',
            scopeId: 'unit-1',
            effectiveFrom: '2026-01-01',
          },
          AT,
        ),
      ),
    ).toBe('scope_id_disagrees_with_scope');
  });
});
