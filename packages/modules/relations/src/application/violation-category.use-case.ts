import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  createViolationCategory,
  type DefineViolationCategoryRequest,
  type LocalizedName,
  type ViolationCategoryState,
} from '../domain/violation-category.js';
import { conflicted, notFound, refusedBy } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Defining and amending what a tenant calls a kind of violation.
 *
 * **Nothing statutory is created here or anywhere.** No offence, no penalty and no jurisdiction
 * ships with this product — every entry is a row a customer writes, or one day a country pack writes
 * (AD-002, D-5.2-06).
 *
 * Amendment is deliberately narrow. **`code` and `source` are not editable.** Recorded violations
 * froze a copy of the code, so changing it would leave the frozen copy disagreeing with the entry it
 * came from; and `source` is a claim about which authority wrote the rule, which a tenant cannot
 * change by editing a field. Name, severity, sequence, repeat window and active state may change,
 * because those govern what happens next rather than what already happened.
 *
 * **Deactivation is how an entry leaves service, and there is no delete.** Violations recorded
 * against it must still read correctly years later.
 */

export interface DefineViolationCategoryCommand extends Command {
  readonly commandName: 'relations.define-category';
  readonly code: string;
  readonly name: LocalizedName;
  readonly severity: string;
  readonly sequence: number;
  readonly repeatWindowDays: number;
  readonly source: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}

export interface ViolationCategoryDefined {
  readonly violationCategoryId: string;
}

export const defineViolationCategoryHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<DefineViolationCategoryCommand, ViolationCategoryDefined> => ({
  commandName: 'relations.define-category',
  permission: RelationsPermissions.categoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.categories.byCode(transaction, command.code);

      // Checked before the insert for a readable refusal; the unique index is what actually settles
      // two administrators defining the same code at the same moment (ADR-0071).
      if (existing !== undefined)
        return conflicted<ViolationCategoryDefined>('category_code_taken');

      const created = createViolationCategory({ violationCategoryId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<ViolationCategoryDefined>(created.error);

      await dependencies.stores.categories.insert(transaction, created.value);
      return success({ violationCategoryId: created.value.violationCategoryId });
    }),
});

export interface AmendViolationCategoryCommand extends Command {
  readonly commandName: 'relations.amend-category';
  readonly violationCategoryId: string;
  readonly expectedVersion: number;
  readonly name?: LocalizedName;
  readonly severity?: string;
  readonly sequence?: number;
  readonly repeatWindowDays?: number;
  readonly active?: boolean;
}

export const amendViolationCategoryHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<AmendViolationCategoryCommand, ViolationCategoryDefined> => ({
  commandName: 'relations.amend-category',
  permission: RelationsPermissions.categoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.categories.byId(
        transaction,
        command.violationCategoryId,
      );

      if (held === undefined) return notFound<ViolationCategoryDefined>('violation_category');

      const amended = createViolationCategory(amendedShape(held, command));

      if (!amended.ok) return refusedBy<ViolationCategoryDefined>(amended.error);

      await dependencies.stores.categories.update(
        transaction,
        // `version` is not written by the caller: the repository appends `version = version + 1`,
        // and supplying it here would assign the column twice in one statement.
        { ...amended.value, version: held.version },
        command.expectedVersion,
      );
      return success({ violationCategoryId: held.violationCategoryId });
    }),
});

/**
 * The amended entry, rebuilt through the aggregate's own constructor.
 *
 * Rebuilt rather than field-assigned so every invariant is re-checked against the amended shape
 * instead of only against the original — a sequence amended to `-1` is refused for the same reason
 * one defined as `-1` is. `code` and `source` are carried over unchanged, for the reasons above.
 */
const amendedShape = (
  held: ViolationCategoryState,
  command: AmendViolationCategoryCommand,
): DefineViolationCategoryRequest => ({
  violationCategoryId: held.violationCategoryId,
  code: held.code,
  source: held.source,
  name: command.name ?? held.name,
  severity: command.severity ?? held.severity,
  sequence: command.sequence ?? held.sequence,
  repeatWindowDays: command.repeatWindowDays ?? held.repeatWindowDays,
  active: command.active ?? held.active,
  ...(held.countryPackId === undefined ? {} : { countryPackId: held.countryPackId }),
  ...(held.countryPackVersion === undefined ? {} : { countryPackVersion: held.countryPackVersion }),
});
