/**
 * Harness concerns of `cross-tenant.postgres.spec.ts`: which database to use, and setting the
 * process environment the real `AppModule` reads, then putting it back exactly.
 *
 * In a `.fixture.ts` for the reason `apps/api/eslint.config.mjs` gives: choosing a database and
 * staging an environment for a booted application are harness work, not business configuration.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

/** Sets `values` on the process environment and returns the function that restores it. */
export const stageEnvironment = (values: Readonly<Record<string, string>>): (() => void) => {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    }
    Object.assign(process.env, saved);
  };
};
