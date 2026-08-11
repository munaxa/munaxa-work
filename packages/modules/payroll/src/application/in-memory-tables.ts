import { snapshotDigest, type EmploymentSnapshot } from '../domain/payroll-snapshot.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { ApprovalDecisionState } from '../domain/payroll-approval.js';
import type { PayrollAdjustmentState } from '../domain/payroll-adjustment.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type {
  DeductionLine,
  EarningLine,
  PayrollExceptionState,
  PayrollResultState,
} from '../domain/payroll-lines.js';
import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type {
  Page,
  Paged,
  ReconciliationRecord,
  ResultLine,
  StoredDigests,
} from './payroll-ports.js';

/**
 * The tables the in-memory stores share, and the two rules they enforce that production also
 * enforces.
 *
 * Apart from the stores themselves so the configuration half and the figures half can each be read
 * on its own without either importing the other.
 */

export const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

/** The SQLSTATE the real exclusion constraint raises, so the translation is exercised too. */
export class ConstraintViolation extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

export interface Tables {
  readonly groups: Map<string, PayrollGroupState>;
  readonly definitions: Map<string, DeductionDefinitionState>;
  readonly periods: Map<string, PayrollPeriodState>;
  readonly runs: Map<string, PayrollRunState>;
  readonly snapshots: Map<string, EmploymentSnapshot & { readonly runId: string }>;
  readonly results: Map<string, PayrollResultState & { finalized: boolean }>;
  readonly earnings: HeldLine<EarningLine>[];
  readonly deductions: HeldLine<DeductionLine>[];
  readonly exceptions: PayrollExceptionState[];
  readonly adjustments: Map<string, PayrollAdjustmentState>;
  readonly decisions: Map<string, ApprovalDecisionState>;
  readonly reconciliations: ReconciliationRecord[];
  readonly accounting: AccountingLine[];
  readonly payments: PaymentInstruction[];
}

export type HeldLine<TLine> = ResultLine<TLine> & { readonly runId: string; finalized: boolean };

export const emptyTables = (): Tables => ({
  groups: new Map(),
  definitions: new Map(),
  periods: new Map(),
  runs: new Map(),
  snapshots: new Map(),
  results: new Map(),
  earnings: [],
  deductions: [],
  exceptions: [],
  adjustments: new Map(),
  decisions: new Map(),
  reconciliations: [],
  accounting: [],
  payments: [],
});

export const digestsOf = (snapshot: EmploymentSnapshot): StoredDigests => ({
  ...(snapshot.employment === undefined ? {} : { employmentVersion: snapshot.employment.version }),
  ...(snapshot.compensation === undefined
    ? {}
    : {
        compensationDigest: snapshot.compensation.inputsDigest,
      }),
  ...(snapshot.attendance === undefined
    ? {}
    : {
        attendanceDigest: snapshot.attendance.inputsDigest,
        attendanceSequence: snapshot.attendance.sequence,
      }),
  ...(snapshot.leave === undefined ? {} : { leaveDigest: snapshot.leave.inputsDigest }),
  snapshotDigest: snapshotDigest(snapshot),
});
