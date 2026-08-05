import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';

import type { GoverningLegalEntity } from '../contracts/views.js';

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
  type Harness,
} from './organization-test-harness.js';

/**
 * Which country's law governs a unit — the query Phase 11.1 depends on.
 *
 * 00B is explicit: *an employment resolves its country pack from its legal entity, not from the
 * tenant, and a tenant may operate in several countries at once.* This suite is that sentence
 * made checkable. The structure it builds is deliberately the shape that breaks a tenant-level
 * country: **one tenant, two countries**, with teams under each.
 *
 * If this design were wrong, everything downstream would still compile and still run — and
 * somebody's end-of-service payment would be computed under the wrong country's law and look
 * entirely plausible. That is why these assertions are here rather than in Phase 11.1.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

interface Ids {
  readonly saudiCompany: string;
  readonly jordanCompany: string;
  readonly riyadhTeam: string;
  readonly ammanTeam: string;
  readonly unplacedTeam: string;
}

/** A group with a Saudi company and a Jordanian one, each with a team three levels down. */
const aGroupInTwoCountries = async (harness: Harness): Promise<Ids> => {
  const entityType = assertSucceeded(
    await send<{ unitTypeId: string }>(harness, {
      commandName: 'organization.define-unit-type',
      code: 'legal-entity',
      name: bilingual('Legal entity', 'كيان قانوني'),
      ordinal: 20,
      carriesLegalEntity: true,
    }),
  ).unitTypeId;
  const plainType = assertSucceeded(
    await send<{ unitTypeId: string }>(harness, {
      commandName: 'organization.define-unit-type',
      code: 'unit',
      name: bilingual('Unit', 'وحدة'),
      ordinal: 50,
    }),
  ).unitTypeId;

  const unit = async (typeId: string, code: string): Promise<string> =>
    assertSucceeded(
      await send<{ unitId: string }>(harness, {
        commandName: 'organization.create-unit',
        unitTypeId: typeId,
        code,
        name: bilingual(code, `${code} بالعربية`),
        effectiveFrom: JANUARY,
      }),
    ).unitId;

  const saudiCompany = await unit(entityType, 'SA-CO');
  const jordanCompany = await unit(entityType, 'JO-CO');
  const riyadhBranch = await unit(plainType, 'RUH');
  const ammanBranch = await unit(plainType, 'AMM');
  const riyadhTeam = await unit(plainType, 'RUH-TEAM');
  const ammanTeam = await unit(plainType, 'AMM-TEAM');
  const unplacedTeam = await unit(plainType, 'ORPHAN');

  const place = async (unitId: string, parentUnitId: string | undefined): Promise<void> => {
    assertSucceeded(
      await send(harness, {
        commandName: 'organization.place-unit',
        unitId,
        ...(parentUnitId === undefined ? {} : { parentUnitId }),
        effectiveFrom: JANUARY,
      }),
    );
  };

  await place(saudiCompany, undefined);
  await place(jordanCompany, undefined);
  await place(riyadhBranch, saudiCompany);
  await place(ammanBranch, jordanCompany);
  await place(riyadhTeam, riyadhBranch);
  await place(ammanTeam, ammanBranch);

  assertSucceeded(
    await send(harness, {
      commandName: 'organization.register-legal-entity',
      unitId: saudiCompany,
      countryCode: 'SA',
      registeredName: bilingual('Munaxa Arabia Ltd', 'مناكسا العربية المحدودة'),
      registrationNumber: '1010123456',
      currencyCode: 'SAR',
      effectiveFrom: JANUARY,
    }),
  );
  assertSucceeded(
    await send(harness, {
      commandName: 'organization.register-legal-entity',
      unitId: jordanCompany,
      countryCode: 'JO',
      registeredName: bilingual('Munaxa Jordan PSC', 'مناكسا الأردن'),
      registrationNumber: '200123',
      currencyCode: 'JOD',
      effectiveFrom: JANUARY,
    }),
  );

  return { saudiCompany, jordanCompany, riyadhTeam, ammanTeam, unplacedTeam };
};

const governing = async (
  harness: Harness,
  unitId: string,
  asOf?: Date,
): Promise<GoverningLegalEntity> =>
  assertSucceeded(
    await ask<GoverningLegalEntity>(harness, {
      queryName: 'organization.governing-legal-entity',
      unitId,
      ...(asOf === undefined ? {} : { asOf }),
    }),
  );

