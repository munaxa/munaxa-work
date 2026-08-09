import { describe, expect, it } from 'vitest';

import { EmploymentAssignment } from './employment-assignment.js';
import { EmploymentContract } from './employment-contract.js';
import { ReportingLine, wouldCloseALoop } from './reporting-line.js';
import { inForceOn, openOn, supersessionAt } from './versioned-child.js';
import { statusOn, statusRecord } from './status-record.js';
import type { EmploymentAssignmentState } from './employment-assignment.js';

const origin = {
  tenantId: '01920000-0000-7000-8000-0000000000aa',
  correlationId: 'test',
  actor: 'user:test',
};
const NOW = new Date('2026-08-09T09:00:00Z');
const JANUARY = new Date('2026-01-01T00:00:00Z');
const MARCH = new Date('2026-03-01T00:00:00Z');
const JUNE = new Date('2026-06-01T00:00:00Z');

const anAssignment = (overrides: Record<string, unknown> = {}) => {
  const created = EmploymentAssignment.create(
    {
      tenantId: origin.tenantId,
      employmentId: '01920000-0000-7000-8000-0000000000cc',
      unitId: '01920000-0000-7000-8000-0000000000dd',
      assignmentType: 'primary',
      effectiveFrom: JANUARY,
      ...overrides,
    },
    origin,
    NOW,
  );

  if (!created.ok) throw new Error(`fixture: ${created.error.reason}`);
  return created.value;
};

describe('EmploymentAssignment', () => {
  it('defaults to a whole full-time equivalent, which is what an assignment usually is', () => {
    expect(anAssignment().snapshot().fte).toBe(1);
  });

  it('refuses an FTE above one on a single assignment — that is a second assignment', () => {
    const created = EmploymentAssignment.create(
      {
        tenantId: origin.tenantId,
        employmentId: 'e',
        unitId: 'u',
        assignmentType: 'primary',
        fte: 1.5,
        effectiveFrom: JANUARY,
      },
      origin,
      NOW,
    );

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.reason).toBe('fte_out_of_range');
  });

  it('refuses a zero FTE: an assignment nobody works is not an assignment', () => {
    const created = EmploymentAssignment.create(
      {
        tenantId: origin.tenantId,
        employmentId: 'e',
        unitId: 'u',
        assignmentType: 'primary',
        fte: 0,
        effectiveFrom: JANUARY,
      },
      origin,
      NOW,
    );

    expect(created.ok).toBe(false);
  });

  it('has no work-location field, because no authoritative model of one exists (ADR-0041)', () => {
    expect(Object.keys(anAssignment().snapshot())).not.toContain('workLocationId');
  });

  it('closes a period at a date, and refuses to close it before it began', () => {
    const assignment = anAssignment();

    expect(assignment.closeAt(JANUARY, origin, NOW).ok).toBe(false);
    expect(assignment.closeAt(MARCH, origin, NOW).ok).toBe(true);
    expect(assignment.isOpen).toBe(false);
  });

  it('shortens a closed period but never extends it, so two are never in force at once', () => {
    const assignment = anAssignment();

    assignment.closeAt(JUNE, origin, NOW);
    expect(assignment.closeAt(MARCH, origin, NOW).ok).toBe(true);
    expect(assignment.closeAt(JUNE, origin, NOW).ok).toBe(false);
  });
});

describe('the timeline', () => {
  const period = (id: string, from: Date, to?: Date): EmploymentAssignmentState => ({
    id,
    tenantId: origin.tenantId,
    employmentId: 'e',
    unitId: `unit-${id}`,
    assignmentType: 'primary',
    fte: 1,
    effectiveFrom: from,
    ...(to === undefined ? {} : { effectiveTo: to }),
    version: 1,
  });

  it('answers which placement was in force on a date', () => {
    const periods = [period('a', JANUARY, JUNE), period('b', JUNE)];

    expect(inForceOn(periods, MARCH)?.value.id).toBe('a');
    expect(inForceOn(periods, new Date('2026-07-01T00:00:00Z'))?.value.id).toBe('b');
  });

  it('answers nothing for a date before the employment had any placement', () => {
    expect(inForceOn([period('a', JUNE)], MARCH)).toBeUndefined();
  });

  it('refuses to build a timeline from overlapping periods rather than picking one', () => {
    expect(() => inForceOn([period('a', JANUARY), period('b', MARCH)], JUNE)).toThrow();
  });

  /**
   * The back-dating case. A March transfer for somebody who also moved in June must close March's
   * predecessor at March *and* bound the new period at June — not run through the June move.
   */
  it('names both the period a back-dated change supersedes and where the new one must end', () => {
    const periods = [period('a', JANUARY, JUNE), period('b', JUNE)];
    const { superseded, boundedAt } = supersessionAt(periods, MARCH);

    expect(superseded?.id).toBe('a');
    expect(boundedAt).toEqual(JUNE);
  });

  it('names no bound when the change is the latest one', () => {
    const { superseded, boundedAt } = supersessionAt([period('a', JANUARY)], MARCH);

    expect(superseded?.id).toBe('a');
    expect(boundedAt).toBeUndefined();
  });

  it('lists every period open on a date, which is what the primary-clash check counts', () => {
    const periods = [period('a', JANUARY, MARCH), period('b', JANUARY)];

    expect(openOn(periods, JUNE).map((row) => row.id)).toEqual(['b']);
  });
});

