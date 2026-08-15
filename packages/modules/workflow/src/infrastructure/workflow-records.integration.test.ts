import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { LATER, NOW, aDelegatedApproval, aStartedInstance, anApproval } from './workflow-states.js';

/**
 * The two append-only tables, across the round trip: what an approver said, and how the approval was
 * routed.
 *
 * These are the rows somebody asks about a year later, so the assertions are about honesty as much
 * as about persistence. A **delegated** decision keeps two memberships in two columns — the deputy
 * who acted and the approver whose authority they used — and a mapper that read one into the other
 * would put a name in the audit trail against an act that person did not perform. The queue's other
 * half is keyed the same way: a delegated decision is listed for the delegate, because they are the
 * one who decided it.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow records suite');

suite('workflow decisions and history', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_records_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /** A whole started instance: definition, version, templates, instance, steps and history. */
  const writeStarted = async (
    transaction: Transaction,
    started: ReturnType<typeof aStartedInstance>,
  ): Promise<void> => {
    await fixture.stores.definitions.insert(transaction, started.definition);
    await fixture.stores.versions.insert(transaction, started.version);
    for (const template of started.templates) {
      await fixture.stores.versions.insertTemplate(transaction, template);
    }
    await fixture.stores.instances.insert(transaction, started.instance);
    for (const step of started.steps) {
      await fixture.stores.steps.insert(transaction, step);
    }
    for (const entry of started.history) {
      await fixture.stores.history.insert(transaction, entry);
    }
  };

  it('round-trips an assigned decision and reads it back for the instance', async () => {
    const started = aStartedInstance([APPROVER]);
    const decided = anApproval(started, { comment: 'Headcount was already budgeted' });
    const read = await inA(async (transaction) => {
      await writeStarted(transaction, started);
      await fixture.stores.decisions.insert(transaction, decided.decision);
      return fixture.stores.decisions.forInstance(transaction, started.instance.instanceId);
    });

    expect(read).toEqual([decided.decision]);
    expect(read[0]?.authority).toBe('assigned');
    expect(Object.keys(read[0] ?? {})).not.toContain('onBehalfOfMembershipId');
    expect(read[0]?.decidedAt.getTime()).toBe(LATER.getTime());
  });

  /**
   * A delegated decision keeps **both** memberships, in the columns that mean them.
   *
   * The deputy is who decided; the approver is whose authority was used. A schema that collapsed
   * them, or a mapper that read one into the other, would put a name in the audit trail against an
   * act that person did not perform.
   */
  it('keeps the delegate and the delegator apart across the round trip', async () => {
    const started = aStartedInstance([APPROVER]);
    const decided = aDelegatedApproval(started);
    const read = await inA(async (transaction) => {
      await writeStarted(transaction, started);
      await fixture.stores.decisions.insert(transaction, decided.decision);
      return fixture.stores.decisions.forInstance(transaction, started.instance.instanceId);
    });

    expect(read[0]).toEqual(decided.decision);
    expect(read[0]?.authority).toBe('delegated');
    expect(read[0]?.decidedByMembershipId).not.toBe(read[0]?.onBehalfOfMembershipId);
    expect(read[0]?.onBehalfOfMembershipId).toBe(APPROVER);
  });

  /** And the queue's other half: what one membership decided is keyed on who *acted*. */
  it('lists a delegated decision for the delegate and not for the delegator', async () => {
    const started = aStartedInstance([APPROVER]);
    const decided = aDelegatedApproval(started);
    const lists = await inA(async (transaction) => {
      await writeStarted(transaction, started);
      await fixture.stores.decisions.insert(transaction, decided.decision);
      return {
        deputy: await fixture.stores.decisions.decidedBy(
          transaction,
          decided.decision.decidedByMembershipId,
          { limit: 10, offset: 0 },
        ),
        approver: await fixture.stores.decisions.decidedBy(transaction, APPROVER, {
          limit: 10,
          offset: 0,
        }),
      };
    });

    expect(lists.deputy.total).toBe(1);
    expect(lists.approver.total).toBe(0);
  });

  it('round-trips a timeline oldest first, with the instance-level entry carrying no step', async () => {
    const started = aStartedInstance([APPROVER]);
    const page = await inA(async (transaction) => {
      await writeStarted(transaction, started);
      return fixture.stores.history.forInstance(transaction, started.instance.instanceId, {
        limit: 10,
        offset: 0,
      });
    });

    expect(page.total).toBe(2);
    expect(page.items.map((entry) => entry.event)).toEqual(['instance-started', 'step-awaiting']);
    expect(Object.keys(page.items[0] ?? {})).not.toContain('stepId');
    expect(page.items[1]?.ordinal).toBe(1);
    expect(page.items[0]?.occurredAt.getTime()).toBe(NOW.getTime());
  });
});
