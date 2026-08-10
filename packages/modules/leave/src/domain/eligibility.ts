import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { daysBetween } from './leave-year.js';
import type { LeavePolicyState } from './leave-policy.js';

/**
 * Whether a policy permits this request, checked as a pure function over facts.
 *
 * **Evaluated at three moments, and the answer is recorded rather than recomputed later** (§9):
 * when an entitlement is created, when a request is made, and again when it is decided. The third
 * is the one people forget and the one that matters: a request submitted with balance and approved
 * a fortnight later, after that balance went elsewhere, must be refused at the decision rather than
 * silently approved into a deficit the policy prohibits.
 *
 * Every check here reads a **configured** value, and every configured value defaults to inert. A
 * policy with nothing set refuses nothing. There is no minimum service in this file, no notice
 * period, no annual cap and no probation rule — only the machinery to apply whichever ones a tenant
 * or a country pack chose (§22).
 *
 * The eligibility *rule* — the `RuleDefinition` a country pack supplies — is evaluated by the
 * application through the kernel engine, because a rule engine needs facts and produces a trace and
 * this function is deliberately incapable of either. What arrives here is its verdict.
 */

export interface RequestFacts {
  readonly employmentStartDate: string;
  /** Whole months of service as at the first date of leave. Computed by the kernel's service period. */
  readonly serviceMonths: number;
  readonly onProbation: boolean;
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalMinutes: number;
  /** The longest unbroken run of leave dates in the request, in minutes. */
  readonly consecutiveMinutes: number;
  /** What this employment has already taken of this type in this leave year. */
  readonly takenThisYearMinutes: number;
  readonly balanceMinutes: number;
  /** Today, as a civil date in the relevant zone. Supplied, never read from a clock here. */
  readonly today: string;
  /** Whether a blackout period covers any date of the request. */
  readonly blacked: boolean;
  /** Whether the eligibility rule matched, where the policy has one. */
  readonly ruleSatisfied: boolean;
  readonly hasAttachment: boolean;
}

/**
 * The checks, in the order a person would ask them.
 *
 * Order matters for the message somebody gets: being told "you have not served long enough" is more
 * useful than being told "your balance is insufficient" when both are true, because the first is
 * the reason and the second is a consequence.
 */
export const permits = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  const eligibility = checkEligibility(policy, facts);

  if (!eligibility.ok) return eligibility;

  const timing = checkTiming(policy, facts);

  if (!timing.ok) return timing;

  const limits = checkLimits(policy, facts);

  if (!limits.ok) return limits;

  return checkBalance(policy, facts);
};

const checkEligibility = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  if (facts.serviceMonths < policy.minimumServiceMonths) {
    return refuse('service_too_short', {
      required: String(policy.minimumServiceMonths),
      served: String(facts.serviceMonths),
    });
  }
  if (facts.onProbation && !policy.availableDuringProbation) {
    return refuse('not_available_during_probation');
  }
  if (policy.eligibilityRule !== undefined && !facts.ruleSatisfied) {
    return refuse('eligibility_rule_not_satisfied', { rule: policy.eligibilityRule.ruleId });
  }
  return accept(true);
};

/**
 * Notice and back-dating.
 *
 * Both are counted in whole civil days between today and the first date of leave, and both are zero
 * by default — a policy that has not configured notice does not require any. Back-dating is
 * separate from notice rather than a negative notice, because a policy commonly permits some of one
 * and none of the other.
 */
const checkTiming = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  const days = daysBetween(facts.today, facts.fromDate);

  if (days < 0) {
    const backdated = -days;

    return backdated > policy.maximumBackdateDays
      ? refuse('backdated_beyond_policy', {
          days: String(backdated),
          permitted: String(policy.maximumBackdateDays),
        })
      : accept(true);
  }
  if (days < policy.minimumNoticeDays) {
    return refuse('insufficient_notice', {
      given: String(days),
      required: String(policy.minimumNoticeDays),
    });
  }
  if (facts.blacked) return refuse('blackout_period');

  return accept(true);
};

const checkLimits = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  if (
    policy.maximumPerRequestMinutes !== undefined &&
    facts.totalMinutes > policy.maximumPerRequestMinutes
  ) {
    return refuse('request_exceeds_maximum');
  }
  if (
    policy.maximumConsecutiveMinutes !== undefined &&
    facts.consecutiveMinutes > policy.maximumConsecutiveMinutes
  ) {
    return refuse('exceeds_maximum_consecutive');
  }
  if (
    policy.maximumPerYearMinutes !== undefined &&
    facts.takenThisYearMinutes + facts.totalMinutes > policy.maximumPerYearMinutes
  ) {
    return refuse('exceeds_maximum_per_year');
  }
  return checkAttachment(policy, facts);
};

/**
 * Whether supporting evidence is required.
 *
 * Leave can require that a **reference is present**; it cannot verify that a document exists,
 * because no `DocumentPort` adapter is wired anywhere in this repository. The completion report
 * says so rather than claiming document upload works (§35.7).
 */
const checkAttachment = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  const threshold = policy.attachmentRequiredBeyondMinutes;

  if (threshold === undefined || facts.totalMinutes <= threshold) return accept(true);
  if (!facts.hasAttachment) return refuse('attachment_required');

  return accept(true);
};

/**
 * The balance floor.
 *
 * Three states, and the difference between two of them is the whole reason the column is nullable:
 * **absent** means the policy sets no floor and a deficit of any size is permitted; **zero** means
 * a deficit is prohibited outright; **N** means the balance may go as far as `-N` and no further.
 * Collapsing absent into zero would have an unconfigured policy silently prohibit something.
 */
const checkBalance = (policy: LeavePolicyState, facts: RequestFacts): LeaveResult<true> => {
  const limit = policy.negativeBalanceLimitMinutes;

  if (limit === undefined) return accept(true);

  const after = facts.balanceMinutes - facts.totalMinutes;

  if (after >= -limit) return accept(true);
  if (limit === 0) return refuse('insufficient_balance', { short: String(-after) });

  return refuse('exceeds_negative_balance_limit', {
    short: String(-after - limit),
    permitted: String(limit),
  });
};
