import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Candidate } from './candidate.js';
import { Offer } from './offer.js';
import { Requisition } from './requisition.js';
import { isOfferLive, isRequisitionOpen } from './recruitment-vocabulary.js';

/**
 * The rules the aggregates enforce on their own, tested without a pipeline.
 *
 * These are the refusals that must hold however the caller reaches them: a headcount that cannot be
 * exceeded, a link that cannot be repointed, an offer that cannot be answered before it is sent.
 * Testing them here as well as through the use cases is deliberate — a rule that only holds in the
 * handler is a rule the next handler will not have.
 */

const ORIGIN = { tenantId: uuidV7(), correlationId: uuidV7(), actor: 'user:test' };
const NOW = new Date('2026-08-09T09:00:00Z');

const aRequisition = (headcountRequested = 1): Requisition => {
  const created = Requisition.create(
    {
      tenantId: ORIGIN.tenantId,
      requisitionNumber: 'REQ-2026-000001',
      positionId: uuidV7(),
      unitId: uuidV7(),
      headcountRequested,
      reasonCode: 'growth',
      requestedByEmploymentId: uuidV7(),
    },
    ORIGIN,
    NOW,
  );

  if (!created.ok) throw new Error('expected a requisition');
  return created.value;
};

const anApprovedRequisition = (headcountRequested = 1): Requisition => {
  const requisition = aRequisition(headcountRequested);

  requisition.submit(ORIGIN, NOW);
  requisition.decide('approved', ORIGIN, NOW);
  return requisition;
};

describe('a requisition', () => {
  it('refuses a headcount that is not a whole number of people', () => {
    const created = Requisition.create(
      {
        tenantId: ORIGIN.tenantId,
        requisitionNumber: 'REQ-2026-000001',
        positionId: uuidV7(),
        unitId: uuidV7(),
        headcountRequested: 0,
        reasonCode: 'growth',
        requestedByEmploymentId: uuidV7(),
      },
      ORIGIN,
      NOW,
    );

    expect(created.ok).toBe(false);
  });

  it('refuses a hire beyond the headcount it authorized', () => {
    const requisition = anApprovedRequisition(1);

    expect(requisition.recordHire().ok).toBe(true);
    expect(requisition.recordHire().ok).toBe(false);
  });

  it('cannot be approved twice without a reversal in between', () => {
    const requisition = anApprovedRequisition();

    expect(requisition.decide('approved', ORIGIN, NOW).ok).toBe(false);
  });

  it('treats approved and open alike for the purpose of recruiting against it', () => {
    expect(isRequisitionOpen('approved')).toBe(true);
    expect(isRequisitionOpen('open')).toBe(true);
    expect(isRequisitionOpen('pending_approval')).toBe(false);
    expect(isRequisitionOpen('cancelled')).toBe(false);
  });
});

const aCandidate = (): Candidate => {
  const created = Candidate.create(
    {
      tenantId: ORIGIN.tenantId,
      candidateNumber: 'CAN-2026-000001',
      displayName: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' },
      email: '  Noura@Example.com ',
      sourceCode: 'referral',
    },
    ORIGIN,
    NOW,
  );

  if (!created.ok) throw new Error('expected a candidate');
  return created.value;
};

describe('a candidate', () => {
  it('normalizes the address it matches on and keeps the one that was typed', () => {
    const state = aCandidate().snapshot();

    expect(state.email).toBe('noura@example.com');
    expect(state.displayEmail).toBe('Noura@Example.com');
  });

  it('refuses a name in only one language', () => {
    const created = Candidate.create(
      {
        tenantId: ORIGIN.tenantId,
        candidateNumber: 'CAN-2026-000002',
        displayName: { en: 'Noura Al-Fahad' },
        email: 'noura@example.com',
        sourceCode: 'referral',
      },
      ORIGIN,
      NOW,
    );

    expect(created.ok).toBe(false);
  });

  it('links to a Person once and refuses to be repointed at another', () => {
    const candidate = aCandidate();
    const person = uuidV7();

    expect(candidate.linkToPerson(person, ORIGIN, NOW).ok).toBe(true);
    // Idempotent for the same person — the retry path — and refused for a different one.
    expect(candidate.linkToPerson(person, ORIGIN, NOW).ok).toBe(true);
    expect(candidate.linkToPerson(uuidV7(), ORIGIN, NOW).ok).toBe(false);
  });

  it('erases the personal data without deleting the record', () => {
    const candidate = aCandidate();

    expect(candidate.anonymize(ORIGIN, NOW).ok).toBe(true);

    const state = candidate.snapshot();

    expect(state.displayName.en).toBe('Redacted');
    expect(state.phone).toBeUndefined();
    expect(state.anonymizedAt).toStrictEqual(NOW);
    expect(state.candidateNumber).toBe('CAN-2026-000001');
  });

  it('refuses to erase somebody who was hired', () => {
    const candidate = aCandidate();

    // A hire is only recordable once the candidate resolves to a Person — the same order the saga
    // takes, and the reason erasing one afterwards would orphan an employment.
    candidate.linkToPerson(uuidV7(), ORIGIN, NOW);
    expect(candidate.markHired(ORIGIN, NOW).ok).toBe(true);
    expect(candidate.anonymize(ORIGIN, NOW).ok).toBe(false);
  });
});

