import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import type {
  LegalEntityView,
  OrganizationUnitTypeView,
  OrganizationUnitView,
  PositionView,
  TenantSettingsView,
} from '../contracts/views.js';

import { legalEntityView, positionView, unitTypeView, unitView } from './organization-views.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The read side.
 *
 * Every one of these reads the transactional tables, which is honest for a module whose largest
 * table is a few thousand rows in the largest customer imaginable — an organization with a
 * hundred thousand units does not exist. Reporting is what needs projections (ADR-0008), and
 * when Phase 20 builds them these queries are what they replace.
 *
 * Structure queries take an `asOf` date and default it to now. That default is the whole
 * difference between a system that shows today's org chart and one that can answer for last
 * March, and making it a parameter rather than an option means every consumer gets the choice.
 */

export interface ListUnitTypes extends Query {
  readonly queryName: 'organization.list-unit-types';
}

export const listUnitTypesHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ListUnitTypes, readonly OrganizationUnitTypeView[]> => ({
  queryName: 'organization.list-unit-types',
  permission: OrganizationPermissions.unitTypeRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const types = await dependencies.stores.unitTypes.list(transaction);
      return success(types.map(unitTypeView));
    }),
});

export interface ListUnits extends Query {
  readonly queryName: 'organization.list-units';
  readonly unitTypeId?: string;
  readonly status?: string;
  readonly term?: string;
  readonly page?: number;
  readonly size?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

export const listUnitsHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ListUnits, PagedResult<OrganizationUnitView>> => ({
  queryName: 'organization.list-units',
  permission: OrganizationPermissions.unitRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = Math.min(query.size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const page = Math.max(query.page ?? 1, 1);
      const { items, total } = await dependencies.stores.units.list(transaction, {
        ...(query.unitTypeId === undefined ? {} : { unitTypeId: query.unitTypeId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.term === undefined ? {} : { term: query.term }),
        limit: size,
        offset: (page - 1) * size,
      });

      return success(pagedResult(items.map(unitView), page, size, total));
    }),
});

export interface DescribeUnit extends Query {
  readonly queryName: 'organization.describe-unit';
  readonly unitId: string;
  readonly asOf?: Date;
}

/** A unit with everything a detail screen needs, resolved as of a date. */
export interface UnitDetail {
  readonly unit: OrganizationUnitView;
  readonly type: OrganizationUnitTypeView | undefined;
  readonly parentUnitId: string | undefined;
  readonly ancestorUnitIds: readonly string[];
  readonly childUnitIds: readonly string[];
  readonly legalEntity: LegalEntityView | undefined;
  /** The nearest legal entity at or above this unit — where its country comes from. */
  readonly governingLegalEntity: LegalEntityView | undefined;
  readonly asOf: Date;
}

export interface ListPositions extends Query {
  readonly queryName: 'organization.list-positions';
  /**
   * One exact position identifier.
   *
   * Added for Phase 15, so a consumer holding an identifier can confirm it exists in its own tenant
   * with **one bounded request**. Career stores `position_id` on a succession plan, a career stage
   * and a mobility recommendation, and had no way to confirm any of them: `status`, `family` and
   * `term` filter on a status, a family and free text over `code` and `title`, never on `id`. The
   * alternative was paging the whole catalogue and filtering in the consumer, which is unbounded
   * work over this module's data and would report a `total` that answered a different question.
   *
   * **This does not make critical-position enumeration possible** (D-4 stays `NOT VERIFIED`). It
   * narrows a result the caller could already obtain with the same `organization.position.read`
   * permission down to the single row they already named; it adds no way to *discover* positions by
   * any property, least of all criticality.
   *
   * Absent, nothing changes: the same filters, the same page, the same `PagedResult<PositionView>`.
   */
  readonly positionId?: string;
  readonly status?: string;
  readonly family?: string;
  readonly term?: string;
  readonly page?: number;
  readonly size?: number;
}

export const listPositionsHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ListPositions, PagedResult<PositionView>> => ({
  queryName: 'organization.list-positions',
  permission: OrganizationPermissions.positionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = Math.min(query.size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const page = Math.max(query.page ?? 1, 1);
      const { items, total } = await dependencies.stores.positions.list(transaction, {
        ...(query.positionId === undefined ? {} : { positionId: query.positionId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.family === undefined ? {} : { family: query.family }),
        ...(query.term === undefined ? {} : { term: query.term }),
        limit: size,
        offset: (page - 1) * size,
      });

      return success(pagedResult(items.map(positionView), page, size, total));
    }),
});

export interface ListLegalEntities extends Query {
  readonly queryName: 'organization.list-legal-entities';
}

export const listLegalEntitiesHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ListLegalEntities, readonly LegalEntityView[]> => ({
  queryName: 'organization.list-legal-entities',
  permission: OrganizationPermissions.legalEntityRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const entities = await dependencies.stores.legalEntities.list(transaction);
      return success(entities.map(legalEntityView));
    }),
});

export interface ReadTenantSettings extends Query {
  readonly queryName: 'organization.tenant-settings';
}

export const readTenantSettingsHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ReadTenantSettings, TenantSettingsView | undefined> => ({
  queryName: 'organization.tenant-settings',
  permission: OrganizationPermissions.tenantSettingsRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tenantSettings.forTenant(
        transaction,
        transaction.tenantId,
      );

      // `undefined` rather than the deployment defaults: this query answers "what has this
      // tenant configured", and answering with somebody else's defaults would make a tenant that
      // has never been configured indistinguishable from one configured identically by hand.
      return success(
        state === undefined
          ? undefined
          : {
              id: state.id,
              language: state.language,
              calendar: state.calendar,
              timeZone: state.timeZone,
              numerals: state.numerals,
              invitationValidityDays: state.invitationValidityDays,
              defaultPortals: state.defaultPortals,
              version: state.version,
            },
      );
    }),
});
