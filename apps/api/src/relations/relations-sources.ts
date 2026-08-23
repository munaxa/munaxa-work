import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { EmploymentDirectoryPort, MembershipDirectoryPort } from '@work/relations';
import type { EmploymentView } from '@work/employment';
import type { MembershipStandingView } from '@work/identity';

import type { Asking } from '../payroll/asking.js';

/** The permission the grant names. **No user holds it**; the grant is bounded and audited (ADR-0043). */
const EMPLOYMENT_READ = 'employment.read';

/**
 * One typed dispatch, local to this adapter.
 *
 * A local helper rather than a shared export, matching `documents-sources.ts`: a bare
 * `dispatcher.ask` narrows an object literal to `Query` and rejects the fields the query actually
 * carries, so each call site would need an assertion — and an assertion at every call site is an
 * assertion nobody reads.
 */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

/**
 * Whether an employment exists in this tenant — asked of Employment, through Employment's own
 * published read.
 *
 * **A boolean, and deliberately nothing more.** Relations needs to know that the employment a
 * violation is filed against is real and this tenant's. It does not need the person's name, their
 * status, their grade or their manager, and returning any of those would make this a directory a
 * disciplinary module has no business holding.
 *
 * **Another tenant's employment is `false`, indistinguishable from one that never existed.** The
 * read runs inside the caller's tenant context, so row-level security answers before this adapter
 * does — which is what stops `relations.record-violation` being used to enumerate another
 * organisation's workforce one identifier at a time.
 */
export class RelationsEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(employmentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'relations',
        operation: 'relations.record-violation',
        permits: [EMPLOYMENT_READ],
        reason: 'Confirming that the employment a violation is recorded against exists',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
        }),
    );

    return found.ok;
  }
}

/** The one permission this adapter ever holds inside another module. */
const MEMBERSHIP_READ = 'identity.membership.read';

interface MembershipStandingQuery extends Query {
  readonly queryName: 'identity.membership-standing';
  readonly membershipId: string;
}

/**
 * Whether the membership named as an investigator may act in this tenant.
 *
 * **An existing query, not a new one.** Identity publishes `identity.membership-standing` precisely
 * so a consumer needing this predicate does not receive a member's whole page; Workflow already
 * reaches it the same way for escalation, and this adapter is that one with a different reason
 * attached. No Identity change, no new permission, no widened contract.
 *
 * **`not_found` becomes `false`, and every other failure raises.** A membership that names nobody and
 * one that may not act are the same answer to the question this asks — *may this person conduct an
 * inquiry* — and row-level security makes another tenant's membership arrive as the first. A database
 * that cannot answer has not said no: reporting an outage as "this investigator is invalid" would
 * refuse every inquiry in the tenant while sending administrators to inspect memberships that are
 * perfectly fine.
 */
export class RelationsMembershipDirectory implements MembershipDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async canAct(membershipId: string): Promise<boolean> {
    const answered: Result<MembershipStandingView, HandlerFailure> = await runWithServiceGrant(
      {
        module: 'relations',
        operation: 'relations.open-investigation',
        permits: [MEMBERSHIP_READ],
        reason:
          'An investigation is conducted by somebody, and a membership that may no longer act in ' +
          'this tenant cannot be assigned to conduct one.',
      },
      () =>
        asking<MembershipStandingView, MembershipStandingQuery>(this.dispatcher, {
          queryName: 'identity.membership-standing',
          membershipId,
        }),
    );

    if (answered.ok) return answered.value.active;
    if (answered.error.kind === 'not_found') return false;

    throw new Error(
      `Identity could not answer a membership-standing question: ${answered.error.kind}`,
    );
  }
}
