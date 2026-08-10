import { serviceBetween, type Facts, type Transaction } from '@work/kernel';

import { blocksDate } from '../domain/policy-assignment.js';
import {
  breakdownOf,
  type Breakdown,
  type ExpectedDay,
  type PortionRequest,
} from '../domain/duration.js';
import { instantOf, leaveYearFor, type LeaveYear } from '../domain/leave-year.js';
import { accept, refuse, type LeaveResult } from '../domain/leave-rejection.js';
import { permits, type RequestFacts } from '../domain/eligibility.js';
import { resolvePolicy, ruleSatisfiedBy } from './policy-resolution.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { EmploymentForLeave } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Everything that has to be worked out before a leave request can exist, in one place.
 *
 * Shared between creating a request and deciding one, because **the checks are re-run at the
 * decision** (§9). A request submitted with balance and approved a fortnight later, after that
 * balance went elsewhere, must be refused at the decision rather than silently approved into a
 * deficit the policy prohibits. Two copies of this logic would eventually disagree about which
 * check that was.
 *
 * The order is not arbitrary. Employment first, because the policy is resolved from where somebody
 * sits; the policy next, because it decides whether the duration is counted in working days;
 * Attendance's working-day read after that, because the breakdown needs it; and eligibility last,
 * because it needs the total the breakdown produced.
 *
 * **`known: false` from Attendance is refused by name.** A `working_days` request against a
 * repository where Attendance cannot answer is refused as `no_working_pattern`, never silently
 * counted as calendar days. Counting it would mis-charge the entitlement of exactly the people
 * least likely to notice — casual workers with no schedule (§19).
 */

export interface PlanInput {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly portions: readonly PortionRequest[];
  readonly hasAttachment: boolean;
  /** Today, as a civil date. Supplied by the caller from the injected clock. */
  readonly today: string;
}

export interface Plan {
  readonly employment: EmploymentForLeave;
  readonly policy: LeavePolicyState;
  readonly leaveYear: LeaveYear;
  readonly breakdown: Breakdown;
  readonly balanceMinutes: number;
}

export const planRequest = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  input: PlanInput,
): Promise<LeaveResult<Plan>> => {
  const employment = await dependencies.employment.find(input.employmentId, input.fromDate);

  if (employment === undefined) return refuse('employment_not_found');

  const resolved = await resolvePolicy(transaction, dependencies, {
    employment,
    leaveTypeId: input.leaveTypeId,
    onDate: input.fromDate,
  });

  if (!resolved.ok) return resolved;

  const { policy } = resolved.value;
  const breakdown = await computeBreakdown(dependencies, employment, policy, input);

  if (!breakdown.ok) return breakdown;

  const leaveYear = leaveYearFor(policy, input.fromDate);
  const balance = await dependencies.stores.balances.forBucket(transaction, {
    employmentId: employment.employmentId,
    leaveTypeId: input.leaveTypeId,
    leaveYearStart: leaveYear.start,
  });
  const balanceMinutes = balance?.availableMinutes ?? 0;
  const allowed = await checkEligibility(transaction, dependencies, {
    employment,
    policy,
    leaveYear,
    breakdown: breakdown.value,
    balanceMinutes,
    input,
  });

  if (!allowed.ok) return allowed;

  return accept({ employment, policy, leaveYear, breakdown: breakdown.value, balanceMinutes });
};

/**
 * The day breakdown, computed against whichever basis the policy configured.
 *
 * Under `working_days` this is Attendance's answer and nothing else. Under `calendar_days` the
 * expectations are still asked for — a date Attendance knows about uses its real length rather than
 * a nominal one — and the fallback length comes from the employment's contracted hours.
 */
const computeBreakdown = async (
  dependencies: LeaveDependencies,
  employment: EmploymentForLeave,
  policy: LeavePolicyState,
  input: PlanInput,
): Promise<LeaveResult<Breakdown>> => {
  const answer = await dependencies.workingDays.expectedWorkingDays(
    employment.employmentId,
    input.fromDate,
    input.toDate,
  );

  if (policy.durationBasis === 'working_days' && !answer.known) {
    return refuse('no_working_pattern');
  }

  const expectations: readonly ExpectedDay[] = answer.known ? answer.days : [];
  const standard = standardDayMinutes(employment);

  return breakdownOf({
    fromDate: input.fromDate,
    toDate: input.toDate,
    basis: policy.durationBasis,
    expectations,
    portions: input.portions,
    ...(standard === undefined ? {} : { standardDayMinutes: standard }),
    halfDayPermitted: policy.halfDayPermitted,
    hourlyPermitted: policy.hourlyPermitted,
  });
};

const DAYS_PER_WORKING_WEEK = 5;
const MINUTES_PER_HOUR = 60;

