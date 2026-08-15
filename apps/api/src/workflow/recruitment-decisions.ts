import { runWithServiceGrant, type Command, type Query } from '@work/kernel';
import type { ApprovalDelivery, BusinessDecisionPort, TerminalApproval } from '@work/workflow';
import type { RequisitionView } from '@work/recruitment';

import type { Sending } from './sending.js';

/**
 * The one place Workflow writes into another module.
 *
 * It implements Workflow's outbound decision seam for **requisitions and nothing else**: a terminal
 * approval arrives, and this carries it to Recruitment's own published `decide` command. Every other
 * subject type — a leave request, a salary change, a payroll run — comes through here, is not
 * recognized, and is answered `not-adopted`. That is how Workflow stays free of module names while
 * exactly one module is adopted (AD-001, D-10).
 *
 * **Recruitment decides; this carries.** Whether a requisition may move to approved is
 * `Requisition.decide`'s question, asked on Recruitment's side, in Recruitment's transaction, against
 * Recruitment's own lifecycle. Nothing here evaluates a status, computes a transition, or writes a
 * row. The adapter's whole job is translation and reconciliation.
 *
 * **Two transactions, and no pretence otherwise.** `UnitOfWork.execute` takes its own connection
 * every time, so Recruitment commits on its own before Workflow does. The order is what makes that
 * safe in the direction that matters: Recruitment is asked *first*, and a refusal from it leaves
 * Workflow with nothing written. The opposite window — Recruitment committed, Workflow's commit then
 * failed — is closed by reconciliation below rather than by a guarantee this repository does not
 * have. There is no outbox, no queue, no retry worker and no scheduler on this path.
 *
 * **No Prisma, no SQL, no repository, no entity.** Two published contracts and nothing else.
 */

/** The one subject type this module owns. Not a registry, and there is no second entry. */
const REQUISITION = 'recruitment.requisition';

/** The exact two grants, and the audit asserts this list unchanged. */
const REQUISITION_READ = 'recruitment.requisition.read';
const REQUISITION_APPROVE = 'recruitment.requisition.approve';

/** A uuid by shape, so an identifier that could never name a row is refused before it is sent. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReadRequisitionQuery extends Query {
  readonly queryName: 'recruitment.read-requisition';
  readonly requisitionId: string;
}

interface DecideRequisitionCommand extends Command {
  readonly commandName: 'recruitment.decide-requisition';
  readonly requisitionId: string;
  readonly decision: 'approved' | 'rejected';
  /** The reserved column, receiving the Workflow instance identifier. An opaque value, not a key. */
  readonly approvalId: string;
  readonly expectedVersion: number;
}

/** Recruitment's snapshot, of which exactly one field of one member is read. */
interface RequisitionSnapshot {
  readonly requisition: RequisitionView;
}

const applied: ApprovalDelivery = { kind: 'applied' };
const converged: ApprovalDelivery = { kind: 'converged' };
const notAdopted: ApprovalDelivery = { kind: 'not-adopted' };

const refused = (reason: string): ApprovalDelivery => ({ kind: 'refused', reason });

/**
 * What the requisition's current state means for an approval arriving now.
 *
 * The four cases are genuinely different and only the first may converge:
 *
 * 1. **This approval already applied** — same identifier, same outcome. The delivery is a repeat of
 *    one that already succeeded, which is exactly the window a failed Workflow commit leaves open.
 *    Nothing changes and nothing needs to.
 * 2. **This approval applied, but the other way** — same identifier, opposite outcome. Not
 *    convergence: something is asking to turn a recorded rejection into an approval, and the answer
 *    is no.
 * 3. **A different approval decided it** — a routed chain got there first. Refused, and the existing
 *    identifier is never overwritten.
 * 4. **Decided with no approval at all** — a person decided it directly in Recruitment. Refused,
 *    because claiming Workflow caused that decision would put an authority in the audit trail that
 *    did not produce it.
 *
 * **A status alone is never sufficient.** "approved" tells you the outcome and nothing about who
 * caused it, and treating it as proof of idempotency is how a second approval quietly adopts a
 * decision somebody else made.
 */