const anOffer = (): Offer => {
  const drafted = Offer.draft(
    {
      tenantId: ORIGIN.tenantId,
      applicationId: uuidV7(),
      offerNumber: 'OFR-2026-000001',
      offerVersion: 1,
      proposedStartDate: '2026-11-01',
      proposedCompensation: { base: '18000' },
    },
    ORIGIN,
    NOW,
  );

  if (!drafted.ok) throw new Error('expected an offer');
  return drafted.value;
};

describe('an offer', () => {
  it('cannot be answered before it is issued', () => {
    const offer = anOffer();

    expect(offer.recordResponse('accepted', undefined, ORIGIN, NOW).ok).toBe(false);
  });

  it('cannot be issued before it is approved', () => {
    const offer = anOffer();

    expect(offer.issue(ORIGIN, NOW).ok).toBe(false);
  });

  it('records the decider on the aggregate rather than taking one from a caller', () => {
    const offer = anOffer();

    offer.submit(ORIGIN, NOW);
    expect(offer.decide('approved', 'user:director', undefined, ORIGIN, NOW).ok).toBe(true);
    expect(offer.snapshot().decidedBy).toBe('user:director');
    expect(offer.snapshot().decidedAt).toStrictEqual(NOW);
  });

  it('carries no terms in the events it raises', () => {
    const offer = anOffer();
    const [event] = offer.pullEvents();

    expect(JSON.stringify(event?.payload)).not.toContain('18000');
  });

  it('knows which statuses are live, so a second issued version can be refused', () => {
    expect(isOfferLive('issued')).toBe(true);
    expect(isOfferLive('accepted')).toBe(true);
    expect(isOfferLive('declined')).toBe(false);
    expect(isOfferLive('withdrawn')).toBe(false);
  });
});

/**
 * The routed-approval identifier: written once, never rewritten.
 *
 * The column has been reserved since Phase 6 and nothing wrote it until Workflow arrived. What
 * matters now is that it records *which* approval authorized this headcount — so a second approval
 * arriving later is refused rather than allowed to take the record over, because an audit that named
 * the wrong chain would be worse than one that named none.
 */
describe('a requisition decided by a routed approval', () => {
  const submitted = (): Requisition => {
    const requisition = aRequisition();

    requisition.submit(ORIGIN, NOW);
    return requisition;
  };

  it('records the approval that decided it', () => {
    const requisition = submitted();
    const approvalId = uuidV7();
    const decided = requisition.decide('approved', ORIGIN, NOW, approvalId);

    expect(decided.ok).toBe(true);
    expect(requisition.status).toBe('approved');
    expect(requisition.approvalId).toBe(approvalId);
  });

  it('leaves the identifier absent when nobody routed the decision', () => {
    const requisition = submitted();

    requisition.decide('approved', ORIGIN, NOW);

    expect(requisition.status).toBe('approved');
    expect(requisition.approvalId).toBeUndefined();
  });

  /** A reversal returns it for a fresh decision, and the same approval may decide it again. */
  it('accepts the same approval again after a reversal', () => {
    const requisition = submitted();
    const approvalId = uuidV7();

    requisition.decide('approved', ORIGIN, NOW, approvalId);
    requisition.reverseDecision(ORIGIN, NOW);

    const again = requisition.decide('rejected', ORIGIN, NOW, approvalId);

    expect(again.ok).toBe(true);
    expect(requisition.approvalId).toBe(approvalId);
  });

  it('refuses a different approval once one has already decided it', () => {
    const requisition = submitted();
    const first = uuidV7();

    requisition.decide('approved', ORIGIN, NOW, first);
    requisition.reverseDecision(ORIGIN, NOW);

    const other = requisition.decide('approved', ORIGIN, NOW, uuidV7());

    expect(other.ok).toBe(false);
    expect(other.ok ? undefined : other.error.reason).toBe(
      'requisition_already_routed_by_another_approval',
    );
    // Untouched: the identifier the first approval wrote still stands.
    expect(requisition.approvalId).toBe(first);
  });

  /** And the lifecycle rule still comes first: an unsubmitted requisition is refused, approval or not. */
  it('still refuses a decision the lifecycle does not allow', () => {
    const requisition = aRequisition();
    const decided = requisition.decide('approved', ORIGIN, NOW, uuidV7());

    expect(decided.ok).toBe(false);
    expect(decided.ok ? undefined : decided.error.reason).toBe('requisition_not_awaiting_decision');
    expect(requisition.approvalId).toBeUndefined();
  });
});
