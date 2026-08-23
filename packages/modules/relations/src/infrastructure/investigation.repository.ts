import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CaseEventState } from '../domain/case-event.js';
import type { InvestigationRecord } from '../domain/investigation.js';
import type {
  CaseEventStore,
  InvestigationStore,
  Page,
  Paged,
} from '../application/relations-ports.js';
import {
  caseEventState,
  caseEventValues,
  investigationState,
  investigationValues,
  type CaseEventRow,
  type InvestigationRow,
} from './relation-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/**
 * Investigations and the case history, in PostgreSQL.
 *
 * A second file rather than more of `relations.repository.ts`, which is already near the 250-line
 * budget the standards set for a repository. The split is by aggregate, not by convenience: the
 * catalogue-and-violations file holds what Checkpoint 1 owns, this one holds the case lifecycle.
 *
 * **One of the two has an update; the other cannot.** An open investigation is a draft, so
 * `PostgresInvestigationRepository.update` exists and the `expected` version guards the ordinary
 * lost-update race. `PostgresCaseEventRepository` has **insert and read only** — a case history with
 * an update method is not a history, and the trigger refuses one anyway.
 *
 * Every statement binds `transaction.tenantId`, and row-level security filters again beneath it.
 */

export class PostgresInvestigationRepository
  extends Repository<InvestigationRow & { version: number }>
  implements InvestigationStore
{
  public constructor() {
    super('relation_investigation');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<InvestigationRecord | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : investigationState(row);
  }

  /**
   * The inquiry currently in progress on a violation, if there is one.
   *
   * **This is not what makes "one open per violation" true.** `relation_investigation_open_idx` is —
   * a partial unique index over exactly this predicate — because a read that precedes an insert
   * decides nothing under concurrency (ADR-0071). This read exists so the ordinary case is a business
   * refusal rather than a constraint violation surfacing as a server error.
   */
  public async openFor(
    transaction: Transaction,
    violationId: string,
  ): Promise<InvestigationRecord | undefined> {
    const rows = await transaction.execute<InvestigationRow>(
      `select * from relation_investigation
         where tenant_id = $1 and violation_id = $2 and state = 'open' and deleted_at is null`,
      [transaction.tenantId, violationId],
    );

    return rows[0] === undefined ? undefined : investigationState(rows[0]);
  }

  public forViolation(
    transaction: Transaction,
    violationId: string,
    paged: Paged,
  ): Promise<Page<InvestigationRecord>> {
    return pageOf<InvestigationRow, InvestigationRecord>(
      transaction,
      {
        select: `select * from relation_investigation
                   where tenant_id = $1 and violation_id = $2 and deleted_at is null
                   order by opened_on desc, id desc
                   limit $3 offset $4`,
        count: `select count(*)::text as total from relation_investigation
                  where tenant_id = $1 and violation_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, violationId],
        limit: paged.limit,
        offset: paged.offset,
      },
      investigationState,
    );
  }

  public insert(transaction: Transaction, state: InvestigationRecord): Promise<void> {
    return insertRow(
      transaction,
      'relation_investigation',
      investigationValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: InvestigationRecord,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.investigationId,
      expected,
      mutable(investigationValues(state, transaction.tenantId)),
    );
  }
}

/**
 * The case history. **Insert and read.** No update, no delete, at this layer or beneath it.
 *
 * `forViolation` returns a whole case's transitions unpaged, and that is bounded by the domain rather
 * than by a `limit`: a case has as many rows as it has had transitions. Ordered by `sequence`, which
 * is unique per case — so "the latest" is unambiguous, and the current state derived from it cannot
 * depend on which row the planner happened to return first.
 */
export class PostgresCaseEventRepository implements CaseEventStore {
  public async forViolation(
    transaction: Transaction,
    violationId: string,
  ): Promise<readonly CaseEventState[]> {
    const rows = await transaction.execute<CaseEventRow>(
      `select * from relation_case_event
         where tenant_id = $1 and violation_id = $2
         order by sequence`,
      [transaction.tenantId, violationId],
    );

    return rows.map(caseEventState);
  }

  public insert(transaction: Transaction, state: CaseEventState): Promise<void> {
    return insertRow(
      transaction,
      'relation_case_event',
      caseEventValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
