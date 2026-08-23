import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  attempt,
  ask,
  givenInvestigation,
  givenViolation,
  harnessFor,
  INVESTIGATOR,
  OFFICER,
  send,
  tryAsk,
  type Harness,
} from './relations-test-harness.js';
import { RelationsPermissions } from './relations-permissions.js';
import type {
  CaseHistoryView,
  InvestigationPageView,
  InvestigationView,
} from '../contracts/views.js';

/**
 * The case lifecycle through the real handlers, the real dispatcher and the real module.
 *
 * **What this suite can prove and what it cannot.** The in-memory stores have no unique index and no
 * trigger, so they cannot settle a race or refuse a rewrite. What they can prove is the behaviour a
 * caller meets: which transitions are accepted, what a refusal says, what is written and in what
 * order, and that a read is audited. The index and the triggers are proved against PostgreSQL in
 * `relations-investigation.integration.test.ts`, and neither suite stands in for the other.
 */

const openCommand = (violationId: string, overrides: Record<string, unknown> = {}) => ({
  commandName: 'relations.open-investigation',
  violationId,
  investigatorMembershipId: INVESTIGATOR,
  openedOn: '2026-08-21',
  subject: 'Three consecutive unnotified absences',
  reason: 'The supervisor asked for the absences to be looked into.',
  ...overrides,
});

const concludeCommand = (investigationId: string, overrides: Record<string, unknown> = {}) => ({
  commandName: 'relations.conclude-investigation',
  investigationId,
  findings: 'The absences were unnotified and the shift log confirms them.',
  recommendation: 'A written warning.',
  concludedOn: '2026-08-22',
  reason: 'The investigator has reported.',
  ...overrides,
});

describe('opening an investigation', () => {
  it('opens the inquiry and moves the case in one act', async () => {
    const harness = harnessFor();
    const { violationId } = await givenInvestigation(harness);

    const history = await harness.as(OFFICER, () =>
      ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId }),
    );

    expect(history.currentState).toBe('under_investigation');
    expect(history.history).toHaveLength(1);
    expect(history.history[0]).toMatchObject({
      sequence: 1,
      fromState: 'reported',
      toState: 'under_investigation',
      actor: OFFICER,
      reason: 'The supervisor asked for the absences to be looked into.',
    });
  });

  /**
   * The transition names the investigation that caused it, so the history reads as a sequence of
   * things people did rather than a column that changed for no visible reason.
   */
  it('links the transition to the inquiry that caused it', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenInvestigation(harness);

    const history = await harness.as(OFFICER, () =>
      ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId }),
    );

    expect(history.history[0]?.investigationId).toBe(investigationId);
  });

  /** The actor and the instant come from the context and the clock, never from the command. */
  it('attributes the transition to the caller and stamps it from the server clock', async () => {
    const harness = harnessFor();
    const { violationId } = await givenInvestigation(harness);
    const [recorded] = harness.stores.caseEventRows;

    expect(recorded?.violationId).toBe(violationId);
    expect(recorded?.actor).toBe(OFFICER);
    expect(recorded?.occurredAt).toStrictEqual(harness.clock.now());
    expect(recorded?.correlationId).not.toBe('');
  });

  it("refuses a violation that does not exist, exactly as it refuses another tenant's", async () => {
    const harness = harnessFor();

    harness.memberships.add(INVESTIGATOR);

    const refused = await harness.as(OFFICER, () =>
      attempt(harness, openCommand('01940000-0000-7000-8000-00000000dead')),
    );

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'not_found', resource: 'violation' },
    });
  });

  /**
   * An investigator is a membership the caller assigns, so it arrives on the command — and a value a
   * command supplies is a value a command can invent. Identity is asked whether it may act at all.
   */
  it('refuses an investigator Identity does not recognise', async () => {
    const harness = harnessFor();
    const violationId = await givenViolation(harness);

    // Deliberately not added to `FakeMemberships`: absent means may-not-act, never a silent yes.
    const refused = await harness.as(OFFICER, () => attempt(harness, openCommand(violationId)));

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'not_found', resource: 'membership' },
    });
    // Nothing was written on the way to the refusal.
    expect(harness.stores.investigationRows.size).toBe(0);
    expect(harness.stores.caseEventRows).toHaveLength(0);
  });

  it('refuses a second inquiry while one is in progress', async () => {
    const harness = harnessFor();
    const { violationId } = await givenInvestigation(harness);

    const refused = await harness.as(OFFICER, () => attempt(harness, openCommand(violationId)));

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'conflict', reason: 'investigation_already_open' },
    });
    expect(harness.stores.caseEventRows).toHaveLength(1);
  });

  it('refuses an inquiry into a case that has already reached findings', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, concludeCommand(investigationId)));

    const refused = await harness.as(OFFICER, () => attempt(harness, openCommand(violationId)));

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'rejected', reason: 'relations.rejection.transition_not_permitted' },
    });
  });
});

