import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openCompensationFixture,
  requireDatabaseInCi,
  type CompensationFixture,
} from './compensation-database.fixture.js';
import {
  aComponent,
  aGrade,
  aOneTime,
  aRecurring,
  aStep,
  anAdjustment,
  configuredTenant,
} from './compensation-fixtures.js';

/**
 * The constraints on the *configuration* and the reads the module publishes, against a real
 * database.
 *
 * Apart from `compensation-persistence.integration.test.ts`, which proves the exactness of money and
 * the invariants on the authoritative records. These are the checks a pay grade, a step and an
 * import carry, and the queries a payroll run and a reconciliation make.
 */

requireDatabaseInCi('Compensation constraints');

describe.skipIf(CONNECTION === undefined)('compensation constraints', () => {
  let fixture: CompensationFixture;

  beforeAll(async () => {
    fixture = await openCompensationFixture('compensation_fixture');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('refuses a pay grade whose midpoint is outside its range', async () => {
    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const grade = aGrade(TENANT_A);

        await fixture.stores.grades.insert(transaction, {
          ...grade,
          range: {
            minimum: { amountMinor: 500_000n, currencyCode: 'JOD', currencyExponent: 3 },
            midpoint: { amountMinor: 100_000n, currencyCode: 'JOD', currencyExponent: 3 },
            maximum: { amountMinor: 900_000n, currencyCode: 'JOD', currencyExponent: 3 },
          },
        });
      }),
    ).rejects.toThrow(/order_check/i);
  });

  it('refuses a step with two parents', async () => {
    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const grade = aGrade(TENANT_A);

        await fixture.stores.grades.insert(transaction, grade);
        await fixture.stores.steps.insert(transaction, {
          ...aStep(TENANT_A, grade.id),
          payScaleId: grade.id,
        });
      }),
    ).rejects.toThrow(/parent_check/i);
  });

  it('refuses a duplicate imported row by unique index', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const { planId, componentId } = await configuredTenant(
          transaction,
          fixture.stores,
          TENANT_A,
        );

        await fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId, {
            source: 'import',
            sourceId: 'row-1',
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-06-01',
          }),
        );
        await fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId, {
            source: 'import',
            sourceId: 'row-1',
            effectiveFrom: '2026-06-01',
          }),
        );
      }),
    ).rejects.toThrow(/source_key/i);
  });

  it('resolves a page of employments in one set-based read', async () => {
    const first = await fixture.seedEmployment(TENANT_A);
    const second = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      for (const employmentId of [first, second]) {
        await fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId),
        );
      }

      const page = await fixture.stores.recurring.overlappingPeriod(transaction, {
        employmentIds: [first, second],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      });

      expect(page).toHaveLength(2);
    });
  });

  it('finds a change by system time, not by effective date', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId, {
          effectiveFrom: '2026-03-01',
        }),
      );

      const recent = await fixture.stores.recurring.recordedAfter(
        transaction,
        new Date('2026-01-01T00:00:00Z'),
        { from: '2026-01-01', to: '2026-12-31' },
        50,
      );
      const stale = await fixture.stores.recurring.recordedAfter(
        transaction,
        new Date('2027-01-01T00:00:00Z'),
        { from: '2026-01-01', to: '2026-12-31' },
        50,
      );

      expect(recent).toHaveLength(1);
      expect(stale).toHaveLength(0);
    });
  });

  it('persists a one-time item and finds it inside a period', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const bonus = aComponent(TENANT_A, 'annual-bonus', {
        kind: 'one_time',
        recurrence: 'one_time',
      });

      await fixture.stores.components.insert(transaction, bonus);
      await fixture.stores.oneTime.insert(
        transaction,
        aOneTime(TENANT_A, employmentId, bonus.id, planId),
      );

      const payable = await fixture.stores.oneTime.payableWithin(transaction, {
        employmentIds: [employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      });

      expect(payable).toHaveLength(1);
      expect(payable[0]?.amount.amountMinor).toBe(500_000n);
    });
  });

  it('keeps an adjustment reason and its note', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const built = anAdjustment(TENANT_A, employmentId, componentId);

      await fixture.stores.adjustments.insert(transaction, built);

      const read = await fixture.stores.adjustments.byId(transaction, built.id);

      expect(read?.note).toBe('Agreed at the July review.');
      expect(read?.previousAmount?.amountMinor).toBe(1_000_000n);
      expect(read?.newAmount?.amountMinor).toBe(1_100_000n);
    });
  });

  it('reads a civil date back as the date it was stored, not a shifted instant', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const record = aRecurring(TENANT_A, employmentId, componentId, planId, {
        effectiveFrom: '2026-01-01',
      });

      await fixture.stores.recurring.insert(transaction, record);

      const read = await fixture.stores.recurring.byId(transaction, record.id);

      expect(read?.effectiveFrom).toBe('2026-01-01');
    });
  });
});
