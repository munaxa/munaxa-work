import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  checkedCivilDate,
  checkedDocumentReference,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  checkedText,
  type Metadata,
} from './recruitment-aggregate.js';
import { RecruitmentEvents } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import { OFFER_TRANSITIONS, type OfferStatus } from './recruitment-vocabulary.js';

/**
 * An Offer: what was proposed to a candidate, and what they said.
 *
 * **Versioned, never edited.** A renegotiated offer is version 2 and version 1 survives, because
 * "what did we actually offer them, and what did they accept" is a question asked in a dispute long
 * after the terms changed. At most one version is live at a time — a candidate holding two open
 * offers for one job has two answers to which terms bind.
 *
 * **The compensation is opaque** (A-5). Recruitment records what a recruiter proposed and performs
 * no arithmetic on it: no salary structure, no payroll calculation, no statutory deduction.
 * Compensation (Phase 10) is authoritative for what somebody is actually paid. Storing the proposal
 * as authored is also what keeps an accepted offer reconstructable after Compensation's
 * configuration changes — a resolved reference would re-resolve to next year's numbers.
 *
 * **An Offer is not an employment contract** (AD-006). The contract is Employment's, written after
 * the hire from terms a human confirms. Merging the two would make a proposal that was never
 * accepted look like an agreement.
 */

export interface OfferState {
  readonly id: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly offerNumber: string;
  /** The offer's own version, not the row's. */
  readonly offerVersion: number;
  readonly status: OfferStatus;
  readonly proposedStartDate: string;
  readonly expiresOn?: string;
  readonly proposedPositionId?: string;
  readonly proposedUnitId?: string;
  readonly proposedEmploymentTypeCode?: string;
  /** Stored, returned and never interpreted. No rule in this module reads a key. */
  readonly proposedCompensation: Metadata;
  readonly currencyCode?: string;
  readonly decisionNote?: string;
  readonly issuedAt?: Date;
  readonly decidedAt?: Date;
  readonly decidedBy?: string;
  readonly documentReference?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DraftOffer {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly offerNumber: string;
  readonly offerVersion: number;
  readonly proposedStartDate: string;
  readonly expiresOn?: string;
  readonly proposedPositionId?: string;
  readonly proposedUnitId?: string;
  readonly proposedEmploymentTypeCode?: string;
  readonly proposedCompensation?: Metadata;
  readonly currencyCode?: string;
  readonly documentReference?: string;
  readonly metadata?: Metadata;
}

const NOTE_LIMIT = 1024;

export class Offer extends RecruitmentAggregate {
  private constructor(private state: OfferState) {
    super(state.id, state.tenantId, state.version, 'Offer');
  }

