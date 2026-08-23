import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { DisciplinaryRuleState } from '../domain/disciplinary-ladder.js';
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
 * Checkpoint 4's database guarantees, proved against a real PostgreSQL:
 *
 *   * **An issued action cannot be rewritten**, from any path including SQL nobody wrote in
 *     TypeScript. Somebody may be dismissed on the strength of one.
 *   * **One rung per threshold and one action per case**, settled by unique indexes under **two real
 *     connections contending** — not by a preceding read, and not by a sleep.
 *   * **The closed action vocabulary is the database's**, so a value this product cannot represent
 *     cannot be stored even by an operator.
 *   * **Tenant isolation**, as an unprivileged role that cannot bypass row-level security, asserted
 *     in both directions: a tenant sees its own rows and none of its neighbour's.
 */

requireDatabaseInCi('Relations disciplinary actions');

describe.skipIf(CONNECTION === undefined)('the ladder and the actions issued from it', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_disciplinary_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const categoryIn = async (tenantId: string): Promise<string> => {
    const violationCategoryId = uuidV7();

    await fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.categories.insert(transaction, { ...CATEGORY, violationCategoryId }),
    );
    return violationCategoryId;
  };

  const ruleFor = async (
    violationCategoryId: string,
    overrides: Partial<DisciplinaryRuleState> = {},
    tenantId: string = TENANT_A,
  ): Promise<string> => {
    const disciplinaryRuleId = overrides.disciplinaryRuleId ?? uuidV7();

    await fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.disciplinaryRules.insert(transaction, {
        disciplinaryRuleId,
        violationCategoryId,
        minOccurrence: 1,
        action: 'verbal_warning',
        sequence: 10,
        active: true,
        version: 1,
        ...overrides,
      }),
    );
    return disciplinaryRuleId;
  };

  const issuedAction = async (
    violationId: string,
    investigationId: string,
    tenantId: string = TENANT_A,
    overrides: Record<string, unknown> = {},
  ): Promise<string> => {
    const disciplinaryActionId = (overrides.disciplinaryActionId as string | undefined) ?? uuidV7();

    await fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.disciplinaryActions.insert(transaction, {
        disciplinaryActionId,
        violationId,
        investigationId,
        action: 'written_warning',
        prescribedByRule: false,
        occurrenceAtIssue: 1,
        reason: 'The inquiry confirmed the absences.',
        issuedBy: 'user:relations-officer',
        issuedOn: '2026-08-22',
        issuedAt: new Date('2026-08-22T09:00:00Z'),
        correlationId: uuidV7(),
        version: 1,
        ...overrides,
      }),
    );
    return disciplinaryActionId;
  };

  const concludedCase = async (
    tenantId: string = TENANT_A,
  ): Promise<{ violationId: string; investigationId: string }> => {
    const violationId = await givenViolation(fixture, tenantId);
    const investigationId = await openInquiry(fixture, violationId, tenantId, {
      state: 'concluded',
      findings: 'The absences were unnotified.',
      recommendation: 'A written warning.',
      concludedOn: '2026-08-22',
    });

    return { violationId, investigationId };
  };

  describe('the ladder', () => {
    it('refuses two active rungs at one threshold', async () => {
      const violationCategoryId = await categoryIn(TENANT_A);

      await ruleFor(violationCategoryId, { minOccurrence: 3 });

      await expect(ruleFor(violationCategoryId, { minOccurrence: 3 })).rejects.toThrow(
        /relation_disciplinary_rule_threshold_idx/,
      );
    });

    /** A deactivated rung does not block its replacement — the index is partial for exactly this. */
    it('allows a replacement once the old rung leaves service', async () => {
      const violationCategoryId = await categoryIn(TENANT_A);
      const retiring = await ruleFor(violationCategoryId, { minOccurrence: 3 });

      await fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update relation_disciplinary_rule set active = false, version = version + 1 where id = $1`,
          [retiring],
        ),
      );

      await expect(
        ruleFor(violationCategoryId, { minOccurrence: 3, action: 'final_warning' }),
      ).resolves.toBeTruthy();
    });

    it('refuses an action outside the closed vocabulary, even from raw SQL', async () => {
      const violationCategoryId = await categoryIn(TENANT_A);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into relation_disciplinary_rule
               (tenant_id, violation_category_id, min_occurrence, action_code, sequence,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, 1, 'termination', 10, now(), 'a', now(), 'a', 1)`,
            [TENANT_A, violationCategoryId],
          ),
        ),
      ).rejects.toThrow(/relation_disciplinary_rule_action_check/);
    });

    it('refuses a threshold below one', async () => {
      const violationCategoryId = await categoryIn(TENANT_A);

      await expect(ruleFor(violationCategoryId, { minOccurrence: 0 })).rejects.toThrow(
        /relation_disciplinary_rule_occurrence_check/,
      );
    });

    /** Two administrators configuring the same rung at the same moment. The index arbitrates. */
    it('lets exactly one of two simultaneous identical rungs commit', async () => {
      const violationCategoryId = await categoryIn(TENANT_A);

      const outcomes = await Promise.allSettled([
        ruleFor(violationCategoryId, { minOccurrence: 5 }),
        ruleFor(violationCategoryId, { minOccurrence: 5 }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(
        String(
          (outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult)
            .reason,
        ),
      ).toMatch(/relation_disciplinary_rule_threshold_idx/);
    });

    it("hides one tenant's ladder from another", async () => {
      const violationCategoryId = await categoryIn(TENANT_A);

      await ruleFor(violationCategoryId);

      const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.disciplinaryRules.forCategory(transaction, violationCategoryId, true),
      );
      const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.disciplinaryRules.forCategory(transaction, violationCategoryId, true),
      );

      expect(seenByB).toStrictEqual([]);
      // …and the row is really there, so the assertion above is about isolation rather than about
      // the fixture having failed to write anything.
      expect(seenByA).toHaveLength(1);
    });
  });

  describe('an issued action', () => {
    it('refuses an update of what was issued', async () => {
      const { violationId, investigationId } = await concludedCase();

      await issuedAction(violationId, investigationId);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `update relation_disciplinary_action set action_code = 'verbal_warning'
               where violation_id = $1`,
            [violationId],
          ),
        ),
      ).rejects.toThrow(/relation_disciplinary_action_immutable/);
    });

    it('refuses a delete, and a soft delete for the same reason', async () => {
      const { violationId, investigationId } = await concludedCase();

      await issuedAction(violationId, investigationId);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(`delete from relation_disciplinary_action where violation_id = $1`, [
            violationId,
          ]),
        ),
      ).rejects.toThrow(/relation_disciplinary_action_immutable/);

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `update relation_disciplinary_action set deleted_at = now(), deleted_by = 'test'
               where violation_id = $1`,
            [violationId],
          ),
        ),
      ).rejects.toThrow(/relation_disciplinary_action_immutable/);
    });

    it('refuses a second action on one case', async () => {
      const { violationId, investigationId } = await concludedCase();

      await issuedAction(violationId, investigationId);

      await expect(issuedAction(violationId, investigationId)).rejects.toThrow(
        /relation_disciplinary_action_violation_idx/,
      );
    });

    /** Two officers issuing at the same moment. Exactly one commits; the index decides. */
    it('lets exactly one of two simultaneous actions commit', async () => {
      const { violationId, investigationId } = await concludedCase();

      const outcomes = await Promise.allSettled([
        issuedAction(violationId, investigationId),
        issuedAction(violationId, investigationId),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(
        String(
          (outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult)
            .reason,
        ),
      ).toMatch(/relation_disciplinary_action_violation_idx/);
    });

    /** A row claiming a rule prescribed it while naming none is a row nobody can audit. */
    it('refuses a prescription claim with no rule behind it', async () => {
      const { violationId, investigationId } = await concludedCase();

      await expect(
        issuedAction(violationId, investigationId, TENANT_A, { prescribedByRule: true }),
      ).rejects.toThrow(/relation_disciplinary_action_prescription_check/);
    });

    it("hides one tenant's issued actions from another", async () => {
      const { violationId, investigationId } = await concludedCase(TENANT_A);

      await issuedAction(violationId, investigationId, TENANT_A);

      const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.disciplinaryActions.forViolation(transaction, violationId),
      );
      const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.disciplinaryActions.forViolation(transaction, violationId),
      );

      expect(seenByB).toBeUndefined();
      expect(seenByA?.violationId).toBe(violationId);
    });

    it('keeps the issue date as a civil date rather than an instant', async () => {
      const { violationId, investigationId } = await concludedCase();

      await issuedAction(violationId, investigationId);

      const held = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.disciplinaryActions.forViolation(transaction, violationId),
      );

      // The `to_char` projection, asserted — a `Date` here would break every civil-date comparison
      // in this module, which is the defect Checkpoint 3 found and fixed.
      expect(held?.issuedOn).toBe('2026-08-22');
    });
  });

  describe('row-level security', () => {
    it('is enabled and forced on both new tables', async () => {
      const protection = await fixture.admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
           where relname in ('relation_disciplinary_rule', 'relation_disciplinary_action')
           order by relname`,
      );

      expect(protection.rows).toStrictEqual([
        {
          relname: 'relation_disciplinary_action',
          relrowsecurity: true,
          relforcerowsecurity: true,
        },
        { relname: 'relation_disciplinary_rule', relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });
  });
});
