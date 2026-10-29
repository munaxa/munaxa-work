/**
 * What `readLicensing` reads: the licensing variables, and the deployment's `NODE_ENV`. Declared
 * here rather than taken from `Environment`, so this module and the environment schema that calls it
 * do not import each other — the shape `PlatformAuthenticationSource` has, for the same reason.
 */
export interface LicensingSource {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly LICENSING_MODE: 'NONE' | 'LICENSE_FILE' | 'CONTROL_PLANE';
  readonly LICENSE_FILE_PATH?: string | undefined;
  readonly LICENSE_PUBLIC_KEYS?: string | undefined;
  readonly LICENSE_ALGORITHM: 'ES256' | 'RS256';
  readonly LICENSE_INSTALLATION_ID?: string | undefined;
  readonly LICENSE_REVOCATION_PATH?: string | undefined;
  readonly CONTROL_PLANE_URL?: string | undefined;
  readonly CONTROL_PLANE_TOKEN?: string | undefined;
}

/**
 * Where Munaxa Work's entitlements come from.
 *
 * `NONE` (the default) is the deployment as it has always been: nothing is licensed and nothing is
 * gated. `LICENSE_FILE` is the on-premises mode: a signed Munaxa licence on disk, verified offline
 * against public keys, which then caps every request through the shared `@munaxa/licensing`
 * contract. `CONTROL_PLANE` is the hosted mode: the central subscription service, asked per tenant
 * with this deployment's service credential. No failure selects `NONE`; a licence that is missing
 * or untrustworthy, or a tenant the service has no subscription for, grants nothing.
 */
export type Licensing =
  | { readonly kind: 'none' }
  | { readonly kind: 'licence-file'; readonly configuration: LicenceFileConfiguration }
  | { readonly kind: 'control-plane'; readonly configuration: ControlPlaneConfiguration }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] };

export interface ControlPlaneConfiguration {
  /** Without a trailing slash. */
  readonly url: string;
  readonly token: string;
}

export interface LicenceFileConfiguration {
  readonly path: string;
  readonly algorithm: 'ES256' | 'RS256';
  readonly publicKeys: readonly { readonly kid: string; readonly publicKey: string }[];
  readonly installationId: string;
  /**
   * Where Munaxa delivers the signed revocation list, next to the licence. Optional: without it the
   * list persisted earlier still applies, and nothing is revoked that was not before.
   */
  readonly revocationPath: string | null;
}

export const readLicensing = (environment: LicensingSource): Licensing => {
  if (environment.LICENSING_MODE === 'NONE') return { kind: 'none' };
  if (environment.LICENSING_MODE === 'CONTROL_PLANE') return readControlPlane(environment);
  return readLicenceFile(environment);
};

const readLicenceFile = (environment: LicensingSource): Licensing => {
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
      revocationPath: environment.LICENSE_REVOCATION_PATH ?? null,
    },
  };
};

const readControlPlane = (environment: LicensingSource): Licensing => {
  const issues: string[] = [];
  for (const key of ['CONTROL_PLANE_URL', 'CONTROL_PLANE_TOKEN'] as const) {
    if (environment[key] === undefined)
      issues.push(`${key}: required when LICENSING_MODE=CONTROL_PLANE.`);
  }
  // The credential travels in a header: never over plain HTTP outside a developer's machine.
  if (
    environment.NODE_ENV === 'production' &&
    environment.CONTROL_PLANE_URL?.startsWith('http://') === true
  ) {
    issues.push('CONTROL_PLANE_URL: must be https in production.');
  }
  if (issues.length > 0) return { kind: 'invalid', issues };
  return {
    kind: 'control-plane',
    configuration: {
      url: (environment.CONTROL_PLANE_URL as string).replace(/\/+$/, ''),
      token: environment.CONTROL_PLANE_TOKEN as string,
    },
  };
};
