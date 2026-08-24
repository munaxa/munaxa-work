import type { Transaction } from '@work/kernel';

import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import type { CustodyRecord } from '../domain/custody.js';
import type {
  AssetCategoryStore,
  AssetFilters,
  AssetStore,
  AssetsStores,
  CustodyFilters,
  CustodyStore,
  CustodySummary,
  OutstandingCustodies,
  OutstandingCustody,
  Page,
  Paged,
} from './assets-ports.js';

/**
 * The stores as maps, for the application suite.
 *
 * A faithful mirror rather than a convenience: the catalogue orders by `(sequence, code)` because
 * that is what the SQL does, and the inventory orders by `(assetTag)` for the same reason. A fake
 * that ordered differently would let a test pass on behaviour the database does not have.
 *
 * **Three differences from PostgreSQL are real and are stated rather than papered over.** There is no
 * unique index here, so two concurrent registrations of one tag — or two issues of one asset — both
 * succeed; the application suite asserts the *readable refusal* the use case gives, and the
 * integration suite asserts the index that actually settles the race (ADR-0071). There is no
 * immutability trigger, so nothing stops a *test* from mutating a returned custody; the guarantee is
 * the database's and the integration suite proves it. And `byIdForUpdate` takes no lock, because there
 * is nothing here to lock — the retirement invariant's race is proved against real connections.
 */

export interface InMemoryAssetsStores extends AssetsStores {
  readonly categoryRows: Map<string, AssetCategoryState>;
  readonly assetRows: Map<string, AssetState>;
  readonly custodyRows: Map<string, CustodyRecord>;
}

export const inMemoryAssetsStores = (): InMemoryAssetsStores => {
  const categoryRows = new Map<string, AssetCategoryState>();
  const assetRows = new Map<string, AssetState>();
  const custodyRows = new Map<string, CustodyRecord>();

  return {
    categoryRows,
    assetRows,
    custodyRows,
    categories: categoryStore(categoryRows),
    assets: assetStore(assetRows),
    custodies: custodyStore(custodyRows, assetRows),
  };
};

const categoryStore = (rows: Map<string, AssetCategoryState>): AssetCategoryStore => ({
  byId: (_transaction: Transaction, id: string) => Promise.resolve(rows.get(id)),

  byCode: (_transaction: Transaction, code: string) =>
    Promise.resolve([...rows.values()].find((row) => row.code === code)),

  all: (_transaction: Transaction, includeInactive: boolean) =>
    Promise.resolve(
      [...rows.values()]
        .filter((row) => includeInactive || row.active)
        .sort(
          (left, right) => left.sequence - right.sequence || left.code.localeCompare(right.code),
        ),
    ),

  insert: (_transaction: Transaction, state: AssetCategoryState) => {
    rows.set(state.assetCategoryId, state);
    return Promise.resolve();
  },

  update: (_transaction: Transaction, state: AssetCategoryState, expected: number) => {
    const held = rows.get(state.assetCategoryId);

    if (held !== undefined && held.version !== expected) {
      // The same shape the repository's `updateRow` produces, so a suite proving the lost-update
      // guard meets the same failure here as it does against PostgreSQL.
      return Promise.reject(new Error('asset_category was modified by someone else'));
    }
    rows.set(state.assetCategoryId, { ...state, version: state.version + 1 });
    return Promise.resolve();
  },
});

const assetStore = (rows: Map<string, AssetState>): AssetStore => ({
  byId: (_transaction: Transaction, id: string) => Promise.resolve(rows.get(id)),

  // The same answer without a lock: there is nothing to lock in a map, and the invariant this exists
  // for is proved against real PostgreSQL rather than here.
  byIdForUpdate: (_transaction: Transaction, id: string) => Promise.resolve(rows.get(id)),

  byTag: (_transaction: Transaction, assetTag: string) =>
    Promise.resolve([...rows.values()].find((row) => row.assetTag === assetTag)),

  bySerialNumber: (_transaction: Transaction, serialNumber: string) =>
    Promise.resolve([...rows.values()].find((row) => row.serialNumber === serialNumber)),

  search: (_transaction: Transaction, filters: AssetFilters, paged: Paged) =>
    Promise.resolve(pageOf(matching(rows, filters), paged)),

  insert: (_transaction: Transaction, state: AssetState) => {
    rows.set(state.assetId, state);
    return Promise.resolve();
  },

  update: (_transaction: Transaction, state: AssetState, expected: number) => {
    const held = rows.get(state.assetId);

    if (held !== undefined && held.version !== expected) {
      return Promise.reject(new Error('asset was modified by someone else'));
    }
    rows.set(state.assetId, { ...state, version: state.version + 1 });
    return Promise.resolve();
  },
});

const matching = (rows: Map<string, AssetState>, filters: AssetFilters): readonly AssetState[] =>
  [...rows.values()]
    .filter(
      (row) =>
        (filters.assetCategoryId === undefined ||
          row.assetCategoryId === filters.assetCategoryId) &&
        (filters.status === undefined || row.status === filters.status),
    )
    .sort((left, right) => left.assetTag.localeCompare(right.assetTag));

