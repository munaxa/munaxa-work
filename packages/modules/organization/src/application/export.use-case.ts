import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import type { OrganizationSnapshot } from '../contracts/views.js';

import {
  calendarView,
  centerView,
  establishmentView,
  legalEntityView,
  placementView,
  positionView,
  unitTypeView,
  unitView,
} from './organization-views.js';
import { OrganizationPermissions } from './organization-permissions.js';
import { IMPORT_LIMIT } from './import-contract.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

export interface ExportStructure extends Query {
  readonly queryName: 'organization.export-structure';
}

/**
 * The whole organization as one document — every type, unit, placement period, registration,
 * centre, position, establishment line and calendar.
 *
 * Placements are exported as *every period*, not just the ones in force. An export that carried
 * only today's structure would be a backup that silently discarded the history this phase exists
 * to keep.
 */
export const exportStructureHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ExportStructure, OrganizationSnapshot> => ({
  queryName: 'organization.export-structure',
  permission: OrganizationPermissions.exportStructure,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) =>
      success(await snapshot(dependencies, transaction)),
    ),
});

const snapshot = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
): Promise<OrganizationSnapshot> => {
  const { stores } = dependencies;
  const [types, units, placements, legalEntities, positions, establishments, calendars] =
    await Promise.all([
      stores.unitTypes.list(transaction),
      stores.units.all(transaction),
      stores.placements.all(transaction),
      stores.legalEntities.list(transaction),
      stores.positions.all(transaction),
      stores.establishments.all(transaction),
      stores.calendars.list(transaction),
    ]);
  const [cost, profit] = await Promise.all([
    stores.centers.list(transaction, { kind: 'cost', limit: IMPORT_LIMIT, offset: 0 }),
    stores.centers.list(transaction, { kind: 'profit', limit: IMPORT_LIMIT, offset: 0 }),
  ]);

  return {
    exportedAt: dependencies.clock.now(),
    unitTypes: types.map(unitTypeView),
    units: units.map(unitView),
    placements: placements.map(placementView),
    legalEntities: legalEntities.map(legalEntityView),
    centers: [...cost.items, ...profit.items].map(centerView),
    positions: positions.map(positionView),
    establishments: establishments.map(establishmentView),
    calendars: calendars.map(calendarView),
  };
};
