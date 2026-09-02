import { runInContext, uuidV7, type ExecutionContext } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { PlatformPermissionChecker } from './permission-checker.js';
import { runWithGrants } from './request-grants.js';

/**
 * What a caller may do, given what this request was granted.
 *
 * The checker is the last thing between a Platform grant and a business handler, and the property
 * every test here defends is that it decides by **exact membership** and by nothing else. Platform's
 * grant language has patterns, prefixes and a super-admin wildcard; none of them survives the
 * adapter, and none of them means anything here.
 */

const tenantContext = (): ExecutionContext => ({
  tenantId: uuidV7(),
  actor: 'user:tester',
  correlationId: uuidV7(),
});

/** A request that authenticated, resolved a tenant, and holds these permissions. */
const asking = async (permission: string, ...granted: readonly string[]): Promise<boolean> =>
  runInContext(tenantContext(), () =>
    runWithGrants(new Set(granted), () => new PlatformPermissionChecker().holds(permission)),
  );

describe('a caller holding the exact permission', () => {
  it('is allowed', async () => {
    expect(await asking('assets.asset.read', 'assets.asset.read')).toBe(true);
  });

  it('is allowed for each permission independently', async () => {
    const held = ['leave.read', 'payroll.read', 'assets.asset.read'];

    for (const permission of held) expect(await asking(permission, ...held)).toBe(true);
  });

  it('does not thereby hold a neighbouring one', async () => {
    expect(await asking('assets.asset.manage', 'assets.asset.read')).toBe(false);
    expect(await asking('assets.custody.read', 'assets.asset.read')).toBe(false);
  });

  it('does not hold a deeper one', async () => {
    // A three-segment permission must not confer the four-segment one beneath it: exact matching,
    // not prefix matching.
    expect(await asking('employment.employment.status.change', 'employment.employment.read')).toBe(
      false,
    );
  });
});

describe('a caller holding nothing useful', () => {
  it('is refused when granted nothing at all', async () => {
    expect(await asking('assets.asset.read')).toBe(false);
  });

  it('is refused when holding an unrelated permission', async () => {
    expect(await asking('payroll.finalize', 'leave.read')).toBe(false);
  });

  it('is refused for a permission that does not exist', async () => {
    expect(await asking('assets.asset.destroy', 'assets.asset.read')).toBe(false);
  });
});

describe('a wildcard that somehow reached the checker', () => {
  it.each(['*', 'work:*', 'work:assets:*', 'assets.*', 'assets'])(
    'grants nothing: %s',
    async (held) => {
      expect(await asking('assets.asset.read', held)).toBe(false);
    },
  );

  it('cannot be asked for either', async () => {
    // The pipeline only ever asks with a declared permission name. Asked with a pattern anyway,
    // the answer is no rather than "everything the pattern covers".
    expect(await asking('*', 'assets.asset.read')).toBe(false);
    expect(await asking('assets.*', 'assets.asset.read')).toBe(false);
  });
});

describe('outside a resolved request', () => {
  it('refuses when there is no execution context', async () => {
    expect(await new PlatformPermissionChecker().holds('assets.asset.read')).toBe(false);
  });

  it('refuses under the system context, however the request was granted', async () => {
    const held = runInContext(
      { system: true, reason: 'a migration', correlationId: uuidV7() },
      () =>
        runWithGrants(new Set(['assets.asset.read']), () =>
          new PlatformPermissionChecker().holds('assets.asset.read'),
        ),
    );

    expect(await held).toBe(false);
  });

  it('refuses inside a tenant context that entered no grant scope', async () => {
    const held = runInContext(tenantContext(), () =>
      new PlatformPermissionChecker().holds('assets.asset.read'),
    );

    expect(await held).toBe(false);
  });
});

describe('two requests running at once', () => {
  it('cannot see each other’s grants', async () => {
    // The failure this defends against is a permission set held anywhere process-wide: request A
    // would then answer with request B's authority, and the symptom would be an intermittent
    // cross-tenant authorization that no single-threaded test reproduces.
    const request = (permission: string, granted: readonly string[]): Promise<boolean> =>
      runInContext(tenantContext(), () =>
        runWithGrants(new Set(granted), async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return new PlatformPermissionChecker().holds(permission);
        }),
      );

    const [aHoldsOwn, bHoldsOwn, aHoldsBs, bHoldsAs] = await Promise.all([
      request('leave.read', ['leave.read']),
      request('payroll.read', ['payroll.read']),
      request('payroll.read', ['leave.read']),
      request('leave.read', ['payroll.read']),
    ]);

    expect([aHoldsOwn, bHoldsOwn]).toEqual([true, true]);
    expect([aHoldsBs, bHoldsAs]).toEqual([false, false]);
  });

  it('leaves nothing behind once a request ends', async () => {
    await runInContext(tenantContext(), () =>
      runWithGrants(new Set(['leave.read']), () =>
        new PlatformPermissionChecker().holds('leave.read'),
      ),
    );

    expect(await new PlatformPermissionChecker().holds('leave.read')).toBe(false);
  });

  it('does not leak out of a nested scope into the request that opened it', async () => {
    const outer = await runInContext(tenantContext(), () =>
      runWithGrants(new Set(['leave.read']), async () => {
        const inner = await runWithGrants(new Set(['payroll.read']), () =>
          new PlatformPermissionChecker().holds('payroll.read'),
        );
        const after = await new PlatformPermissionChecker().holds('payroll.read');

        return { inner, after };
      }),
    );

    expect(outer).toEqual({ inner: true, after: false });
  });
});
