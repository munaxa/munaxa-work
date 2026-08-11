import { beforeEach, describe, expect, it } from 'vitest';

import type { ApplicationSnapshot, RequisitionSnapshot } from '../contracts/views.js';

import {
  TENANT_A,
  aCandidate,
  aPublishedVacancy,
  anApplication,
  anApprovedRequisition,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './recruitment-test-harness.js';

/**
 * The hiring process, end to end, through the pipeline.
 *
 * Everything goes through the dispatcher rather than calling a handler, because the pipeline is
 * where tenancy and authorization are applied — a test that bypassed it would prove a handler works
 * for a caller who was never checked.
 */
describe('requisitions', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('generates the requisition number rather than accepting one', () =>
    asTenant(TENANT_A, async () => {
      const created = await send<{ requisitionNumber: string }>(harness, {
        commandName: 'recruitment.create-requisition',
        positionId: harness.organization.add(),
        unitId: harness.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: harness.employment.add(),
      });

      if (!created.ok) throw new Error('expected a requisition');
      expect(created.value.requisitionNumber).toBe('REQ-2026-000001');
    }));

  it('refuses a requisition against a unit that does not exist', () =>
    asTenant(TENANT_A, async () => {
      const created = await send(harness, {
        commandName: 'recruitment.create-requisition',
        positionId: harness.organization.add(),
        unitId: '00000000-0000-7000-8000-000000000000',
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: harness.employment.add(),
      });

      expect(created.ok).toBe(false);
    }));

  it('records the approving human, taken from the context rather than the command', () =>
    asTenant(TENANT_A, async () => {
      const { requisitionId } = await anApprovedRequisition(harness);
      const read = await ask<RequisitionSnapshot>(harness, {
        queryName: 'recruitment.read-requisition',
        requisitionId,
      });

      if (!read.ok) throw new Error('expected a requisition');
      expect(read.value.decisions).toHaveLength(1);
      expect(read.value.decisions[0]?.decision).toBe('approved');
      expect(read.value.decisions[0]?.decidedBy).toMatch(/^user:/);
    }));

  it('reverses a decision by appending a row rather than amending one', () =>
    asTenant(TENANT_A, async () => {
      const { requisitionId } = await anApprovedRequisition(harness);
      const reversed = await send(harness, {
        commandName: 'recruitment.reverse-requisition-decision',
        requisitionId,
        note: 'Budget withdrawn',
        expectedVersion: 3,
      });

      expect(reversed.ok).toBe(true);

      const read = await ask<RequisitionSnapshot>(harness, {
        queryName: 'recruitment.read-requisition',
        requisitionId,
      });

      if (!read.ok) throw new Error('expected a requisition');
      expect(read.value.decisions).toHaveLength(2);
      expect(read.value.decisions[1]?.decision).toBe('reversed');
      expect(read.value.decisions[1]?.reversesId).toBe(read.value.decisions[0]?.decisionId);
      expect(read.value.requisition.status).toBe('pending_approval');
    }));
});

describe('vacancies', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('refuses to open one against a requisition nobody approved', () =>
    asTenant(TENANT_A, async () => {
      const created = await send<{ requisitionId: string }>(harness, {
        commandName: 'recruitment.create-requisition',
        positionId: harness.organization.add(),
        unitId: harness.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: harness.employment.add(),
      });

      if (!created.ok) throw new Error('expected a requisition');

      const opened = await send(harness, {
        commandName: 'recruitment.open-vacancy',
        requisitionId: created.value.requisitionId,
        title: { en: 'Field engineer', ar: 'مهندس ميداني' },
      });

      expect(opened.ok).toBe(false);
    }));

  it('refuses to publish once the requisition has been cancelled', () =>
    asTenant(TENANT_A, async () => {
      const requisition = await anApprovedRequisition(harness);
      const vacancy = await send<{ vacancyId: string }>(harness, {
        commandName: 'recruitment.open-vacancy',
        requisitionId: requisition.requisitionId,
        title: { en: 'Field engineer', ar: 'مهندس ميداني' },
      });

      if (!vacancy.ok) throw new Error('expected a vacancy');
      await send(harness, {
        commandName: 'recruitment.close-requisition',
        requisitionId: requisition.requisitionId,
        cancel: true,
        expectedVersion: 3,
      });

      const published = await send(harness, {
        commandName: 'recruitment.publish-vacancy',
        vacancyId: vacancy.value.vacancyId,
        expectedVersion: 1,
      });

      expect(published.ok).toBe(false);
    }));
});

