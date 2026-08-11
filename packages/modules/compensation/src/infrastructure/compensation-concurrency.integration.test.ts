import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openCompensationFixture,
  requireDatabaseInCi,
  type CompensationFixture,
} from './compensation-database.fixture.js';
import {
  aDecision,
  aOneTime,
  aRecurring,
  aComponent,
  configuredTenant,
} from './compensation-fixtures.js';

/**
 * The races, with **two live connections**.
 *
 * These are the assertions an in-memory fake cannot make. Two administrators assigning the same
 * component to one employment both read, both find nothing in the way, and both write — the read
 * happened before either wrote, so no application check can settle it. Only the exclusion
 * constraint can, and only a real database has one.
 *
 * Every wait is bounded by the fixture's `statement_timeout`, so a contended index produces a
 * failure rather than a run that hangs until the job's own timeout hours later.
 */

requireDatabaseInCi('Compensation concurrency');

describe.skipIf(CONNECTION === undefined)('concurrency', () => {
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

  /** Both transactions, started together and settled together. */
  const race = async <TResult>(
    left: () => Promise<TResult>,
    right: () => Promise<TResult>,
  ): Promise<readonly PromiseSettledResult<TResult>[]> => Promise.allSettled([left(), right()]);

  it('lets exactly one of two simultaneous assignments commit', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const { planId, componentId } = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );

    const assign = () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId, {
            effectiveFrom: '2026-01-01',
          }),
        ),
      );

    const outcomes = await race(assign, assign);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);

    const rows = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.recurring.forComponent(transaction, employmentId, componentId),
    );

    expect(rows).toHaveLength(1);
  });

  it('lets two assignments of different components both commit', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const { planId, componentId } = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );
    const housing = aComponent(TENANT_A, 'housing', { kind: 'allowance' });

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.components.insert(transaction, housing),
    );

    const assign = (component: string) => () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, component, planId),
        ),
      );

    const outcomes = await race(assign(componentId), assign(housing.id));

    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
  });

  it('writes one row when the same import row is submitted twice at once', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const { planId, componentId } = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );

    const submit = () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, componentId, planId, {
            source: 'import',
            sourceId: 'row-1',
          }),
        ),
      );

    const outcomes = await race(submit, submit);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const rows = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.recurring.forComponent(transaction, employmentId, componentId),
    );

    expect(rows).toHaveLength(1);
  });

  it('lets one of two concurrent decisions on one subject take the sequence', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const recordId = await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const record = aRecurring(TENANT_A, employmentId, componentId, planId, {
        approvalState: 'pending',
      });

      await fixture.stores.recurring.insert(transaction, record);
      return record.id;
    });

    // Both approvers read an empty chain and both compute sequence 1. The unique index settles it,
    // so the chain cannot end up with two decisions claiming to be the first.
    const decide = (actor: string) => () =>
      fixture.asActor(TENANT_A, actor, (transaction) =>
        fixture.stores.decisions.insert(transaction, aDecision(TENANT_A, recordId, actor)),
      );

    const outcomes = await race(decide('user:manager'), decide('user:director'));

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const chain = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.decisions.forSubject(transaction, 'recurring', recordId),
    );

    expect(chain).toHaveLength(1);
  });

  it('refuses the losing writer of an optimistic amendment rather than merging', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const record = await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const built = aRecurring(TENANT_A, employmentId, componentId, planId);

      await fixture.stores.recurring.insert(transaction, built);
      return (await fixture.stores.recurring.byId(transaction, built.id)) ?? built;
    });

    const close = (effectiveTo: string) => () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.update(transaction, { ...record, effectiveTo }, record.version),
      );

    const outcomes = await race(close('2026-07-01'), close('2026-08-01'));

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets a future-dated write and a payroll read proceed without blocking each other', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const configured = await fixture.asTenant(TENANT_A, async (transaction) => {
      const setup = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, setup.componentId, setup.planId, {
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-09-01',
        }),
      );
      return setup;
    });

    const write = () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.insert(
          transaction,
          aRecurring(TENANT_A, employmentId, configured.componentId, configured.planId, {
            effectiveFrom: '2026-09-01',
          }),
        ),
      );
    const read = () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.recurring.overlappingPeriod(transaction, {
          employmentIds: [employmentId],
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
        }),
      );

    const [written, wasRead] = await Promise.allSettled([write(), read()]);

    expect(written.status).toBe('fulfilled');
    expect(wasRead.status).toBe('fulfilled');
    // The reader sees a consistent snapshot; a future period does not appear in a past range.
    expect(wasRead.status === 'fulfilled' ? wasRead.value : []).toHaveLength(1);
  });

  it('permits two one-time items on one date — there is no overlap rule for them', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const { planId } = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );
    const bonus = aComponent(TENANT_A, 'annual-bonus', {
      kind: 'one_time',
      recurrence: 'one_time',
    });

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.components.insert(transaction, bonus),
    );

    const record = () =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.oneTime.insert(
          transaction,
          aOneTime(TENANT_A, employmentId, bonus.id, planId),
        ),
      );

    const outcomes = await race(record, record);

    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
  });
});
