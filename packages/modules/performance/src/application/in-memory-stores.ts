import { configurationStores } from './in-memory-configuration-stores.js';
import { outcomeStores } from './in-memory-outcome-stores.js';
import { reviewStores } from './in-memory-review-stores.js';
import { emptyTables } from './in-memory-tables.js';
import type { PerformanceStores } from './performance-ports.js';

export { ConstraintViolation } from './in-memory-tables.js';

/**
 * In-memory stores, for the suites that test **behaviour** rather than persistence.
 *
 * They implement the same interfaces the PostgreSQL repositories will, so a handler cannot tell
 * them apart. The integration suites in the next checkpoint then prove the same behaviour survives
 * real SQL, real constraints and real row-level security.
 *
 * The three groups share one set of tables deliberately: a review's scope bound reads goals, a
 * snapshot reads reviewers, and reconciliation reads across all of them. Splitting the *state* as
 * well as the code would have meant a fake that could not answer the questions the real database
 * can.
 */
export const inMemoryPerformanceStores = (): PerformanceStores => {
  const tables = emptyTables();

  return {
    ...configurationStores(tables),
    ...reviewStores(tables),
    ...outcomeStores(tables),
  };
};
