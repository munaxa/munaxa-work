import type { Transaction } from '@work/kernel';

/**
 * The shared half of every in-memory store: tenant scoping, insert, and optimistic concurrency.
 *
 * These fakes exist so an authorization test, a pipeline test and a hire-saga test can run in
 * milliseconds without a database — and so the *tenant* filter is exercised in those tests too
 * rather than only in the integration suites. Every read filters on `transaction.tenantId`, exactly
 * as the SQL does, so a use case that forgot to scope something fails here as well as against
 * PostgreSQL.
 *
 * They are not a substitute for the integration suites. Row-level security, the partial unique
 * indexes and the check constraints are the database's, and only a real one can prove them.
 */

export interface Row {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
}

export const scoped = <TState extends { readonly tenantId: string }>(
  rows: readonly TState[],
  transaction: Transaction,
): readonly TState[] => rows.filter((row) => row.tenantId === transaction.tenantId);

export class InMemoryStore<TState extends Row> {
  public readonly rows: TState[] = [];

  public byId(transaction: Transaction, id: string): Promise<TState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.id === id));
  }

  public byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly TState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => ids.includes(row.id)));
  }

  public all(transaction: Transaction): Promise<readonly TState[]> {
    return Promise.resolve(this.scoped(transaction));
  }

  public insert(_transaction: Transaction, state: TState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  /**
   * Optimistic concurrency, in memory: the same refusal the SQL update makes.
   *
   * It replaces the row by splicing rather than assigning through the array index, because the lint
   * layer forbids writing through a parameter — and the rule is right: a helper that mutates its
   * argument in place is the one whose effect a caller does not see.
   */
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

/** A page of already-filtered rows, applied the same way every store applies it. */
export const paged = <TState>(
  matched: readonly TState[],
  bounds: { readonly limit: number; readonly offset: number },
): { readonly items: readonly TState[]; readonly total: number } => ({
  items: matched.slice(bounds.offset, bounds.offset + bounds.limit),
  total: matched.length,
});

export const equalWhereGiven = (value: string | undefined, filter: string | undefined): boolean =>
  filter === undefined || value === filter;
