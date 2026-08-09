import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import type { EmploymentHistoryView, EmploymentSnapshot } from '../contracts/views.js';

import {
  JUNE,
  MARCH,
  SEPTEMBER,
  TENANT_A,
  anActiveEmployment,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './employment-test-harness.js';

/**
 * Organizational placement and the managerial relationship.
 *
 * The suite is mostly about one property: **a change never edits**. Every assertion that a past
 * date still answers the old unit is an assertion that the product can reconstruct an organization
 * as it stood, which is what §13 and §22 actually require.
 */
describe('assignments', () => {
  let harness: Harness;
  let unitA: string;
  let unitB: string;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
    unitA = harness.organization.add(uuidV7());
    unitB = harness.organization.add(uuidV7());
  });

  const placed = async (employmentId: string, unitId: string, effectiveFrom: Date) =>
    send(harness, {
      commandName: 'employment.create-assignment',
      employmentId,
      unitId,
      effectiveFrom,
    });

  it('places an employment in a unit', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const assigned = await placed(employment.employmentId, unitA, MARCH);

      expect(assigned.ok).toBe(true);
    }));

  it('refuses a unit that does not exist in this tenant', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const assigned = await placed(employment.employmentId, uuidV7(), MARCH);

      expect(assigned.ok).toBe(false);
      if (!assigned.ok) expect(assigned.error.kind).toBe('not_found');
    }));

  it('refuses a second open primary assignment', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await placed(employment.employmentId, unitA, MARCH);

      const second = await placed(employment.employmentId, unitB, JUNE);

      expect(second.ok).toBe(false);
      if (!second.ok && second.error.kind === 'conflict') {
        expect(second.error.reason).toBe('primary_assignment_already_in_force');
      } else {
        throw new Error('expected a conflict');
      }
    }));

  it('allows a secondary assignment alongside a primary — a secondment is ordinary', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await placed(employment.employmentId, unitA, MARCH);

      const secondary = await send(harness, {
        commandName: 'employment.create-assignment',
        employmentId: employment.employmentId,
        unitId: unitB,
        assignmentType: 'secondary',
        fte: 0.5,
        effectiveFrom: JUNE,
      });

      expect(secondary.ok).toBe(true);
    }));

  it('transfers by closing one period and opening another, never by editing', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await placed(employment.employmentId, unitA, MARCH);
      const moved = await send(harness, {
        commandName: 'employment.change-assignment',
        employmentId: employment.employmentId,
        unitId: unitB,
        reasonCode: 'transfer',
        effectiveFrom: JUNE,
      });

      expect(moved.ok).toBe(true);

      const history = await ask<EmploymentHistoryView>(harness, {
        queryName: 'employment.read-history',
        employmentId: employment.employmentId,
      });

      if (!history.ok) throw new Error('expected a history');
      expect(history.value.assignments).toHaveLength(2);
      expect(history.value.assignments[0]?.unitId).toBe(unitA);
      expect(history.value.assignments[0]?.effectiveTo).toEqual(JUNE);
      expect(history.value.assignments[1]?.unitId).toBe(unitB);
    }));

  /** The question §13 asks by name: where did this employee belong on a specific historical date. */
  it('answers where somebody belonged on a past date, after they have moved', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await placed(employment.employmentId, unitA, MARCH);
      await send(harness, {
        commandName: 'employment.change-assignment',
        employmentId: employment.employmentId,
        unitId: unitB,
        effectiveFrom: JUNE,
      });

      const inApril = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employment.employmentId,
        asOf: new Date('2026-04-01T00:00:00Z'),
      });
      const inJuly = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employment.employmentId,
        asOf: new Date('2026-07-01T00:00:00Z'),
      });

      if (!inApril.ok || !inJuly.ok) throw new Error('expected two snapshots');
      expect(inApril.value.employment.assignment?.unitId).toBe(unitA);
      expect(inJuly.value.employment.assignment?.unitId).toBe(unitB);
    }));

  /**
   * The back-dating case, and the one most likely to be got wrong. A March transfer recorded after
   * a June one must not run through June and silently discard it.
   */
  it('bounds a back-dated transfer at the start of the move that already followed it', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await placed(employment.employmentId, unitA, new Date('2026-01-01T00:00:00Z'));
      await send(harness, {
        commandName: 'employment.change-assignment',
        employmentId: employment.employmentId,
        unitId: unitB,
        effectiveFrom: SEPTEMBER,
      });

      const unitC = harness.organization.add(uuidV7());
      const backDated = await send(harness, {
        commandName: 'employment.change-assignment',
        employmentId: employment.employmentId,
        unitId: unitC,
        effectiveFrom: MARCH,
      });

      expect(backDated.ok).toBe(true);

      const history = await ask<EmploymentHistoryView>(harness, {
        queryName: 'employment.read-history',
        employmentId: employment.employmentId,
      });

      if (!history.ok) throw new Error('expected a history');

      const periods = history.value.assignments;

      // January→March in A, March→September in C, September onward in B. September survives.
      expect(periods.map((period) => period.unitId)).toEqual([unitA, unitC, unitB]);
      expect(periods[1]?.effectiveTo).toEqual(SEPTEMBER);
    }));

  it('refuses to change a placement that does not exist yet', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const moved = await send(harness, {
        commandName: 'employment.change-assignment',
        employmentId: employment.employmentId,
        unitId: unitB,
        effectiveFrom: JUNE,
      });

      expect(moved.ok).toBe(false);
      if (!moved.ok && moved.error.kind === 'conflict') {
        expect(moved.error.reason).toBe('no_primary_assignment_to_change');
      } else {
        throw new Error('expected a conflict');
      }
    }));

  it('refuses any placement change on an ended employment', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);

      await send(harness, {
        commandName: 'employment.end-employment',
        employmentId: employment.employmentId,
        endDate: '2026-06-30',
        endReasonCode: 'resignation',
        expectedVersion: 2,
      });

      const assigned = await placed(employment.employmentId, unitA, JUNE);

      expect(assigned.ok).toBe(false);
    }));
});

