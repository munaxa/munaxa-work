import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendCalendarHandler,
  defineCalendarHandler,
  recordCalendarDayHandler,
  removeCalendarDayHandler,
} from './calendar.use-case.js';
import { approveEstablishmentHandler, setEstablishmentHandler } from './establishment.use-case.js';
import {
  closeCostCenterHandler,
  closeProfitCenterHandler,
  openCostCenterHandler,
  openProfitCenterHandler,
} from './financial-center.use-case.js';
import { detachUnitHandler, placeUnitHandler } from './hierarchy.use-case.js';
import {
  amendLegalEntityHandler,
  closeLegalEntityHandler,
  registerLegalEntityHandler,
} from './legal-entity.use-case.js';
import {
  listLegalEntitiesHandler,
  listPositionsHandler,
  listUnitTypesHandler,
  listUnitsHandler,
  readTenantSettingsHandler,
} from './organization-queries.js';
import {
  definePositionHandler,
  retirePositionHandler,
  revisePositionHandler,
} from './position.use-case.js';
import {
  listPlacementHistoryHandler,
  readEstablishmentPostureHandler,
  readHierarchyHandler,
  readUnitAncestryHandler,
  resolveGoverningLegalEntityHandler,
} from './structure-queries.js';
import { configureTenantSettingsHandler } from './tenant-settings.use-case.js';
import { exportStructureHandler } from './export.use-case.js';
import { importStructureHandler } from './transfer.use-case.js';
import { defineUnitTypeHandler, retireUnitTypeHandler } from './unit-type.use-case.js';
import {
  changeUnitStatusHandler,
  createUnitHandler,
  renameUnitHandler,
  reviseUnitMetadataHandler,
} from './unit.use-case.js';
import {
  ALL_ORGANIZATION_PERMISSIONS,
  OrganizationPermissions,
} from './organization-permissions.js';
import type { CommandSender } from './transfer.use-case.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The module's declaration: what it offers, in one place, so the registry can derive everything
 * else — permissions, navigation, health.
 *
 * The `sender` parameter is what import needs, and it is a parameter rather than something taken
 * from a container because the dispatcher it will use is built *from this list*. Passing a
 * deferred sender keeps the module a plain declaration instead of a graph with a cycle in it;
 * the composition root closes over the dispatcher it is about to build.
 */
export const organizationModule = (
  dependencies: OrganizationDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'organization',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'organization.structure',
      path: '/organization',
      permission: OrganizationPermissions.hierarchyRead,
      order: 20,
    },
    {
      key: 'organization.positions',
      path: '/organization/positions',
      permission: OrganizationPermissions.positionRead,
      order: 21,
    },
    {
      key: 'organization.calendars',
      path: '/organization/calendars',
      permission: OrganizationPermissions.calendarRead,
      order: 22,
    },
    {
      key: 'organization.settings',
      path: '/organization/settings',
      permission: OrganizationPermissions.tenantSettingsRead,
      order: 23,
    },
  ],

  // The read permissions no handler declares alone, stated so the administration screen offers
  // the whole set rather than the subset that happens to be reachable today.
  permissions: ALL_ORGANIZATION_PERMISSIONS,
});

/**
 * The handlers, hoisted out of the declaration.
 *
 * They are a list, not logic, but a list of twenty-six is still a function that outgrew its
 * budget — and the budget exists so that a module declaration stays readable at a glance.
 */
const commandsOf = (
  dependencies: OrganizationDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineUnitTypeHandler(dependencies),
    retireUnitTypeHandler(dependencies),

    createUnitHandler(dependencies),
    renameUnitHandler(dependencies),
    changeUnitStatusHandler(dependencies),
    reviseUnitMetadataHandler(dependencies),

    placeUnitHandler(dependencies),
    detachUnitHandler(dependencies),

    registerLegalEntityHandler(dependencies),
    amendLegalEntityHandler(dependencies),
    closeLegalEntityHandler(dependencies),

    openCostCenterHandler(dependencies),
    closeCostCenterHandler(dependencies),
    openProfitCenterHandler(dependencies),
    closeProfitCenterHandler(dependencies),

    definePositionHandler(dependencies),
    revisePositionHandler(dependencies),
    retirePositionHandler(dependencies),

    setEstablishmentHandler(dependencies),
    approveEstablishmentHandler(dependencies),

    defineCalendarHandler(dependencies),
    amendCalendarHandler(dependencies),
    recordCalendarDayHandler(dependencies),
    removeCalendarDayHandler(dependencies),

    configureTenantSettingsHandler(dependencies),
    importStructureHandler(dependencies, sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (
  dependencies: OrganizationDependencies,
): readonly QueryHandler<Query, unknown>[] =>
  [
    listUnitTypesHandler(dependencies),
    listUnitsHandler(dependencies),
    listPositionsHandler(dependencies),
    listLegalEntitiesHandler(dependencies),
    readTenantSettingsHandler(dependencies),

    readHierarchyHandler(dependencies),
    readUnitAncestryHandler(dependencies),
    resolveGoverningLegalEntityHandler(dependencies),
    readEstablishmentPostureHandler(dependencies),
    listPlacementHistoryHandler(dependencies),

    exportStructureHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
