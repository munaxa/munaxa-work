import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { OnboardingQuery, OnboardingStore, Page } from '../application/onboarding-ports.js';

import {
  INSTANCE_COLUMNS,
  instanceInsert,
  instanceUpdate,
  toInstance,
  type OnboardingInstanceRow,
} from './onboarding-rows.js';
import { onboardingFilters } from './onboarding-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * The onboarding instance, in PostgreSQL.
 *
 * Two reads here carry the weight of the module's reliability argument, and both are written to
 * agree exactly with the partial unique index in the migration.
 *
 * `liveForEmployment` uses the *same* predicate as
 * `onboarding_instance_live_employment_key` — `state in ('draft', 'preboarding', 'in_progress')` and
 * not deleted. If this read and that index ever disagreed about what "live" means, the start command
 * would read "none" and the insert would still be refused, and a retry would loop rather than
 * converge (ADR-0050). The literal list is repeated rather than computed from the vocabulary so the
 * SQL a reviewer reads is the SQL that runs.
 *
 * `employmentsWithAny` is reconciliation's half of the same question, asked for a page of
 * employments at once. One query rather than one per employment: reconciliation runs over the whole
 * live workforce, and a per-row read is the difference between a job that finishes and a job that is
 * still running when the next one starts.
 */
export class OnboardingRepository
  extends Repository<{ id: string; version: number }>
  implements OnboardingStore
{
  public constructor() {
    super('onboarding_instance');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<OnboardingInstanceState | undefined> {
    const rows = await transaction.execute<OnboardingInstanceRow>(
      `select ${INSTANCE_COLUMNS} from onboarding_instance o
        where o.id = $1 and o.tenant_id = $2 and o.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toInstance(row);
  }

  public async liveForEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<OnboardingInstanceState | undefined> {
    const rows = await transaction.execute<OnboardingInstanceRow>(
      `select ${INSTANCE_COLUMNS} from onboarding_instance o
        where o.tenant_id = $1 and o.employment_id = $2
          and o.state in ('draft', 'preboarding', 'in_progress') and o.deleted_at is null`,
      [transaction.tenantId, employmentId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toInstance(row);
  }

  /**
   * Which of these employments already have an onboarding — of *any* state, not only a live one.
   *
   * Any, deliberately: reconciliation exists to create the onboarding a missed event did not, and an
   * employment whose onboarding was completed or cancelled has been dealt with. Filtering to live
   * ones would make every rerun recreate an onboarding somebody had already cancelled, which is the
   * one way a safe-to-rerun job becomes a nightly duplicate factory.
   */
  public async employmentsWithAny(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly string[]> {
    if (employmentIds.length === 0) return [];

    const rows = await transaction.execute<{ employment_id: string }>(
      `select distinct o.employment_id from onboarding_instance o
        where o.tenant_id = $1 and o.employment_id = any($2::uuid[]) and o.deleted_at is null`,
      [transaction.tenantId, [...employmentIds]],
    );
    return rows.map((row) => row.employment_id);
  }

  public search(
    transaction: Transaction,
    query: OnboardingQuery,
  ): Promise<Page<OnboardingInstanceState>> {
    const { where, parameters } = onboardingFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<OnboardingInstanceRow, OnboardingInstanceState>(
      transaction,
      {
        select: `select ${INSTANCE_COLUMNS} from onboarding_instance o where ${where}
                 order by o.planned_start_on, o.id limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from onboarding_instance o where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toInstance,
    );
  }

  public async all(transaction: Transaction): Promise<readonly OnboardingInstanceState[]> {
    const rows = await transaction.execute<OnboardingInstanceRow>(
      `select ${INSTANCE_COLUMNS} from onboarding_instance o
        where o.tenant_id = $1 and o.deleted_at is null order by o.planned_start_on, o.id`,
      [transaction.tenantId],
    );
    return rows.map(toInstance);
  }

  /**
   * Inserts the instance, and lets the unique index decide.
   *
   * No `on conflict do nothing` here: the start command needs to *know* it lost, so it can read the
   * winner's instance and return it. Swallowing the conflict would return a success carrying no
   * identifier, which is the shape of an idempotent API that quietly does nothing.
   */
  public async insert(transaction: Transaction, state: OnboardingInstanceState): Promise<void> {
    await insertRow(transaction, this.table, instanceInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: OnboardingInstanceState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, instanceUpdate(state));
  }
}
