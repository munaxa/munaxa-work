import { auditForInsert } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { NumberSequenceStore, RecruitmentStores } from '../application/recruitment-ports.js';

import { ApplicationEventRepository, ApplicationRepository } from './application.repository.js';
import { CandidateRepository, ProfileEntryRepository } from './candidate.repository.js';
import { FeedbackRepository, InterviewRepository } from './interview.repository.js';
import { OfferRepository } from './offer.repository.js';
import { RequisitionDecisionRepository, RequisitionRepository } from './requisition.repository.js';
import { VacancyRepository } from './vacancy.repository.js';

/**
 * The PostgreSQL implementation of every store the application declares.
 *
 * Assembled at the bottom of this file so the composition root wires one thing rather than eleven,
 * and so that swapping an implementation is one edit rather than a search.
 */

/**
 * Recruitment's own counter (A-8).
 *
 * `insert ... on conflict do update` returning the new value is one statement that both creates the
 * tenant's series on first use and takes the row lock the increment needs — so two concurrent
 * creates serialize on the row rather than racing, and neither can receive a number the other
 * already has.
 *
 * Deliberately not a PostgreSQL sequence, and deliberately not Employment's: a sequence is neither
 * tenant-scoped nor transactional, so a create that rolled back would burn a number and leave a gap
 * nobody could explain; and a shared counter would mean a customer auditing their requisition
 * numbers found gaps explained by hires (ADR-0039).
 */
class NumberSequenceRepository implements NumberSequenceStore {
  public async allocate(transaction: Transaction, seriesKey: string): Promise<number> {
    // The actor and the instant come from `auditForInsert`, which reads the authenticated context —
    // the same source every other audit column in the product is written from.
    const audit = auditForInsert(new Date());
    const rows = await transaction.execute<{ next_value: number | string }>(
      `insert into recruitment_number_sequence
         (tenant_id, series_key, next_value, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 2, $3, $4, $3, $4, 1)
       on conflict (tenant_id, series_key) where deleted_at is null
       do update set next_value = recruitment_number_sequence.next_value + 1,
                     updated_at = $3,
                     updated_by = $4,
                     version = recruitment_number_sequence.version + 1
       returning next_value`,
      [transaction.tenantId, seriesKey, audit.updated_at, audit.updated_by],
    );
    const allocated = rows[0]?.next_value;

    if (allocated === undefined) {
      throw new Error('The recruitment number sequence returned no value.');
    }
    // The row holds the *next* value, so the number just allocated is one less. Returning the stored
    // value instead would skip the first number of every series.
    return Number(allocated) - 1;
  }
}

export const postgresRecruitmentStores = (): RecruitmentStores => ({
  requisitions: new RequisitionRepository(),
  decisions: new RequisitionDecisionRepository(),
  vacancies: new VacancyRepository(),
  candidates: new CandidateRepository(),
  profileEntries: new ProfileEntryRepository(),
  applications: new ApplicationRepository(),
  applicationEvents: new ApplicationEventRepository(),
  interviews: new InterviewRepository(),
  feedback: new FeedbackRepository(),
  offers: new OfferRepository(),
  numbers: new NumberSequenceRepository(),
});
