import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    /**
     * One test file at a time.
     *
     * Two suites here run against a real PostgreSQL database and reset it between tests, and a
     * reset is not scoped to the file that issued it: `payroll.postgres-api.spec.ts` truncates the
     * payroll tables `payroll.production-scenario.spec.ts` is midway through using. Run in
     * parallel they fail intermittently, and the failure surfaces as an unrelated assertion in
     * whichever suite lost the race — the worst kind of red build to diagnose. This was
     * reproducible here, not theoretical.
     *
     * Scoping each reset to its own tenant does not work: a finalized payroll row cannot be
     * deleted at all (ADR-0066), and `truncate` is the only reset the immutability trigger does
     * not refuse.
     *
     * Tests within a file still run in order, as they always did. This costs wall-clock on a
     * multi-core machine and buys a suite that means what it says.
     */
    fileParallelism: false,
  },
});
