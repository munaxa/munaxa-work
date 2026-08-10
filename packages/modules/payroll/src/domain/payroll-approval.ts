import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import type { ApprovalDecision } from './payroll-vocabulary.js';

/**
 * A payroll approval decision — **made by a named human, never by an adapter**.
 *
 * The fourth module to reach this conclusion (ADR-0045 Recruitment, ADR-0060 Leave, and Phase 10's
 * Compensation), and the argument has not changed: the only `ApprovalPort` adapter available is
 * `AutoApprovingPort`, which approves everything as `system:auto-approval`, and recording that as
 * though a person decided would be a false statement in an audit trail. Payroll is the module where
 * that false statement would be worst — an approval is the moment somebody accepts responsibility
 * for what a workforce is about to be paid.
 *
 * Two details make the self-approval rule enforceable rather than aspirational:
 *
 * `decidedBy` comes from the **authenticated context**, never from a command, so a caller cannot
 * name somebody else as the approver. And `requestedBy` is **copied onto the decision row**, which
 * is what lets `check (decided_by <> requested_by)` work at all — a check constraint cannot reach
 * another table.
 *
 * A wrong decision is corrected by a **reversal**, never an edit. Both rows stay in the chain, and
 * neither counts toward the approvals a run requires. Phase 16 Workflow may later orchestrate who
 * is asked; it will not change this record's shape.
 */

export interface ApprovalDecisionState {
  readonly approvalDecisionId: string;
  readonly payrollRunId: string;
  readonly sequence: number;
  readonly decision: ApprovalDecision;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  /** Copied here so the self-approval check constraint is enforceable in the database. */
  readonly requestedBy: string;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
}

export interface RecordDecision {
  readonly approvalDecisionId: string;
  readonly payrollRunId: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly requestedBy: string;
  readonly comment?: string;
}

export const recordDecision = (command: RecordDecision): PayrollResult<ApprovalDecisionState> => {
  if (command.decision !== 'approved' && command.decision !== 'rejected') {
    return refuse('approval_decision_unknown', { decision: command.decision });
  }
  if (command.decidedBy === command.requestedBy) return refuse('self_approval_not_permitted');
  if (command.decidedBy.trim().length === 0) return refuse('approver_unknown');

  return accept({
    approvalDecisionId: command.approvalDecisionId,
    payrollRunId: command.payrollRunId,
    sequence: command.sequence,
    decision: command.decision,
    decidedBy: command.decidedBy,
    decidedAt: command.decidedAt,
    requestedBy: command.requestedBy,
    ...(command.comment === undefined ? {} : { comment: command.comment }),
  });
};

/**
 * A reversal: a new row that names the decision it undoes.
 *
 * Neither row is deleted and neither counts toward the approvals a run requires, so the chain reads
 * as what actually happened — somebody approved, somebody reversed it — rather than as though the
 * first decision never occurred.
 */
export const reverseDecision = (
  original: ApprovalDecisionState,
  command: {
    readonly approvalDecisionId: string;
    readonly sequence: number;
    readonly decidedBy: string;
    readonly decidedAt: Date;
    readonly comment?: string;
  },
): PayrollResult<ApprovalDecisionState> => {
  if (original.decision === 'reversed') return refuse('approval_already_reversed');

  return accept({
    approvalDecisionId: command.approvalDecisionId,
    payrollRunId: original.payrollRunId,
    sequence: command.sequence,
    decision: 'reversed',
    decidedBy: command.decidedBy,
    decidedAt: command.decidedAt,
    requestedBy: original.requestedBy,
    ...(command.comment === undefined ? {} : { comment: command.comment }),
    reversesDecisionId: original.approvalDecisionId,
  });
};

/** How many approvals stand, once reversals have cancelled the decisions they name. */
export const standingApprovals = (chain: readonly ApprovalDecisionState[]): number => {
  const reversed = new Set(
    chain
      .filter((step) => step.decision === 'reversed')
      .map((step) => step.reversesDecisionId ?? ''),
  );

  return chain.filter(
    (step) => step.decision === 'approved' && !reversed.has(step.approvalDecisionId),
  ).length;
};
