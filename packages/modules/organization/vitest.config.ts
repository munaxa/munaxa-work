import { defineConfig } from 'vitest/config';

/**
 * The integration suites share one database, and each truncates this module's tables between
 * tests so a test never inherits another's rows. Run in parallel, two files doing that would
 * delete each other's fixtures — and the failures would be intermittent, which is the worst kind
 * to inherit.
 *
 * Serializing files is the honest fix. The alternative — a schema or a database per file — buys
 * parallelism this suite does not need at the cost of setup nobody would maintain.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
