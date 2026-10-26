import { readFile } from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { readLicensing, type Environment, type LicenceFileConfiguration } from '@work/config';
import {
  licenseVerifier,
  verifyLicense,
  type EntitlementSnapshot,
  type LicenseVerifier,
} from '@munaxa/licensing';

import { ENVIRONMENT } from '../configuration/environment.provider.js';

/** This product's key in every Munaxa licence. */
export const WORK_PRODUCT_KEY = 'work';

export type LicenceState =
  /** `LICENSING_MODE=NONE`: nothing is licensed, and nothing is gated. */
  | { readonly configured: false }
  /** The licence decides; `snapshot` is `null` when it is missing or fails verification. */
  | {
      readonly configured: true;
      readonly snapshot: EntitlementSnapshot | null;
      readonly reason: string | null;
      readonly evaluatedAt: Date;
    };

/**
 * The on-premises licence, verified offline with the shared contract (`@munaxa/licensing`).
 *
 * Re-read at most once a minute, so renewing is copying a new file into place. The latest instant
 * observed is kept for the life of the process and decisions are made at the later of it and the
 * clock, so a clock wound back cannot un-expire a licence while the API runs.
 */
@Injectable()
export class LicenceSource {
  public static readonly TTL_MS = 60_000;
  private readonly logger = new Logger(LicenceSource.name);
  private readonly settings:
    (LicenceFileConfiguration & { readonly verifier: LicenseVerifier }) | null;
  private cached: { readonly state: LicenceState; readonly until: number } | null = null;
  private lastObservedAt: Date | null = null;

  // Injected by token: the test runner transpiles without decorator metadata.
  public constructor(@Inject(ENVIRONMENT) environment: Environment) {
    const licensing = readLicensing(environment);
    // `invalid` never reaches here — the environment refused to load.
    this.settings =
      licensing.kind === 'licence-file'
        ? {
            ...licensing.configuration,
            verifier: licenseVerifier(
              licensing.configuration.algorithm,
              licensing.configuration.publicKeys,
            ),
          }
        : null;
  }

  public async current(now: Date = new Date()): Promise<LicenceState> {
    if (this.settings === null) return { configured: false };
    if (this.cached !== null && this.cached.until > now.getTime()) return this.cached.state;
    const state = await this.read(this.settings, now);
    this.cached = { state, until: now.getTime() + LicenceSource.TTL_MS };
    return state;
  }

  private async read(
    settings: NonNullable<LicenceSource['settings']>,
    now: Date,
  ): Promise<LicenceState> {
    const evaluatedAt =
      this.lastObservedAt !== null && this.lastObservedAt > now ? this.lastObservedAt : now;
    let text: string;
    try {
      text = await readFile(settings.path, 'utf8');
    } catch {
      return this.refused('LICENSE_FILE_UNREADABLE', evaluatedAt);
    }
    const result = verifyLicense(text, {
      verifier: settings.verifier,
      product: WORK_PRODUCT_KEY,
      installationId: settings.installationId,
      now,
      lastObservedAt: this.lastObservedAt,
    });
    if (!result.ok) return this.refused(`LICENSE_${result.reason}`, evaluatedAt);
    this.lastObservedAt = evaluatedAt;
    return { configured: true, snapshot: result.snapshot, reason: null, evaluatedAt };
  }

  private refused(reason: string, evaluatedAt: Date): LicenceState {
    this.logger.warn(`The licence could not be confirmed: ${reason}`);
    return { configured: true, snapshot: null, reason, evaluatedAt };
  }
}
