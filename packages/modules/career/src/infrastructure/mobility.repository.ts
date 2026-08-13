import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { MobilityRecommendationState } from '../domain/mobility.js';
import type { MobilityFilters, MobilityStore, Page, Paged } from '../application/career-ports.js';
import {
  mobilityColumns,
  mobilityState,
  mobilityValues,
  type MobilityRow,
} from './career-development-rows.js';
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
 * Mobility recommendations, as a table.
 *
 * **`expired` is never written and never read from a column** (D-13). The row carries `valid_until`;
 * whether it has passed is worked out at the view boundary against the day somebody asked, and a
 * check constraint refuses the word as a stored value so nothing can quietly start writing it.
 *
 * That matters more than it looks. A stored `expired` would need something to move it overnight, and
 * nothing runs — `JobPort` has no adapter anywhere in this repository. A flag nothing maintains is a
 * flag that is wrong from the first midnight onwards, and every screen reading it would be confidently
 * wrong. This is Learning's certificate-validity construction (ADR-0070).
 *
 * **`status` filters the stored value.** A caller filtering for `expired` therefore matches nothing,
 * which is the correct answer rather than a bug: nothing ever wrote that word.
 *
 * **Accepting a recommendation writes one row and nothing else** (ADR-0072). There is no second
 * statement in `update` and no other table in this file.
 */
export class PostgresMobilityRepository
  extends Repository<MobilityRow & { version: number }>
  implements MobilityStore
{
  public constructor() {
    super('career_mobility_recommendation');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<MobilityRecommendationState | undefined> {
    const rows = await transaction.execute<MobilityRow>(
      `select ${mobilityColumns('r')} from career_mobility_recommendation r
         where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : mobilityState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: MobilityFilters,
    paged: Paged,
  ): Promise<Page<MobilityRecommendationState>> {
    const base = predicateFor('r', transaction.tenantId, mobilityFilters(filters));
    const parameters = [...base.parameters];
    const predicate = withClause(
      base,
      boundClause(filters.employmentIdsIn, 'r.employment_id', parameters),
    );
    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<MobilityRow, MobilityRecommendationState>(
      transaction,
      {
        select: `select ${mobilityColumns('r')} from career_mobility_recommendation r
                   where ${bounded.clause}
                   order by r.recommended_on desc, r.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_mobility_recommendation r
                  where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      mobilityState,
    );
  }

  /**
   * The undecided recommendations for one person.
   *
   * `proposed` is a *stored* status, and this deliberately does not filter on `valid_until`: a
   * recommendation that reads as expired is still proposed in the row and can still be decided. The
   * caller derives the standing and shows it; refusing a stale acceptance would be a business rule,
   * and none was specified.
   */
  public async openFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly MobilityRecommendationState[]> {
    const rows = await transaction.execute<MobilityRow>(
      `select ${mobilityColumns('r')} from career_mobility_recommendation r
         where r.employment_id = $1 and r.tenant_id = $2
           and r.status = 'proposed' and r.deleted_at is null
         order by r.recommended_on desc, r.id`,
      [employmentId, transaction.tenantId],
    );

    return rows.map(mobilityState);
  }

  public insert(transaction: Transaction, state: MobilityRecommendationState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      mobilityValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: MobilityRecommendationState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.mobilityRecommendationId,
      expected,
      mutable(mobilityValues(state, transaction.tenantId)),
    );
  }
}

const mobilityFilters = (filters: MobilityFilters): readonly Filter[] => [
  { column: 'r.employment_id', value: filters.employmentId },
  { column: 'r.status', value: filters.status },
  { column: 'r.kind', value: filters.kind },
];
