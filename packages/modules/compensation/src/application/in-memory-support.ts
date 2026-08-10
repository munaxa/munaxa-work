import type { Transaction } from '@work/kernel';

import type { Page } from './compensation-ports.js';

/**
 * The shared machinery every in-memory store here rests on.
 *
 * The stores exist so the domain, authorization and idempotency suites run in milliseconds without
 * a database — and so the **tenant filter is exercised in those tests too** rather than only in the
 * integration suites. Every read filters on `transaction.tenantId`, exactly as the SQL does.
 *
 * They reproduce the **constraints that matter**, including the GiST overlap exclusion and the
 * import idempotency index, and they raise the same SQLSTATE the driver would — because several
 * code paths branch on that error, and a fake that failed differently would leave those branches
 * untested until production found them.
 *
 * They are **not a substitute for the integration suites**. Row-level security, the real exclusion
 * constraint, the check constraints and the indexes belong to the database, and only a real one can
 * prove them.
 */

export const scoped = <TState extends { readonly tenantId: string }>(
  rows: readonly TState[],
  transaction: Transaction,
): readonly TState[] => rows.filter((row) => row.tenantId === transaction.tenantId);

/** The error a PostgreSQL unique violation raises, so both stores fail the same way. */
export class UniqueViolation extends Error {
  public readonly code = '23505';

  public constructor(constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.name = 'UniqueViolation';
  }
}

/** The error the GiST exclusion constraint raises when two periods claim the same component. */
export class ExclusionViolation extends Error {
  public readonly code = '23P01';

  public constructor(constraint: string) {
    super(`conflicting key value violates exclusion constraint "${constraint}"`);
    this.name = 'ExclusionViolation';
  }
}

export const paged = <TState>(
  matched: readonly TState[],
  bounds: { readonly limit: number; readonly offset: number },
): Page<TState> => ({
  items: matched.slice(bounds.offset, bounds.offset + bounds.limit),
  total: matched.length,
});

export const equalWhereGiven = (value: string | undefined, filter: string | undefined): boolean =>
  filter === undefined || value === filter;

export const withinDates = (
  onDate: string,
  from: string | undefined,
  to: string | undefined,
): boolean => (from === undefined || onDate >= from) && (to === undefined || onDate <= to);

export class InMemoryStore<TState extends { id: string; tenantId: string; version: number }> {
  public readonly rows: TState[] = [];

  public byId(transaction: Transaction, id: string): Promise<TState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.id === id));
  }

  public all(transaction: Transaction): Promise<readonly TState[]> {
    return Promise.resolve(this.scoped(transaction));
  }

  public insert(_transaction: Transaction, state: TState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  public update(_transaction: Transaction, state: TState, expected: number): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === state.id);

    if (index === -1) throw new Error(`No such row ${state.id}.`);
    if (this.rows[index]?.version !== expected) {
      throw new Error(`Concurrent modification of ${state.id}.`);
    }
    this.rows.splice(index, 1, { ...state, version: expected + 1 });
    return Promise.resolve();
  }

  protected scoped(transaction: Transaction): readonly TState[] {
    return scoped(this.rows, transaction);
  }
}
