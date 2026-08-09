import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { EmploymentHistoryView, EmploymentSnapshot } from '../contracts/views.js';

import {
  TENANT_A,
  anActiveEmployment,
  anEmployment,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './employment-test-harness.js';

/**
 * The employment lifecycle, through the pipeline.
 *
 * Everything here goes through the dispatcher rather than calling a handler, because the pipeline
 * is where tenancy and authorization are applied — and because the status history is written by the
 * *use case*, in the same transaction as the status change, which is the property most of these
 * tests are really about.
 */
describe('the employment lifecycle', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('generates the employment number rather than accepting one', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);

      expect(employment.employmentNumber).toMatch(/^EMP-2026-\d{6}$/);
    }));

  it('draws consecutive numbers from the tenant’s counter', () =>
    asTenant(TENANT_A, async () => {
      const first = await anEmployment(harness);
      const second = await anEmployment(harness);

      expect(first.employmentNumber).toBe('EMP-2026-000001');
      expect(second.employmentNumber).toBe('EMP-2026-000002');
    }));

  it('keeps a caller’s own number beside the generated one, without letting it be the number', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness, { externalEmployeeNumber: 'LEGACY-4471' });
      const read = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employment.employmentId,
      });

      if (!read.ok) throw new Error('expected a readable employment');
      expect(read.value.employment.employmentNumber).toMatch(/^EMP-/);
      expect(read.value.employment.externalEmployeeNumber).toBe('LEGACY-4471');
    }));

  it('refuses a second open employment for one person — the duplicate protection', () =>
    asTenant(TENANT_A, async () => {
      const first = await anEmployment(harness);
      const second = await send(harness, {
        commandName: 'employment.create-employment',
        personId: first.personId,
        employmentTypeCode: 'full-time',
        startDate: '2026-03-01',
      });

      expect(second.ok).toBe(false);
      if (!second.ok && second.error.kind === 'conflict') {
        expect(second.error.reason).toBe('person_already_employed');
      } else {
        throw new Error('expected a conflict');
      }
    }));

  it('allows a rehire once the previous employment has ended, with a new number', () =>
    asTenant(TENANT_A, async () => {
      const first = await anActiveEmployment(harness);

      await send(harness, {
        commandName: 'employment.end-employment',
        employmentId: first.employmentId,
        endDate: '2026-06-30',
        endReasonCode: 'resignation',
        expectedVersion: 2,
      });

      const rehired = await send<{ readonly employmentNumber: string }>(harness, {
        commandName: 'employment.create-employment',
        personId: first.personId,
        employmentTypeCode: 'full-time',
        originalHireDate: '2026-01-15',
        startDate: '2027-02-01',
      });

      expect(rehired.ok).toBe(true);
      if (rehired.ok) expect(rehired.value.employmentNumber).toBe('EMP-2027-000001');
    }));

  it('refuses an employment for a person who was merged into another record', () =>
    asTenant(TENANT_A, async () => {
      const survivor = harness.people.add(uuidV7());
      const losing = harness.people.add(uuidV7());

      harness.people.merge(losing, survivor);

      const created = await send(harness, {
        commandName: 'employment.create-employment',
        personId: losing,
        employmentTypeCode: 'full-time',
        startDate: '2026-01-15',
      });

      expect(created.ok).toBe(false);
      if (!created.ok && created.error.kind === 'rejected') {
        expect(created.error.reason).toBe('employment.rejection.person_merged');
      } else {
        throw new Error('expected a refusal');
      }
    }));

  it('refuses an employment for a person who does not exist in this tenant', () =>
    asTenant(TENANT_A, async () => {
      const created = await send(harness, {
        commandName: 'employment.create-employment',
        personId: uuidV7(),
        employmentTypeCode: 'full-time',
        startDate: '2026-01-15',
      });

      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.kind).toBe('not_found');
    }));

  it('writes the creation itself into the status history, not only later changes', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);
      const history = await ask<EmploymentHistoryView>(harness, {
        queryName: 'employment.read-history',
        employmentId: employment.employmentId,
      });

      if (!history.ok) throw new Error('expected a history');
      expect(history.value.statusHistory).toHaveLength(1);
      expect(history.value.statusHistory[0]?.toStatus).toBe('draft');
      expect(history.value.statusHistory[0]?.fromStatus).toBeUndefined();
    }));

  it('records every transition with both ends and the actor who made it', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const history = await ask<EmploymentHistoryView>(harness, {
        queryName: 'employment.read-history',
        employmentId: employment.employmentId,
      });

      if (!history.ok) throw new Error('expected a history');

      const activation = history.value.statusHistory[1];

      expect(activation?.fromStatus).toBe('draft');
      expect(activation?.toStatus).toBe('active');
      expect(activation?.recordedBy).toMatch(/^user:/);
    }));

  it('answers the status in force on a past date from the history, not from the row', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);

      testClock.value = new Date('2026-08-20T09:00:00Z');
      await send(harness, {
        commandName: 'employment.change-status',
        employmentId: employment.employmentId,
        status: 'active',
        expectedVersion: 1,
      });

      const before = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employment.employmentId,
        asOf: new Date('2026-08-10T00:00:00Z'),
      });

      if (!before.ok) throw new Error('expected a snapshot');
      // The row says active today. On the tenth it was still a draft, and that is the answer.
      expect(before.value.employment.status).toBe('active');
      expect(before.value.statusOn).toBe('draft');
    }));

  it('ends an employment with its date and reason, and refuses every later change', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const ended = await send(harness, {
        commandName: 'employment.end-employment',
        employmentId: employment.employmentId,
        endDate: '2026-09-30',
        endReasonCode: 'resignation',
        expectedVersion: 2,
      });

      expect(ended.ok).toBe(true);

      const amended = await send(harness, {
        commandName: 'employment.amend-employment',
        employmentId: employment.employmentId,
        employmentTypeCode: 'part-time',
        expectedVersion: 3,
      });

      expect(amended.ok).toBe(false);
    }));

  it('refuses a transition the machine does not permit, as a business refusal rather than an error', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);
      const suspended = await send(harness, {
        commandName: 'employment.change-status',
        employmentId: employment.employmentId,
        status: 'suspended',
        expectedVersion: 1,
      });

      expect(suspended.ok).toBe(false);
      if (!suspended.ok) expect(suspended.error.kind).toBe('rejected');
    }));

  it('refuses a second concurrent update rather than overwriting the first', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anEmployment(harness);

      await send(harness, {
        commandName: 'employment.amend-employment',
        employmentId: employment.employmentId,
        employmentTypeCode: 'part-time',
        expectedVersion: 1,
      });

      // A second caller that read version 1 before the first write lands.
      await expect(
        send(harness, {
          commandName: 'employment.amend-employment',
          employmentId: employment.employmentId,
          employmentTypeCode: 'seasonal',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/Concurrent/i);
    }));
});