describe('the country an employment would be governed by', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('comes from the nearest legal entity above the unit, not from the tenant', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);

      const riyadh = await governing(harness, ids.riyadhTeam, MARCH);
      const amman = await governing(harness, ids.ammanTeam, MARCH);

      // One tenant. Two countries. Two currencies. This is the assertion a tenant-level country
      // cannot satisfy without a second tenant per country.
      expect(riyadh.legalEntity?.countryCode).toBe('SA');
      expect(riyadh.legalEntity?.currencyCode).toBe('SAR');
      expect(amman.legalEntity?.countryCode).toBe('JO');
      expect(amman.legalEntity?.currencyCode).toBe('JOD');
    }));

  it('reports the chain it walked, so the answer can be checked rather than trusted', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const riyadh = await governing(harness, ids.riyadhTeam, MARCH);

      // The units passed through on the way up, excluding the one that answered — so a caller
      // can see the branch the team sits in, and `legalEntity.unitId` names the company itself.
      expect(riyadh.throughUnitIds).toHaveLength(1);
      expect(riyadh.legalEntity?.unitId).toBe(ids.saudiCompany);
    }));

  it("is the unit's own registration when the unit carries one", async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const company = await governing(harness, ids.saudiCompany, MARCH);

      expect(company.legalEntity?.countryCode).toBe('SA');
      expect(company.throughUnitIds).toEqual([]);
    }));

  it('follows the structure, so a unit moved between countries changes the law it answers to', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);

      // The Riyadh team is transferred to the Jordanian company in June. Everything before June
      // was Saudi and stays Saudi; everything after is Jordanian.
      assertSucceeded(
        await send(harness, {
          commandName: 'organization.place-unit',
          unitId: ids.riyadhTeam,
          parentUnitId: ids.jordanCompany,
          effectiveFrom: JUNE,
        }),
      );

      expect((await governing(harness, ids.riyadhTeam, MARCH)).legalEntity?.countryCode).toBe('SA');
      expect((await governing(harness, ids.riyadhTeam, SEPTEMBER)).legalEntity?.countryCode).toBe(
        'JO',
      );
    }));

  it('answers nothing rather than defaulting, when no registration governs the unit', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const orphan = await governing(harness, ids.unplacedTeam, MARCH);

      // A tenant-level fallback is exactly the mistake 00B names. It would silently compute
      // somebody's end of service under a country nobody chose, and produce a plausible number.
      expect(orphan.legalEntity).toBeUndefined();
    }));

  it('stops answering for dates after a registration is closed', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const before = await governing(harness, ids.riyadhTeam, MARCH);
      const entity = before.legalEntity;

      if (entity === undefined) throw new Error('setup');
      assertSucceeded(
        await send(harness, {
          commandName: 'organization.close-legal-entity',
          legalEntityId: entity.id,
          effectiveTo: JUNE,
          expectedVersion: entity.version,
        }),
      );

      expect((await governing(harness, ids.riyadhTeam, MARCH)).legalEntity?.countryCode).toBe('SA');
      expect((await governing(harness, ids.riyadhTeam, SEPTEMBER)).legalEntity).toBeUndefined();
    }));

  it('refuses a registration on a level the tenant says does not carry one', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const refused = await send(harness, {
        commandName: 'organization.register-legal-entity',
        unitId: ids.riyadhTeam,
        countryCode: 'SA',
        registeredName: bilingual('Team Ltd', 'الفريق المحدودة'),
        registrationNumber: '999',
        currencyCode: 'SAR',
        effectiveFrom: JANUARY,
      });

      expect(refused.ok === false && refused.error).toMatchObject({
        kind: 'rejected',
        reason: 'organization.rejection.unit_type_carries_no_legal_entity',
      });
    }));

  it('refuses a second registration on the same unit', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const ids = await aGroupInTwoCountries(harness);
      const refused = await send(harness, {
        commandName: 'organization.register-legal-entity',
        unitId: ids.saudiCompany,
        countryCode: 'AE',
        registeredName: bilingual('Another', 'آخر'),
        registrationNumber: '777',
        currencyCode: 'AED',
        effectiveFrom: JANUARY,
      });

      // Two registrations would be two countries for the same node, and every statutory figure
      // beneath it would depend on which row was read first.
      expect(refused.ok === false && refused.error).toMatchObject({
        kind: 'conflict',
        reason: 'unit_already_registered',
      });
    }));
});
