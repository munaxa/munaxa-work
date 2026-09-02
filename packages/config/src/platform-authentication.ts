/**
 * The Platform authentication contract, as a deployment configured it.
 *
 * Munaxa Work does not authenticate anybody and never will (ADR-0001). What it does is *verify*
 * that a token Platform issued is genuine, and to do that it needs to be told four things:
 * which issuer to trust, which audience it is, which signature algorithm, and which public keys.
 * Those four are the whole contract, and they are read here so that the rule confining
 * `process.env` to this package stays absolute.
 *
 * Three properties of this file are load-bearing, and each closes a specific failure:
 *
 * - **All four or none.** A deployment that supplied an issuer but no keys has configured
 *   authentication it cannot perform. Falling back to "authenticate nobody" would be the safe
 *   *behaviour* and the wrong *answer*: the operator believes the deployment is verifying
 *   tokens. It fails startup instead, which is noticed in the first minute rather than the
 *   first audit.
 * - **Asymmetric only.** `HS256` would work, and would mean this repository holds a key that
 *   mints tokens it accepts. A verifier that can forge what it verifies is not a verifier.
 *   Only `RS256` and `ES256` are accepted, and the symmetric spellings are rejected by name.
 * - **Public key material only.** An entry carrying a private key is refused rather than
 *   ignored, because a deployment that pasted a key pair in here has put a signing key in an
 *   environment variable and needs to be told, not quietly accommodated.
 */

/**
 * The algorithms this product will verify with.
 *
 * Both are asymmetric, so the verification material is a public key and Munaxa Work cannot
 * produce a token that would pass its own check. That is the entire reason the list is closed.
 */
export const PLATFORM_AUTHENTICATION_ALGORITHMS = ['RS256', 'ES256'] as const;

export type PlatformAuthenticationAlgorithm = (typeof PLATFORM_AUTHENTICATION_ALGORITHMS)[number];

/** One verification key, identified by the `kid` the token header carries. */
export interface PlatformVerificationKey {
  readonly kid: string;
  readonly publicKey: string;
}

export interface PlatformAuthenticationConfiguration {
  readonly issuer: string;
  readonly audience: readonly string[];
  readonly algorithm: PlatformAuthenticationAlgorithm;
  /** At least one, each with a distinct `kid`. Rotation is publishing a second one. */
  readonly keys: readonly PlatformVerificationKey[];
  readonly clockSkewMs: number;
}

/** What this reads from the validated environment. */
export interface PlatformAuthenticationSource {
  readonly PLATFORM_AUTH_ISSUER?: string | undefined;
  readonly PLATFORM_AUTH_AUDIENCE?: string | undefined;
  readonly PLATFORM_AUTH_ALGORITHM?: string | undefined;
  readonly PLATFORM_AUTH_PUBLIC_KEYS?: string | undefined;
  readonly PLATFORM_AUTH_CLOCK_SKEW_MS: number;
}

/**
 * The three answers, kept apart because they are acted on differently.
 *
 * `absent` selects `UnauthenticatedPort` and is an ordinary, supported deployment. `invalid`
 * fails startup. There is deliberately no fourth answer that means "partly configured, carry
 * on regardless".
 */
export type PlatformAuthentication =
  | { readonly kind: 'absent' }
  | { readonly kind: 'configured'; readonly configuration: PlatformAuthenticationConfiguration }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

/**
 * The four that decide whether authentication is configured at all.
 *
 * `PLATFORM_AUTH_CLOCK_SKEW_MS` is deliberately not among them: it carries a safe default, it
 * cannot by itself enable or disable verification, and requiring the other four whenever
 * somebody tunes a tolerance would be a rule that only ever surprises people.
 */
const REQUIRED_VARIABLES = [
  'PLATFORM_AUTH_ISSUER',
  'PLATFORM_AUTH_AUDIENCE',
  'PLATFORM_AUTH_ALGORITHM',
  'PLATFORM_AUTH_PUBLIC_KEYS',
] as const;

/** Matches every PEM private-key banner: `PRIVATE KEY`, `RSA PRIVATE KEY`, `EC PRIVATE KEY`. */
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PUBLIC_KEY_PEM = /^-----BEGIN (RSA )?PUBLIC KEY-----/;

const isSupplied = (value: string | undefined): boolean =>
  value !== undefined && value.trim() !== '';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const splitList = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * Reads one key entry, refusing anything that is not exactly a public key with an identifier.
 *
 * Every refusal is a separate early return so that the message names the one thing wrong, and
 * so that narrowing carries the types through without an assertion.
 */
