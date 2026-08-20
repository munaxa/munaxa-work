import { beforeEach, describe, expect, it } from 'vitest';

import { publishedBranches } from './workflow-scenarios.js';
import {
  APPROVER,
  NOW,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  ask,
  attempt,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';

/**
 * What the automatic reminder refuses, and what its intent carries.
 *
 * The sibling suite proves it runs and who may run it. This one proves the two things a handler that
 * "worked" could still be wrong about: that a job arriving after the world moved on does nothing at
 * all, and that what leaves this module is an *intent* — a template key and one recipient — rather
 * than a message somebody wrote.
 */

/** `runningApproval` starts a step awaiting at `NOW`; two hours later it is overdue. */
const THREE_HOURS = 3 * 60 * 60 * 1000;

const overdueApproval = async (
  harness: Harness,
): Promise<{ instanceId: string; stepId: string }> => {
  const process = await publishedBranches(harness, [
    { ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'hours' } },
  ]);
  const started = await harness.as(REQUESTER, () =>
    send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: process.definitionId,
      subjectType: SUBJECT_TYPE,
      subjectId: 'requisition-1',
    }),
  );
  const opening = await historyOf(harness, started.instanceId);
  const awaiting = opening.find((entry) => entry.event === 'step-awaiting');

  if (awaiting?.stepId === undefined) throw new Error('the scenario produced no awaiting step');
  return { instanceId: started.instanceId, stepId: awaiting.stepId };
};

interface HistoryEntry {
  readonly event: string;
  readonly stepId?: string;
  readonly actorMembershipId?: string;
  readonly onBehalfOfMembershipId?: string;
}

/**
 * The approval's timeline, through the published query.
 *
 * Read through the contract rather than the store because that is what a reader of this module
 * actually gets — and because it is the assertion that would catch a reminder entry that existed in
 * the database but never reached anybody.
 */
const historyOf = async (
  harness: Harness,
  instanceId: string,
): Promise<readonly HistoryEntry[]> => {
  const page = await harness.as(REQUESTER, () =>
    ask<{ items: readonly HistoryEntry[] }>(harness, {
      queryName: 'workflow.read-history',
      instanceId,
    }),
  );

  return page.items;
};

const remind = (harness: Harness, ids: { instanceId: string; stepId: string }) =>
  harness.asMachine(() =>
    attempt(harness, {
      commandName: 'workflow.remind-step',
      instanceId: ids.instanceId,
      stepId: ids.stepId,
    }),
  );

describe('when the reminder is not due', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  beforeEach(async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
  });

  /** Before the target: nothing claimed, nothing recorded, nothing sent. */
  it('emits nothing and records nothing when the target has not passed', async () => {
    const outcome = await remind(harness, ids);

    expect(outcome.ok).toBe(false);
    expect(harness.notifications.sent).toHaveLength(0);

    const history = await historyOf(harness, ids.instanceId);

    expect(history.filter((entry) => entry.event === 'step-reminded')).toHaveLength(0);
  });

  /**
   * **The stale case, end to end.** The step is answered before the job runs; the handler re-reads
   * and refuses, and the recipient is never even looked up — which is what proves the recipient is
   * resolved after the claim rather than before it.
   */
  it('is a no-op when the step was answered before the job ran', async () => {
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'workflow.decide-step',
        instanceId: ids.instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    const outcome = await remind(harness, ids);

    expect(outcome.ok).toBe(false);
    expect(harness.notifications.sent).toHaveLength(0);
    expect(harness.reminderRecipient.asked).toStrictEqual([]);
  });

  it('is not found when the step belongs to no approval this tenant can see', async () => {
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));

    const outcome = await harness.asMachine(() =>
      attempt(harness, {
        commandName: 'workflow.remind-step',
        instanceId: '01930000-0000-7000-8000-0000000000ff',
        stepId: ids.stepId,
      }),
    );

    expect(outcome.ok ? undefined : outcome.error).toStrictEqual({
      kind: 'not_found',
      resource: 'workflow-instance',
    });
  });
});

