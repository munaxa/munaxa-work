import { ACCESS_ACTIONS, type AccessAction } from './documents-vocabulary.js';
import { accept, refuse, type DocumentsResult } from './documents-rejection.js';

/**
 * Who accessed which document, when, and what happened.
 *
 * A **table**, not a log line. People records a sensitive read through the structured logger
 * (`DisclosurePort`), and that is right for its case; it is not enough here. "Who has read this
 * employee's medical certificate, and when" is a question a subject access request asks and a
 * regulator expects an answer to, and an answer that requires grepping a log retention window is
 * not an answer (D-23).
 *
 * **What a record may never contain**: file content, a storage reference, a signed URL, a
 * credential, or anything about what the document said. It records *that* an access happened and
 * to which version — enough to answer the question, and nothing that would make the audit trail
 * itself a disclosure.
 *
 * **A refused attempt is recorded too.** An audit that logs only successes hides the more
 * interesting half: somebody trying repeatedly to reach a document they may not see is exactly what
 * this exists to surface.
 *
 * The row is immutable at the table. An access trail that can be rewritten is not an access trail.
 */

export interface AccessEventState {
  readonly accessEventId: string;
  readonly documentId: string;
  readonly documentVersionId?: string;
  readonly action: AccessAction;
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId?: string;
  readonly outcome: 'permitted' | 'refused';
  readonly version: number;
}

export interface RecordAccessRequest {
  readonly accessEventId: string;
  readonly documentId: string;
  readonly documentVersionId?: string;
  readonly action: string;
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId?: string;
  readonly outcome: 'permitted' | 'refused';
}

export const recordAccess = (request: RecordAccessRequest): DocumentsResult<AccessEventState> => {
  if (!(ACCESS_ACTIONS as readonly string[]).includes(request.action)) {
    return refuse('access_action_unknown', { field: 'action', action: request.action });
  }
  if (request.actor.trim() === '') return refuse('access_actor_required', { field: 'actor' });

  return accept({
    accessEventId: request.accessEventId,
    documentId: request.documentId,
    action: request.action as AccessAction,
    actor: request.actor,
    occurredAt: request.occurredAt,
    outcome: request.outcome,
    version: 1,
    ...(request.documentVersionId === undefined
      ? {}
      : { documentVersionId: request.documentVersionId }),
    ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
  });
};
