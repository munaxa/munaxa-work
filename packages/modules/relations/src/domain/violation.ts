import type { ViolationCategoryState } from './violation-category.js';
import { acceptsNewViolations } from './violation-category.js';
import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import type { ViolationState } from './relations-vocabulary.js';

/**
 * A violation, recorded against an employment — the first record in this domain, and the one that
 * has to survive a labour dispute.
 *
 * **It references an employment and never a person** (AD-001). Person owns permanent identity;
 * Employment owns the relationship this is a matter within. Nothing here resolves a name, a manager
 * or an organisation: those are other modules' facts, pulled where they are needed and not copied
 * to here.
 *
 * **The category is referenced *and* frozen.** `violationCategoryId` keeps the link; `categoryCode`
 * and `severity` keep what the entry said **at the moment of recording**. That is not
 * denormalisation for speed — it is AD-003. A catalogue entry may be renamed or re-graded, and a
 * record whose meaning changed because somebody edited a dropdown two years later is not evidence.
 * It is the same reason a letter freezes the values it substituted and a running approval keeps the
 * manager it started with.
 *
 * **`reportedBy` is the authenticated caller and cannot be supplied.** A command that accepted a
 * reporter would let anyone record a disciplinary allegation under somebody else's name, which is
 * the one forgery this record must not permit. *Consequence, stated rather than hidden:* where an
 * HR administrator records a matter a supervisor raised, this field is the administrator. A separate
 * "raised by" attribution is a later decision, not something to invent here.
 *
 * **There is no correction path, because there is nothing to correct into.** The row is immutable at
 * the database (D-5.2-03): update and delete both raise. AD-003's *"a correction is a new, linked
 * record"* arrives with the lifecycle that can produce one.
 */

/**
 * Named `ViolationRecord` rather than `ViolationState`, because `ViolationState` is already the
 * *lifecycle state* in `relations-vocabulary.ts` — `'reported'`. Two types called the same thing
 * would make every signature ambiguous, and separating them with a trailing underscore is a naming
 * shortcut the standards reject outright; they caught exactly that here, and the rename is the fix
 * rather than an exemption.
 */
export interface ViolationRecord {
  readonly violationId: string;
  readonly employmentId: string;
  readonly violationCategoryId: string;
  /** Frozen at recording. What the catalogue entry was called then, not what it is called now. */
  readonly categoryCode: string;
  /** Frozen at recording, for the same reason. */
  readonly severity: string;
  /** The civil date the conduct occurred, `YYYY-MM-DD`. Never a timestamp. */
  readonly occurredOn: string;
  /** The authenticated caller. Never supplied by one. */
  readonly reportedBy: string;
  readonly description: string;
  readonly state: ViolationState;
  readonly recordedAt: Date;
  readonly version: number;
}

export interface RecordViolationRequest {
  readonly violationId: string;
  readonly employmentId: string;
  readonly category: ViolationCategoryState;
  readonly occurredOn: string;
  readonly reportedBy: string;
  readonly description: string;
  readonly recordedAt: Date;
  /** The civil date at the recording instant, for the not-in-the-future rule. */
  readonly today: string;
}

/** The longest a description may be. Long enough for an account of what happened; bounded, so a row is a row. */
export const DESCRIPTION_LIMIT = 4000;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const recordViolation = (
  request: RecordViolationRequest,
): RelationsResult<ViolationRecord> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    violationId: request.violationId,
    employmentId: request.employmentId,
    violationCategoryId: request.category.violationCategoryId,
    categoryCode: request.category.code,
    severity: request.category.severity,
    occurredOn: request.occurredOn,
    reportedBy: request.reportedBy,
    description: request.description.trim(),
    state: 'reported',
    recordedAt: request.recordedAt,
    version: 1,
  });
};

const validate = (request: RecordViolationRequest): RelationsResult<true> => {
  if (!acceptsNewViolations(request.category)) {
    // A deactivated entry is one the tenant has taken out of service. Old violations keep pointing
    // at it and read correctly; a new one may not be filed under it.
    return refuse('category_inactive', { field: 'violationCategoryId' });
  }
  if (!CIVIL_DATE.test(request.occurredOn)) {
    return refuse('occurred_on_malformed', { field: 'occurredOn' });
  }
  if (request.occurredOn > request.today) {
    // Conduct that has not happened yet cannot be reported. Compared as civil dates rather than
    // instants, because "when did it happen" is a day in the tenant's world, not a moment in UTC.
    return refuse('occurred_on_in_future', { field: 'occurredOn' });
  }

  const description = request.description.trim();

  if (description === '') return refuse('description_missing', { field: 'description' });
  if (description.length > DESCRIPTION_LIMIT) {
    return refuse('description_too_long', { field: 'description' });
  }
  if (request.reportedBy.trim() === '') {
    // Unreachable from the pipeline, which always has an actor. Refused rather than assumed, because
    // an unattributed disciplinary record is exactly the thing this domain must never hold.
    return refuse('reporter_unknown', { field: 'reportedBy' });
  }
  return accept(true);
};
