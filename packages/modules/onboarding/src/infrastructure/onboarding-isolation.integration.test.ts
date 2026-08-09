import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Onboarding } from '../domain/onboarding.js';
import { Task } from '../domain/task.js';

import {
  CONNECTION,
  ONBOARDING_TABLES,
  openOnboardingFixture,
  requireDatabaseInCi,
  TENANT_A,
  TENANT_B,
  type OnboardingFixture,
} from './onboarding-database.fixture.js';

/**
 * Tenant isolation, and the race the idempotent start is built to lose safely.
 *
 * The suite connects as a role that owns nothing and holds no `BYPASSRLS`, which is the only
 * configuration under which any of this means anything: a superuser bypasses every policy, so the
 * same assertions run as one would pass whether or not isolation worked.
 *
 * The concurrency test is the one to read. Two transactions, both reading "no onboarding here", both
 * inserting. The database decides. That is what makes the start command safe to call from an HTTP
 * retry, from a reconciliation run and from an event accelerator at the same moment.
 */
const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Onboarding isolation');

suite('Onboarding isolation', () => {
  let fixture: OnboardingFixture;

  beforeAll(async () => {
    fixture = await openOnboardingFixture('onboarding_fixture');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const ORIGIN = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
  const NOW = new Date('2026-08-10T09:00:00Z');

  const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value as TValue;
  };

  const instanceFor = (
    tenantId: string,
    employmentId: string,
    personId: string,
  ): Onboarding =>
    unwrap(
      Onboarding.start(
        { tenantId, employmentId, personId, plannedStartOn: '2026-09-01' },
        { ...ORIGIN, tenantId },
        NOW,
      ),
    );

  /** Every table this module owns carries the policy. There is no exception, so none is asserted. */
  it('protects every one of its tables with row-level security', async () => {
    const protectedTables = await fixture.admin.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename = any($1::text[]) and rowsecurity`,
      [ONBOARDING_TABLES],
    );

    expect(protectedTables.rows.map((row) => row.tablename).sort()).toEqual(
      [...ONBOARDING_TABLES].sort(),
    );
  });

  it('hides one tenant\'s onboarding from another, by read and by identifier', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const onboarding = instanceFor(TENANT_A, seeded.employmentId, seeded.personId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.insert(transaction, onboarding.snapshot()),
    );

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      byId: await fixture.stores.onboardings.byId(transaction, onboarding.id),
      live: await fixture.stores.onboardings.liveForEmployment(transaction, seeded.employmentId),
      all: await fixture.stores.onboardings.all(transaction),
    }));

    expect(seen.byId).toBeUndefined();
    expect(seen.live).toBeUndefined();
    expect(seen.all).toEqual([]);
  });

  /**
   * Reconciliation's read is the one that could leak a whole workforce, because it asks for a set
   * rather than for a named row.
   */
  it('hides one tenant\'s employments from another tenant\'s reconciliation read', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const onboarding = instanceFor(TENANT_A, seeded.employmentId, seeded.personId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.insert(transaction, onboarding.snapshot()),
    );

    const seen = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.onboardings.employmentsWithAny(transaction, [seeded.employmentId]),
    );

    // Tenant B is told nothing has an onboarding — which is true *for tenant B*, and is the answer
    // that keeps A's joiner invisible.
    expect(seen).toEqual([]);
  });

  it('hides one tenant\'s tasks and their history from another', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const onboarding = instanceFor(TENANT_A, seeded.employmentId, seeded.personId);
    const task = unwrap(
      Task.define(
        {
          tenantId: TENANT_A,
          onboardingId: onboarding.id,
          sequence: 1,
          title: { en: 'Sign', ar: 'وقّع' },
          kind: 'checklist',
          ownerKind: 'role',
          ownerRole: 'hr',
        },
        ORIGIN,
        NOW,
      ),
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.onboardings.insert(transaction, onboarding.snapshot());
      await fixture.stores.tasks.insert(transaction, task.snapshot());
    });

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      byId: await fixture.stores.tasks.byId(transaction, task.id),
      forOnboarding: await fixture.stores.tasks.forOnboarding(transaction, onboarding.id),
      tally: await fixture.stores.tasks.tally(transaction, onboarding.id, '2026-08-10'),
      history: await fixture.stores.taskEvents.forTask(transaction, task.id),
    }));

    expect(seen.byId).toBeUndefined();
    expect(seen.forOnboarding).toEqual([]);
    expect(seen.history).toEqual([]);
    // A count is a disclosure too: "how many tasks are open on that onboarding" is a question one
    // tenant must not be able to ask about another.
    expect(seen.tally.requiredTotal).toBe(0);
  });

  /**
   * One employment, two tenants, two live onboardings — permitted, and it must be.
   *
   * The index is `(tenant_id, employment_id)`. An index that omitted the tenant would make one
   * customer's data change what another customer can do, which is the worst class of isolation
   * failure because it looks like a business rule.
   */
  it('scopes the uniqueness boundary to the tenant', async () => {
    const inA = await fixture.seedEmployment(TENANT_A);
    const inB = await fixture.seedEmployment(TENANT_B);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.insert(
        transaction,
        instanceFor(TENANT_A, inA.employmentId, inA.personId).snapshot(),
      ),
    );

    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.onboardings.insert(
          transaction,
          instanceFor(TENANT_B, inB.employmentId, inB.personId).snapshot(),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * The race, against the real index.
   *
   * Both transactions are opened before either commits, so they genuinely overlap: the second insert
   * blocks on the first's uncommitted index entry and is refused the moment the first commits. One
   * row survives, and the loser learns it lost — which is exactly what the start command's second
   * attempt needs in order to converge rather than loop.
   */
  it('lets the database decide when two starts overlap, and keeps one row', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.onboardings.insert(
          transaction,
          instanceFor(TENANT_A, seeded.employmentId, seeded.personId).snapshot(),
        );
      }),
      fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.onboardings.insert(
          transaction,
          instanceFor(TENANT_A, seeded.employmentId, seeded.personId).snapshot(),
        );
      }),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);

    const surviving = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from onboarding_instance
        where tenant_id = $1 and employment_id = $2`,
      [TENANT_A, seeded.employmentId],
    );

    expect(surviving.rows[0]?.total).toBe('1');
  });
});