describe('the managerial relationship', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A);
  });

  it('names a manager by employment, and resolves it as at a date', () =>
    asTenant(TENANT_A, async () => {
      const employee = await anActiveEmployment(harness);
      const manager = await anActiveEmployment(harness);

      const changed = await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: employee.employmentId,
        managerEmploymentId: manager.employmentId,
        effectiveFrom: MARCH,
      });

      expect(changed.ok).toBe(true);

      const read = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employee.employmentId,
        asOf: JUNE,
      });

      if (!read.ok) throw new Error('expected a snapshot');
      expect(read.value.employment.managerEmploymentId).toBe(manager.employmentId);
    }));

  /** The second question §13 asks by name: who was this employee's manager at that time. */
  it('answers who somebody’s manager was on a past date after the manager changed', () =>
    asTenant(TENANT_A, async () => {
      const employee = await anActiveEmployment(harness);
      const first = await anActiveEmployment(harness);
      const second = await anActiveEmployment(harness);

      await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: employee.employmentId,
        managerEmploymentId: first.employmentId,
        effectiveFrom: MARCH,
      });
      await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: employee.employmentId,
        managerEmploymentId: second.employmentId,
        effectiveFrom: SEPTEMBER,
      });

      const inJune = await ask<EmploymentSnapshot>(harness, {
        queryName: 'employment.read-employment',
        employmentId: employee.employmentId,
        asOf: JUNE,
      });

      if (!inJune.ok) throw new Error('expected a snapshot');
      expect(inJune.value.employment.managerEmploymentId).toBe(first.employmentId);
    }));

  it('refuses a manager whose own employment has ended', () =>
    asTenant(TENANT_A, async () => {
      const employee = await anActiveEmployment(harness);
      const manager = await anActiveEmployment(harness);

      await send(harness, {
        commandName: 'employment.end-employment',
        employmentId: manager.employmentId,
        endDate: '2026-05-31',
        endReasonCode: 'resignation',
        expectedVersion: 2,
      });

      const changed = await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: employee.employmentId,
        managerEmploymentId: manager.employmentId,
      });

      expect(changed.ok).toBe(false);
      if (!changed.ok && changed.error.kind === 'conflict') {
        expect(changed.error.reason).toBe('manager_employment_ended');
      } else {
        throw new Error('expected a conflict');
      }
    }));

  it('refuses a change that would close a loop in the hierarchy', () =>
    asTenant(TENANT_A, async () => {
      const top = await anActiveEmployment(harness);
      const middle = await anActiveEmployment(harness);

      await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: middle.employmentId,
        managerEmploymentId: top.employmentId,
      });

      const circular = await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: top.employmentId,
        managerEmploymentId: middle.employmentId,
      });

      expect(circular.ok).toBe(false);
      if (!circular.ok && circular.error.kind === 'conflict') {
        expect(circular.error.reason).toBe('reporting_line_would_close_a_loop');
      } else {
        throw new Error('expected a conflict');
      }
    }));

  it('refuses somebody as their own manager', () =>
    asTenant(TENANT_A, async () => {
      const employment = await anActiveEmployment(harness);
      const changed = await send(harness, {
        commandName: 'employment.change-manager',
        employmentId: employment.employmentId,
        managerEmploymentId: employment.employmentId,
      });

      expect(changed.ok).toBe(false);
    }));
});
