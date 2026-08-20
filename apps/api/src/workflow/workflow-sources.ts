import {
  currentMembershipId,
  runWithServiceGrant,
  type HandlerFailure,
  type Query,
  type Result,
} from '@work/kernel';
import type { DelegationGrant, DelegationPort } from '@work/workflow';
import type { DelegationView } from '@work/identity';

import type { Asking } from '../payroll/asking.js';

/**
 * Workflow's one cross-module adapter, and the whole of its outward surface in Phase 16A.
 *
 * **One module, one query, one permission.** Workflow routes decisions and holds no business data,
 * so it needs no employment, no position, no person and no document: an approver is a membership the
 * tenant configured, and the subject of an approval is an opaque identifier the requesting module
 * supplied (AD-001). The only thing it cannot answer for itself is whether the person deciding is
 * currently acting for somebody else — and that is Identity's fact, published for exactly this
 * (AD-010, D-2).
 *
 * **There is no Recruitment adapter here, and no `ApprovalPort` implementation.** Checkpoint 7 owns
 * the write seam into an adopting module, and giving it a path in this file before the checkpoint
 * that is meant to prove it is how an unproven seam ships. Nothing below writes anything, anywhere.
 *
 * **There is no `IdentityPort`.** A general client for another module is a grant that grows: this
 * class exposes one method answering one question, and there is no shape in which a caller could
 * reach `identity.list-memberships`, `identity.search-members` or any other tenant-wide enumeration
 * through it.
 *
 * **There is no `JobPort`, no notification port, no storage port and no search port**, so nothing in
 * this module runs when nobody is asking. A delegation is read *at the instant of the decision*
 * rather than watched, which is why no expiry job is needed and why none exists.
 */

/** The one permission this module ever holds inside another, and the plan's X-1 grant exactly. */
const DELEGATION_READ = 'identity.delegation.read';

/**
 * The membership on the current request, or nothing.
 *
 * Read from the ambient execution context — the seam Checkpoint 4 added — rather than taken from a
 * command, a header or a query parameter. It is the same reading the application's own
 * `currentMembership()` performs, restated here because `workflow-context.ts` is internal to the
 * module and publishing it would put `notFound`, `forbidden` and the rest of a handler's toolkit on
 * Workflow's public surface for the sake of one field.
 *
 * A system context names no member on purpose, and neither does a machine one: nothing running
 * without a human behind it is acting under anybody's delegation.
 */
const membershipOnThisRequest = (): string | undefined => currentMembershipId();

/** The dispatcher's `ask`, with the query's own shape kept for the compiler to check. */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

/**
 * Identity's published query, restated so the compiler checks what is sent.
 *
 * `atInstant` is a `Date`, because that is what the contract declares. The plan flagged this as the
 * one place Workflow's instants meet another module's, and the answer is that they agree: a decision
 * happens at a moment, and a delegation period is checked against that moment.
 */
interface ActiveDelegationsForQuery extends Query {
  readonly queryName: 'identity.active-delegations-for';
  readonly delegateMembershipId: string;
  readonly atInstant: Date;
}

/**
 * What Workflow needs from a delegation, and nothing else about it.
 *
 * `DelegationView` also carries an identifier, a period, a status and the reason somebody typed when
 * granting it. **The adapter maps and discards**, so nothing downstream can come to depend on a
 * field Workflow has no business holding — and above all so no code here can start deciding whether
 * a delegation is in force from a `status`, which is a question Identity has already answered.
 */
const grantOf = (view: DelegationView): DelegationGrant => ({
  delegatorMembershipId: view.delegatorMembershipId,
  delegateMembershipId: view.delegateMembershipId,
  scope: view.scope,
});

/**
 * Who the caller is currently acting for — asked of Identity, at the instant of the decision.
 *
 * **The membership comes from the execution context and from nowhere else.** Checkpoint 4 added
 * `membershipId` to the ambient context for this, resolved by the tenant middleware from the
 * authenticated request. This adapter re-checks it rather than trusting its argument: the one caller
 * in the application passes the caller's own membership, and a future one that passed somebody
 * else's would be asking Identity "who is *that person* acting for", which is a different and much
 * broader question than the one this grant was approved for.
 *
 * **A missing membership is not "everybody".** A reconciliation command, a migration and a
 * hand-built context name no membership; the honest answer for them is that nobody is acting for
 * anybody, which the decision use case turns into a refusal.
 *
 * **Nothing here decides anything about a workflow.** No period is re-evaluated, no status is
 * re-read, no scope is matched and no lifecycle rule is applied. Identity decides what is in force
 * at an instant; `DELEGABLE_SCOPES` in the application decides which scopes Workflow honours; the
 * domain decides what a delegated decision records. This class translates, and that is all.
 */
export class WorkflowDelegations implements DelegationPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async activeFor(
    delegateMembershipId: string,
    atInstant: Date,
  ): Promise<readonly DelegationGrant[]> {
    const caller = membershipOnThisRequest();

    // Fail closed, twice. No membership on the request, or an argument naming somebody other than
    // the person whose request this is, and Identity is not asked at all.
    if (caller === undefined || caller !== delegateMembershipId) return [];

    const found = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-active-delegations',
        permits: [DELEGATION_READ],
        reason:
          'An approver who is not the assigned one may be acting for them; Identity is asked ' +
          'whether they are, at the instant of the decision.',
      },
      () =>
        asking<readonly DelegationView[], ActiveDelegationsForQuery>(this.dispatcher, {
          queryName: 'identity.active-delegations-for',
          delegateMembershipId: caller,
          atInstant,
        }),
    );

    /**
     * **Not having an answer is not the same as being told "nobody".**
     *
     * `DelegationPort.activeFor` returns a list, so there is no third value in which "I could not
     * ask" could be expressed — and returning `[]` for a failure would express it as *"nobody has
     * delegated to you"*, which the decision use case renders as "this step was not assigned to
     * you". An approver whose deputy is locked out by an Identity outage would be told, calmly and
     * wrongly, that the step is not theirs, and nothing anywhere would record that a dependency was
     * down. Career's adapters draw the same line in the one shape their ports allow, and its comment
     * calls it the most important line in the file.
     *
     * So a failure raises. The decision is refused either way — the transaction rolls back and
     * nothing is recorded, which is what "fail closed" has to mean when the dependency being asked
     * is the one that says who may decide — but it is refused *loudly*, as the fault it is, rather
     * than quietly as a business outcome it is not.
     *
     * A rejected promise from `ask` propagates on its own; these two are the cases that would
     * otherwise pass silently: Identity answering with a failure, and Identity answering with
     * something that is not a list.
     */
    if (!found.ok) {
      throw new Error(`Identity could not answer active-delegations-for: ${found.error.kind}`);
    }
    if (!Array.isArray(found.value)) {
      throw new Error(
        'Identity answered active-delegations-for with something that is not a list.',
      );
    }
    return found.value.map(grantOf);
  }
}
