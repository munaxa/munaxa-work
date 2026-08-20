import { beforeEach, describe, expect, it } from 'vitest';

import type { PendingApprovalView, WorkflowInstanceDetailView } from '../contracts/views.js';
import type { WorkflowDefinitionDetailView } from '../contracts/views.js';
import type { Page } from './workflow-ports.js';
import { approveAs, publishedBranches, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  NOW,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  ask,
  attempt,
  failureOf,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';

/**
 * A service-level target, from configuration to the number a screen shows — and the four things it
 * still is not.
 *
 * **It is not a deadline.** Nothing fires when it passes: no step becomes `expired`, no instance ends,
 * no branch moves, no denominator shifts and no history entry is written (D-16C-06). Every assertion
 * below is about a *question answered at read time*, and several exist only to prove that nothing
 * changed underneath it.
 *
 * **It is not stored, past its two inputs.** What persists is the count, the unit and the instant the
 * step became awaiting. Due, overdue and by-how-much are computed from those three and an explicit
 * reading instant, every time they are asked. A stored due time would disagree with its own inputs the
 * first time somebody corrected a target; a stored `overdue` would need a scheduler this phase does
 * not have (D-16C-01) or a synthetic actor ADR-0045 refuses (D-16C-02).
 *
 * **Its clock starts when the step becomes awaiting, not when the approval started** (P-5). The suite
 * asserts that on a sequential chain, where the two differ by however long the first step took, and on
 * a parallel branch, where every step starts together.
 *
 * **The reading instant comes from the clock port**, which is what makes any of this assertable: the
 * harness advances a fixed clock, and the same approval read twice gives two answers with no elapsed
 * real time at all.
 */

const ONE_DAY = { count: 1, unit: 'days' };

const detailOf = (harness: Harness, instanceId: string) =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

/** A step with its derived target set aside, so the *stored* row can be compared field for field. */
const withoutServiceLevel = (
  step: WorkflowInstanceDetailView['steps'][number] | undefined,
): unknown => {
  if (step === undefined) return undefined;
  const { serviceLevel: _derived, ...stored } = step;

  return stored;
};

const queueOf = (harness: Harness, membershipId: string) =>
  harness.as(membershipId, () =>
    ask<Page<PendingApprovalView>>(harness, { queryName: 'workflow.pending-approvals' }),
  );

describe('configuring a target', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('publishes it on the template, exactly as it was typed', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 48, unit: 'hours' } }],
      'target-configured',
    );
    const read = await ask<WorkflowDefinitionDetailView>(harness, {
      queryName: 'workflow.read-definition',
      definitionId: process.definitionId,
    });

    // Forty-eight hours, not two days. The same length of time is not the same sentence, and the
    // screen has to show an administrator back what they wrote.
    expect(read.publishedSteps?.[0]?.serviceLevel).toStrictEqual({ count: 48, unit: 'hours' });
  });

  it('has no target at all where none was configured', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER }],
      'target-absent',
    );
    const read = await ask<WorkflowDefinitionDetailView>(harness, {
      queryName: 'workflow.read-definition',
      definitionId: process.definitionId,
    });

    expect(read.publishedSteps?.[0]?.serviceLevel).toBeUndefined();
  });

  /** Checked at the boundary an untrusted count and unit arrive at, and refused rather than rounded. */
  it.each([
    [{ count: 0, unit: 'hours' }, 'service-level-count-invalid'],
    [{ count: -1, unit: 'days' }, 'service-level-count-invalid'],
    [{ count: 1.5, unit: 'days' }, 'service-level-count-invalid'],
    [{ count: 1, unit: 'minutes' }, 'service-level-unit-invalid'],
    [{ count: 2, unit: 'business-days' }, 'service-level-unit-invalid'],
  ])('refuses %o', async (serviceLevel, reason) => {
    // A definition code is a code: no dots, so `1.5` cannot go into one verbatim.
    const slug = String(serviceLevel.count).replace(/[^a-z0-9]/gi, '');
    const version = await draftFor(harness, `bad-${slug}-${serviceLevel.unit}`);
    const refused = await attempt(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version,
      ordinal: 1,
      name: { en: 'Step', ar: 'خطوة' },
      approverMembershipId: APPROVER,
      serviceLevel,
    });

    expect(failureOf(refused)).toBe(`workflow.rejection.${reason}`);
  });
});

