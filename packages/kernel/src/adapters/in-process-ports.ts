import type { ApprovalPort, ApprovalRequest, ApprovalStatus } from '../ports/approval.js';
import type { NotificationPort, NotificationRequest } from '../ports/notification.js';
import { uuidV7 } from '../identity/uuid-v7.js';

/**
 * The default adapters that let domains depend on the ports before Workflow (Phase 16) and
 * Communications (Phase 17) exist (ADR-0024).
 *
 * They are deliberately minimal and deliberately honest. Auto-approval records the decision and
 * says so; it does not pretend a chain of approvers considered anything. A tenant that needs
 * real routing gets it when Workflow lands, and no business module changes.
 */

export class AutoApprovingPort implements ApprovalPort {
  private readonly approvals = new Map<string, ApprovalStatus>();

  public request(request: ApprovalRequest): Promise<ApprovalStatus> {
    const approvalId = uuidV7();
    const status: ApprovalStatus = {
      approvalId,
      state: 'approved',
      steps: [
        {
          approver: 'system:auto-approval',
          decidedAt: new Date(),
          decision: 'approved',
          comment: `No workflow is configured for ${request.subjectType}.`,
        },
      ],
      completedAt: new Date(),
    };
    this.approvals.set(approvalId, status);
    return Promise.resolve(status);
  }

  public status(approvalId: string): Promise<ApprovalStatus> {
    const status = this.approvals.get(approvalId);

    if (status === undefined) {
      return Promise.reject(new Error(`Unknown approval ${approvalId}.`));
    }
    return Promise.resolve(status);
  }

  public cancel(approvalId: string, reason: string): Promise<void> {
    const status = this.approvals.get(approvalId);

    if (status !== undefined) {
      this.approvals.set(approvalId, {
        ...status,
        state: 'cancelled',
        steps: [...status.steps, { approver: 'system', comment: reason, decidedAt: new Date() }],
      });
    }
    return Promise.resolve();
  }
}

/**
 * Records notifications instead of delivering them. Recording rather than discarding matters:
 * the log is what proves a domain asked, so when Communications arrives the requests can be
 * replayed and compared rather than rediscovered.
 */
export class RecordingNotificationPort implements NotificationPort {
  public readonly sent: NotificationRequest[] = [];

  public notify(request: NotificationRequest): Promise<void> {
    const duplicate =
      request.idempotencyKey !== undefined &&
      this.sent.some((previous) => previous.idempotencyKey === request.idempotencyKey);

    if (!duplicate) this.sent.push(request);
    return Promise.resolve();
  }
}
