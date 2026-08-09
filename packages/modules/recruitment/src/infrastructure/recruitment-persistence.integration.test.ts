import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Application } from '../domain/application.js';
import { Candidate } from '../domain/candidate.js';
import { Offer } from '../domain/offer.js';
import { Requisition } from '../domain/requisition.js';
import { Vacancy } from '../domain/vacancy.js';

import {
  CONNECTION,
  TENANT_A,
  openRecruitmentFixture,
  requireDatabaseInCi,
  type RecruitmentFixture,
} from './recruitment-database.fixture.js';

/**
 * The repositories, the constraints and the counter, against a real PostgreSQL.
 *
 * What is checked here is the database's half of the design and nothing else: the partial unique
 * indexes that make the domain's refusals deterministic under a race, the check constraints that
 * refuse an unexplained rejection, the date columns that must survive a round trip on a server west
 * of UTC, and the counter two concurrent creates serialize on. Every rule that lives in the domain
 * is tested against fakes, in milliseconds, elsewhere.
 */

const origin = { tenantId: TENANT_A, correlationId: 'test', actor: 'user:test' };
const NOW = new Date('2026-08-09T09:00:00Z');

requireDatabaseInCi('Recruitment persistence');

describe.skipIf(CONNECTION === undefined)('Recruitment persistence', () => {
  let fixture: RecruitmentFixture;

  beforeAll(async () => {
    fixture = await openRecruitmentFixture('recruitment_fixture_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const aRequisition = async (headcountRequested = 1): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const number = await fixture.stores.numbers.allocate(transaction, 'requisition:2026');
      const created = Requisition.create(
        {
          tenantId: TENANT_A,
          requisitionNumber: `REQ-2026-${String(number).padStart(6, '0')}`,
          positionId: uuidV7(),
          unitId: uuidV7(),
          headcountRequested,
          reasonCode: 'growth',
          requestedByEmploymentId: uuidV7(),
          targetStartDate: '2026-11-01',
        },
        origin,
        NOW,
      );

      if (!created.ok) throw new Error(`fixture: ${created.error.reason}`);
      await fixture.stores.requisitions.insert(transaction, created.value.snapshot());
      return created.value.id;
    });

  const aVacancy = async (requisitionId: string): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const opened = Vacancy.open(
        {
          tenantId: TENANT_A,
          requisitionId,
          title: { en: 'Field engineer', ar: 'مهندس ميداني' },
          channels: ['careers-site'],
          openedOn: '2026-09-01',
        },
        origin,
        NOW,
      );

      if (!opened.ok) throw new Error(`fixture: ${opened.error.reason}`);
      await fixture.stores.vacancies.insert(transaction, opened.value.snapshot());
      return opened.value.id;
    });

  const aCandidate = async (email: string, personId?: string): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const number = await fixture.stores.numbers.allocate(transaction, 'candidate:2026');
      const created = Candidate.create(
        {
          tenantId: TENANT_A,
          candidateNumber: `CAN-2026-${String(number).padStart(6, '0')}`,
          displayName: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' },
          email,
          phone: '+966501234567',
          sourceCode: 'referral',
          ...(personId === undefined ? {} : { personId }),
        },
        origin,
        NOW,
      );

      if (!created.ok) throw new Error(`fixture: ${created.error.reason}`);
      await fixture.stores.candidates.insert(transaction, created.value.snapshot());
      return created.value.id;
    });

  const anApplication = async (candidateId: string, vacancyId: string): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const number = await fixture.stores.numbers.allocate(transaction, 'application:2026');
      const submitted = Application.submit(
        {
          tenantId: TENANT_A,
          applicationNumber: `APP-2026-${String(number).padStart(6, '0')}`,
          candidateId,
          vacancyId,
          sourceCode: 'careers-site',
          appliedOn: '2026-09-04',
        },
        origin,
        NOW,
      );

      if (!submitted.ok) throw new Error(`fixture: ${submitted.error.reason}`);
      await fixture.stores.applications.insert(transaction, submitted.value.snapshot());
      return submitted.value.id;
    });

  it('round-trips a requisition, keeping its civil date as the date that was stored', async () => {
    const requisitionId = await aRequisition(2);
    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requisitions.byId(transaction, requisitionId),
    );

    expect(read?.targetStartDate).toBe('2026-11-01');
    expect(read?.headcountRequested).toBe(2);
    expect(read?.headcountFilled).toBe(0);
  });

  it('round-trips a vacancy’s bilingual title and its channel array', async () => {
    const vacancyId = await aVacancy(await aRequisition());
    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.vacancies.byId(transaction, vacancyId),
    );

    expect(read?.title).toStrictEqual({ en: 'Field engineer', ar: 'مهندس ميداني' });
    expect(read?.channels).toStrictEqual(['careers-site']);
    expect(read?.openedOn).toBe('2026-09-01');
  });

  it('refuses more hires than the requisition authorized, in the database as well', async () => {
    const requisitionId = await aRequisition(1);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.requisitions.byId(transaction, requisitionId);

        if (state === undefined) throw new Error('fixture: no requisition');
        // Past what the aggregate would allow, straight at the constraint: this asserts the
        // database refuses it too, which is what protects a concurrent pair of hires.
        await fixture.stores.requisitions.update(
          transaction,
          { ...state, headcountFilled: 2 },
          state.version,
        );
      }),
    ).rejects.toThrow();
  });

  it('refuses a second candidate for one Person', async () => {
    const personId = await fixture.seedPerson(TENANT_A);

    await aCandidate('first@example.com', personId);
    await expect(aCandidate('second@example.com', personId)).rejects.toThrow();
  });

  it('refuses a second application for one candidate and vacancy', async () => {
    const vacancyId = await aVacancy(await aRequisition());
    const candidateId = await aCandidate('applicant@example.com');

    await anApplication(candidateId, vacancyId);
    await expect(anApplication(candidateId, vacancyId)).rejects.toThrow();
  });

  it('refuses a rejection with no reason', async () => {
    const vacancyId = await aVacancy(await aRequisition());
    const candidateId = await aCandidate('rejected@example.com');
    const applicationId = await anApplication(candidateId, vacancyId);

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.applications.byId(transaction, applicationId);

        if (state === undefined) throw new Error('fixture: no application');
        await fixture.stores.applications.update(
          transaction,
          { ...state, status: 'rejected' },
          state.version,
        );
      }),
    ).rejects.toThrow();
  });

  it('refuses a second live offer for one application', async () => {
    const vacancyId = await aVacancy(await aRequisition());
    const candidateId = await aCandidate('offered@example.com');
    const applicationId = await anApplication(candidateId, vacancyId);

    const issue = (offerVersion: number): Promise<void> =>
      fixture.asTenant(TENANT_A, async (transaction) => {
        const drafted = Offer.draft(
          {
            tenantId: TENANT_A,
            applicationId,
            offerNumber: `OFR-2026-00000${String(offerVersion)}`,
            offerVersion,
            proposedStartDate: '2026-11-01',
            proposedCompensation: { base: '18000' },
          },
          origin,
          NOW,
        );

        if (!drafted.ok) throw new Error(`fixture: ${drafted.error.reason}`);

        const offer = drafted.value;

        offer.submit(origin, NOW);
        offer.decide('approved', 'user:test', undefined, origin, NOW);
        offer.issue(origin, NOW);
        await fixture.stores.offers.insert(transaction, offer.snapshot());
      });

    await issue(1);
    await expect(issue(2)).rejects.toThrow();
  });

  it('serializes two concurrent number allocations rather than issuing one number twice', async () => {
    const allocate = (): Promise<number> =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.numbers.allocate(transaction, 'requisition:2026'),
      );
    const allocated = await Promise.all([allocate(), allocate(), allocate()]);

    expect(new Set(allocated).size).toBe(3);
  });

  it('counts a pipeline by status in the database', async () => {
    const vacancyId = await aVacancy(await aRequisition());

    for (const address of ['one@example.com', 'two@example.com']) {
      const candidateId = await aCandidate(address);

      await anApplication(candidateId, vacancyId);
    }

    const counts = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.applications.countByStatus(transaction, vacancyId),
    );

    expect(counts['received']).toBe(2);
  });
});
