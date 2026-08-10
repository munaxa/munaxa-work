import type { Transaction } from '@work/kernel';

import type { RequestDecisionState, RequestEventState } from '../domain/leave-request-state.js';
import type { DecisionStore, RequestEventStore } from '../application/leave-ports.js';

import {
  DECISION_COLUMNS,
  EVENT_COLUMNS,
  decisionValues,
  requestEventValues,
  toDecision,
  toRequestEvent,
  type DecisionRow,
  type RequestEventRow,
} from './request-rows.js';
import { insertRow } from './row-writer.js';

/**
 * Decisions and request history: **inserted and read**, and nothing else.
 *
 * Neither offers an update. A decision that was wrong is reversed by a new row naming the one it
 * reverses, because "they approved it and then unapproved it" and "they never approved it" are
 * different facts. A history that could be amended is not history.
 *
 * The decision row carries a copy of `requested_by`, written at insert from the request. That copy
 * is the only reason the database's `check (decided_by <> requested_by)` is enforceable at all — a
 * check constraint cannot reach another table (§12.2).
 */

export class RequestDecisionRepository implements DecisionStore {
  public async forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestDecisionState[]> {
    const rows = await transaction.execute<DecisionRow>(
      `select ${DECISION_COLUMNS} from leave_request_decision c
        where c.tenant_id = $1 and c.leave_request_id = $2 and c.deleted_at is null
        order by c.sequence`,
      [transaction.tenantId, requestId],
    );
    return rows.map(toDecision);
  }

  public async insert(transaction: Transaction, state: RequestDecisionState): Promise<void> {
    await insertRow(transaction, 'leave_request_decision', decisionValues(state), new Date());
  }
}

export class RequestEventRepository implements RequestEventStore {
  public async forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestEventState[]> {
    const rows = await transaction.execute<RequestEventRow>(
      `select ${EVENT_COLUMNS} from leave_request_event v
        where v.tenant_id = $1 and v.leave_request_id = $2 and v.deleted_at is null
        order by v.occurred_at, v.id`,
      [transaction.tenantId, requestId],
    );
    return rows.map(toRequestEvent);
  }

  public async insert(transaction: Transaction, state: RequestEventState): Promise<void> {
    await insertRow(transaction, 'leave_request_event', requestEventValues(state), new Date());
  }
}
