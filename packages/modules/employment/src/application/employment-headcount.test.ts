import { describe, expect, it } from 'vitest';
import { NotEntitledException } from '@work/kernel';

import { inMemoryEmploymentStores } from './in-memory-stores.js';
import type { HeadcountLicence } from './employment-ports.js';
import {
  ALL,
  TENANT_A,
  TENANT_B,
  anActiveEmployment,
  anEmployment,
  asTenant,
  harnessWithStores,
  send,
} from './employment-test-harness.js';

/** A licence for `ceiling` open employments, decided the way the platform's gate decides it. */
const licensedFor = (ceiling: number | null) => {
  const counted: number[] = [];
  const licence: HeadcountLicence = {
    admitHeadcount: async (requested, countOpen) => {
      if (ceiling === null) return;
      const open = await countOpen();
      counted.push(open);
      if (open + requested > ceiling) {
        throw new NotEntitledException('QUOTA_EXCEEDED', 'licensed headcount reached');
      }
    },
  };
  return { licence, counted };
};

describe('the licensed headcount', () => {
  it('refuses the employment past the ceiling, and records nothing for it', () =>
    asTenant(TENANT_A, async () => {
      const stores = inMemoryEmploymentStores();
      const { licence } = licensedFor(2);
      const harness = harnessWithStores(TENANT_A, stores, ALL, undefined, licence);

      await anEmployment(harness);
      await anEmployment(harness);
      await expect(anEmployment(harness)).rejects.toThrow(NotEntitledException);

      const all = await harness.work.execute((transaction) => stores.employments.all(transaction));
      expect(all).toHaveLength(2);
    }));

  it('counts open employments only, so ending one frees its place', () =>
    asTenant(TENANT_A, async () => {
      const { licence } = licensedFor(1);
      const harness = harnessWithStores(
        TENANT_A,
        inMemoryEmploymentStores(),
        ALL,
        undefined,
        licence,
      );
      const first = await anActiveEmployment(harness);
      await expect(anEmployment(harness)).rejects.toThrow(NotEntitledException);

      const ended = await send(harness, {
        commandName: 'employment.end-employment',
        employmentId: first.employmentId,
        endDate: '2026-06-30',
        endReasonCode: 'resignation',
        expectedVersion: 2,
      });
      expect(ended.ok).toBe(true);
      await expect(anEmployment(harness)).resolves.toBeDefined();
    }));

  it("counts this tenant's employments, never another's", async () => {
    const stores = inMemoryEmploymentStores();
    const other = harnessWithStores(TENANT_B, stores);
    await asTenant(TENANT_B, async () => {
      await anEmployment(other);
      await anEmployment(other);
    });
    const { licence, counted } = licensedFor(1);
    const harness = harnessWithStores(TENANT_A, stores, ALL, undefined, licence);
    await asTenant(TENANT_A, () => anEmployment(harness));
    expect(counted).toEqual([0]);
  });

  it('an unlimited plan counts nothing', () =>
    asTenant(TENANT_A, async () => {
      const { licence, counted } = licensedFor(null);
      const harness = harnessWithStores(
        TENANT_A,
        inMemoryEmploymentStores(),
        ALL,
        undefined,
        licence,
      );
      await anEmployment(harness);
      expect(counted).toEqual([]);
    }));
});
