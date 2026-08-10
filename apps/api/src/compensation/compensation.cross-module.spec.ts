import 'reflect-metadata';

import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { ask, send, trySend, wire, type Wired } from './cross-module-harness.js';

/**
 * **The cross-module test.** The sequence that proves the phase across the boundary.
 *
 * Every other suite in this module uses a fake for Employment, which is right for testing a module
 * and useless for testing a *boundary*. What is asserted here is the thing no single module can
 * assert about itself:
 *
 * 1. a real Employment is created through Employment's own command;
 * 2. Compensation confirms it through the **production adapter**, under a real bounded service
 *    grant, asking `employment.read-employment` **as at the effective date**;
 * 3. a salary is assigned, amended, and read back as of two different dates;
 * 4. the payroll contract assembles from the authoritative rows for a page of employments;
 * 5. and when Employment cannot answer, **nothing is written** — and the failure is not dressed up
 *    as a business refusal.
 *
 * Step 5 is the one that matters architecturally. A compensation record is a statement about a
 * person's pay; writing one because a dependency was unreachable would be the module asserting
 * something it did not verify. The dependency points one way and Compensation pulls — nothing here
 * writes to Employment, and there is no method that could.
 */

interface Employed {
  readonly employmentId: string;
  readonly planId: string;
  readonly componentId: string;
}

const jod = (minor: string) => ({ amountMinor: minor, currencyCode: 'JOD', currencyExponent: 3 });

/** A real employment, a published plan assigned tenant-wide, and a published component. */
const configured = async (wired: Wired): Promise<Employed> => {
  const personId = wired.people.add(uuidV7(), { en: 'Rania Odeh', ar: 'رانيا عودة' });
  const created = await send<{ employmentId: string }>(wired, {
    commandName: 'employment.create-employment',
    personId,
    employmentTypeCode: 'full-time',
    startDate: '2024-01-15',
  });

  await send(wired, {
    commandName: 'employment.change-status',
    employmentId: created.employmentId,
    status: 'active',
    expectedVersion: 1,
  });

  const plan = await send<{ compensationPlanId: string }>(wired, {
    commandName: 'compensation.define-plan',
    code: 'standard',
    name: { en: 'Standard', ar: 'قياسي' },
    defaultCurrencyCode: 'JOD',
    defaultCurrencyExponent: 3,
    approvalRequired: false,
    approvalsRequired: 0,
  });

  await send(wired, {
    commandName: 'compensation.publish-plan',
    compensationPlanId: plan.compensationPlanId,
    expectedVersion: 1,
  });
  await send(wired, {
    commandName: 'compensation.assign-plan',
    compensationPlanId: plan.compensationPlanId,
    scope: 'tenant',
    effectiveFrom: '2020-01-01',
  });

  const component = await send<{ componentId: string }>(wired, {
    commandName: 'compensation.define-component',
    code: 'basic',
    name: { en: 'Basic', ar: 'أساسي' },
    kind: 'base',
    calculationBasis: 'fixed_amount',
    roundingMode: 'half-up',
    payrollTreatmentCode: 'ordinary',
  });

  await send(wired, {
    commandName: 'compensation.publish-component',
    componentId: component.componentId,
    expectedVersion: 1,
  });

  return {
    employmentId: created.employmentId,
    planId: plan.compensationPlanId,
    componentId: component.componentId,
  };
};

interface CompensationView {
  readonly components: readonly { readonly amount: { readonly amountMinor: string } }[];
  readonly totalsByCurrency: readonly { readonly currencyCode: string }[];
}

interface PeriodView {
  readonly items: readonly {
    readonly currencies: readonly {
      readonly currencyCode: string;
      readonly recurring: readonly {
        readonly payrollTreatmentCode: string;
        readonly amount: { readonly amountMinor: string };
      }[];
    }[];
    readonly inputsDigest: string;
  }[];
}

/**
 * The Phase 11 contract, asserted for what it carries **and** for what it does not.
 *
 * Apart from the sequence above because the negative assertions are the point: an amount per
 * currency, a treatment code that travelled uninterpreted, and no computed total anywhere.
 */
