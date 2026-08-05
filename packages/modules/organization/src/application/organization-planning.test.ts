import { beforeEach, describe, expect, it } from 'vitest';
import { assertFailedWith, assertSucceeded } from '@work/testing';

import type { EstablishmentPostureView } from '../contracts/views.js';

import {
  JANUARY,
  JUNE,
  MARCH,
  SEPTEMBER,
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  StubbedFilledHeadcount,
  type Harness,
} from './organization-test-harness.js';

/**
 * Manpower planning, calendars, and moving a structure in and out.
 *
 * The establishment tests matter most, because they are the ones that touch the line between
 * this module and Employment. Organization owns the *budgeted* number; the *filled* number comes
 * from Employment's assignment events and is zero until Phase 5 exists (AD-002). The projection
 * has to be right when a real count arrives, so the filled port is stubbed here rather than left
 * at zero — a suite that could only ever see zero would prove nothing about the arithmetic.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

const aUnitAndPosition = async (
  harness: Harness,
): Promise<{ unitId: string; positionId: string }> => {
  const type = assertSucceeded(
    await send<{ unitTypeId: string }>(harness, {
      commandName: 'organization.define-unit-type',
      code: 'unit',
      name: bilingual('Unit', 'وحدة'),
      ordinal: 10,
    }),
  ).unitTypeId;
  const unitId = assertSucceeded(
    await send<{ unitId: string }>(harness, {
      commandName: 'organization.create-unit',
      unitTypeId: type,
      code: 'RUH',
      name: bilingual('Riyadh', 'الرياض'),
      effectiveFrom: JANUARY,
    }),
  ).unitId;
  const positionId = assertSucceeded(
    await send<{ positionId: string }>(harness, {
      commandName: 'organization.define-position',
      code: 'HR-MGR',
      title: bilingual('HR Manager', 'مدير الموارد البشرية'),
      effectiveFrom: JANUARY,
    }),
  ).positionId;

  return { unitId, positionId };
};

const setAndApprove = async (
  harness: Harness,
  positionId: string,
  unitId: string,
  budgetedHeadcount: number,
  effectiveFrom: Date,
): Promise<void> => {
  const line = assertSucceeded(
    await send<{ establishmentId: string }>(harness, {
      commandName: 'organization.set-establishment',
      positionId,
      unitId,
      budgetedHeadcount,
      effectiveFrom,
    }),
  ).establishmentId;

  assertSucceeded(
    await send(harness, {
      commandName: 'organization.approve-establishment',
      establishmentId: line,
      expectedVersion: 1,
    }),
  );
};

const posture = async (
  harness: Harness,
  unitId: string,
  asOf: Date,
): Promise<readonly EstablishmentPostureView[]> =>
  assertSucceeded(
    await ask<readonly EstablishmentPostureView[]>(harness, {
      queryName: 'organization.establishment-posture',
      unitId,
      asOf,
    }),
  );

describe('the establishment', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('reports zero approved until somebody approves it, so a draft budget recruits nobody', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { unitId, positionId } = await aUnitAndPosition(harness);

      assertSucceeded(
        await send(harness, {
          commandName: 'organization.set-establishment',
          positionId,
          unitId,
          budgetedHeadcount: 4,
          effectiveFrom: JANUARY,
        }),
      );

      expect(await posture(harness, unitId, MARCH)).toEqual([
        { positionId, unitId, asOf: MARCH, approved: 0, filled: 0, vacant: 0 },
      ]);
    }));

  it("keeps last year's approved figure when this year's supersedes it", async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { unitId, positionId } = await aUnitAndPosition(harness);

      await setAndApprove(harness, positionId, unitId, 3, JANUARY);
      await setAndApprove(harness, positionId, unitId, 8, JUNE);

      // The question an audit asks. A mutable number could not answer it.
      expect((await posture(harness, unitId, MARCH))[0]?.approved).toBe(3);
      expect((await posture(harness, unitId, SEPTEMBER))[0]?.approved).toBe(8);
    }));

  it('computes vacancies from a count Employment supplies, and never counts anybody itself', async () =>
    asTenant(TENANT_A, async () => {
      const filled = new StubbedFilledHeadcount();
      const harness = harnessFor(TENANT_A, undefined, filled);
      const { unitId, positionId } = await aUnitAndPosition(harness);

      await setAndApprove(harness, positionId, unitId, 10, JANUARY);
      filled.set(positionId, unitId, 4);

      expect(await posture(harness, unitId, MARCH)).toEqual([
        { positionId, unitId, asOf: MARCH, approved: 10, filled: 4, vacant: 6 },
      ]);
    }));

  it('reports no vacancies rather than a negative count when a unit is over-established', async () =>
    asTenant(TENANT_A, async () => {
      const filled = new StubbedFilledHeadcount();
      const harness = harnessFor(TENANT_A, undefined, filled);
      const { unitId, positionId } = await aUnitAndPosition(harness);

      await setAndApprove(harness, positionId, unitId, 3, JANUARY);
      filled.set(positionId, unitId, 5);

      expect((await posture(harness, unitId, MARCH))[0]).toMatchObject({ filled: 5, vacant: 0 });
    }));

  it('refuses a budget against a position or a unit that does not exist here', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { unitId, positionId } = await aUnitAndPosition(harness);

      assertFailedWith(
        await send(harness, {
          commandName: 'organization.set-establishment',
          positionId: 'no-such-position',
          unitId,
          budgetedHeadcount: 1,
          effectiveFrom: JANUARY,
        }),
        'not_found',
      );
      assertFailedWith(
        await send(harness, {
          commandName: 'organization.set-establishment',
          positionId,
          unitId: 'no-such-unit',
          budgetedHeadcount: 1,
          effectiveFrom: JANUARY,
        }),
        'not_found',
      );
    }));
});

describe('a calendar', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('records an exception day once, replacing rather than duplicating it', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const calendarId = assertSucceeded(
        await send<{ calendarId: string }>(harness, {
          commandName: 'organization.define-calendar',
          code: 'CORP',
          name: bilingual('Corporate', 'المؤسسي'),
          timeZone: 'Asia/Riyadh',
          workingDays: [7, 1, 2, 3, 4],
          effectiveFrom: JANUARY,
        }),
      ).calendarId;

      const day = {
        onDate: '2027-03-20',
        kind: 'holiday',
        name: bilingual('Eid al-Fitr', 'عيد الفطر'),
      };

      assertSucceeded(
        await send(harness, {
          commandName: 'organization.record-calendar-day',
          calendarId,
          ...day,
        }),
      );
      assertSucceeded(
        await send(harness, {
          commandName: 'organization.record-calendar-day',
          calendarId,
          ...day,
          kind: 'non-working',
        }),
      );

      // Two facts about the same date is what makes a working-day count ambiguous, which is a
      // leave balance that differs depending on which row was read.
      const stored = await harness.work.execute((transaction) =>
        harness.stores.calendars.dayOn(transaction, calendarId, '2027-03-20'),
      );

      expect(stored?.kind).toBe('non-working');
    }));

  it("refuses a day on a calendar that is not this tenant's", async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertFailedWith(
        await send(harness, {
          commandName: 'organization.record-calendar-day',
          calendarId: 'no-such-calendar',
          onDate: '2027-03-20',
          kind: 'holiday',
          name: bilingual('Eid', 'عيد'),
        }),
        'not_found',
      );
    }));
});
