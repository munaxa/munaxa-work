import { ConcurrencyException, currentTenantId, type Transaction } from '@work/kernel';

import type { EstablishmentState } from '../domain/establishment.js';
import type { FinancialCenterState } from '../domain/financial-center.js';
import type { LegalEntityState } from '../domain/legal-entity.js';
import type { OrganizationCalendarState } from '../domain/organization-calendar.js';
import type { OrganizationUnitState } from '../domain/organization-unit.js';
import type { OrganizationUnitTypeState } from '../domain/organization-unit-type.js';
import type { PositionState } from '../domain/position.js';
import type { TenantSettingsState } from '../domain/tenant-settings.js';
import type { UnitPlacementState } from '../domain/unit-placement.js';

import type { OrganizationStores, StoredCalendarDay } from './organization-ports.js';

/**
 * In-memory stores for the application-service tests.
 *
 * They keep the two guarantees the real repositories make and a naive fake would drop, because a
 * fake more permissive than production is worse than no fake — every test passes and the
 * difference shows up in production:
 *
 * - **Tenant scoping.** Every read filters by the tenant in context, exactly as both the query
 *   predicate and the row-level security policy do.
 * - **Optimistic concurrency.** A write asserting a stale version throws, and a row is stored at
 *   version 1 exactly as `auditForInsert` writes it — a fake that stored 0 would make every
 *   first update in every test pass a version production would reject.
 *
 * They live in `src` rather than a test folder so the module's own tests and the API's can share
 * them, and so they are typechecked by the same configuration as the code they stand in for.
 */

interface Stored {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
}

class Table<TState extends Stored> {
  private readonly rows = new Map<string, TState>();

  public constructor(private readonly name: string) {}

  public all(): readonly TState[] {
    const tenantId = currentTenantId();
    return [...this.rows.values()].filter((row) => row.tenantId === tenantId);
  }

  public byId(id: string): TState | undefined {
    return this.all().find((row) => row.id === id);
  }

  public insert(state: TState): void {
    this.rows.set(state.id, { ...state, version: 1 });
  }

  public update(state: TState, expected: number): void {
    const existing = this.rows.get(state.id);

    if (existing === undefined || existing.version !== expected) {
      throw new ConcurrencyException(this.name, expected, existing?.version ?? -1);
    }
    this.rows.set(state.id, { ...state, version: expected + 1 });
  }

  public remove(id: string): void {
    this.rows.delete(id);
  }
}

const page = <TState>(
  items: readonly TState[],
  limit: number,
  offset: number,
): { readonly items: readonly TState[]; readonly total: number } => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
});

const matchesStatus = <TState extends { status: string }>(
  items: readonly TState[],
  status: string | undefined,
): readonly TState[] => (status === undefined ? items : items.filter((i) => i.status === status));

/**
 * Free-text match against the code and the name in *either* language — the same predicate the
 * repository expresses in SQL. A fake that searched English only would let a search that is
 * broken for Arabic users pass every test in the suite.
 */
const matchesTerm = (
  code: string,
  names: readonly { readonly en: string; readonly ar: string }[],
  term: string | undefined,
): boolean => {
  if (term === undefined || term.trim() === '') return true;
  const needle = term.trim().toLowerCase();

  if (code.toLowerCase().includes(needle)) return true;
  return names.some((name) =>
    Object.values(name).some((text) => text.toLowerCase().includes(needle)),
  );
};

/**
 * A full set of stores. Each call is an isolated database, so no test inherits another's rows.
 *
 * One factory per store rather than one large object literal: the whole point of these is to
 * behave like the repositories they stand in for, and a reader checking that has to be able to
 * see one of them at a time.
 */
export const inMemoryOrganizationStores = (): OrganizationStores => ({
  unitTypes: unitTypeStore(new Table('organization_unit_type')),
  units: unitStore(new Table('organization_unit')),
  placements: placementStore(new Table('organization_unit_placement')),
  legalEntities: legalEntityStore(new Table('legal_entity')),
  centers: centerStore(new Table('financial_center')),
  positions: positionStore(new Table('job_position')),
  establishments: establishmentStore(new Table('position_establishment')),
  calendars: calendarStore(new Table('organization_calendar'), new Map()),
  tenantSettings: tenantSettingsStore(new Table('tenant_settings')),
});