const pageOf = (items: readonly AssetState[], paged: Paged): Page<AssetState> => ({
  items: items.slice(paged.offset, paged.offset + paged.limit),
  total: items.length,
});

/**
 * The clearance read, with the same two-statement shape the SQL has: an authoritative count over
 * custody alone, and a bounded list joined to the asset. A fake that derived both from the join would
 * hide exactly the failure the real one is arranged to survive.
 *
 * A module-level helper rather than an inline body, matching `matching` and `pageOf` above — the store
 * literal is a list of the port's methods, and a method that grew a paragraph of logic inside it is
 * how that list stops being readable.
 */
const outstandingFor = (
  rows: Map<string, CustodyRecord>,
  assetRows: Map<string, AssetState>,
  employmentId: string,
  limit: number,
): OutstandingCustodies => {
  const open = [...rows.values()]
    .filter((row) => row.employmentId === employmentId && row.state === 'open')
    .sort((left, right) =>
      left.issuedOn === right.issuedOn
        ? left.assetCustodyId.localeCompare(right.assetCustodyId)
        : left.issuedOn.localeCompare(right.issuedOn),
    );

  return {
    total: open.length,
    items: open.slice(0, limit).flatMap((row) => joined(row, assetRows)),
  };
};

/**
 * One row through the join.
 *
 * Its absence behaves as the SQL's does: the row drops out of the list while `total` still counts it,
 * so the caller stays blocked rather than being told it is clear.
 */
const joined = (
  row: CustodyRecord,
  assetRows: Map<string, AssetState>,
): readonly OutstandingCustody[] => {
  const asset = assetRows.get(row.assetId);

  return asset === undefined
    ? []
    : [
        {
          assetCustodyId: row.assetCustodyId,
          assetId: row.assetId,
          assetTag: asset.assetTag,
          assetCategoryId: asset.assetCategoryId,
          issuedOn: row.issuedOn,
        },
      ];
};

/** The same aggregate the SQL computes: a count and the earliest issue date, and no identifier. */
const summaryOf = (rows: Map<string, CustodyRecord>): CustodySummary => {
  const open = [...rows.values()].filter((row) => row.state === 'open');
  const oldest = open.reduce<string | undefined>(
    (earliest, row) =>
      earliest === undefined || row.issuedOn < earliest ? row.issuedOn : earliest,
    undefined,
  );

  return {
    openCount: open.length,
    ...(oldest === undefined ? {} : { oldestIssuedOn: oldest }),
  };
};

/**
 * Custody, as a map.
 *
 * The two paged reads order newest-issued first, then by identifier, because that is what the SQL
 * does — a fake that ordered differently would let a test pass on behaviour the database does not
 * have. The clearance read orders oldest first, for the same reason its SQL does.
 */
const custodyStore = (
  rows: Map<string, CustodyRecord>,
  assetRows: Map<string, AssetState>,
): CustodyStore => ({
  byId: (_transaction: Transaction, id: string) => Promise.resolve(rows.get(id)),

  openFor: (_transaction: Transaction, assetId: string) =>
    Promise.resolve(
      [...rows.values()].find((row) => row.assetId === assetId && row.state === 'open'),
    ),

  forAsset: (_transaction: Transaction, assetId: string, paged: Paged) =>
    Promise.resolve(
      pageOfCustodies(
        byIssuedDate(rows, (row) => row.assetId === assetId),
        paged,
      ),
    ),

  outstandingForEmployment: (_transaction: Transaction, employmentId: string, limit: number) =>
    Promise.resolve(outstandingFor(rows, assetRows, employmentId, limit)),

  openSummary: (_transaction: Transaction) => Promise.resolve(summaryOf(rows)),

  forEmployment: (
    _transaction: Transaction,
    employmentId: string,
    filters: CustodyFilters,
    paged: Paged,
  ) =>
    Promise.resolve(
      pageOfCustodies(
        byIssuedDate(
          rows,
          (row) =>
            row.employmentId === employmentId &&
            (filters.openOnly !== true || row.state === 'open'),
        ),
        paged,
      ),
    ),

  insert: (_transaction: Transaction, state: CustodyRecord) => {
    rows.set(state.assetCustodyId, state);
    return Promise.resolve();
  },

  update: (_transaction: Transaction, state: CustodyRecord, expected: number) => {
    const held = rows.get(state.assetCustodyId);

    if (held !== undefined && held.version !== expected) {
      return Promise.reject(new Error('asset_custody was modified by someone else'));
    }
    rows.set(state.assetCustodyId, { ...state, version: state.version + 1 });
    return Promise.resolve();
  },
});

const byIssuedDate = (
  rows: Map<string, CustodyRecord>,
  matches: (row: CustodyRecord) => boolean,
): readonly CustodyRecord[] =>
  [...rows.values()]
    .filter(matches)
    .sort(
      (left, right) =>
        right.issuedOn.localeCompare(left.issuedOn) ||
        left.assetCustodyId.localeCompare(right.assetCustodyId),
    );

const pageOfCustodies = (items: readonly CustodyRecord[], paged: Paged): Page<CustodyRecord> => ({
  items: items.slice(paged.offset, paged.offset + paged.limit),
  total: items.length,
});
