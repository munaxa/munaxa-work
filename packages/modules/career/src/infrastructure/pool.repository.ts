import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type {
  MembershipFilters,
  MembershipStore,
  Page,
  Paged,
  PoolStore,
} from '../application/career-ports.js';
import {
  POOL_COLUMNS,
  membershipColumns,
  membershipState,
  membershipValues,
  poolState,
  poolValues,
  type MembershipRow,
  type PoolRow,
} from './career-config-rows.js';
import {
  boundClause,
  insertRow,
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * Talent pools, and the periods people were in them.
 *
 * **A membership is a period, and removing somebody ends it rather than deleting the row.** There is
 * no delete method here at all: "who did we invest in, and what happened to them" is the question a
 * succession review asks a year later, and a table that forgets cannot answer it.
 *
 * **One *open* membership per pool and employment is `career_pool_membership_open_idx`'s.** The
 * index covers `to_date is null`, so an ended period does not occupy the slot — a person may rejoin
 * a pool they left, and may be in two pools at once. Only being in the *same* pool twice at the same
 * time is refused, and it is refused by the database rather than by a check two administrators could
 * both pass at the same instant.
 */
export class PostgresPoolRepository
  extends Repository<PoolRow & { version: number }>
  implements PoolStore
{
  public constructor() {
    super('career_talent_pool');
  }

  public async byId(transaction: Transaction, id: string): Promise<TalentPoolState | undefined> {
    const rows = await transaction.execute<PoolRow>(
      `select ${POOL_COLUMNS} from career_talent_pool
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : poolState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<TalentPoolState | undefined> {
    const rows = await transaction.execute<PoolRow>(
      `select ${POOL_COLUMNS} from career_talent_pool
         where code = $1 and tenant_id = $2 and deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : poolState(rows[0]);
  }

  public all(
    transaction: Transaction,
    status: string | undefined,
    paged: Paged,
  ): Promise<Page<TalentPoolState>> {
    const predicate = predicateFor('c', transaction.tenantId, [
      { column: 'c.status', value: status },
    ]);

    return pageOf<PoolRow, TalentPoolState>(
      transaction,
      {
        select: `select ${POOL_COLUMNS} from career_talent_pool c
                   where ${predicate.clause}
                   order by c.code
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from career_talent_pool c where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      poolState,
    );
  }

  public insert(transaction: Transaction, state: TalentPoolState): Promise<void> {
    return insertRow(transaction, this.table, poolValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: TalentPoolState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.talentPoolId,
      expected,
      mutable(poolValues(state, transaction.tenantId)),
    );
  }
}

export class PostgresMembershipRepository
  extends Repository<MembershipRow & { version: number }>
  implements MembershipStore
{
  public constructor() {
    super('career_pool_membership');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<PoolMembershipState | undefined> {
    const rows = await transaction.execute<MembershipRow>(
      `select ${membershipColumns('m')} from career_pool_membership m
         where m.id = $1 and m.tenant_id = $2 and m.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : membershipState(rows[0]);
  }

  /**
   * Membership periods, optionally as of a day.
   *
   * `inForceOn` is **inclusive of both ends** — somebody removed on the 30th was in the pool on the
   * 30th — and it is expressed in SQL rather than filtered afterwards, so a page of results is a
   * page of the answer rather than a page of candidates. The comparison is between two `date`
   * values, and the parameter is a `YYYY-MM-DD` string PostgreSQL casts; nothing on this path
   * becomes a JavaScript `Date`.
   */
  public search(
    transaction: Transaction,
    filters: MembershipFilters,
    paged: Paged,
  ): Promise<Page<PoolMembershipState>> {
    const base = predicateFor('m', transaction.tenantId, membershipFilters(filters));
    const parameters = [...base.parameters];
    let predicate = withClause(
      base,
      boundClause(filters.employmentIdsIn, 'm.employment_id', parameters),
    );

    if (filters.openOnly === true) predicate = withClause(predicate, 'm.to_date is null');
    if (filters.inForceOn !== undefined) {
      parameters.push(filters.inForceOn);
      const placeholder = `$${String(parameters.length)}::date`;

      predicate = withClause(
        predicate,
        `m.from_date <= ${placeholder} and (m.to_date is null or m.to_date >= ${placeholder})`,
      );
    }

    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<MembershipRow, PoolMembershipState>(
      transaction,
      {
        select: `select ${membershipColumns('m')} from career_pool_membership m
                   where ${bounded.clause}
                   order by m.from_date desc, m.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_pool_membership m where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      membershipState,
    );
  }

  public async openFor(
    transaction: Transaction,
    talentPoolId: string,
    employmentId: string,
  ): Promise<PoolMembershipState | undefined> {
    const rows = await transaction.execute<MembershipRow>(
      `select ${membershipColumns('m')} from career_pool_membership m
         where m.talent_pool_id = $1 and m.employment_id = $2 and m.tenant_id = $3
           and m.to_date is null and m.deleted_at is null`,
      [talentPoolId, employmentId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : membershipState(rows[0]);
  }

  public insertIfAbsent(transaction: Transaction, state: PoolMembershipState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      membershipValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: PoolMembershipState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.membershipId,
      expected,
      mutable(membershipValues(state, transaction.tenantId)),
    );
  }
}

const membershipFilters = (filters: MembershipFilters): readonly Filter[] => [
  { column: 'm.talent_pool_id', value: filters.talentPoolId },
  { column: 'm.employment_id', value: filters.employmentId },
];
