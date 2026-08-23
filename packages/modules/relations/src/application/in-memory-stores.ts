import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { ViolationCategoryState } from '../domain/violation-category.js';
import type { ViolationRecord } from '../domain/violation.js';
import type { Page, Paged, RelationsStores, ViolationCategoryStore } from './relations-ports.js';

/**
 * The stores as maps, for the application suite.
 *
 * A faithful mirror rather than a convenience: the ordering is `(sequence, code)` because that is
 * what the SQL does, and `forEmployment` sorts newest conduct first for the same reason. A fake that
 * ordered differently would let a test pass on behaviour the database does not have.
 *
 * **Two differences from PostgreSQL are real and are stated rather than papered over.** There is no
 * immutability trigger here, so nothing stops a *test* from mutating a violation — the guarantee is
 * the database's, and the integration suite is where it is proved. And there is no unique index, so
 * two concurrent definitions of one code both succeed here; the application suite asserts the
 * *readable refusal* the use case gives, and the integration suite asserts the index that actually
 * settles the race (ADR-0071).
 */

export interface InMemoryRelationsStores extends RelationsStores {
  readonly categoryRows: Map<string, ViolationCategoryState>;
  readonly violationRows: Map<string, ViolationRecord>;
  readonly accessRows: AccessEventState[];
}

export const inMemoryRelationsStores = (): InMemoryRelationsStores => {
  const categoryRows = new Map<string, ViolationCategoryState>();
  const violationRows = new Map<string, ViolationRecord>();
  const accessRows: AccessEventState[] = [];

  return {
    categoryRows,
    violationRows,
    accessRows,
    categories: categoryStore(categoryRows),
    violations: {
      byId: (_transaction: Transaction, id: string) => Promise.resolve(violationRows.get(id)),
      forEmployment: (
        _transaction: Transaction,
        employmentId: string,
        paged: Paged,
      ): Promise<Page<ViolationRecord>> => {
        const matching = [...violationRows.values()]
          .filter((row) => row.employmentId === employmentId)
          .sort(byNewestConductThenId);

        return Promise.resolve({
          items: matching.slice(paged.offset, paged.offset + paged.limit),
          total: matching.length,
        });
      },
      insert: (_transaction: Transaction, state: ViolationRecord) => {
        violationRows.set(state.violationId, state);
        return Promise.resolve();
      },
    },
    access: {
      insert: (_transaction: Transaction, state: AccessEventState) => {
        accessRows.push(state);
        return Promise.resolve();
      },
    },
  };
};

const byNewestConductThenId = (left: ViolationRecord, right: ViolationRecord): number =>
  right.occurredOn.localeCompare(left.occurredOn) ||
  right.violationId.localeCompare(left.violationId);

const categoryStore = (rows: Map<string, ViolationCategoryState>): ViolationCategoryStore => ({
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

  insert: (_transaction: Transaction, state: ViolationCategoryState) => {
    rows.set(state.violationCategoryId, state);
    return Promise.resolve();
  },

  update: (_transaction: Transaction, state: ViolationCategoryState, expected: number) => {
    const held = rows.get(state.violationCategoryId);

    if (held === undefined) throw new Error('relation_violation_category not found');
    if (held.version !== expected) {
      throw new Error(`relation_violation_category version ${String(held.version)}`);
    }
    rows.set(state.violationCategoryId, { ...state, version: held.version + 1 });
    return Promise.resolve();
  },
});
