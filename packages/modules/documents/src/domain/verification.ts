import { accept, refuse, type DocumentsResult } from './documents-rejection.js';
import type { VerificationState } from './documents-vocabulary.js';

/**
 * Who decided a version was acceptable, and why if they refused.
 *
 * **Verification attaches to a version, not to a document.** A verdict is about specific bytes:
 * somebody opened a file and confirmed it was the passport it claimed to be. Replacing the file
 * returns the document to `pending_verification` rather than inheriting that verdict, because
 * nobody has looked at the new bytes. Attaching verification to the document instead would make a
 * replacement silently inherit approval, which is the failure this whole design exists to prevent.
 *
 * **Uploading is never verifying.** There is no path in this module by which creating a document or
 * adding a version produces a decision, and `system:auto-approval` appears nowhere — a document
 * verified by nobody is a document nobody accepted responsibility for.
 *
 * `decidedBy` comes from the authenticated context and never from a request body, the rule
 * Compensation and Payroll both carry. A caller who could supply it could sign off their own upload
 * under somebody else's name.
 */

export interface VerificationDecisionState {
  readonly verificationId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly decision: Extract<VerificationState, 'verified' | 'rejected'>;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly reason?: string;
  readonly version: number;
}

export interface RecordVerificationRequest {
  readonly verificationId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly reason?: string;
}

export const recordVerification = (
  request: RecordVerificationRequest,
): DocumentsResult<VerificationDecisionState> => {
  if (request.decision !== 'verified' && request.decision !== 'rejected') {
    return refuse('verification_decision_unknown', { field: 'decision' });
  }
  if (request.decidedBy.trim() === '') {
    return refuse('verification_actor_required', { field: 'decidedBy' });
  }
  // A rejection without a reason is a rejection nobody can act on: the person who uploaded it
  // cannot tell whether the file was wrong, unreadable or simply the wrong kind.
  if (request.decision === 'rejected' && (request.reason ?? '').trim() === '') {
    return refuse('rejection_needs_reason', { field: 'reason' });
  }
  if ((request.reason ?? '').length > 512) return refuse('reason_too_long', { field: 'reason' });

  return accept({
    verificationId: request.verificationId,
    documentId: request.documentId,
    documentVersionId: request.documentVersionId,
    decision: request.decision,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt,
    version: 1,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
  });
};

/**
 * Whether a version may still be decided on.
 *
 * A superseded version is not in the verification queue: somebody replaced it, and a verdict on
 * bytes that are no longer current tells nobody anything. The unique index on
 * `(tenant_id, document_version_id)` refuses a second decision on the same version at the table;
 * this refuses it first, with a reason.
 */
export const canDecideOn = (version: {
  readonly supersededAt?: Date;
  readonly verificationState: VerificationState;
}): DocumentsResult<'decidable'> => {
  if (version.supersededAt !== undefined) return refuse('version_superseded');
  if (version.verificationState === 'verified' || version.verificationState === 'rejected') {
    return refuse('version_already_decided', { state: version.verificationState });
  }
  return accept('decidable');
};
