import { readFile } from 'node:fs/promises';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  readLicensing,
  type ControlPlaneConfiguration,
  type Environment,
  type LicenceFileConfiguration,
} from '@work/config';
import {
  AccessMode,
  SAAS_AVAILABILITY_POLICY,
  entitlementsPath,
  licenseVerifier,
  readEntitlementResponse,
  resolveSnapshot,
  unreachable,
  verifyLicense,
  type EntitlementAnswer,
  type EntitlementSnapshot,
  type LicenseVerifier,
} from '@munaxa/licensing';

import { ENVIRONMENT } from '../configuration/environment.provider.js';

/** This product's key in every Munaxa licence. */
export const WORK_PRODUCT_KEY = 'work';

/** The `fetch` the control-plane client sends with. Bound only by tests. */
export const LICENSING_FETCH = Symbol('LICENSING_FETCH');

export type LicenceState =
  /** `LICENSING_MODE=NONE`: nothing is licensed, and nothing is gated. */
  | { readonly configured: false }
  /** The contract decides; `snapshot` is `null` when nothing trustworthy is known. */
  | {
      readonly configured: true;
      readonly snapshot: EntitlementSnapshot | null;
      /** The ceiling an outage imposes on top of the snapshot. `FULL` when the answer is fresh. */
      readonly cap: AccessMode;
      readonly reason: string | null;
      readonly evaluatedAt: Date;
    };

type Configured = Extract<LicenceState, { readonly configured: true }>;

const CONTROL_PLANE_TIMEOUT_MS = 3_000;

/**
 * Where a tenant's entitlements come from, verified through the shared contract
 * (`@munaxa/licensing`).
 *
 * - **`LICENSE_FILE`** (on premises): a signed licence, re-read at most once a minute, so renewing
 *   is copying a new file into place. One licence for the installation.
 * - **`CONTROL_PLANE`** (Munaxa-hosted): the central subscription service, asked per tenant with
 *   this deployment's service credential and reused for a minute. When it cannot be asked, the last
 *   snapshot it gave is used, degraded by age through the shared outage policy (full for an hour,
 *   no growth for a day, read-only for a week, then nothing). A `404` is an answer — no
 *   subscription — and drops that snapshot, so it cannot bridge a later outage.
 *
 * The latest instant observed is kept for the life of the process and decisions are made at the
 * later of it and the clock, so a clock wound back cannot un-expire a term while the API runs. A
 * hosted process starts with no remembered snapshot: if the service is down at that moment, its
 * tenants are refused until it answers (ADR-0079).
 */
@Injectable()
export class LicenceSource {
  public static readonly TTL_MS = 60_000;
  private readonly logger = new Logger(LicenceSource.name);
  private readonly file: (LicenceFileConfiguration & { readonly verifier: LicenseVerifier }) | null;
  private readonly controlPlane: ControlPlaneConfiguration | null;
  private readonly fetch: typeof fetch;
  private fileCache: { readonly state: Configured; readonly until: number } | null = null;
  private readonly tenantCache = new Map<
    string,
    { readonly state: Configured; readonly until: number }
  >();
  private readonly lastGood = new Map<string, EntitlementSnapshot>();
  private lastObservedAt: Date | null = null;

  // Injected by token: the test runner transpiles without decorator metadata.
  public constructor(
    @Inject(ENVIRONMENT) environment: Environment,
    @Optional() @Inject(LICENSING_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.fetch = fetchImpl ?? globalThis.fetch;
    const licensing = readLicensing(environment);
    // `invalid` never reaches here — the environment refused to load.
    this.file =
      licensing.kind === 'licence-file'
        ? {
            ...licensing.configuration,
            verifier: licenseVerifier(
              licensing.configuration.algorithm,
              licensing.configuration.publicKeys,
            ),
          }
        : null;
    this.controlPlane = licensing.kind === 'control-plane' ? licensing.configuration : null;
  }

  /** Whether any licensing applies to this deployment. */
  public get configured(): boolean {
    return this.file !== null || this.controlPlane !== null;
  }

  /** What is known about this tenant's entitlements right now. */
  public async current(tenantId: string, now: Date = new Date()): Promise<LicenceState> {
    if (this.file !== null) {
      if (this.fileCache !== null && this.fileCache.until > now.getTime()) {
        return this.fileCache.state;
      }
      const state = await this.readFile(this.file, now);
      this.fileCache = { state, until: now.getTime() + LicenceSource.TTL_MS };
      return state;
    }
    if (this.controlPlane !== null) {
      const hit = this.tenantCache.get(tenantId);
      if (hit !== undefined && hit.until > now.getTime()) return hit.state;
      const state = await this.ask(this.controlPlane, tenantId, now);
      this.tenantCache.set(tenantId, { state, until: now.getTime() + LicenceSource.TTL_MS });
      return state;
    }
    return { configured: false };
  }

  private observe(now: Date): Date {
    const evaluatedAt =
      this.lastObservedAt !== null && this.lastObservedAt > now ? this.lastObservedAt : now;
    this.lastObservedAt = evaluatedAt;
    return evaluatedAt;
  }

  private async ask(
    settings: ControlPlaneConfiguration,
    tenantId: string,
    now: Date,
  ): Promise<Configured> {
    const evaluatedAt = this.observe(now);
    const answer = await this.fetchEntitlements(settings, tenantId);
    if (answer.kind === 'SNAPSHOT') {
      this.lastGood.set(tenantId, answer.snapshot);
      return {
        configured: true,
        snapshot: answer.snapshot,
        cap: AccessMode.FULL,
        reason: null,
        evaluatedAt,
      };
    }
    this.logger.warn(`Entitlements for ${tenantId} could not be confirmed: ${answer.reason}`);
    if (answer.kind === 'NONE') {
      this.lastGood.delete(tenantId);
      return {
        configured: true,
        snapshot: null,
        cap: AccessMode.NONE,
        reason: answer.reason,
        evaluatedAt,
      };
    }
    const resolved = resolveSnapshot(
      null,
      this.lastGood.get(tenantId) ?? null,
      evaluatedAt,
      SAAS_AVAILABILITY_POLICY,
    );
    return {
      configured: true,
      snapshot: resolved.snapshot,
      cap: resolved.cap,
      reason: answer.reason,
      evaluatedAt,
    };
  }

  /** Never throws: an outage is an answer, and a thrown error tends to be caught permissively. */
  private async fetchEntitlements(
    settings: ControlPlaneConfiguration,
    tenantId: string,
  ): Promise<EntitlementAnswer> {
    try {
      const response = await this.fetch(
        `${settings.url}${entitlementsPath(WORK_PRODUCT_KEY, tenantId)}`,
        {
          headers: { authorization: `Bearer ${settings.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
          // A redirect would carry the credential somewhere this deployment was not told about.
          redirect: 'error',
        },
      );
      return readEntitlementResponse(
        { status: response.status, body: await response.text() },
        { product: WORK_PRODUCT_KEY, tenantId },
      );
    } catch (error) {
      return unreachable((error as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK');
    }
  }

  private async readFile(
    settings: NonNullable<LicenceSource['file']>,
    now: Date,
  ): Promise<Configured> {
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
    return {
      configured: true,
      snapshot: result.snapshot,
      cap: AccessMode.FULL,
      reason: null,
      evaluatedAt,
    };
  }

  private refused(reason: string, evaluatedAt: Date): Configured {
    this.logger.warn(`The licence could not be confirmed: ${reason}`);
    return { configured: true, snapshot: null, cap: AccessMode.NONE, reason, evaluatedAt };
  }
}