/** A draft to add a bad step to. `publishedBranches` cannot build one, because it would not publish. */
const draftFor = async (harness: Harness, code: string): Promise<string> => {
  const created = await send<{ definitionId: string }>(harness, {
    commandName: 'workflow.create-definition',
    code,
    name: { en: 'Bad target', ar: 'هدف غير صالح' },
    subjectType: SUBJECT_TYPE,
  });
  const drafted = await send<{ workflowVersionId: string }>(harness, {
    commandName: 'workflow.draft-version',
    definitionId: created.definitionId,
  });

  return drafted.workflowVersionId;
};

describe('when the clock starts', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('starts the first step’s clock at the instant the approval started', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, serviceLevel: ONE_DAY }],
      'clock-first',
    );
    const instanceId = await startedOn(harness, process, 'clock-1');
    const detail = await detailOf(harness, instanceId);

    expect(detail.steps[0]?.serviceLevel).toStrictEqual({
      count: 1,
      unit: 'days',
      awaitingOn: NOW.toISOString(),
      dueOn: '2026-08-15T09:00:00.000Z',
      state: 'within',
    });
  });

  /**
   * The whole of P-5, on a chain.
   *
   * The second step's clock starts when the *first* is answered — a fortnight later, here — and not
   * when the approval was raised. Under the rejected reading the second step would already be
   * thirteen days overdue at the moment somebody was first asked to look at it.
   */
  it('starts a later step’s clock when that step becomes awaiting, not when the approval did', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverMembershipId: SECOND_APPROVER, serviceLevel: ONE_DAY },
      ],
      'clock-second',
    );
    const instanceId = await startedOn(harness, process, 'clock-2');

    // Nothing yet: nobody is waiting on the second step, so it has no clock and no due time.
    const before = await detailOf(harness, instanceId);

    expect(before.steps[1]?.serviceLevel).toStrictEqual({ count: 1, unit: 'days', state: 'none' });

    harness.clock.advanceTo(new Date('2026-08-28T09:00:00.000Z'));
    await approveAs(harness, APPROVER, instanceId);

    const after = await detailOf(harness, instanceId);

    expect(after.steps[1]?.serviceLevel).toMatchObject({
      awaitingOn: '2026-08-28T09:00:00.000Z',
      dueOn: '2026-08-29T09:00:00.000Z',
      state: 'within',
    });
  });

  /** Every step of a parallel branch opens together, so every one of them starts its own clock then. */
  it('starts every step of a branch together', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER, serviceLevel: ONE_DAY },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER, serviceLevel: ONE_DAY },
      ],
      'clock-branch',
    );
    const instanceId = await startedOn(harness, process, 'clock-3');
    const detail = await detailOf(harness, instanceId);
    const started = detail.steps.map((step) => step.serviceLevel?.awaitingOn);

    expect(started).toStrictEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  /**
   * A decision on one step of a branch does not restart the sibling's clock.
   *
   * Nothing restarts a running clock — not an escalation, not a delegation, and not somebody else
   * answering. This is the case a reader would most reasonably expect to be wrong.
   */
  it('never moves an instant already set', async () => {
    const process = await publishedBranches(
      harness,
      [
        {
          ordinal: 1,
          approverMembershipId: APPROVER,
          branchRule: 'unanimous',
          serviceLevel: ONE_DAY,
        },
        {
          ordinal: 1,
          approverMembershipId: SECOND_APPROVER,
          branchRule: 'unanimous',
          serviceLevel: ONE_DAY,
        },
      ],
      'clock-unmoved',
    );
    const instanceId = await startedOn(harness, process, 'clock-4');

    harness.clock.advanceTo(new Date('2026-09-01T09:00:00.000Z'));
    await approveAs(harness, APPROVER, instanceId);

    const detail = await detailOf(harness, instanceId);
    const waiting = detail.steps.find((step) => step.status === 'awaiting');

    expect(waiting?.serviceLevel?.awaitingOn).toBe(NOW.toISOString());
  });
});

