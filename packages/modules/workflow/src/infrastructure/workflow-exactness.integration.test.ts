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
import {
  LATER,
  NOW,
  aDefinition,
  aDraft,
  aStartedInstance,
  aTemplate,
  anApproval,
} from './workflow-states.js';

/**
 * Exactness: the two integral columns and the instants, across the round trip.
 *
 * Workflow holds no `numeric`, no `bigint`, no money column and nothing a tenant types as a number.
 * What it does hold is a version number and a step ordinal — both `integer` and both deliberately
 * unbounded above (AD-004) — and a set of `timestamptz` columns. Neither kind is assumed to survive:
 * a column silently declared as `smallint` or `real` fails here rather than in a tenant's
 * fifty-thousandth step, and a truncating temporal column fails here rather than in an audit.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow exactness suite');

suite('workflow exactness', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_exactness_role');
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

  /**
   * A large ordinal survives as itself.
   *
   * AD-004 forbids a hardcoded approval limit, so the ordinals are `integer` rather than
   * `smallint`. `2147483000` is inside `integer` and far outside `smallint`, and it is also past
   * the point where a `real` column would start rounding — so a column silently declared as either
   * would fail here rather than in a tenant's fifty-thousandth step.
   */
  it('round-trips a step-template ordinal far past a smallint without rounding', async () => {
    const definition = aDefinition();
    const draft = aDraft(definition);
    const large = aTemplate(draft, 2_147_483_000);
    const modest = aTemplate(draft, 100_000);
    const read = await inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, definition);
      await fixture.stores.versions.insert(transaction, draft);
      await fixture.stores.versions.insertTemplate(transaction, large);
      await fixture.stores.versions.insertTemplate(transaction, modest);
      return fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId);
    });

    expect(read.map((template) => template.ordinal)).toEqual([100_000, 2_147_483_000]);
    expect(read.every((template) => Number.isInteger(template.ordinal))).toBe(true);
    expect(read[1]?.ordinal).toBe(2_147_483_000);
  });

  it('round-trips a version number of the same size', async () => {
    const definition = aDefinition();
    const draft = aDraft(definition, 2_147_483_000);
    const read = await inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, definition);
      await fixture.stores.versions.insert(transaction, draft);
      return {
        version: await fixture.stores.versions.byId(transaction, draft.workflowVersionId),
        next: await fixture.stores.versions.nextNumberFor(transaction, definition.definitionId),
      };
    });

    expect(read.version?.versionNumber).toBe(2_147_483_000);
    expect(read.next).toBe(2_147_483_001);
    expect(Number.isInteger(read.next)).toBe(true);
  });

  /**
   * Two instants five minutes and five hundred milliseconds apart stay that far apart.
   *
   * `timestamptz` keeps microseconds and the driver hands back a `Date`; nothing on this path
   * constructs a `Date` from a string or from a local midnight, because there is no civil date in
   * this module. A truncating column or a reinterpreting mapper would collapse the difference.
   */
  it('preserves the distance between two instants across the round trip', async () => {
    const started = aStartedInstance([APPROVER]);
    const decided = anApproval(started);
    const read = await inA(async (transaction) => {
      await writeStarted(transaction, started);
      await fixture.stores.decisions.insert(transaction, decided.decision);
      return {
        instance: await fixture.stores.instances.byId(transaction, started.instance.instanceId),
        decisions: await fixture.stores.decisions.forInstance(
          transaction,
          started.instance.instanceId,
        ),
      };
    });
    const startedAt = read.instance?.startedAt.getTime() ?? 0;
    const decidedAt = read.decisions[0]?.decidedAt.getTime() ?? 0;

    expect(decidedAt - startedAt).toBe(LATER.getTime() - NOW.getTime());
    expect(decidedAt - startedAt).toBe(300_500);
  });
});
