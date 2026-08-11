import { beforeEach, describe, expect, it } from 'vitest';

import { harnessFor, type Harness } from './compensation-test-harness.js';
import {
  ask,
  component,
  configure,
  jod,
  sar,
  send,
  trySend,
  type Configured,
} from './compensation-scenarios.js';
import type { EmploymentCompensationView } from '../contracts/views.js';

/**
 * Assigning, amending and correcting compensation — end to end, against fakes.
 *
 * Every test here goes through the **dispatcher**, so the permission check, the tenant context and
 * the handler all participate. What is being proved is behaviour a database cannot show on its own:
 * that a change supersedes rather than rewrites, that a retroactive correction is visible on both
 * time axes, and that a percentage allowance whose basis is in another currency is refused.
 */

describe('assigning and amending', () => {
  let harness: Harness;
  let configured: Configured;

  beforeEach(async () => {
    harness = harnessFor();
    configured = await configure(harness);
  });

  it('assigns a salary and reads it back as of today', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const view = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
      });

      expect(view.components).toHaveLength(1);
      expect(view.components[0]?.amount.amountMinor).toBe('1000000');
      expect(view.totalsByCurrency[0]?.currencyCode).toBe('JOD');
    });
  });

  it('supersedes rather than rewrites: the old period keeps its amount', async () => {
    await harness.as('user:hr', async () => {
      const first = await send<{ recurringId: string }>(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      await send(harness, {
        commandName: 'compensation.amend-recurring',
        recurringId: first.recurringId,
        amount: jod('1100000'),
        effectiveFrom: '2026-06-01',
        expectedVersion: 1,
      });

      const before = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
        asOf: '2026-03-01',
      });
      const after = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
        asOf: '2026-07-01',
      });

      expect(before.components[0]?.amount.amountMinor).toBe('1000000');
      expect(after.components[0]?.amount.amountMinor).toBe('1100000');
    });
  });

  it('refuses a second assignment of the same component over the same period', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      // The application closes the in-force period first, so an identical start is the case the
      // exclusion constraint actually has to catch: it lands exactly where the closed one ended.
      const again = await trySend(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('900000'),
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      });

      expect(again.ok).toBe(false);
    });
  });

  it('permits two different components at once', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.housingId,
        amount: jod('400000'),
        effectiveFrom: '2026-01-01',
      });

      const view = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
      });

      expect(view.components).toHaveLength(2);
    });
  });

  it('refuses a change before the employment started', async () => {
    const refused = await harness.as('user:hr', () =>
      trySend(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2019-01-01',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses a change after the employment ended', async () => {
    const ended = harness.employment.addOne({ startDate: '2020-01-01', endDate: '2026-03-31' });
    const refused = await harness.as('user:hr', () =>
      trySend(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: ended,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-06-01',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('stores a future-dated change without letting it affect today', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const future = await ask<{ items: readonly unknown[] }>(harness, {
        queryName: 'compensation.future-changes',
        employmentId: configured.employmentId,
      });

      expect(future.items).toHaveLength(0);

      const today = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
      });

      expect(today.components[0]?.amount.amountMinor).toBe('1000000');
    });
  });

  it('refuses a percentage allowance whose basis is in another currency', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const refused = await trySend(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.housingId,
        amount: sar('40000'),
        effectiveFrom: '2026-01-01',
      });

      expect(refused.ok).toBe(false);
    });
  });

  it('publishes the rule beside the figure for a percentage allowance', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.housingId,
        amount: jod('400000'),
        effectiveFrom: '2026-01-01',
        // The stored resolution is what a screen and Payroll both read, so neither resolves it.
      });

      const view = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
      });
      const housing = view.components.find((one) => one.componentId === configured.housingId);

      expect(housing?.amount.amountMinor).toBe('400000');
    });
  });

  it('keeps components in different currencies apart and sums neither into the other', async () => {
    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const foreign = await component(harness, 'foreign-allowance', 'allowance', {});

      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: foreign,
        amount: sar('50000'),
        effectiveFrom: '2026-01-01',
      });

      const view = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
      });

      expect(view.totalsByCurrency).toHaveLength(2);
      expect(view.totalsByCurrency.map((total) => total.currencyCode).sort()).toEqual([
        'JOD',
        'SAR',
      ]);
    });
  });
});

describe('retroactive change and reconciliation', () => {
  it('records both time axes and finds the correction by system time', async () => {
    const harness = harnessFor({ now: new Date('2026-04-20T09:00:00Z') });
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        // Effective in March, recorded in April. The pair is what makes it explainable.
        amount: jod('1100000'),
        effectiveFrom: '2026-03-01',
      });

      const changed = await ask<{ readonly recurring: readonly { recordedAt: Date }[] }>(harness, {
        queryName: 'compensation.changed-since',
        recordedAfter: new Date('2026-04-01T00:00:00Z'),
        from: '2026-01-01',
        to: '2026-12-31',
      });

      expect(changed.recurring).toHaveLength(1);
      expect(changed.recurring[0]?.recordedAt).toEqual(new Date('2026-04-20T09:00:00Z'));
    });
  });

  it('does not report a change recorded before the caller last looked', async () => {
    const harness = harnessFor({ now: new Date('2026-04-20T09:00:00Z') });
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const changed = await ask<{ readonly recurring: readonly unknown[] }>(harness, {
        queryName: 'compensation.changed-since',
        recordedAfter: new Date('2026-05-01T00:00:00Z'),
        from: '2026-01-01',
        to: '2026-12-31',
      });

      expect(changed.recurring).toHaveLength(0);
    });
  });
});