const readKey = (
  entry: unknown,
  index: number,
): { readonly key?: PlatformVerificationKey; readonly issues: readonly string[] } => {
  const at = `PLATFORM_AUTH_PUBLIC_KEYS[${index}]`;

  if (!isRecord(entry)) {
    return { issues: [`${at}: must be an object with "kid" and "publicKey".`] };
  }
  if ('privateKey' in entry) {
    return {
      issues: [
        `${at}: carries private key material. Munaxa Work verifies tokens and never signs one, so it must be given the public key alone.`,
      ],
    };
  }
  const { kid, publicKey } = entry;

  if (typeof kid !== 'string' || kid.trim() === '') {
    return { issues: [`${at}: "kid" must be a non-empty string; it is what selects the key.`] };
  }
  if (typeof publicKey !== 'string' || publicKey.trim() === '') {
    return { issues: [`${at}: "publicKey" must be a non-empty PEM string.`] };
  }
  const pem = publicKey.trim();

  if (PRIVATE_KEY_PEM.test(pem)) {
    return {
      issues: [
        `${at}: "publicKey" contains a PEM private key. Supply the public half; a deployment that can sign can forge what it verifies.`,
      ],
    };
  }
  if (!PUBLIC_KEY_PEM.test(pem)) {
    return { issues: [`${at}: "publicKey" is not a PEM public key.`] };
  }
  return { key: { kid: kid.trim(), publicKey: pem }, issues: [] };
};

const duplicateKidIssues = (keys: readonly PlatformVerificationKey[]): readonly string[] => {
  const kids = keys.map((key) => key.kid);
  const duplicated = [...new Set(kids.filter((kid, index) => kids.indexOf(kid) !== index))];

  return duplicated.length === 0
    ? []
    : [
        `PLATFORM_AUTH_PUBLIC_KEYS: duplicate kid ${duplicated.join(', ')}; each key needs its own.`,
      ];
};

const readKeys = (
  raw: string,
): { readonly keys: readonly PlatformVerificationKey[]; readonly issues: readonly string[] } => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      keys: [],
      issues: [
        'PLATFORM_AUTH_PUBLIC_KEYS: not valid JSON. Expected [{"kid":"…","publicKey":"-----BEGIN PUBLIC KEY-----…"}].',
      ],
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      keys: [],
      issues: ['PLATFORM_AUTH_PUBLIC_KEYS: must be a JSON array holding at least one key.'],
    };
  }
  const read = parsed.map(readKey);
  const keys = read.flatMap((entry) => (entry.key === undefined ? [] : [entry.key]));
  const issues = read.flatMap((entry) => entry.issues);

  return { keys, issues: [...issues, ...duplicateKidIssues(keys)] };
};

const issuerIssues = (raw: string): readonly string[] => {
  try {
    new URL(raw);
    return [];
  } catch {
    return [
      `PLATFORM_AUTH_ISSUER: "${raw}" is not a URL. It must equal the "iss" claim Platform mints, exactly.`,
    ];
  }
};

const audienceIssues = (audience: readonly string[]): readonly string[] =>
  audience.length === 0
    ? ['PLATFORM_AUTH_AUDIENCE: must name at least one audience this deployment answers to.']
    : [];

const algorithmIssues = (raw: string): readonly string[] =>
  PLATFORM_AUTHENTICATION_ALGORITHMS.some((allowed) => allowed === raw)
    ? []
    : [
        `PLATFORM_AUTH_ALGORITHM: "${raw}" is not accepted. Munaxa Work verifies with ${PLATFORM_AUTHENTICATION_ALGORITHMS.join(' or ')} only — a symmetric algorithm would give this deployment the key that mints the tokens it checks.`,
      ];

const partiallyConfigured = (supplied: readonly string[]): PlatformAuthentication => ({
  kind: 'invalid',
  issues: [
    `Platform authentication is partly configured: ${supplied.join(', ')} supplied, ${REQUIRED_VARIABLES.filter(
      (name) => !supplied.includes(name),
    ).join(
      ', ',
    )} missing. Supply all four or none — a deployment that half-configures verification is not verifying.`,
  ],
});

/**
 * Reads the Platform authentication contract from a validated environment.
 *
 * Pure: it decides, and the caller acts. `loadEnvironment` calls it to fail startup on
 * `invalid`, and the API's composition root calls it again to choose the port. Both go through
 * this one function, so the check and the selection can never disagree about the same input.
 */
export const readPlatformAuthentication = (
  source: PlatformAuthenticationSource,
): PlatformAuthentication => {
  const supplied = REQUIRED_VARIABLES.filter((name) => isSupplied(source[name]));

  if (supplied.length === 0) return { kind: 'absent' };
  if (supplied.length < REQUIRED_VARIABLES.length) return partiallyConfigured(supplied);

  const issuer = (source.PLATFORM_AUTH_ISSUER ?? '').trim();
  const algorithm = (source.PLATFORM_AUTH_ALGORITHM ?? '').trim();
  const audience = splitList(source.PLATFORM_AUTH_AUDIENCE ?? '');
  const keyMaterial = readKeys((source.PLATFORM_AUTH_PUBLIC_KEYS ?? '').trim());
  const issues = [
    ...issuerIssues(issuer),
    ...audienceIssues(audience),
    ...algorithmIssues(algorithm),
    ...keyMaterial.issues,
  ];

  if (issues.length > 0) return { kind: 'invalid', issues };

  return {
    kind: 'configured',
    configuration: Object.freeze({
      issuer,
      audience,
      // Narrowed by `algorithmIssues` above: an unaccepted spelling never reaches this line.
      algorithm: algorithm as PlatformAuthenticationAlgorithm,
      keys: keyMaterial.keys,
      clockSkewMs: source.PLATFORM_AUTH_CLOCK_SKEW_MS,
    }),
  };
};
