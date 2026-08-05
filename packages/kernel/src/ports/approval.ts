import type { DomainEvent } from '../domain/domain-event.js';

/**
 * Approvals, as a port (ADR-0024).
 *
 * Workflow is Phase 16, but Attendance, Leave, Compensation, Payroll and Recruitment all need
 * approvals long before it exists. Depending on this interface from their first commit means
 * Phase 16 supplies an adapter and no business module changes — retrofitting approvals into
 * five completed domains is explicitly prohibited.
 *
 * The requesting domain never learns who approved or in what order. It states what needs
 * deciding and reacts to the decision; everything between belongs to Workflow.
 */

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export interface ApprovalStep {
  readonly approver: string;
  readonly decidedAt?: Date;
  readonly decision?: 'approved' | 'rejected';
  readonly comment?: string;
}

export interface ApprovalRequest {
  /** What is being decided — `leave.request`, `attendance.correction`. Workflow routes on it. */
  readonly subjectType: string;
  readonly subjectId: string;
  readonly requestedBy: string;
  /** Facts the routing rules may read. Never the aggregate itself. */
  readonly context: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
}

export interface ApprovalStatus {
  readonly approvalId: string;
  readonly state: ApprovalState;
  /** The chain as the employee sees it: who, in order, with their decision and timestamp. */
  readonly steps: readonly ApprovalStep[];
  readonly completedAt?: Date;
}

export interface ApprovalPort {
  request(request: ApprovalRequest): Promise<ApprovalStatus>;
  status(approvalId: string): Promise<ApprovalStatus>;
  cancel(approvalId: string, reason: string): Promise<void>;
}

/** Published when a decision is reached. The requesting domain acts on this, not on a callback. */
export interface ApprovalDecided {
  readonly approvalId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly state: Extract<ApprovalState, 'approved' | 'rejected'>;
}

export type ApprovalDecidedEvent = DomainEvent<ApprovalDecided>;
