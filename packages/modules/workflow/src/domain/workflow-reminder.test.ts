import { describe, expect, it } from 'vitest';

import { REMINDER_EVENT, reminderDue, reminderIdentity } from './reminder.js';
import { reminderHistory } from './history.js';
import { WORKFLOW_HISTORY_EVENTS } from './workflow-vocabulary.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * When an approver should be told their step is overdue, and what that does to the approval.
 *
 * The second question has the shorter answer and the more important one: **nothing**. Most of this
 * suite is about the boundary and the refusals; the last describe is about the absence of effects,
 * which is what makes a reminder safe to be the first automatic action.
 */

const AWAITING_AT = new Date('2026-08-20T09:00:00.000Z');
const APPROVER = 'membership-approver';
const TENANT = 'tenant-1';

const instance = (status: WorkflowInstanceState['status'] = 'running'): WorkflowInstanceState => ({
  instanceId: 'instance-1',
  definitionId: 'definition-1',
  workflowVersionId: 'version-1',
  subjectType: 'recruitment.requisition',
  subjectId: 'requisition-1',
  requestedByMembershipId: 'membership-requester',
  status,
  startedAt: AWAITING_AT,
  correlationId: 'correlation-1',
  context: {},
  version: 1,
});

const step = (overrides: Partial<WorkflowStepState> = {}): WorkflowStepState => ({
  stepId: 'step-1',
  instanceId: 'instance-1',
  ordinal: 2,
  approverKind: 'membership',
  approverMembershipId: APPROVER,
  status: 'awaiting',
  branchRule: 'majority',
  awaitingAt: AWAITING_AT,
  serviceLevel: { count: 2, unit: 'hours' },
  version: 1,
  ...overrides,
});

/** `awaitingAt` + 2 hours is the due instant for every step below unless it says otherwise. */
const DUE_AT = new Date('2026-08-20T11:00:00.000Z');
const after = (milliseconds: number): Date => new Date(DUE_AT.getTime() + milliseconds);

const refusalOf = (outcome: ReturnType<typeof reminderDue>): string | undefined =>
  outcome.ok ? undefined : outcome.error.messageKey;

describe('when a reminder is due', () => {
  it('is due once the target has passed', () => {
    const outcome = reminderDue(instance(), step({ ...step() }), after(1));

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.value : undefined).toStrictEqual({
      stepId: 'step-1',
      instanceId: 'instance-1',
      ordinal: 2,
      approverMembershipId: APPROVER,
    });
  });

  /**
   * The boundary, asserted from both sides of one millisecond.
   *
   * `>` and not `>=`, matching `serviceLevelState` exactly: a two-hour target is met by an answer at
   * exactly two hours, and a reminder sent at that instant would contradict the screen showing the
   * step as still within its target.
   */
  it('is not due exactly on the boundary, and is due one millisecond later', () => {
    expect(refusalOf(reminderDue(instance(), step(), DUE_AT))).toBe(
      'workflow.rejection.reminder-not-yet-due',
    );
    expect(reminderDue(instance(), step(), after(1)).ok).toBe(true);
  });

  it('is not due before the target', () => {
    expect(refusalOf(reminderDue(instance(), step(), after(-1)))).toBe(
      'workflow.rejection.reminder-not-yet-due',
    );
  });

  it('reads the target from the step, so a longer one is not yet due at the same instant', () => {
    const longer = step({ serviceLevel: { count: 3, unit: 'hours' } });

    expect(refusalOf(reminderDue(instance(), longer, after(1)))).toBe(
      'workflow.rejection.reminder-not-yet-due',
    );
  });

  it('measures from awaitingAt and not from the instance start', () => {
    // The instance started at 09:00; this step only began waiting at 12:00, so at 11:00:00.001 —
    // overdue for a step that started with the instance — it is not due at all.
    const later = step({ awaitingAt: new Date('2026-08-20T12:00:00.000Z') });

    expect(refusalOf(reminderDue(instance(), later, after(1)))).toBe(
      'workflow.rejection.reminder-not-yet-due',
    );
  });

  it('takes its instant as a parameter, so one question answered twice answers the same', () => {
    const asAt = after(60_000);

    expect(reminderDue(instance(), step(), asAt)).toStrictEqual(
      reminderDue(instance(), step(), asAt),
    );
  });
});

