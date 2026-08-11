import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { CalibrationDecisionState, CalibrationSessionState } from '../domain/calibration.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type {
  CalibrationDecisionStore,
  CalibrationSessionStore,
  TalentPlacementStore,
} from '../application/performance-ports.js';
import {
  calibrationDecisionState,
  calibrationDecisionValues,
  calibrationSessionState,
  calibrationSessionValues,
  talentPlacementState,
  talentPlacementValues,
  type CalibrationDecisionRow,
  type CalibrationSessionRow,
  type TalentPlacementRow,
} from './outcome-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * Calibration, talent placements, feedback and the completion snapshot.
 *
 * **Three of these offer insert and read and no update at all**, and that is the interface half of
 * what the triggers enforce. A calibration decision records what a rating was before a meeting
 * moved it; a snapshot records what a completed review was calculated from; a piece of feedback
 * records what somebody said. Each is a record of something that already happened, and the cheapest
 * guarantee that nobody rewrote one is to have no method that could.
 */

export class PostgresCalibrationSessionRepository
  extends Repository<CalibrationSessionRow & { version: number }>
  implements CalibrationSessionStore
{
  public constructor() {
    super('performance_calibration_session');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CalibrationSessionState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : calibrationSessionState(row);
  }

  public async forCycle(
    transaction: Transaction,
    cycleId: string,
  ): Promise<readonly CalibrationSessionState[]> {
    const rows = await transaction.execute<CalibrationSessionRow>(
      `select * from performance_calibration_session
         where tenant_id = $1 and cycle_id = $2 and deleted_at is null
         order by code`,
      [transaction.tenantId, cycleId],
    );

    return rows.map(calibrationSessionState);
  }

  public insert(transaction: Transaction, state: CalibrationSessionState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      calibrationSessionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: CalibrationSessionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.calibrationSessionId,
      expected,
      mutable(calibrationSessionValues(state, transaction.tenantId)),
    );
  }
}

/** Insert and read. A record whose "before" can be rewritten records nothing. */
export class PostgresCalibrationDecisionRepository implements CalibrationDecisionStore {
  public async forSession(
    transaction: Transaction,
    sessionId: string,
  ): Promise<readonly CalibrationDecisionState[]> {
    const rows = await transaction.execute<CalibrationDecisionRow>(
      `select * from performance_calibration_decision
         where tenant_id = $1 and calibration_session_id = $2 and deleted_at is null
         order by decided_at, id`,
      [transaction.tenantId, sessionId],
    );

    return rows.map(calibrationDecisionState);
  }

  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly CalibrationDecisionState[]> {
    const rows = await transaction.execute<CalibrationDecisionRow>(
      `select * from performance_calibration_decision
         where tenant_id = $1 and review_id = $2 and deleted_at is null
         order by decided_at desc, id desc`,
      [transaction.tenantId, reviewId],
    );

    return rows.map(calibrationDecisionState);
  }

  public insert(transaction: Transaction, state: CalibrationDecisionState): Promise<void> {
    return insertRow(
      transaction,
      'performance_calibration_decision',
      calibrationDecisionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

export class PostgresTalentPlacementRepository
  extends Repository<TalentPlacementRow & { version: number }>
  implements TalentPlacementStore
{
  public constructor() {
    super('performance_talent_placement');
  }

  public async forCycle(
    transaction: Transaction,
    cycleId: string,
  ): Promise<readonly TalentPlacementState[]> {
    const rows = await transaction.execute<TalentPlacementRow>(
      `select * from performance_talent_placement
         where tenant_id = $1 and cycle_id = $2 and deleted_at is null
         order by box_code, employment_id`,
      [transaction.tenantId, cycleId],
    );

    return rows.map(talentPlacementState);
  }

  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<TalentPlacementState | undefined> {
    const rows = await transaction.execute<TalentPlacementRow>(
      `select * from performance_talent_placement
         where tenant_id = $1 and review_id = $2 and deleted_at is null`,
      [transaction.tenantId, reviewId],
    );

    return rows[0] === undefined ? undefined : talentPlacementState(rows[0]);
  }

  public insert(transaction: Transaction, state: TalentPlacementState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      talentPlacementValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: TalentPlacementState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.talentPlacementId,
      expected,
      mutable(talentPlacementValues(state, transaction.tenantId)),
    );
  }
}

/**
 * Feedback: insert, read and withdraw.
 *
 * **Withdrawal is a soft delete and nothing else.** The trigger permits exactly the delete columns
 * and the audit that accompanies them to change, so an attempt to edit the body on the way out
 * would be refused by the table. The text stays exactly as it was written.
 */
