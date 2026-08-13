import {
  TALENT_POOL_TRANSITIONS,
  isCivilDate,
  type TalentPoolKind,
  type TalentPoolStatus,
} from './career-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type CareerResult,
  type LocalizedName,
} from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * A talent pool, and the periods people were in it.
 *
 * **Membership is a decision, not an observation** (ADR-0073). An organization deliberately says "we
 * are investing in this person"; it stands across cycles, it carries the name of whoever decided,
 * and it is nobody's evidence. Performance's nine-box placement is the observation — scoped to one
 * cycle, made by a calibration meeting, and belonging to Performance. **Neither derives the other**,
 * and this module computes no potential band and no high-potential flag.
 *
 * That distinction is what lets a succession review say the most useful thing it says out loud:
 * *this person was placed in the top box and we have still not put them in the leadership pool.*
 *
 * **Removing somebody is a period ending, never a delete.** `to` is set and the row stays. A review
 * a year later asks "who did we invest in, and what happened to them", and a deleted row cannot
 * answer it. The same reasoning keeps a withdrawn successor and a revoked certification.
 *
 * **A pool named `high_potential` is a name a tenant chose.** Nothing here reads it, and no rule
 * branches on a pool's kind.
 */

export interface TalentPoolState {
  readonly talentPoolId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: TalentPoolKind;
  readonly status: TalentPoolStatus;
  readonly closedAt?: Date;
  readonly closedBy?: string;
  readonly version: number;
}

/**
 * One person's period in one pool.
 *
 * Civil dates on both ends: membership begins on a day and ends on a day, and both are the same day
 * in every time zone. `to` absent means the membership is open.
 */
export interface PoolMembershipState {
  readonly membershipId: string;
  readonly talentPoolId: string;
  readonly employmentId: string;
  readonly from: string;
  readonly to?: string;
  readonly addedBy: string;
  readonly addedReason?: string;
  readonly removedBy?: string;
  readonly removedReason?: string;
  readonly version: number;
}

export interface CreatePoolRequest {
  readonly talentPoolId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: TalentPoolKind;
}

export const createPool = (request: CreatePoolRequest): CareerResult<TalentPoolState> => {
  if (!isLocalizedName(request.name)) return refuse('pool-name-required');

  return accept({
    talentPoolId: request.talentPoolId,
    code: request.code,
    name: request.name,
    kind: request.kind,
    status: 'active',
    version: 1,
    ...definedOf({ description: request.description }),
  });
};

/**
 * Closing a pool.
 *
 * Membership history survives, and open memberships are **not** closed as a side effect: whether
 * somebody's investment period ended when the pool closed is a fact about that person, and deciding
 * it for them here would write a date nobody chose. A closed pool simply admits nobody new.
 */
export const closePool = (
  state: TalentPoolState,
  at: Date,
  by: string,
): CareerResult<TalentPoolState> => {
  if (!TALENT_POOL_TRANSITIONS[state.status].includes('closed')) {
    return refuse('pool-transition-refused');
  }

  return accept({ ...state, status: 'closed', closedAt: at, closedBy: by });
};

export interface AddToPoolRequest {
  readonly membershipId: string;
  readonly employmentId: string;
  readonly from: string;
  readonly by: string;
  readonly reason?: string;
}

/**
 * Adding somebody to a pool.
 *
 * Refused on a closed pool. **Uniqueness is not checked here**: "one open membership per pool and
 * employment" is a fact about a set of rows and is arbitrated by a partial unique index, because a
 * read-then-write is idempotent only when nobody else is writing (§15, ADR-0071's construction).
 */
export const addToPool = (
  pool: TalentPoolState,
  request: AddToPoolRequest,
): CareerResult<PoolMembershipState> => {
  if (pool.status === 'closed') return refuse('pool-closed');
  if (!isCivilDate(request.from)) return refuse('membership-from-date-invalid');

  return accept({
    membershipId: request.membershipId,
    talentPoolId: pool.talentPoolId,
    employmentId: request.employmentId,
    from: request.from,
    addedBy: request.by,
    version: 1,
    ...definedOf({ addedReason: request.reason }),
  });
};

export interface RemoveFromPoolRequest {
  readonly on: string;
  readonly by: string;
  readonly reason?: string;
}

/**
 * Ending a membership.
 *
 * The period closes and the row stays. A membership already ended cannot end again — a second
 * removal would overwrite the day the first one recorded, and that day is the historical fact.
 */
export const removeFromPool = (
  state: PoolMembershipState,
  request: RemoveFromPoolRequest,
): CareerResult<PoolMembershipState> => {
  if (state.to !== undefined) return refuse('membership-already-ended');
  if (!isCivilDate(request.on)) return refuse('membership-to-date-invalid');
  if (request.on < state.from) return refuse('membership-ends-before-it-began');

  return accept({
    ...state,
    to: request.on,
    removedBy: request.by,
    ...definedOf({ removedReason: request.reason }),
  });
};

/**
 * Whether a membership was in force on a civil day.
 *
 * Derived, never stored, and inclusive of both ends: somebody removed on the 30th was in the pool
 * on the 30th. "Who was in this pool in March" is a question a succession review asks, and it is
 * answered from the periods rather than from a flag nothing maintains.
 */
export const wasMemberOn = (state: PoolMembershipState, on: string): boolean =>
  state.from <= on && (state.to === undefined || on <= state.to);
