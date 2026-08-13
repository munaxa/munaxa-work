import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ReadinessAssessmentState, ReadinessLevelState } from '../domain/readiness.js';
import type {
  AssessmentFilters,
  Page,
  Paged,
  ReadinessAssessmentStore,
  ReadinessLevelStore,
} from '../application/career-ports.js';
import {
  READINESS_LEVEL_COLUMNS,
  readinessLevelState,
  readinessLevelValues,
  type ReadinessLevelRow,
} from './career-config-rows.js';
import {
  assessmentColumns,
  assessmentState,
  assessmentValues,
  type AssessmentRow,
} from './career-record-rows.js';
import {
  boundClause,
  insertRow,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * The tenant's readiness ladder, and the statements people made against it.
 *
 * **Nothing here computes a readiness** (ADR-0074, D-10). There is no score column to read, no
 * weighting to apply, no join to Performance's potential band, no join to Learning's completions and
 * no join to Employment's tenure — the four things a derivation would have used. A readiness level
 * decides who is put forward for a director's post, and the person it describes is not in the room.
 *
 * **A level is retired, never deleted.** Assessments recorded at a level are statements somebody
 * made, and removing the level would make them unreadable.
 */
export class PostgresReadinessLevelRepository
  extends Repository<ReadinessLevelRow & { version: number }>
  implements ReadinessLevelStore
{
  public constructor() {
    super('career_readiness_level');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ReadinessLevelState | undefined> {
    const rows = await transaction.execute<ReadinessLevelRow>(
      `select ${READINESS_LEVEL_COLUMNS} from career_readiness_level
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : readinessLevelState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<ReadinessLevelState | undefined> {
    const rows = await transaction.execute<ReadinessLevelRow>(
      `select ${READINESS_LEVEL_COLUMNS} from career_readiness_level
         where code = $1 and tenant_id = $2 and deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : readinessLevelState(rows[0]);
  }

  /** Two rungs at the same height order nothing, which is why `career_readiness_level_ordinal_idx` exists. */
  public async byOrdinal(
    transaction: Transaction,
    ordinal: number,
  ): Promise<ReadinessLevelState | undefined> {
    const rows = await transaction.execute<ReadinessLevelRow>(
      `select ${READINESS_LEVEL_COLUMNS} from career_readiness_level
         where ordinal = $1 and tenant_id = $2 and deleted_at is null`,
      [ordinal, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : readinessLevelState(rows[0]);
  }

  /**
   * The ladder, in order, unpaged.
   *
   * Bounded by the vocabulary rather than by a page: the domain caps a tenant at 100 levels, and a
   * ladder must be shown whole to mean anything. The same treatment Learning gives course
   * categories.
   */
  public async all(
    transaction: Transaction,
    activeOnly: boolean,
  ): Promise<readonly ReadinessLevelState[]> {
    const activeClause = activeOnly ? ' and active' : '';
    const rows = await transaction.execute<ReadinessLevelRow>(
      `select ${READINESS_LEVEL_COLUMNS} from career_readiness_level
         where tenant_id = $1 and deleted_at is null${activeClause}
         order by ordinal`,
      [transaction.tenantId],
    );

    return rows.map(readinessLevelState);
  }

  public insert(transaction: Transaction, state: ReadinessLevelState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      readinessLevelValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: ReadinessLevelState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.readinessLevelId,
      expected,
      mutable(readinessLevelValues(state, transaction.tenantId)),
    );
  }
}

/**
 * Readiness assessments: insert and read, and nothing else.
 *
 * **This class does not extend `Repository`, and that is the whole point.** Extending it would bring
 * `updateRow`, `softDeleteRow` and `restoreRow` with it, and none of the three may exist for an
 * assessment (D-14): it is a record of what one person said about another on one day, and editing it
 * would destroy the trail that makes the statement answerable. `career_readiness_assessment_no_mutation`
 * refuses the same operations at the table from any path, including SQL nobody wrote in TypeScript;
 * this is the same rule expressed where a developer meets it first.
 *
 * A correction is a *new* assessment, and `historyFor` returns both.
 */
export class PostgresAssessmentRepository implements ReadinessAssessmentStore {
  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ReadinessAssessmentState | undefined> {
    const rows = await transaction.execute<AssessmentRow>(
      `select ${assessmentColumns('a')} from career_readiness_assessment a
         where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : assessmentState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: AssessmentFilters,
    paged: Paged,
  ): Promise<Page<ReadinessAssessmentState>> {
    const base = predicateFor('a', transaction.tenantId, assessmentFilters(filters));
    const parameters = [...base.parameters];
    const predicate = withClause(
      base,
      boundClause(filters.employmentIdsIn, 'a.employment_id', parameters),
    );
    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<AssessmentRow, ReadinessAssessmentState>(
      transaction,
      {
        select: `select ${assessmentColumns('a')} from career_readiness_assessment a
                   where ${bounded.clause}
                   order by a.assessed_on desc, a.recorded_at desc
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_readiness_assessment a
                  where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      assessmentState,
    );
  }

  /**
   * One person's history, most recent first.
   *
   * The tie-break on `recorded_at` is what makes a same-day correction sort above the statement it
   * corrected — two assessors writing on the same civil day resolve to the one written later, which
   * is the point of an append-only trail. Ordering by `assessed_on` alone would return either, and
   * the answer would change between runs.
   */
  public async historyFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly ReadinessAssessmentState[]> {
    const rows = await transaction.execute<AssessmentRow>(
      `select ${assessmentColumns('a')} from career_readiness_assessment a
         where a.employment_id = $1 and a.tenant_id = $2 and a.deleted_at is null
         order by a.assessed_on desc, a.recorded_at desc`,
      [employmentId, transaction.tenantId],
    );

    return rows.map(assessmentState);
  }

  public insert(transaction: Transaction, state: ReadinessAssessmentState): Promise<void> {
    return insertRow(
      transaction,
      'career_readiness_assessment',
      assessmentValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

const assessmentFilters = (filters: AssessmentFilters): readonly Filter[] => [
  { column: 'a.employment_id', value: filters.employmentId },
  { column: 'a.succession_plan_id', value: filters.successionPlanId },
  { column: 'a.position_id', value: filters.positionId },
  { column: 'a.readiness_level_id', value: filters.readinessLevelId },
];