const assertPayrollContract = async (wired: Wired, employmentId: string): Promise<void> => {
  const period = await ask<PeriodView>(wired, {
    queryName: 'compensation.payroll-period',
    employmentIds: [employmentId],
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
  });
  const block = period.items[0]?.currencies[0];

  expect(block?.currencyCode).toBe('JOD');
  expect(block?.recurring[0]?.amount.amountMinor).toBe('1150000');
  // Travelling uninterpreted: Compensation stored this code and never read it.
  expect(block?.recurring[0]?.payrollTreatmentCode).toBe('ordinary');
  // No computed total anywhere in the contract.
  expect(JSON.stringify(period)).not.toContain('gross');
  expect(period.items[0]?.inputsDigest).toMatch(/^[0-9a-f]{8}$/);
};

describe('Compensation and Employment across the boundary', () => {
  it('confirms a real employment as at the effective date, then supersedes without rewriting', async () => {
    const wired = wire();

    await wired.as('user:hr-administrator', async () => {
      const ready = await configured(wired);

      // Assigned effective in 2025 — Employment is asked for the employment as it stood then, which
      // is why the adapter passes a date rather than reading "now".
      await send(wired, {
        commandName: 'compensation.assign-recurring',
        employmentId: ready.employmentId,
        componentId: ready.componentId,
        amount: jod('1000000'),
        effectiveFrom: '2025-01-01',
      });

      const first = await ask<{ recurringId: string }>(wired, {
        queryName: 'compensation.recurring',
        employmentId: ready.employmentId,
      }).then((page) => (page as unknown as { items: { recurringId: string }[] }).items[0]);

      await send(wired, {
        commandName: 'compensation.amend-recurring',
        recurringId: first?.recurringId,
        amount: jod('1150000'),
        effectiveFrom: '2026-01-01',
        reasonCode: 'annual-review',
        expectedVersion: 1,
      });

      const before = await ask<CompensationView>(wired, {
        queryName: 'compensation.for-employment',
        employmentId: ready.employmentId,
        asOf: '2025-06-01',
      });
      const after = await ask<CompensationView>(wired, {
        queryName: 'compensation.for-employment',
        employmentId: ready.employmentId,
        asOf: '2026-06-01',
      });

      // The superseded period kept its amount. That is the whole property.
      expect(before.components[0]?.amount.amountMinor).toBe('1000000');
      expect(after.components[0]?.amount.amountMinor).toBe('1150000');
      expect(after.totalsByCurrency).toHaveLength(1);

      await assertPayrollContract(wired, ready.employmentId);
    });
  });

  it('refuses a compensation change for an employment that started later', async () => {
    const wired = wire();

    await wired.as('user:hr-administrator', async () => {
      const ready = await configured(wired);
      // The employment starts 2024-01-15. Employment is asked as at 2023-01-01 and answers that it
      // did not exist then, so the change is refused rather than recorded against nothing.
      const refused = await trySend(wired, {
        commandName: 'compensation.assign-recurring',
        employmentId: ready.employmentId,
        componentId: ready.componentId,
        amount: jod('1000000'),
        effectiveFrom: '2023-01-01',
      });

      expect(refused.ok).toBe(false);
    });
  });

  /**
   * An outage is **not** a business refusal, and the adapter does not pretend otherwise.
   *
   * `employment_not_found` would be a false statement: it asserts that the employment does not
   * exist, when in fact nobody could be asked. So the failure propagates, the transaction rolls
   * back, and the caller gets a fault rather than a refusal it might act on. What matters, and what
   * is asserted here, is that **nothing was written** — the same discipline `leaveUnavailable` and
   * `known: false` express elsewhere (ADR-0056), applied to a dependency that is simply down.
   */
  it('writes nothing when Employment cannot be asked, and does not call it a refusal', async () => {
    const wired = wire();

    await wired.as('user:hr-administrator', async () => {
      const ready = await configured(wired);

      wired.employmentUnavailable();

      await expect(
        trySend(wired, {
          commandName: 'compensation.assign-recurring',
          employmentId: ready.employmentId,
          componentId: ready.componentId,
          amount: jod('1000000'),
          effectiveFrom: '2025-01-01',
        }),
      ).rejects.toThrow(/unavailable/i);

      wired.employmentRestored();

      const view = await ask<CompensationView>(wired, {
        queryName: 'compensation.for-employment',
        employmentId: ready.employmentId,
        asOf: '2025-06-01',
      });

      expect(view.components).toHaveLength(0);
    });
  });
});
