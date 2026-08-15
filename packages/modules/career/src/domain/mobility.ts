import {
  AUTO_APPROVAL,
  MOBILITY_TRANSITIONS,
  isCivilDate,
  type MobilityKind,
  type MobilityStatus,
  type StoredMobilityStatus,
} from './career-vocabulary.js';
import { accept, refuse, type CareerResult } from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * A suggestion that somebody could move, and nothing that moves them.
 *
 * **This is the aggregate a reader is most likely to misread**, so the guarantee is worth stating
 * before the shape: a mobility recommendation changes no employment, no assignment, no position and
 * no salary. `accepted` means **a human agreed with the suggestion** and nothing else happened — no
 * transfer, no letter, nobody told (ADR-0072). Employment consumes career outputs through a separate
 * business process that a person drives, and that process does not exist in this product.
 *
 * There is no port, adapter or grant through which this module could write to Employment. A
 * contributor who wanted to make `accept` perform a transfer would have to add all four, and each
 * is a reviewable step.
 *
 * **`expired` is derived and never stored** (D-13). A recommendation carries the civil day it stops
 * being current, and whether it *has* stopped is a function of that day and the day somebody asked —
 * because a stored flag would need something to move it overnight and `JobPort` has no adapter
 * anywhere in this repository. This is Learning's certificate-validity construction exactly
 * (ADR-0070), and scheduled expiry remains `NOT VERIFIED`.
 *
 * A recommendation that reads as expired is still `proposed` in the row, so accepting one is still
 * permitted — the same position Learning takes when an expired certification can still be revoked.
 * The derived standing is what a screen shows; the stored status is what a transition gates on.
 * Refusing a stale acceptance would be a business rule, and none was specified.
 */

export interface MobilityRecommendationState {
  readonly mobilityRecommendationId: string;
  readonly employmentId: string;
  readonly kind: MobilityKind;
  /** Organization's identifier for the suggested destination, where one was named. */
  readonly targetPositionId?: string;
  readonly targetUnitId?: string;
  readonly rationale?: string;
  /** Stored. Never `expired` — see the file note. */
  readonly status: StoredMobilityStatus;
  readonly recommendedOn: string;
  readonly recommendedBy: string;
  /** The civil day it stops being current. Nothing acts on it; it is read against. */
  readonly validUntil?: string;
  readonly decidedOn?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly version: number;
}

export interface RecommendRequest {
  readonly mobilityRecommendationId: string;
  readonly employmentId: string;
  readonly kind: MobilityKind;
  readonly targetPositionId?: string;
  readonly targetUnitId?: string;
  readonly rationale?: string;
  readonly on: string;
  readonly by: string;
  readonly validUntil?: string;
}

/**
 * Making a recommendation.
 *
 * A destination is not required: "this person is ready to move somewhere broader" is a real thing to
 * record before anybody knows where. What is required is a day and a person, because a suggestion
 * with neither is one nobody can weigh.
 */
export const recommendMove = (
  request: RecommendRequest,
): CareerResult<MobilityRecommendationState> => {
  if (!isCivilDate(request.on)) return refuse('recommendation-date-invalid');
  if (request.validUntil !== undefined && !isCivilDate(request.validUntil)) {
    return refuse('recommendation-validity-date-invalid');
  }
  if (request.validUntil !== undefined && request.validUntil <= request.on) {
    return refuse('recommendation-expires-before-it-is-made');
  }
  if (request.by === AUTO_APPROVAL) return refuse('recommendation-requires-a-person');

  return accept({
    mobilityRecommendationId: request.mobilityRecommendationId,
    employmentId: request.employmentId,
    kind: request.kind,
    status: 'proposed',
    recommendedOn: request.on,
    recommendedBy: request.by,
    version: 1,
    ...definedOf({
      targetPositionId: request.targetPositionId,
      targetUnitId: request.targetUnitId,
      rationale: request.rationale,
      validUntil: request.validUntil,
    }),
  });
};

export interface DecideRequest {
  readonly to: StoredMobilityStatus;
  readonly on: string;
  readonly by: string;
  readonly note?: string;
}

/**
 * Accepting or declining.
 *
 * **Accepting changes nothing outside this row.** It records that a named person, on a named day,
 * agreed that the move is a good idea. Whether it then happens is Employment's, through a process
 * somebody runs by hand.
 *
 * `system:auto-approval` is refused: an agreement nobody made is not an agreement.
 */
export const decideMove = (
  state: MobilityRecommendationState,
  request: DecideRequest,
): CareerResult<MobilityRecommendationState> => {
  if (!MOBILITY_TRANSITIONS[state.status].includes(request.to)) {
    return refuse('recommendation-transition-refused');
  }
  if (!isCivilDate(request.on)) return refuse('recommendation-decision-date-invalid');
  if (request.by === AUTO_APPROVAL) return refuse('decision-requires-a-person');

  return accept({
    ...state,
    status: request.to,
    decidedOn: request.on,
    decidedBy: request.by,
    ...definedOf({ decisionNote: request.note }),
  });
};

/**
 * What a recommendation stands as, on the day somebody asked.
 *
 * The only place `expired` is ever produced. A decided recommendation keeps its decision — accepting
 * something and then letting its validity lapse does not un-accept it — and an undecided one past
 * its `validUntil` reads as `expired` without anything having written that word anywhere.
 *
 * A recommendation with no `validUntil` never expires, and that is a real answer rather than a
 * missing one: some suggestions stand until somebody decides.
 */
export const standingOf = (state: MobilityRecommendationState, on: string): MobilityStatus => {
  if (state.status !== 'proposed') return state.status;
  if (state.validUntil !== undefined && state.validUntil < on) return 'expired';
  return 'proposed';
};
