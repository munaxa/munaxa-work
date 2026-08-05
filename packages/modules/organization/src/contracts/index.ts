/**
 * The public contract of Organization.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private, because the moment a second module
 * reads `organization_unit_placement` directly the boundary stops being a boundary.
 *
 * Two entries here carry more weight than the rest and are worth naming:
 *
 * `GoverningLegalEntity` is what Phase 11.1 resolves a country pack from. 00B is explicit that an
 * employment takes its country from its legal entity and never from the tenant, and this is the
 * shape that makes that possible for a tenant operating in several countries at once.
 *
 * `OrganizationTree` carries no depth field, deliberately. Publishing one would invite a consumer
 * to rely on a maximum that AD-003 says does not exist.
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export type {
  CalendarDayKind,
  IsoWeekday,
  OrganizationStatus,
  PositionCriticality,
  EstablishmentStatus,
} from '../domain/organization-vocabulary.js';
export type { CenterKind } from '../domain/financial-center.js';

export type {
  CalendarDayView,
  EstablishmentPostureView,
  EstablishmentView,
  FinancialCenterView,
  GoverningLegalEntity,
  LegalEntityView,
  OrganizationCalendarView,
  OrganizationSnapshot,
  OrganizationTree,
  OrganizationTreeNode,
  OrganizationUnitTypeView,
  OrganizationUnitView,
  PositionView,
  TenantSettingsView,
  UnitPlacementView,
} from './views.js';

export { STANDARD_UNIT_TYPES } from './standard-unit-types.js';
export type { StandardUnitType } from './standard-unit-types.js';
