import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { EmploymentPermissions } from './employment-permissions.js';
import {
  TENANT_A,
  TENANT_B,
  anActiveEmployment,
  anEmployment,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  type Harness,
} from './employment-test-harness.js';
import { inMemoryEmploymentStores } from './in-memory-stores.js';

/**
 * Authorization and tenant isolation.
 *
 * Both are checked centrally by the pipeline, so these tests prove the *declarations* are right:
 * that ending an employment is not reachable with the permission that suspends one, that reading a
 * history is not reachable with the permission that reads an employment, and that a tenant cannot
 * see, change or infer another tenant's records through any of the four surfaces §33 names.
 */
describe('authorization', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('refuses a create to a caller without employment.employment.manage', () =>
    asTenant(TENANT_A, async () => {
      const restricted = harnessWithStores(TENANT_A, harness.stores, [
        EmploymentPermissions.employmentRead,
      ]);
      const created = await send(restricted, {
        commandName: 'employment.create-employment',
        personId: uuidV7(),
        employmentTypeCode: 'full-time',
        startDate: '2026-01-15',
      });

      expect(created.ok).toBe(false);
      if (!created.ok && created.error.kind === 'forbidden') {
        expect(created.error.permission).toBe(EmploymentPermissions.employmentManage);
      } else {
        throw new Error('expected a refusal');
      }
    }));

  /**
   * The separation that matters most in this module: suspending somebody and dismissing them are
   * different acts, and holding the first must not grant the second.
   */
  it('refuses ending to a caller who may only change status', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        [EmploymentPermissions.employmentStatusChange, EmploymentPermissions.employmentRead],
        { people: harness.people, organization: harness.organization },
      );

      const suspended = await send(restricted, {
        commandName: 'employment.change-status',
        employmentId: employment.employmentId,
        status: 'suspended',
        expectedVersion: 2,
      });

      expect(suspended.ok).toBe(true);

      const ended = await send(restricted, {
        commandName: 'employment.end-employment',
        employmentId: employment.employmentId,
        endDate: '2026-09-30',
        endReasonCode: 'dismissal',
        expectedVersion: 3,
      });

      expect(ended.ok).toBe(false);
      if (!ended.ok && ended.error.kind === 'forbidden') {
        expect(ended.error.permission).toBe(EmploymentPermissions.employmentEnd);
      } else {
        throw new Error('expected a refusal');
      }
    }));

  it('refuses a history read to a caller who may only read the employment', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        [EmploymentPermissions.employmentRead],
        { people: harness.people, organization: harness.organization },
      );

      const read = await ask(restricted, {
        queryName: 'employment.read-employment',
        employmentId: employment.employmentId,
      });
      const history = await ask(restricted, {
        queryName: 'employment.read-history',
        employmentId: employment.employmentId,
      });

      expect(read.ok).toBe(true);
      expect(history.ok).toBe(false);
    }));

  it('refuses an export to a caller who may read the workforce', () =>
    asTenant(TENANT_A, async () => {
      const restricted = harnessWithStores(TENANT_A, harness.stores, [
        EmploymentPermissions.employmentRead,
      ]);
      const exported = await ask(restricted, { queryName: 'employment.export-workforce' });

      expect(exported.ok).toBe(false);
      if (!exported.ok && exported.error.kind === 'forbidden') {
        expect(exported.error.permission).toBe(EmploymentPermissions.exportEmployments);
      } else {
        throw new Error('expected a refusal');
      }
    }));

  it('refuses an assignment change to a caller who may only manage the employment', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const unitId = harness.organization.add(uuidV7());
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        [EmploymentPermissions.employmentManage],
        { people: harness.people, organization: harness.organization },
      );

      const assigned = await send(restricted, {
        commandName: 'employment.create-assignment',
        employmentId: employment.employmentId,
        unitId,
      });

      expect(assigned.ok).toBe(false);
      if (!assigned.ok && assigned.error.kind === 'forbidden') {
        expect(assigned.error.permission).toBe(EmploymentPermissions.assignmentManage);
      } else {
        throw new Error('expected a refusal');
      }
    }));

  it('refuses every operation outside a tenant context', async () => {
    // Not a refusal a caller can hold a permission for: the pipeline throws before it asks, because
    // tenant-scoped work that ran unscoped is a fault rather than a business outcome.
    await expect(ask(harness, { queryName: 'employment.search' })).rejects.toThrow(/tenant/i);
  });
});