  public static draft(
    request: DraftOffer,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Offer> {
    const checked = checkedOffer(request);

    if (!checked.ok) return checked;

    const offer = new Offer({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      applicationId: request.applicationId,
      offerNumber: request.offerNumber,
      offerVersion: request.offerVersion,
      status: 'draft',
      ...checked.value,
      version: 0,
    });

    // The event carries no terms. A proposed salary in an event is a proposed salary in every
    // consumer's log.
    offer.raise(
      RecruitmentEvents.offerDrafted,
      {
        offerId: offer.id,
        applicationId: request.applicationId,
        offerVersion: request.offerVersion,
      },
      origin,
      occurredAt,
    );
    return accept(offer);
  }

  public static rehydrate(state: OfferState): Offer {
    return new Offer(state);
  }

  public get status(): OfferStatus {
    return this.state.status;
  }

  public get applicationId(): string {
    return this.state.applicationId;
  }

  public get offerVersion(): number {
    return this.state.offerVersion;
  }

  public get proposedStartDate(): string {
    return this.state.proposedStartDate;
  }

  public get proposedPositionId(): string | undefined {
    return this.state.proposedPositionId;
  }

  public get proposedUnitId(): string | undefined {
    return this.state.proposedUnitId;
  }

  public get proposedEmploymentTypeCode(): string | undefined {
    return this.state.proposedEmploymentTypeCode;
  }

  public submit(origin: EventOrigin, occurredAt: Date): RecruitmentResult<OfferStatus> {
    return this.moveTo('pending_approval', origin, occurredAt, RecruitmentEvents.offerDrafted);
  }

  /**
   * Approves or rejects the offer, naming the decider.
   *
   * The actor comes from the authenticated context and is written here, not supplied — an approval
   * a caller could attribute to somebody else is not an approval.
   */
  public decide(
    decision: 'approved' | 'rejected',
    decidedBy: string,
    note: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<OfferStatus> {
    if (this.state.status !== 'pending_approval') {
      return refuse('offer_not_awaiting_decision', { status: this.state.status });
    }

    const checkedNote = checkedText(note, 'decisionNote', NOTE_LIMIT);

    if (!checkedNote.ok) return checkedNote;

    const moved = this.moveTo(decision, origin, occurredAt, RecruitmentEvents.offerDecided);

    if (!moved.ok) return moved;

    this.state = {
      ...this.state,
      decidedAt: occurredAt,
      decidedBy,
      ...(checkedNote.value === undefined ? {} : { decisionNote: checkedNote.value }),
    };
    return accept(this.state.status);
  }

  /** Issued: the candidate now has it. Only an approved offer may be issued. */
  public issue(origin: EventOrigin, occurredAt: Date): RecruitmentResult<OfferStatus> {
    const moved = this.moveTo('issued', origin, occurredAt, RecruitmentEvents.offerIssued);

    if (!moved.ok) return moved;

    this.state = { ...this.state, issuedAt: occurredAt };
    return accept(this.state.status);
  }

  /**
   * The candidate's answer.
   *
   * Only an *issued* offer can be answered: a candidate cannot respond to terms nobody sent them,
   * and an acceptance recorded against a draft is a hire nobody offered.
   */
  public recordResponse(
    response: 'accepted' | 'declined',
    note: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<OfferStatus> {
    if (this.state.status !== 'issued') {
      return refuse('offer_not_issued', { status: this.state.status });
    }

    const checkedNote = checkedText(note, 'decisionNote', NOTE_LIMIT);

    if (!checkedNote.ok) return checkedNote;

    const moved = this.moveTo(
      response,
      origin,
      occurredAt,
      response === 'accepted' ? RecruitmentEvents.offerAccepted : RecruitmentEvents.offerDeclined,
    );

    if (!moved.ok) return moved;

    this.state = {
      ...this.state,
      ...(checkedNote.value === undefined ? {} : { decisionNote: checkedNote.value }),
    };
    return accept(this.state.status);
  }

  public withdraw(origin: EventOrigin, occurredAt: Date): RecruitmentResult<OfferStatus> {
    return this.moveTo('withdrawn', origin, occurredAt, RecruitmentEvents.offerDecided);
  }

  /** An offer nobody answered before its expiry. Idempotent, so a sweep may run repeatedly. */
  public expire(origin: EventOrigin, occurredAt: Date): RecruitmentResult<OfferStatus> {
    if (this.state.status !== 'issued') return refuse('offer_not_issued');
    return this.moveTo('expired', origin, occurredAt, RecruitmentEvents.offerDecided);
  }

  public snapshot(): OfferState {
    return { ...this.state, version: this.version };
  }

  private moveTo(
    status: OfferStatus,
    origin: EventOrigin,
    occurredAt: Date,
    eventName: (typeof RecruitmentEvents)[keyof typeof RecruitmentEvents],
  ): RecruitmentResult<OfferStatus> {
    if (!OFFER_TRANSITIONS[this.state.status].includes(status)) {
      return refuse('offer_transition_not_permitted', { from: this.state.status, to: status });
    }

    const from = this.state.status;

    this.state = { ...this.state, status };
    this.raise(
      eventName,
      {
        offerId: this.id,
        applicationId: this.state.applicationId,
        offerVersion: this.state.offerVersion,
        from,
        to: status,
      },
      origin,
      occurredAt,
    );
    return accept(status);
  }
}

type CheckedOffer = Omit<
  OfferState,
  'id' | 'tenantId' | 'applicationId' | 'offerNumber' | 'offerVersion' | 'status' | 'version'
>;

/**
 * The creation checks, hoisted so `draft` stays inside the function budget — and split in two so
 * each half stays inside the complexity budget as well.
 */
const checkedOffer = (request: DraftOffer): RecruitmentResult<CheckedOffer> => {
  const dates = checkedOfferDates(request);

  if (!dates.ok) return dates;

  const payload = checkedOfferPayload(request);

  if (!payload.ok) return payload;

  return accept({
    ...dates.value,
    ...payload.value,
    ...(request.proposedPositionId === undefined
      ? {}
      : { proposedPositionId: request.proposedPositionId }),
    ...(request.proposedUnitId === undefined ? {} : { proposedUnitId: request.proposedUnitId }),
  });
};

/** When it starts, when it lapses, and what kind of employment it proposes. */
const checkedOfferDates = (
  request: DraftOffer,
): RecruitmentResult<
  Pick<CheckedOffer, 'proposedStartDate' | 'expiresOn' | 'proposedEmploymentTypeCode'>
> => {
  const proposedStartDate = checkedCivilDate(request.proposedStartDate, 'proposedStartDate');

  if (!proposedStartDate.ok) return proposedStartDate;

  const expiresOn = checkedOptionalCivilDate(request.expiresOn, 'expiresOn');

  if (!expiresOn.ok) return expiresOn;

  const employmentTypeCode = checkedOptionalCode(
    request.proposedEmploymentTypeCode,
    'proposedEmploymentTypeCode',
  );

  if (!employmentTypeCode.ok) return employmentTypeCode;

  return accept({
    proposedStartDate: proposedStartDate.value,
    ...(expiresOn.value === undefined ? {} : { expiresOn: expiresOn.value }),
    ...(employmentTypeCode.value === undefined
      ? {}
      : { proposedEmploymentTypeCode: employmentTypeCode.value }),
  });
};

/** What it proposes to pay — checked as a shape and never interpreted (A-5) — and its paperwork. */
const checkedOfferPayload = (
  request: DraftOffer,
): RecruitmentResult<
  Pick<CheckedOffer, 'proposedCompensation' | 'currencyCode' | 'documentReference' | 'metadata'>
> => {
  const currencyCode = checkedCurrency(request.currencyCode);

  if (!currencyCode.ok) return currencyCode;

  const compensation = checkedMetadata(request.proposedCompensation);

  if (!compensation.ok) return compensation;

  const documentReference = checkedDocumentReference(request.documentReference);

  if (!documentReference.ok) return documentReference;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    proposedCompensation: compensation.value,
    ...(currencyCode.value === undefined ? {} : { currencyCode: currencyCode.value }),
    ...(documentReference.value === undefined
      ? {}
      : { documentReference: documentReference.value }),
    metadata: metadata.value,
  });
};

/**
 * ISO 4217, validated as a *shape* and never against a list.
 *
 * The same rule Organization applies to a country code: a hardcoded list of currencies is a code
 * change every time the product sells somewhere new (00B). Nothing here attaches meaning to the
 * value — it is stored beside a proposal this module never computes with.
 */
const checkedCurrency = (value: string | undefined): RecruitmentResult<string | undefined> => {
  if (value === undefined) return accept(undefined);
  return /^[A-Z]{3}$/.test(value) ? accept(value) : refuse('currency_code_malformed');
};
