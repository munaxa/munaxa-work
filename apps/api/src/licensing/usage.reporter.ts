import { Logger } from '@nestjs/common';
import type { ControlPlaneConfiguration } from '@work/config';
import { usagePath, type UsageBatch } from '@munaxa/licensing';

import { WorkLimit } from './catalogue.js';
import { WORK_PRODUCT_KEY } from './licence.source.js';

/** The token of the reporter `LicensingGate` hands each admitted operation's tenant to. */
export const USAGE_REPORTER = Symbol('USAGE_REPORTER');

const HOUR_MS = 3_600_000;
const TIMEOUT_MS = 3_000;

export interface UsageReporter {
  /** Never throws and is never awaited by a request. */
  noteActivity(tenantId: string, now?: Date): void;
}

/** `LICENSING_MODE` other than `CONTROL_PLANE`: there is nobody to report to. */
export const NO_USAGE_REPORTS: UsageReporter = { noteActivity: () => undefined };

/**
 * Reports a tenant's licensed headcount to the central subscription service — ADR-0079.
 *
 * At most once per tenant per hour per process, on the first operation the tenant starts in that
 * hour, measured by Employment's own count of open employments (the same rows the headcount limit
 * counts). The report is stamped with the start of the hour, and the service keeps one point per
 * (tenant, metric, instant), so several processes reporting the same hour report one point.
 *
 * Informational at the other end, so best effort here: a failed report is logged and retried the
 * next hour; it never changes access and never delays a request. A tenant that does nothing in an
 * hour is not reported for it — its headcount cannot have changed through Work.
 */
export class HourlyHeadcountReporter implements UsageReporter {
  private readonly logger = new Logger(HourlyHeadcountReporter.name);
  private readonly reported = new Map<string, number>();

  public constructor(
    private readonly settings: ControlPlaneConfiguration,
    /** Runs in the current tenant's context. */
    private readonly countOpenEmployments: () => Promise<number>,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  public noteActivity(tenantId: string, now: Date = new Date()): void {
    const hour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    if (this.reported.get(tenantId) === hour) return;
    this.reported.set(tenantId, hour);
    void this.report(tenantId, new Date(hour)).catch((error: unknown) => {
      // Forget the hour, so the tenant's next operation tries again.
      if (this.reported.get(tenantId) === hour) this.reported.delete(tenantId);
      this.logger.warn(`Usage report for ${tenantId} not delivered: ${(error as Error).message}`);
    });
  }

  private async report(tenantId: string, measuredAt: Date): Promise<void> {
    const value = await this.countOpenEmployments();
    const batch: UsageBatch = {
      reports: [
        {
          tenantId,
          metric: WorkLimit.EMPLOYEES,
          value: Math.max(0, Math.trunc(value)),
          measuredAt: measuredAt.toISOString(),
        },
      ],
    };
    const response = await this.fetchImpl(`${this.settings.url}${usagePath(WORK_PRODUCT_KEY)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.settings.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  }
}
