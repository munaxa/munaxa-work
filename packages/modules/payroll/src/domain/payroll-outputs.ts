import { allocated, type MoneyAmount } from './money-amount.js';
import type { PayrollResultState } from './payroll-lines.js';
import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import type { AccountingDirection } from './payroll-vocabulary.js';

/**
 * The two outputs a finalized run produces, and **neither of them does anything**.
 *
 * There is no Finance module, no ledger, no chart of accounts, no bank domain and no payment
 * integration in this repository. So Payroll persists balanced accounting lines and payment
 * instructions in its own tables and publishes them as bounded reads, and stops there: nothing is
 * posted, nothing is transmitted, and no state claims otherwise. `accountingPreparedAt` exists;
 * `posted` does not. `prepared` exists; `executed` does not (ADR-0067).
 *
 * The lines **balance**, and an invariant asserts it. An unbalanced accounting export is worse than
 * none, because it will be discovered by an accountant months later rather than by a test now.
 */

export interface AccountingLine {
  readonly accountingLineId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly direction: AccountingDirection;
  /** An opaque tenant-configured code. Payroll owns no chart of accounts. */
  readonly accountReference: string;
  readonly costCenterId?: string;
  readonly unitId?: string;
  readonly amount: MoneyAmount;
  readonly sourceReference: string;
  /** Generated here so a downstream consumer can be idempotent without asking Payroll twice. */
  readonly journalReference: string;
}

export interface PaymentInstruction {
  readonly paymentInstructionId: string;
  readonly payrollRunId: string;
  /** One instruction per result, enforced by a unique index — a retried finalize writes once. */
  readonly payrollResultId: string;
  readonly employmentId: string;
  readonly amount: MoneyAmount;
  readonly paymentDate: string;
  readonly paymentMethodCode: string;
  readonly paymentReference: string;
  /**
   * Reserved, and **null in this phase**.
   *
   * There is no bank-account domain to reference, and no account number, IBAN, sort code or card
   * token is ever stored here. A future payment domain populates it with its own identifier.
   */
  readonly payeeAccountRef?: string;
  readonly status: 'prepared' | 'reversed';
}

/** How a cost is split. Basis points, summing to 10,000, so a split allocates exactly. */
export interface CostAllocation {
  readonly costCenterId: string;
  readonly unitId?: string;
  readonly basisPoints: number;
}

export interface AccountingRequest {
  readonly result: PayrollResultState;
  readonly allocations: readonly CostAllocation[];
  readonly expenseAccount: string;
  readonly deductionAccount: string;
  readonly payableAccount: string;
  readonly journalReference: string;
  readonly identifier: (sequence: number) => string;
}

/**
 * One result, as a balanced journal.
 *
 * Gross is debited to the expense account, split across the cost allocation; deductions are credited
 * to a liability account; net is credited to a payable account. Debits equal credits by
 * construction, and `accountingBalances` asserts it over the persisted rows rather than trusting
 * that.
 *
 * The gross split uses an **exact weighted allocation** (`allocated`), not per-share rounding. A
 * split that loses a minor unit produces a journal that does not balance, and this is the one place
 * in the module where that could happen.
 */
export const accountingFor = (
  request: AccountingRequest,
): PayrollResult<readonly AccountingLine[]> => {
  if (request.allocations.length === 0) return refuse('cost_allocation_missing');

  const weights = request.allocations.map((allocation) => allocation.basisPoints);
  const split = allocated(request.result.gross, weights);

  if (!split.ok) return split;

  const lines: AccountingLine[] = request.allocations.map((allocation, index) => ({
    accountingLineId: request.identifier(index),
    payrollRunId: request.result.payrollRunId,
    employmentId: request.result.employmentId,
    direction: 'debit',
    accountReference: request.expenseAccount,
    costCenterId: allocation.costCenterId,
    ...(allocation.unitId === undefined ? {} : { unitId: allocation.unitId }),
    amount: split.value[index] ?? { ...request.result.gross, amountMinor: 0n },
    sourceReference: request.result.payrollResultId,
    journalReference: request.journalReference,
  }));

  if (request.result.totalDeductions.amountMinor > 0n) {
    lines.push({
      accountingLineId: request.identifier(lines.length),
      payrollRunId: request.result.payrollRunId,
      employmentId: request.result.employmentId,
      direction: 'credit',
      accountReference: request.deductionAccount,
      amount: request.result.totalDeductions,
      sourceReference: request.result.payrollResultId,
      journalReference: request.journalReference,
    });
  }

  lines.push({
    accountingLineId: request.identifier(lines.length),
    payrollRunId: request.result.payrollRunId,
    employmentId: request.result.employmentId,
    direction: 'credit',
    accountReference: request.payableAccount,
    amount: request.result.net,
    sourceReference: request.result.payrollResultId,
    journalReference: request.journalReference,
  });

  return accept(lines);
};

/**
 * Whether a set of accounting lines balances, per currency.
 *
 * Per currency because nothing is ever combined across currencies (ADR-0067) — a run paying two
 * currencies produces two balanced journals, not one that nets across a rate nobody owns.
 */
export const accountingBalances = (lines: readonly AccountingLine[]): boolean => {
  const byCurrency = new Map<string, bigint>();

  for (const line of lines) {
    const signed = line.direction === 'debit' ? line.amount.amountMinor : -line.amount.amountMinor;

    byCurrency.set(
      line.amount.currencyCode,
      (byCurrency.get(line.amount.currencyCode) ?? 0n) + signed,
    );
  }

  return [...byCurrency.values()].every((balance) => balance === 0n);
};

export interface PaymentRequest {
  readonly result: PayrollResultState;
  readonly paymentDate: string;
  readonly paymentMethodCode: string;
  readonly paymentInstructionId: string;
  readonly paymentReference: string;
}

/** One result, as a payment instruction that nothing executes. */
export const paymentFor = (request: PaymentRequest): PaymentInstruction => ({
  paymentInstructionId: request.paymentInstructionId,
  payrollRunId: request.result.payrollRunId,
  payrollResultId: request.result.payrollResultId,
  employmentId: request.result.employmentId,
  amount: request.result.net,
  paymentDate: request.paymentDate,
  paymentMethodCode: request.paymentMethodCode,
  paymentReference: request.paymentReference,
  status: 'prepared',
});

/**
 * The default allocation when an employment has one cost centre.
 *
 * A single 100% pair. The split machinery exists because the architecture supports splitting and
 * assuming otherwise would be an assumption; the only input Employment publishes fills it with one
 * pair, which is stated rather than hidden.
 */
export const wholeTo = (costCenterId: string, unitId?: string): readonly CostAllocation[] => [
  { costCenterId, ...(unitId === undefined ? {} : { unitId }), basisPoints: 10_000 },
];
