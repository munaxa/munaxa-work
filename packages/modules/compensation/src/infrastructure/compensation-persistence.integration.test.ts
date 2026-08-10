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
  aDecision,
  aRecurring,
  configuredTenant,
  jod,
} from './compensation-fixtures.js';

/**
 * What the **database** enforces, against a real one.
 *
 * Every assertion here is about a guarantee no application check can make: the GiST exclusion
 * constraint that settles a concurrent assignment, the check constraints that refuse a
 * self-approved change and an out-of-order pay grade, the unique index an import's idempotency
 * rests on — and the one this module cares about more than any other, that a `bigint` amount above
 * 2^53 survives a driver round-trip **exactly**.
 */

requireDatabaseInCi('Compensation persistence');

describe.skipIf(CONNECTION === undefined)('compensation persistence', () => {
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

  it('round-trips an amount above 2^53 exactly', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      // Larger than Number.MAX_SAFE_INTEGER. If anything anywhere turned this into a `number`, the
      // value read back would differ — which is the failure this module exists to make impossible.
      const huge = '90071992547409910';
      const record = aRecurring(TENANT_A, employmentId, componentId, planId, {
        amount: jod(huge),
      });

      await fixture.stores.recurring.insert(transaction, record);

      const read = await fixture.stores.recurring.byId(transaction, record.id);

      expect(read?.amount.amountMinor.toString()).toBe(huge);
    });
  });

  it('keeps a three-decimal currency exact through the round-trip', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const record = aRecurring(TENANT_A, employmentId, componentId, planId, {
        amount: jod('1234567'),
      });

      await fixture.stores.recurring.insert(transaction, record);

      const read = await fixture.stores.recurring.byId(transaction, record.id);

      expect(read?.amount.amountMinor).toBe(1_234_567n);
      expect(read?.amount.currencyExponent).toBe(3);
    });
  });

  it('refuses two overlapping periods for one employment and component', async () => {
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
            effectiveFrom: '2026-01-01',
            effectiveTo: '2026-12-31',
          }),
        );
        await fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId, {
            effectiveFrom: '2026-06-01',
          }),
        );
      }),
    ).rejects.toThrow(/exclusion constraint/i);
  });

  it('permits a period beginning on the day the previous one ends', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId, {
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-07-01',
        }),
      );
      // Half-open: `[2026-01-01, 2026-07-01)` and `[2026-07-01, ∞)` do not overlap.
      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId, {
          effectiveFrom: '2026-07-01',
        }),
      );

      const periods = await fixture.stores.recurring.forComponent(
        transaction,
        employmentId,
        componentId,
      );

      expect(periods).toHaveLength(2);
    });
  });

  it('permits two different components at once', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const housing = aComponent(TENANT_A, 'housing', { kind: 'allowance' });

      await fixture.stores.components.insert(transaction, housing);
      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId),
      );
      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, housing.id, planId),
      );

      const inForce = await fixture.stores.recurring.inForceOn(
        transaction,
        employmentId,
        '2026-06-01',
      );

      expect(inForce).toHaveLength(2);
    });
  });

  it('refuses a self-approved decision by check constraint', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const { planId, componentId } = await configuredTenant(
          transaction,
          fixture.stores,
          TENANT_A,
        );
        const record = aRecurring(TENANT_A, employmentId, componentId, planId);

        await fixture.stores.recurring.insert(transaction, record);
        // The domain refuses this first; the constraint is the second line, and this proves it
        // exists rather than being assumed.
        await fixture.stores.decisions.insert(
          transaction,
          aDecision(TENANT_A, record.id, 'user:hr', 'user:hr'),
        );
      }),
    ).rejects.toThrow(/self_approval_check/i);
  });

  it('accepts a decision by somebody other than the requester', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const record = aRecurring(TENANT_A, employmentId, componentId, planId);

      await fixture.stores.recurring.insert(transaction, record);
      await fixture.stores.decisions.insert(
        transaction,
        aDecision(TENANT_A, record.id, 'user:manager'),
      );

      const chain = await fixture.stores.decisions.forSubject(transaction, 'recurring', record.id);

      expect(chain[0]?.decidedBy).toBe('user:manager');
      expect(chain[0]?.requestedBy).toBe('user:hr');
    });
  });
});
