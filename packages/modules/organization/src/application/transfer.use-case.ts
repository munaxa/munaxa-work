import { success, type Command, type CommandHandler } from '@work/kernel';

import { createTypes, createUnits, placeUnits } from './import-passes.js';
import { IMPORT_LIMIT } from './import-contract.js';
import type { CommandSender, ImportedUnit, ImportedUnitType } from './import-contract.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Bulk import of a structure. Export is its mirror, in `export.use-case.ts`.
 *
 * Import is the operation with the most ways to be wrong, so it is deliberately the least clever
 * thing in this module: it dispatches the *same commands* an administrator would issue one at a
 * time. It does not write rows, it does not skip validation, and it has no fast path. A bulk
 * loader that bypassed the application service would bypass the invariants with it — the code
 * uniqueness, the type's parent rule, the bilingual name, the cycle guard — and the first thing
 * anybody imports is a structure they typed in a spreadsheet.
 *
 * It is **not atomic**, and that is worth stating rather than implying. Each dispatched command
 * opens its own unit of work — the Unit of Work does not nest, because a nested transaction is a
 * savepoint pretending to be one — so a file with one bad row leaves everything before it
 * written. What makes that safe is that the import is **resumable**: a unit whose code already
 * exists is reused, and placing a unit where it already is from the date it has been there is a
 * no-op. Fix the row, run the same file again, and it completes. Writing rows directly so the
 * whole thing could be one transaction would buy atomicity by bypassing every invariant.
 *
 * It is synchronous and bounded. 00A's budgets put a *large* import in a background job, which
 * Phase 24 owns; this is the bounded case, with the bound enforced rather than discovered.
 */

export interface ImportStructure extends Command {
  readonly commandName: 'organization.import-structure';
  readonly unitTypes: readonly ImportedUnitType[];
  readonly units: readonly ImportedUnit[];
}

export interface StructureImported {
  readonly unitTypesCreated: number;
  readonly unitTypesReused: number;
  readonly unitsCreated: number;
  readonly unitsReused: number;
  readonly unitsPlaced: number;
}

export const importStructureHandler = (
  dependencies: OrganizationDependencies,
  sender: CommandSender,
): CommandHandler<ImportStructure, StructureImported> => ({
  commandName: 'organization.import-structure',
  permission: OrganizationPermissions.importStructure,

  validate: (command) =>
    command.unitTypes.length + command.units.length <= IMPORT_LIMIT
      ? []
      : [
          {
            field: 'units',
            message: `an import is limited to ${String(IMPORT_LIMIT)} rows; split the file or use the API one unit at a time`,
          },
        ],

  handle: async (command) => {
    const types = await createTypes(sender, dependencies, command.unitTypes);

    if (!types.ok) return types;

    const units = await createUnits(sender, dependencies, command.units, types.value.byCode);

    if (!units.ok) return units;

    const placed = await placeUnits(sender, dependencies, command.units, units.value.byCode);

    if (!placed.ok) return placed;

    return success({
      unitTypesCreated: types.value.created,
      unitTypesReused: types.value.reused,
      unitsCreated: units.value.created,
      unitsReused: units.value.reused,
      unitsPlaced: placed.value,
    });
  },
});

/** Re-published so a consumer describes an import from one place. */
export { IMPORT_LIMIT } from './import-contract.js';
export type { CommandSender, ImportedUnit, ImportedUnitType, Resolved } from './import-contract.js';
