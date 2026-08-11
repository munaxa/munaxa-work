import { uuidV7 } from '@work/kernel';

import {
  AttendanceAggregate,
  bilingualFrom,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  checkedMinutes,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './attendance-aggregate.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import {
  MINUTES_PER_DAY,
  ROUNDING_MODES,
  type DefinitionStatus,
  type PolicySource,
  type RoundingMode,
} from './attendance-vocabulary.js';

/**
 * How a tenant wants attendance interpreted.
 *
 * **Nothing statutory ships here.** There is no default overtime threshold, no default grace, no
 * default rounding and no country's working-time rule anywhere in this module. Which of those
 * applies is either the customer's decision or their jurisdiction's, and 00B is explicit that the
 * architecture holds the abstraction while the country pack holds the law. `source` is on the row
 * for exactly that reason: it reads `tenant` today, and Phase 11.1 writes `country_pack` without a
 * schema change (ADR-0054).
 *
 * **A policy is versioned and effective-dated**, and a calculated day stores which version it used.
 * A grace period widened in June must not retroactively forgive March's lateness, and storing the
 * live reference alone would let it.
 *
 * `overtimeThresholdMinutes` produces a *candidate*, and the word is load-bearing: Attendance says
 * how long somebody worked beyond what was expected, and Payroll decides what that is worth.
 */

