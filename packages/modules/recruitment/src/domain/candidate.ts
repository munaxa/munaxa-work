import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  RecruitmentAggregate,
  bilingualFrom,
  checkedCode,
  checkedEmail,
  checkedMetadata,
  checkedOptionalTelephone,
  type BilingualText,
  type Metadata,
} from './recruitment-aggregate.js';
import { RecruitmentEvents } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import type { CandidateStatus } from './recruitment-vocabulary.js';

/**
 * A Candidate: somebody outside the company who might join it.
 *
 * **A candidate is not a Person, and this aggregate exists to keep that true.** Applying creates no
 * Person: a speculative applicant who is never contacted leaves no trace in the master registry of
 * human identity, because they are not one of the tenant's people. Only at hire does Recruitment
 * resolve a Person, through People's own application service, and write `personId` here exactly
 * once (ADR-0044).
 *
 * **What this aggregate deliberately has no field for**, and the absence is the decision: no
 * national identifier, no passport number, no date of birth, no nationality, no photograph. Those
 * are collected at hire by the module built to protect them — nine tested mechanisms and a keyed
 * digest (ADR-0038). A candidate who is never hired gives this product none of them, which is the
 * strongest privacy guarantee available: not holding the data.
 *
 * What it does hold is what recruiting actually needs: a name, a way to make contact, where they
 * came from, and what they say about themselves.
 */

export interface CandidateState {
  readonly id: string;
  readonly tenantId: string;
  readonly candidateNumber: string;
  readonly status: CandidateStatus;
  readonly displayName: BilingualText;
  /** Normalized — lower-cased and trimmed. This is what matching compares. */
  readonly email: string;
  readonly phone?: string;
  /** As entered, so a screen shows the customer their own formatting back. */
  readonly displayEmail: string;
  readonly sourceCode: string;
  /** The Person this candidate turned out to be. Null until hire, then written exactly once. */
  readonly personId?: string;
  /** Set when personal data has been anonymized under a retention policy. The row survives. */
  readonly anonymizedAt?: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CreateCandidate {
  readonly tenantId: string;
  readonly candidateNumber: string;
  readonly displayName: Readonly<Record<string, string>>;
  readonly email: string;
  readonly phone?: string;
  readonly sourceCode: string;
  /** Set when a recruiter explicitly links a known Person — an internal applicant, or a returner. */
  readonly personId?: string;
  readonly metadata?: Metadata;
}

export class Candidate extends RecruitmentAggregate {
  private constructor(private state: CandidateState) {
    super(state.id, state.tenantId, state.version, 'Candidate');
  }

