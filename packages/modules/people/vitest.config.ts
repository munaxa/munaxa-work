import { defineConfig } from 'vitest/config';

/**
 * The integration suites share one database and truncate this module's tables between tests, so
 * two files running at once would delete each other's fixtures. Serializing files is the honest
 * fix — the same convention Workforce Identity and Organization established.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