const reconcile = (view: RequisitionView, approval: TerminalApproval): ApprovalDelivery => {
  // **Not awaiting is not the same as decided.** A draft, a cancelled or a closed requisition has no
  // decision to reconcile against, and answering "it was decided outside Workflow" about one would
  // name a decision nobody made. Only the two terminal outcomes are a decision.
  if (view.status !== 'approved' && view.status !== 'rejected') {
    return refused('subject-refused-the-decision');
  }
  if (view.approvalId === approval.approvalId) {
    return view.status === approval.outcome ? converged : refused('subject-refused-the-decision');
  }
  if (view.approvalId !== undefined) return refused('subject-decided-by-another-approval');
  return refused('subject-decided-outside-workflow');
};

export class RecruitmentDecisions implements BusinessDecisionPort {
  public constructor(private readonly dispatcher: Sending) {}

  public async apply(approval: TerminalApproval): Promise<ApprovalDelivery> {
    // Not this module's subject. Answered without reading anything and without a grant.
    if (approval.subjectType !== REQUISITION) return notAdopted;
    if (!UUID.test(approval.subjectId)) return refused('subject-not-found');

    const snapshot = await this.read(approval.subjectId);

    if (snapshot === undefined) return refused('subject-not-found');

    const view = snapshot.requisition;

    // Anything other than "still waiting" is a question about what already happened to it.
    if (view.status !== 'pending_approval') return reconcile(view, approval);

    return this.decide(approval, view.version);
  }

  /**
   * Recruitment's own bounded read of one requisition.
   *
   * `recruitment.read-requisition` takes an identifier and returns that record — not a search, not a
   * page, not an export. It is here for exactly one purpose: telling a repeat of *this* approval
   * apart from a decision somebody else made, which cannot be done from a status.
   */
  private async read(requisitionId: string): Promise<RequisitionSnapshot | undefined> {
    const found = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-requisition-for-reconciliation',
        permits: [REQUISITION_READ],
        reason:
          'Before applying a terminal approval, Workflow checks whether this same approval has ' +
          'already been applied — which a status alone cannot answer.',
      },
      () => {
        const query: ReadRequisitionQuery = {
          queryName: 'recruitment.read-requisition',
          requisitionId,
        };

        return this.dispatcher.ask<RequisitionSnapshot>(query);
      },
    );

    return found.ok ? found.value : undefined;
  }

  /**
   * Recruitment's own `decide` command, with the approval identifier it has reserved a column for.
   *
   * `expectedVersion` comes from the read a moment ago, so two approvals racing the same requisition
   * meet Recruitment's optimistic concurrency rather than each other — the loser is told its version
   * is stale by the module that owns the row.
   *
   * **The actor is not passed.** It travels in the ambient execution context, which is the whole
   * point of a bounded grant: the human who pressed approve is the actor Recruitment records, and
   * under delegation that is the delegate who acted rather than the approver whose authority they
   * used. A field here would be a caller-supplied identity, which is the thing the seam refuses.
   */
  private async decide(approval: TerminalApproval, version: number): Promise<ApprovalDelivery> {
    const outcome = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'apply-approval-decision',
        permits: [REQUISITION_APPROVE],
        reason:
          'An approval chain reached its decision; the requisition it was about is asked to apply ' +
          'it, and decides for itself whether it may.',
      },
      () => {
        const command: DecideRequisitionCommand = {
          commandName: 'recruitment.decide-requisition',
          requisitionId: approval.subjectId,
          decision: approval.outcome,
          approvalId: approval.approvalId,
          expectedVersion: version,
        };

        return this.dispatcher.send<unknown>(command);
      },
    );

    // Recruitment's refusal is Recruitment's. Workflow reports *that* it refused, in its own words,
    // and does not translate a business rule it does not own.
    return outcome.ok ? applied : refused('subject-refused-the-decision');
  }
}
