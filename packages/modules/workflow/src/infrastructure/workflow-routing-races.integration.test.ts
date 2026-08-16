import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type Transaction, type UnitOfWork } from '@work/kernel';

import {
  APPROVER,
  CONNECTION,
  REQUESTER,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  aManagerTemplate,
  aStartedApproval,
  aStartedInstance,
  anApproval,
  stepAt,
} from './workflow-states.js';
import { racingOn, type Racing } from './workflow-race.fixture.js';

/**
 * What Phase 16C's two capabilities do when two people act at the same instant — which, in both
 * cases, is **nothing new**.
 *
 * That is the finding, and it is worth two tests rather than an argument. A manager-resolved step is
 * an ordinary membership step, so it loses a duplicate decision to `workflow_decision_step_idx` by
 * name exactly as one somebody typed does; if the manager approver had acquired any persistence
 * mechanism of its own, this is where the difference would surface. And the three columns the phase
 * added are near no unique index at all, which has to be asserted **positively**: an index on
 * `awaiting_at` would make parallel approval unrepresentable, because every step of a branch opens at
 * the same instant by construction.
 *
 * Split from `workflow-repository-races.integration.test.ts` at the file-size budget, on the seam the
 * phase itself drew. Same two real connections, same overlapping transactions, same rule that an
 * outcome is classified by constraint name rather than by "an error happened".
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's routing race suite");

suite('routing races', () => {
  let fixture: WorkflowFixture;
  let second: UnitOfWork;
  let racing: Racing;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_routing_races_role');
    second = fixture.secondUnitOfWork();
    racing = racingOn(fixture, second);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const race: Racing['race'] = (first, challenger) => racing.race(first, challenger);

  const commit = (work: (transaction: Transaction) => Promise<void>): Promise<void> =>
    fixture.inTenant(TENANT_A, work);

  /**
   * Phase 16C added two columns to a step and an instant beside them, and **none of the three is
   * near a unique index**.
   *
   * Asserted positively, because the failure it guards against is one nobody would look for: an
   * index on `awaiting_at` would make parallel approval unrepresentable, since every step of a
   * branch opens at the same instant by construction. Two writers stamping the identical
   * millisecond on two steps must both commit, and here they do — with the same target on both, so
   * the service-level columns are in the race too.
   */
  it('lets two steps take the same awaiting instant and the same target at once', async () => {
    const seed = aStartedInstance([APPROVER, SECOND_APPROVER]);
    const [opening, sibling] = [stepAt(seed, 0), stepAt(seed, 1)];
    const together = new Date('2026-08-14T09:00:00.000Z');
    const target = { count: 2, unit: 'days' } as const;

    await commit(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
      await fixture.stores.instances.insert(transaction, seed.instance);
      for (const step of seed.steps) {
        await fixture.stores.steps.insert(transaction, step);
      }
    });

    const outcome = await race(
      (transaction) =>
        fixture.stores.steps.update(
          transaction,
          { ...opening, awaitingAt: together, serviceLevel: target },
          opening.version,
        ),
      (transaction) =>
        fixture.stores.steps.update(
          transaction,
          { ...sibling, status: 'awaiting', awaitingAt: together, serviceLevel: target },
          sibling.version,
        ),
    );

    expect([outcome.first, outcome.second]).toStrictEqual(['committed', 'committed']);
  });

  /**
   * And a manager-resolved step races exactly as a step somebody typed does, because it **is** one.
   *
   * Two decisions on one manager-resolved step, from two connections: one commits, and the second
   * loses to `workflow_decision_step_idx` by name rather than to "an error happened". If the
   * manager approver had acquired any persistence mechanism of its own, this is where the
   * difference would show.
   */
  it('records one decision on a manager-resolved step and refuses the second', async () => {
    const seed = aStartedApproval((draft) => [aManagerTemplate(draft, 1)], {
      manager: {
        requesterMembershipId: REQUESTER,
        resolution: {
          outcome: 'resolved',
          employmentId: '01930000-0000-7000-8000-0000000000f1',
          managerEmploymentId: '01930000-0000-7000-8000-0000000000f2',
          managerMembershipId: APPROVER,
        },
      },
    });
    const decided = anApproval(seed);

    await commit(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
      await fixture.stores.instances.insert(transaction, seed.instance);
      for (const step of seed.steps) {
        await fixture.stores.steps.insert(transaction, step);
      }
    });

    const outcome = await race(
      (transaction) => fixture.stores.decisions.insert(transaction, decided.decision),
      (transaction) =>
        fixture.stores.decisions.insert(transaction, {
          ...decided.decision,
          decisionId: uuidV7(),
        }),
    );

    expect(outcome.first).toBe('committed');
    expect(outcome.second).toBe('duplicate:workflow_decision_step_idx');
  });
});
