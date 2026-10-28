/** Which database the `licensing_state` suite connects to — a harness concern, not configuration. */
export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself in CI reports success for a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};
