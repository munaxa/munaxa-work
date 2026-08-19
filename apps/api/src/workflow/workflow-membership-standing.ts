import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { MembershipStanding, MembershipStandingPort } from '@work/workflow';
import type { MembershipStandingView } from '@work/identity';

import type { Asking } from '../payroll/asking.js';

/**
 * Whether the person an administrator wants to add to a stuck branch may act at all.
 *
 * **One question, one query, one grant.** No chain, no loop, no enumeration and no second read: the
 * membership named on the escalation command goes in, a predicate comes out. `WorkflowReportingLine`
 * needed three published answers to compose a manager; this needs one, because Identity was asked in
 * Checkpoint 8B to publish exactly this and nothing beside it.
 *
 * **`identity.membership.read`, and it is the register's own permission.** Notably the opposite of
 * the reporting-line adapter's reasoning, and for a reason worth keeping: that one deliberately
 * avoided `identity.membership.read` because reaching an *employment* identifier through
 * `identity.describe-member` would have handed the approvals engine the member register to read one
 * link. Here the fact **is** the register's — a membership's own lifecycle — so the register's read
 * permission is the narrowest one that means it, and `identity.membership-standing` exists so that
 * holding it returns one boolean rather than a member's whole page. The user never holds it: the
 * grant is entered inside a handler the pipeline has already authorized for
 * `workflow.approval.escalate`.
 *
 * **`not_found` becomes `false`, and that is the approved collapse** (D-16D-17, option A). Identity
 * distinguishes a membership that may not act from an identifier that names nobody, and keeps
 * distinguishing them; Workflow publishes one refusal for both, so the two answers meet here — at
 * Workflow's edge, where the decision was made — rather than inside Identity's contract.
 *
 * **Every other failure raises.** A database that cannot answer has not said no. Reporting an outage
 * as "this person may not act" would refuse every escalation in the tenant while sending each
 * administrator to inspect a membership that is perfectly fine, and nothing anywhere would record
 * that a dependency was down. `WorkflowReportingLine` and `WorkflowDelegations` draw the same line;
 * here it is sharper, because a wrong guess in one direction fails **open**.
 */

/** The one permission this adapter ever holds inside another module. */
const MEMBERSHIP_READ = 'identity.membership.read';

interface MembershipStandingQuery extends Query {
  readonly queryName: 'identity.membership-standing';
  readonly membershipId: string;
}

/** The dispatcher's `ask`, with the query's own shape kept for the compiler to check. */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

export class WorkflowMembershipStanding implements MembershipStandingPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async standing(membershipId: string): Promise<MembershipStanding> {
    const answered: Result<MembershipStandingView, HandlerFailure> = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-membership-standing',
        permits: [MEMBERSHIP_READ],
        reason:
          'An escalation adds an approver to a running approval, and somebody who may no longer ' +
          'act in this tenant cannot be asked to decide anything.',
      },
      () =>
        asking<MembershipStandingView, MembershipStandingQuery>(this.dispatcher, {
          queryName: 'identity.membership-standing',
          membershipId,
        }),
    );

    if (answered.ok) return { active: answered.value.active };

    // The one refusal that is an answer rather than a fault: nobody is named by this identifier, in
    // this tenant. Row-level security makes another tenant's membership arrive the same way, which is
    // the property that stops an identifier from being a probe.
    if (answered.error.kind === 'not_found') return { active: false };

    throw new Error(
      `Identity could not answer a membership-standing question: ${answered.error.kind}`,
    );
  }
}
