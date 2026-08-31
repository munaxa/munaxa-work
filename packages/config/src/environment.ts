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

/** One verification key: the `kid` a token header names, and the PEM to verify it with. */
const publicKeySchema = z.object({
  kid: z.string().min(1),
  publicKey: z.string().includes('-----BEGIN'),
});

/**
 * Parses `AUTH_PUBLIC_KEYS`, turning a malformed value into a schema issue rather than a throw.
 *
 * Returning the string unchanged on failure is deliberate: the array schema downstream rejects
 * it, and the caller gets "AUTH_PUBLIC_KEYS: expected array" beside every other configuration
 * issue instead of a stack trace from `JSON.parse` that stops at the first one.
 */
function parsePublicKeys(value: string | undefined): unknown {
  if (value === undefined) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

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
   * and hardcoding either would make the other wrong.
   *
   * As of Phase 3 these are the *fallback* rather than the answer: a tenant that has configured
   * itself resolves its own settings from `tenant_settings`, and these apply only to a tenant
   * that has not (ADR-0036). Keeping them means a tenant created five minutes ago still works.
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

  /**
   * The key People's duplicate detection derives its match digests with (Phase 4).
   *
   * A national identifier is compared through a keyed digest rather than in plaintext, so the
   * query that answers "who else holds this number" never reads anybody's number, and the index
   * that makes it fast holds nothing worth stealing. An unkeyed hash would not do: national
   * identifier spaces are small enough to enumerate, so a plain SHA-256 of one is recoverable by
   * anybody who obtains the column.
   *
   * The development default exists so a checkout runs; `refineEnvironment` below refuses it in
   * production, because a shipped default key is the same key in every deployment.
   */
  PII_MATCH_SECRET: z.string().min(32).default('development-only-people-match-secret-change-me'),

  OPENAPI_ENABLED: booleanFromEnvironment(true),

  /**
   * The external Munaxa issuer this deployment is a relying party of.
   *
   * Munaxa Work verifies tokens; it does not mint them and holds no signing key. These four
   * variables are the whole of what a relying party needs, and every one of them is supplied by
   * the deployment — nothing here has a value that would let a checkout authenticate anybody.
   *
   * Leaving them unset is a valid configuration outside production, and it is the fail-closed
   * one: no adapter is constructed, `UnauthenticatedPort` stays in place, and every business
   * request answers 401. A deployment that forgets is noticed on its first request rather than
   * by an auditor.
   */
  AUTH_ISSUER: z.string().min(1).optional(),
  /** The audience the issuer stamps for Work. A token minted for another product is refused. */
  AUTH_AUDIENCE: z.string().min(1).optional(),
  AUTH_SIGNING_ALGORITHM: z.enum(['RS256', 'ES256']).default('RS256'),
  /**
   * The issuer's *public* verification keys, as JSON: `[{"kid":"…","publicKey":"-----BEGIN…"}]`.
   *
   * Public keys are not secrets, which is why they travel as ordinary configuration. More than
   * one is not an edge case but the rotation mechanism: during an overlap the issuer signs with
   * the new key while tokens carrying the old `kid` are still in flight, so a verifier that held
   * one key would reject every token minted before the switch.
   *
   * A private key in this variable would be refused by `createPublicKey`, and there is nowhere
   * else in this repository to put one.
   */
  AUTH_PUBLIC_KEYS: z
    .string()
    .optional()
    .transform(parsePublicKeys)
    .pipe(z.array(publicKeySchema).min(1).optional()),
  /** Tolerance for clock drift between the issuer and this deployment. */
  AUTH_CLOCK_SKEW_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
});

const DEVELOPMENT_MATCH_SECRET = 'development-only-people-match-secret-change-me';

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

  const issues = refineEnvironment(result.data);

  if (issues.length > 0) throw new ConfigurationError(issues);

  return Object.freeze(result.data);
};

/**
 * The rules a single variable's schema cannot express, because they depend on another variable.
 *
 * Checked here rather than at the point of use, so a deployment that would be insecure fails at
 * startup instead of behaving correctly until the day somebody looks.
 */
const refineEnvironment = (environment: Environment): readonly string[] => [
  ...(environment.NODE_ENV === 'production' &&
  environment.PII_MATCH_SECRET === DEVELOPMENT_MATCH_SECRET
    ? [
        'PII_MATCH_SECRET: the development default must not be used in production. It is the key People derives duplicate-match digests with, and a shipped default is the same key in every deployment.',
      ]
    : []),
  ...authenticationIssues(environment),
];

/**
 * Authentication is configured completely or not at all, and in production it is configured.
 *
 * A half-configured relying party is the dangerous state: an issuer with no keys verifies
 * nothing, keys with no audience accept a token minted for another product. Both are refused
 * here, at startup, rather than at the first request that depends on them.
 */
const authenticationIssues = (environment: Environment): readonly string[] => {
  const supplied = [
    environment.AUTH_ISSUER === undefined ? undefined : 'AUTH_ISSUER',
    environment.AUTH_AUDIENCE === undefined ? undefined : 'AUTH_AUDIENCE',
    environment.AUTH_PUBLIC_KEYS === undefined ? undefined : 'AUTH_PUBLIC_KEYS',
  ].filter((name) => name !== undefined);

  if (supplied.length === 3) return [];

  if (environment.NODE_ENV === 'production') {
    return [
      'AUTH_ISSUER, AUTH_AUDIENCE and AUTH_PUBLIC_KEYS: a production deployment is a relying party of the Munaxa issuer and must be configured with all three. Without them this deployment authenticates nobody.',
    ];
  }
  return supplied.length === 0
    ? []
    : [
        `AUTH_ISSUER, AUTH_AUDIENCE and AUTH_PUBLIC_KEYS: configure all three or none. Supplied: ${supplied.join(', ')}.`,
      ];
};

/**
 * Reads and validates the real process environment. This is the only expression in Munaxa Work
 * that touches `process.env`; every composition root calls this instead, so the lint rule that
 * forbids environment access stays absolute rather than carrying an exception.
 */
export const loadProcessEnvironment = (): Environment => loadEnvironment(process.env);
