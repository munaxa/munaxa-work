import { Inject, Injectable } from '@nestjs/common';
import {
  DenialReason,
  OperationKind,
  checkFeature,
  checkOperation,
  checkQuota,
  limitOf,
  type EntitlementDecision,
} from '@munaxa/licensing';
import { NotEntitledException, currentTenantId, type OperationGate } from '@work/kernel';
import type { HeadcountLicence } from '@work/employment';

import { WorkLimit, featureFor } from './catalogue.js';
import { LicenceSource, WORK_PRODUCT_KEY, type LicenceState } from './licence.source.js';

type Configured = Extract<LicenceState, { readonly configured: true }>;

/**
 * What a tenant's licence admits, asked of every operation a person or job starts — ADR-0079.
 *
 * Two questions. **Is the module included?** An operation's declared permission names its module
 * (`payroll.calculate` is Payroll's); a core module needs nothing, a licensable one needs its
 * feature (`catalogue.ts`). **Does the term allow it?** A query is a read and a command a write,
 * through the shared contract, so a suspended or ended tenant reads and changes nothing, on every
 * operation including those written after this.
 *
 * And the licensed headcount, which Employment asks inside the transaction that would add an
 * employment.
 *
 * Under `LICENSING_MODE=NONE` it admits everything: the deployment as it was before licensing.
 */
@Injectable()
export class LicensingGate implements OperationGate, HeadcountLicence {
  // Injected by token: the test runner transpiles without decorator metadata.
  public constructor(@Inject(LicenceSource) private readonly licence: LicenceSource) {}

  public async admit(operation: {
    readonly kind: 'command' | 'query';
    readonly name: string;
    readonly permission: string;
  }): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    const kind = operation.kind === 'command' ? OperationKind.WRITE : OperationKind.READ;
    const context = contextOf(state);
    const feature = featureFor(operation.permission);
    const decision =
      feature === null
        ? checkOperation(state.snapshot, kind, context)
        : checkFeature(state.snapshot, feature, kind, context);
    if (!decision.allowed) throw refusal(decision);
  }

  /**
   * Admit `requested` more open employments. `countOpen` is Employment's: it locks the tenant's
   * headcount and counts inside the transaction that will commit the growth, so two concurrent
   * hires cannot both see the last licensed place. An unlimited plan counts nothing.
   */
  public async admitHeadcount(requested: number, countOpen: () => Promise<number>): Promise<void> {
    const state = await this.state();
    if (state === null) return;
    const context = contextOf(state);
    const growth = checkOperation(state.snapshot, OperationKind.GROWTH, context);
    if (!growth.allowed) throw refusal(growth);
    if (state.snapshot === null || limitOf(state.snapshot, WorkLimit.EMPLOYEES) === null) return;
    const used = await countOpen();
    const decision = checkQuota(state.snapshot, WorkLimit.EMPLOYEES, { used, requested }, context);
    if (!decision.allowed) throw refusal(decision);
  }

  private async state(): Promise<(Configured & { readonly tenantId: string }) | null> {
    if (!this.licence.configured) return null;
    // The pipeline has already refused an operation without a tenant.
    const tenantId = currentTenantId();
    const state = await this.licence.current(tenantId);
    return state.configured ? { ...state, tenantId } : null;
  }
}

const contextOf = (state: Configured & { readonly tenantId: string }) => ({
  now: state.evaluatedAt,
  tenantId: state.tenantId,
  product: WORK_PRODUCT_KEY,
  cap: state.cap,
});

const refusal = (decision: EntitlementDecision): NotEntitledException =>
  new NotEntitledException(
    decision.reason ?? DenialReason.NO_SUBSCRIPTION,
    decision.reason === DenialReason.FEATURE_NOT_INCLUDED
      ? "Your organisation's plan does not include this module."
      : decision.reason === DenialReason.QUOTA_EXCEEDED
        ? "Your organisation's licensed headcount has been reached."
        : decision.reason === DenialReason.NO_SUBSCRIPTION
          ? 'Your organisation has no valid Munaxa Work subscription.'
          : "Your organisation's subscription does not allow this right now.",
    decision.status,
  );
