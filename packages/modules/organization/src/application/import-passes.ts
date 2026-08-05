import { success, type HandlerFailure, type Result } from '@work/kernel';

import type { CommandSender, ImportedUnit, ImportedUnitType, Resolved } from './import-contract.js';
import type { CreateUnitCommand } from './unit.use-case.js';
import type { DefineUnitTypeCommand } from './unit-type.use-case.js';
import type { PlaceUnitCommand } from './hierarchy.use-case.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The three passes an import makes, and the lookups that make it resumable.
 *
 * Split from the handler so neither outgrows its budget, and because these are the parts worth
 * reading: each dispatches ordinary commands, and each skips what already exists.
 */

export const createTypes = async (
  sender: CommandSender,
  dependencies: OrganizationDependencies,
  rows: readonly ImportedUnitType[],
): Promise<Result<Resolved, HandlerFailure>> => {
  const byCode = new Map<string, string>();
  let created = 0;
  let reused = 0;

  for (const row of rows) {
    const existing = await existingTypeId(dependencies, row.code);

    if (existing !== undefined) {
      byCode.set(row.code, existing);
      reused += 1;
      continue;
    }

    const defined = await sender.send<{ unitTypeId: string }, DefineUnitTypeCommand>({
      commandName: 'organization.define-unit-type',
      code: row.code,
      name: row.name,
      ordinal: row.ordinal,
      ...(row.allowedParentCodes === undefined
        ? {}
        : { allowedParentCodes: row.allowedParentCodes }),
      ...(row.allowedAtRoot === undefined ? {} : { allowedAtRoot: row.allowedAtRoot }),
      ...(row.carriesLegalEntity === undefined
        ? {}
        : { carriesLegalEntity: row.carriesLegalEntity }),
    } satisfies DefineUnitTypeCommand);

    if (!defined.ok) return defined;
    byCode.set(row.code, defined.value.unitTypeId);
    created += 1;
  }
  return success({ byCode, created, reused });
};

export const createUnits = async (
  sender: CommandSender,
  dependencies: OrganizationDependencies,
  rows: readonly ImportedUnit[],
  typeIds: ReadonlyMap<string, string>,
): Promise<Result<Resolved, HandlerFailure>> => {
  const byCode = new Map<string, string>();
  let created = 0;
  let reused = 0;

  for (const row of rows) {
    const existing = await codeToId(dependencies, row.code);

    if (existing !== undefined) {
      byCode.set(row.code, existing);
      reused += 1;
      continue;
    }
    const unitTypeId = typeIds.get(row.unitTypeCode);

    if (unitTypeId === undefined) {
      return {
        ok: false,
        error: {
          kind: 'validation',
          failures: [
            {
              field: `units.${row.code}.unitTypeCode`,
              message: `no unit type "${row.unitTypeCode}" in this import`,
            },
          ],
        },
      };
    }

    const made = await sender.send<{ unitId: string }, CreateUnitCommand>({
      commandName: 'organization.create-unit',
      unitTypeId,
      code: row.code,
      name: row.name,
      ...(row.description === undefined ? {} : { description: row.description }),
      ...(row.metadata === undefined ? {} : { metadata: row.metadata }),
      effectiveFrom: row.effectiveFrom,
    } satisfies CreateUnitCommand);

    if (!made.ok) return made;
    byCode.set(row.code, made.value.unitId);
    created += 1;
  }
  return success({ byCode, created, reused });
};

/**
 * Places every imported unit, after all of them exist.
 *
 * Two passes rather than one, because a spreadsheet is not sorted: a department may appear above
 * the division it belongs to, and a single pass would fail on a forward reference. Creating
 * everything first makes the order of the file irrelevant, which is the only way an import of
 * somebody else's export works.
 */
export const placeUnits = async (
  sender: CommandSender,
  dependencies: OrganizationDependencies,
  rows: readonly ImportedUnit[],
  unitIds: ReadonlyMap<string, string>,
): Promise<Result<number, HandlerFailure>> => {
  let placed = 0;

  for (const row of rows) {
    const unitId = unitIds.get(row.code);

    if (unitId === undefined) continue;

    const parentUnitId =
      row.parentCode === undefined
        ? undefined
        : (unitIds.get(row.parentCode) ?? (await codeToId(dependencies, row.parentCode)));

    if (row.parentCode !== undefined && parentUnitId === undefined) {
      return {
        ok: false,
        error: {
          kind: 'validation',
          failures: [
            {
              field: `units.${row.code}.parentCode`,
              message: `no unit "${row.parentCode}" in this import or in this tenant`,
            },
          ],
        },
      };
    }

    const result = await sender.send<unknown, PlaceUnitCommand>({
      commandName: 'organization.place-unit',
      unitId,
      ...(parentUnitId === undefined ? {} : { parentUnitId }),
      effectiveFrom: row.effectiveFrom,
    } satisfies PlaceUnitCommand);

    if (!result.ok) return result;
    placed += 1;
  }
  return success(placed);
};

/**
 * A unit that already exists in the tenant, by code.
 *
 * This is what makes the import both *resumable* and *extending*: a second run of a corrected
 * file reuses what the first run wrote, and a file that names an existing division as a parent
 * attaches to it rather than refusing.
 */
const codeToId = async (
  dependencies: OrganizationDependencies,
  code: string,
): Promise<string | undefined> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const unit = await dependencies.stores.units.byCode(transaction, code);
    return unit?.id;
  });

const existingTypeId = async (
  dependencies: OrganizationDependencies,
  code: string,
): Promise<string | undefined> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const type = await dependencies.stores.unitTypes.byCode(transaction, code);
    return type?.id;
  });
