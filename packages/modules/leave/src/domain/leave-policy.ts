import { uuidV7, type RuleDefinition } from '@work/kernel';

import {
  LeaveAggregate,
  bilingualFrom,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import {
  checkedAccrual,
  checkedCarryOver,
  checkedLeaveYear,
  checkedLimits,
  type AccrualSettings,
  type CarryOverSettings,
  type LeaveYearSettings,
  type LimitSettings,
} from './leave-policy-settings.js';
import type { DefinitionStatus } from './leave-vocabulary.js';

/**
 * The rules that govern a leave type for some part of the workforce, versioned and effective-dated.
 *
 * **Not one threshold in here ships with a value.** Every limit is nullable and inert, every accrual
 * figure defaults to zero and every carry-over method defaults to `none`. Twenty-one days after five
 * years is Jordanian law; ninety days of maternity is Saudi law; neither is this product's opinion,
 * and a "sensible default" is how a statutory rule creeps into a core module and becomes wrong in
 * the second country (§22).
 *
 * **A published version is immutable.** Changing a policy drafts the next version, and both the
 * request and the ledger entry record which version governed them — so a policy widened in June
 * does not retroactively re-entitle March. This is the rule Phase 7 established for plan versions
 * (ADR-0048) and Phase 8 for shifts and schedules, and it exists because somebody eventually
 * disputes a figure and the only defensible answer is the rules that were actually in force.
 *
 * **`leaveYearCalendar` is a first-class column** rather than a display preference, because it
 * changes *when entitlement resets*. A tenant with a Hijri statutory type and a Gregorian
 * discretionary one needs both, which is why the leave year lives on the policy version and not on
 * the tenant (§35.6).
 *
 * **`eligibilityRule` is a `RuleDefinition`**, evaluated by the kernel engine and versioned by
 * `versionInForce`. It is how a country pack supplies "eligible after ninety days of continuous
 * service in a permanent contract" as *data*, with a trace that explains a refusal — rather than as
 * a branch in this file that would have to be extended for the next jurisdiction.
 */

export interface LeavePolicyState
  extends LimitSettings, AccrualSettings, CarryOverSettings, LeaveYearSettings {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly versionNumber: number;
  readonly status: DefinitionStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly eligibilityRule?: RuleDefinition<boolean>;
  readonly approvalRequired: boolean;
  /** How many distinct humans must decide. Sequence, not routing — routing is Workflow's (§12.2). */
  readonly approvalsRequired: number;
  readonly selfApprovalPermitted: boolean;
  /** Eligibility only. What encashed leave is *worth* is Payroll's, and no column here holds it. */
  readonly encashable: boolean;
  readonly encashmentCapMinutes?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: string;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineLeavePolicy {
  readonly tenantId: string;
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly versionNumber?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly eligibilityRule?: RuleDefinition<boolean>;
  readonly limits?: Partial<LimitSettings>;
  readonly accrual?: Partial<AccrualSettings>;
  readonly carryOver?: Partial<CarryOverSettings>;
  readonly leaveYear?: Partial<LeaveYearSettings>;
  readonly approvalsRequired?: number;
  readonly selfApprovalPermitted?: boolean;
  readonly encashable?: boolean;
  readonly encashmentCapMinutes?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: string;
  readonly metadata?: Metadata;
}

const MAX_APPROVALS = 10;

export class LeavePolicy extends LeaveAggregate {
  private constructor(private state: LeavePolicyState) {
    super(state.id, state.tenantId, state.version, 'LeavePolicy');
  }

  public static define(request: DefineLeavePolicy, occurredAt: Date): LeaveResult<LeavePolicy> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const settings = checkedSettings(request);

    if (!settings.ok) return settings;

    const approval = checkedApproval(request);

    if (!approval.ok) return approval;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new LeavePolicy({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        leaveTypeId: request.leaveTypeId,
        ...identity.value,
        ...settings.value,
        ...approval.value,
        ...(request.eligibilityRule === undefined
          ? {}
          : { eligibilityRule: request.eligibilityRule }),
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: LeavePolicyState): LeavePolicy {
    return new LeavePolicy(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public get leaveTypeId(): string {
    return this.state.leaveTypeId;
  }

  /**
   * Freezes the version.
   *
   * Behind a permission of its own (`leave.policy.publish`), separate from drafting, because a
   * published policy governs everybody it is assigned to — and the person who drafts next year's
   * carry-over cap should not be the person who makes it binding without anyone else looking.
   */
  public publish(by: string, at: Date): LeaveResult<LeavePolicyState> {
    if (this.state.status !== 'draft') return refuse('leave_policy_not_draft');

    this.state = { ...this.state, status: 'published', publishedAt: at, publishedBy: by };
    return accept(this.state);
  }

  public supersede(): LeaveResult<LeavePolicyState> {
    if (this.state.status !== 'published') return refuse('leave_policy_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state);
  }

  public snapshot(): LeavePolicyState {
    return this.state;
  }
}

const checkedIdentity = (
  request: DefineLeavePolicy,
): LeaveResult<{
  readonly code: string;
  readonly name: BilingualText;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: string;
}> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const period = checkedPeriod(request);

  if (!period.ok) return period;

  const pack = checkedOptionalCode(request.countryPackId, 'countryPackId');

  if (!pack.ok) return pack;

  return accept({
    code: code.value,
    name: name.value,
    ...period.value,
    ...(pack.value === undefined ? {} : { countryPackId: pack.value }),
    ...(request.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: request.countryPackVersion }),
  });
};

const checkedPeriod = (
  request: DefineLeavePolicy,
): LeaveResult<{ readonly effectiveFrom: string; readonly effectiveTo?: string }> => {
  const from = checkedCivilDate(request.effectiveFrom, 'effectiveFrom');

  if (!from.ok) return from;

  const to = checkedOptionalCivilDate(request.effectiveTo, 'effectiveTo');

  if (!to.ok) return to;
  if (to.value !== undefined && to.value < from.value) {
    return refuse('period_ends_before_it_begins');
  }

  return accept({
    effectiveFrom: from.value,
    ...(to.value === undefined ? {} : { effectiveTo: to.value }),
  });
};

const checkedSettings = (
  request: DefineLeavePolicy,
): LeaveResult<LimitSettings & AccrualSettings & CarryOverSettings & LeaveYearSettings> => {
  const limits = checkedLimits(request.limits ?? {});

  if (!limits.ok) return limits;

  const accrual = checkedAccrual(request.accrual ?? {});

  if (!accrual.ok) return accrual;

  const carryOver = checkedCarryOver(request.carryOver ?? {});

  if (!carryOver.ok) return carryOver;

  const leaveYear = checkedLeaveYear(request.leaveYear ?? {});

  if (!leaveYear.ok) return leaveYear;

  return accept({ ...limits.value, ...accrual.value, ...carryOver.value, ...leaveYear.value });
};

/**
 * How many decisions the policy requires, and whether the requester may make one.
 *
 * `approvalRequired` is derived from the count rather than supplied beside it, because two fields
 * saying the same thing eventually disagree — and the database says the same with a check
 * constraint. `selfApprovalPermitted` defaults to **false**, and the domain refuses self-approval
 * regardless of grants where it is false; a check constraint refuses it in the database too, so a
 * path around this code cannot quietly reintroduce it (§12.3).
 */
const checkedApproval = (
  request: DefineLeavePolicy,
): LeaveResult<{
  readonly approvalRequired: boolean;
  readonly approvalsRequired: number;
  readonly selfApprovalPermitted: boolean;
  readonly encashable: boolean;
  readonly encashmentCapMinutes?: number;
}> => {
  const approvals = request.approvalsRequired ?? 1;

  if (!isWholeWithin(approvals, MAX_APPROVALS)) return refuse('approvals_required_out_of_range');

  const cap = request.encashmentCapMinutes;

  if (cap !== undefined && !isWholeWithin(cap, Number.MAX_SAFE_INTEGER)) {
    return refuse('minutes_out_of_range', { field: 'encashmentCapMinutes' });
  }

  return accept({
    approvalRequired: approvals > 0,
    approvalsRequired: approvals,
    selfApprovalPermitted: request.selfApprovalPermitted ?? false,
    encashable: request.encashable ?? false,
    ...(cap === undefined ? {} : { encashmentCapMinutes: cap }),
  });
};

const isWholeWithin = (value: number, max: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= max;
