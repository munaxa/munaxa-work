import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';

/**
 * AD-003, proved at the database: **a disciplinary record cannot be edited or deleted, from any
 * path**.
 *
 * The application layer offers no method that could — `ViolationStore` has no `update` and no
 * `remove`. This suite asks the harder question: what happens when somebody bypasses the application
 * entirely and writes SQL. A guard that only lives in TypeScript is a guarantee that holds until
 * somebody opens psql, and these records are evidence in a labour dispute.
 *
 * The statements below are deliberately raw. They are what an operator, a migration or a defect
 * would issue, and each must raise.
 */

requireDatabaseInCi('Relations immutability');

describe.skipIf(CONNECTION === undefined)('a recorded violation', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_immutability_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const givenViolation = async (): Promise<string> => {
    const categoryId = uuidV7();

    return fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.categories.insert(transaction, {
        violationCategoryId: categoryId,
        code: 'unauthorized-absence',
        name: { en: 'Unauthorized absence', ar: 'غياب غير مصرح به' },
        severity: 'major',
        sequence: 10,
        repeatWindowDays: 180,
        source: 'tenant',
        active: true,
        version: 1,
      });

      const violationId = uuidV7();

      await fixture.stores.violations.insert(transaction, {
        violationId,
        employmentId: uuidV7(),
        violationCategoryId: categoryId,
        categoryCode: 'unauthorized-absence',
        severity: 'major',
        occurredOn: '2026-08-14',
        reportedBy: 'user:officer',
        description: 'Absent without notice.',
        state: 'reported',
        recordedAt: new Date('2026-08-22T09:00:00Z'),
        version: 1,
      });
      return violationId;
    });
  };

  it('refuses an update of its description', async () => {
    const violationId = await givenViolation();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update relation_violation set description = $2 where id = $1`, [
          violationId,
          'Something completely different.',
        ]),
      ),
    ).rejects.toThrow(/relation_violation_immutable/);
  });

  it('refuses a delete', async () => {
    const violationId = await givenViolation();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from relation_violation where id = $1`, [violationId]),
      ),
    ).rejects.toThrow(/relation_violation_immutable/);
  });

  /**
   * A soft delete is an update, so the trigger refuses that too.
   *
   * The columns are present because every table in this repository carries them; here they are
   * unusable by construction, and this is the assertion that says so rather than a comment.
   */
  it('refuses a soft delete, because a soft delete is an update', async () => {
    const violationId = await givenViolation();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update relation_violation set deleted_at = now(), deleted_by = 'test' where id = $1`,
          [violationId],
        ),
      ),
    ).rejects.toThrow(/relation_violation_immutable/);
  });

  /** Not even a no-op update: the trigger fires `before update`, whatever the statement changes. */
  it('refuses an update that would change nothing', async () => {
    const violationId = await givenViolation();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update relation_violation set version = version where id = $1`, [
          violationId,
        ]),
      ),
    ).rejects.toThrow(/relation_violation_immutable/);
  });

  it('survives every refusal with its original content intact', async () => {
    const violationId = await givenViolation();

    await fixture
      .asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update relation_violation set description = 'edited' where id = $1`, [
          violationId,
        ]),
      )
      .catch(() => undefined);

    const still = await fixture.admin.query<{ description: string }>(
      `select description from relation_violation where id = $1`,
      [violationId],
    );

    expect(still.rows[0]?.description).toBe('Absent without notice.');
  });

  it('refuses an update or a delete of an access event', async () => {
    const violationId = await givenViolation();

    await fixture.asActor(TENANT_A, 'user:officer', (transaction) =>
      fixture.stores.access.insert(transaction, {
        accessEventId: uuidV7(),
        violationId,
        action: 'violation_read',
        actor: 'user:officer',
        occurredAt: new Date('2026-08-22T09:05:00Z'),
        correlationId: uuidV7(),
      }),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update relation_violation_access_event set actor = 'someone-else'`),
      ),
    ).rejects.toThrow(/relation_violation_access_event_immutable/);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from relation_violation_access_event`),
      ),
    ).rejects.toThrow(/relation_violation_access_event_immutable/);
  });

  /**
   * The catalogue is **not** immutable, and that contrast is deliberate rather than an oversight.
   *
   * A tenant must be able to rename an entry, re-grade it or take it out of service. What protects
   * history is not the entry's immutability but the *frozen copy* the violation keeps — asserted in
   * the domain suite — and this test confirms the entry itself still moves.
   */
  it('leaves the catalogue amendable, because history is protected by the frozen copy instead', async () => {
    const violationId = await givenViolation();
    const categoryId = (
      await fixture.admin.query<{ violation_category_id: string }>(
        `select violation_category_id from relation_violation where id = $1`,
        [violationId],
      )
    ).rows[0]?.violation_category_id;

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.categories.update(
        transaction,
        {
          violationCategoryId: categoryId ?? '',
          code: 'unauthorized-absence',
          name: { en: 'Renamed', ar: 'أعيدت التسمية' },
          severity: 'minor',
          sequence: 99,
          repeatWindowDays: 30,
          source: 'tenant',
          active: false,
          version: 1,
        },
        1,
      ),
    );

    const frozen = await fixture.admin.query<{ category_code: string; severity: string }>(
      `select category_code, severity from relation_violation where id = $1`,
      [violationId],
    );

    // The entry moved; what the record said it meant did not.
    expect([frozen.rows[0]?.category_code, frozen.rows[0]?.severity]).toStrictEqual([
      'unauthorized-absence',
      'major',
    ]);
  });
});
