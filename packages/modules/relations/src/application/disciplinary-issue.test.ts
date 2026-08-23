import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  attempt,
  ask,
  givenCategory,
  givenConcludedInvestigation,
  givenDisciplinaryRule,
  givenInvestigation,
  givenViolation,
  harnessFor,
  OFFICER,
  send,
  tryAsk,
} from './relations-test-harness.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { CaseHistoryView, DisciplinaryActionView } from '../contracts/views.js';

/**
 * Issuing a disciplinary action through the real handlers.
 *
 * Split from `disciplinary.test.ts` at the 400-line budget rather than exempted: that file covers
 * configuring and evaluating the ladder, this one covers the act that follows.
 */

const issue = (violationId: string, overrides: Record<string, unknown> = {}) => ({
  commandName: 'relations.issue-disciplinary-action',
  violationId,
  action: 'written_warning',
  // The harness clock is 2026-08-22.
  issuedOn: '2026-08-22',
  reason: 'The inquiry confirmed three unnotified absences.',
  ...overrides,
});

describe('issuing an action', () => {
  it('records the decision and moves the case to action_issued', async () => {
    const harness = harnessFor();
    const { violationId } = await givenConcludedInvestigation(harness);

    const result = await harness.as(OFFICER, () =>
      send<{ disciplinaryActionId: string; prescribedByRule: boolean }>(
        harness,
        issue(violationId),
      ),
    );

    expect(result.prescribedByRule).toBe(false);

    const [history, action] = await harness.as(OFFICER, async () => [
      await ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId }),
      await ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    ]);

    expect(history.currentState).toBe('action_issued');
    expect(action).toMatchObject({
      action: 'written_warning',
      issuedBy: OFFICER,
      occurrenceAtIssue: 1,
      prescribedByRule: false,
    });
  });

  it('records which rule prescribed it, when one did', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const ruleId = await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 1,
      action: 'written_warning',
    });
    const violationId = await givenViolation(harness, { violationCategoryId });

    await givenConcludedInvestigation(harness, { violationId });

    await harness.as(OFFICER, () => send(harness, issue(violationId)));

    const action = await harness.as(OFFICER, () =>
      ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );

    expect(action.prescribedByRule).toBe(true);
    expect(action.disciplinaryRuleId).toBe(ruleId);
  });

  /** A human may depart from the ladder. Recorded as such rather than refused or overridden. */
  it('permits an action the ladder did not prescribe, and says so', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);

    await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 1,
      action: 'verbal_warning',
    });

    const violationId = await givenViolation(harness, { violationCategoryId });

    await givenConcludedInvestigation(harness, { violationId });

    await harness.as(OFFICER, () => send(harness, issue(violationId, { action: 'final_warning' })));

    const action = await harness.as(OFFICER, () =>
      ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );

    expect(action.action).toBe('final_warning');
    expect(action.prescribedByRule).toBe(false);
    expect(action.disciplinaryRuleId).toBeUndefined();
  });

  it('refuses a case with no concluded investigation', async () => {
    const harness = harnessFor();
    const { violationId } = await givenInvestigation(harness);

    await expect(
      harness.as(OFFICER, () => attempt(harness, issue(violationId))),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'conflict', reason: 'no_concluded_investigation' },
    });
  });

  it('refuses a second action on one case', async () => {
    const harness = harnessFor();
    const { violationId } = await givenConcludedInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, issue(violationId)));

    await expect(
      harness.as(OFFICER, () => attempt(harness, issue(violationId))),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'conflict', reason: 'action_already_issued' },
    });
  });

  /**
   * The frozen copy is what makes an issued action mean what it meant. A tenant re-grading its
   * ladder afterwards must not rewrite a decision somebody was disciplined by.
   */
  it('keeps its meaning when the ladder changes afterwards', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const ruleId = await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 1,
      action: 'written_warning',
    });
    const violationId = await givenViolation(harness, { violationCategoryId });

    await givenConcludedInvestigation(harness, { violationId });
    await harness.as(OFFICER, () => send(harness, issue(violationId)));

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-disciplinary-rule',
        disciplinaryRuleId: ruleId,
        expectedVersion: 1,
        action: 'termination_recommendation',
        active: false,
      }),
    );

    const action = await harness.as(OFFICER, () =>
      ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );

    // Frozen: still the written warning that was actually issued, still linked to the rule.
    expect(action.action).toBe('written_warning');
    expect(action.occurrenceAtIssue).toBe(1);
    expect(action.disciplinaryRuleId).toBe(ruleId);
  });

  it('rests on the operative conclusion after a correction', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenConcludedInvestigation(harness);

    const corrected = await harness.as(OFFICER, () =>
      send<{ investigationId: string }>(harness, {
        commandName: 'relations.correct-investigation',
        investigationId,
        findings: 'The third absence was authorized leave recorded late.',
        recommendation: 'No action.',
        concludedOn: '2026-08-22',
        reason: 'The leave record arrived after the inquiry concluded.',
      }),
    );

    await harness.as(OFFICER, () => send(harness, issue(violationId)));

    const action = await harness.as(OFFICER, () =>
      ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );

    // The corrected conclusion, not the superseded one.
    expect(action.investigationId).toBe(corrected.investigationId);
    // And neither investigation was mutated by issuing.
    expect(harness.stores.investigationRows.get(investigationId)?.state).toBe('concluded');
  });

  it('requires the issue permission, and refuses an investigator who lacks it', async () => {
    const seeded = harnessFor();
    const { violationId } = await givenConcludedInvestigation(seeded);

    const conductor = harnessFor({
      permissions: [RelationsPermissions.investigationConduct, RelationsPermissions.violationRead],
    });

    await expect(
      conductor.as(OFFICER, () => attempt(conductor, issue(violationId))),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('audits reading an issued action', async () => {
    const harness = harnessFor();
    const { violationId } = await givenConcludedInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, issue(violationId)));
    harness.stores.accessRows.length = 0;

    await harness.as(ADMINISTRATOR, () =>
      ask<DisciplinaryActionView>(harness, {
        queryName: 'relations.disciplinary-action',
        violationId,
      }),
    );

    expect(harness.stores.accessRows.map((row) => row.action)).toStrictEqual([
      'disciplinary_action_read',
    ]);
    expect(harness.stores.accessRows[0]?.actor).toBe(ADMINISTRATOR);
  });

  it('answers not found for a case with no action, disclosing nothing', async () => {
    const harness = harnessFor();
    const violationId = await givenViolation(harness);

    harness.stores.accessRows.length = 0;

    await expect(
      harness.as(ADMINISTRATOR, () =>
        tryAsk(harness, { queryName: 'relations.disciplinary-action', violationId }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect(harness.stores.accessRows).toHaveLength(0);
  });
});
