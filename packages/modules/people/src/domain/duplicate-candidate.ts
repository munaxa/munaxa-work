import { uuidV7, type EventOrigin } from '@work/kernel';

import { PeopleAggregate, checkedText } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import type { DuplicateStatus } from './people-vocabulary.js';
import type { MatchReason } from './duplicate-matching.js';

/**
 * Two records the system suspects are one human being, awaiting a decision.
 *
 * An aggregate of its own rather than a field on either person, because it is a fact about the
 * *pair*: putting it on one of the two would make "is this person a suspected duplicate" answerable
 * from one side and not the other, and the side it is missing from is whichever one the
 * administrator happened to open.
 *
 * The pair is stored **ordered** — the lower identifier first — so that detecting A against B and
 * later B against A produces one candidate rather than two, and the reviewer's queue does not
 * contain the same decision twice. That ordering is enforced by a unique index as well as here.
 *
 * `confirmed` records that they are the same person. It does **not** merge them: merging is a
 * separate, explicitly permissioned command, because a merge is effectively irreversible for every
 * module that has since referenced the record that loses.
 */

export interface DuplicateCandidateState {
  readonly id: string;
  readonly tenantId: string;
  /** The lower of the two identifiers, so one pair produces one row. */
  readonly personId: string;
  readonly duplicateOfPersonId: string;
  readonly reason: MatchReason;
  readonly confidence: number;
  readonly status: DuplicateStatus;
  readonly reviewedBy?: string;
  readonly reviewedAt?: Date;
  readonly reviewNote?: string;
  readonly version: number;
}

export interface SuspectDuplicate {
  readonly tenantId: string;
  readonly personId: string;
  readonly otherPersonId: string;
  readonly reason: MatchReason;
  readonly confidence: number;
}

const NOTE_LIMIT = 1024;

export class DuplicateCandidate extends PeopleAggregate {
  private constructor(private state: DuplicateCandidateState) {
    super(state.id, state.tenantId, state.version, 'DuplicateCandidate');
  }

  public static suspect(
    request: SuspectDuplicate,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<DuplicateCandidate> {
    if (request.personId === request.otherPersonId) {
      return refuse('person_cannot_duplicate_itself');
    }

    const [first, second] = orderedPair(request.personId, request.otherPersonId);

    const candidate = new DuplicateCandidate({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: first,
      duplicateOfPersonId: second,
      reason: request.reason,
      confidence: request.confidence,
      status: 'pending',
      version: 0,
    });

    candidate.raise(
      PeopleEvents.duplicateSuspected,
      {
        candidateId: candidate.id,
        personId: first,
        duplicateOfPersonId: second,
        reason: request.reason,
      },
      origin,
      occurredAt,
    );
    return accept(candidate);
  }

  public static rehydrate(state: DuplicateCandidateState): DuplicateCandidate {
    return new DuplicateCandidate(state);
  }

  public get pair(): readonly [string, string] {
    return [this.state.personId, this.state.duplicateOfPersonId];
  }

  public get currentStatus(): DuplicateStatus {
    return this.state.status;
  }

  /**
   * Records a human's decision.
   *
   * The reviewer is taken from the origin rather than from the command, for the same reason the
   * approver on an establishment is in Organization: a caller who could name their own reviewer
   * could dismiss a duplicate as somebody else.
   *
   * A decided candidate is terminal. Re-deciding would overwrite who decided and when, which is
   * the record that makes the decision auditable at all.
   */
  public review(
    decision: Exclude<DuplicateStatus, 'pending'>,
    note: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<DuplicateStatus> {
    if (this.state.status !== 'pending') {
      return refuse('duplicate_already_reviewed', { status: this.state.status });
    }

    const checkedNote = note === undefined ? undefined : checkedText(note, 'note', NOTE_LIMIT);

    if (checkedNote !== undefined && !checkedNote.ok) return checkedNote;

    this.state = {
      ...this.state,
      status: decision,
      reviewedBy: origin.actor,
      reviewedAt: occurredAt,
      ...(checkedNote === undefined ? {} : { reviewNote: checkedNote.value }),
    };
    this.raise(
      PeopleEvents.duplicateReviewed,
      { candidateId: this.id, decision, reviewedBy: origin.actor },
      origin,
      occurredAt,
    );
    return accept(decision);
  }

  public snapshot(): DuplicateCandidateState {
    return { ...this.state, version: this.version };
  }
}

/** The pair, ordered, so detecting A against B and B against A produces one candidate. */
export const orderedPair = (left: string, right: string): readonly [string, string] =>
  left < right ? [left, right] : [right, left];