describe('when a reminder is refused', () => {
  it.each([['completed' as const], ['rejected' as const], ['cancelled' as const]])(
    'refuses when the instance is %s',
    (status) => {
      expect(refusalOf(reminderDue(instance(status), step(), after(1)))).toBe(
        'workflow.rejection.reminder-instance-not-running',
      );
    },
  );

  /**
   * Every non-awaiting status, one at a time.
   *
   * This is also the **stale-execution** proof at the domain level: a reminder decided while a step
   * was awaiting and executed after it was answered is exactly this question asked again with a
   * newer row. There is no separate staleness concept to forget.
   */
  it.each([
    ['pending' as const],
    ['approved' as const],
    ['rejected' as const],
    ['skipped' as const],
  ])('refuses when the step is %s', (status) => {
    expect(refusalOf(reminderDue(instance(), step({ status }), after(1)))).toBe(
      'workflow.rejection.reminder-step-not-awaiting',
    );
  });

  /**
   * No target and a target that has not arrived are **different refusals**.
   *
   * An administrator told "not yet due" about a step nobody set a target on would go and wait for a
   * deadline that does not exist.
   */
  it('refuses a step with no service level, distinctly from one not yet due', () => {
    const { serviceLevel: _dropped, ...withoutTarget } = step();

    expect(refusalOf(reminderDue(instance(), withoutTarget as WorkflowStepState, after(1)))).toBe(
      'workflow.rejection.reminder-step-has-no-service-level',
    );
  });

  /**
   * An awaiting step with no clock is a persistence defect, not "due now".
   *
   * The dangerous alternative is arithmetic on `undefined`, which yields `NaN` and compares false —
   * so the step would be silently never due rather than loudly wrong.
   */
  it('refuses an awaiting step that has no clock', () => {
    const { awaitingAt: _dropped, ...withoutClock } = step();

    expect(refusalOf(reminderDue(instance(), withoutClock as WorkflowStepState, after(1)))).toBe(
      'workflow.rejection.reminder-step-has-no-clock',
    );
  });

  it('refuses a step that belongs to another instance', () => {
    expect(refusalOf(reminderDue(instance(), step({ instanceId: 'instance-2' }), after(1)))).toBe(
      'workflow.rejection.reminder-step-not-on-instance',
    );
  });

  /** Six distinct refusals, so no two situations send somebody to fix the wrong thing. */
  it('names six different refusals', () => {
    const { serviceLevel: _s, ...noTarget } = step();
    const { awaitingAt: _a, ...noClock } = step();
    const refusals = [
      refusalOf(reminderDue(instance('completed'), step(), after(1))),
      refusalOf(reminderDue(instance(), step({ instanceId: 'other' }), after(1))),
      refusalOf(reminderDue(instance(), step({ status: 'approved' }), after(1))),
      refusalOf(reminderDue(instance(), noTarget, after(1))),
      refusalOf(reminderDue(instance(), noClock, after(1))),
      refusalOf(reminderDue(instance(), step(), DUE_AT)),
    ];

    expect(new Set(refusals).size).toBe(6);
    expect(refusals.every((refusal) => refusal !== undefined)).toBe(true);
  });

  /**
   * The instance is checked before the step, so an approval that ended is reported as an approval
   * that ended — not as a step nobody is waiting on, which is true but is the wrong thing to fix.
   */
  it('prefers the instance refusal when both would apply', () => {
    expect(
      refusalOf(reminderDue(instance('cancelled'), step({ status: 'skipped' }), after(1))),
    ).toBe('workflow.rejection.reminder-instance-not-running');
  });
});

describe('who the reminder is for', () => {
  /**
   * The recipient is **read**, never chosen.
   *
   * This is the property that separates a reminder from the automatic escalation declined as the
   * first automatic action: escalation must pick somebody and nothing approved picks anybody
   * (D-16D-16). Here the answer is a field of the row.
   */
  it('is the membership already named on the step', () => {
    const outcome = reminderDue(
      instance(),
      step({ approverMembershipId: 'somebody-else' }),
      after(1),
    );

    expect(outcome.ok ? outcome.value.approverMembershipId : undefined).toBe('somebody-else');
  });

  it('is never the requester, unless the requester is the approver', () => {
    const outcome = reminderDue(instance(), step(), after(1));

    expect(outcome.ok ? outcome.value.approverMembershipId : undefined).not.toBe(
      instance().requestedByMembershipId,
    );
  });
});

