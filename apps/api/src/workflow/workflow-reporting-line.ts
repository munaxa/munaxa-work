import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { ManagerResolution, ReportingLinePort } from '@work/workflow';
import type { EmploymentLinkView, TenantMembershipView } from '@work/identity';
import type { EmploymentSnapshot } from '@work/employment';

import type { Asking } from '../payroll/asking.js';

/**
 * Who the requester's manager is, composed from three published answers and nothing else.
 *
 * **Three modules, three facts, and none of them is Workflow's.** Identity knows which employment a
 * member holds and which member an employment belongs to; Employment knows the reporting line. This
 * class asks each of them one bounded question and turns the answers into the domain's own
 * `ManagerResolution`. It decides nothing about approvals — `resolveManager` does that, and it is
 * the only place the four refusals and the self-approval rule live.
 *
 * **The chain is fixed and it is one level.**
 *
 * ```text
 * requester membership
 *   → identity.primary-employment-for-membership   (P-2: primary, and still linked)
 *   → employment.read-employment(asOf)             (P-3, P-4: primary line, one level, on the date)
 *   → identity.active-memberships-for-employment   (who may actually sign)
 * ```
 *
 * There is no fourth read, no loop, no enumeration and no recursion. Each step **short-circuits**:
 * a requester with no primary employment never reaches Employment, and an employment with no manager
 * never reaches Identity a second time. That is not an optimization — asking a later question after
 * an earlier one has already failed is how a chain acquires a fallback nobody approved.
 *
 * **Two memberships is a refusal, not a choice.** An employment may legitimately be held by two
 * members: `employment_link` is unique per `(membership, employment)` pair and nothing forbids a
 * second. Identity returns both and picks neither, deliberately, and so does this — there is no
 * ordering here, no `[0]`, no `is_primary` (which is unique per *member*, so both may carry it) and
 * no preference of any kind. B-1 approved a distinct outcome for it, and the reason it is distinct
 * from "nobody holds this job" is that they are opposite problems for different people to fix.
 *
 * **A failure is not an answer.** If a module cannot be asked, this raises rather than returning a
 * refusal: reporting an Identity outage as "you have no manager" would tell an administrator to go
 * and fix a reporting line that is perfectly correct, and nothing anywhere would record that a
 * dependency was down. `WorkflowDelegations` draws the same line, and its comment calls it the most
 * important one in the file. A **business** absence — no link, no manager, no member — is an
 * outcome, because it is a fact about the organization rather than about the system.
 *
 * **The date is the caller's.** `asOfDate` arrives from `resolutionDateOf`, which pins the approval's
 * own start instant to a UTC civil date (P-6). Nothing here reads a clock, and the same instance
 * resolved twice asks Employment about the same day.
 *
 * **Two grants, both already existing and both employment-scoped.** `identity.employment-link.read`
 * and `employment.employment.read`. Notably **not** `identity.membership.read`: reaching the
 * requester's employment through `identity.describe-member` would have handed the approvals engine
 * the tenant's member register to read one identifier, which is why B-2 authorized a second narrow
 * Identity query instead.
 */

/** The two permissions this adapter ever holds inside another module. Employment-scoped, both. */
const EMPLOYMENT_LINK_READ = 'identity.employment-link.read';
const EMPLOYMENT_READ = 'employment.employment.read';

/** The dispatcher's `ask`, with the query's own shape kept for the compiler to check. */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface PrimaryEmploymentQuery extends Query {
  readonly queryName: 'identity.primary-employment-for-membership';
  readonly membershipId: string;
}

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  readonly asOf: Date;
}

interface ActiveMembershipsQuery extends Query {
  readonly queryName: 'identity.active-memberships-for-employment';
  readonly employmentId: string;
}

/**
 * A published answer, or an exception naming which module could not give one.
 *
 * The distinction §15 turns on, in one function: a handler that answered is an answer, whatever it
 * said; a handler that could not be reached is a fault. A caller that collapsed the two would turn
 * every outage into a business outcome, and the outcome it would choose is "this person has no
 * manager".
 */
const answered = async <TResult>(
  module: string,
  found: Promise<Result<TResult, HandlerFailure>>,
): Promise<TResult> => {
  const result = await found;

  if (!result.ok) {
    throw new Error(`${module} could not answer a reporting-line question: ${result.error.kind}`);
  }
  return result.value;
};

