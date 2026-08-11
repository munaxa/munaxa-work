import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { harnessFor } from './compensation-test-harness.js';
import { ask, configure, jod, send, trySend } from './compensation-scenarios.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { RecordAdjustmentCommand } from './adjustment.use-case.js';
import type { DecideCompensationCommand } from './decision.use-case.js';
import type { ImportCompensationCommand } from './import.use-case.js';
import type { RecordOneTimeCommand } from './one-time.use-case.js';
import type { EmploymentCompensationView } from '../contracts/views.js';
import type { PayrollPeriodView } from './payroll-query.js';

/**
 * The contracts a future Payroll consumes, the approval control, the permission separations, the
 * adjustment and the import — end to end, against fakes.
 *
 * Every test here goes through the **dispatcher**, so the permission check, the tenant context and
 * the handler all participate. The assertions that matter most are the negative ones: no computed
 * total in the payroll contract, no fabricated system approver in the chain, and nothing written by
 * a second submission of the same import row.
 */

describe('the payroll contract', () => {
  it('is set-based, per currency, and includes an employment with nothing', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);
    const empty = harness.employment.addOne();

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });
      await send(harness, {
        commandName: 'compensation.record-one-time',
        employmentId: configured.employmentId,
        componentId: configured.bonusId,
        amount: jod('500000'),
        payableOn: '2026-06-15',
        reasonCode: 'annual-bonus',
      } satisfies Omit<RecordOneTimeCommand, 'commandName'> & { commandName: string });

      const view = await ask<PayrollPeriodView>(harness, {
        queryName: 'compensation.payroll-period',
        employmentIds: [configured.employmentId, empty],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      });

      expect(view.items).toHaveLength(2);

      const paid = view.items[0];

      expect(paid?.currencies).toHaveLength(1);
      expect(paid?.currencies[0]?.recurring).toHaveLength(1);
      expect(paid?.currencies[0]?.oneTime).toHaveLength(1);
      // The employment with nothing is present with empty blocks, not omitted.
      expect(view.items[1]?.currencies).toHaveLength(0);
    });
  });

  it('publishes no computed total and carries the treatment code uninterpreted', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const view = await ask<PayrollPeriodView>(harness, {
        queryName: 'compensation.payroll-period',
        employmentIds: [configured.employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      });
      const block = view.items[0]?.currencies[0];

      expect(block?.recurring[0]?.payrollTreatmentCode).toBe('ordinary');
      expect(block?.recurring[0]?.partialPeriod).toBe(false);
      expect(JSON.stringify(view)).not.toContain('gross');
      expect(JSON.stringify(view)).not.toContain('"tax"');
    });
  });

  it('produces the same digest for the same inputs', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const period = {
        queryName: 'compensation.payroll-period',
        employmentIds: [configured.employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      };
      const first = await ask<PayrollPeriodView>(harness, period);
      const second = await ask<PayrollPeriodView>(harness, period);

      expect(first.items[0]?.inputsDigest).toBe(second.items[0]?.inputsDigest);
    });
  });
});

describe('approval', () => {
  it('refuses self-approval even for somebody holding both permissions', async () => {
    const harness = harnessFor();
    const configured = await configure(harness, { approvalRequired: true });

    const assigned = await harness.as('user:hr', () =>
      send<{ recurringId: string; approvalState: string }>(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      }),
    );

    expect(assigned.approvalState).toBe('pending');

    const refused = await harness.as('user:hr', () =>
      trySend(harness, {
        commandName: 'compensation.decide',
        subjectKind: 'recurring',
        subjectId: assigned.recurringId,
        decision: 'approved',
      } satisfies Omit<DecideCompensationCommand, 'commandName'> & { commandName: string }),
    );

    expect(refused.ok).toBe(false);
  });

  it('records a named human decision and moves the subject to approved', async () => {
    const harness = harnessFor();
    const configured = await configure(harness, { approvalRequired: true });
    const assigned = await harness.as('user:hr', () =>
      send<{ recurringId: string }>(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      }),
    );

    const decided = await harness.as('user:manager', () =>
      send<{ approvalState: string }>(harness, {
        commandName: 'compensation.decide',
        subjectKind: 'recurring',
        subjectId: assigned.recurringId,
        decision: 'approved',
      }),
    );

    expect(decided.approvalState).toBe('approved');

    const chain = await harness.as('user:hr', () =>
      ask<{ required: boolean; steps: readonly { decidedBy: string }[] }>(harness, {
        queryName: 'compensation.approval-chain',
        subjectKind: 'recurring',
        subjectId: assigned.recurringId,
      }),
    );

    expect(chain.required).toBe(true);
    expect(chain.steps[0]?.decidedBy).toBe('user:manager');
  });

  it('publishes "no approval required" with no fabricated system step', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);
    const assigned = await harness.as('user:hr', () =>
      send<{ recurringId: string; approvalState: string }>(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      }),
    );

    expect(assigned.approvalState).toBe('not_required');

    const chain = await harness.as('user:hr', () =>
      ask<{ required: boolean; steps: readonly unknown[] }>(harness, {
        queryName: 'compensation.approval-chain',
        subjectKind: 'recurring',
        subjectId: assigned.recurringId,
      }),
    );

    expect(chain.required).toBe(false);
    expect(chain.steps).toHaveLength(0);
    expect(JSON.stringify(chain)).not.toContain('system:auto-approval');
  });
});