describe('what a reminder does not do', () => {
  /**
   * Nothing. Asserted by deep-equality on the inputs rather than by reading fields, so a mutation
   * anybody added later is caught whatever it touched.
   */
  it('mutates neither the instance nor the step', () => {
    const running = instance();
    const waiting = step();
    const beforeInstance = structuredClone(running);
    const beforeStep = structuredClone(waiting);

    reminderDue(running, waiting, after(1));

    expect(running).toStrictEqual(beforeInstance);
    expect(waiting).toStrictEqual(beforeStep);
  });

  /**
   * The result carries no status, no tally and no decision — so there is nothing in it a caller
   * *could* write back to a step even by mistake.
   */
  it('returns four fields and none of them is a state', () => {
    const outcome = reminderDue(instance(), step(), after(1));

    expect(Object.keys(outcome.ok ? outcome.value : {}).sort()).toStrictEqual([
      'approverMembershipId',
      'instanceId',
      'ordinal',
      'stepId',
    ]);
  });

  it('names no escalation, expiry, decision or tally concept anywhere in its result', () => {
    const outcome = reminderDue(instance(), step(), after(1));
    const body = JSON.stringify(outcome.ok ? outcome.value : {});

    // Narrowed deliberately: `approverMembershipId` is the one field that *must* be here, and it
    // contains "approve". Scanning for the bare word would forbid the correct answer, so the scan
    // looks for the concepts a reminder must not carry rather than for substrings of the one it must.
    for (const forbidden of [
      'escalat',
      'expire',
      'expired',
      'status',
      'decision',
      'approvals',
      'rejections',
      'skipped',
      'quorum',
      'threshold',
      'outstanding',
      'unresolved',
      'assigned',
      'breach',
      'overdue',
      'dueAt',
      'serviceLevel',
    ]) {
      expect([forbidden, body.includes(forbidden)]).toStrictEqual([forbidden, false]);
    }
  });
});

describe('the reminder history entry', () => {
  const PROVENANCE = {
    executionIdentity: 'service:workflow-reminders',
    correlationId: 'correlation-1',
    jobId: 'job-1',
    attempt: 1,
  };

  const entryFor = (asAt = after(1)) => {
    const outcome = reminderDue(instance(), step(), asAt);

    if (!outcome.ok) throw new Error('expected a due reminder');
    return reminderHistory(outcome.value, asAt, 'history-1', PROVENANCE);
  };

  it('is step-reminded, and that value is in the closed vocabulary', () => {
    expect(entryFor().event).toBe('step-reminded');
    expect(REMINDER_EVENT).toBe('step-reminded');
    expect(WORKFLOW_HISTORY_EVENTS).toContain('step-reminded');
  });

  /**
   * Not any of the nine that already existed, and named one at a time.
   *
   * `step-escalated` is the one a reader would reach for, and it means a human widened an approval.
   * A reminder that borrowed it would say an approver had been added when none was.
   */
  it.each([
    'step-escalated',
    'step-approved',
    'step-rejected',
    'step-skipped',
    'step-awaiting',
    'instance-cancelled',
    'instance-rejected',
  ])('is not %s', (other) => {
    expect(entryFor().event).not.toBe(other);
  });

  /**
   * **Both actor columns are absent.** The approver on the step is the *recipient*; writing them
   * into the actor column would record them as having done the thing they have not done.
   */
  it("names no actor and nobody acted on anybody's behalf", () => {
    const written = entryFor();

    expect(written.actorMembershipId).toBeUndefined();
    expect(written.onBehalfOfMembershipId).toBeUndefined();
    expect('actorMembershipId' in written).toBe(false);
  });

  it('carries the execution provenance in full', () => {
    expect(entryFor().execution).toStrictEqual(PROVENANCE);
  });

  it('points at the step and the branch it is about', () => {
    const written = entryFor();

    expect([written.stepId, written.ordinal, written.instanceId]).toStrictEqual([
      'step-1',
      2,
      'instance-1',
    ]);
  });

  it('records the instant it was asked about, not a clock of its own', () => {
    const asAt = after(90_000);

    expect(entryFor(asAt).occurredAt).toStrictEqual(asAt);
  });
});

describe('what makes two reminders the same one', () => {
  /**
   * A step, in a tenant — and deliberately not the instant, the job or the attempt.
   *
   * A step's clock starts once and never restarts, and a step never returns to `awaiting`, so it
   * crosses its target exactly once. Anything more in the key would let one step be reminded twice.
   */
  it('is the tenant and the step, and nothing else', () => {
    expect(reminderIdentity(TENANT, 'step-1')).toBe(`${TENANT}:step-1`);
  });

  it('differs by step within one tenant', () => {
    expect(reminderIdentity(TENANT, 'step-1')).not.toBe(reminderIdentity(TENANT, 'step-2'));
  });

  /** Two tenants may hold the same step identifier without one suppressing the other's reminder. */
  it('differs by tenant for the same step identifier', () => {
    expect(reminderIdentity('tenant-a', 'step-1')).not.toBe(reminderIdentity('tenant-b', 'step-1'));
  });

  it('does not vary with the instant, the job or the attempt', () => {
    expect(reminderIdentity(TENANT, 'step-1')).toBe(reminderIdentity(TENANT, 'step-1'));
  });
});
