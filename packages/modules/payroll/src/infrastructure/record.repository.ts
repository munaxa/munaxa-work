import type { Transaction } from '@work/kernel';

import type { ApprovalDecisionState } from '../domain/payroll-approval.js';
import type { PayrollAdjustmentState } from '../domain/payroll-adjustment.js';
import type {
  AdjustmentStore,
  DecisionStore,
  ReconciliationRecord,
  ReconciliationStore,
} from '../application/payroll-ports.js';
import {
  adjustmentState,
  adjustmentValues,
  decisionState,
  decisionValues,
  type AdjustmentRow,
  type DecisionRow,
} from './record-rows.js';
import { insertRow, insertRows } from './row-writer.js';

/**
 * The record tables: adjustments, decisions, reconciliation, and the two outputs.
 *
 * **None of these offers an `update` or a `remove`.** A decision somebody made, an adjustment
 * somebody explained and a reconciliation finding are each answers to "what happened", and the
 * cheapest guarantee that nobody rewrote one is to have no method that could. A wrong decision is
 * corrected by a reversal row that names it.
 */

export class PostgresAdjustmentRepository implements AdjustmentStore {
  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<PayrollAdjustmentState | undefined> {
    const rows = await transaction.execute<AdjustmentRow>(
      `select * from payroll_adjustment where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : adjustmentState(rows[0]);
  }

  public async forRun(
    transaction: Transaction,
    runId: string,
  ): Promise<readonly PayrollAdjustmentState[]> {
    const rows = await transaction.execute<AdjustmentRow>(
      `select * from payroll_adjustment
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
         order by recorded_at`,
      [transaction.tenantId, runId],
    );

    return rows.map(adjustmentState);
  }

  public insert(transaction: Transaction, state: PayrollAdjustmentState): Promise<void> {
    return insertRow(
      transaction,
      'payroll_adjustment',
      adjustmentValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

export class PostgresDecisionRepository implements DecisionStore {
  public async forRun(
    transaction: Transaction,
    runId: string,
  ): Promise<readonly ApprovalDecisionState[]> {
    const rows = await transaction.execute<DecisionRow>(
      `select * from payroll_approval_decision
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
         order by sequence`,
      [transaction.tenantId, runId],
    );

    return rows.map(decisionState);
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ApprovalDecisionState | undefined> {
    const rows = await transaction.execute<DecisionRow>(
      `select * from payroll_approval_decision
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : decisionState(rows[0]);
  }

  /**
   * The insert the self-approval check constraint guards.
   *
   * `decided_by <> requested_by` is enforced by the database, not only by the domain, and it is
   * enforceable at all because `requested_by` is copied onto this row — a check constraint cannot
   * reach another table.
   */
  public insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void> {
    return insertRow(
      transaction,
      'payroll_approval_decision',
      decisionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

export class PostgresReconciliationRepository implements ReconciliationStore {
  public async forRun(
    transaction: Transaction,
    runId: string,
  ): Promise<readonly ReconciliationRecord[]> {
    const rows = await transaction.execute<{
      employment_id: string;
      stale_source: string;
      previous_digest: string | null;
      current_digest: string | null;
      detected_at: Date;
    }>(
      `select employment_id, stale_source, previous_digest, current_digest, detected_at
         from payroll_reconciliation
         where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
         order by detected_at desc, employment_id`,
      [transaction.tenantId, runId],
    );

    return rows.map((row) => ({
      payrollRunId: runId,
      employmentId: row.employment_id,
      staleSource: row.stale_source,
      ...(row.previous_digest === null ? {} : { previousDigest: row.previous_digest }),
      ...(row.current_digest === null ? {} : { currentDigest: row.current_digest }),
      detectedAt: row.detected_at,
    }));
  }

  public insertMany(
    transaction: Transaction,
    records: readonly ReconciliationRecord[],
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_reconciliation',
      records.map((record) => ({
        tenant_id: transaction.tenantId,
        payroll_run_id: record.payrollRunId,
        employment_id: record.employmentId,
        stale_source: record.staleSource,
        previous_digest: record.previousDigest ?? null,
        current_digest: record.currentDigest ?? null,
        detected_at: record.detectedAt,
      })),
      new Date(),
    );
  }
}