/**
 * The civil date Employment is asked about, as an instant at UTC midnight.
 *
 * Employment's contract takes `asOf` as a `Date` and Workflow holds the day as `YYYY-MM-DD`, so
 * somebody has to turn one into the other. `Date.parse` of a bare date string is **defined** to be
 * UTC midnight, which is the same convention `resolutionDateOf` used to produce the string — so the
 * round trip is exact and no local zone is involved at either end.
 */
const instantOf = (asOfDate: string): Date => new Date(`${asOfDate}T00:00:00.000Z`);

export class WorkflowReportingLine implements ReportingLinePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async managerOf(
    requesterMembershipId: string,
    asOfDate: string,
  ): Promise<ManagerResolution> {
    const employmentId = await this.primaryEmploymentOf(requesterMembershipId);

    if (employmentId === undefined) return { outcome: 'no-primary-employment' };

    const managerEmploymentId = await this.managerEmploymentOf(employmentId, asOfDate);

    if (managerEmploymentId === undefined) return { outcome: 'no-manager' };

    const holders = await this.activeMembershipsOf(managerEmploymentId);
    const [only] = holders;

    if (only === undefined) return { outcome: 'manager-not-a-member' };
    // Two people hold this job and nothing here says which of them approves (B-1). Refused rather
    // than chosen: there is no ordering in this branch and no index into the list.
    if (holders.length > 1) return { outcome: 'manager-membership-ambiguous' };

    return {
      outcome: 'resolved',
      employmentId,
      managerEmploymentId,
      managerMembershipId: only.id,
    };
  }

  /** The requester's primary **and still linked** employment. P-2, as Identity already defines it. */
  private async primaryEmploymentOf(membershipId: string): Promise<string | undefined> {
    const link = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-primary-employment',
        permits: [EMPLOYMENT_LINK_READ],
        reason:
          'A manager step asks the requester’s manager, and the reporting line hangs off the ' +
          'employment they hold rather than off the membership that raised the approval.',
      },
      () =>
        answered<EmploymentLinkView | undefined>(
          'Identity',
          asking<EmploymentLinkView | undefined, PrimaryEmploymentQuery>(this.dispatcher, {
            queryName: 'identity.primary-employment-for-membership',
            membershipId,
          }),
        ),
    );

    return link?.employmentId;
  }

  /**
   * The manager in force on the date, along the **primary** line and exactly one level up.
   *
   * Both of those are Employment's own semantics rather than a filter applied here:
   * `EmploymentView.managerEmploymentId` is documented as *"the manager in force on `asOf`, by
   * employment"*, resolved from the primary reporting lines alone. This adapter neither re-derives it
   * nor looks past it — reading `reportingLines` and choosing would be a second definition of P-3,
   * and following the answer upwards again would be the recursion P-4 forbids.
   */
  private async managerEmploymentOf(
    employmentId: string,
    asOfDate: string,
  ): Promise<string | undefined> {
    const snapshot = await runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-primary-manager',
        permits: [EMPLOYMENT_READ],
        reason:
          'Employment owns the reporting line, and a manager step needs the manager in force on ' +
          'the day the approval was raised.',
      },
      () =>
        answered<EmploymentSnapshot>(
          'Employment',
          asking<EmploymentSnapshot, ReadEmploymentQuery>(this.dispatcher, {
            queryName: 'employment.read-employment',
            employmentId,
            asOf: instantOf(asOfDate),
          }),
        ),
    );

    return snapshot.employment.managerEmploymentId;
  }

  /** Who may actually sign for that employment. Every holder, in Identity's order, none discarded. */
  private activeMembershipsOf(employmentId: string): Promise<readonly TenantMembershipView[]> {
    return runWithServiceGrant(
      {
        module: 'workflow',
        operation: 'read-manager-membership',
        permits: [EMPLOYMENT_LINK_READ],
        reason:
          'A step must name somebody who can sign, so the manager’s employment is resolved to the ' +
          'membership that holds it before anybody is asked.',
      },
      () =>
        answered<readonly TenantMembershipView[]>(
          'Identity',
          asking<readonly TenantMembershipView[], ActiveMembershipsQuery>(this.dispatcher, {
            queryName: 'identity.active-memberships-for-employment',
            employmentId,
          }),
        ),
    );
  }
}
