import type {
  ApprovalDelivery,
  BusinessDecisionPort,
  DelegationGrant,
  DelegationPort,
  TerminalApproval,
} from './workflow-ports.js';
import type { ManagerResolution } from '../domain/manager.js';
import type { ReportingLinePort } from './workflow-reporting-line.js';
import type { MembershipStanding, MembershipStandingPort } from './workflow-membership-standing.js';

/** One delegation a suite arranged, as the fake stores it. */
interface Arrangement {
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  readonly scope: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  revoked: boolean;
}

/**
 * The four cross-module seams Workflow reaches through, faked for the application suites.
 *
 * Extracted from the harness so that the harness is the *machinery* — contexts, dispatch, unwrapping
 * — and this is the *world* those suites run against. Each records what it was asked, because most of
 * what these suites prove is not what came back but that the question was asked once, for the right
 * person, and not at all when an earlier rule refused first.
 */

/**
 * Identity, answering who is currently acting for whom.
 *
 * The period test is Identity's own: **half-open**, inclusive at the start and exclusive at the end,
 * and a revoked arrangement is never in force whatever its dates say. Identity's aggregate computes
 * this from the period rather than from a stored status, because *"a status is only as fresh as the
 * last job that updated it"* — and there is no such job.
 */
export class FakeDelegation implements DelegationPort {
  private readonly arrangements: Arrangement[] = [];

  public grant(
    delegator: string,
    delegate: string,
    period: { readonly from: Date; readonly to: Date },
    scope = 'workflow.approval.decide',
  ): void {
    this.arrangements.push({
      delegatorMembershipId: delegator,
      delegateMembershipId: delegate,
      scope,
      effectiveFrom: period.from,
      effectiveTo: period.to,
      revoked: false,
    });
  }

  public revokeAll(): void {
    for (const arrangement of this.arrangements) arrangement.revoked = true;
  }

  public activeFor(
    delegateMembershipId: string,
    atInstant: Date,
  ): Promise<readonly DelegationGrant[]> {
    return Promise.resolve(
      this.arrangements
        .filter(
          (arrangement) =>
            arrangement.delegateMembershipId === delegateMembershipId &&
            !arrangement.revoked &&
            arrangement.effectiveFrom.getTime() <= atInstant.getTime() &&
            atInstant.getTime() < arrangement.effectiveTo.getTime(),
        )
        .map((arrangement) => ({
          delegatorMembershipId: arrangement.delegatorMembershipId,
          delegateMembershipId: arrangement.delegateMembershipId,
          scope: arrangement.scope,
        })),
    );
  }
}

/**
 * Employment and Identity, answering who somebody's manager is on a given day.
 *
 * **It records every question it was asked**, and half the manager suite is about that list rather
 * than about the answers: asked once for a process naming two managers, asked not at all for a
 * process naming none, and asked with the approval's own UTC date. A double that only returned
 * answers could not demonstrate any of it.
 *
 * **The default is `no-primary-employment`** rather than a resolved manager. A test that forgot to
 * arrange one then fails closed, which is the behaviour under test; a double that invented a manager
 * by default would make every unarranged suite pass for the wrong reason.
 *
 * This is a **test** double and there is deliberately no production counterpart: the adapter belongs
 * to Checkpoint 7, after Identity's own query is built and verified on its own side (Checkpoint 6). A
 * fake in a real composition would be a manager Workflow made up.
 */
export class FakeReportingLine implements ReportingLinePort {
  public readonly asked: { readonly membershipId: string; readonly asOfDate: string }[] = [];
  private answer: ManagerResolution = { outcome: 'no-primary-employment' };

  public answers(resolution: ManagerResolution): void {
    this.answer = resolution;
  }

  public managerOf(requesterMembershipId: string, asOfDate: string): Promise<ManagerResolution> {
    this.asked.push({ membershipId: requesterMembershipId, asOfDate });
    return Promise.resolve(this.answer);
  }
}

/**
 * Whether the person being escalated to may act, for the application suites.
 *
 * **Active by default**, so every suite that is not about eligibility keeps testing what it was
 * written to test. The two interesting behaviours are set explicitly: `inactiveFor` covers both
 * Identity answers the adapter collapses — a suspended member and an identifier naming nobody —
 * because D-16D-17 (A) makes them one Workflow refusal, and `failsWith` covers the case that must
 * **raise** rather than answer.
 *
 * `asked` is recorded so a suite can prove the read happened **once, for the named membership** —
 * and, just as usefully, that it did not happen at all when an earlier rule refused first.
 */
export class FakeMembershipStanding implements MembershipStandingPort {
  public readonly asked: string[] = [];
  private inactive = new Set<string>();
  private failure: Error | undefined;

  public inactiveFor(membershipId: string): void {
    this.inactive.add(membershipId);
  }

  public failsWith(error: Error): void {
    this.failure = error;
  }

  public standing(membershipId: string): Promise<MembershipStanding> {
    this.asked.push(membershipId);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return Promise.resolve({ active: !this.inactive.has(membershipId) });
  }
}

/**
 * The adopting module, for the application suites.
 *
 * **It records and refuses, and it never pretends to be a database.** What the application layer has
 * to be right about is the *order*: the owning module is asked before Workflow writes anything, and a
 * refusal from it leaves no decision row. Whether a requisition may legally move is Recruitment's
 * question, proved against the real module in the cross-module suites.
 *
 * The default answer is `not-adopted`, which is the honest default: ten of the eleven modules that
 * could route approvals have not adopted Workflow, and their subjects reach this seam and go no
 * further.
 */
export class FakeBusinessDecisions implements BusinessDecisionPort {
  public readonly delivered: TerminalApproval[] = [];
  private answer: ApprovalDelivery = { kind: 'not-adopted' };

  public answers(delivery: ApprovalDelivery): void {
    this.answer = delivery;
  }

  public apply(approval: TerminalApproval): Promise<ApprovalDelivery> {
    this.delivered.push(approval);
    return Promise.resolve(this.answer);
  }
}
