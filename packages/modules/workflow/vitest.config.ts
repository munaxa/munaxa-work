import { defineConfig } from 'vitest/config';

/**
 * Serialized files, for the reason every module before this serializes them: the integration suites
 * share one database and truncate this module's tables between tests, so two files running at once
 * would delete each other's fixtures.
 *
 * Set from this checkpoint even though only domain tests exist yet — the domain suites are pure and
 * would run happily in parallel, and turning parallelism off later is the change nobody remembers to
 * make.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