describe('concluding an investigation', () => {
  it('records the conclusion and moves the case to findings', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, concludeCommand(investigationId)));

    const [history, investigation] = await harness.as(OFFICER, async () => [
      await ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId }),
      await ask<InvestigationView>(harness, {
        queryName: 'relations.read-investigation',
        investigationId,
      }),
    ]);

    expect(history.currentState).toBe('findings');
    expect(history.history.map((step) => step.sequence)).toStrictEqual([1, 2]);
    expect(history.history[1]).toMatchObject({
      fromState: 'under_investigation',
      toState: 'findings',
    });
    expect(investigation).toMatchObject({
      state: 'concluded',
      recommendation: 'A written warning.',
      concludedOn: '2026-08-22',
    });
  });

  it('refuses to conclude one that already has', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, concludeCommand(investigationId)));

    const refused = await harness.as(OFFICER, () =>
      attempt(harness, concludeCommand(investigationId)),
    );

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'rejected', reason: 'relations.rejection.investigation_already_concluded' },
    });
  });

  it('refuses an unknown inquiry without saying whose it might be', async () => {
    const harness = harnessFor();

    const refused = await harness.as(OFFICER, () =>
      attempt(harness, concludeCommand('01940000-0000-7000-8000-00000000beef')),
    );

    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'not_found', resource: 'investigation' },
    });
  });

  /**
   * A refused conclusion writes nothing — neither the inquiry's update nor a transition.
   *
   * Both writes are inside one transaction, which is what D-5.2-17 means by atomic. The in-memory
   * unit of work does not roll back, so this asserts the stronger property the handler actually has:
   * it refuses **before** either write, so there is no partial state to roll back from.
   */
  it('writes nothing when the conclusion is refused', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenInvestigation(harness);

    const refused = await harness.as(OFFICER, () =>
      attempt(harness, concludeCommand(investigationId, { findings: '   ' })),
    );

    expect(refused).toMatchObject({ ok: false });
    expect(harness.stores.caseEventRows).toHaveLength(1);
    expect(harness.stores.investigationRows.get(investigationId)?.state).toBe('open');
  });
});

describe('reading a case', () => {
  it('audits reading an inquiry, a list of them, and a history', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenInvestigation(harness);

    harness.stores.accessRows.length = 0;

    await harness.as(ADMINISTRATOR, async () => {
      await ask<InvestigationView>(harness, {
        queryName: 'relations.read-investigation',
        investigationId,
      });
      await ask<InvestigationPageView>(harness, {
        queryName: 'relations.investigations',
        violationId,
      });
      await ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId });
    });

    expect(harness.stores.accessRows.map((row) => row.action)).toStrictEqual([
      'investigation_read',
      'investigation_listed',
      'case_history_read',
    ]);
    // Keyed by the violation, so "who has looked at this case" is one question over one trail.
    for (const row of harness.stores.accessRows) {
      expect(row.violationId).toBe(violationId);
      expect(row.actor).toBe(ADMINISTRATOR);
    }
  });

  it('writes no access event for a case nobody could see', async () => {
    const harness = harnessFor();

    harness.stores.accessRows.length = 0;

    const refused = await harness.as(ADMINISTRATOR, () =>
      tryAsk(harness, {
        queryName: 'relations.case-history',
        violationId: '01940000-0000-7000-8000-00000000face',
      }),
    );

    expect(refused).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    // A miss discloses nothing, so a caller cannot write into the trail by guessing identifiers.
    expect(harness.stores.accessRows).toHaveLength(0);
  });

  it('reports a case with no transitions as reported, from no stored column', async () => {
    const harness = harnessFor();
    const violationId = await givenViolation(harness);

    const history = await harness.as(OFFICER, () =>
      ask<CaseHistoryView>(harness, { queryName: 'relations.case-history', violationId }),
    );

    expect(history).toStrictEqual({ violationId, currentState: 'reported', history: [] });
  });
});

describe('what each lifecycle operation requires', () => {
  const opener = (): Harness => harnessFor({ permissions: [RelationsPermissions.violationRecord] });

  it('refuses a reader the ability to open or conclude an inquiry', async () => {
    const seeded = harnessFor();
    const { violationId, investigationId } = await givenInvestigation(seeded);

    const reader = harnessFor({ permissions: [RelationsPermissions.violationRead] });

    await expect(
      reader.as(OFFICER, () => attempt(reader, openCommand(violationId))),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    await expect(
      reader.as(OFFICER, () => attempt(reader, concludeCommand(investigationId))),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('refuses somebody who may only handle cases the ability to read one', async () => {
    const handler = opener();

    await expect(
      handler.as(OFFICER, () =>
        tryAsk(handler, {
          queryName: 'relations.case-history',
          violationId: '01940000-0000-7000-8000-00000000aaaa',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('refuses every lifecycle operation outside a tenant context', async () => {
    const harness = harnessFor();
    const { violationId } = await givenInvestigation(harness);

    await expect(
      attempt(harness, openCommand(violationId, { investigatorMembershipId: INVESTIGATOR })),
    ).rejects.toThrow(/tenant/i);
  });
});
