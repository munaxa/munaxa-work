import { z } from 'zod';

/**
 * Environment variables are strings, and `z.coerce.boolean()` is the wrong tool for them: it
 * applies JavaScript truthiness, so the string "false" becomes `true` and a variable set to
 * disable something switches it on. This accepts the spellings people actually write and
 * rejects everything else rather than guessing.
 */
const booleanFromEnvironment = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .transform((value) => ['true', '1', 'yes', 'on'].includes(value))
    .or(z.boolean())
    .default(defaultValue);

/**
 * The environment schema. This is the only place in Munaxa Work that reads `process.env`
 * (ADR-0018, and enforced by the lint layer). Every other package receives typed configuration
 * by injection, which is also what keeps the application deployment agnostic.
 *
 * A missing or invalid variable fails startup. There is no default that silently masks a
 * misconfigured environment, and no environment-specific branch anywhere in business code.
 */
export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('munaxa-work'),
  APP_VERSION: z.string().min(1).default('0.0.0'),
  BUILD_SHA: z.string().default('unknown'),

  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.string().min(1).default('api'),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().url().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: booleanFromEnvironment(false),

  DEFAULT_LOCALE: z.string().min(2).default('en'),
  DEFAULT_CALENDAR: z.enum(['gregorian', 'hijri']).default('gregorian'),
  DEFAULT_TIME_ZONE: z.string().min(1).default('UTC'),
  DEFAULT_NUMERALS: z.enum(['western', 'arabic-indic']).default('western'),

  /**
   * Workforce Identity defaults. They are configuration rather than constants because a tenant
   * with a slow onboarding process and one that expects same-day acceptance are both ordinary,
   * and hardcoding either would make the other wrong. Per-tenant overrides arrive with
   * Organization in Phase 3; until then these are the deployment's answer for every tenant.
   */
  INVITATION_VALIDITY_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  DEFAULT_PORTALS: z
    .string()
    .default('employee')
    .transform((value) =>
      value
        .split(',')
        .map((portal) => portal.trim())
        .filter((portal) => portal !== ''),
    )
    .pipe(z.array(z.enum(['employee', 'manager', 'admin'])).min(1)),

  OPENAPI_ENABLED: booleanFromEnvironment(true),
});

export type Environment = z.infer<typeof environmentSchema>;

/** Thrown when the environment is invalid. Startup stops here rather than failing later. */
export class ConfigurationError extends Error {
  public constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates a raw environment. Pass `process.env` at the composition root; pass an explicit
 * object in tests. Returns a frozen, typed value.
 */
export const loadEnvironment = (source: Record<string, string | undefined>): Environment => {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigurationError(issues);
  }

  return Object.freeze(result.data);
};

/**
 * Reads and validates the real process environment. This is the only expression in Munaxa Work
 * that touches `process.env`; every composition root calls this instead, so the lint rule that
 * forbids environment access stays absolute rather than carrying an exception.
 */
export const loadProcessEnvironment = (): Environment => loadEnvironment(process.env);
