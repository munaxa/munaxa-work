import type { Environment } from './environment.js';

/**
 * Where Munaxa Work's entitlements come from.
 *
 * `NONE` (the default) is the deployment as it has always been: nothing is licensed and nothing is
 * gated. `LICENSE_FILE` is the on-premises mode: a signed Munaxa licence on disk, verified offline
 * against public keys, which then caps every request through the shared `@munaxa/licensing`
 * contract. No failure selects `NONE`; a licence that is missing or untrustworthy grants nothing.
 */
export type Licensing =
  | { readonly kind: 'none' }
  | { readonly kind: 'licence-file'; readonly configuration: LicenceFileConfiguration }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

export interface LicenceFileConfiguration {
  readonly path: string;
  readonly algorithm: 'ES256' | 'RS256';
  readonly publicKeys: readonly { readonly kid: string; readonly publicKey: string }[];
  readonly installationId: string;
}

export const readLicensing = (environment: Environment): Licensing => {
  if (environment.LICENSING_MODE === 'NONE') return { kind: 'none' };

  const issues: string[] = [];
  for (const key of [
    'LICENSE_FILE_PATH',
    'LICENSE_PUBLIC_KEYS',
    'LICENSE_INSTALLATION_ID',
  ] as const) {
    if (environment[key] === undefined)
      issues.push(`${key}: required when LICENSING_MODE=LICENSE_FILE.`);
  }

  let publicKeys: { kid: string; publicKey: string }[] = [];
  if (environment.LICENSE_PUBLIC_KEYS !== undefined) {
    try {
      const parsed: unknown = JSON.parse(environment.LICENSE_PUBLIC_KEYS);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not a non-empty array');
      publicKeys = parsed.map((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        if (typeof e['kid'] !== 'string' || typeof e['publicKey'] !== 'string') {
          throw new Error('each key needs a kid and a publicKey');
        }
        return { kid: e['kid'], publicKey: e['publicKey'] };
      });
    } catch (error) {
      issues.push(`LICENSE_PUBLIC_KEYS: is not valid: ${(error as Error).message}.`);
    }
    // An installation holding a private key could sign its own licence.
    if (publicKeys.some((key) => /PRIVATE KEY/.test(key.publicKey))) {
      issues.push(
        'LICENSE_PUBLIC_KEYS: holds a private key. An installation holds public keys only.',
      );
    }
  }

  if (issues.length > 0) return { kind: 'invalid', issues };
  return {
    kind: 'licence-file',
    configuration: {
      path: environment.LICENSE_FILE_PATH as string,
      algorithm: environment.LICENSE_ALGORITHM,
      publicKeys,
      installationId: environment.LICENSE_INSTALLATION_ID as string,
    },
  };
};
