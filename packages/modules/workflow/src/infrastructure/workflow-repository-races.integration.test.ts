import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyException,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TEST_MEMBER,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  SECOND_APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  LATER,
  aDefinition,
  aDraft,
  aStartedInstance,
  aTemplate,
  anApproval,
  stepAt,
} from './workflow-states.js';

/**
 * What happens when two people act at the same instant.
 *
 * **Two real PostgreSQL connections, in two real transactions, overlapping in time.** No sleeps, no
 * disabled constraints, and no helper that runs one after the other and calls it a race. Two
 * transactions on a single pooled connection are the same transaction, so a "race" written that way
 * proves only that a program doing two things in order does them in order.
 *
 * The second transaction is opened while the first is still holding its write, and PostgreSQL — not
 * this file — decides the outcome: the second blocks on the index or the row until the first
 * commits, and then either fails or finds the world changed underneath it.
 *
 * **Every outcome is classified rather than merely caught.** A test that accepted any thrown error
 * would pass for a typo in the SQL as readily as for the invariant it came to check, so a refusal
 * here names the constraint that produced it, and a stale version is distinguished from a duplicate
 * key by type rather than by message.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository race suite');

/** What a transaction did, in terms a reader can act on. */
type Outcome = string;

const outcomeOf = async (attempt: Promise<unknown>): Promise<Outcome> => {
  try {
    await attempt;
    return 'committed';
  } catch (error: unknown) {
    if (error instanceof ConcurrencyException) return 'stale-version';

    const failure = error as { code?: string; constraint?: string; message?: string };

    if (failure.code === '23505') return `duplicate:${failure.constraint ?? 'unnamed'}`;
    if (failure.code === '40001') return 'serialization-failure';
    return `other:${failure.code ?? failure.message ?? 'unknown'}`;
  }
};

