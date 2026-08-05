import { describe, expect, it } from 'vitest';

import { uuidV7 } from '../identity/uuid-v7.js';

import { InMemoryFeatureFlags } from './in-memory-feature-flags.js';

const tenantA = uuidV7();
const tenantB = uuidV7();
const pilotUser = uuidV7();

describe('InMemoryFeatureFlags', () => {
  const flags = new InMemoryFeatureFlags([
    {
      key: 'leave.hourly',
      enabledByDefault: false,
      tenantOverrides: { [tenantA]: true },
      userOverrides: { [pilotUser]: false },
    },
  ]);

  it('returns the default when nothing overrides it', async () => {
    expect(await flags.isEnabled('leave.hourly', { tenantId: tenantB })).toBe(false);
  });

  it('lets a tenant override the default', async () => {
    expect(await flags.isEnabled('leave.hourly', { tenantId: tenantA })).toBe(true);
  });

  it('lets a user override their tenant, which is what a pilot group needs', async () => {
    expect(await flags.isEnabled('leave.hourly', { tenantId: tenantA, userId: pilotUser })).toBe(
      false,
    );
  });

  it('treats an unknown flag as off, never as on', async () => {
    expect(await flags.isEnabled('nobody.defined.this', { tenantId: tenantA })).toBe(false);
  });

  it('declares every flag for the administration screen', () => {
    expect(flags.declared().map((flag) => flag.key)).toEqual(['leave.hourly']);
  });
});
