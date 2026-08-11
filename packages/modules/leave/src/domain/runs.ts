import type { Metadata } from './leave-aggregate.js';

/**
 * The records a bounded run leaves behind.
 *
 * Accrual and leave-year closure are both **bounded, idempotent, restartable** operations: they
 * take a page of employments, write what is missing, and report what they covered. Neither runs on
 * a timer, because nothing in this repository runs on a timer — scheduling is Phase 24's, and a
 * scheduled run this module faked would be worse than an honest command an operator invokes (§20 of
 * the instruction, and §29's debt).
 *
 * Both records exist for the same two reasons: **idempotency**, since the ledger's unique index on
 * `(source_kind, source_id, kind)` uses the run's identity as the source; and **explainability**,
 * since every entitlement a run produced names the run that produced it, so "why does this person
 * have this figure" resolves to a row rather than to a guess.
 *
 * The counts are the honest part. `entriesSkipped` is how many employments already had the entry —
 * the number that proves the run is idempotent rather than merely claimed to be — and `refusals` is
 * how many could not be accrued at all. A run reporting refusals is a run somebody needs to look
 * at, and a run that hid them would be a run that quietly under-granted.
 */

export interface AccrualRunState {
  readonly id: string;
  readonly tenantId: string;
  readonly leavePolicyId: string;
  readonly leaveTypeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly runBy: string;
  readonly runAt: Date;
  readonly employmentsExamined: number;
  readonly entriesWritten: number;
  /** Already present, therefore not written again. The count that demonstrates idempotency. */
  readonly entriesSkipped: number;
  readonly refusals: number;
  readonly metadata: Metadata;
  readonly version: number;
}

/**
 * A closed leave year.
 *
 * One row per policy version per year, with a unique index behind it — so a rerun is refused by the
 * database rather than producing a second carry pair. Closing a year does **not** delete its
 * balances: the projections are retained and stamped, so "what did they have on the last day of
 * 2026" is answerable in 2029 (§16).
 */
export interface LeaveYearState {
  readonly id: string;
  readonly tenantId: string;
  readonly leavePolicyId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  readonly closedAt: Date;
  readonly closedBy: string;
  readonly employmentsClosed: number;
  readonly carriedOutMinutes: number;
  readonly carriedInMinutes: number;
  /** What lapsed at the year end. Distinct from expiry, which happens months later (§17). */
  readonly expiredMinutes: number;
  readonly metadata: Metadata;
  readonly version: number;
}
