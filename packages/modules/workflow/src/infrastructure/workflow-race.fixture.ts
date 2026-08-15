import {
  ConcurrencyException,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';

import { TENANT_A, TEST_MEMBER, type WorkflowFixture } from './workflow-database.fixture.js';

/**
 * Two real PostgreSQL connections, overlapping in time, and a name for what each of them did.
 *
 * **No sleeps, no disabled constraints, and no helper that runs one after the other and calls it a
 * race.** Two transactions on a single pooled connection are the same transaction, so a "race"
 * written that way proves only that a program doing two things in order does them in order. The
 * second transaction here is opened while the first is still holding its write, and PostgreSQL — not
 * the test — decides the outcome: the second blocks on the index entry or the row lock and is
 * released, one way or the other, by the first's commit.
 *
 * **Every outcome is classified rather than merely caught.** A test that accepted any thrown error
 * would pass for a typo in the SQL as readily as for the invariant it came to check, so a refusal
 * names the constraint that produced it, and a stale version is distinguished from a duplicate key
 * by type rather than by message.
 */

/** What a transaction did, in terms a reader can act on. */
export type Outcome = string;

export const outcomeOf = async (attempt: Promise<unknown>): Promise<Outcome> => {
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

export interface Racing {
  /** The same tenant, on the other connection. */
  onSecond<TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult>;
  race(
    first: (transaction: Transaction) => Promise<void>,
    challenger: (transaction: Transaction) => Promise<void>,
  ): Promise<{ readonly first: Outcome; readonly second: Outcome }>;
}

export const racingOn = (fixture: WorkflowFixture, second: UnitOfWork): Racing => {
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

  return {
    onSecond,
    race: async (first, challenger) => {
      let written = (): void => undefined;
      let opened = (): void => undefined;
      const hasWritten = new Promise<void>((resolve) => {
        written = resolve;
      });
      const isOpen = new Promise<void>((resolve) => {
        opened = resolve;
      });
      const firstRun = fixture.inTenant(TENANT_A, async (transaction) => {
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
    },
  };
};
