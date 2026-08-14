import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aStartedInstance, anApproval } from './workflow-states.js';
import { PostgresDecisionRepository, PostgresHistoryRepository } from './record.repository.js';

/**
 * The two tables nothing amends, asserted from both sides of the seam.
 *
 * **Above the database**: `PostgresDecisionRepository` and `PostgresHistoryRepository` do not extend
 * the shared `Repository` base, so they have no `updateRow`, no `softDeleteRow` and no `restoreRow`.
 * That is a compile-time property first — there is no method to call — and the assertions here are
 * its runtime shadow, so that a later edit adding `extends Repository` for convenience fails a test
 * rather than passing silently.
 *
 * **At the database**: a trigger refuses `update` and `delete` on both tables from any path,
 * including SQL nobody wrote in TypeScript. The repository shape is what a developer meets first; the
 * trigger is what holds when somebody opens a console. Neither is sufficient alone, which is why both
 * are checked.
 *
 * A correction is a new approval, never a rewritten decision (ADR-0045).
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository immutability suite');

suite('append-only records', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_immutable_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /** A committed decision and a committed history entry, both written through their repositories. */
  const recorded = async (): Promise<{ decisionId: string; historyId: string }> => {
    const seed = aStartedInstance([APPROVER]);
    const decided = anApproval(seed);
    const [entry] = seed.history;

    await inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
      await fixture.stores.instances.insert(transaction, seed.instance);
      for (const step of seed.steps) {
        await fixture.stores.steps.insert(transaction, step);
      }
      for (const written of seed.history) {
        await fixture.stores.history.insert(transaction, written);
      }
      await fixture.stores.decisions.insert(transaction, decided.decision);
    });

    return { decisionId: decided.decision.decisionId, historyId: entry?.historyId ?? '' };
  };

  it('offers no method through which a decision or a timeline could be rewritten', () => {
    const decisions: object = new PostgresDecisionRepository();
    const history: object = new PostgresHistoryRepository();

    for (const store of [decisions, history]) {
      expect('updateRow' in store).toBe(false);
      expect('softDeleteRow' in store).toBe(false);
      expect('restoreRow' in store).toBe(false);
      expect('update' in store).toBe(false);
    }
    expect(Object.getPrototypeOf(decisions)).not.toBe(Object.getPrototypeOf(history));
  });

  it('refuses an update of a recorded decision, from raw SQL', async () => {
    const written = await recorded();
    const refusals = await fixture.asTenant(TENANT_A, async (client) => ({
      amended: await probe(
        client,
        `update workflow_decision set comment = 'reconsidered' where id = $1`,
        [written.decisionId],
      ),
      softDeleted: await probe(
        client,
        `update workflow_decision set deleted_at = now() where id = $1`,
        [written.decisionId],
      ),
      removed: await probe(client, `delete from workflow_decision where id = $1`, [
        written.decisionId,
      ]),
    }));

    expect(refusals.amended).toMatch(/workflow_decision/);
    expect(refusals.amended).not.toBe('accepted');
    expect(refusals.softDeleted).not.toBe('accepted');
    expect(refusals.removed).not.toBe('accepted');
  });

  it('refuses an update of a timeline entry, from raw SQL', async () => {
    const written = await recorded();
    const refusals = await fixture.asTenant(TENANT_A, async (client) => ({
      amended: await probe(
        client,
        `update workflow_history set event = 'instance-cancelled' where id = $1`,
        [written.historyId],
      ),
      removed: await probe(client, `delete from workflow_history where id = $1`, [
        written.historyId,
      ]),
    }));

    expect(refusals.amended).not.toBe('accepted');
    expect(refusals.removed).not.toBe('accepted');
  });

  /** And the record is still there, unchanged, after everything above tried to change it. */
  it('leaves the recorded decision exactly as it was written', async () => {
    const written = await recorded();

    await fixture.asTenant(TENANT_A, async (client) => {
      await probe(client, `update workflow_decision set decision = 'rejected' where id = $1`, [
        written.decisionId,
      ]);
    });

    const after = await inA(async (transaction) => {
      const rows = await transaction.execute<{ decision: string; comment: string | null }>(
        `select decision, comment from workflow_decision where id = $1`,
        [written.decisionId],
      );

      return rows[0];
    });

    expect(after?.decision).toBe('approved');
    expect(after?.comment).toBeNull();
  });
});
