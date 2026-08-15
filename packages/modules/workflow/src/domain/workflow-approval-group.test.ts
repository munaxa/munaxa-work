import { describe, expect, it } from 'vitest';

import {
  addApprovalGroupMember,
  createApprovalGroup,
  membersOf,
  type ApprovalGroupMemberState,
} from './approval-group.js';
import { addStep, createDefinition, draftVersion, publishVersion } from './definition.js';
import { startInstance } from './instance.js';
import { must, AT } from './workflow-fixtures.js';

/**
 * An approval group, and what becomes of it when an approval actually starts.
 *
 * The group itself is a list somebody wrote down. What matters here is the **snapshot**: the moment
 * the list stops mattering and the people on it become steps. Everything after that moment is about
 * those people, and editing the list changes nothing — which is the property this file exists to
 * pin down.
 */

const NAME = { en: 'Step', ar: 'خطوة' };
const A = 'membership-a';
const B = 'membership-b';
const C = 'membership-c';

describe('an approval group', () => {
  it('is a named list, and starts empty', () => {
    const group = must(
      createApprovalGroup({
        approvalGroupId: 'group-1',
        code: 'finance-approvers',
        name: { en: 'Finance approvers', ar: 'معتمدو المالية' },
      }),
      'a group',
    );

    expect(group.code).toBe('finance-approvers');
    expect(membersOf([])).toStrictEqual([]);
  });

  it('refuses a malformed code and a half-translated name', () => {
    const refused = createApprovalGroup({
      approvalGroupId: 'g',
      code: 'Finance Approvers',
      name: { en: 'Finance', ar: 'المالية' },
    });

    expect(refused.ok).toBe(false);
  });

  /** Ordered and de-duplicated, so two instances built from one group ask the same people in the
   * same order — and so a person who somehow appeared twice is asked once and counted once. */
  it('lists its members in a deterministic order, once each', () => {
    const group = must(
      createApprovalGroup({
        approvalGroupId: 'group-1',
        code: 'g',
        name: { en: 'G', ar: 'ج' },
      }),
      'a group',
    );
    const members: ApprovalGroupMemberState[] = [C, A, B, A].map((membershipId, index) =>
      must(
        addApprovalGroupMember(group, {
          approvalGroupMemberId: `member-${String(index)}`,
          membershipId,
          at: AT,
        }),
        'a member',
      ),
    );

    expect(membersOf(members)).toStrictEqual([A, B, C]);
  });
});

describe('a group becomes people when an instance starts', () => {
  it('expands into one step per member, and records where each came from', () => {
    const definition = must(
      createDefinition({
        definitionId: 'd',
        code: 'grouped',
        name: { en: 'Grouped', ar: 'مجموعة' },
        subjectType: 'a.subject',
      }),
      'a definition',
    );
    const draft = must(
      draftVersion(definition, { workflowVersionId: 'v', versionNumber: 1 }),
      'a draft',
    );
    const template = must(
      addStep(draft, {
        stepTemplateId: 't1',
        ordinal: 1,
        name: NAME,
        approverKind: 'group',
        approverGroupId: 'g',
        branchRule: 'majority',
      }),
      'a group step',
    );
    const version = must(
      publishVersion(draft, [template], AT, 'user:admin'),
      'a published version',
    );
    const started = must(
      startInstance(version, [template], {
        instanceId: 'i',
        subjectType: 'a.subject',
        subjectId: 's',
        requestedByMembershipId: 'membership-requester',
        correlationId: 'c',
        context: {},
        at: AT,
        stepIds: ['s1', 's2', 's3'],
        groups: [{ approvalGroupId: 'g', members: [A, B, C] }],
      }),
      'a started instance',
    );

    expect(started.steps).toHaveLength(3);
    // Every step of a running approval names a person, whatever the template named.
    expect(started.steps.map((step) => step.approverKind)).toStrictEqual([
      'membership',
      'membership',
      'membership',
    ]);
    expect(started.steps.map((step) => step.approverMembershipId)).toStrictEqual([A, B, C]);
    expect(started.steps.every((step) => step.sourceGroupId === 'g')).toBe(true);
    // All three asked at once: one branch, three people.
    expect(started.steps.map((step) => step.status)).toStrictEqual([
      'awaiting',
      'awaiting',
      'awaiting',
    ]);
  });

  it('refuses to start when a group is empty or was not resolved', () => {
    const definition = must(
      createDefinition({
        definitionId: 'd',
        code: 'grouped',
        name: { en: 'Grouped', ar: 'مجموعة' },
        subjectType: 'a.subject',
      }),
      'a definition',
    );
    const draft = must(
      draftVersion(definition, { workflowVersionId: 'v', versionNumber: 1 }),
      'a draft',
    );
    const template = must(
      addStep(draft, {
        stepTemplateId: 't1',
        ordinal: 1,
        name: NAME,
        approverKind: 'group',
        approverGroupId: 'g',
      }),
      'a group step',
    );
    const version = must(
      publishVersion(draft, [template], AT, 'user:admin'),
      'a published version',
    );
    const request = {
      instanceId: 'i',
      subjectType: 'a.subject',
      subjectId: 's',
      requestedByMembershipId: 'membership-requester',
      correlationId: 'c',
      context: {},
      at: AT,
      stepIds: ['s1'],
    };
    const empty = startInstance(version, [template], {
      ...request,
      groups: [{ approvalGroupId: 'g', members: [] }],
    });
    const unresolved = startInstance(version, [template], { ...request, groups: [] });

    expect(empty.ok).toBe(false);
    expect(unresolved.ok).toBe(false);
  });
});
