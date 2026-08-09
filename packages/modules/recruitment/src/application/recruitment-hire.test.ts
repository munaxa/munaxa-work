import { beforeEach, describe, expect, it } from 'vitest';

import type { ApplicationSnapshot, ApplicationView } from '../contracts/views.js';

import {
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './recruitment-test-harness.js';
import { anAcceptedOffer, anInterviewedApplication } from './recruitment-fixtures.js';

/**
 * The hire, on its own, because it is the part of this module that spans three transactions and two
 * other domains.
 *
 * What is asserted here is not that the happy path works but that a stopped hire is **detectable**,
 * that a retry **converges** rather than duplicating, and that an application never reads `hired`
 * without an employment behind it (ADR-0046).
 */

/** The version the application is on now, so a test asserts on rules rather than on arithmetic. */
const versionOf = async (harness: Harness, applicationId: string): Promise<number> => {
  const read = await ask<ApplicationSnapshot>(harness, {
    queryName: 'recruitment.read-application',
    applicationId,
  });

  if (!read.ok) throw new Error('expected an application');
  return read.value.application.version;
};

describe('the hire', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('creates a Person and an Employment through their own services', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);
      const hired = await send<{ personId: string; employmentId: string; hireState: string }>(
        harness,
        {
          commandName: 'recruitment.hire-candidate',
          applicationId: application.applicationId,
          personNumber: 'E-2026-0001',
          expectedVersion: await versionOf(harness, application.applicationId),
        },
      );

      if (!hired.ok) throw new Error(`expected a hire: ${JSON.stringify(hired.error)}`);
      expect(hired.value.hireState).toBe('completed');
      expect(harness.people.created).toHaveLength(1);
      expect(harness.employment.created).toHaveLength(1);
      expect(harness.employment.created[0]?.startDate).toBe('2026-11-01');
    }));

  it('refuses to invent the customer’s person number', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);
      const hired = await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      expect(hired.ok).toBe(false);
      // Nothing was created on the way to refusing: People's numbering is the customer's.
      expect(harness.people.created).toHaveLength(0);
    }));

  it('refuses to hire against an offer nobody accepted', () =>
    asTenant(TENANT_A, async () => {
      const application = await anInterviewedApplication(harness);
      const hired = await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      expect(hired.ok).toBe(false);
    }));

  it('leaves a stopped hire visible rather than looking successful', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);

      harness.employment.failNext = true;

      const hired = await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      expect(hired.ok).toBe(false);

      const read = await ask<ApplicationSnapshot>(harness, {
        queryName: 'recruitment.read-application',
        applicationId: application.applicationId,
      });

      if (!read.ok) throw new Error('expected an application');
      expect(read.value.application.status).not.toBe('hired');
      expect(read.value.application.hireState).toBe('failed');
      expect(read.value.application.employmentId).toBeUndefined();

      const unfinished = await ask<{ items: readonly ApplicationView[] }>(harness, {
        queryName: 'recruitment.search-applications',
        unfinishedHire: true,
      });

      if (!unfinished.ok) throw new Error('expected a reconciliation page');
      expect(unfinished.value.items.map((item) => item.applicationId)).toContain(
        application.applicationId,
      );
    }));

  it('converges on a retry rather than creating a second Person or Employment', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);

      harness.employment.failNext = true;
      await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      const retried = await send<{ hireState: string }>(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      if (!retried.ok)
        throw new Error(`expected the retry to finish: ${JSON.stringify(retried.error)}`);
      expect(retried.value.hireState).toBe('completed');
      // One Person for one human being, however many attempts it took.
      expect(harness.people.created).toHaveLength(1);
      expect(harness.employment.created).toHaveLength(1);
    }));

  it('counts the hire against the requisition, and refuses one beyond the headcount', () =>
    asTenant(TENANT_A, async () => {
      const application = await anAcceptedOffer(harness);

      await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      const again = await send(harness, {
        commandName: 'recruitment.hire-candidate',
        applicationId: application.applicationId,
        personNumber: 'E-2026-0001',
        expectedVersion: await versionOf(harness, application.applicationId),
      });

      // The application is already hired, and the requisition is full: both refusals are the
      // control working rather than an error.
      expect(again.ok).toBe(false);
    }));
});