  public static create(
    request: CreateCandidate,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<Candidate> {
    const checked = checkedCandidate(request);

    if (!checked.ok) return checked;

    const candidate = new Candidate({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      candidateNumber: request.candidateNumber,
      status: 'active',
      ...checked.value,
      ...(request.personId === undefined ? {} : { personId: request.personId }),
      version: 0,
    });

    // The event names the candidate and nothing about them. An address in an event is an address in
    // every consumer's log, forever.
    candidate.raise(
      RecruitmentEvents.candidateCreated,
      { candidateId: candidate.id, sourceCode: checked.value.sourceCode },
      origin,
      occurredAt,
    );
    return accept(candidate);
  }

  public static rehydrate(state: CandidateState): Candidate {
    return new Candidate(state);
  }

  public get status(): CandidateStatus {
    return this.state.status;
  }

  public get personId(): string | undefined {
    return this.state.personId;
  }

  public get isAnonymized(): boolean {
    return this.state.anonymizedAt !== undefined;
  }

  public amend(
    request: {
      readonly displayName?: Readonly<Record<string, string>>;
      readonly email?: string;
      readonly phone?: string;
      readonly sourceCode?: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<CandidateState> {
    if (this.isAnonymized) return refuse('candidate_anonymized');

    const changes = checkedAmendment(request);

    if (!changes.ok) return changes;

    this.state = { ...this.state, ...changes.value };
    this.raise(
      RecruitmentEvents.candidateCreated,
      { candidateId: this.id, amended: Object.keys(changes.value) },
      origin,
      occurredAt,
    );
    return accept(this.state);
  }

  /**
   * Links this candidate to the Person they turned out to be.
   *
   * **Write-once.** A candidate already linked refuses a second link rather than repointing, which
   * is what makes a retried hire converge instead of moving somebody's career onto a different
   * human being. The database says the same thing with a unique index, so two requests racing lose
   * one of them rather than both winning.
   */
  public linkToPerson(
    personId: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): RecruitmentResult<string> {
    if (this.state.personId !== undefined) {
      return this.state.personId === personId
        ? // Idempotent by design: the retry that re-links the same person is the safe path through
          // a partially completed hire, not an error.
          accept(this.state.personId)
        : refuse('candidate_already_linked');
    }

    this.state = { ...this.state, personId };
    this.raise(
      RecruitmentEvents.candidateLinkedToPerson,
      { candidateId: this.id, personId },
      origin,
      occurredAt,
    );
    return accept(personId);
  }

  public markHired(origin: EventOrigin, occurredAt: Date): RecruitmentResult<CandidateStatus> {
    if (this.state.personId === undefined) return refuse('candidate_not_linked_to_person');

    this.state = { ...this.state, status: 'hired' };
    this.raise(
      RecruitmentEvents.candidateStatusChanged,
      { candidateId: this.id, status: 'hired' },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public archive(origin: EventOrigin, occurredAt: Date): RecruitmentResult<CandidateStatus> {
    if (this.state.status === 'hired') return refuse('candidate_hired');

    this.state = { ...this.state, status: 'archived' };
    this.raise(
      RecruitmentEvents.candidateStatusChanged,
      { candidateId: this.id, status: 'archived' },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /**
   * Removes the candidate's personal data, keeping the record that they existed.
   *
   * The minimum data-lifecycle mechanism the approved scope calls for, and the shape it insists on:
   * **nothing is physically deleted**. The row survives so that applications, interviews and offers
   * still resolve and the audit trail still reads; what goes is the name, the address and the
   * telephone number — the parts that identify a human being.
   *
   * It invents no retention period. *When* this is applied is a policy question a country pack and
   * the future GRC phase own; this is only the operation they will drive.
   *
   * A hired candidate is refused: their identity is the Person's now, and erasing the link would
   * orphan an employment from the recruitment that produced it.
   */
  public anonymize(origin: EventOrigin, occurredAt: Date): RecruitmentResult<Date> {
    if (this.state.status === 'hired') return refuse('candidate_hired');
    if (this.isAnonymized) return refuse('candidate_already_anonymized');

    // The telephone number is dropped rather than blanked: an empty string is a value somebody
    // later mistakes for one, and an absent column is unambiguous.
    const { phone: _erased, ...retained } = this.state;

    this.state = {
      ...retained,
      displayName: { en: 'Redacted', ar: 'محذوف' },
      email: `redacted+${this.id}@invalid`,
      displayEmail: 'redacted',
      metadata: {},
      anonymizedAt: occurredAt,
    };
    this.raise(
      RecruitmentEvents.candidateAnonymized,
      { candidateId: this.id, anonymizedAt: occurredAt },
      origin,
      occurredAt,
    );
    return accept(occurredAt);
  }

  public snapshot(): CandidateState {
    return { ...this.state, version: this.version };
  }
}

const checkedCandidate = (
  request: CreateCandidate,
): RecruitmentResult<{
  readonly displayName: BilingualText;
  readonly email: string;
  readonly displayEmail: string;
  readonly phone?: string;
  readonly sourceCode: string;
  readonly metadata: Metadata;
}> => {
  const displayName = bilingualFrom(request.displayName, 'displayName');

  if (!displayName.ok) return displayName;

  const email = checkedEmail(request.email);

  if (!email.ok) return email;

  const phone = checkedOptionalTelephone(request.phone);

  if (!phone.ok) return phone;

  const sourceCode = checkedCode(request.sourceCode, 'sourceCode');

  if (!sourceCode.ok) return sourceCode;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({
    displayName: displayName.value,
    email: email.value.normalized,
    displayEmail: email.value.display,
    ...(phone.value === undefined ? {} : { phone: phone.value }),
    sourceCode: sourceCode.value,
    metadata: metadata.value,
  });
};

const checkedAmendment = (request: {
  readonly displayName?: Readonly<Record<string, string>>;
  readonly email?: string;
  readonly phone?: string;
  readonly sourceCode?: string;
}): RecruitmentResult<Partial<CandidateState>> => {
  const changes: Record<string, unknown> = {};

  if (request.displayName !== undefined) {
    const displayName = bilingualFrom(request.displayName, 'displayName');

    if (!displayName.ok) return displayName;
    changes['displayName'] = displayName.value;
  }
  if (request.email !== undefined) {
    const email = checkedEmail(request.email);

    if (!email.ok) return email;
    changes['email'] = email.value.normalized;
    changes['displayEmail'] = email.value.display;
  }
  if (request.phone !== undefined) {
    const phone = checkedOptionalTelephone(request.phone);

    if (!phone.ok) return phone;
    changes['phone'] = phone.value;
  }
  if (request.sourceCode !== undefined) {
    const sourceCode = checkedCode(request.sourceCode, 'sourceCode');

    if (!sourceCode.ok) return sourceCode;
    changes['sourceCode'] = sourceCode.value;
  }
  return accept(changes as Partial<CandidateState>);
};