suite('repository races', () => {
  let fixture: WorkflowFixture;
  let second: UnitOfWork;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_races_role');
    second = fixture.secondUnitOfWork();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /** The same tenant, on the **other** connection. */
  const onSecond = <TResult>(
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext(
      {
        tenantId: TENANT_A,
        correlationId: uuidV7(),
        actor: 'user:workflow-second',
        membershipId: TEST_MEMBER,
      },
      () => second.execute(work),
    );

  /**
   * Two transactions, overlapping, both writing.
   *
   * The first writes and then waits. The second's transaction is opened and reaches its own write
   * while the first is still uncommitted — the point at which PostgreSQL takes over: the second
   * blocks on the index entry or the row lock, and is released, one way or the other, by the first's
   * commit.
   */
  const race = async (
    first: (transaction: Transaction) => Promise<void>,
    challenger: (transaction: Transaction) => Promise<void>,
  ): Promise<{ readonly first: Outcome; readonly second: Outcome }> => {
    let written = (): void => undefined;
    let opened = (): void => undefined;
    const hasWritten = new Promise<void>((resolve) => {
      written = resolve;
    });
    const isOpen = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const firstRun = inA(async (transaction) => {
      await first(transaction);
      written();
      await isOpen;
    });

    await hasWritten;

    const secondRun = onSecond(async (transaction) => {
      opened();
      await challenger(transaction);
    });

    return { first: await outcomeOf(firstRun), second: await outcomeOf(secondRun) };
  };

  /** Rows both racers need to exist and be committed before they start. */
  const commit = (work: (transaction: Transaction) => Promise<void>): Promise<void> => inA(work);

  describe('two writers, one invariant', () => {
    it('lets one definition code through and refuses the other', async () => {
      const outcome = await race(
        (transaction) =>
          fixture.stores.definitions.insert(transaction, aDefinition({ code: 'shared-code' })),
        (transaction) =>
          fixture.stores.definitions.insert(transaction, aDefinition({ code: 'shared-code' })),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_definition_code_idx');
    });

    it('lets one version number through and refuses the other', async () => {
      const definition = aDefinition();

      await commit((transaction) => fixture.stores.definitions.insert(transaction, definition));

      const outcome = await race(
        (transaction) => fixture.stores.versions.insert(transaction, aDraft(definition, 2)),
        (transaction) => fixture.stores.versions.insert(transaction, aDraft(definition, 2)),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_version_number_idx');
    });

    it('lets one step template take an ordinal and refuses the other', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);

      await commit(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
      });

      const outcome = await race(
        (transaction) => fixture.stores.versions.insertTemplate(transaction, aTemplate(draft, 3)),
        (transaction) =>
          fixture.stores.versions.insertTemplate(transaction, aTemplate(draft, 3, SECOND_APPROVER)),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_step_template_ordinal_idx');
    });

    /**
     * **Two requests for the same subject converge on one approval.**
     *
     * This is the race the duplicate-convergence read cannot win on its own: both callers look for an
     * open approval, both find none, and both start one. The index is what settles it, which is why
     * the convergence read is an optimization and the index is the rule.
     */
    it('starts one approval for a subject and refuses the simultaneous second', async () => {
      const first = aStartedInstance([APPROVER], { subjectId: 'requisition-9' });
      const challenger = aStartedInstance([APPROVER], { subjectId: 'requisition-9' });

      await commit(async (transaction) => {
        for (const seed of [first, challenger]) {
          await fixture.stores.definitions.insert(transaction, seed.definition);
          await fixture.stores.versions.insert(transaction, seed.version);
        }
      });

      const outcome = await race(
        (transaction) => fixture.stores.instances.insert(transaction, first.instance),
        (transaction) => fixture.stores.instances.insert(transaction, challenger.instance),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_instance_open_subject_idx');
    });

    it('lets one step take an ordinal on an instance and refuses the other', async () => {
      const seed = aStartedInstance([APPROVER]);

      await commit(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
      });

      const extra = (): Parameters<typeof fixture.stores.steps.insert>[1] => ({
        stepId: uuidV7(),
        instanceId: seed.instance.instanceId,
        ordinal: 4,
        approverKind: 'membership',
        approverMembershipId: APPROVER,
        status: 'pending',
        version: 1,
      });
      const outcome = await race(
        (transaction) => fixture.stores.steps.insert(transaction, extra()),
        (transaction) => fixture.stores.steps.insert(transaction, extra()),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_step_ordinal_idx');
    });

    /**
     * **Two steps of one approval cannot become current at the same instant.**
     *
     * The index that carries sequential approval, under the condition it exists for. Both racers move
     * a different step into `awaiting`; one of them has to lose, or an approval would be asking two
     * people for a decision it will only record one of.
     */
    it('lets one step become awaiting and refuses the simultaneous other', async () => {
      const seed = aStartedInstance([APPROVER, SECOND_APPROVER, APPROVER]);
      const decided = anApproval(seed);
      const next = stepAt(seed, 1);
      const last = stepAt(seed, 2);

      await commit(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        for (const step of seed.steps) {
          await fixture.stores.steps.insert(transaction, step);
        }
        // The first step leaves `awaiting`, so the index is free for exactly one of the two racers.
        await fixture.stores.steps.update(transaction, decided.step, decided.step.version);
      });

      const outcome = await race(
        (transaction) =>
          fixture.stores.steps.update(transaction, { ...next, status: 'awaiting' }, next.version),
        (transaction) =>
          fixture.stores.steps.update(transaction, { ...last, status: 'awaiting' }, last.version),
      );

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('duplicate:workflow_step_awaiting_idx');
    });

    /** And one decision per step, when the approver's second click arrives on another connection. */
    it('records one decision on a step and refuses the simultaneous second', async () => {
      const seed = aStartedInstance([APPROVER]);
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

  describe('optimistic concurrency', () => {
    /**
     * Two administrators cancelling the same approval: one wins, one is told the world moved.
     *
     * The loser's refusal is `ConcurrencyException`, raised because the `where version = $expected`
     * in the update matched no row — **not** because anything was caught and relabelled. The two
     * outcomes are distinguished by type here for that reason.
     */
    it('lets the first update through and tells the second its version is stale', async () => {
      const seed = aStartedInstance([APPROVER]);

      await commit(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
      });

      const cancel = (reason: string) => (transaction: Transaction) =>
        fixture.stores.instances.update(
          transaction,
          {
            ...seed.instance,
            status: 'cancelled',
            completedAt: LATER,
            cancelledBy: 'user:admin',
            cancellationReason: reason,
          },
          seed.instance.version,
        );
      const outcome = await race(cancel('budget withdrawn'), cancel('role filled internally'));

      expect(outcome.first).toBe('committed');
      expect(outcome.second).toBe('stale-version');

      const after = await inA((transaction) =>
        fixture.stores.instances.byId(transaction, seed.instance.instanceId),
      );

      expect(after?.cancellationReason).toBe('budget withdrawn');
      // Exactly once: a lost update would have left it at 1, and a double-applied one at 3.
      expect(after?.version).toBe(2);
    });

    /**
     * The whole three-step property, in sequence: current succeeds, stale is refused, next succeeds.
     *
     * The middle assertion is the one that matters, and the third is what proves the refusal did not
     * simply break the row: after being told it was stale, a caller that re-reads and retries gets
     * through.
     */
    it('accepts the current version, refuses the stale one, then accepts the next', async () => {
      const definition = aDefinition();

      await commit((transaction) => fixture.stores.definitions.insert(transaction, definition));

      const retired = {
        ...definition,
        status: 'retired' as const,
        retiredAt: LATER,
        retiredBy: 'user:admin',
      };

      await inA((transaction) => fixture.stores.definitions.update(transaction, retired, 1));

      await expect(
        inA((transaction) => fixture.stores.definitions.update(transaction, retired, 1)),
      ).rejects.toThrow(ConcurrencyException);

      const after = await inA(async (transaction) => {
        await fixture.stores.definitions.update(transaction, retired, 2);
        return fixture.stores.definitions.byId(transaction, definition.definitionId);
      });

      expect(after?.status).toBe('retired');
      expect(after?.version).toBe(3);
    });

    /**
     * A stale update affects **zero rows**, rather than one row it should not have.
     *
     * Asserted against the statement itself as well as through the repository: the version is in the
     * `where` clause of the write, not in a read that precedes it. A repository that compared versions
     * in JavaScript and then updated without the predicate would satisfy every assertion above and
     * still lose a write, because the gap between its read and its write is exactly where the second
     * writer disappears.
     */
    it('matches no row when the version is stale', async () => {
      const definition = aDefinition();

      await commit((transaction) => fixture.stores.definitions.insert(transaction, definition));

      const affected = await inA(async (transaction) => {
        const rows = await transaction.execute<{ id: string }>(
          `update workflow_definition set status = 'retired', retired_at = now(),
             retired_by = 'user:admin', version = version + 1
             where id = $1 and tenant_id = $2 and version = $3 and deleted_at is null
             returning id`,
          [definition.definitionId, TENANT_A, 99],
        );

        return rows.length;
      });

      expect(affected).toBe(0);
    });
  });
});
