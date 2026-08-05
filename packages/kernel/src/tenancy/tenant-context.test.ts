import { describe, expect, it } from 'vitest';

import { TenantIsolationException } from '../errors/domain-exception.js';
import { uuidV7 } from '../identity/uuid-v7.js';

import {
  assertBelongsToCurrentTenant,
  currentContext,
  currentTenantId,
  isSystemContext,
  runInContext,
  type TenantContext,
} from './tenant-context.js';

const tenant = (tenantId: string = uuidV7()): TenantContext => ({
  tenantId,
  actor: 'user:tester',
  correlationId: uuidV7(),
});

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('tenant context', () => {
  it('exposes the tenant inside the context', () => {
    const context = tenant();

    runInContext(context, () => {
      expect(currentTenantId()).toBe(context.tenantId);
    });
  });

  it('refuses outside any context, rather than defaulting to something', () => {
    expect(() => currentTenantId()).toThrow(TenantIsolationException);
  });

  it('refuses under the system context, so unscoped work is never silent', () => {
    runInContext({ system: true, reason: 'migration', correlationId: uuidV7() }, () => {
      expect(() => currentTenantId()).toThrow(/system context \(migration\)/);
      expect(
        isSystemContext(currentContext() ?? { system: true, reason: '', correlationId: '' }),
      ).toBe(true);
    });
  });

  it('rejects a tenant identifier that is not a valid identifier', () => {
    expect(() =>
      runInContext(
        { tenantId: 'a-tenant', actor: 'user:tester', correlationId: uuidV7() },
        () => null,
      ),
    ).toThrow(TenantIsolationException);
  });

  it('keeps concurrent contexts separate — the property a connection pool depends on', async () => {
    const first = tenant();
    const second = tenant();
    const observed: string[] = [];

    const work = (context: TenantContext, pause: number): Promise<void> =>
      runInContext(context, async () => {
        await delay(pause);
        observed.push(currentTenantId());
      });

    // The slower task starts first, so a shared mutable "current tenant" would report the wrong
    // one for at least one of them.
    await Promise.all([work(first, 20), work(second, 1)]);

    expect(observed).toEqual([second.tenantId, first.tenantId]);
  });

  it('restores the outer context after a nested one ends', () => {
    const outer = tenant();
    const inner = tenant();

    runInContext(outer, () => {
      runInContext(inner, () => {
        expect(currentTenantId()).toBe(inner.tenantId);
      });
      expect(currentTenantId()).toBe(outer.tenantId);
    });
  });

  it('accepts a record belonging to the current tenant', () => {
    const context = tenant();

    runInContext(context, () => {
      expect(() => {
        assertBelongsToCurrentTenant('leave request', context.tenantId);
      }).not.toThrow();
    });
  });

  it('refuses a record belonging to another tenant', () => {
    runInContext(tenant(), () => {
      expect(() => {
        assertBelongsToCurrentTenant('leave request', uuidV7());
      }).toThrow(TenantIsolationException);
    });
  });
});
