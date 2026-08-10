import type {
  AttendanceFacts,
  CompensationFacts,
  EmploymentFacts,
  LeaveFacts,
} from '../domain/payroll-snapshot.js';

/**
 * What Payroll needs of the four modules it consumes, and nothing more.
 *
 * Ports rather than queries, because those modules own their data and this one may not read their
 * tables. **Every method runs under a bounded service grant** (ADR-0043): running a payroll must
 * not require a permission on the employment register, the attendance log, the leave ledger or the
 * compensation record. The caller is authorized for the *payroll* operation; the module holds the
 * narrow cross-domain read.
 *
 * Note what is absent. There is no `create`, no `update`, no `personId`, no name, no bank detail
 * and no method that could change anything anywhere else. **The dependency points one way and
 * Payroll pulls** — the ADR-0058 discipline, applied to four sources instead of one.
 *
 * Every method is **batched**: they take a page of employment identifiers rather than one. That is
 * not an optimization, it is the difference between a run that finishes at a hundred thousand
 * employments and one that makes four hundred thousand round trips.
 */

/** A source that could not be asked, distinguished from one that answered with nothing. */
export type SourceAnswer<TFacts> =
  { readonly known: false } | { readonly known: true; readonly facts: ReadonlyMap<string, TFacts> };

export const sourceUnavailable = <TFacts>(): SourceAnswer<TFacts> => ({ known: false });

export const sourceAnswered = <TFacts>(
  facts: ReadonlyMap<string, TFacts>,
): SourceAnswer<TFacts> => ({ known: true, facts });

export interface PeriodWindow {
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * Employment, read **as at the period** rather than as it is now.
 *
 * `statusOn` is what the adapter takes where Employment can reconstruct it: a period that closed in
 * March is snapshotted against March's status and March's cost centre, so re-running it after an
 * April transfer produces March's figures. Reading "now" would make every historical re-run wrong
 * in a way nobody would notice until an audit.
 */
export interface EmploymentSourcePort {
  /** A bounded page of employment identifiers for a legal entity, for population resolution. */
  employmentIds(
    legalEntityId: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;

  factsFor(employmentIds: readonly string[], asOf: string): Promise<SourceAnswer<EmploymentFacts>>;
}

/** Compensation's published period contract. Percentages arrive resolved; Payroll never re-derives. */
export interface CompensationSourcePort {
  factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<CompensationFacts>>;

  /**
   * The system-time reconciliation read: what has been *recorded* since Payroll last looked.
   *
   * The cheap staleness axis, and the reason Compensation built it. Returns the employments whose
   * compensation moved, never the amounts.
   */
  changedSince(employmentIds: readonly string[], recordedAfter: Date): Promise<readonly string[]>;
}

/**
 * Attendance's frozen payable snapshot.
 *
 * Frozen is a stronger input than a live read, and `sequence` is what makes a **re-freeze**
 * detectable: Attendance may freeze a period again after a correction, and a run calculated against
 * sequence 1 is stale the moment sequence 2 exists.
 */
export interface AttendanceSourcePort {
  factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<AttendanceFacts>>;
}

/**
 * Leave's published payroll-period contract.
 *
 * `paidTreatmentCode` arrives already stated by Leave and travels uninterpreted; Payroll reads the
 * literal `unpaid` and never maps a `leaveTypeId` to a meaning (ADR-0060). Where Leave publishes no
 * such query, this port has **no adapter** and leave-driven deductions are `NOT VERIFIED` rather
 * than approximated from day coverage (D-15).
 */
export interface LeaveSourcePort {
  factsFor(
    employmentIds: readonly string[],
    period: PeriodWindow,
  ): Promise<SourceAnswer<LeaveFacts>>;
}

/** The legal entity a payroll group is governed under — where its country comes from (ADR-0035). */
export interface LegalEntityForPayroll {
  readonly legalEntityId: string;
  readonly countryCode: string;
  readonly currencyCode: string;
}

/**
 * Organization, asked two questions.
 *
 * **`known: false` is not "no legal entity"** (ADR-0056). It means Organization could not be asked,
 * and a run that resolved a country pack from a silent "none" would calculate a workforce under the
 * wrong rules.
 */
export interface OrganizationSourcePort {
  legalEntity(
    legalEntityId: string,
  ): Promise<
    { readonly known: false } | { readonly known: true; readonly entity?: LegalEntityForPayroll }
  >;
}

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * A Leave adapter for a composition where Leave publishes no payroll contract.
 *
 * It answers "unknown" honestly rather than "no leave", so unpaid-leave deductions are skipped with
 * a recorded reason instead of being silently computed as zero. This is what D-15 being declined
 * would look like in code, and it is the shape every absent capability takes in this module.
 */
export const leaveUnavailable: LeaveSourcePort = {
  factsFor: () => Promise.resolve(sourceUnavailable()),
};

/** Likewise for a group that does not use Attendance at all — a real configuration, not a failure. */
export const attendanceUnavailable: AttendanceSourcePort = {
  factsFor: () => Promise.resolve(sourceUnavailable()),
};
