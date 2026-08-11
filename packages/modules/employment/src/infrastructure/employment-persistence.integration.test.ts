import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Employment } from '../domain/employment.js';
import { EmploymentAssignment } from '../domain/employment-assignment.js';
import { EmploymentContract } from '../domain/employment-contract.js';
import { ReportingLine } from '../domain/reporting-line.js';
import { statusRecord } from '../domain/status-record.js';

import {
  CONNECTION,
  TENANT_A,
  openEmploymentFixture,
  requireDatabaseInCi,
  type EmploymentFixture,
} from './employment-database.fixture.js';

/**
 * The repositories, the constraints and the counter, against a real PostgreSQL.
 *
 * What is checked here is the database's half of the design and nothing else: the partial unique
 * indexes that make the domain's refusals deterministic under a race, the check constraints that
 * refuse a half-recorded termination, the date columns that must survive a round trip on a server
 * west of UTC, and the counter two concurrent creates serialize on. Every rule that lives in the
 * domain is tested against fakes, in milliseconds, elsewhere.
 */

const origin = { tenantId: TENANT_A, correlationId: 'test', actor: 'user:test' };
const NOW = new Date('2026-08-09T09:00:00Z');
const JANUARY = new Date('2026-01-01T00:00:00Z');
const JUNE = new Date('2026-06-01T00:00:00Z');

requireDatabaseInCi('Employment persistence');