/**
 * A day's length from the employment's contracted hours, where Employment knows them.
 *
 * **Absent is a real answer**, and it propagates: a `calendar_days` request for somebody whose
 * contracted hours are unknown is refused rather than computed against an invented eight-hour day.
 * There is no default working day in this product, and choosing one would be a labour-relations
 * decision for a customer who never asked (§18).
 *
 * The five-day divisor is stated rather than configured, and that is a limitation worth naming: a
 * tenant running a six-day week and using `calendar_days` gets a day length a sixth too long. The
 * remedy is `working_days`, which asks Attendance and gets the real pattern.
 */
const standardDayMinutes = (employment: EmploymentForLeave): number | undefined => {
  if (employment.workingHoursPerWeek === undefined || employment.workingHoursPerWeek <= 0) {
    return undefined;
  }
  return Math.round((employment.workingHoursPerWeek * MINUTES_PER_HOUR) / DAYS_PER_WORKING_WEEK);
};

interface EligibilityInput {
  readonly employment: EmploymentForLeave;
  readonly policy: LeavePolicyState;
  readonly leaveYear: LeaveYear;
  readonly breakdown: Breakdown;
  readonly balanceMinutes: number;
  readonly input: PlanInput;
}

const checkEligibility = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: EligibilityInput,
): Promise<LeaveResult<true>> => {
  const blacked = await blackedOut(transaction, dependencies, context);
  const taken = await takenThisYear(transaction, dependencies, context);
  const facts = requestFacts(context, { blacked, taken });

  return permits(context.policy, facts);
};

/** Whether any date of the request falls inside a blackout that covers this employment's scopes. */
const blackedOut = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: EligibilityInput,
): Promise<boolean> => {
  const periods = await dependencies.stores.blackouts.between(
    transaction,
    context.input.fromDate,
    context.input.toDate,
  );
  const scopes = new Set(
    [
      context.employment.employmentId,
      context.employment.unitId,
      context.employment.legalEntityId,
    ].filter((one): one is string => one !== undefined),
  );

  return periods.some(
    (period) =>
      (period.scope === 'tenant' || (period.scopeId !== undefined && scopes.has(period.scopeId))) &&
      context.breakdown.days.some((day) =>
        blocksDate(period, day.onDate, context.input.leaveTypeId),
      ),
  );
};

/** What this employment has already consumed of this type in this leave year. */
const takenThisYear = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: EligibilityInput,
): Promise<number> => {
  const entries = await dependencies.stores.ledger.forBucket(transaction, {
    employmentId: context.employment.employmentId,
    leaveTypeId: context.input.leaveTypeId,
    leaveYearStart: context.leaveYear.start,
  });

  return -entries
    .filter((entry) => entry.kind === 'consumption')
    .reduce((sum, entry) => sum + entry.minutes, 0);
};

const MONTHS_PER_YEAR = 12;

const requestFacts = (
  context: EligibilityInput,
  found: { readonly blacked: boolean; readonly taken: number },
): RequestFacts => {
  const service = serviceBetween(
    instantOf(context.employment.startDate),
    instantOf(context.input.fromDate),
  );
  const serviceMonths = service.years * MONTHS_PER_YEAR + service.months;
  const facts: RequestFacts = {
    employmentStartDate: context.employment.startDate,
    serviceMonths,
    onProbation: context.employment.onProbation ?? false,
    fromDate: context.input.fromDate,
    toDate: context.input.toDate,
    totalMinutes: context.breakdown.totalMinutes,
    consecutiveMinutes: context.breakdown.totalMinutes,
    takenThisYearMinutes: found.taken,
    balanceMinutes: context.balanceMinutes,
    today: context.input.today,
    blacked: found.blacked,
    ruleSatisfied: ruleSatisfiedBy(context.policy, ruleFacts(context, serviceMonths)),
    hasAttachment: context.input.hasAttachment,
  };

  return facts;
};

/**
 * The facts a country pack's eligibility rule may read.
 *
 * A deliberately small, stated set. A rule cannot reach the request's justification, the person
 * behind the employment or anything Leave does not own — the engine is sandboxed and this is the
 * whole surface it sees.
 */
const ruleFacts = (context: EligibilityInput, serviceMonths: number): Facts => ({
  serviceMonths,
  onProbation: context.employment.onProbation ?? false,
  employmentStatus: context.employment.status,
  totalMinutes: context.breakdown.totalMinutes,
  balanceMinutes: context.balanceMinutes,
  leaveTypeId: context.input.leaveTypeId,
  fromDate: context.input.fromDate,
});

/**
 * A note on `consecutiveMinutes`.
 *
 * A request covers a contiguous date range, so the whole of it is one unbroken run of leave — a
 * weekend in the middle produces no row but does not interrupt the absence, which is what
 * "maximum consecutive leave" means to everybody who configures it. So the figure passed to the
 * policy check is the request's own total.
 *
 * What this does **not** do is join two adjacent requests into one run. Somebody taking the
 * permitted maximum twice, back to back, passes both checks. Catching that needs a rule about
 * *gaps between requests* that no policy field here expresses, and inventing one would be deciding
 * a labour-relations question on a customer's behalf. It is recorded as a limitation rather than
 * approximated.
 */
