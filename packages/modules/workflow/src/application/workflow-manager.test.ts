import { beforeEach, describe, expect, it } from 'vitest';

import type { ManagerResolution } from '../domain/manager.js';
import type { PendingApprovalView, WorkflowInstanceDetailView } from '../contracts/views.js';
import type { Page } from './workflow-ports.js';
import { publishedBranches, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  ask,
  attempt,
  failureOf,
  harnessFor,
  send,
  FakeReportingLine,
  type Harness,
} from './workflow-test-harness.js';

/**
 * Routing an approval to the requester's manager, from the application's side of the question.
 *
 * The domain suite already proves what each outcome *means*. This one is about the three things only
 * a handler can be wrong about: **when** the reporting line is asked, **what** it is asked, and what
 * happens to the approval when the answer is not a person.
 *
 * **Asked once, at the start, and never again.** That is D-16C-08 in one sentence, and it is the same
 * sentence as the 16B group rule rather than a second one: the person is copied onto the step, and a
 * reorganization afterwards changes nothing about an approval already running. The assertions below
 * are deliberately about the *call log* rather than about the answers, because "how many times did
 * this module ask another module a question" is exactly what a mocked answer would hide.
 *
 * **Failing closed is the behaviour under test, not an edge case.** An unresolvable manager refuses
 * the whole start: no instance, no steps, no history. The alternative — skipping the step — is the one
 * outcome that must never happen, because an approval that quietly dropped a stage somebody
 * configured completes while looking like a process, and nobody finds out a director was not asked.
 */

const MANAGER = SECOND_APPROVER;

const resolved: ManagerResolution = {
  outcome: 'resolved',
  employmentId: 'employment-requester',
  managerEmploymentId: 'employment-manager',
  managerMembershipId: MANAGER,
};

const managerProcess = (harness: Harness, code: string) =>
  publishedBranches(harness, [{ ordinal: 1, approverKind: 'manager' }], code);

