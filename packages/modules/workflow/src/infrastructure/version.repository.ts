import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { WorkflowStepTemplateState, WorkflowVersionState } from '../domain/definition.js';
import type { Page, Paged, VersionStore } from '../application/workflow-ports.js';
import {
  TEMPLATE_COLUMNS,
  templateState,
  templateValues,
  versionColumns,
  versionState,
  versionValues,
  type TemplateRow,
  type VersionRow,
} from './workflow-rows.js';
import { asNumber, insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * Versions of a definition, and the step templates along one.
 *
 * **Two tables, one repository, because they are one aggregate.** A step template has no life
 * outside its version: it is created only while the version is a draft, frozen when the version is
 * published, and copied — never referenced — when an instance starts. Exposing a separate template
 * store would give a handler a way to reach past the version into its contents, which is the
 * boundary Checkpoint 3 drew and the same reason Career's path repository owns `career_stage`.
 *
 * **Nothing here opens a transaction.** Publishing reads the templates and updates the version, and
 * both run inside the unit of work the application established.
 */
export class PostgresVersionRepository
  extends Repository<VersionRow & { version: number }>
  implements VersionStore
{
  public constructor() {
    super('workflow_version');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<WorkflowVersionState | undefined> {
    const rows = await transaction.execute<VersionRow>(
      `select ${versionColumns('v')} from workflow_version v
         where v.id = $1 and v.tenant_id = $2 and v.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : versionState(rows[0]);
  }

  public forDefinition(
    transaction: Transaction,
    definitionId: string,
    paged: Paged,
  ): Promise<Page<WorkflowVersionState>> {
    const predicate = predicateFor('v', transaction.tenantId, [
      { column: 'v.definition_id', value: definitionId },
    ]);

    return pageOf<VersionRow, WorkflowVersionState>(
      transaction,
      {
        select: `select ${versionColumns('v')} from workflow_version v
                   where ${predicate.clause}
                   order by v.version_number desc, v.id
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from workflow_version v where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      versionState,
    );
  }

  /**
   * The published version a new approval follows: the highest-numbered one.
   *
   * `order by version_number desc limit 1` rather than a count or a scan, because
   * `workflow_version_published_idx` is ordered `version_number desc` for exactly this read — so it
   * is one row out of an index rather than a sort of every version a definition has ever had.
   *
   * Nothing constrains a definition to one published version (Checkpoint 3 declined to invent that
   * rule), so "which one" has to be a choice, and the newest is the only defensible one.
   */
  public async currentPublished(
    transaction: Transaction,
    definitionId: string,
  ): Promise<WorkflowVersionState | undefined> {
    const rows = await transaction.execute<VersionRow>(
      `select ${versionColumns('v')} from workflow_version v
         where v.definition_id = $1 and v.tenant_id = $2 and v.status = 'published'
           and v.deleted_at is null
         order by v.version_number desc, v.id
         limit 1`,
      [definitionId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : versionState(rows[0]);
  }

  /**
   * The next version number, counted by the database.
   *
   * `max(version_number)` rather than the length of a page: a page is bounded, so counting its rows
   * would restart the numbering at fifty-one for a definition with fifty versions. Soft-deleted rows
   * are included deliberately — the unique index that arbitrates this is partial on `deleted_at is
   * null`, but reusing a number a discarded draft once held would make two rows in the audit trail
   * answer to the same name.
   */
  public async nextNumberFor(transaction: Transaction, definitionId: string): Promise<number> {
    const rows = await transaction.execute<{ highest: string | null }>(
      `select max(version_number)::text as highest from workflow_version
         where definition_id = $1 and tenant_id = $2`,
      [definitionId, transaction.tenantId],
    );

    return asNumber(rows[0]?.highest ?? '0') + 1;
  }

  public insert(transaction: Transaction, state: WorkflowVersionState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_version',
      versionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: WorkflowVersionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.workflowVersionId,
      expected,
      mutable(versionValues(state, transaction.tenantId)),
    );
  }

  /** In ordinal order. Publication already refused any order that is not contiguous from one. */
  public async templatesFor(
    transaction: Transaction,
    workflowVersionId: string,
  ): Promise<readonly WorkflowStepTemplateState[]> {
    const rows = await transaction.execute<TemplateRow>(
      `select ${TEMPLATE_COLUMNS} from workflow_step_template
         where workflow_version_id = $1 and tenant_id = $2 and deleted_at is null
         order by ordinal, id`,
      [workflowVersionId, transaction.tenantId],
    );

    return rows.map(templateState);
  }

  public insertTemplate(transaction: Transaction, state: WorkflowStepTemplateState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_step_template',
      templateValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
