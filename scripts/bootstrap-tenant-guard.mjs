/**
 * The input guard of scripts/bootstrap-tenant.mjs (MW-005): every check that needs no database,
 * run before a connection is opened. Pure: it reads only the arguments and environment it is given.
 *
 * A tenant's organisation binding is permanent (ADR-0080), so a wrong organisation id or issuer
 * binds the wrong organisation for good. The guard therefore refuses rather than guesses:
 *
 *   - `--issuer` is mandatory and must equal, character for character, PLATFORM_AUTH_ISSUER in the
 *     environment of the process running the script, which on AWS is the task's environment set by
 *     the stack. Neither may be missing; there is no default.
 *   - `--platform-tenant-id` must be an Identity organisation id: a lowercase canonical UUID (Identity
 *     mints organisation ids with randomUUID). Identity's reserved `root` and slugs are refused.
 *   - `--confirm-organisation` must repeat that id exactly. Identity exposes no endpoint that
 *     confirms an organisation exists without a credential (its only product-facing route,
 *     GET /api/auth/introspect, needs a live access token of an account in that organisation), so
 *     the script cannot check existence itself. The echo makes the operator type the id twice and
 *     catches a paste of the wrong field; existence stays the operator's check in Identity.
 *   - unknown options, options given twice and options without a value are refused, so a typo such
 *     as `--dryrun` can never turn a rehearsal into a write.
 */

/** A UUID v7, which `runInContext` requires of every tenant id. */
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Identity's organisation ids: canonical, lowercase RFC 4122 UUIDs (any version Identity mints). */
export const ORGANISATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Every option the script accepts, and whether it takes a value. */
const OPTIONS = new Map([
  ['platform-user-id', true],
  ['platform-tenant-id', true],
  ['confirm-organisation', true],
  ['issuer', true],
  ['platform-issuer', true], // the earlier name of --issuer, still accepted, still mandatory
  ['tenant-id', true],
  ['allow-production', false],
  ['dry-run', false],
]);

/**
 * Parses `--name value` and `--name=value`. Refuses unknown, repeated and value-less options.
 * @returns {{ ok: true, values: Map<string, string | true> } | { ok: false, message: string }}
 */
export const parseArguments = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string' || !token.startsWith('--')) {
      return { ok: false, message: `Unexpected argument "${String(token)}". Nothing was written.` };
    }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    if (!OPTIONS.has(name)) {
      return { ok: false, message: `Unknown option --${name}. Nothing was written.` };
    }
    const canonical = name === 'platform-issuer' ? 'issuer' : name;
    if (values.has(canonical)) {
      return { ok: false, message: `--${canonical} was given twice. Nothing was written.` };
    }
    if (!OPTIONS.get(name)) {
      if (equals !== -1) return { ok: false, message: `--${name} takes no value.` };
      values.set(canonical, true);
      continue;
    }
    let value;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else {
      value = argv[index + 1];
      index += 1;
    }
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      return { ok: false, message: `--${name} needs a value. Nothing was written.` };
    }
    values.set(canonical, value);
  }
  return { ok: true, values };
};

/** The issuer check: explicit, equal to the running environment's, and a plausible issuer URL. */
export const checkIssuer = (given, environment) => {
  const expected = environment.PLATFORM_AUTH_ISSUER;
  if (given === undefined) {
    return (
      'Give --issuer: the Identity issuer the binding holds for, exactly as PLATFORM_AUTH_ISSUER. ' +
      'It is never taken from the environment alone, so the operator states it.'
    );
  }
  if (expected === undefined || expected === '') {
    return (
      'PLATFORM_AUTH_ISSUER is not set in this environment, so --issuer cannot be checked against ' +
      'the issuer this deployment verifies. Run the script where the stack sets it.'
    );
  }
  if (given !== expected) {
    return (
      `--issuer "${given}" is not this deployment's PLATFORM_AUTH_ISSUER "${expected}". The ` +
      'binding would admit no token this deployment accepts. Nothing was written.'
    );
  }
  let url;
  try {
    url = new URL(given);
  } catch {
    return `--issuer "${given}" is not a URL. Nothing was written.`;
  }
  const production = environment.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && (production || url.protocol !== 'http:')) {
    return `--issuer "${given}" must be an https URL${production ? ' in production' : ''}.`;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return `--issuer "${given}" carries credentials, a query or a fragment; an issuer does not.`;
  }
  return '';
};

/** The organisation check: an Identity organisation id, echoed exactly by the operator. */
export const checkOrganisation = (organisation, confirmation) => {
  if (organisation === undefined) {
    return (
      'Give --platform-tenant-id: the Identity organisation id this tenant belongs to (the tid ' +
      "of the account's tokens). A Work tenant with no organisation admits nobody (ADR-0080)."
    );
  }
  if (!ORGANISATION_ID.test(organisation)) {
    return (
      `--platform-tenant-id "${organisation}" is not an Identity organisation id (a lowercase ` +
      'UUID, not the organisation slug and not "root"). Nothing was written.'
    );
  }
  if (confirmation === undefined) {
    return (
      `Give --confirm-organisation=${organisation} after checking in Identity that this ` +
      'organisation exists and is the right one. The binding is permanent; nothing was written.'
    );
  }
  if (confirmation !== organisation) {
    return (
      `--confirm-organisation "${confirmation}" does not repeat --platform-tenant-id ` +
      `"${organisation}". Nothing was written.`
    );
  }
  return '';
};

/**
 * Every database-free check, in order. Returns the options or the first refusal.
 * @returns {{ ok: true, options: object } | { ok: false, message: string }}
 */
export const guard = (argv, environment) => {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return parsed;
  const { values } = parsed;
  const text = (name) => {
    const value = values.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const refuse = (message) => ({ ok: false, message });

  const connection =
    environment.DATABASE_URL ?? environment.DATABASE_MIGRATION_URL ?? environment.TEST_DATABASE_URL;
  if (connection === undefined || connection === '') {
    return refuse(
      'Set DATABASE_URL (or DATABASE_MIGRATION_URL in the migrate task) to a migrated database.',
    );
  }
  const platformUserId = text('platform-user-id')?.trim();
  if (platformUserId === undefined || platformUserId === '') {
    return refuse(
      'Give --platform-user-id: the Platform account this tenant admits. Munaxa Work does not ' +
        'create Platform identities (ADR-0001); the account must already exist on Platform.',
    );
  }
  const organisationProblem = checkOrganisation(
    text('platform-tenant-id'),
    text('confirm-organisation'),
  );
  if (organisationProblem) return refuse(organisationProblem);
  const issuerProblem = checkIssuer(text('issuer'), environment);
  if (issuerProblem) return refuse(issuerProblem);
  const namedTenant = text('tenant-id');
  if (namedTenant !== undefined && !UUID_V7.test(namedTenant)) {
    return refuse(`--tenant-id "${namedTenant}" is not a UUID v7. Every tenant identifier is one.`);
  }
  if (environment.NODE_ENV === 'production' && values.get('allow-production') !== true) {
    return refuse(
      'Refusing to bootstrap a production database without --allow-production. Admitting an ' +
        'identity to a tenant is a real grant of reach; in production it should be deliberate.',
    );
  }
  return {
    ok: true,
    options: {
      connection,
      platformUserId,
      namedTenant,
      organisation: { issuer: text('issuer'), tenantId: text('platform-tenant-id') },
      dryRun: values.get('dry-run') === true,
    },
  };
};
