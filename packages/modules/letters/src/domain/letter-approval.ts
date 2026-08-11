import { APPROVAL_DECISIONS, type ApprovalDecision } from './letters-vocabulary.js';
import { accept, refuse, type LettersResult } from './letters-rejection.js';

/**
 * A named human's decision on a letter request.
 *
 * **Workflow is Phase 16 and does not exist.** Rather than build a second workflow engine, this
 * follows exactly what Compensation and Payroll already do: the decision is recorded in this
 * module's own table, `decidedBy` comes from the authenticated context, self-approval is refused
 * here and again by a check constraint, and a wrong decision is *reversed* rather than edited.
 *
 * The shape mirrors `ApprovalPort`'s view, so Phase 16 changes where the decision comes from
 * without changing what a caller reads (D-14).
 *
 * **`system:auto-approval` appears nowhere.** A letter approved by nobody is a letter nobody
 * accepted responsibility for, and a salary certificate is a document a bank acts on.
 */

export interface ApprovalDecisionState {
  readonly approvalDecisionId: string;
  readonly letterRequestId: string;
  readonly sequence: number;
  readonly decision: ApprovalDecision;
  readonly requestedBy: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly reversesId?: string;
  readonly version: number;
}

export interface RecordDecisionRequest {
  readonly approvalDecisionId: string;
  readonly letterRequestId: string;
  readonly sequence: number;
  readonly decision: string;
  readonly requestedBy: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly reversesId?: string;
}

export const recordDecision = (
  request: RecordDecisionRequest,
): LettersResult<ApprovalDecisionState> => {
  if (!(APPROVAL_DECISIONS as readonly string[]).includes(request.decision)) {
    return refuse('approval_decision_unknown', { field: 'decision' });
  }
  if (request.decidedBy.trim() === '') return refuse('approver_required', { field: 'decidedBy' });
  // The rule the database also carries. Somebody who requested a letter about their own salary
  // must not be the person who approves issuing it.
  if (request.decidedBy === request.requestedBy) return refuse('self_approval_not_permitted');
  if (request.decision === 'reversed' && request.reversesId === undefined) {
    return refuse('reversal_needs_target', { field: 'reversesId' });
  }
  if (request.sequence < 1) return refuse('sequence_invalid', { field: 'sequence' });

  return accept({
    approvalDecisionId: request.approvalDecisionId,
    letterRequestId: request.letterRequestId,
    sequence: request.sequence,
    decision: request.decision as ApprovalDecision,
    requestedBy: request.requestedBy,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt,
    version: 1,
    ...(request.comment === undefined ? {} : { comment: request.comment }),
    ...(request.reversesId === undefined ? {} : { reversesId: request.reversesId }),
  });
};

/**
 * Whether the chain currently permits issuing.
 *
 * The latest un-reversed decision decides. A reversal does not erase the decision it reverses — the
 * record keeps both, and the chain reads as the history it is.
 */
export const approvalState = (
  decisions: readonly ApprovalDecisionState[],
): 'not_required' | 'pending' | 'approved' | 'rejected' => {
  if (decisions.length === 0) return 'pending';

  const reversed = new Set(
    decisions.filter((one) => one.reversesId !== undefined).map((one) => one.reversesId),
  );
  const standing = [...decisions]
    .filter((one) => one.decision !== 'reversed' && !reversed.has(one.approvalDecisionId))
    .sort((one, other) => other.sequence - one.sequence)[0];

  if (standing === undefined) return 'pending';
  return standing.decision === 'approved' ? 'approved' : 'rejected';
};
