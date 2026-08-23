import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { InvestigationRecord } from '../domain/investigation.js';
import type { ViolationRecord } from '../domain/violation.js';
import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';
import { CATEGORY, givenViolation, openInquiry } from './relations-case.fixture.js';

/**
 * Checkpoint 3's database guarantees, proved against a real PostgreSQL because each of them is the
 * database's rather than the application's:
 *
 *   * **The corrected row is never written to.** Asserted by reading it back byte-for-byte after a
 *     correction, and by watching the Checkpoint 2 trigger still refuse every direct update — the
 *     trigger was not narrowed, weakened or given an exception for corrections.
 *   * **A conclusion is corrected at most once**, settled by `relation_investigation_corrects_idx`
 *     under **two real connections contending**, not by a preceding read and not by a sleep.
 *   * **The window query is tenant-isolated**, as an unprivileged role that cannot bypass RLS — so a
 *     neighbouring tenant's violations cannot inflate somebody's repeat count.
 */

requireDatabaseInCi('Relations corrections');

describe.skipIf(CONNECTION === undefined)('corrections and the repeat window', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_correction_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const concludedInquiry = async (
    violationId: string,
    tenantId: string = TENANT_A,
  ): Promise<string> =>
    openInquiry(fixture, violationId, tenantId, {
      state: 'concluded',
      findings: 'The absences were unnotified.',
      recommendation: 'A written warning.',
      concludedOn: '2026-08-22',
    });

  const correctionOf = async (
    violationId: string,
    correctsInvestigationId: string,
    tenantId: string = TENANT_A,
    overrides: Partial<InvestigationRecord> = {},
  ): Promise<string> =>
    openInquiry(fixture, violationId, tenantId, {
      state: 'concluded',
      findings: 'The third absence was authorized leave recorded late.',
      recommendation: 'No action.',
      concludedOn: '2026-08-22',
      correctsInvestigationId,
      ...overrides,
    });

  describe('the corrected conclusion', () => {
    it('is byte-for-byte unchanged after being corrected', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);

      const before = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.byId(transaction, originalId),
      );

      await correctionOf(violationId, originalId);

      const after = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.byId(transaction, originalId),
      );

      // Every field, including `version` — a correction writes nothing to what it corrects.
      expect(after).toStrictEqual(before);
      expect(after?.findings).toBe('The absences were unnotified.');
    });

    /**
     * The Checkpoint 2 trigger is **unchanged**, and this is the assertion that proves D-5.2-17 was
     * not quietly reopened to make corrections convenient. `letter_issued` had to narrow its trigger
     * for a forward pointer; a backward pointer needs no such exception, and here is the evidence.
     */
    it('still refuses every direct update, exactly as Checkpoint 2 left it', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);

      await correctionOf(violationId, originalId);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`update relation_investigation set findings = $2 where id = $1`, [
            originalId,
            'Something more favourable.',
          ]),
        ),
      ).rejects.toThrow(/relation_investigation_concluded/);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`delete from relation_investigation where id = $1`, [originalId]),
        ),
      ).rejects.toThrow(/relation_investigation_concluded/);
    });
  });

  describe('the correction', () => {
    it('links backward and is readable as a chain', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);
      const correctionId = await correctionOf(violationId, originalId);

      const chain = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.chainFor(transaction, violationId),
      );

      expect(chain).toHaveLength(2);
      expect(
        chain.find((held) => held.investigationId === correctionId)?.correctsInvestigationId,
      ).toBe(originalId);
      // The corrected row carries no forward pointer — nothing was stamped on it.
      expect(
        chain.find((held) => held.investigationId === originalId)?.correctsInvestigationId,
      ).toBeUndefined();
    });

    it('refuses a second correction of one conclusion', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);

      await correctionOf(violationId, originalId);

      await expect(correctionOf(violationId, originalId)).rejects.toThrow(
        /relation_investigation_corrects_idx/,
      );
    });

    it('refuses to correct itself', async () => {
      const violationId = await givenViolation(fixture);
      const investigationId = uuidV7();

      await expect(
        correctionOf(violationId, investigationId, TENANT_A, { investigationId }),
      ).rejects.toThrow(/relation_investigation_corrects_self_check/);
    });

    /** A correction is a conclusion. An open one would be a draft of a correction, which is not a thing. */
    it('refuses a correction that claims to still be open', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);

      await expect(
        openInquiry(fixture, violationId, TENANT_A, { correctsInvestigationId: originalId }),
      ).rejects.toThrow(/relation_investigation_correction_concluded_check/);
    });

    /**
     * **Two real connections, contending for real.** Both read the same uncorrected conclusion, both
     * compute the same correction, both attempt the insert. The unique index arbitrates — no sleep,
     * no fake timer, and no assertion about which one wins, because asserting a winner would be
     * asserting a race.
     */
    it('lets exactly one correction of a conclusion commit', async () => {
      const violationId = await givenViolation(fixture);
      const originalId = await concludedInquiry(violationId);

      const outcomes = await Promise.allSettled([
        correctionOf(violationId, originalId),
        correctionOf(violationId, originalId),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');

      expect(String((rejected as PromiseRejectedResult).reason)).toMatch(
        /relation_investigation_corrects_idx/,
      );

      const chain = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.investigations.chainFor(transaction, violationId),
      );

      expect(chain.filter((held) => held.correctsInvestigationId === originalId)).toHaveLength(1);
    });

    it("hides one tenant's correction chain from another", async () => {
      const violationId = await givenViolation(fixture, TENANT_A);
      const originalId = await concludedInquiry(violationId, TENANT_A);

      await correctionOf(violationId, originalId, TENANT_A);

      const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.investigations.chainFor(transaction, violationId),
      );

      expect(seenByB).toStrictEqual([]);
    });
  });

  describe('the repeat window', () => {
    const violationOn = async (
      employmentId: string,
      categoryId: string,
      occurredOn: string,
      tenantId: string = TENANT_A,
    ): Promise<string> => {
      const violationId = uuidV7();

      await fixture.asTenant(tenantId, (transaction) =>
        fixture.stores.violations.insert(transaction, {
          violationId,
          employmentId,
          violationCategoryId: categoryId,
          categoryCode: CATEGORY.code,
          severity: CATEGORY.severity,
          occurredOn,
          reportedBy: 'user:officer',
          description: 'Absent without notice.',
          state: 'reported',
          recordedAt: new Date('2026-08-22T09:00:00Z'),
          version: 1,
        } satisfies ViolationRecord),
      );
      return violationId;
    };

    const categoryIn = async (tenantId: string): Promise<string> => {
      const categoryId = uuidV7();

      await fixture.asTenant(tenantId, (transaction) =>
        fixture.stores.categories.insert(transaction, {
          ...CATEGORY,
          violationCategoryId: categoryId,
        }),
      );
      return categoryId;
    };

    /** `between … and` is inclusive at both ends in SQL; the domain says so too, and here they meet. */
    it('includes both boundary days and excludes the day outside', async () => {
      const employmentId = uuidV7();
      const categoryId = await categoryIn(TENANT_A);

      await violationOn(employmentId, categoryId, '2026-02-23');
      const onBoundary = await violationOn(employmentId, categoryId, '2026-02-24');
      const onReference = await violationOn(employmentId, categoryId, '2026-08-23');

      const found = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.violations.inCategoryWindow(transaction, employmentId, categoryId, {
          from: '2026-02-24',
          to: '2026-08-23',
        }),
      );

      expect(found.map((violation) => violation.violationId)).toStrictEqual([
        onBoundary,
        onReference,
      ]);
    });

    it("does not count another tenant's violations", async () => {
      const employmentId = uuidV7();
      const categoryA = await categoryIn(TENANT_A);
      const categoryB = await categoryIn(TENANT_B);

      await violationOn(employmentId, categoryA, '2026-08-01', TENANT_A);
      await violationOn(employmentId, categoryB, '2026-08-02', TENANT_B);

      const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.violations.inCategoryWindow(transaction, employmentId, categoryA, {
          from: '2026-02-24',
          to: '2026-08-23',
        }),
      );

      // The same employment identifier in both tenants; row-level security answers before the
      // predicate does, which is what stops a neighbouring tenant inflating a repeat count.
      expect(seenByA).toHaveLength(1);
      expect(seenByA[0]?.occurredOn).toBe('2026-08-01');
    });

    it('returns same-day violations in a deterministic order', async () => {
      const employmentId = uuidV7();
      const categoryId = await categoryIn(TENANT_A);
      const first = await violationOn(employmentId, categoryId, '2026-08-01');
      const second = await violationOn(employmentId, categoryId, '2026-08-01');

      const found = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.violations.inCategoryWindow(transaction, employmentId, categoryId, {
          from: '2026-02-24',
          to: '2026-08-23',
        }),
      );

      // `order by occurred_on, id` — uuidV7 is time-ordered, so insertion order and identifier order
      // agree here, and the assertion is that the *identifier* decides rather than the heap.
      expect(found.map((violation) => violation.violationId)).toStrictEqual(
        [first, second].sort((left, right) => left.localeCompare(right)),
      );
    });
  });
});
