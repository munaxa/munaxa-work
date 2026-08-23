import { accept, refuse, type AssetsResult } from './assets-rejection.js';
import { INITIAL_CUSTODY_STATE, type CustodyState } from './assets-vocabulary.js';

/**
 * A custody — one asset, one employment, from one day until another.
 *
 * **One row is one handover**, which is exactly what AD-003 asks for: *"every handover, return and
 * transfer is a new record."* A custody is not an event and not a projection; it is a *period*, and
 * the period is the record. Issuing opens one, returning closes it, and the closed row is the history.
 *
 * **It references Employment, never People** (AD-001). No name, no email, no national identifier and
 * no user account is copied here: a screen that wants a name asks the module that owns one.
 *
 * **The current holder of an asset is its open custody**, and there is at most one — settled by a
 * partial unique index rather than by a read (ADR-0071). Nothing anywhere holds a second copy of that
 * answer: no `asset.current_employee_id`, no `in_custody` flag. A stored flag that nothing maintains
 * is worse than no flag (ADR-0070), and this is the same reasoning that kept `issued` out of
 * `asset.status` in Checkpoint 1.
 *
 * **A returned custody is immutable at the database.** The trigger refuses every update and delete on
 * it from any path, so a mistake is not editable — correction is a deferred capability with semantics
 * nobody has agreed (D-5.3-10), and inventing them here would answer a question nobody asked.
 *
 * **Nothing here records a condition, an expected return, an acknowledgement or an amount.** Each
 * belongs to a capability this checkpoint does not build, and two of them are downstream of decisions
 * that are still open.
 */

export const CUSTODY_NOTE_LIMIT = 500;

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The record itself. Named `Record` rather than `State`, as `ViolationRecord` is, because the
 * vocabulary already owns `CustodyState` — the value of the `state` column. */
export interface CustodyRecord {
  readonly assetCustodyId: string;
  readonly assetId: string;
  /** Employment, never person (AD-001). Confirmed to exist before the row is written. */
  readonly employmentId: string;
  /** The day the asset was handed over. A day in the tenant's world, not an instant. */
  readonly issuedOn: string;
  /** Absent while open; the day it came back once returned. */
  readonly returnedOn?: string;
  readonly state: CustodyState;
  readonly issueNote?: string;
  readonly returnNote?: string;
  readonly version: number;
}

export interface IssueCustodyRequest {
  readonly assetCustodyId: string;
  readonly assetId: string;
  readonly employmentId: string;
  readonly issuedOn: string;
  readonly issueNote?: string;
  /** The server's own day. Never supplied by a caller — see `issuedOn` below. */
  readonly today: string;
}

/**
 * Opening a custody.
 *
 * **The caller does not choose the state.** Every custody starts `open`, and the only way out is the
 * return command, which validates the move.
 *
 * **`issuedOn` cannot be in the future**, checked against the server's own clock. A caller who could
 * date a handover forward could record that somebody holds an asset they have not been given — and
 * the same rule keeps a return from being pre-dated.
 */
export const issueCustody = (request: IssueCustodyRequest): AssetsResult<CustodyRecord> => {
  if (!CIVIL_DATE.test(request.issuedOn)) {
    return refuse('issued_on_malformed', { field: 'issuedOn' });
  }
  if (request.issuedOn > request.today) {
    return refuse('issued_on_in_future', { field: 'issuedOn' });
  }

  const note = boundedNote(request.issueNote, 'issueNote');

  if (!note.ok) return note;

  return accept({
    assetCustodyId: request.assetCustodyId,
    assetId: request.assetId,
    employmentId: request.employmentId,
    issuedOn: request.issuedOn,
    state: INITIAL_CUSTODY_STATE,
    version: 1,
    ...(note.value === undefined ? {} : { issueNote: note.value }),
  });
};

export interface ReturnCustodyRequest {
  readonly custody: CustodyRecord;
  readonly returnedOn: string;
  readonly returnNote?: string;
  readonly today: string;
}

/**
 * Closing a custody — the one transition this checkpoint builds.
 *
 * A custody that is already returned is refused here *and* by the database, which is the same rule
 * stated in the two places somebody might try. The application refusal is what gives a caller a
 * sentence; the trigger is what makes it true of SQL nobody wrote in TypeScript.
 *
 * **A return cannot precede its own issue, and cannot be dated into the future.** Both are refused
 * rather than corrected, because a custody period whose end precedes its beginning is not a period.
 */
export const returnCustody = (request: ReturnCustodyRequest): AssetsResult<CustodyRecord> => {
  if (request.custody.state !== 'open') {
    return refuse('custody_not_open', { field: 'state' });
  }
  if (!CIVIL_DATE.test(request.returnedOn)) {
    return refuse('returned_on_malformed', { field: 'returnedOn' });
  }
  if (request.returnedOn > request.today) {
    return refuse('returned_on_in_future', { field: 'returnedOn' });
  }
  if (request.returnedOn < request.custody.issuedOn) {
    return refuse('returned_before_issued', { field: 'returnedOn' });
  }

  const note = boundedNote(request.returnNote, 'returnNote');

  if (!note.ok) return note;

  return accept({
    ...request.custody,
    returnedOn: request.returnedOn,
    state: 'returned',
    ...(note.value === undefined ? {} : { returnNote: note.value }),
  });
};

/**
 * The open custody among a set, or nothing — **the current holder, derived**.
 *
 * There is at most one, and the partial unique index is what makes that true; this function is how
 * the answer is read rather than how it is guaranteed. Returning `undefined` is a real answer: the
 * asset is in nobody's custody.
 */
export const openCustodyAmong = (custodies: readonly CustodyRecord[]): CustodyRecord | undefined =>
  custodies.find((custody) => custody.state === 'open');

/**
 * A note, trimmed, bounded, and **absent rather than empty**.
 *
 * A blank note and an absent one would otherwise be two ways of saying the same thing, and a screen
 * would eventually render one of them as something somebody wrote.
 */
const boundedNote = (
  value: string | undefined,
  field: string,
): AssetsResult<string | undefined> => {
  const note = value?.trim() ?? '';

  if (note === '') return accept(undefined);
  if (note.length > CUSTODY_NOTE_LIMIT) {
    return field === 'issueNote'
      ? refuse('issue_note_too_long', { field })
      : refuse('return_note_too_long', { field });
  }
  return accept(note);
};
