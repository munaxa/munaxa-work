import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPEND_ONLY_TABLES,
  APPROVER,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDecision, seedHistory, seedInstance } from './workflow-seed.js';

/**
 * The two append-only facts, and what "append-only" is worth if it is only a convention.
 *
 * A decision an approver made and a record of how an approval was routed are the two things somebody
 * asks about a year later, and ADR-0045 states the reason plainly: **an edited decision is not
 * evidence.** The cheapest way to guarantee a record was not rewritten is to give the database no
 * way to rewrite it, which is why these are triggers rather than a rule the repositories agree to
 * follow.
 *
 * **The soft delete matters as much as the update.** Every table in this repository carries
 * `deleted_at`, and setting it is an update — so a trigger that only refused a hard delete would
 * leave a decision that can be *hidden*, which is a decision that can be denied.
 *
 * The suite also asserts what stays mutable. A step's status moves as an approval advances, and an
 * instance's does when it ends; making those immutable because it was convenient would break the
 * engine and would be the kind of over-application that makes a rule stop being believed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's immutability suite");

suite('what Workflow refuses to change', () => {
  let fixture: WorkflowFixture;
  let seeded: Awaited<ReturnType<typeof seedInstance>>;
  let decisionId: string;
  let historyId: string;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    ({ seeded, decisionId, historyId } = await fixture.asTenant(TENANT_A, async (client) => {
      const instance = await seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]);

      return {
        seeded: instance,
        decisionId: await seedDecision(client, TENANT_A, instance),
        historyId: await seedHistory(client, TENANT_A, instance.instanceId),
      };
    }));
  });

  const rowOf = (table: string): string => (table === 'workflow_decision' ? decisionId : historyId);

  for (const table of APPEND_ONLY_TABLES) {
    describe(table, () => {
      it('refuses an update', async () => {
        const refusal = await fixture.asTenant(TENANT_A, (client) =>
          probe(client, `update ${table} set metadata = '{"x":1}'::jsonb where id = $1`, [
            rowOf(table),
          ]),
        );

        expect(refusal).toContain(`${table}_immutable`);
      });

      it('refuses an update that changes nothing', async () => {
        // A no-op update is still an update, and a trigger written as "refuse if anything differs"
        // would let one through — which is a row whose `updated_at` moved for no reason anybody can
        // explain, on a table whose whole value is that it did not move.
        const refusal = await fixture.asTenant(TENANT_A, (client) =>
          probe(client, `update ${table} set id = id where id = $1`, [rowOf(table)]),
        );

        expect(refusal).toContain(`${table}_immutable`);
      });

      it('refuses a soft delete', async () => {
        const refusal = await fixture.asTenant(TENANT_A, (client) =>
          probe(
            client,
            `update ${table} set deleted_at = now(), deleted_by = 'user:test' where id = $1`,
            [rowOf(table)],
          ),
        );

        expect(refusal).toContain(`${table}_immutable`);
      });

      it('refuses a hard delete', async () => {
        const refusal = await fixture.asTenant(TENANT_A, (client) =>
          probe(client, `delete from ${table} where id = $1`, [rowOf(table)]),
        );

        expect(refusal).toContain(`${table}_immutable`);
      });

      it('refuses an unqualified update and an unqualified delete', async () => {
        const refusals = await fixture.asTenant(TENANT_A, async (client) => [
          await probe(client, `update ${table} set version = version + 1`),
          await probe(client, `delete from ${table}`),
        ]);

        for (const refusal of refusals) expect(refusal).toContain(`${table}_immutable`);
      });

      it('still accepts a new row, which is how a correction is made', async () => {
        const inserted = await fixture.asTenant(TENANT_A, async (client) =>
          table === 'workflow_decision'
            ? seedDecision(client, TENANT_A, { ...seeded, stepIds: [seeded.stepIds[1] ?? ''] })
            : seedHistory(client, TENANT_A, seeded.instanceId),
        );

        expect(inserted).toMatch(/^[0-9a-f-]{36}$/);

        const total = await fixture.asTenant(TENANT_A, (client) =>
          client.query<{ total: string }>(`select count(*)::text as total from ${table}`),
        );

        expect(total.rows[0]?.total).toBe('2');
      });

      it('leaves the original row exactly as it was after every refusal', async () => {
        const before = await fixture.asTenant(TENANT_A, (client) =>
          client.query<{ digest: string }>(
            `select ${table}::text as digest from ${table} where id = $1`,
            [rowOf(table)],
          ),
        );

        await fixture.asTenant(TENANT_A, async (client) => {
          await probe(client, `update ${table} set metadata = '{"x":1}'::jsonb where id = $1`, [
            rowOf(table),
          ]);
          await probe(client, `delete from ${table} where id = $1`, [rowOf(table)]);
        });

        const after = await fixture.asTenant(TENANT_A, (client) =>
          client.query<{ digest: string }>(
            `select ${table}::text as digest from ${table} where id = $1`,
            [rowOf(table)],
          ),
        );

        expect(after.rows[0]?.digest).toBe(before.rows[0]?.digest);
      });
    });
  }

  describe('what remains mutable, deliberately', () => {
    it('lets a step advance, because an approval that could not advance is not an engine', async () => {
      await fixture.asTenant(TENANT_A, (client) =>
        client.query(`update workflow_step set status = 'approved' where id = $1`, [
          seeded.stepIds[0],
        ]),
      );

      const moved = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ status: string }>(`select status from workflow_step where id = $1`, [
          seeded.stepIds[0],
        ]),
      );

      expect(moved.rows[0]?.status).toBe('approved');
    });

    it('lets an instance reach a terminal state', async () => {
      await fixture.asTenant(TENANT_A, (client) =>
        client.query(
          `update workflow_instance set status = 'completed', completed_at = now() where id = $1`,
          [seeded.instanceId],
        ),
      );

      const ended = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ status: string }>(`select status from workflow_instance where id = $1`, [
          seeded.instanceId,
        ]),
      );

      expect(ended.rows[0]?.status).toBe('completed');
    });

    it('has exactly two immutability triggers, and they are on the two append-only tables', async () => {
      const { rows } = await fixture.admin.query<{ tablename: string; tgname: string }>(
        `select c.relname as tablename, t.tgname
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname like 'workflow%' order by c.relname`,
      );

      expect(rows.map((row) => [row.tablename, row.tgname])).toStrictEqual([
        ['workflow_decision', 'workflow_decision_no_mutation'],
        ['workflow_history', 'workflow_history_no_mutation'],
      ]);
    });
  });
});