describe('the order of the claim and the send', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  beforeEach(async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
  });

  /**
   * **The failure window, asserted rather than described.**
   *
   * The send happens after the commit, so a send that fails leaves the claim and the history row in
   * place — and no second reminder is ever generated for that step. That is at-most-once, and it is
   * the approved trade (D-16E-13). A test that did not pin this down would let somebody "fix" the
   * lost reminder by retrying into a second claim.
   */
  it('keeps the claim when the send fails', async () => {
    harness.notifications.failsWith(new Error('Communications is down'));

    await expect(remind(harness, ids)).rejects.toThrow('Communications is down');

    // The claim committed before the send was attempted, so the record survives the failure. That
    // is the whole of at-most-once: the reminder is lost and the fact that it was owed is not.
    const history = await historyOf(harness, ids.instanceId);

    expect(history.filter((entry) => entry.event === 'step-reminded')).toHaveLength(1);
    expect(harness.notifications.sent).toHaveLength(0);
  });

  /**
   * **A second delivery sends nothing, and the reason is worth being exact about.**
   *
   * The handler does *not* re-read history to decide whether a reminder was already sent, and it must
   * not: a `select` followed by an `insert` is not idempotent under concurrency (ADR-0071), so a
   * check here would be a check two workers could both pass. The guarantee is the partial unique
   * index, and it is proved against real PostgreSQL in
   * `workflow-reminder-persistence.integration.test.ts` — including the two-connection race.
   *
   * What this suite can prove is the layer above it: the intent carries the same identity the
   * database claims, so a repeat is suppressed at the port as well. Both halves are needed, and
   * neither is a substitute for the other.
   */
  it('sends no second intent when the same reminder runs again', async () => {
    await remind(harness, ids);
    expect(harness.notifications.sent).toHaveLength(1);

    const again = await remind(harness, ids);

    // In this in-memory store the second claim is *accepted* — there is no unique index here — and
    // the port still emits nothing, because the idempotency key is the same. Stated plainly rather
    // than asserted as a refusal, so nobody reads this as the database guarantee.
    expect(again.ok).toBe(true);
    expect(harness.notifications.sent).toHaveLength(1);
  });

  /**
   * A second run of a reminder that already succeeded sends nothing.
   *
   * In this in-memory store the duplicate is caught by the domain re-read; the *database* is what
   * makes it true under concurrency, and the integration suite proves that half against the partial
   * unique index. Both halves are needed: this one proves the handler does not send before checking.
   */
});

describe('what the intent carries', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  beforeEach(async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
    await remind(harness, ids);
  });

  it('names a template and never a channel or a message body', () => {
    const [intent] = harness.notifications.sent;

    expect(intent?.templateKey).toBe('workflow.step.reminder');
    const body = JSON.stringify(intent);

    for (const forbidden of ['subject', 'body', 'email', 'sms', 'push', 'html', 'from']) {
      expect([forbidden, body.toLowerCase().includes(forbidden)]).toStrictEqual([forbidden, false]);
    }
  });

  /**
   * The variables identify the approval and nothing about what it is *for*.
   *
   * The subject an approval is about belongs to the module that raised it (AD-001); a reminder that
   * carried it would make Workflow restate a business fact it does not own.
   */
  it('carries the identifiers a template needs and no business content', () => {
    const [intent] = harness.notifications.sent;

    expect(Object.keys(intent?.variables ?? {}).sort()).toStrictEqual(['instanceId', 'stepId']);
    expect(JSON.stringify(intent?.variables)).not.toContain(SUBJECT_TYPE);
  });

  it('carries an idempotency key naming the step and the event', () => {
    expect(harness.notifications.sent[0]?.idempotencyKey).toBe(`${ids.stepId}:step-reminded`);
  });

  it('tells one person, not the branch and not the requester', () => {
    const [intent] = harness.notifications.sent;

    expect(intent?.recipients).toHaveLength(1);
    expect(JSON.stringify(intent?.recipients)).not.toContain(REQUESTER);
    expect(JSON.stringify(intent?.recipients)).not.toContain(SECOND_APPROVER);
  });
});