describe('candidates and applications', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('creates no Person when a candidate is created', () =>
    asTenant(TENANT_A, async () => {
      await aCandidate(harness);

      expect(harness.people.created).toHaveLength(0);
    }));

  it('refuses a second candidate for one address rather than merging silently', () =>
    asTenant(TENANT_A, async () => {
      const candidate = await aCandidate(harness);
      const again = await send(harness, {
        commandName: 'recruitment.create-candidate',
        displayName: { en: 'Someone Else', ar: 'شخص آخر' },
        email: candidate.email.toUpperCase(),
        sourceCode: 'agency',
      });

      expect(again.ok).toBe(false);
    }));

  it('reopens the existing application when a candidate re-applies', () =>
    asTenant(TENANT_A, async () => {
      const application = await anApplication(harness);

      await send(harness, {
        commandName: 'recruitment.close-application',
        applicationId: application.applicationId,
        outcome: 'rejected',
        reasonCode: 'not-enough-experience',
        expectedVersion: 1,
      });

      const again = await send<{ applicationId: string; reopened: boolean }>(harness, {
        commandName: 'recruitment.submit-application',
        candidateId: application.candidateId,
        vacancyId: application.vacancyId,
        sourceCode: 'referral',
      });

      if (!again.ok) throw new Error('expected a reopened application');
      expect(again.value.reopened).toBe(true);
      expect(again.value.applicationId).toBe(application.applicationId);
    }));

  it('refuses an application against a vacancy that is not published', () =>
    asTenant(TENANT_A, async () => {
      const requisition = await anApprovedRequisition(harness);
      const vacancy = await send<{ vacancyId: string }>(harness, {
        commandName: 'recruitment.open-vacancy',
        requisitionId: requisition.requisitionId,
        title: { en: 'Field engineer', ar: 'مهندس ميداني' },
      });
      const candidate = await aCandidate(harness);

      if (!vacancy.ok) throw new Error('expected a vacancy');

      const submitted = await send(harness, {
        commandName: 'recruitment.submit-application',
        candidateId: candidate.candidateId,
        vacancyId: vacancy.value.vacancyId,
        sourceCode: 'referral',
      });

      expect(submitted.ok).toBe(false);
    }));

  it('writes a history row for every movement, in the same transaction', () =>
    asTenant(TENANT_A, async () => {
      const application = await anApplication(harness);

      await send(harness, {
        commandName: 'recruitment.move-application',
        applicationId: application.applicationId,
        status: 'screening',
        expectedVersion: 1,
      });

      const read = await ask<ApplicationSnapshot>(harness, {
        queryName: 'recruitment.read-application',
        applicationId: application.applicationId,
      });

      if (!read.ok) throw new Error('expected an application');
      expect(read.value.history).toHaveLength(2);
      expect(read.value.history.map((entry) => entry.toStatus)).toContain('screening');
      expect(read.value.history[0]?.recordedBy).toMatch(/^user:/);
    }));

  it('refuses a rejection with no reason', () =>
    asTenant(TENANT_A, async () => {
      const application = await anApplication(harness);
      const closed = await send(harness, {
        commandName: 'recruitment.close-application',
        applicationId: application.applicationId,
        outcome: 'rejected',
        expectedVersion: 1,
      });

      expect(closed.ok).toBe(false);
    }));

  it('counts the pipeline without loading it', () =>
    asTenant(TENANT_A, async () => {
      const vacancy = await aPublishedVacancy(harness);

      for (const suffix of ['a', 'b']) {
        const candidate = await aCandidate(harness, `applicant-${suffix}@example.com`);

        await send(harness, {
          commandName: 'recruitment.submit-application',
          candidateId: candidate.candidateId,
          vacancyId: vacancy.vacancyId,
          sourceCode: 'careers-site',
        });
      }

      const board = await ask<{ total: number; countsByStatus: Record<string, number> }>(harness, {
        queryName: 'recruitment.read-pipeline',
        vacancyId: vacancy.vacancyId,
      });

      if (!board.ok) throw new Error('expected a pipeline');
      expect(board.value.total).toBe(2);
      expect(board.value.countsByStatus['received']).toBe(2);
    }));

  it('anonymizes without deleting: the applications still resolve', () =>
    asTenant(TENANT_A, async () => {
      const application = await anApplication(harness);
      const anonymized = await send(harness, {
        commandName: 'recruitment.anonymize-candidate',
        candidateId: application.candidateId,
        expectedVersion: 1,
      });

      expect(anonymized.ok).toBe(true);

      const read = await ask<ApplicationSnapshot>(harness, {
        queryName: 'recruitment.read-application',
        applicationId: application.applicationId,
      });

      expect(read.ok).toBe(true);
    }));
});
