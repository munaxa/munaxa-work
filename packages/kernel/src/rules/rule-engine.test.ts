import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';
import { isErr, unwrap } from '../result/result.js';

import { evaluateRule, versionInForce, type RuleDefinition } from './rule-engine.js';

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** A realistic shape: eligibility for annual leave, as a tenant would configure it. */
const eligibility: RuleDefinition<{ entitlementDays: number }> = {
  ruleId: 'leave.annual.eligibility',
  version: 2,
  effectiveFrom: at('2026-01-01'),
  when: {
    all: [
      { fact: 'employmentStatus', operator: 'equals', value: 'active' },
      { fact: 'serviceDays', operator: 'greaterThanOrEqual', value: 90 },
    ],
    none: [{ fact: 'employmentType', operator: 'in', value: ['intern', 'contractor'] }],
  },
  outcome: { entitlementDays: 21 },
  source: 'Labor Law article 109',
};

describe('evaluateRule', () => {
  it('matches when every condition holds', () => {
    const evaluation = unwrap(
      evaluateRule(eligibility, {
        employmentStatus: 'active',
        serviceDays: 120,
        employmentType: 'permanent',
      }),
    );

    expect(evaluation.matched).toBe(true);
    expect(evaluation.outcome).toEqual({ entitlementDays: 21 });
  });

  it('does not match when a condition fails', () => {
    const evaluation = unwrap(
      evaluateRule(eligibility, {
        employmentStatus: 'active',
        serviceDays: 45,
        employmentType: 'permanent',
      }),
    );

    expect(evaluation.matched).toBe(false);
    expect(evaluation.outcome).toBeUndefined();
  });

  it('excludes a population listed under none', () => {
    const evaluation = unwrap(
      evaluateRule(eligibility, {
        employmentStatus: 'active',
        serviceDays: 400,
        employmentType: 'contractor',
      }),
    );

    expect(evaluation.matched).toBe(false);
  });

  it('explains itself: which rule, which version, which facts, which comparisons', () => {
    const evaluation = unwrap(
      evaluateRule(eligibility, {
        employmentStatus: 'active',
        serviceDays: 120,
        employmentType: 'permanent',
      }),
    );

    expect(evaluation.ruleId).toBe('leave.annual.eligibility');
    expect(evaluation.version).toBe(2);
    expect(evaluation.source).toBe('Labor Law article 109');
    expect(evaluation.trace).toEqual([
      {
        fact: 'employmentStatus',
        operator: 'equals',
        expected: 'active',
        actual: 'active',
        satisfied: true,
      },
      {
        fact: 'serviceDays',
        operator: 'greaterThanOrEqual',
        expected: 90,
        actual: 120,
        satisfied: true,
      },
      {
        fact: 'employmentType',
        operator: 'in',
        expected: ['intern', 'contractor'],
        actual: 'permanent',
        satisfied: false,
      },
    ]);
  });

  it('refuses a missing fact rather than quietly denying the entitlement', () => {
    const result = evaluateRule(eligibility, { employmentStatus: 'active' });

    expect(isErr(result)).toBe(true);
    expect(result.ok ? undefined : result.error).toEqual({
      kind: 'missing_fact',
      fact: 'serviceDays',
    });
  });

  it('refuses to order values of different types rather than coercing them', () => {
    const rule: RuleDefinition<null> = {
      ruleId: 'probe',
      version: 1,
      effectiveFrom: at('2026-01-01'),
      when: { all: [{ fact: 'days', operator: 'greaterThan', value: 10 }] },
      outcome: null,
    };
    const result = evaluateRule(rule, { days: 'many' });

    expect(result.ok ? undefined : result.error.kind).toBe('incomparable');
  });

  it('distinguishes a null fact from a missing one', () => {
    const rule: RuleDefinition<null> = {
      ruleId: 'probe',
      version: 1,
      effectiveFrom: at('2026-01-01'),
      when: { all: [{ fact: 'terminationDate', operator: 'isNull' }] },
      outcome: null,
    };

    expect(unwrap(evaluateRule(rule, { terminationDate: null })).matched).toBe(true);
    expect(unwrap(evaluateRule(rule, {})).matched).toBe(true);
  });

  it('treats any as a disjunction', () => {
    const rule: RuleDefinition<null> = {
      ruleId: 'probe',
      version: 1,
      effectiveFrom: at('2026-01-01'),
      when: {
        any: [
          { fact: 'grade', operator: 'equals', value: 'executive' },
          { fact: 'serviceDays', operator: 'greaterThan', value: 3650 },
        ],
      },
      outcome: null,
    };

    expect(unwrap(evaluateRule(rule, { grade: 'officer', serviceDays: 4000 })).matched).toBe(true);
    expect(unwrap(evaluateRule(rule, { grade: 'officer', serviceDays: 100 })).matched).toBe(false);
  });

  it('is deterministic — the same facts give the same answer every time', () => {
    const facts = { employmentStatus: 'active', serviceDays: 120, employmentType: 'permanent' };
    const first = unwrap(evaluateRule(eligibility, facts));
    const second = unwrap(evaluateRule(eligibility, facts));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('versionInForce', () => {
  const versions: RuleDefinition<{ rate: number }>[] = [
    {
      ruleId: 'gosi.rate',
      version: 1,
      effectiveFrom: at('2020-01-01'),
      effectiveTo: at('2026-07-01'),
      when: { all: [] },
      outcome: { rate: 10 },
    },
    {
      ruleId: 'gosi.rate',
      version: 2,
      effectiveFrom: at('2026-07-01'),
      when: { all: [] },
      outcome: { rate: 11 },
    },
  ];

  it('selects by the date being calculated, not by today', () => {
    expect(versionInForce(versions, at('2026-03-15')).outcome.rate).toBe(10);
    expect(versionInForce(versions, at('2026-08-15')).outcome.rate).toBe(11);
  });

  it('reproduces a prior period after a new version is published — the re-run property', () => {
    const march = versionInForce(versions, at('2026-03-31'));

    expect(march.version).toBe(1);
    expect(march.outcome.rate).toBe(10);
  });

  it('refuses when no version covers the date', () => {
    expect(() => versionInForce(versions, at('2019-01-01'))).toThrow(DomainException);
  });

  it('refuses overlapping versions rather than picking one', () => {
    const overlapping = [
      ...versions,
      { ...versions[1], version: 3 } as RuleDefinition<{ rate: number }>,
    ];

    expect(() => versionInForce(overlapping, at('2026-08-15'))).toThrow(/in force at once/);
  });
});
