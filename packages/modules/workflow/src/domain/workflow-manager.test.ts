import { describe, expect, it } from 'vitest';

import { resolutionDateOf, resolveManager, type ManagerResolution } from './manager.js';
import { planSteps, type ManagerSnapshot } from './branch-plan.js';
import { addStep, createDefinition, draftVersion, publishVersion } from './definition.js';
import type { WorkflowStepTemplateState } from './definition.js';
import { AT, must } from './workflow-fixtures.js';

/**
 * The requester's manager, and the four ways there is not one.
 *
 * Everything asserted here is a **parameter somebody approved**, not a reading this suite invented:
 * whose manager (the requester's, P-1), through which employment (primary and active, P-2), along
 * which line (primary, P-3), how far (one level, P-4), as at which instant (the approval's start,
 * D-16C-11) and in which time zone (UTC, P-6). A test that quietly accepted a second level or a
 * functional line would be approving something nobody did.
 *
 * **Nothing here queries anything**, which is the point of the shape under test. Following the chain
 * is the application's job across two module boundaries; the domain is handed the answer and decides
 * what it means. That is exactly how 16B handled a group's members, and it is deliberately not a
 * second pattern.
 */

const NAME = { en: 'Manager approval', ar: 'اعتماد المدير' };

const REQUESTER = '01930000-0000-7000-8000-0000000000e1';
const MANAGER = '01930000-0000-7000-8000-0000000000e2';
const EMPLOYMENT = '01930000-0000-7000-8000-0000000000f1';
const MANAGER_EMPLOYMENT = '01930000-0000-7000-8000-0000000000f2';

const resolved: ManagerResolution = {
  outcome: 'resolved',
  employmentId: EMPLOYMENT,
  managerEmploymentId: MANAGER_EMPLOYMENT,
  managerMembershipId: MANAGER,
};

const snapshotOf = (resolution: ManagerResolution): ManagerSnapshot => ({
  requesterMembershipId: REQUESTER,
  resolution,
});

const managerTemplate = (ordinal = 1): WorkflowStepTemplateState => ({
  stepTemplateId: `01930000-0000-7000-8000-00000000b${String(ordinal)}0`,
  workflowVersionId: '01930000-0000-7000-8000-0000000000a1',
  ordinal,
  name: NAME,
  approverKind: 'manager',
  version: 1,
});

describe('resolving the requester’s manager', () => {
  it('accepts one manager and keeps their employment as provenance', () => {
    const outcome = resolveManager(REQUESTER, resolved);

    expect(outcome).toStrictEqual({
      ok: true,
      value: { managerMembershipId: MANAGER, managerEmploymentId: MANAGER_EMPLOYMENT },
    });
  });

  /**
   * Five refusals rather than one, because they are five different people's mistakes to fix.
   *
   * A missing employment link is an administrator's; a missing reporting line is the organization's;
   * a manager who cannot sign in is Identity's; a job held by two people is whoever linked the
   * second; and a process asking somebody to approve their own request is the process designer's.
   * Collapsing them into "manager unresolved" would send all five to whoever happened to raise the
   * approval.
   *
   * **The last two of those are opposite problems and must not share a name.** `manager-not-a-member`
   * means nobody holds the job; `manager-membership-ambiguous` means two people do. Reporting the
   * second as the first would send somebody to link a member to an employment that already has two.
   */
  it.each([
    ['no-primary-employment', 'manager-no-primary-employment'],
    ['no-manager', 'manager-not-assigned'],
    ['manager-not-a-member', 'manager-not-a-member'],
    ['manager-membership-ambiguous', 'manager-membership-ambiguous'],
  ] as const)('refuses %s with its own reason', (outcome, reason) => {
    const refused = resolveManager(REQUESTER, { outcome });

    expect(refused).toMatchObject({ ok: false, error: { reason } });
  });

  /**
   * Two holders is not nobody, and the two refusals stay apart.
   *
   * Asserted as a pair rather than singly, because the failure this guards against is one being
   * quietly mapped onto the other — which compiles, passes a single-outcome test, and tells an
   * administrator to fix the opposite problem.
   */
  it('keeps ambiguity and absence as two different refusals', () => {
    const absent = resolveManager(REQUESTER, { outcome: 'manager-not-a-member' });
    const ambiguous = resolveManager(REQUESTER, { outcome: 'manager-membership-ambiguous' });

    expect(absent).toMatchObject({ ok: false, error: { reason: 'manager-not-a-member' } });
    expect(ambiguous).toMatchObject({
      ok: false,
      error: { reason: 'manager-membership-ambiguous' },
    });
    expect(absent).not.toStrictEqual(ambiguous);
  });

  it('refuses a requester who is their own manager', () => {
    const refused = resolveManager(REQUESTER, { ...resolved, managerMembershipId: REQUESTER });

    expect(refused).toMatchObject({ ok: false, error: { reason: 'manager-is-the-requester' } });
  });

  /** Every refusal carries a catalogue key and never a rendered sentence or a person's name. */
  it('names nobody in any refusal', () => {
    for (const outcome of [
      'no-primary-employment',
      'no-manager',
      'manager-not-a-member',
      'manager-membership-ambiguous',
    ] as const) {
      const refused = resolveManager(REQUESTER, { outcome });

      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.messageKey).toBe(`workflow.rejection.${refused.error.reason}`);
      expect(JSON.stringify(refused.error)).not.toContain(MANAGER);
      expect(JSON.stringify(refused.error)).not.toContain(REQUESTER);
    }
  });
});