describe('whether a step is overdue, as at the instant it was read', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();

    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'hours' } }],
      'overdue',
    );

    instanceId = await startedOn(harness, process, 'overdue-1');
  });

  /** Two hours to approve means two whole hours: the boundary itself is met. */
  it('is within its target up to the boundary and overdue after it', async () => {
    harness.clock.advanceTo(new Date('2026-08-14T11:00:00.000Z'));
    expect((await detailOf(harness, instanceId)).steps[0]?.serviceLevel?.state).toBe('within');

    harness.clock.advanceTo(new Date('2026-08-14T11:00:00.001Z'));
    expect((await detailOf(harness, instanceId)).steps[0]?.serviceLevel?.state).toBe('overdue');
  });

  /** Whole minutes, truncated. A step three seconds late is overdue by zero, never by one. */
  it('reports overdue minutes as a truncated whole number, and nothing while within', async () => {
    harness.clock.advanceTo(new Date('2026-08-14T11:00:00.000Z'));
    expect(
      (await detailOf(harness, instanceId)).steps[0]?.serviceLevel?.overdueByMinutes,
    ).toBeUndefined();

    harness.clock.advanceTo(new Date('2026-08-14T11:00:59.999Z'));
    expect((await detailOf(harness, instanceId)).steps[0]?.serviceLevel?.overdueByMinutes).toBe(0);

    harness.clock.advanceTo(new Date('2026-08-14T12:30:00.000Z'));
    expect((await detailOf(harness, instanceId)).steps[0]?.serviceLevel?.overdueByMinutes).toBe(90);
  });

  /**
   * The assertion that proves nothing is stored.
   *
   * The same approval, read at two instants, gives two answers — with no write in between and no
   * elapsed real time at all. A stored due-ness could not do that, and a mapper that read a clock of
   * its own could not be asserted this way.
   */
  it('answers from the reading instant, with nothing written in between', async () => {
    harness.clock.advanceTo(new Date('2026-08-14T10:00:00.000Z'));

    const early = await detailOf(harness, instanceId);

    harness.clock.advanceTo(new Date('2026-08-20T10:00:00.000Z'));

    const late = await detailOf(harness, instanceId);
    const [before] = early.steps;
    const [after] = late.steps;

    expect([before?.serviceLevel?.state, after?.serviceLevel?.state]).toStrictEqual([
      'within',
      'overdue',
    ]);
    // And the step itself did not move: same status, same version, same instant it began waiting.
    // Compared as one object so a field that silently changed cannot hide behind a passing sibling.
    expect(withoutServiceLevel(after)).toStrictEqual(withoutServiceLevel(before));
    expect(after?.serviceLevel?.awaitingOn).toBe(before?.serviceLevel?.awaitingOn);
  });

  /**
   * An overdue step changes nothing else about the approval, and this is the list of what it does not
   * change.
   *
   * The instance is still running, the branch is still open, the tally's denominator has not moved,
   * and the timeline has not gained an entry. There is no `expired` anywhere, and no history event a
   * screen could read as "this lapsed".
   */
  it('leaves the approval, the tally and the timeline untouched', async () => {
    const before = await detailOf(harness, instanceId);
    const timelineBefore = await ask<Page<{ readonly event: string }>>(harness, {
      queryName: 'workflow.read-history',
      instanceId,
    });

    harness.clock.advanceTo(new Date('2027-01-01T00:00:00.000Z'));

    const after = await detailOf(harness, instanceId);
    const timelineAfter = await ask<Page<{ readonly event: string }>>(harness, {
      queryName: 'workflow.read-history',
      instanceId,
    });

    expect(after.steps[0]?.serviceLevel?.state).toBe('overdue');
    expect(after.instance.status).toBe('running');
    expect(after.instance).toStrictEqual(before.instance);
    expect(after.tallies).toStrictEqual(before.tallies);
    expect(timelineAfter.items).toStrictEqual(timelineBefore.items);
    expect(timelineAfter.items.map((entry) => entry.event)).not.toContain('step-expired');
  });

  /** And the step is still on the caller's queue, overdue or not. Nothing removed it. */
  it('keeps an overdue step on its approver’s queue, with its target beside it', async () => {
    harness.clock.advanceTo(new Date('2026-08-20T10:00:00.000Z'));

    const queue = await queueOf(harness, APPROVER);

    expect(queue.total).toBe(1);
    expect(queue.items[0]?.serviceLevel).toMatchObject({
      count: 2,
      unit: 'hours',
      state: 'overdue',
    });
  });
});