describe('ReportingLine', () => {
  it('refuses a manager who is the employment itself', () => {
    const created = ReportingLine.create(
      {
        tenantId: origin.tenantId,
        employmentId: 'e1',
        managerEmploymentId: 'e1',
        lineType: 'primary',
        effectiveFrom: JANUARY,
      },
      origin,
      NOW,
    );

    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error.reason).toBe('manager_cannot_be_self');
  });

  it('detects a loop before one is created', () => {
    // b reports to c, c reports to a. Making a report to b closes the circle.
    const managerOf = new Map([
      ['b', 'c'],
      ['c', 'a'],
    ]);

    expect(wouldCloseALoop('a', 'b', managerOf)).toBe(true);
    expect(wouldCloseALoop('d', 'b', managerOf)).toBe(false);
  });

  it('terminates on a graph that is already cyclic rather than walking forever', () => {
    const managerOf = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);

    expect(wouldCloseALoop('z', 'a', managerOf)).toBe(true);
  });
});

describe('EmploymentContract', () => {
  const aContract = (overrides: Record<string, unknown> = {}) =>
    EmploymentContract.record(
      {
        tenantId: origin.tenantId,
        employmentId: 'e',
        contractTypeCode: 'fixed-term',
        startDate: '2026-01-15',
        effectiveFrom: JANUARY,
        ...overrides,
      },
      origin,
      NOW,
    );

  it('marks a probation pending the moment one exists, so "did they pass" is answerable', () => {
    const contract = aContract({ probationEndDate: '2026-04-15' });

    if (!contract.ok) throw new Error('fixture');
    expect(contract.value.probationOutcome).toBe('pending');
  });

  it('records no outcome when there is no probation', () => {
    const contract = aContract();

    if (!contract.ok) throw new Error('fixture');
    expect(contract.value.probationOutcome).toBeUndefined();
  });

  it('concludes a probation once, and refuses a second conclusion', () => {
    const contract = aContract({ probationEndDate: '2026-04-15' });

    if (!contract.ok) throw new Error('fixture');
    expect(contract.value.concludeProbation('passed', origin, NOW).ok).toBe(true);
    expect(contract.value.concludeProbation('waived', origin, NOW).ok).toBe(false);
  });

  it('refuses to conclude a probation the contract does not have', () => {
    const contract = aContract();

    if (!contract.ok) throw new Error('fixture');

    const concluded = contract.value.concludeProbation('passed', origin, NOW);

    expect(concluded.ok).toBe(false);
    if (!concluded.ok) expect(concluded.error.reason).toBe('contract_has_no_probation');
  });

  it('refuses a contract that ends before it begins', () => {
    const contract = aContract({ endDate: '2025-12-31' });

    expect(contract.ok).toBe(false);
    if (!contract.ok) expect(contract.error.reason).toBe('contract_ends_before_it_begins');
  });

  it('refuses a probation ending before the contract begins', () => {
    const contract = aContract({ probationEndDate: '2025-12-31' });

    expect(contract.ok).toBe(false);
    if (!contract.ok) expect(contract.error.reason).toBe('probation_ends_before_contract_begins');
  });

  it('bounds notice and hours against typing mistakes, and not against any country’s law', () => {
    expect(aContract({ noticePeriodDays: -1 }).ok).toBe(false);
    expect(aContract({ workingHoursPerWeek: 200 }).ok).toBe(false);
    // 90 days' notice is lawful somewhere and unlawful elsewhere. Neither is this module's opinion.
    expect(aContract({ noticePeriodDays: 90 }).ok).toBe(true);
  });
});

describe('the status history', () => {
  const entry = (to: string, at: Date) =>
    statusRecord(
      {
        tenantId: origin.tenantId,
        employmentId: 'e',
        toStatus: to as 'draft',
        effectiveFrom: at,
        recordedBy: 'user:hr',
      },
      NOW,
    );

  it('answers the status in force on a past date, not the one on the row today', () => {
    const history = [entry('draft', JANUARY), entry('active', MARCH), entry('ended', JUNE)];

    expect(statusOn(history, new Date('2026-02-01T00:00:00Z'))).toBe('draft');
    expect(statusOn(history, new Date('2026-04-01T00:00:00Z'))).toBe('active');
    expect(statusOn(history, new Date('2026-07-01T00:00:00Z'))).toBe('ended');
  });

  it('answers nothing for a date before the employment existed', () => {
    expect(statusOn([entry('draft', MARCH)], JANUARY)).toBeUndefined();
  });

  it('takes the actor as given rather than from the caller — the entry names who recorded it', () => {
    expect(entry('active', MARCH).recordedBy).toBe('user:hr');
  });
});
