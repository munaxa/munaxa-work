import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DisciplinaryActionState } from '../domain/disciplinary-action.js';
import type { DisciplinaryRuleState } from '../domain/disciplinary-ladder.js';
import type {
  DisciplinaryActionStore,
  DisciplinaryRuleStore,
} from '../application/relations-ports.js';
import {
  disciplinaryActionState,
  disciplinaryActionValues,
  disciplinaryRuleState,
  disciplinaryRuleValues,
  DISCIPLINARY_ACTION_COLUMNS,
  type DisciplinaryActionRow,
  type DisciplinaryRuleRow,
} from './relation-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The ladder and the actions issued from it, in PostgreSQL.
 *
 * **One has an update and the other cannot.** A ladder is configuration a tenant revises, so
 * `PostgresDisciplinaryRuleRepository` extends `Repository` and the `expected` version guards the
 * ordinary lost-update race. `PostgresDisciplinaryActionRepository` has **insert and read only** and
 * does not extend it — the base class provides `updateRow` and `softDeleteRow`, and neither may
 * exist for a record somebody may be dismissed on the strength of. The trigger refuses both anyway;
 * this is the same rule stated where a developer meets it first.
 *
 * Every statement binds `transaction.tenantId`, and row-level security filters again beneath it.
 */

export class PostgresDisciplinaryRuleRepository
  extends Repository<DisciplinaryRuleRow & { version: number }>
  implements DisciplinaryRuleStore
{
  public constructor() {
    super('relation_disciplinary_rule');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DisciplinaryRuleState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : disciplinaryRuleState(row);
  }

  /**
   * A category's rungs, **most specific first**.
   *
   * `min_occurrence desc, sequence, id` is the evaluation's own precedence, expressed in SQL so the
   * database returns them in the order the domain would sort them into. The domain sorts anyway —
   * two statements of one rule, in the two places somebody might change it — because an ordering
   * that lived only in a query would be lost the first time a caller filtered the result.
   */
  public async forCategory(
    transaction: Transaction,
    violationCategoryId: string,
    includeInactive: boolean,
  ): Promise<readonly DisciplinaryRuleState[]> {
    const rows = await transaction.execute<DisciplinaryRuleRow>(
      `select * from relation_disciplinary_rule
         where tenant_id = $1 and violation_category_id = $2 and deleted_at is null
           and ($3::boolean or active)
         order by min_occurrence desc, sequence, id`,
      [transaction.tenantId, violationCategoryId, includeInactive],
    );

    return rows.map(disciplinaryRuleState);
  }

  public insert(transaction: Transaction, state: DisciplinaryRuleState): Promise<void> {
    return insertRow(
      transaction,
      'relation_disciplinary_rule',
      disciplinaryRuleValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DisciplinaryRuleState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.disciplinaryRuleId,
      expected,
      mutable(disciplinaryRuleValues(state, transaction.tenantId)),
    );
  }
}

/** Issued actions. **Insert and read.** No update, no delete, at this layer or beneath it. */
export class PostgresDisciplinaryActionRepository implements DisciplinaryActionStore {
  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DisciplinaryActionState | undefined> {
    const rows = await transaction.execute<DisciplinaryActionRow>(
      `select ${DISCIPLINARY_ACTION_COLUMNS} from relation_disciplinary_action
         where tenant_id = $1 and id = $2 and deleted_at is null`,
      [transaction.tenantId, id],
    );

    return rows[0] === undefined ? undefined : disciplinaryActionState(rows[0]);
  }

  /**
   * The action issued on one case, if one was.
   *
   * At most one exists — `relation_disciplinary_action_violation_idx` is unique per violation — so
   * this returns a single row rather than a page. Two actions on one matter would be two punishments
   * for one offence, and whether that is ever legitimate is a decision nobody has taken.
   */
  public async forViolation(
    transaction: Transaction,
    violationId: string,
  ): Promise<DisciplinaryActionState | undefined> {
    const rows = await transaction.execute<DisciplinaryActionRow>(
      `select ${DISCIPLINARY_ACTION_COLUMNS} from relation_disciplinary_action
         where tenant_id = $1 and violation_id = $2 and deleted_at is null`,
      [transaction.tenantId, violationId],
    );

    return rows[0] === undefined ? undefined : disciplinaryActionState(rows[0]);
  }

  public insert(transaction: Transaction, state: DisciplinaryActionState): Promise<void> {
    return insertRow(
      transaction,
      'relation_disciplinary_action',
      disciplinaryActionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
