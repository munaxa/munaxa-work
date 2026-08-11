import { digestOf, digestOfSet } from './digest.js';
import type { MoneyAmount } from './money-amount.js';

/**
 * The immutable record of **what Payroll consumed** — the centre of ADR-0064.
 *
 * These are Payroll's declarations of the four published contracts it reads, not copies of another
 * module's tables. They are declared here, in the domain, because the pure calculation stages take
 * a snapshot and nothing else, and a domain that imported its inputs from the application layer
 * would invert the dependency the architecture gate enforces. The adapters in the application layer
 * map each published view onto the shape below and add nothing.
 *
 * **Every field is a fact somebody else established.** Nothing here is derived, interpreted or
 * defaulted: an absent value means the source did not supply one, and the calculation decides what
 * that means rather than the mapping quietly filling it in.
 */

/** What Employment said, as at the period. `statusOn` answers "then", never "now". */
export interface EmploymentFacts {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly costCenterId?: string;
  readonly employmentTypeCode: string;
  readonly version: number;
}

/** One compensation component, exactly as `compensation.payroll-period` published it. */
export interface CompensationComponentFacts {
  readonly componentId: string;
  readonly componentCode: string;
  readonly kind: string;
  /** Compensation stored this and never read it; Payroll is where it is finally interpreted. */
  readonly payrollTreatmentCode: string;
  readonly proratable: boolean;
  readonly amount: MoneyAmount;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  /** Compensation's own statement that the component does not span the whole period. */
  readonly partialPeriod: boolean;
  /** Where a percentage-resolved amount came from. Recorded, never re-derived (ADR-0062). */
  readonly resolvedFromBasisPoints?: number;
}

export interface CompensationOneTimeFacts {
  readonly oneTimeId: string;
  readonly componentId: string;
  readonly componentCode: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly payableOn: string;
}

/** One currency's block. **Nothing is ever combined across blocks** (ADR-0067). */
export interface CompensationCurrencyFacts {
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly recurring: readonly CompensationComponentFacts[];
  readonly oneTime: readonly CompensationOneTimeFacts[];
}

export interface CompensationFacts {
  readonly currencies: readonly CompensationCurrencyFacts[];
  readonly compensationPlanId?: string;
  readonly planVersion?: number;
  readonly inputsDigest: string;
  readonly calculationVersion: number;
}

/**
 * What Attendance froze.
 *
 * `overtimeCandidateMinutes` is carried because it is part of what Attendance said, and **nothing
 * in this module reads it into an earning line** — it is a candidate, and no configuration promotes
 * a candidate into an approved fact (ADR-0065).
 *
 * `blockingExceptions` and `leaveState` are refusal signals rather than decoration: a snapshot
 * Attendance itself distrusts is not a payable input.
 */
export interface AttendanceFacts {
  readonly snapshotId: string;
  readonly sequence: number;
  readonly frozenAt: Date;
  readonly workedMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  readonly leaveMinutes: number;
  readonly leaveState: string;
  readonly blockingExceptions: number;
  readonly inputsDigest: string;
  readonly calculationVersion: number;
}

/** One leave line. `paidTreatmentCode` travels uninterpreted from Leave, exactly as it arrived. */
export interface LeaveLineFacts {
  readonly leaveTypeId: string;
  readonly leaveTypeCode: string;
  readonly paidTreatmentCode: string;
  readonly minutes: number;
  readonly days: number;
}

export interface LeaveFacts {
  readonly lines: readonly LeaveLineFacts[];
  readonly encashableMinutes: number;
  readonly inputsDigest: string;
  readonly calculationVersion: number;
}

/**
 * One employment's snapshot: four source records, their versions, their digests.
 *
 * A source may be **absent**, and absence is meaningful. `compensation: undefined` means
 * Compensation had nothing for this employment in this period, which produces a recorded exception
 * rather than a result of zero. `leave: undefined` means Leave could not be asked — never that
 * there was no leave (ADR-0056).
 */
export interface EmploymentSnapshot {
  readonly employmentId: string;
  readonly employment?: EmploymentFacts;
  readonly compensation?: CompensationFacts;
  readonly attendance?: AttendanceFacts;
  readonly leave?: LeaveFacts;
  readonly capturedAt: Date;
}

/**
 * The digest of one employment's snapshot.
 *
 * Composed from **the sources' own digests** rather than from a serialization of the payload, for
 * two reasons. It is stable against a field being added to a view that Payroll does not read; and
 * it is directly comparable with what the source publishes, which is what makes reconciliation a
 * comparison rather than a re-derivation.
 */
export const snapshotDigest = (snapshot: EmploymentSnapshot): string =>
  digestOf([
    snapshot.employmentId,
    stated(snapshot.employment?.version),
    stated(snapshot.compensation?.inputsDigest),
    stated(snapshot.attendance?.inputsDigest),
    stated(snapshot.attendance?.sequence),
    stated(snapshot.leave?.inputsDigest),
  ]);

/**
 * A source's contribution to the digest, or the word for its absence.
 *
 * `absent` is a value rather than an empty string, so a snapshot taken while Leave was unreachable
 * digests differently from one where Leave answered with nothing. Collapsing the two would make an
 * outage invisible to reconciliation.
 */
const stated = (value: string | number | undefined): string =>
  value === undefined ? 'absent' : String(value);

/** The digest of a whole run's snapshot set. Order-independent, because a population is a set. */
export const runSnapshotDigest = (snapshots: readonly EmploymentSnapshot[]): string =>
  digestOfSet(snapshots.map(snapshotDigest));

export const populationDigest = (employmentIds: readonly string[]): string =>
  digestOfSet(employmentIds);

/**
 * Whether a snapshot is payable, and if not, why.
 *
 * Each refusal is a **recorded exception**, never a silent skip and never a zero result. A payroll
 * that quietly pays nothing to somebody whose compensation is missing is the worst failure this
 * module has, because it looks exactly like a correct payroll of zero.
 *
 * Attendance and Leave are treated asymmetrically on purpose. A missing attendance snapshot blocks,
 * because a period Attendance has not frozen has no payable facts. A missing *leave* answer blocks
 * too, but a missing *attendance* answer where the group does not use attendance at all is handled
 * by the caller, which knows whether either was expected.
 */
export const snapshotBlockers = (snapshot: EmploymentSnapshot): readonly string[] => [
  ...(snapshot.employment === undefined ? ['employment_unresolved'] : []),
  ...(snapshot.compensation === undefined ? ['compensation_missing'] : []),
  ...attendanceBlockers(snapshot.attendance),
];

/** What Attendance itself said was wrong with the period it froze. */
const attendanceBlockers = (attendance: AttendanceFacts | undefined): readonly string[] => {
  if (attendance === undefined) return [];

  return [
    ...(attendance.blockingExceptions > 0 ? ['attendance_blocking_exceptions'] : []),
    ...(attendance.leaveState === 'unknown' ? ['attendance_leave_state_unknown'] : []),
  ];
};