describe.skipIf(CONNECTION === undefined)('Employment persistence', () => {
  let fixture: EmploymentFixture;

  beforeAll(async () => {
    fixture = await openEmploymentFixture('employment_fixture_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const anEmployment = async (
    personId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const number = await fixture.stores.numbers.allocate(transaction, '2026');
      const created = Employment.create(
        {
          tenantId: TENANT_A,
          personId,
          employmentNumber: `EMP-2026-${String(number).padStart(6, '0')}`,
          employmentTypeCode: 'full-time',
          startDate: '2026-01-15',
          ...overrides,
        },
        origin,
        NOW,
      );

      if (!created.ok) throw new Error(`fixture: ${created.error.reason}`);
      await fixture.stores.employments.insert(transaction, created.value.snapshot());
      return created.value.id;
    });

  it('round-trips an employment, keeping its civil dates as the dates that were stored', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-1');
    const employmentId = await anEmployment(personId, { originalHireDate: '2019-04-01' });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.employments.byId(transaction, employmentId),
    );

    expect(read?.startDate).toBe('2026-01-15');
    // Read as text, not as a `date` the driver would localize to the process's midnight.
    expect(read?.originalHireDate).toBe('2019-04-01');
    expect(read?.status).toBe('draft');
  });

  it('allocates consecutive numbers and never reuses one', async () => {
    const allocated = await fixture.asTenant(TENANT_A, async (transaction) => [
      await fixture.stores.numbers.allocate(transaction, '2026'),
      await fixture.stores.numbers.allocate(transaction, '2026'),
      await fixture.stores.numbers.allocate(transaction, '2027'),
    ]);

    expect(allocated).toEqual([1, 2, 1]);
  });

  it('refuses a second open employment for one person, at the database', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-2');

    await anEmployment(personId);

    await expect(anEmployment(personId)).rejects.toThrow(
      /employment_one_open_per_person_key|duplicate key/i,
    );
  });

  it('allows a second employment once the first has ended — a rehire', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-3');
    const first = await anEmployment(personId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const state = await fixture.stores.employments.byId(transaction, first);

      if (state === undefined) throw new Error('fixture');

      const employment = Employment.rehydrate(state);

      employment.transitionTo('active', undefined, origin, NOW);
      employment.end({ endDate: '2026-06-30', endReasonCode: 'resignation' }, origin, NOW);
      await fixture.stores.employments.update(transaction, employment.snapshot(), state.version);
    });

    await expect(anEmployment(personId, { startDate: '2027-01-01' })).resolves.toBeDefined();
  });

  it('refuses an employment whose person does not exist — the one cross-module foreign key', async () => {
    await expect(anEmployment(uuidV7())).rejects.toThrow(/employment_person_fk|foreign key/i);
  });

  it('refuses an ended employment with no end date, and one with no reason', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-4');

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into employment
             (tenant_id, person_id, employment_number, status, employment_type_code,
              original_hire_date, start_date, metadata,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'EMP-2026-000900', 'ended', 'full-time',
                   '2026-01-15', '2026-01-15', '{}'::jsonb, now(), 't', now(), 't', 1)`,
          [TENANT_A, personId],
        ),
      ),
    ).rejects.toThrow(/employment_ended_is_dated_check/);
  });

  it('refuses two open primary assignments for one employment, at the database', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-5');
    const employmentId = await anEmployment(personId);

    const place = (unitId: string, effectiveFrom: Date) =>
      fixture.asTenant(TENANT_A, async (transaction) => {
        const created = EmploymentAssignment.create(
          {
            tenantId: TENANT_A,
            employmentId,
            unitId,
            assignmentType: 'primary',
            effectiveFrom,
          },
          origin,
          NOW,
        );

        if (!created.ok) throw new Error('fixture');
        await fixture.stores.assignments.insert(transaction, created.value.snapshot());
      });

    await place(uuidV7(), JANUARY);
    await expect(place(uuidV7(), JUNE)).rejects.toThrow(
      /employment_assignment_one_primary_key|duplicate key/i,
    );
  });

  it('counts filled headcount from assignments in force, and excludes ended employments', async () => {
    const positionId = uuidV7();
    const unitId = uuidV7();

    const employed = async (personNumber: string, end: boolean): Promise<void> => {
      const personId = await fixture.seedPerson(TENANT_A, personNumber);
      const employmentId = await anEmployment(personId);

      await fixture.asTenant(TENANT_A, async (transaction) => {
        const created = EmploymentAssignment.create(
          {
            tenantId: TENANT_A,
            employmentId,
            unitId,
            positionId,
            assignmentType: 'primary',
            effectiveFrom: JANUARY,
          },
          origin,
          NOW,
        );

        if (!created.ok) throw new Error('fixture');
        await fixture.stores.assignments.insert(transaction, created.value.snapshot());

        if (!end) return;

        const state = await fixture.stores.employments.byId(transaction, employmentId);

        if (state === undefined) throw new Error('fixture');

        const employment = Employment.rehydrate(state);

        employment.transitionTo('active', undefined, origin, NOW);
        employment.end({ endDate: '2026-05-31', endReasonCode: 'resignation' }, origin, NOW);
        await fixture.stores.employments.update(transaction, employment.snapshot(), state.version);
      });
    };

    await employed('P-6', false);
    await employed('P-7', true);

    const filled = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assignments.countInForce(transaction, positionId, unitId, JUNE),
    );

    // Two assignments exist; one belongs to somebody who has left, and a filled headcount that
    // counted them would report a department as staffed while it advertised the vacancy.
    expect(filled).toBe(1);
  });

  it('refuses a reporting line to itself, at the database as well as in the domain', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-8');
    const employmentId = await anEmployment(personId);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into employment_reporting_line
             (tenant_id, employment_id, manager_employment_id, line_type, effective_from,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $2, 'primary', now(), now(), 't', now(), 't', 1)`,
          [TENANT_A, employmentId],
        ),
      ),
    ).rejects.toThrow(/employment_reporting_line_not_self_check/);
  });

  it('refuses a probation outcome of "failed": that ends the employment instead', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-9');
    const employmentId = await anEmployment(personId);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into employment_contract
             (tenant_id, employment_id, contract_type_code, start_date, probation_outcome,
              effective_from, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'fixed-term', '2026-01-15', 'failed', now(), now(), 't', now(), 't', 1)`,
          [TENANT_A, employmentId],
        ),
      ),
    ).rejects.toThrow(/employment_contract_outcome_check/);
  });

  it('round-trips a contract, including the terms it records and never computes', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-10');
    const employmentId = await anEmployment(personId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const contract = EmploymentContract.record(
        {
          tenantId: TENANT_A,
          employmentId,
          contractTypeCode: 'fixed-term',
          startDate: '2026-01-15',
          probationEndDate: '2026-04-15',
          noticePeriodDays: 30,
          workingHoursPerWeek: 40,
          documentReference: 'doc:contract:1',
          effectiveFrom: JANUARY,
        },
        origin,
        NOW,
      );

      if (!contract.ok) throw new Error('fixture');
      await fixture.stores.contracts.insert(transaction, contract.value.snapshot());
    });

    const [read] = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.contracts.forEmployment(transaction, employmentId),
    );

    expect(read?.probationEndDate).toBe('2026-04-15');
    expect(read?.probationOutcome).toBe('pending');
    expect(read?.noticePeriodDays).toBe(30);
    expect(read?.workingHoursPerWeek).toBe(40);
  });

  it('refuses to overwrite a row somebody else changed', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-11');
    const employmentId = await anEmployment(personId);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.employments.byId(transaction, employmentId);

        if (state === undefined) throw new Error('fixture');
        // The caller read version 1; something else has since written version 2.
        await fixture.stores.employments.update(transaction, state, state.version + 5);
      }),
    ).rejects.toThrow();
  });

  it('appends status history and never offers a way to change it', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-12');
    const employmentId = await anEmployment(personId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.statusHistory.insert(
        transaction,
        statusRecord(
          {
            tenantId: TENANT_A,
            employmentId,
            toStatus: 'draft',
            effectiveFrom: JANUARY,
            recordedBy: 'user:hr',
          },
          NOW,
        ),
      ),
    );

    const history = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.statusHistory.forEmployment(transaction, employmentId),
    );

    expect(history).toHaveLength(1);
    expect(history[0]?.recordedBy).toBe('user:hr');
    expect('update' in fixture.stores.statusHistory).toBe(false);
  });

  it('reads a reporting line back with both ends and its period', async () => {
    const personA = await fixture.seedPerson(TENANT_A, 'P-13');
    const personB = await fixture.seedPerson(TENANT_A, 'P-14');
    const employmentId = await anEmployment(personA);
    const managerId = await anEmployment(personB);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const line = ReportingLine.create(
        {
          tenantId: TENANT_A,
          employmentId,
          managerEmploymentId: managerId,
          lineType: 'primary',
          effectiveFrom: JANUARY,
        },
        origin,
        NOW,
      );

      if (!line.ok) throw new Error('fixture');
      await fixture.stores.reportingLines.insert(transaction, line.value.snapshot());
    });

    const [read] = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reportingLines.forEmployment(transaction, employmentId),
    );

    expect(read?.managerEmploymentId).toBe(managerId);
    expect(read?.effectiveTo).toBeUndefined();
  });
});
