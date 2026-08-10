import type { Transaction } from '@work/kernel';

import type { DeductionLine, EarningLine, PayrollExceptionState } from '../domain/payroll-lines.js';
import type {
  DeductionLineStore,
  EarningLineStore,
  ExceptionStore,
  ResultLine,
} from '../application/payroll-ports.js';
import {
  deductionState,
  deductionValues,
  earningState,
  earningValues,
  exceptionState,
  exceptionValues,
  type DeductionLineRow,
  type EarningLineRow,
  type ExceptionRow,
} from './result-rows.js';
import { insertRows } from './row-writer.js';

/**
 * The lines and the exceptions.
 *
 * Every write is a multi-row insert, and `clearRun` carries `finalized_at is null` so a
 * recalculation can replace a run that is not finalized and nothing can touch one that is.
 */

export class PostgresEarningLineRepository implements EarningLineStore {
  public async forResult(
    transaction: Transaction,
    resultId: string,
  ): Promise<readonly EarningLine[]> {
    const rows = await transaction.execute<EarningLineRow>(
      `select id, sequence, earning_source, component_id, component_code, payroll_treatment_code,
              amount_minor, currency_code, currency_exponent, calculation_reason, detail,
              source_reference, employment_id,
              to_char(effective_from, 'YYYY-MM-DD') as effective_from,
              to_char(effective_to, 'YYYY-MM-DD') as effective_to
         from payroll_earning_line
         where tenant_id = $1 and payroll_result_id = $2 and deleted_at is null
         order by sequence`,
      [transaction.tenantId, resultId],
    );

    return rows.map(earningState);
  }

  public insertMany(
    transaction: Transaction,
    runId: string,
    lines: readonly ResultLine<EarningLine>[],
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_earning_line',
      lines.map((held) =>
        earningValues(held.line, {
          tenantId: transaction.tenantId,
          resultId: held.resultId,
          runId,
        }),
      ),
      new Date(),
    );
  }

  public async clearRun(transaction: Transaction, runId: string): Promise<void> {
    await transaction.execute(
      `delete from payroll_earning_line
         where tenant_id = $1 and payroll_run_id = $2 and finalized_at is null`,
      [transaction.tenantId, runId],
    );
  }
}

export class PostgresDeductionLineRepository implements DeductionLineStore {
  public async forResult(
    transaction: Transaction,
    resultId: string,
  ): Promise<readonly DeductionLine[]> {
    const rows = await transaction.execute<DeductionLineRow>(
      `select id, sequence, deduction_source, deduction_definition_id, deduction_code,
              payroll_treatment_code, amount_minor, currency_code, currency_exponent,
              calculation_reason, detail, source_reference, priority, employment_id
         from payroll_deduction_line
         where tenant_id = $1 and payroll_result_id = $2 and deleted_at is null
         order by priority, sequence`,
      [transaction.tenantId, resultId],
    );

    return rows.map(deductionState);
  }

  public insertMany(
    transaction: Transaction,
    runId: string,
    lines: readonly ResultLine<DeductionLine>[],
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_deduction_line',
      lines.map((held) =>
        deductionValues(held.line, {
          tenantId: transaction.tenantId,
          resultId: held.resultId,
          runId,
        }),
      ),
      new Date(),
    );
  }

  public async clearRun(transaction: Transaction, runId: string): Promise<void> {
    await transaction.execute(
      `delete from payroll_deduction_line
         where tenant_id = $1 and payroll_run_id = $2 and finalized_at is null`,
      [transaction.tenantId, runId],
    );
  }
}

export class PostgresExceptionRepository implements ExceptionStore {
  public async forRun(
    transaction: Transaction,
    runId: string,
  ): Promise<readonly PayrollExceptionState[]> {
    const rows = await transaction.execute<ExceptionRow>(
      `select * from payroll_exception
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
         order by exception_code, employment_id`,
      [transaction.tenantId, runId],
    );

    return rows.map(exceptionState);
  }

  public insertMany(
    transaction: Transaction,
    exceptions: readonly PayrollExceptionState[],
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_exception',
      exceptions.map((state) => exceptionValues(state, transaction.tenantId)),
      new Date(),
    );
  }

  /** Exceptions carry no `finalized_at`: a recalculation replaces them wholesale. */
  public async clearRun(transaction: Transaction, runId: string): Promise<void> {
    await transaction.execute(
      `delete from payroll_exception where tenant_id = $1 and payroll_run_id = $2`,
      [transaction.tenantId, runId],
    );
  }
}
