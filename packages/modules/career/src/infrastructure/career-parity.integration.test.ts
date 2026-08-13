import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CAREER_TABLES,
  CONNECTION,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  CAREER_PATH_KINDS,
  CAREER_PATH_STATUSES,
  CAREER_PLAN_STATUSES,
  DEVELOPMENT_CATEGORIES,
  DEVELOPMENT_ITEM_KINDS,
  DEVELOPMENT_ITEM_STATUSES,
  DEVELOPMENT_PLAN_STATUSES,
  MAX_READINESS_ORDINAL,
  MAX_STAGE_SEQUENCE,
  MAX_SUCCESSOR_RANK,
  MOBILITY_KINDS,
  STORED_MOBILITY_STATUSES,
  SUCCESSION_PLAN_STATUSES,
  SUCCESSOR_STATUSES,
  TALENT_POOL_KINDS,
  TALENT_POOL_STATUSES,
} from '../domain/career-vocabulary.js';

/**
 * Domain and database, compared **by machine** rather than by eye.
 *
 * Checkpoint 3 reported this comparison in prose. Prose is right once. A vocabulary that gains a
 * value in the domain and not in the check constraint produces a state the application believes is
 * legal and PostgreSQL refuses at the moment somebody first reaches it — in production, on a real
 * record. A constraint that gains a value the domain does not know produces the mirror defect: a row
 * the database will hold and no code path can read back into a typed state.
 *
 * So every closed vocabulary and every numeric bound is asserted against `pg_constraint` here, and
 * the assertion fails the moment either side moves without the other.
 *
 * **Two asymmetries are intentional and are asserted as such**, rather than being quietly tolerated:
 *
 * *The database is stricter on uniqueness.* Nine partial unique indexes enforce facts about a *set*
 * of rows — one active plan per employment, one open nomination per plan and employment. The domain
 * deliberately does not check them, because a read-then-write is idempotent only when nobody else is
 * writing (§15). These are database-owned invariants and the repositories map their outcome rather
 * than pre-empting it.
 *
 * *The database is looser on audit fields.* `archived_at`, `archived_by`, `closed_at` and
 * `closed_by` are nullable where the domain always sets them. They are values a transition records,
 * not invariants a row must satisfy — making them `not null` would refuse a draft that was never
 * archived, which is every draft.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career parity suite');

suite('career domain and database parity', () => {
  let fixture: CareerFixture;
  let constraints: Map<string, string>;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_parity_role');

    const rows = await fixture.admin.query<{ conname: string; definition: string }>(
      `select con.conname, pg_get_constraintdef(con.oid) as definition
         from pg_constraint con join pg_class c on c.oid = con.conrelid
        where c.relname like 'career\\_%' and con.contype = 'c'`,
    );

    constraints = new Map(rows.rows.map((row) => [row.conname, row.definition]));
  });

  afterAll(async () => {
    await fixture.close();
  });

  /** Every value the domain permits appears in the constraint, and the constraint adds none. */
  const vocabularyMatches = (constraint: string, vocabulary: readonly string[]): void => {
    const definition = constraints.get(constraint);

    expect(definition, constraint).toBeDefined();

    const quoted = [...(definition ?? '').matchAll(/'([a-z_]+)'::character varying/g)].map(
      (match) => match[1],
    );

    expect([...quoted].sort(), constraint).toEqual([...vocabulary].sort());
  };

  describe('closed vocabularies', () => {
    it('matches the domain exactly, in both directions, for every lifecycle', () => {
      vocabularyMatches('career_path_status_check', CAREER_PATH_STATUSES);
      vocabularyMatches('career_path_kind_check', CAREER_PATH_KINDS);
      vocabularyMatches('career_plan_status_check', CAREER_PLAN_STATUSES);
      vocabularyMatches('career_talent_pool_kind_check', TALENT_POOL_KINDS);
      vocabularyMatches('career_talent_pool_status_check', TALENT_POOL_STATUSES);
      vocabularyMatches('career_succession_plan_status_check', SUCCESSION_PLAN_STATUSES);
      vocabularyMatches('career_successor_status_check', SUCCESSOR_STATUSES);
      vocabularyMatches('career_development_plan_status_check', DEVELOPMENT_PLAN_STATUSES);
      vocabularyMatches('career_development_item_status_check', DEVELOPMENT_ITEM_STATUSES);
      vocabularyMatches('career_development_item_category_check', DEVELOPMENT_CATEGORIES);
      vocabularyMatches('career_development_item_kind_check', DEVELOPMENT_ITEM_KINDS);
      vocabularyMatches('career_mobility_recommendation_kind_check', MOBILITY_KINDS);
    });

    /**
     * The one place the two sides deliberately differ, and it differs by exactly one value.
     *
     * `MOBILITY_STATUSES` has four; `STORED_MOBILITY_STATUSES` has three. The constraint matches the
     * *stored* set, because `expired` is derived from `valid_until` and the day asked and is never
     * written (D-13). Asserting against the stored set — and asserting that the derived one is
     * larger — is what stops somebody "fixing" the constraint to match the wider vocabulary.
     */
    it('refuses `expired` as a stored mobility status while the domain still derives it', () => {
      vocabularyMatches('career_mobility_recommendation_status_check', STORED_MOBILITY_STATUSES);
      expect(constraints.get('career_mobility_recommendation_status_check')).not.toContain(
        "'expired'",
      );
      expect(STORED_MOBILITY_STATUSES).not.toContain('expired');
    });
  });

  describe('numeric bounds', () => {
    /** Every number in this module is a small integer a human chose, bounded identically on both sides. */
    it('bounds a stage sequence, a successor rank and a readiness ordinal as the domain does', () => {
      expect(constraints.get('career_stage_sequence_check')).toContain(String(MAX_STAGE_SEQUENCE));
      expect(constraints.get('career_successor_rank_check')).toContain(String(MAX_SUCCESSOR_RANK));
      expect(constraints.get('career_readiness_level_ordinal_check')).toContain(
        String(MAX_READINESS_ORDINAL),
      );
    });

    it('starts every bound at one, so no ordinal or rank can be zero or negative', () => {
      for (const constraint of [
        'career_stage_sequence_check',
        'career_successor_rank_check',
        'career_readiness_level_ordinal_check',
      ]) {
        expect(constraints.get(constraint), constraint).toMatch(/>= 1/);
      }
    });
  });

  describe('date ranges', () => {
    /**
     * The comparison operators match the domain's, and the difference between `>` and `>=` is real.
     *
     * A path may not stop being effective on the day it starts (`>`), because a period of zero days
     * is not a period. A plan's target date *may* be the day it started (`>=`), because "achieve this
     * today" is a thing somebody writes down.
     */
    it('uses the same strictness the domain uses, per field', () => {
      expect(constraints.get('career_path_period_check')).toMatch(/effective_to > effective_from/);
      expect(constraints.get('career_plan_target_check')).toMatch(/target_date >= started_on/);
      expect(constraints.get('career_development_plan_target_check')).toMatch(
        /target_date >= started_on/,
      );
      expect(constraints.get('career_pool_membership_period_check')).toMatch(
        /to_date >= from_date/,
      );
      expect(constraints.get('career_mobility_recommendation_validity_check')).toMatch(
        /valid_until > recommended_on/,
      );
    });
  });

  describe('the acts that require a named human', () => {
    /**
     * Six constraints refuse `system:auto-approval`, and the domain refuses it in the same six
     * places. `AutoApprovingPort` says in its own comment that it pretends nothing.
     */
    it('refuses the auto-approval actor everywhere the domain does', () => {
      const refusing = [...constraints.entries()].filter(([, definition]) =>
        definition.includes('system:auto-approval'),
      );

      expect(refusing.map(([name]) => name).sort()).toEqual([
        'career_development_plan_employee_ack_human_check',
        'career_development_plan_manager_ack_human_check',
        'career_mobility_recommendation_decider_check',
        'career_mobility_recommendation_recommender_check',
        'career_readiness_assessment_assessor_check',
        'career_successor_confirmer_check',
        'career_successor_nominator_check',
      ]);
    });
  });

  describe('the asymmetries, stated rather than tolerated', () => {
    /**
     * The database is stricter on uniqueness, and each index is a fact about a set of rows the domain
     * deliberately does not check.
     *
     * All nine are **partial**, and that matters as much as their being unique: `career_plan_active_idx`
     * covers `status = 'active'`, so a plan may end and be replaced; `career_successor_open_idx`
     * covers the two open statuses, so a withdrawal frees the slot. A full unique index on the same
     * columns would refuse all three of the cases the schema deliberately permits.
     */
    it('owns nine uniqueness invariants the domain leaves to persistence', async () => {
      // Partial unique indexes only. A primary key is a unique index too, but it enforces identity
      // rather than a business fact about a set of rows — and the `where` clause is exactly what
      // makes these nine *partial*, which is the property that lets a plan end and be replaced.
      const indexes = await fixture.admin.query<{ indexname: string }>(
        `select indexname from pg_indexes
          where schemaname = 'public' and tablename = any($1::text[])
            and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE%'`,
        [CAREER_TABLES],
      );

      expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
        'career_path_code_idx',
        'career_plan_active_idx',
        'career_pool_membership_open_idx',
        'career_readiness_level_code_idx',
        'career_readiness_level_ordinal_idx',
        'career_stage_sequence_idx',
        'career_succession_plan_active_idx',
        'career_successor_open_idx',
        'career_talent_pool_code_idx',
      ]);
    });

    /**
     * The database is looser on audit fields, and that is what lets a draft exist.
     *
     * A `not null` on `archived_by` would refuse every path that has not been archived — which is
     * every path somebody is still using.
     */
    it('leaves transition-audit columns nullable, because a draft has not reached them', async () => {
      const columns = await fixture.admin.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema = 'public'
            and column_name in ('archived_at', 'archived_by', 'closed_at', 'closed_by',
                                'closed_on', 'withdrawn_on', 'confirmed_on')
            and table_name like 'career\\_%'`,
      );

      expect(columns.rows.length).toBeGreaterThan(0);
      for (const column of columns.rows) {
        expect(column.is_nullable, column.column_name).toBe('YES');
      }
    });

    /**
     * And the one place a *pair* must move together: an acknowledgement has a day and a recorder, or
     * neither. That is a database-owned invariant the domain also holds, and it is what stops a plan
     * claiming somebody acknowledged it with nobody's name against the claim (D-9).
     */
    it('ties each acknowledgement day to the person who recorded it', () => {
      expect(constraints.get('career_development_plan_employee_ack_check')).toMatch(
        /employee_acknowledged_on IS NULL\) = \(employee_acknowledgement_recorded_by IS NULL/,
      );
      expect(constraints.get('career_development_plan_manager_ack_check')).toMatch(
        /manager_acknowledged_on IS NULL\) = \(manager_acknowledgement_recorded_by IS NULL/,
      );
    });
  });

  describe('what the schema still does not have', () => {
    /** Re-asserted at the persistence layer, because this is where a column would be added. */
    it('has no criticality, potential band, nine-box or score column', async () => {
      const columns = await fixture.admin.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'career\\_%'
            and (column_name like '%critical%' or column_name like '%potential%'
                 or column_name like '%nine_box%' or column_name like '%score%'
                 or column_name like '%evidence%' or column_name like '%document%')`,
      );

      expect(columns.rows).toEqual([]);
    });
  });
});
