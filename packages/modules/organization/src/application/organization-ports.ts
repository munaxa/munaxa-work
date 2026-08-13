import type { Transaction } from '@work/kernel';

import type { EstablishmentState } from '../domain/establishment.js';
import type { FinancialCenterState, CenterKind } from '../domain/financial-center.js';
import type { LegalEntityState } from '../domain/legal-entity.js';
import type { CalendarDay, OrganizationCalendarState } from '../domain/organization-calendar.js';
import type { OrganizationUnitState } from '../domain/organization-unit.js';
import type { OrganizationUnitTypeState } from '../domain/organization-unit-type.js';
import type { PositionState } from '../domain/position.js';
import type { TenantSettingsState } from '../domain/tenant-settings.js';
import type { UnitPlacementState } from '../domain/unit-placement.js';

/**
 * What the application layer needs from persistence, stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with
 * no database present. Declaring these in infrastructure would invert that and make a state
 * machine test need PostgreSQL.
 *
 * Every method takes the `Transaction`, so a use case cannot accidentally read outside the unit
 * of work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface UnitTypeStore {
  byId(transaction: Transaction, id: string): Promise<OrganizationUnitTypeState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<OrganizationUnitTypeState | undefined>;
  list(transaction: Transaction): Promise<readonly OrganizationUnitTypeState[]>;
  insert(transaction: Transaction, state: OrganizationUnitTypeState): Promise<void>;
  update(
    transaction: Transaction,
    state: OrganizationUnitTypeState,
    expected: number,
  ): Promise<void>;
}

export interface UnitQuery extends Paged {
  readonly unitTypeId?: string;
  readonly status?: string;
  /** Free text, matched against the code and against the name in *either* language. */
  readonly term?: string;
}

export interface UnitStore {
  byId(transaction: Transaction, id: string): Promise<OrganizationUnitState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<OrganizationUnitState | undefined>;
  byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly OrganizationUnitState[]>;
  list(
    transaction: Transaction,
    query: UnitQuery,
  ): Promise<{ readonly items: readonly OrganizationUnitState[]; readonly total: number }>;
  /** Every unit in the tenant, for export and for whole-structure assembly. */
  all(transaction: Transaction): Promise<readonly OrganizationUnitState[]>;
  insert(transaction: Transaction, state: OrganizationUnitState): Promise<void>;
  update(transaction: Transaction, state: OrganizationUnitState, expected: number): Promise<void>;
}

export interface PlacementStore {
  byId(transaction: Transaction, id: string): Promise<UnitPlacementState | undefined>;
  /** Every period for one unit, which is what the timeline is built from. */
  forUnit(transaction: Transaction, unitId: string): Promise<readonly UnitPlacementState[]>;
  /** Every placement in force on a date. One row per placed unit, by the timeline invariant. */
  inForceAt(transaction: Transaction, instant: Date): Promise<readonly UnitPlacementState[]>;
  /** Every period for every unit, for export and for history views. */
  all(transaction: Transaction): Promise<readonly UnitPlacementState[]>;
  insert(transaction: Transaction, state: UnitPlacementState): Promise<void>;
  update(transaction: Transaction, state: UnitPlacementState, expected: number): Promise<void>;
}

export interface LegalEntityStore {
  byId(transaction: Transaction, id: string): Promise<LegalEntityState | undefined>;
  forUnit(transaction: Transaction, unitId: string): Promise<LegalEntityState | undefined>;
  forUnits(
    transaction: Transaction,
    unitIds: readonly string[],
  ): Promise<readonly LegalEntityState[]>;
  list(transaction: Transaction): Promise<readonly LegalEntityState[]>;
  insert(transaction: Transaction, state: LegalEntityState): Promise<void>;
  update(transaction: Transaction, state: LegalEntityState, expected: number): Promise<void>;
}

export interface CenterQuery extends Paged {
  readonly kind: CenterKind;
  readonly status?: string;
}

