import type { EstablishmentState } from '../domain/establishment.js';
import type { FinancialCenterState } from '../domain/financial-center.js';
import type { LegalEntityState } from '../domain/legal-entity.js';
import type { OrganizationCalendarState } from '../domain/organization-calendar.js';
import type { OrganizationUnitState } from '../domain/organization-unit.js';
import type { OrganizationUnitTypeState } from '../domain/organization-unit-type.js';
import type { PositionState } from '../domain/position.js';
import type { UnitPlacementState } from '../domain/unit-placement.js';
import type {
  EstablishmentView,
  FinancialCenterView,
  LegalEntityView,
  OrganizationCalendarView,
  OrganizationUnitTypeView,
  OrganizationUnitView,
  PositionView,
  UnitPlacementView,
} from '../contracts/views.js';

/**
 * Aggregate state to published view, in one place.
 *
 * Written once per aggregate rather than inline at each query, because a mapping repeated across
 * five handlers is a mapping that will differ in one of them — and the difference is a field
 * missing from exactly one endpoint, which nobody notices until a screen renders blank.
 *
 * The optional-field pattern (`...(x === undefined ? {} : { x })`) is what
 * `exactOptionalPropertyTypes` requires: an explicit `undefined` is a different thing from an
 * absent key, and the contracts say absent.
 */

export const unitTypeView = (state: OrganizationUnitTypeState): OrganizationUnitTypeView => ({
  id: state.id,
  code: state.code,
  name: { ...state.name },
  ordinal: state.ordinal,
  allowedParentCodes: state.allowedParentCodes,
  allowedAtRoot: state.allowedAtRoot,
  carriesLegalEntity: state.carriesLegalEntity,
  status: state.status,
  version: state.version,
});

export const unitView = (state: OrganizationUnitState): OrganizationUnitView => ({
  id: state.id,
  unitTypeId: state.unitTypeId,
  code: state.code,
  name: { ...state.name },
  ...(state.description === undefined ? {} : { description: { ...state.description } }),
  status: state.status,
  metadata: state.metadata,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const placementView = (state: UnitPlacementState): UnitPlacementView => ({
  id: state.id,
  unitId: state.unitId,
  ...(state.parentUnitId === undefined ? {} : { parentUnitId: state.parentUnitId }),
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const legalEntityView = (state: LegalEntityState): LegalEntityView => ({
  id: state.id,
  unitId: state.unitId,
  countryCode: state.countryCode,
  registeredName: { ...state.registeredName },
  registrationNumber: state.registrationNumber,
  ...(state.taxIdentifier === undefined ? {} : { taxIdentifier: state.taxIdentifier }),
  currencyCode: state.currencyCode,
  ...(state.incorporatedOn === undefined ? {} : { incorporatedOn: state.incorporatedOn }),
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const centerView = (state: FinancialCenterState): FinancialCenterView => ({
  id: state.id,
  kind: state.kind,
  code: state.code,
  name: { ...state.name },
  ...(state.unitId === undefined ? {} : { unitId: state.unitId }),
  status: state.status,
  metadata: state.metadata,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const positionView = (state: PositionState): PositionView => ({
  id: state.id,
  code: state.code,
  title: { ...state.title },
  ...(state.description === undefined ? {} : { description: { ...state.description } }),
  ...(state.family === undefined ? {} : { family: state.family }),
  ...(state.grade === undefined ? {} : { grade: state.grade }),
  criticality: state.criticality,
  status: state.status,
  metadata: state.metadata,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const establishmentView = (state: EstablishmentState): EstablishmentView => ({
  id: state.id,
  positionId: state.positionId,
  unitId: state.unitId,
  budgetedHeadcount: state.budgetedHeadcount,
  status: state.status,
  ...(state.approvedAt === undefined ? {} : { approvedAt: state.approvedAt }),
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});

export const calendarView = (state: OrganizationCalendarState): OrganizationCalendarView => ({
  id: state.id,
  code: state.code,
  name: { ...state.name },
  ...(state.unitId === undefined ? {} : { unitId: state.unitId }),
  timeZone: state.timeZone,
  workingDays: state.workingDays,
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
  version: state.version,
});
