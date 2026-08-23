import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import type { AccessAction } from './relations-vocabulary.js';

/**
 * A record that somebody read a disciplinary record — AD-007's *"every read … is audited"*.
 *
 * A table rather than a log line, for the reason Documents gave when it made the same choice: an
 * access trail that can only be grepped cannot answer *"who has been looking at this employee's
 * file"*, and this is the domain where that question is asked by a lawyer.
 *
 * **It carries who looked at which record, and nothing about the record.** No employment, no
 * category, no severity, no description, no date of the conduct. The trail exists to answer a
 * question about *access*, and copying the matter's details into it would make the audit table a
 * second, less-guarded copy of the thing it audits — so a caller who obtained the trail would obtain
 * the disciplinary history with it.
 *
 * **Catalogue reads are not audited.** A catalogue is tenant configuration — a list of the words a
 * policy is written in, naming nobody. Auditing it would be the "audit every query" mechanism the
 * approval explicitly forbids, and would bury the reads that matter in reads that do not.
 *
 * The row is immutable at the database. An access trail that can be rewritten is not an access
 * trail.
 */

export interface AccessEventState {
  readonly accessEventId: string;
  readonly violationId: string;
  readonly action: AccessAction;
  /** The authenticated caller, from the execution context. Never supplied by a request. */
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
}

export const recordAccess = (state: AccessEventState): RelationsResult<AccessEventState> => {
  if (state.actor.trim() === '') return refuse('access_actor_unknown', { field: 'actor' });
  if (state.correlationId.trim() === '') {
    // The correlation identifier is what joins a read of a disciplinary record to the request that
    // made it. Without one the row still names an actor, but an investigator cannot reconstruct what
    // they were doing at the time.
    return refuse('access_correlation_unknown', { field: 'correlationId' });
  }
  return accept(state);
};