export interface PolicyState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly source: PolicySource;
  readonly roundingMinutes: number;
  readonly roundingMode: RoundingMode;
  readonly lateToleranceMinutes: number;
  readonly earlyDepartureToleranceMinutes: number;
  readonly duplicateWindowSeconds: number;
  readonly clockSkewToleranceSeconds: number;
  readonly overtimeThresholdMinutes: number;
  readonly overtimeRequiresApproval: boolean;
  readonly absenceBlocksApproval: boolean;
  readonly status: DefinitionStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly versionNumber: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefinePolicy {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly roundingMinutes?: number;
  readonly roundingMode?: RoundingMode;
  readonly lateToleranceMinutes?: number;
  readonly earlyDepartureToleranceMinutes?: number;
  readonly duplicateWindowSeconds?: number;
  readonly clockSkewToleranceSeconds?: number;
  readonly overtimeThresholdMinutes?: number;
  readonly overtimeRequiresApproval?: boolean;
  readonly absenceBlocksApproval?: boolean;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

const MAX_ROUNDING_MINUTES = 60;
const MAX_TOLERANCE_MINUTES = 480;
const MAX_WINDOW_SECONDS = 86_400;

/**
 * What a tenant gets by configuring nothing.
 *
 * Every value here is the **inert** one — no rounding, no tolerance, overtime the moment the
 * expected day is exceeded, and nothing blocked. That is deliberate: a shipped fifteen-minute grace
 * would be this product deciding a labour-relations question for a customer who never asked, and a
 * shipped overtime threshold would be worse.
 *
 * `duplicateWindowSeconds` and `clockSkewToleranceSeconds` are the two exceptions, and they are
 * mechanical rather than statutory: zero would make every device retry a distinct punch and every
 * clock a divergent one.
 */
export const INERT_POLICY = {
  roundingMinutes: 0,
  roundingMode: 'none',
  lateToleranceMinutes: 0,
  earlyDepartureToleranceMinutes: 0,
  duplicateWindowSeconds: 60,
  clockSkewToleranceSeconds: 300,
  overtimeThresholdMinutes: 0,
  overtimeRequiresApproval: false,
  absenceBlocksApproval: false,
} as const;

export class AttendancePolicy extends AttendanceAggregate {
  private constructor(private state: PolicyState) {
    super(state.id, state.tenantId, state.version, 'AttendancePolicy');
  }

  public static define(
    request: DefinePolicy,
    occurredAt: Date,
  ): AttendanceResult<AttendancePolicy> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const period = checkedPeriod(request);

    if (!period.ok) return period;

    const numbers = checkedNumbers(request);

    if (!numbers.ok) return numbers;

    return accept(
      new AttendancePolicy({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        ...identity.value,
        ...period.value,
        ...numbers.value,
        overtimeRequiresApproval:
          request.overtimeRequiresApproval ?? INERT_POLICY.overtimeRequiresApproval,
        absenceBlocksApproval: request.absenceBlocksApproval ?? INERT_POLICY.absenceBlocksApproval,
        // Nothing writes `country_pack` in this phase. The value exists so Phase 11.1 needs no
        // migration, and a policy claiming statutory provenance it does not have would be worse
        // than one that says plainly that a tenant configured it.
        source: 'tenant',
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: PolicyState): AttendancePolicy {
    return new AttendancePolicy(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public publish(publishedBy: string, occurredAt: Date): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'draft') return refuse('policy_not_draft');

    this.state = { ...this.state, status: 'published', publishedAt: occurredAt, publishedBy };
    return accept(this.state.status);
  }

  public supersede(): AttendanceResult<DefinitionStatus> {
    if (this.state.status !== 'published') return refuse('policy_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state.status);
  }

  public snapshot(): PolicyState {
    return { ...this.state, version: this.version };
  }
}

const checkedIdentity = (
  request: DefinePolicy,
): AttendanceResult<Pick<PolicyState, 'code' | 'name' | 'metadata'>> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const metadata = checkedMetadata(request.metadata);

  if (!metadata.ok) return metadata;

  return accept({ code: code.value, name: name.value, metadata: metadata.value });
};

const checkedPeriod = (
  request: DefinePolicy,
): AttendanceResult<
  Pick<PolicyState, 'effectiveFrom'> & Partial<Pick<PolicyState, 'effectiveTo'>>
> => {
  const from = checkedCivilDate(request.effectiveFrom, 'effectiveFrom');

  if (!from.ok) return from;

  if (request.effectiveTo === undefined) return accept({ effectiveFrom: from.value });

  const to = checkedCivilDate(request.effectiveTo, 'effectiveTo');

  if (!to.ok) return to;
  if (to.value < from.value) return refuse('period_ends_before_it_begins');
  return accept({ effectiveFrom: from.value, effectiveTo: to.value });
};

type PolicyNumbers = Pick<
  PolicyState,
  | 'roundingMinutes'
  | 'roundingMode'
  | 'lateToleranceMinutes'
  | 'earlyDepartureToleranceMinutes'
  | 'duplicateWindowSeconds'
  | 'clockSkewToleranceSeconds'
  | 'overtimeThresholdMinutes'
>;

/**
 * Each configurable figure, with the value the tenant asked for and the ceiling it may not pass.
 *
 * A table rather than a chain of checks: seven independent bounds written as seven `if`s is seven
 * places to get an inclusive comparison wrong, and the loop below applies one rule to all of them.
 */
const boundedNumbers = (
  request: DefinePolicy,
): readonly [keyof PolicyNumbers, number, number][] => [
  [
    'roundingMinutes',
    request.roundingMinutes ?? INERT_POLICY.roundingMinutes,
    MAX_ROUNDING_MINUTES,
  ],
  [
    'lateToleranceMinutes',
    request.lateToleranceMinutes ?? INERT_POLICY.lateToleranceMinutes,
    MAX_TOLERANCE_MINUTES,
  ],
  [
    'earlyDepartureToleranceMinutes',
    request.earlyDepartureToleranceMinutes ?? INERT_POLICY.earlyDepartureToleranceMinutes,
    MAX_TOLERANCE_MINUTES,
  ],
  [
    'duplicateWindowSeconds',
    request.duplicateWindowSeconds ?? INERT_POLICY.duplicateWindowSeconds,
    MAX_WINDOW_SECONDS,
  ],
  [
    'clockSkewToleranceSeconds',
    request.clockSkewToleranceSeconds ?? INERT_POLICY.clockSkewToleranceSeconds,
    MAX_WINDOW_SECONDS,
  ],
  [
    'overtimeThresholdMinutes',
    request.overtimeThresholdMinutes ?? INERT_POLICY.overtimeThresholdMinutes,
    MINUTES_PER_DAY,
  ],
];

const checkedNumbers = (request: DefinePolicy): AttendanceResult<PolicyNumbers> => {
  const mode = request.roundingMode ?? INERT_POLICY.roundingMode;

  if (!ROUNDING_MODES.includes(mode)) return refuse('rounding_mode_unknown');

  const values: Record<string, number> = {};

  for (const [field, value, max] of boundedNumbers(request)) {
    const checked = checkedMinutes(value, field, { min: 0, max });

    if (!checked.ok) return checked;
    values[field] = checked.value;
  }
  return accept({
    ...(values as unknown as Omit<PolicyNumbers, 'roundingMode'>),
    roundingMode: mode,
  });
};

/** The policy in force on a civil date: published, and covering it. */
export const policyOn = (
  policies: readonly PolicyState[],
  civilDate: string,
): PolicyState | undefined =>
  policies.find(
    (policy) =>
      policy.status === 'published' &&
      policy.effectiveFrom <= civilDate &&
      (policy.effectiveTo === undefined || civilDate <= policy.effectiveTo),
  );

/**
 * Rounds a duration the way the policy says, and the caller keeps the original.
 *
 * A rounded figure that cannot say what it rounded from is a figure nobody can dispute, so the
 * calculation stores both: this returns the rounded value and the day records the raw worked
 * minutes beside it.
 */
export const roundMinutes = (minutes: number, policy: PolicyState): number => {
  if (policy.roundingMode === 'none' || policy.roundingMinutes === 0) return minutes;

  const step = policy.roundingMinutes;

  if (policy.roundingMode === 'down') return Math.floor(minutes / step) * step;
  if (policy.roundingMode === 'up') return Math.ceil(minutes / step) * step;
  return Math.round(minutes / step) * step;
};
