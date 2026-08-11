import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type {
  CompetencyFrameworkState,
  CompetencyLevelState,
  CompetencyState,
} from '../domain/competency-framework.js';
import type { CompetencyFrameworkStore } from '../application/performance-ports.js';
import {
  FRAMEWORK_COLUMNS,
  competencyLevelState,
  competencyLevelValues,
  competencyState,
  competencyValues,
  frameworkState,
  frameworkValues,
  type CompetencyLevelRow,
  type CompetencyRow,
  type FrameworkRow,
} from './configuration-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * Competency frameworks and the competencies within them.
 *
 * A framework *version* is published, never edited: `framework_version` is part of the identity, so
 * redefining a competency writes version 3 rather than rewriting version 2 — and a review assessed
 * under version 2 still reads as version 2, because its snapshot holds the definitions.
 */

export class PostgresFrameworkRepository
  extends Repository<FrameworkRow & { version: number }>
  implements CompetencyFrameworkStore
{
  public constructor() {
    super('performance_competency_framework');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CompetencyFrameworkState | undefined> {
    const rows = await transaction.execute<FrameworkRow>(
      `select ${FRAMEWORK_COLUMNS} from performance_competency_framework
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : frameworkState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
    frameworkVersion: number,
  ): Promise<CompetencyFrameworkState | undefined> {
    const rows = await transaction.execute<FrameworkRow>(
      `select ${FRAMEWORK_COLUMNS} from performance_competency_framework
         where tenant_id = $1 and code = $2 and framework_version = $3 and deleted_at is null`,
      [transaction.tenantId, code, frameworkVersion],
    );

    return rows[0] === undefined ? undefined : frameworkState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly CompetencyFrameworkState[]> {
    const rows = await transaction.execute<FrameworkRow>(
      `select ${FRAMEWORK_COLUMNS} from performance_competency_framework
         where tenant_id = $1 and deleted_at is null
         order by code, framework_version`,
      [transaction.tenantId],
    );

    return rows.map(frameworkState);
  }

  public async competenciesFor(
    transaction: Transaction,
    frameworkId: string,
  ): Promise<readonly CompetencyState[]> {
    const rows = await transaction.execute<CompetencyRow>(
      `select * from performance_competency
         where tenant_id = $1 and framework_id = $2 and deleted_at is null
         order by display_order`,
      [transaction.tenantId, frameworkId],
    );

    return rows.map(competencyState);
  }

  public async levelsFor(
    transaction: Transaction,
    competencyId: string,
  ): Promise<readonly CompetencyLevelState[]> {
    const rows = await transaction.execute<CompetencyLevelRow>(
      `select * from performance_competency_level
         where tenant_id = $1 and competency_id = $2 and deleted_at is null
         order by ordinal`,
      [transaction.tenantId, competencyId],
    );

    return rows.map(competencyLevelState);
  }

  public insert(transaction: Transaction, framework: CompetencyFrameworkState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      frameworkValues(framework, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    framework: CompetencyFrameworkState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      framework.frameworkId,
      expected,
      mutable(frameworkValues(framework, transaction.tenantId)),
    );
  }

  public async insertCompetency(
    transaction: Transaction,
    competency: CompetencyState,
    levels: readonly CompetencyLevelState[],
  ): Promise<void> {
    const now = new Date();

    await insertRow(
      transaction,
      'performance_competency',
      competencyValues(competency, transaction.tenantId),
      now,
    );
    for (const level of levels) {
      await insertRow(
        transaction,
        'performance_competency_level',
        competencyLevelValues(level, transaction.tenantId),
        now,
      );
    }
  }
}
