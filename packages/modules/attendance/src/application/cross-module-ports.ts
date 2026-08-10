/**
 * The two modules Attendance talks to, and the ports it talks to them through.
 *
 * Apart from `attendance-ports.ts` because these are a different kind of thing: those are
 * persistence contracts this module implements against its own tables, and these are **contracts
 * with other modules**, resolved by the composition root under bounded service grants (ADR-0043).
 * Keeping them together made one file that was half database and half diplomacy.
 */

/**
 * What Attendance needs of Employment, and nothing more.
 *
 * A port rather than a query, because Employment owns the employment and this module may not read
 * its tables. **Every method here runs under a bounded service grant** (ADR-0043): the caller is
 * authorized for the *attendance* operation, and the module — not the user — holds the narrow
 * Employment read the check needs.
 *
 * Note what is *not* here: no `create`, no `update`, no `personId`, and no contracted hours stored
 * anywhere. Attendance references an employment and copies no fact from it (ADR-0051).
 */
export interface EmploymentForAttendance {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  /** The assignment in force on the date asked for. Used for scoping, never as a place of work. */
  readonly unitId?: string;
  readonly managerEmploymentId?: string;
}

export interface EmploymentDirectoryPort {
  /** One employment **as it stood on a date**. Never "as it is now" when calculating history. */
  find(employmentId: string, asOf: string): Promise<EmploymentForAttendance | undefined>;
  /** A bounded page of employments that could have attendance. The roster and scoping read. */
  activeEmployments(limit: number): Promise<readonly EmploymentForAttendance[]>;
}

/**
 * What Leave will be able to tell Attendance, once Leave exists.
 *
 * **`known: false` is not "no leave".** It means nobody can be asked — there is no Leave module in
 * this repository — and the difference decides whether a person's record says they were absent
 * without leave or says plainly that the question is open. Collapsing the two would have the
 * product assert something about somebody that it has no way to support (ADR-0056).
 *
 * Phase 9 supplies the adapter. Nothing here implements Leave, creates a balance or holds an
 * entitlement.
 */
export interface ApprovedLeaveDay {
  readonly onDate: string;
  readonly coverage: 'full_day' | 'partial_day' | 'hourly';
  readonly minutes?: number;
  readonly leaveRequestId: string;
}

export type LeaveCoverage =
  { readonly known: false } | { readonly known: true; readonly days: readonly ApprovedLeaveDay[] };

export interface LeaveDirectoryPort {
  approvedLeaveFor(employmentId: string, from: string, to: string): Promise<LeaveCoverage>;
  /**
   * The same read, narrowed to leave that **changed** since an instant.
   *
   * This is how Attendance discovers a leave change without Leave ever writing here. Attendance
   * depends on Leave already; a Leave-to-Attendance write would close a dependency cycle and make
   * Leave responsible for another module's derived state. So Attendance pulls, on its own
   * reconciliation run, and marks its own days.
   *
   * Deliberately narrow — one employment, one date range, one instant. There is no global cursor,
   * no feed, no event bus and no outbox: a single consumer does not justify building one, and
   * Phases 16 and 17 own that work properly.
   */
  approvedLeaveAffecting(
    employmentId: string,
    from: string,
    to: string,
    changedSince?: Date,
  ): Promise<LeaveCoverage>;
}

/**
 * The Leave adapter this repository actually has.
 *
 * It answers "unknown" and does so honestly. A stub that answered "no leave approved" would make
 * every unexplained absence read as absence *without leave*, which is a false statement on
 * somebody's record and exactly the fake completeness this phase refuses.
 */
export const leaveUnavailable: LeaveDirectoryPort = {
  approvedLeaveFor: () => Promise.resolve({ known: false }),
  approvedLeaveAffecting: () => Promise.resolve({ known: false }),
};

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
