import type { Transaction } from '@work/kernel';

import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type {
  AccountingStore,
  DashboardCounts,
  DashboardStore,
  Page,
  Paged,
  PaymentStore,
} from '../application/payroll-ports.js';
import {
  accountingState,
  accountingValues,
  paymentState,
  paymentValues,
  type AccountingRow,
  type PaymentRow,
} from './record-rows.js';
import { asNumber, insertRows, pageOf } from './row-writer.js';

/**
 * The two outputs and the dashboard.
 *
 * Both outputs are **prepared and acted on by nothing**: there is no Finance module to post to and
 * no payment rail to transmit on, so neither read has a side effect and neither carries a state
 * claiming otherwise (ADR-0067).
 */

export class PostgresAccountingRepository implements AccountingStore {
  public forRun(
    transaction: Transaction,
    runId: string,
    paged: Paged,
  ): Promise<Page<AccountingLine>> {
    return pageOf<AccountingRow, AccountingLine>(
      transaction,
      {
        select: `select * from payroll_accounting_line
                   where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
                   order by id limit $3 offset $4`,
        count: `select count(*)::text as total from payroll_accounting_line
                  where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, runId],
        limit: paged.limit,
        offset: paged.offset,
      },
      accountingState,
    );
  }

  public insertMany(
    transaction: Transaction,
    lines: readonly AccountingLine[],
    finalizedAt: Date,
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_accounting_line',
      lines.map((line) => ({
        ...accountingValues(line, transaction.tenantId),
        finalized_at: finalizedAt,
      })),
      new Date(),
    );
  }
}

export class PostgresPaymentRepository implements PaymentStore {
  public forRun(
    transaction: Transaction,
    runId: string,
    paged: Paged,
  ): Promise<Page<PaymentInstruction>> {
    return pageOf<PaymentRow, PaymentInstruction>(
      transaction,
      {
        select: `select id, payroll_run_id, payroll_result_id, employment_id, amount_minor,
                        currency_code, currency_exponent, payment_method_code, payment_reference,
                        payee_account_ref, status,
                        to_char(payment_date, 'YYYY-MM-DD') as payment_date
                   from payroll_payment_instruction
                   where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
                   order by employment_id limit $3 offset $4`,
        count: `select count(*)::text as total from payroll_payment_instruction
                  where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, runId],
        limit: paged.limit,
        offset: paged.offset,
      },
      paymentState,
    );
  }

  public insertMany(
    transaction: Transaction,
    instructions: readonly PaymentInstruction[],
    finalizedAt: Date,
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_payment_instruction',
      instructions.map((instruction) => ({
        ...paymentValues(instruction, transaction.tenantId),
        finalized_at: finalizedAt,
      })),
      new Date(),
    );
  }
}

/**
 * The dashboard's six numbers, in **one statement**.
 *
 * Six separate counts would be six round trips on a screen somebody refreshes; a single query with
 * six scalar subqueries is one. Two of the numbers — stale runs and unresolved exceptions — are the
 * ones that grow when something is quietly not working, which is why they are on a screen at all.
 */
export class PostgresDashboardRepository implements DashboardStore {
  public async counts(transaction: Transaction): Promise<DashboardCounts> {
    const rows = await transaction.execute<Record<string, string>>(
      `select
         (select count(*) from payroll_period
            where tenant_id = $1 and status = 'open' and deleted_at is null) as open_periods,
         (select count(*) from payroll_run
            where tenant_id = $1 and status = 'calculated' and deleted_at is null) as awaiting,
         (select count(*) from payroll_run
            where tenant_id = $1 and status = 'stale' and deleted_at is null) as stale,
         (select count(*) from payroll_exception
            where tenant_id = $1 and resolved_at is null and deleted_at is null) as exceptions,
         (select count(*) from payroll_run
            where tenant_id = $1 and status = 'finalized' and deleted_at is null
              and finalized_at >= date_trunc('month', now())) as finalized_this_month,
         (select count(*) from payroll_group
            where tenant_id = $1 and deleted_at is null) as groups`,
      [transaction.tenantId],
    );
    const counted = countsOf(rows[0] ?? {});

    return {
      openPeriods: counted('open_periods'),
      runsAwaitingApproval: counted('awaiting'),
      staleRuns: counted('stale'),
      unresolvedExceptions: counted('exceptions'),
      finalizedThisMonth: counted('finalized_this_month'),
      groupsConfigured: counted('groups'),
    };
  }
}

/** One branch, once, rather than six — the reason `orNull` and friends exist in `row-writer`. */
const countsOf =
  (row: Record<string, string>) =>
  (column: string): number =>
    asNumber(row[column] ?? '0');
