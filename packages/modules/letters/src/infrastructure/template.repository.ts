import { Repository, auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { LetterTemplateState, LetterTemplateVersionState } from '../domain/letter-template.js';
import type { TemplateStore, TemplateVersionStore } from '../application/letters-ports.js';
import {
  templateState,
  templateValues,
  templateVersionState,
  templateVersionValues,
  type LetterTemplateRow,
  type LetterTemplateVersionRow,
} from './letter-rows.js';
import { insertRow, mutable } from './row-writer.js';

/** Templates and their versions, in PostgreSQL. */

export class PostgresTemplateRepository
  extends Repository<LetterTemplateRow & { version: number }>
  implements TemplateStore
{
  public constructor() {
    super('letter_template');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<LetterTemplateState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : templateState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<LetterTemplateState | undefined> {
    const rows = await transaction.execute<LetterTemplateRow>(
      `select * from letter_template
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : templateState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly LetterTemplateState[]> {
    const rows = await transaction.execute<LetterTemplateRow>(
      `select * from letter_template
         where tenant_id = $1 and deleted_at is null
         order by category, code`,
      [transaction.tenantId],
    );

    return rows.map(templateState);
  }

  public insert(transaction: Transaction, state: LetterTemplateState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      templateValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: LetterTemplateState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.letterTemplateId,
      expected,
      mutable(templateValues(state, transaction.tenantId)),
    );
  }
}

/**
 * Template versions.
 *
 * This one **does** extend `Repository`, unlike Documents' version store, and the difference is
 * deliberate: a template version is authoring content that may legitimately be edited right up
 * until it issues something. From that moment it is frozen, and the freeze is enforced by a trigger
 * rather than by the absence of a method — `first_issued_at is not null` is a condition, not a
 * table-wide rule, and only the database can check it on every path.
 */
export class PostgresTemplateVersionRepository
  extends Repository<LetterTemplateVersionRow & { version: number }>
  implements TemplateVersionStore
{
  public constructor() {
    super('letter_template_version');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<LetterTemplateVersionState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : templateVersionState(row);
  }

  public async forTemplate(
    transaction: Transaction,
    templateId: string,
  ): Promise<readonly LetterTemplateVersionState[]> {
    const rows = await transaction.execute<LetterTemplateVersionRow>(
      `select * from letter_template_version
         where tenant_id = $1 and letter_template_id = $2 and deleted_at is null
         order by version_number`,
      [transaction.tenantId, templateId],
    );

    return rows.map(templateVersionState);
  }

  public async highestVersionNumber(transaction: Transaction, templateId: string): Promise<number> {
    const rows = await transaction.execute<{ highest: string | null }>(
      `select max(version_number)::text as highest from letter_template_version
         where tenant_id = $1 and letter_template_id = $2 and deleted_at is null`,
      [transaction.tenantId, templateId],
    );

    return Number(rows[0]?.highest ?? '0');
  }

  public insert(transaction: Transaction, state: LetterTemplateVersionState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      templateVersionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: LetterTemplateVersionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.letterTemplateVersionId,
      expected,
      mutable(templateVersionValues(state, transaction.tenantId)),
    );
  }

  /**
   * The moment this version stopped being editable.
   *
   * `first_issued_at is null` in the predicate makes it write-once: the freeze does not lift, and a
   * second issuance does not move the date. The trigger permits this stamp precisely because the
   * row is still editable when it runs — from the next statement onward it is not.
   */
  public async markFirstIssued(transaction: Transaction, id: string, moment: Date): Promise<void> {
    const audit = auditForUpdate(moment);

    await transaction.execute(
      `update letter_template_version
          set first_issued_at = $1, updated_at = $2, updated_by = $3, version = version + 1
        where id = $4 and tenant_id = $5 and first_issued_at is null`,
      [moment, audit.updated_at, audit.updated_by, id, transaction.tenantId],
    );
  }
}
