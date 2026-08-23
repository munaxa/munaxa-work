import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  attempt,
  ask,
  givenConcludedInvestigation,
  givenInvestigation,
  givenViolation,
  harnessFor,
  INVESTIGATOR,
  OFFICER,
  send,
  tryAsk,
} from './relations-test-harness.js';
import { ALL_RELATIONS_PERMISSIONS, RelationsPermissions } from './relations-permissions.js';
import type { InvestigationPageView, InvestigationView } from '../contracts/views.js';

/**
 * Checkpoint 3 through the real handlers: the two approved decisions and the repeat count.
 *
 * The database's own guarantees — the correction chain's unique index, the immutability triggers,
 * tenant isolation — are proved against PostgreSQL in `relations-correction.integration.test.ts`.
 * What is proved here is what a caller meets.
 */

const correct = (investigationId: string, overrides: Record<string, unknown> = {}) => ({
  commandName: 'relations.correct-investigation',
  investigationId,
  findings: 'The third absence was authorized leave recorded late.',
  recommendation: 'No action.',
  // The harness clock is 2026-08-22, and a conclusion cannot be dated in the future.
  concludedOn: '2026-08-22',
  reason: 'The leave record was produced after the inquiry concluded.',
  ...overrides,
});

describe('D-5.2-18 · conducting an inquiry is its own capability', () => {
  it('refuses somebody who may only record violations', async () => {
    const seeded = harnessFor();
    const violationId = await givenViolation(seeded);

    const recorder = harnessFor({ permissions: [RelationsPermissions.violationRecord] });

    recorder.memberships.add(INVESTIGATOR);

    // The exact escalation D-5.2-18 closed: filing a report no longer implies concluding an inquiry.
    await expect(
      recorder.as(OFFICER, () =>
        attempt(recorder, {
          commandName: 'relations.open-investigation',
          violationId,
          investigatorMembershipId: INVESTIGATOR,
          openedOn: '2026-08-21',
          subject: 'Three consecutive unnotified absences',
          reason: 'The supervisor asked for the absences to be looked into.',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('admits somebody holding the conduct permission', async () => {
    const harness = harnessFor({
      permissions: [RelationsPermissions.investigationConduct, RelationsPermissions.violationRead],
    });
    const violationId = await givenViolation(harnessFor());

    // Seeded through a fully-granted harness; this one holds only what the assertion is about.
    harness.stores.violationRows.set(violationId, {
      ...(harnessFor().stores.violationRows.get(violationId) ?? {
        violationId,
        employmentId: '01940000-0000-7000-8000-0000000000ef',
        violationCategoryId: '01940000-0000-7000-8000-0000000000ca',
        categoryCode: 'unauthorized-absence',
        severity: 'major',
        occurredOn: '2026-08-20',
        reportedBy: OFFICER,
        description: 'Absent.',
        state: 'reported' as const,
        recordedAt: new Date('2026-08-22T09:00:00Z'),
        version: 1,
      }),
    });
    harness.memberships.add(INVESTIGATOR);

    const opened = await harness.as(OFFICER, () =>
      attempt(harness, {
        commandName: 'relations.open-investigation',
        violationId,
        investigatorMembershipId: INVESTIGATOR,
        openedOn: '2026-08-21',
        subject: 'Three consecutive unnotified absences',
        reason: 'The supervisor asked.',
      }),
    );

    expect(opened).toMatchObject({ ok: true });
  });
});

describe('D-5.2-18 · findings need a second grant', () => {
  /**
   * Everything **except** `investigationReadFindings`.
   *
   * Stated as a subtraction rather than a list, so the harness holds whatever it needs to arrange
   * its own fixture and the assertion is about exactly one missing grant. A list would drift the day
   * a fixture needs another permission, and the test would then fail for the wrong reason.
   */
  const withoutFindings = () =>
    harnessFor({
      permissions: ALL_RELATIONS_PERMISSIONS.filter(
        (permission) => permission !== RelationsPermissions.investigationReadFindings,
      ),
    });

  it('answers not found for a concluded inquiry, rather than a distinguishable refusal', async () => {
    const harness = withoutFindings();
    const { investigationId } = await givenConcludedInvestigation(harness);

    const refused = await harness.as(ADMINISTRATOR, () =>
      tryAsk(harness, { queryName: 'relations.read-investigation', investigationId }),
    );

    // Not `forbidden`: that would confirm findings exist about somebody, which is the disclosure.
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'not_found', resource: 'investigation' },
    });
  });

  it('returns an open inquiry normally, because it has concluded nothing', async () => {
    const harness = withoutFindings();
    const { investigationId } = await givenInvestigation(harness);

    const held = await harness.as(ADMINISTRATOR, () =>
      ask<InvestigationView>(harness, {
        queryName: 'relations.read-investigation',
        investigationId,
      }),
    );

    expect(held.state).toBe('open');
    expect(held.findings).toBeUndefined();
  });

  it('discloses findings to a caller holding read-findings', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);

    const held = await harness.as(ADMINISTRATOR, () =>
      ask<InvestigationView>(harness, {
        queryName: 'relations.read-investigation',
        investigationId,
      }),
    );

    expect(held.findings).toContain('shift log');
    expect(held.recommendation).toBe('A written warning.');
  });

  /**
   * The listing is redacted, not filtered — and this is the assertion that catches a leak through an
   * alternate path rather than the direct read.
   */
  it('withholds findings from a listing without hiding that an inquiry exists', async () => {
    const harness = withoutFindings();
    const { violationId } = await givenConcludedInvestigation(harness);

    const page = await harness.as(ADMINISTRATOR, () =>
      ask<InvestigationPageView>(harness, { queryName: 'relations.investigations', violationId }),
    );

    expect(page.total).toBe(1);
    expect(page.items[0]?.state).toBe('concluded');
    // Absent, not blanked and not marked redacted — indistinguishable from an inquiry still open.
    expect(page.items[0]?.findings).toBeUndefined();
    expect(page.items[0]?.recommendation).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain('shift log');
  });

  it('leaks no findings through the case history either', async () => {
    const harness = withoutFindings();
    const { violationId } = await givenConcludedInvestigation(harness);

    const history = await harness.as(ADMINISTRATOR, () =>
      ask<unknown>(harness, { queryName: 'relations.case-history', violationId }),
    );

    expect(JSON.stringify(history)).not.toContain('shift log');
    expect(JSON.stringify(history)).not.toContain('A written warning');
  });

  it('writes no access event for an inquiry it refused to disclose', async () => {
    const harness = withoutFindings();
    const { investigationId } = await givenConcludedInvestigation(harness);

    harness.stores.accessRows.length = 0;

    await harness.as(ADMINISTRATOR, () =>
      tryAsk(harness, { queryName: 'relations.read-investigation', investigationId }),
    );

    // A read that did not happen is not recorded as one.
    expect(harness.stores.accessRows).toHaveLength(0);
  });
});

describe('D-5.2-19 · correcting a concluded inquiry', () => {
  it('creates a new record and leaves the original exactly as it was', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);
    const before = { ...harness.stores.investigationRows.get(investigationId) };

    const corrected = await harness.as(OFFICER, () =>
      send<{ investigationId: string; correctsInvestigationId: string }>(
        harness,
        correct(investigationId),
      ),
    );

    expect(corrected.investigationId).not.toBe(investigationId);
    expect(corrected.correctsInvestigationId).toBe(investigationId);
    // The corrected row is untouched — every field, including its version.
    expect(harness.stores.investigationRows.get(investigationId)).toStrictEqual(before);
  });

  it('records the correction as concluded, linked, and carrying its own findings', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);
    const corrected = await harness.as(OFFICER, () =>
      send<{ investigationId: string }>(harness, correct(investigationId)),
    );

    const correction = harness.stores.investigationRows.get(corrected.investigationId);

    expect(correction).toMatchObject({
      state: 'concluded',
      correctsInvestigationId: investigationId,
      findings: 'The third absence was authorized leave recorded late.',
      recommendation: 'No action.',
      concludedOn: '2026-08-22',
    });
  });

  it('refuses to correct an inquiry that is still open', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenInvestigation(harness);

    await expect(
      harness.as(OFFICER, () => attempt(harness, correct(investigationId))),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rejected', reason: 'relations.rejection.correction_target_not_concluded' },
    });
  });

  it('refuses a second correction of the same conclusion', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);

    await harness.as(OFFICER, () => send(harness, correct(investigationId)));

    await expect(
      harness.as(OFFICER, () => attempt(harness, correct(investigationId))),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'conflict', reason: 'investigation_already_corrected' },
    });
  });

  /** Corrections chain rather than branch: the newest link is the one to correct. */
  it('allows a correction of a correction', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);
    const first = await harness.as(OFFICER, () =>
      send<{ investigationId: string }>(harness, correct(investigationId)),
    );

    const second = await harness.as(OFFICER, () =>
      send<{ correctsInvestigationId: string }>(
        harness,
        correct(first.investigationId, { reason: 'The leave record was itself mistaken.' }),
      ),
    );

    expect(second.correctsInvestigationId).toBe(first.investigationId);
  });

  it('requires a reason', async () => {
    const harness = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(harness);

    await expect(
      harness.as(OFFICER, () => attempt(harness, correct(investigationId, { reason: '   ' }))),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rejected', reason: 'relations.rejection.correction_reason_missing' },
    });
  });

  it('requires the conduct permission, and refuses a mere reader', async () => {
    const seeded = harnessFor();
    const { investigationId } = await givenConcludedInvestigation(seeded);

    const reader = harnessFor({ permissions: [RelationsPermissions.violationRead] });

    await expect(
      reader.as(OFFICER, () => attempt(reader, correct(investigationId))),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('moves no case: a correction restates findings and does not transition', async () => {
    const harness = harnessFor();
    const { violationId, investigationId } = await givenConcludedInvestigation(harness);
    const before = harness.stores.caseEventRows.length;

    await harness.as(OFFICER, () => send(harness, correct(investigationId)));

    expect(harness.stores.caseEventRows).toHaveLength(before);

    const history = await harness.as(OFFICER, () =>
      ask<{ currentState: string }>(harness, { queryName: 'relations.case-history', violationId }),
    );

    expect(history.currentState).toBe('findings');
  });
});