describe('permissions', () => {
  it('refuses a caller who may manage but not approve', async () => {
    const harness = harnessFor({ permissions: [CompensationPermissions.manage] });
    const refused = await harness.as('user:hr', () =>
      trySend(harness, {
        commandName: 'compensation.decide',
        subjectKind: 'recurring',
        subjectId: uuidV7(),
        decision: 'approved',
      }),
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error.kind).toBe('forbidden');
  });

  it('refuses a caller who may read but not see adjustment reasons', async () => {
    const harness = harnessFor({ permissions: [CompensationPermissions.read] });
    const refused = await harness.as('user:hr', () =>
      harness.dispatcher.ask({ queryName: 'compensation.adjustments' } as never),
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error.kind).toBe('forbidden');
  });

  it('refuses a caller who may draft a plan but not publish it', async () => {
    const harness = harnessFor({ permissions: [CompensationPermissions.planManage] });
    const refused = await harness.as('user:hr', () =>
      trySend(harness, {
        commandName: 'compensation.publish-plan',
        compensationPlanId: uuidV7(),
        expectedVersion: 1,
      }),
    );

    expect(refused.ok ? undefined : refused.error.kind).toBe('forbidden');
  });
});

describe('adjustment', () => {
  it('writes the reason and the change together', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      await send(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      });

      const adjusted = await send<{ adjustmentId: string; recurringId: string }>(harness, {
        commandName: 'compensation.record-adjustment',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        adjustmentType: 'merit',
        newAmount: jod('1100000'),
        effectiveFrom: '2026-07-01',
        reasonCode: 'annual-review',
        note: 'Agreed at the July review.',
      } satisfies Omit<RecordAdjustmentCommand, 'commandName'> & { commandName: string });

      expect(adjusted.adjustmentId).toBeTruthy();

      const register = await ask<{
        items: readonly { note?: string; previousAmount?: { amountMinor: string } }[];
      }>(harness, { queryName: 'compensation.adjustments' });

      expect(register.items[0]?.note).toBe('Agreed at the July review.');
      expect(register.items[0]?.previousAmount?.amountMinor).toBe('1000000');

      const after = await ask<EmploymentCompensationView>(harness, {
        queryName: 'compensation.for-employment',
        employmentId: configured.employmentId,
        asOf: '2026-08-01',
      });

      expect(after.components[0]?.amount.amountMinor).toBe('1100000');
    });
  });
});

describe('import', () => {
  it('writes once and reports the retry as skipped', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);
    const batch: Omit<ImportCompensationCommand, 'commandName'> & { commandName: string } = {
      commandName: 'compensation.import',
      source: 'csv',
      rows: [
        {
          employmentId: configured.employmentId,
          componentId: configured.basicId,
          amount: jod('1000000'),
          effectiveFrom: '2026-01-01',
          sourceId: 'row-1',
        },
      ],
    };

    await harness.as('user:hr', async () => {
      const first = await send<{ rowsCreated: number; rowsSkipped: number }>(harness, batch);

      expect(first.rowsCreated).toBe(1);
      expect(first.rowsSkipped).toBe(0);

      const second = await send<{ rowsCreated: number; rowsSkipped: number }>(harness, batch);

      expect(second.rowsCreated).toBe(0);
      expect(second.rowsSkipped).toBe(1);
    });
  });

  it('counts a row it could not write rather than discarding the batch', async () => {
    const harness = harnessFor();
    const configured = await configure(harness);

    await harness.as('user:hr', async () => {
      const outcome = await send<{ rowsCreated: number; rowsFailed: number }>(harness, {
        commandName: 'compensation.import',
        source: 'csv',
        rows: [
          {
            employmentId: configured.employmentId,
            componentId: configured.basicId,
            amount: jod('1000000'),
            effectiveFrom: '2026-01-01',
            sourceId: 'row-1',
          },
          {
            // An employment nobody has heard of: refused by the same checks a manual write makes.
            employmentId: uuidV7(),
            componentId: configured.basicId,
            amount: jod('900000'),
            effectiveFrom: '2026-01-01',
            sourceId: 'row-2',
          },
        ],
      });

      expect(outcome.rowsCreated).toBe(1);
      expect(outcome.rowsFailed).toBe(1);
    });
  });
});

describe('history', () => {
  it('records what happened, including the events that changed no value', async () => {
    const harness = harnessFor({ approvalRequired: true } as never);
    const configured = await configure(harness, { approvalRequired: true });
    const assigned = await harness.as('user:hr', () =>
      send<{ recurringId: string }>(harness, {
        commandName: 'compensation.assign-recurring',
        employmentId: configured.employmentId,
        componentId: configured.basicId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
      }),
    );

    await harness.as('user:manager', () =>
      send(harness, {
        commandName: 'compensation.decide',
        subjectKind: 'recurring',
        subjectId: assigned.recurringId,
        decision: 'approved',
      }),
    );

    const history = await harness.as('user:hr', () =>
      ask<{ items: readonly { changeKind: string }[] }>(harness, {
        queryName: 'compensation.history',
        employmentId: configured.employmentId,
      }),
    );

    expect(history.items.map((item) => item.changeKind).sort()).toEqual(['approved', 'assigned']);
  });
});
