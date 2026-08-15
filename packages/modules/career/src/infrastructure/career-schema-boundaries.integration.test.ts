import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  LEARNING_ASSIGNMENT,
  OTHER_EMPLOYMENT,
  TENANT_A,
  openCareerFixture,
  refusalOf,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  insertDevelopmentItem,
  insertDevelopmentPlan,
  insertPath,
  insertStage,
} from './career-fixtures.js';

/**
 * The boundaries the schema draws, and the columns it deliberately does not have.
 *
 * Split from the constraint suite along a real seam rather than at a line count: that file asserts
 * what the database *refuses to store*, and this one asserts where Career *stops* — the reference to
 * Learning that carries no status, the stage that must belong to a path, and the four kinds of
 * column somebody would reasonably have added and which are absent on purpose.
 *
 * The negative-space assertions at the end are the ones worth keeping: a `criticality` column, a
 * potential band or an `effective_date` on a recommendation would each pass review as "filling a
 * gap", and each would undo a decision the phase took deliberately.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career schema boundary suite');

suite('career schema boundaries', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_schema_boundary_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const refusal = async (
    work: (client: Parameters<Parameters<CareerFixture['asTenant']>[1]>[0]) => Promise<unknown>,
  ): Promise<string> => {
    try {
      await fixture.asTenant(TENANT_A, work);
    } catch (error: unknown) {
      return refusalOf(error);
    }
    throw new Error('The database accepted a row it should have refused.');
  };

  describe('the boundary against Learning, at the table', () => {
    /**
     * A course item is a reference to Learning and nothing else (ADR-0073). Career keeps no title,
     * no completion date and no progress for one, because `learning_enrolment` is the answer and a
     * second copy here is the one that goes stale the first time an enrolment is withdrawn.
     */
    it('refuses a course item with no Learning assignment behind it', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertDevelopmentPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertDevelopmentItem(client, TENANT_A, planId, {
            kind: 'course',
            category: 'education',
          }),
        ),
      ).toContain('career_development_item_learning_check');
    });

    it('refuses a non-course item that names a Learning assignment', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertDevelopmentPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertDevelopmentItem(client, TENANT_A, planId, {
            kind: 'project',
            learningAssignmentId: LEARNING_ASSIGNMENT,
          }),
        ),
      ).toContain('career_development_item_learning_check');
    });

    it('refuses Career recording a completion for a course Learning owns', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertDevelopmentPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertDevelopmentItem(client, TENANT_A, planId, {
            kind: 'course',
            category: 'education',
            learningAssignmentId: LEARNING_ASSIGNMENT,
            status: 'completed',
            completedOn: '2026-07-01',
            completedBy: 'user:test',
          }),
        ),
      ).toContain('career_development_item_course_status_check');
    });

    it('accepts a course item that stores the assignment identifier and nothing else', async () => {
      const stored = await fixture.asTenant(TENANT_A, async (client) => {
        const planId = await insertDevelopmentPlan(client, TENANT_A);

        await insertDevelopmentItem(client, TENANT_A, planId, {
          kind: 'course',
          category: 'education',
          learningAssignmentId: LEARNING_ASSIGNMENT,
        });
        return client.query<{ learning_assignment_id: string; status: string }>(
          `select learning_assignment_id, status from career_development_item`,
        );
      });

      expect(stored.rows[0]).toEqual({
        learning_assignment_id: LEARNING_ASSIGNMENT,
        status: 'planned',
      });
    });
  });

  describe('a stage belongs to a path', () => {
    it('refuses a plan that names a stage without a path', async () => {
      expect(
        await refusal((client) =>
          client.query(
            `insert into career_plan
               (tenant_id, employment_id, status, started_on, target_stage_id,
                created_at, created_by, updated_at, updated_by, version, metadata)
             values ($1, $2, 'draft', date '2026-03-01', $3,
                     now(), 'user:test', now(), 'user:test', 1, '{}'::jsonb)`,
            [TENANT_A, OTHER_EMPLOYMENT, crypto.randomUUID()],
          ),
        ),
      ).toContain('career_plan_stage_needs_path_check');
    });

    it('refuses two stages at the same sequence on one path', async () => {
      const pathId = await fixture.asTenant(TENANT_A, async (client) => {
        const id = await insertPath(client, TENANT_A);

        await insertStage(client, TENANT_A, id, 2);
        return id;
      });

      expect(await refusal((client) => insertStage(client, TENANT_A, pathId, 2))).toContain(
        'career_stage_sequence_idx',
      );
    });

    it('refuses a sequence outside the bound the domain uses', async () => {
      const pathId = await fixture.asTenant(TENANT_A, (client) => insertPath(client, TENANT_A));

      expect(await refusal((client) => insertStage(client, TENANT_A, pathId, 501))).toContain(
        'career_stage_sequence_check',
      );
    });
  });

  describe('what the schema does not have', () => {
    /**
     * Stated as an assertion rather than as a comment, because a column somebody adds later is
     * exactly the kind of change that passes review.
     *
     * `criticality` is Organization's (AD-004). A potential band or nine-box code is Performance's
     * (ADR-0073). A readiness *score*, a development-mix target and a balance verdict are rules
     * nobody wrote (ADR-0074, D-12 `NOT VERIFIED`). None of the five has a home here, and a column
     * would be the schema claiming otherwise.
     */
    it('has no criticality, no potential band, no nine-box code and no score', async () => {
      const columns = await fixture.admin.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'career\\_%'
            and (column_name like '%critical%' or column_name like '%potential%'
                 or column_name like '%nine_box%' or column_name like '%box_code%'
                 or column_name like '%score%' or column_name like '%weight%'
                 or column_name like '%percentage%' or column_name like '%target_mix%')`,
      );

      expect(columns.rows).toEqual([]);
    });

    /**
     * Career recommends and executes nothing (ADR-0072). There is no column through which a
     * recommendation could become an employment change, and this says so at the schema rather than
     * relying on nobody having written the handler.
     */
    it('has no column through which a recommendation could move anybody', async () => {
      const columns = await fixture.admin.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'career\\_%'
            and column_name in ('effective_date', 'assignment_id', 'salary', 'salary_id',
                                'new_position_id', 'promotion_id', 'transfer_id', 'document_id',
                                'notification_id')`,
      );

      expect(columns.rows).toEqual([]);
    });

    /**
     * Cross-module identifiers carry no foreign key (ADR-0042), and the reason is worth stating: an
     * FK would *not* provide tenant isolation, because PostgreSQL's referential check runs without
     * consulting a policy. It would happily accept another tenant's position.
     */
    it('has no foreign key leaving the module', async () => {
      const foreign = await fixture.admin.query<{ constraint_name: string; target: string }>(
        `select con.conname as constraint_name, con.confrelid::regclass::text as target
           from pg_constraint con
           join pg_class src on src.oid = con.conrelid
          where con.contype = 'f' and src.relname like 'career\\_%'
            and con.confrelid::regclass::text not like 'career\\_%'`,
      );

      expect(foreign.rows).toEqual([]);
    });

    /**
     * One trigger, for the one fact the approved plan makes append-only (D-14). Triggers are
     * architecturally significant in this repository; one added for convenience is one nobody
     * expects, so the count is asserted rather than left to grow.
     */
    it('has exactly one trigger', async () => {
      const triggers = await fixture.admin.query<{ tgname: string; table_name: string }>(
        `select t.tgname, c.relname as table_name
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname like 'career\\_%'`,
      );

      expect(triggers.rows).toEqual([
        {
          tgname: 'career_readiness_assessment_no_mutation',
          table_name: 'career_readiness_assessment',
        },
      ]);
    });
  });
});