describe('the date the reporting line is read at', () => {
  /**
   * The regression this function exists for.
   *
   * `2026-02-28T23:30:00.000Z` is half an hour before midnight UTC on the last day of a February.
   * Read in the server's own zone it is the 28th in Los Angeles and the **1st of March** in Riyadh,
   * so an approval raised at that instant would find a different manager depending on where the
   * process happened to be running. Pinned to UTC it is the 28th, everywhere, always.
   */
  it('converts an instant to a UTC civil date, whatever the server’s zone', () => {
    expect(resolutionDateOf(new Date('2026-02-28T23:30:00.000Z'))).toBe('2026-02-28');
    expect(resolutionDateOf(new Date('2026-02-28T23:59:59.999Z'))).toBe('2026-02-28');
  });

  it('rolls over at UTC midnight and not a millisecond before', () => {
    expect(resolutionDateOf(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03-01');
    expect(resolutionDateOf(new Date('2026-03-01T00:00:00.001Z'))).toBe('2026-03-01');
  });

  it('gives one answer for one instant, however often it is asked', () => {
    const instant = new Date('2026-08-16T12:00:00.000Z');

    expect(resolutionDateOf(instant)).toBe(resolutionDateOf(instant));
    // And it consults no clock: today's date does not appear unless the instant is today's.
    expect(resolutionDateOf(instant)).toBe('2026-08-16');
  });
});

describe('planning a manager step', () => {
  it('plans exactly one approver, and never the requester', () => {
    const planned = planSteps([managerTemplate()], [], snapshotOf(resolved));

    expect(planned).toStrictEqual({
      ok: true,
      value: [{ ordinal: 1, approverMembershipId: MANAGER }],
    });
  });

  /**
   * One manager for the whole approval, not one per template.
   *
   * A `manager` step means the *requester's* manager, so two of them in one process name the same
   * person. Two steps, one approver, and no second question asked.
   */
  it('resolves the same person for every manager step in a process', () => {
    const planned = planSteps([managerTemplate(1), managerTemplate(2)], [], snapshotOf(resolved));

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.map((step) => step.approverMembershipId)).toStrictEqual([
      MANAGER,
      MANAGER,
    ]);
    expect(planned.value.map((step) => step.ordinal)).toStrictEqual([1, 2]);
  });

  /**
   * Fails closed, exactly as an empty group does.
   *
   * The alternative — skipping the step — is the one outcome that must never happen: an approval
   * that quietly dropped a stage somebody configured would complete while looking like a process,
   * and nobody would know a director had not been asked.
   */
  it.each([
    ['no-primary-employment', 'manager-no-primary-employment'],
    ['no-manager', 'manager-not-assigned'],
    ['manager-not-a-member', 'manager-not-a-member'],
    ['manager-membership-ambiguous', 'manager-membership-ambiguous'],
  ] as const)('refuses the whole plan when the chain ends at %s', (outcome, reason) => {
    const planned = planSteps([managerTemplate()], [], snapshotOf({ outcome }));

    expect(planned).toMatchObject({ ok: false, error: { reason } });
  });

  it('refuses when a manager step was planned without resolving one at all', () => {
    const planned = planSteps([managerTemplate()], []);

    expect(planned).toMatchObject({ ok: false, error: { reason: 'manager-not-resolved' } });
  });

  /** A manager step sits in a branch like any other: one approver at that ordinal, no more. */
  it('adds one approver to a branch rather than replacing anybody in it', () => {
    const person: WorkflowStepTemplateState = {
      ...managerTemplate(1),
      stepTemplateId: '01930000-0000-7000-8000-00000000b99',
      approverKind: 'membership',
      approverMembershipId: REQUESTER,
    };
    const planned = planSteps([person, managerTemplate(1)], [], snapshotOf(resolved));

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value).toHaveLength(2);
    expect(planned.value.every((step) => step.ordinal === 1)).toBe(true);
    expect(planned.value.map((step) => step.approverMembershipId).sort()).toStrictEqual(
      [REQUESTER, MANAGER].sort(),
    );
  });
});

describe('configuring a manager step', () => {
  /** A real draft, built through the real constructors — never a hand-written state literal. */
  const draft = () =>
    must(
      draftVersion(
        must(
          createDefinition({
            definitionId: 'definition-manager',
            code: 'manager-approval',
            name: NAME,
            subjectType: 'recruitment.requisition',
          }),
          'a definition',
        ),
        { workflowVersionId: 'version-manager', versionNumber: 1 },
      ),
      'a draft version',
    );

  it('takes a manager template with no approver identifier at all', () => {
    const added = addStep(draft(), {
      stepTemplateId: 'template-manager-1',
      ordinal: 1,
      name: NAME,
      approverKind: 'manager',
    });

    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.approverKind).toBe('manager');
    expect(added.value.approverMembershipId).toBeUndefined();
    expect(added.value.approverGroupId).toBeUndefined();
  });

  /**
   * An identifier on a manager template is refused rather than ignored.
   *
   * Somebody who supplied one believed they had configured *whose* manager to ask. There is no such
   * setting, and dropping the value silently would leave them certain of a routing the approval does
   * not perform.
   */
  it.each([['approverMembershipId'], ['approverGroupId']])(
    'refuses a manager template carrying %s',
    (field) => {
      const added = addStep(draft(), {
        stepTemplateId: 'template-manager-2',
        ordinal: 1,
        name: NAME,
        approverKind: 'manager',
        [field]: MANAGER,
      });

      expect(added).toMatchObject({ ok: false, error: { reason: 'step-approver-ambiguous' } });
    },
  );

  it('publishes a version whose only step names a manager', () => {
    const drafted = draft();
    const added = must(
      addStep(drafted, {
        stepTemplateId: 'template-manager-3',
        ordinal: 1,
        name: NAME,
        approverKind: 'manager',
      }),
      'a manager step',
    );

    expect(publishVersion(drafted, [added], AT, 'user:admin').ok).toBe(true);
  });
});
