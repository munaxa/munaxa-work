import { ConcurrencyException, TenantIsolationException, uuidV7 } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { FakeRepository, type FakeRow } from './fake-repository.js';
import { anEvent } from './builders.js';
import {
  assertEventRaised,
  assertFailedWith,
  assertNoEventRaised,
  assertSucceeded,
} from './assertions.js';

interface Probe extends FakeRow {
  readonly label: string;
}

const tenantA = uuidV7();
const tenantB = uuidV7();

const probe = (tenantId: string, label = 'first'): Probe => ({
  id: uuidV7(),
  tenantId,
  version: 1,
  label,
});

describe('FakeRepository', () => {
  it('keeps the guarantees the real repository makes: no cross-tenant read', () => {
    const repository = new FakeRepository<Probe>('probe');
    const row = probe(tenantA);
    repository.seed(row);

    expect(repository.find(tenantA, row.id)).toBeDefined();
    expect(repository.find(tenantB, row.id)).toBeUndefined();
  });

  it('refuses a stale write, as the real one does', () => {
    const repository = new FakeRepository<Probe>('probe');
    const row = probe(tenantA);
    repository.seed(row);

    expect(() => repository.save(tenantA, row, 0)).toThrow(ConcurrencyException);
  });

  it('refuses a cross-tenant write', () => {
    const repository = new FakeRepository<Probe>('probe');
    const row = probe(tenantA);
    repository.seed(row);

    expect(() => repository.save(tenantB, row, 1)).toThrow(TenantIsolationException);
  });

  it('hides a soft deleted row but keeps it retrievable administratively', () => {
    const repository = new FakeRepository<Probe>('probe');
    const row = probe(tenantA);
    repository.seed(row);
    repository.softDelete(tenantA, row.id, new Date());

    expect(repository.find(tenantA, row.id)).toBeUndefined();
    expect(repository.findIncludingDeleted(tenantA, row.id)).toBeDefined();
    expect(repository.all(tenantA)).toHaveLength(0);
  });
});

describe('assertions', () => {
  const events = [anEvent('leave.request.approved'), anEvent('leave.balance.changed')];

  it('finds a raised event', () => {
    expect(assertEventRaised(events, 'leave.request.approved').eventName).toBe(
      'leave.request.approved',
    );
  });

  it('names what was raised when the expected event was not', () => {
    expect(() => assertEventRaised(events, 'leave.request.rejected')).toThrow(
      /Raised: leave.request.approved, leave.balance.changed/,
    );
  });

  it('says plainly when nothing was raised', () => {
    expect(() => assertEventRaised([], 'leave.request.approved')).toThrow(/Raised: nothing/);
  });

  it('asserts an event was not raised', () => {
    expect(() => {
      assertNoEventRaised(events, 'payroll.finalized');
    }).not.toThrow();
    expect(() => {
      assertNoEventRaised(events, 'leave.request.approved');
    }).toThrow(/not to be raised/);
  });

  it('names the failure a handler actually gave', () => {
    const forbidden = {
      ok: false as const,
      error: { kind: 'forbidden' as const, permission: 'x' },
    };

    expect(assertFailedWith(forbidden, 'forbidden').kind).toBe('forbidden');
    expect(() => assertFailedWith(forbidden, 'validation')).toThrow(/got forbidden/);
    expect(() => assertFailedWith({ ok: true as const, value: 1 }, 'forbidden')).toThrow(
      /the operation succeeded/,
    );
  });

  it('surfaces the failure instead of a bare undefined on unexpected failure', () => {
    expect(assertSucceeded({ ok: true as const, value: 42 })).toBe(42);
    expect(() =>
      assertSucceeded({ ok: false as const, error: { kind: 'rejected' as const, reason: 'no' } }),
    ).toThrow(/Expected success, got rejected/);
  });
});