/**
 * Tenant isolation, at the application layer.
 *
 * The database's half — row-level security — is proved in the integration suite against a real
 * PostgreSQL. This half proves the application never *asks* for another tenant's rows: the stores
 * are shared between two harnesses on purpose, so a use case that forgot to scope something would
 * find the other tenant's data sitting there.
 */
describe('tenant isolation', () => {
  let inA: Harness;
  let inB: Harness;

  beforeEach(() => {
    testClock.reset();

    const stores = inMemoryEmploymentStores();

    inA = harnessWithStores(TENANT_A, stores);
    inB = harnessWithStores(TENANT_B, stores);
  });

  it('cannot read another tenant’s employment, and answers not-found rather than forbidden', async () => {
    const employment = await asTenant(TENANT_A, () => anEmployment(inA));
    const read = await asTenant(TENANT_B, () =>
      ask(inB, { queryName: 'employment.read-employment', employmentId: employment.employmentId }),
    );

    expect(read.ok).toBe(false);
    // Not "forbidden": telling a caller an identifier is real is itself a disclosure.
    if (!read.ok) expect(read.error.kind).toBe('not_found');
  });

  it('cannot modify another tenant’s employment', async () => {
    const employment = await asTenant(TENANT_A, () => anEmployment(inA));
    const amended = await asTenant(TENANT_B, () =>
      send(inB, {
        commandName: 'employment.amend-employment',
        employmentId: employment.employmentId,
        employmentTypeCode: 'part-time',
        expectedVersion: 1,
      }),
    );

    expect(amended.ok).toBe(false);
    if (!amended.ok) expect(amended.error.kind).toBe('not_found');
  });

  it('cannot end another tenant’s employment', async () => {
    const employment = await asTenant(TENANT_A, () => anActiveEmployment(inA));
    const ended = await asTenant(TENANT_B, () =>
      send(inB, {
        commandName: 'employment.end-employment',
        employmentId: employment.employmentId,
        endDate: '2026-09-30',
        endReasonCode: 'dismissal',
        expectedVersion: 2,
      }),
    );

    expect(ended.ok).toBe(false);
  });

  it('cannot find another tenant’s employment through search', async () => {
    await asTenant(TENANT_A, () => anEmployment(inA));

    const found = await asTenant(TENANT_B, () =>
      ask<{ readonly items: readonly unknown[] }>(inB, { queryName: 'employment.search' }),
    );

    if (!found.ok) throw new Error('expected a page');
    expect(found.value.items).toHaveLength(0);
  });

  it('cannot take another tenant’s workforce out through export', async () => {
    await asTenant(TENANT_A, () => anEmployment(inA));

    const exported = await asTenant(TENANT_B, () =>
      ask<{ readonly employments: readonly unknown[] }>(inB, {
        queryName: 'employment.export-workforce',
      }),
    );

    if (!exported.ok) throw new Error('expected an export');
    expect(exported.value.employments).toHaveLength(0);
  });

  it('cannot make another tenant’s employment somebody’s manager', async () => {
    const foreign = await asTenant(TENANT_A, () => anActiveEmployment(inA));
    const own = await asTenant(TENANT_B, () => anActiveEmployment(inB));

    const changed = await asTenant(TENANT_B, () =>
      send(inB, {
        commandName: 'employment.change-manager',
        employmentId: own.employmentId,
        managerEmploymentId: foreign.employmentId,
      }),
    );

    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.kind).toBe('not_found');
  });

  it('draws each tenant’s numbers from its own counter, so neither can infer the other’s size', async () => {
    const first = await asTenant(TENANT_A, () => anEmployment(inA));
    const second = await asTenant(TENANT_A, () => anEmployment(inA));
    const other = await asTenant(TENANT_B, () => anEmployment(inB));

    expect(first.employmentNumber).toBe('EMP-2026-000001');
    expect(second.employmentNumber).toBe('EMP-2026-000002');
    // Tenant B's first employment is *its* first, not the third in the deployment.
    expect(other.employmentNumber).toBe('EMP-2026-000001');
  });
});
