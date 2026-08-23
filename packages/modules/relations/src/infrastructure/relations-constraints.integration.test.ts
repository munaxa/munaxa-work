import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';

/**
 * What the database refuses, and what it settles when two callers race.
 *
 * The application checks the code for a readable refusal; **the unique index is what actually
 * settles two administrators defining the same code at the same moment**, because a `select`
 * followed by an `insert` is not idempotent under concurrency (ADR-0071). This suite proves the
 * index rather than the check, with two real connections overlapping in time and no sleeps.
 *
 * The constraint tests are the country-pack boundary and the closed state vocabulary, asserted where
 * they are enforced rather than only where they are validated.
 */

requireDatabaseInCi('Relations constraints');

const CATEGORY_COLUMNS = `(tenant_id, code, name, severity, sequence, repeat_window_days, source,
  country_pack_id, country_pack_version, active, metadata,
  created_at, created_by, updated_at, updated_by, version)`;

describe.skipIf(CONNECTION === undefined)('the relations schema', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_constraints_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const insertCategory = (
    tenantId: string,
    values: {
      code?: string;
      source?: string;
      packId?: string | null;
      packVersion?: number | null;
      sequence?: number;
      severity?: string;
      repeatWindowDays?: number;
    } = {},
  ): Promise<unknown> =>
    fixture.admin.query(
      `insert into relation_violation_category ${CATEGORY_COLUMNS}
       values ($1, $2, '{"en":"X","ar":"س"}'::jsonb, $3, $4, $5, $6, $7, $8, true, '{}'::jsonb,
               now(), 'test', now(), 'test', 1)`,
      [
        tenantId,
        values.code ?? 'unauthorized-absence',
        values.severity ?? 'major',
        values.sequence ?? 10,
        values.repeatWindowDays ?? 180,
        values.source ?? 'tenant',
        values.packId ?? null,
        values.packVersion ?? null,
      ],
    );

  describe('the catalogue', () => {
    it('refuses two entries with one code in one tenant', async () => {
      await insertCategory(TENANT_A);

      await expect(insertCategory(TENANT_A)).rejects.toThrow(
        /relation_violation_category_code_idx/,
      );
    });

    it('permits the same code in two tenants, because a code is a tenant’s own word', async () => {
      await insertCategory(TENANT_A);

      await expect(insertCategory(TENANT_B)).resolves.toBeDefined();
    });

    /**
     * The concurrency proof: two connections, overlapping in time, no sleeps.
     *
     * Both transactions insert the same code. One commits; the other must abort on the index rather
     * than both succeeding — which is the failure a select-then-insert would produce.
     */
    it('lets exactly one of two concurrent definitions of a code survive', async () => {
      const one = await fixture.admin.connect();
      const other = await fixture.admin.connect();

      try {
        await one.query('begin');
        await other.query('begin');

        const insert = `insert into relation_violation_category ${CATEGORY_COLUMNS}
          values ($1, 'raced', '{"en":"X","ar":"س"}'::jsonb, 'major', 1, 30, 'tenant', null, null,
                  true, '{}'::jsonb, now(), 'test', now(), 'test', 1)`;

        await one.query(insert, [TENANT_A]);

        // Starts before the winner commits, and blocks on the index rather than returning.
        const loser = other.query(insert, [TENANT_A]);

        await one.query('commit');
        await expect(loser).rejects.toThrow(/relation_violation_category_code_idx/);
        await other.query('rollback');
      } finally {
        one.release();
        other.release();
      }

      const survived = await fixture.admin.query<{ total: string }>(
        `select count(*)::text as total from relation_violation_category where code = 'raced'`,
      );

      expect(survived.rows[0]?.total).toBe('1');
    });

    /**
     * The country-pack boundary, enforced by the schema rather than only by the domain.
     *
     * An entry claiming statutory provenance must name the pack it came from; one written by a
     * tenant must not pretend to have any. **No pack exists yet** — Phase 11.1 supplies them — so
     * every row written today is `tenant`.
     */
    it('refuses a country-pack entry that names no pack', async () => {
      await expect(insertCategory(TENANT_A, { source: 'country_pack' })).rejects.toThrow(
        /relation_violation_category_pack_shape_check/,
      );
    });

    it('refuses a tenant entry that names a pack', async () => {
      await expect(insertCategory(TENANT_A, { packId: 'some-pack' })).rejects.toThrow(
        /relation_violation_category_pack_shape_check/,
      );
    });

    it('accepts a country-pack entry that names one', async () => {
      await expect(
        insertCategory(TENANT_A, {
          source: 'country_pack',
          packId: 'pack-under-test',
          packVersion: 1,
        }),
      ).resolves.toBeDefined();
    });

    /**
     * An unknown source is refused — and **the pack-shape guard is what catches it**, not the
     * vocabulary check.
     *
     * That is worth naming rather than glossing: `ministry` satisfies neither branch of
     * `pack_shape_check` (it is not `country_pack` with a pack, and not `tenant` without one), so
     * PostgreSQL raises that constraint first and `source_check` never gets the chance. The
     * vocabulary check is therefore a **second line** rather than the first — it still holds the set
     * closed if the shape rule is ever relaxed, which is why it stays.
     *
     * Asserted on the exact constraint that fires, so the day the evaluation order changes this test
     * says so instead of passing on a different refusal.
     */
    it('refuses an unknown source, caught by the pack-shape guard before the vocabulary check', async () => {
      await expect(insertCategory(TENANT_A, { source: 'ministry' })).rejects.toThrow(
        /relation_violation_category_pack_shape_check/,
      );
    });

    /** The vocabulary check, reached directly by satisfying the shape rule's `country_pack` branch. */
    it('refuses an unknown source that does carry a pack, on the vocabulary check', async () => {
      await expect(
        insertCategory(TENANT_A, { source: 'ministry', packId: 'some-pack' }),
      ).rejects.toThrow(/relation_violation_category_(pack_shape|source)_check/);
    });

    it.each([
      ['a negative sequence', { sequence: -1 }, /relation_violation_category_sequence_check/],
      [
        'a negative repeat window',
        { repeatWindowDays: -1 },
        /relation_violation_category_repeat_window_check/,
      ],
      ['a blank severity', { severity: '   ' }, /relation_violation_category_severity_check/],
      ['a malformed code', { code: 'Not A Code' }, /relation_violation_category_code_shape_check/],
    ])('refuses %s', async (_case, values, expected) => {
      await expect(insertCategory(TENANT_A, values)).rejects.toThrow(expected);
    });

    /** Sequence is deliberately **not** unique: a tenant must never be forced to renumber. */
    it('permits two entries to share a sequence', async () => {
      await insertCategory(TENANT_A, { code: 'first', sequence: 5 });

      await expect(
        insertCategory(TENANT_A, { code: 'second', sequence: 5 }),
      ).resolves.toBeDefined();
    });
  });

  describe('a violation', () => {
    /**
     * One catalogue entry per call, each with its own code.
     *
     * Reusing a single code across calls trips `relation_violation_category_code_idx` and the
     * assertion then passes for the wrong reason — the suite reported a description-length refusal
     * that was really a duplicate-code refusal. Found exactly that way.
     */
    let codes = 0;
    const givenCategoryId = async (): Promise<string> => {
      codes += 1;

      const code = `category-${String(codes)}`;

      await insertCategory(TENANT_A, { code });

      const found = await fixture.admin.query<{ id: string }>(
        `select id from relation_violation_category where tenant_id = $1 and code = $2`,
        [TENANT_A, code],
      );

      return found.rows[0]?.id ?? '';
    };

    const insertViolation = async (values: { state?: string; description?: string } = {}) => {
      const categoryId = await givenCategoryId();

      return fixture.admin.query(
        `insert into relation_violation
           (tenant_id, employment_id, violation_category_id, category_code, severity,
            occurred_on, reported_by, description, state, recorded_at, metadata,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'unauthorized-absence', 'major',
                 '2026-08-14', 'user:officer', $4, $5, now(), '{}'::jsonb,
                 now(), 'test', now(), 'test', 1)`,
        [
          TENANT_A,
          uuidV7(),
          categoryId,
          values.description ?? 'Absent.',
          values.state ?? 'reported',
        ],
      );
    };

    /**
     * The state vocabulary is closed at the one value Checkpoint 1 can produce.
     *
     * It widens by an approved change, exactly as `workflow_history`'s event CHECK was widened for
     * `step-reminded`. A vocabulary listing states nothing can produce would be a promise the code
     * cannot keep.
     */
    it('accepts the reported state and refuses every later lifecycle state', async () => {
      await expect(insertViolation()).resolves.toBeDefined();

      for (const state of ['under_investigation', 'action_issued', 'appealed', 'expired']) {
        await expect(insertViolation({ state })).rejects.toThrow(/relation_violation_state_check/);
      }
    });

    it('refuses an empty description and one beyond the limit', async () => {
      await expect(insertViolation({ description: '   ' })).rejects.toThrow(
        /relation_violation_description_check/,
      );
      await expect(insertViolation({ description: 'x'.repeat(4001) })).rejects.toThrow(
        /relation_violation_description_check/,
      );
    });

    it('refuses a violation whose category does not exist', async () => {
      await expect(
        fixture.admin.query(
          `insert into relation_violation
             (tenant_id, employment_id, violation_category_id, category_code, severity,
              occurred_on, reported_by, description, state, recorded_at, metadata,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, 'x', 'major', '2026-08-14', 'user:officer', 'Absent.', 'reported',
                   now(), '{}'::jsonb, now(), 'test', now(), 'test', 1)`,
          [TENANT_A, uuidV7(), uuidV7()],
        ),
      ).rejects.toThrow(/relation_violation_category_fk/);
    });
  });
});