export interface FinancialCenterStore {
  byId(transaction: Transaction, id: string): Promise<FinancialCenterState | undefined>;
  byCode(
    transaction: Transaction,
    kind: CenterKind,
    code: string,
  ): Promise<FinancialCenterState | undefined>;
  list(
    transaction: Transaction,
    query: CenterQuery,
  ): Promise<{ readonly items: readonly FinancialCenterState[]; readonly total: number }>;
  insert(transaction: Transaction, state: FinancialCenterState): Promise<void>;
  update(transaction: Transaction, state: FinancialCenterState, expected: number): Promise<void>;
}

export interface PositionQuery extends Paged {
  /** One exact identifier. An equality predicate, never a pattern — see `ListPositions`. */
  readonly positionId?: string;
  readonly status?: string;
  readonly family?: string;
  readonly term?: string;
}

export interface PositionStore {
  byId(transaction: Transaction, id: string): Promise<PositionState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<PositionState | undefined>;
  list(
    transaction: Transaction,
    query: PositionQuery,
  ): Promise<{ readonly items: readonly PositionState[]; readonly total: number }>;
  all(transaction: Transaction): Promise<readonly PositionState[]>;
  insert(transaction: Transaction, state: PositionState): Promise<void>;
  update(transaction: Transaction, state: PositionState, expected: number): Promise<void>;
}

export interface EstablishmentStore {
  byId(transaction: Transaction, id: string): Promise<EstablishmentState | undefined>;
  /** Every period for one position in one unit — the timeline this aggregate is dated on. */
  forPositionInUnit(
    transaction: Transaction,
    positionId: string,
    unitId: string,
  ): Promise<readonly EstablishmentState[]>;
  forUnit(transaction: Transaction, unitId: string): Promise<readonly EstablishmentState[]>;
  all(transaction: Transaction): Promise<readonly EstablishmentState[]>;
  insert(transaction: Transaction, state: EstablishmentState): Promise<void>;
  update(transaction: Transaction, state: EstablishmentState, expected: number): Promise<void>;
}

export interface StoredCalendarDay extends CalendarDay {
  readonly id: string;
  readonly tenantId: string;
  readonly calendarId: string;
  readonly version: number;
}

export interface CalendarStore {
  byId(transaction: Transaction, id: string): Promise<OrganizationCalendarState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<OrganizationCalendarState | undefined>;
  list(transaction: Transaction): Promise<readonly OrganizationCalendarState[]>;
  insert(transaction: Transaction, state: OrganizationCalendarState): Promise<void>;
  update(
    transaction: Transaction,
    state: OrganizationCalendarState,
    expected: number,
  ): Promise<void>;

  /** Days between two civil dates inclusive, as `YYYY-MM-DD`. */
  daysBetween(
    transaction: Transaction,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<readonly StoredCalendarDay[]>;
  dayOn(
    transaction: Transaction,
    calendarId: string,
    onDate: string,
  ): Promise<StoredCalendarDay | undefined>;
  /** Recording a day that already exists replaces it: a holiday is a fact about a date. */
  upsertDay(transaction: Transaction, day: StoredCalendarDay): Promise<void>;
  removeDay(transaction: Transaction, calendarId: string, onDate: string): Promise<void>;
}

export interface TenantSettingsStore {
  forTenant(transaction: Transaction, tenantId: string): Promise<TenantSettingsState | undefined>;
  insert(transaction: Transaction, state: TenantSettingsState): Promise<void>;
  update(transaction: Transaction, state: TenantSettingsState, expected: number): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface OrganizationStores {
  readonly unitTypes: UnitTypeStore;
  readonly units: UnitStore;
  readonly placements: PlacementStore;
  readonly legalEntities: LegalEntityStore;
  readonly centers: FinancialCenterStore;
  readonly positions: PositionStore;
  readonly establishments: EstablishmentStore;
  readonly calendars: CalendarStore;
  readonly tenantSettings: TenantSettingsStore;
}

/**
 * How many assignments Employment has made against a position in a unit.
 *
 * A port rather than a query, because Organization must not count employees (AD-002). The
 * adapter this module ships answers zero for everything, honestly and by construction: there are
 * no assignments until Phase 5 creates them, and an adapter that guessed would be a headcount
 * Organization invented.
 */
export interface FilledHeadcountPort {
  filledFor(positionId: string, unitId: string, asOf: Date): Promise<number>;
}

/** The clock, injected so effective dates and audit instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
