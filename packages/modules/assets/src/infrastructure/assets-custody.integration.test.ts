import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openAssetsFixture,
  requireDatabaseInCi,
  type AssetsFixture,
} from './assets-database.fixture.js';

/**
 * Custody against real PostgreSQL: the invariant, the trigger, the isolation and the races.
 *
 * Everything here belongs to the database. The AD-004 one-custodian rule is a partial unique index,
 * the immutability of a returned custody is a trigger, and the retirement rule is a row lock — none
 * of the three can be proved by a map, and all three are what a bulk import or a `psql` session would
 * meet first.
 *
 * **No sleeps and no timing assumptions.** Contending transactions are started and awaited together,
 * and the assertion is on the invariant rather than on which one wins.
 */

requireDatabaseInCi('Assets custody');

describe.skipIf(CONNECTION === undefined)('custody, against the database', () => {
  let fixture: AssetsFixture;

  beforeAll(async () => {
    fixture = await openAssetsFixture('assets_custody_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const AUDIT = `now(), 'user:test', now(), 'user:test', 1`;

  const givenAsset = async (tag = 'IT-00417'): Promise<string> => {
    const tenantId = TENANT_A;
    const categoryId = uuidV7();
    const assetId = uuidV7();

    await fixture.admin.query(
      `insert into asset_category
         (id, tenant_id, code, name, sequence, active,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'laptop', '{"en":"Laptop","ar":"حاسوب"}'::jsonb, 10, true, ${AUDIT})`,
      [categoryId, tenantId],
    );
    await fixture.admin.query(
      `insert into asset
         (id, tenant_id, asset_category_id, asset_tag, status,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, 'available', ${AUDIT})`,
      [assetId, tenantId, categoryId, tag],
    );
    return assetId;
  };

  const issuing = (assetId: string, employmentId: string, tenantId = TENANT_A): Promise<void> =>
    fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.custodies.insert(transaction, {
        assetCustodyId: uuidV7(),
        assetId,
        employmentId,
        issuedOn: '2026-08-20',
        state: 'open',
        version: 1,
      }),
    );

  const refusalFrom = async (work: Promise<unknown>): Promise<string> => {
    try {
      await work;
    } catch (error: unknown) {
      return String(error);
    }
    throw new Error('The database accepted something it should have refused.');
  };

  const survivors = (outcomes: readonly PromiseSettledResult<unknown>[]): number =>
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length;

  const refusal = (outcomes: readonly PromiseSettledResult<unknown>[]): string =>
    String(
      (outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult).reason,
    );

  describe('the AD-004 invariant', () => {
    it('permits one open custody per asset and refuses a second', async () => {
      const assetId = await givenAsset();

      await issuing(assetId, uuidV7());

      expect(await refusalFrom(issuing(assetId, uuidV7()))).toContain('asset_custody_open_idx');
    });

    /**
     * **Two storekeepers issuing one laptop at the same instant.** No sleeps: both transactions are
     * started and awaited together, and the index decides.
     */
    it('lets exactly one of two simultaneous issues survive', async () => {
      const assetId = await givenAsset();
      const outcomes = await Promise.allSettled([
        issuing(assetId, uuidV7()),
        issuing(assetId, uuidV7()),
      ]);

      expect(survivors(outcomes)).toBe(1);
      expect(refusal(outcomes)).toMatch(/asset_custody_open_idx/);

      const open = await fixture.admin.query(
        `select id from asset_custody where asset_id = $1 and state = 'open'`,
        [assetId],
      );

      expect(open.rows).toHaveLength(1);
    });

    /** The index is partial, so returned custodies accumulate freely on one asset. */
    it('lets any number of returned custodies accumulate on one asset', async () => {
      const assetId = await givenAsset();

      for (const day of ['2026-08-01', '2026-08-05', '2026-08-10']) {
        await fixture.admin.query(
          `insert into asset_custody
             (id, tenant_id, asset_id, employment_id, issued_on, returned_on, state,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, $4, $5, $5, 'returned', ${AUDIT})`,
          [uuidV7(), TENANT_A, assetId, uuidV7(), day],
        );
      }

      await expect(issuing(assetId, uuidV7())).resolves.toBeUndefined();
    });
  });

  describe('what the schema refuses', () => {
    it('closes the state vocabulary against SQL nobody wrote in TypeScript', async () => {
      const assetId = await givenAsset();

      for (const state of ['issued', 'accepted', 'acknowledged', 'cancelled', 'transferred']) {
        const refused = await refusalFrom(
          fixture.admin.query(
            `insert into asset_custody
               (id, tenant_id, asset_id, employment_id, issued_on, state,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, $4, '2026-08-20', $5, ${AUDIT})`,
            [uuidV7(), TENANT_A, assetId, uuidV7(), state],
          ),
        );

        expect(refused).toContain('asset_custody_state_check');
      }
    });

    /** A row saying `returned` with no date, or `open` with one, is a period nobody could read. */
    it('refuses a closure that does not agree with its own state', async () => {
      const assetId = await givenAsset();
      const inserting = (state: string, returnedOn: string | null): Promise<unknown> =>
        fixture.admin.query(
          `insert into asset_custody
             (id, tenant_id, asset_id, employment_id, issued_on, returned_on, state,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, $4, '2026-08-20', $5, $6, ${AUDIT})`,
          [uuidV7(), TENANT_A, assetId, uuidV7(), returnedOn, state],
        );

      expect(await refusalFrom(inserting('returned', null))).toContain(
        'asset_custody_closure_check',
      );
      expect(await refusalFrom(inserting('open', '2026-08-22'))).toContain(
        'asset_custody_closure_check',
      );
    });

    it('refuses a return dated before its own issue', async () => {
      const assetId = await givenAsset();
      const refused = await refusalFrom(
        fixture.admin.query(
          `insert into asset_custody
             (id, tenant_id, asset_id, employment_id, issued_on, returned_on, state,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, $4, '2026-08-20', '2026-08-19', 'returned', ${AUDIT})`,
          [uuidV7(), TENANT_A, assetId, uuidV7()],
        ),
      );

      expect(refused).toContain('asset_custody_dates_check');
    });

    it('refuses a custody pointing at an asset that is not there', async () => {
      const refused = await refusalFrom(issuing(uuidV7(), uuidV7()));

      expect(refused).toContain('asset_custody_asset_fk');
    });

    /**
     * The civil dates survive the round trip as strings.
     *
     * The driver returns a `date` as a JavaScript `Date` at the process's local midnight; this is the
     * defect Relations carried for three checkpoints, and the `to_char` projection is what prevents it.
     */
    it('returns civil dates as the strings that were stored', async () => {
      const assetId = await givenAsset();

      await issuing(assetId, uuidV7());

      const held = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.custodies.openFor(transaction, assetId),
      );

      expect(typeof held?.issuedOn).toBe('string');
      expect(held?.issuedOn).toBe('2026-08-20');
      expect(held?.returnedOn).toBeUndefined();
    });
  });

  describe('a returned custody', () => {
    const givenReturned = async (): Promise<string> => {
      const assetId = await givenAsset();
      const custodyId = uuidV7();

      await fixture.admin.query(
        `insert into asset_custody
           (id, tenant_id, asset_id, employment_id, issued_on, returned_on, state,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, '2026-08-20', '2026-08-22', 'returned', ${AUDIT})`,
        [custodyId, TENANT_A, assetId, uuidV7()],
      );
      return custodyId;
    };

    it('refuses every update, from any path', async () => {
      const custodyId = await givenReturned();
      const refused = await refusalFrom(
        fixture.admin.query(`update asset_custody set return_note = 'edited' where id = $1`, [
          custodyId,
        ]),
      );

      expect(refused).toContain('asset_custody_returned');
    });

    it('refuses every delete, from any path', async () => {
      const custodyId = await givenReturned();
      const refused = await refusalFrom(
        fixture.admin.query(`delete from asset_custody where id = $1`, [custodyId]),
      );

      expect(refused).toContain('asset_custody_returned');
    });

    /** A soft delete is an update, so the trigger refuses that too. */
    it('refuses a soft delete', async () => {
      const custodyId = await givenReturned();
      const refused = await refusalFrom(
        fixture.admin.query(
          `update asset_custody set deleted_at = now(), deleted_by = 'user:test' where id = $1`,
          [custodyId],
        ),
      );

      expect(refused).toContain('asset_custody_returned');
    });

    /** An open custody is a period still in progress, and stays correctable until it closes. */
    it('permits an update while the custody is still open', async () => {
      const assetId = await givenAsset();

      await issuing(assetId, uuidV7());

      await expect(
        fixture.admin.query(
          `update asset_custody set issue_note = 'corrected' where asset_id = $1`,
          [assetId],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('returning under contention', () => {
    /**
     * Two callers returning one custody: exactly one lands.
     *
     * The version predicate is in the update's `where` clause rather than in a preceding read,
     * because a read followed by a write is two statements with a gap between them — and the gap is
     * where the second return would silently land.
     */
    it('lets exactly one of two simultaneous returns survive', async () => {
      const assetId = await givenAsset();

      await issuing(assetId, uuidV7());

      const held = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.custodies.openFor(transaction, assetId),
      );

      if (held === undefined) throw new Error('the fixture failed to open a custody');

      const returning = (day: string): Promise<void> =>
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.custodies.update(
            transaction,
            { ...held, returnedOn: day, state: 'returned' },
            1,
          ),
        );

      const outcomes = await Promise.allSettled([returning('2026-08-22'), returning('2026-08-23')]);

      expect(survivors(outcomes)).toBe(1);

      const after = await fixture.admin.query<{ version: number; state: string }>(
        `select version, state from asset_custody where asset_id = $1`,
        [assetId],
      );

      // One write landed, and the row moved on by exactly one version — so the loser's return is
      // genuinely absent rather than silently merged.
      expect(after.rows[0]?.version).toBe(2);
      expect(after.rows[0]?.state).toBe('returned');
    });
  });
});
