import { uuidV7 } from '@work/kernel';

import { checkedText, definedOnly } from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import {
  isDecision,
  isSubjectKind,
  type ApprovalState,
  type Decision,
  type SubjectKind,
} from './compensation-vocabulary.js';

/**
 * A human's decision on a compensation change.
 *
 * **Compensation records its own decision and does not consume `ApprovalPort`.** The only adapter
 * in this repository is `AutoApprovingPort`, which approves everything immediately as
 * `system:auto-approval`. A salary change is a control over money; recording an automatic approval
 * as though a person had decided would be recording something that did not happen. This is the
 * third module to reach that conclusion, and the reasoning has not changed since ADR-0045 and
 * ADR-0060 (D-9).
 *
 * Four properties make it a real control rather than a field:
 *
 * - **`decidedBy` comes from the authenticated context**, never from a command. A caller who could
 *   supply it could approve their own raise under somebody else's name.
 * - **`requestedBy` is copied onto the row**, which is what makes `check (decided_by <>
 *   requested_by)` enforceable — a check constraint cannot reach another table.
 * - **Decisions are inserted and read.** A wrong one is corrected by a **reversal** naming the
 *   decision it reverses, never by an edit.
 * - **`compensation.approve` is a separate permission** from `compensation.manage`, and the domain
 *   refuses self-approval even for somebody holding both. A control that depends on nobody holding
 *   two roles is a control that fails the first time somebody does.
 *
 * A plan requiring no approval produces a change with **no decision row at all**, and the published
 * chain says "no approval was required" rather than naming a system approver.
 */

export interface ApprovalDecisionState {
  readonly id: string;
  readonly tenantId: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly sequence: number;
  readonly decision: Decision;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  /** Copied from the subject. What makes the self-approval check constraint enforceable. */
  readonly requestedBy: string;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
  readonly version: number;
}

export interface RecordDecision {
  readonly tenantId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decidedBy: string;
  readonly requestedBy: string;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
}

const COMMENT_LIMIT = 1024;

export const approvalDecision = (
  request: RecordDecision,
  decidedAt: Date,
): CompensationResult<ApprovalDecisionState> => {
  if (!isSubjectKind(request.subjectKind)) {
    return refuse('subject_kind_unknown', { subjectKind: request.subjectKind });
  }
  if (!isDecision(request.decision)) {
    return refuse('decision_unknown', { decision: request.decision });
  }
  // Separation of duties, in the domain. It holds regardless of which permissions the caller has,
  // and the database refuses it independently — a control with one enforcement point is a control
  // with one way around it.
  if (request.decidedBy === request.requestedBy) return refuse('self_approval_refused');

  const comment = checkedText(request.comment, 'comment', COMMENT_LIMIT);

  if (!comment.ok) return comment;

  if (!Number.isInteger(request.sequence) || request.sequence < 1) {
    return refuse('decision_sequence_out_of_range');
  }

  return accept({
    id: uuidV7(decidedAt.getTime()),
    tenantId: request.tenantId,
    subjectKind: request.subjectKind,
    subjectId: request.subjectId,
    sequence: request.sequence,
    decision: request.decision,
    decidedBy: request.decidedBy,
    decidedAt,
    requestedBy: request.requestedBy,
    ...definedOnly({ comment: comment.value, reversesDecisionId: request.reversesDecisionId }),
    version: 0,
  });
};

/**
 * The approval state a subject reaches, given its chain and how many approvals its plan requires.
 *
 * A single rejection settles it: a change one approver refused is refused, and requiring the
 * remaining approvers to also refuse would let an approval overrule a rejection.
 */
export const stateFromChain = (
  decisions: readonly ApprovalDecisionState[],
  approvalsRequired: number,
): ApprovalState => {
  const live = effectiveDecisions(decisions);

  if (approvalsRequired === 0) return 'not_required';
  if (live.some((decision) => decision.decision === 'rejected')) return 'rejected';
  return live.filter((decision) => decision.decision === 'approved').length >= approvalsRequired
    ? 'approved'
    : 'pending';
};

/**
 * The decisions that still stand: a reversed decision no longer counts, and neither does the
 * reversal itself.
 *
 * Both are kept in the table — an append-only chain is the audit — and both are excluded from the
 * count, which is what makes a reversal a correction rather than a second opinion.
 */
export const effectiveDecisions = (
  decisions: readonly ApprovalDecisionState[],
): readonly ApprovalDecisionState[] => {
  const reversed = new Set(
    decisions
      .map((decision) => decision.reversesDecisionId)
      .filter((id): id is string => id !== undefined),
  );

  return decisions.filter(
    (decision) => !reversed.has(decision.id) && decision.reversesDecisionId === undefined,
  );
};

/** The next sequence number in a chain. Unique per subject, by index. */
export const nextSequence = (decisions: readonly ApprovalDecisionState[]): number =>
  decisions.reduce((highest, decision) => Math.max(highest, decision.sequence), 0) + 1;

/**
 * Whether a decision may still be reversed.
 *
 * **Permitted while the change it authorized has not yet taken effect; refused afterwards.**
 * Compensation cannot know whether a payroll period has already consumed the change — that is
 * Payroll's fact, and asking for it would be a reverse dependency on a module that does not exist.
 * So the rule is expressed in terms this module *can* answer: a future-dated change can be unmade,
 * and a change already in force is corrected by a **new effective-dated change** rather than by
 * pretending the approval never happened (§26).
 */
export const reversalPermitted = (effectiveFrom: string, today: string): boolean =>
  effectiveFrom > today;
