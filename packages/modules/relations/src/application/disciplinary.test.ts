import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  attempt,
  ask,
  givenCategory,
  givenDisciplinaryRule,
  givenViolation,
  harnessFor,
  OFFICER,
  send,
  tryAsk,
} from './relations-test-harness.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { ApplicableActionView, DisciplinaryRuleView } from '../contracts/views.js';

/**
 * The ladder and the action through the real handlers.
 *
 * Two properties are asserted here more than anywhere else, because they are what D-5.2-20 approved:
 * **evaluating prescribes and never punishes**, and **an unconfigured tenant gets no action rather
 * than a default**.
 */

describe('configuring the ladder', () => {
  it('defines a rung against a real category', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const ruleId = await givenDisciplinaryRule(harness, { violationCategoryId });

    const rules = await harness.as(ADMINISTRATOR, () =>
      ask<readonly DisciplinaryRuleView[]>(harness, {
        queryName: 'relations.disciplinary-rules',
        violationCategoryId,
      }),
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ disciplinaryRuleId: ruleId, minOccurrence: 1, active: true });
  });

  it('refuses a rung on a category that does not exist', async () => {
    const harness = harnessFor();

    await expect(
      harness.as(ADMINISTRATOR, () =>
        attempt(harness, {
          commandName: 'relations.define-disciplinary-rule',
          violationCategoryId: '01940000-0000-7000-8000-00000000dead',
          minOccurrence: 1,
          action: 'verbal_warning',
          sequence: 10,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('refuses a second rung at the same threshold', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);

    await givenDisciplinaryRule(harness, { violationCategoryId, minOccurrence: 3 });

    await expect(
      harness.as(ADMINISTRATOR, () =>
        attempt(harness, {
          commandName: 'relations.define-disciplinary-rule',
          violationCategoryId,
          minOccurrence: 3,
          action: 'final_warning',
          sequence: 40,
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'conflict', reason: 'rule_threshold_taken' },
    });
  });

  it('takes a rung out of service without deleting it', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const ruleId = await givenDisciplinaryRule(harness, { violationCategoryId });

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-disciplinary-rule',
        disciplinaryRuleId: ruleId,
        expectedVersion: 1,
        active: false,
      }),
    );

    const active = await harness.as(ADMINISTRATOR, () =>
      ask<readonly DisciplinaryRuleView[]>(harness, {
        queryName: 'relations.disciplinary-rules',
        violationCategoryId,
      }),
    );
    const all = await harness.as(ADMINISTRATOR, () =>
      ask<readonly DisciplinaryRuleView[]>(harness, {
        queryName: 'relations.disciplinary-rules',
        violationCategoryId,
        includeInactive: true,
      }),
    );

    expect(active).toHaveLength(0);
    // Still readable — a rule that prescribed an action somebody was issued must not vanish.
    expect(all).toHaveLength(1);
    expect(all[0]?.active).toBe(false);
  });

  it('refuses a stale expected version', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const ruleId = await givenDisciplinaryRule(harness, { violationCategoryId });

    await expect(
      harness.as(ADMINISTRATOR, () =>
        attempt(harness, {
          commandName: 'relations.amend-disciplinary-rule',
          disciplinaryRuleId: ruleId,
          expectedVersion: 7,
          sequence: 20,
        }),
      ),
    ).rejects.toThrow(/version/i);
  });

  it('requires the ladder permission, and refuses a case reader', async () => {
    const reader = harnessFor({ permissions: [RelationsPermissions.violationRead] });

    await expect(
      reader.as(ADMINISTRATOR, () =>
        attempt(reader, {
          commandName: 'relations.define-disciplinary-rule',
          violationCategoryId: '01940000-0000-7000-8000-0000000000ca',
          minOccurrence: 1,
          action: 'verbal_warning',
          sequence: 10,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });

    await expect(
      reader.as(ADMINISTRATOR, () =>
        tryAsk(reader, {
          queryName: 'relations.disciplinary-rules',
          violationCategoryId: '01940000-0000-7000-8000-0000000000ca',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });
});

describe('evaluating the ladder', () => {
  /** The D-5.2-20 assertion: no configuration means no prescription, not a default. */
  it('prescribes nothing when the tenant has configured no rule', async () => {
    const harness = harnessFor();
    const violationId = await givenViolation(harness);

    const applicable = await harness.as(OFFICER, () =>
      ask<ApplicableActionView>(harness, {
        queryName: 'relations.applicable-action',
        violationId,
      }),
    );

    expect(applicable.occurrence).toBe(1);
    expect(applicable.action).toBeUndefined();
    expect(applicable.disciplinaryRuleId).toBeUndefined();
  });

  it('prescribes the most specific configured rung', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness, { repeatWindowDays: 365 });
    const employmentId = '01940000-0000-7000-8000-0000000000e1';

    await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 1,
      action: 'verbal_warning',
      sequence: 10,
    });
    await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 3,
      action: 'written_warning',
      sequence: 30,
    });

    await givenViolation(harness, { employmentId, violationCategoryId, occurredOn: '2026-08-01' });
    await givenViolation(harness, { employmentId, violationCategoryId, occurredOn: '2026-08-05' });

    const third = await givenViolation(harness, {
      employmentId,
      violationCategoryId,
      occurredOn: '2026-08-10',
    });

    const applicable = await harness.as(OFFICER, () =>
      ask<ApplicableActionView>(harness, {
        queryName: 'relations.applicable-action',
        violationId: third,
      }),
    );

    expect(applicable.occurrence).toBe(3);
    expect(applicable.action).toBe('written_warning');
    expect(applicable.minOccurrence).toBe(3);
  });

  it('follows the configuration when it changes, because it is derived', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const violationId = await givenViolation(harness, { violationCategoryId });
    const ruleId = await givenDisciplinaryRule(harness, {
      violationCategoryId,
      minOccurrence: 1,
      action: 'verbal_warning',
    });

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-disciplinary-rule',
        disciplinaryRuleId: ruleId,
        expectedVersion: 1,
        action: 'final_warning',
      }),
    );

    const applicable = await harness.as(OFFICER, () =>
      ask<ApplicableActionView>(harness, {
        queryName: 'relations.applicable-action',
        violationId,
      }),
    );

    // A *recommendation* tracks current configuration — nothing was frozen, because nothing was
    // decided. What is frozen is an action once somebody issues one.
    expect(applicable.action).toBe('final_warning');
  });

  /** Evaluation is a read. It writes no rule, issues no action and moves no case. */
  it('mutates nothing', async () => {
    const harness = harnessFor();
    const violationCategoryId = await givenCategory(harness);
    const violationId = await givenViolation(harness, { violationCategoryId });

    await givenDisciplinaryRule(harness, { violationCategoryId });

    const before = {
      actions: harness.stores.disciplinaryActionRows.size,
      events: harness.stores.caseEventRows.length,
      rules: harness.stores.disciplinaryRuleRows.size,
    };

    await harness.as(OFFICER, () =>
      ask<ApplicableActionView>(harness, {
        queryName: 'relations.applicable-action',
        violationId,
      }),
    );

    expect({
      actions: harness.stores.disciplinaryActionRows.size,
      events: harness.stores.caseEventRows.length,
      rules: harness.stores.disciplinaryRuleRows.size,
    }).toStrictEqual(before);
  });
});