describe('routing a step to the requester’s manager', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    harness.reportingLine.answers(resolved);
  });

  it('asks the reporting line once, for the requester, on the approval’s own UTC date', async () => {
    const process = await managerProcess(harness, 'manager-one');

    await startedOn(harness, process, 'subject-1');

    // `NOW` is 2026-08-14T09:00:00Z. The date is the approval's, converted in UTC and nowhere else.
    expect(harness.reportingLine.asked).toStrictEqual([
      { membershipId: REQUESTER, asOfDate: '2026-08-14' },
    ]);
  });

  it('puts the resolved manager on the step, as an ordinary membership approver', async () => {
    const process = await managerProcess(harness, 'manager-two');
    const instanceId = await startedOn(harness, process, 'subject-2');
    const detail = await ask<WorkflowInstanceDetailView>(harness, {
      queryName: 'workflow.read-instance',
      instanceId,
    });
    const [step] = detail.steps;

    // A running step names a person and says so. The template's `manager` kind does not survive onto
    // it, because at the moment somebody is actually asked there is only ever a person.
    expect(step?.approverMembershipId).toBe(MANAGER);
    expect(step?.approverKind).toBe('membership');
    expect(step?.status).toBe('awaiting');
    // And no provenance column was invented for it: a manager is not a group.
    expect(step?.sourceGroupId).toBeUndefined();
  });

  /**
   * Two manager steps, one question.
   *
   * A `manager` step means the *requester's* manager, so two of them in one process name the same
   * person — and asking twice would be asking one question twice, at the cost of a second cross-module
   * call on every approval a tenant raises.
   */
  it('asks once for a process with two manager steps, and resolves the same person', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverKind: 'manager' },
        { ordinal: 2, approverKind: 'manager' },
      ],
      'manager-twice',
    );
    const instanceId = await startedOn(harness, process, 'subject-3');
    const detail = await ask<WorkflowInstanceDetailView>(harness, {
      queryName: 'workflow.read-instance',
      instanceId,
    });

    expect(harness.reportingLine.asked).toHaveLength(1);
    expect(detail.steps.map((step) => step.approverMembershipId)).toStrictEqual([MANAGER, MANAGER]);
  });

  /**
   * A process that names no manager makes no cross-module call at all.
   *
   * Which is why raising an approval against every version configured before this phase costs exactly
   * what it cost before it.
   */
  it('does not ask at all when no template names a manager', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER }],
      'no-manager-named',
    );

    await startedOn(harness, process, 'subject-4');

    expect(harness.reportingLine.asked).toStrictEqual([]);
  });

  /** The manager decides their step like anybody else. There is no second decision path. */
  it('lets the resolved manager decide, on their own authority', async () => {
    const process = await managerProcess(harness, 'manager-decides');
    const instanceId = await startedOn(harness, process, 'subject-5');
    const decided = await harness.as(MANAGER, () =>
      send<{ instanceStatus: string }>(harness, {
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect(decided.instanceStatus).toBe('completed');
  });
});

describe('when there is no manager to route to', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  /**
   * Four refusals, four different people's mistakes to fix — and the fourth is the process
   * designer's rather than anybody's data.
   *
   * A missing employment link is an administrator's; a missing reporting line is the organization's;
   * a manager who cannot sign in is Identity's; and a requester who is their own manager is a process
   * that asks somebody to approve their own request.
   */
  it.each<readonly [ManagerResolution, string]>([
    [{ outcome: 'no-primary-employment' }, 'manager-no-primary-employment'],
    [{ outcome: 'no-manager' }, 'manager-not-assigned'],
    [{ outcome: 'manager-not-a-member' }, 'manager-not-a-member'],
    [{ ...resolved, managerMembershipId: REQUESTER }, 'manager-is-the-requester'],
  ])('refuses the start with %#: its own reason', async (resolution, reason) => {
    harness.reportingLine.answers(resolution);

    const process = await managerProcess(harness, `refused-${reason}`);
    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: `subject-${reason}`,
      }),
    );

    // The catalogue key, namespaced — never a rendered sentence, and never a person's name.
    expect(failureOf(refused)).toBe(`workflow.rejection.${reason}`);
  });

  /**
   * Nothing at all is written, which is what "the whole start" means.
   *
   * The instance, its steps and its history are one `unitOfWork.execute`, and the refusal returns
   * before the first insert. A partial start would leave an approval with a missing stage looking
   * exactly like a complete one.
   */
  it('leaves no instance, no step and no history behind', async () => {
    harness.reportingLine.answers({ outcome: 'no-manager' });

    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverKind: 'manager' },
      ],
      'partial-start',
    );

    await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'subject-partial',
      }),
    );

    const found = await ask<Page<unknown>>(harness, {
      queryName: 'workflow.search-instances',
      subjectType: SUBJECT_TYPE,
      subjectId: 'subject-partial',
    });

    expect(found.total).toBe(0);
    // And the step of the *first* ordinal — the one that was perfectly resolvable — was not written
    // either. A start is all of it or none of it.
    const queue = await harness.as(APPROVER, () =>
      ask<Page<PendingApprovalView>>(harness, { queryName: 'workflow.pending-approvals' }),
    );

    expect(queue.total).toBe(0);
  });

  /**
   * There is no longer a composition without a reporting line, and that is the Checkpoint 7 change.
   *
   * These two tests used to build one and assert it failed closed with `manager-not-resolved`. The
   * dependency became **required** when the real adapter arrived, so an unwired composition no
   * longer type-checks and the case it described cannot occur — which is a stronger guarantee than
   * the refusal was. Rewritten rather than deleted, because a removed assertion is a removed
   * guarantee: what is asserted now is the property that replaced it.
   *
   * `manager-not-resolved` itself is untouched and still reachable — it is the caller defect of
   * planning a manager step without reading the chain, and the domain suite covers it directly.
   */
  it('is always composed with a reporting line, because the field is no longer optional', () => {
    expect(harnessFor().reportingLine).toBeInstanceOf(FakeReportingLine);
    // The shape itself — seven required fields, none optional — is pinned by the boundary suite,
    // which is where a dependency arriving or leaving is meant to be noticed.
  });

  /** And a process of named approvers still never asks it, wired or not. */
  it('starts a process of named approvers without consulting the reporting line', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER }],
      'ordinary-process',
    );

    await expect(startedOn(harness, process, 'subject-ordinary')).resolves.toBeTruthy();
    expect(harness.reportingLine.asked).toStrictEqual([]);
  });
});