const unitTypeStore = (
  rows: Table<OrganizationUnitTypeState>,
): OrganizationStores['unitTypes'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  byCode: (_: Transaction, code) => Promise.resolve(rows.all().find((row) => row.code === code)),
  list: (_: Transaction) =>
    Promise.resolve([...rows.all()].sort((left, right) => left.ordinal - right.ordinal)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const unitStore = (rows: Table<OrganizationUnitState>): OrganizationStores['units'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  byCode: (_: Transaction, code) => Promise.resolve(rows.all().find((row) => row.code === code)),
  byIds: (_: Transaction, ids) => Promise.resolve(rows.all().filter((row) => ids.includes(row.id))),
  list: (_: Transaction, query) =>
    Promise.resolve(
      page(
        matchesStatus(rows.all(), query.status)
          .filter((row) => query.unitTypeId === undefined || row.unitTypeId === query.unitTypeId)
          .filter((row) =>
            matchesTerm(
              row.code,
              row.description === undefined ? [row.name] : [row.name, row.description],
              query.term,
            ),
          ),
        query.limit,
        query.offset,
      ),
    ),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const placementStore = (rows: Table<UnitPlacementState>): OrganizationStores['placements'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forUnit: (_: Transaction, unitId) =>
    Promise.resolve(rows.all().filter((row) => row.unitId === unitId)),
  inForceAt: (_: Transaction, instant) =>
    Promise.resolve(
      rows
        .all()
        .filter(
          (row) =>
            row.effectiveFrom.getTime() <= instant.getTime() &&
            (row.effectiveTo === undefined || row.effectiveTo.getTime() > instant.getTime()),
        ),
    ),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const legalEntityStore = (rows: Table<LegalEntityState>): OrganizationStores['legalEntities'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forUnit: (_: Transaction, unitId) =>
    Promise.resolve(rows.all().find((row) => row.unitId === unitId)),
  forUnits: (_: Transaction, unitIds) =>
    Promise.resolve(rows.all().filter((row) => unitIds.includes(row.unitId))),
  list: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const centerStore = (rows: Table<FinancialCenterState>): OrganizationStores['centers'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  byCode: (_: Transaction, kind, code) =>
    Promise.resolve(rows.all().find((row) => row.kind === kind && row.code === code)),
  list: (_: Transaction, query) =>
    Promise.resolve(
      page(
        matchesStatus(
          rows.all().filter((row) => row.kind === query.kind),
          query.status,
        ),
        query.limit,
        query.offset,
      ),
    ),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const positionStore = (rows: Table<PositionState>): OrganizationStores['positions'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  byCode: (_: Transaction, code) => Promise.resolve(rows.all().find((row) => row.code === code)),
  list: (_: Transaction, query) =>
    Promise.resolve(
      page(
        matchesStatus(rows.all(), query.status)
          .filter((row) => query.family === undefined || row.family === query.family)
          .filter((row) => matchesTerm(row.code, [row.title], query.term)),
        query.limit,
        query.offset,
      ),
    ),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const establishmentStore = (
  rows: Table<EstablishmentState>,
): OrganizationStores['establishments'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forPositionInUnit: (_: Transaction, positionId, unitId) =>
    Promise.resolve(
      rows.all().filter((row) => row.positionId === positionId && row.unitId === unitId),
    ),
  forUnit: (_: Transaction, unitId) =>
    Promise.resolve(rows.all().filter((row) => row.unitId === unitId)),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const tenantSettingsStore = (
  rows: Table<TenantSettingsState>,
): OrganizationStores['tenantSettings'] => ({
  // Keyed on the tenant argument rather than the ambient one, because that is what the
  // adapter Identity reads through does — it is asked about a tenant, not about "the"
  // tenant, and a fake that ignored the argument would hide exactly the bug that matters.
  forTenant: (_: Transaction, tenantId) =>
    Promise.resolve(rows.all().find((row) => row.tenantId === tenantId)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const calendarStore = (
  rows: Table<OrganizationCalendarState>,
  days: Map<string, StoredCalendarDay>,
): OrganizationStores['calendars'] => {
  const dayKey = (calendarId: string, onDate: string): string => `${calendarId}|${onDate}`;

  return {
    byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
    byCode: (_: Transaction, code) => Promise.resolve(rows.all().find((row) => row.code === code)),
    list: (_: Transaction) => Promise.resolve(rows.all()),
    insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
    update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),

    daysBetween: (_: Transaction, calendarId, from, to) =>
      Promise.resolve(
        [...days.values()]
          .filter(
            (day) =>
              day.calendarId === calendarId &&
              day.tenantId === currentTenantId() &&
              day.onDate >= from &&
              day.onDate <= to,
          )
          .sort((left, right) => left.onDate.localeCompare(right.onDate)),
      ),
    dayOn: (_: Transaction, calendarId, onDate) => {
      const day = days.get(dayKey(calendarId, onDate));
      return Promise.resolve(day?.tenantId === currentTenantId() ? day : undefined);
    },
    upsertDay: (_: Transaction, day) => {
      days.set(dayKey(day.calendarId, day.onDate), { ...day, version: day.version + 1 });
      return Promise.resolve();
    },
    removeDay: (_: Transaction, calendarId, onDate) => {
      days.delete(dayKey(calendarId, onDate));
      return Promise.resolve();
    },
  };
};
