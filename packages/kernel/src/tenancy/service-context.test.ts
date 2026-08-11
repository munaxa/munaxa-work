import { describe, expect, it } from 'vitest';

import {
  GrantAwarePermissionChecker,
  currentServiceGrant,
  runWithServiceGrant,
  type ServiceElevation,
  type ServiceGrant,
} from './service-context.js';
import { runInContext } from './tenant-context.js';
import { uuidV7 } from '../identity/uuid-v7.js';

import type { PermissionChecker } from '../cqrs/pipeline.js';

const TENANT = uuidV7();

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const grant: ServiceGrant = {
  module: 'recruitment',
  operation: 'recruitment.hire',
  permits: ['people.person.read'],
  reason: 'matching a candidate to an existing person',
};

const asUser = <TResult>(work: () => TResult): TResult =>
  runInContext({ tenantId: TENANT, correlationId: 'corr-1', actor: 'user:recruiter' }, work);

describe('the service grant', () => {
  it('is absent unless one is entered', () => {
    expect(asUser(() => currentServiceGrant())).toBeUndefined();
  });

  it('is visible only inside the work it wraps', () => {
    asUser(() => {
      runWithServiceGrant(grant, () => {
        expect(currentServiceGrant()?.module).toBe('recruitment');
      });
      expect(currentServiceGrant()).toBeUndefined();
    });
  });

  it('refuses outside a tenant context, so nothing can run untenanted under it', () => {
    expect(() => runWithServiceGrant(grant, () => undefined)).toThrow(/tenant context/i);
  });

  it('refuses to nest, so authority cannot be accumulated by composition', () => {
    asUser(() => {
      runWithServiceGrant(grant, () => {
        expect(() => runWithServiceGrant(grant, () => undefined)).toThrow(/not composed/i);
      });
    });
  });

  it('does not change who is acting — the audit context is untouched', () => {
    asUser(() => {
      runWithServiceGrant(grant, () => {
        // The elevation changes what is permitted. It must never change whose name is on the row.
        expect(currentServiceGrant()?.operation).toBe('recruitment.hire');
      });
    });
  });
});

describe('GrantAwarePermissionChecker', () => {
  it('defers to the delegate when the user holds the permission themselves', async () => {
    const checker = new GrantAwarePermissionChecker(permitting('people.person.read'));

    await asUser(async () => {
      expect(await checker.holds('people.person.read')).toBe(true);
    });
  });

  it('refuses a permission the user lacks when no grant is open', async () => {
    const checker = new GrantAwarePermissionChecker(permitting('recruitment.hire'));

    await asUser(async () => {
      expect(await checker.holds('people.person.read')).toBe(false);
    });
  });

  it('permits exactly what an open grant names, and nothing else', async () => {
    const checker = new GrantAwarePermissionChecker(permitting('recruitment.hire'));

    await asUser(async () => {
      await runWithServiceGrant(grant, async () => {
        expect(await checker.holds('people.person.read')).toBe(true);
        // Named nowhere in the grant. A near-miss is still a refusal.
        expect(await checker.holds('people.person.manage')).toBe(false);
        expect(await checker.holds('people.export')).toBe(false);
      });
    });
  });

  it('never treats a permission as a prefix or a pattern', async () => {
    const checker = new GrantAwarePermissionChecker(permitting());

    await asUser(async () => {
      await runWithServiceGrant({ ...grant, permits: ['people.person'] }, async () => {
        expect(await checker.holds('people.person.read')).toBe(false);
      });
    });
  });

  it('closes again the moment the grant ends', async () => {
    const checker = new GrantAwarePermissionChecker(permitting());

    await asUser(async () => {
      await runWithServiceGrant(grant, async () => {
        expect(await checker.holds('people.person.read')).toBe(true);
      });
      expect(await checker.holds('people.person.read')).toBe(false);
    });
  });

  /**
   * The elevation record is what makes the capability auditable rather than merely bounded. It
   * names the module, the operation, the permission and — critically — the human being on whose
   * behalf the module acted.
   */
  it('records every elevation with the human actor, and only for a real elevation', async () => {
    const recorded: ServiceElevation[] = [];
    const checker = new GrantAwarePermissionChecker(permitting('recruitment.hire'), (elevation) =>
      recorded.push(elevation),
    );

    await asUser(async () => {
      await runWithServiceGrant(grant, async () => {
        // Held by the user themselves: permitted, and not an elevation.
        await checker.holds('recruitment.hire');
        await checker.holds('people.person.read');
        await checker.holds('people.person.manage');
      });
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      module: 'recruitment',
      operation: 'recruitment.hire',
      permission: 'people.person.read',
      tenantId: TENANT,
      actor: 'user:recruiter',
      correlationId: 'corr-1',
    });
  });
});
