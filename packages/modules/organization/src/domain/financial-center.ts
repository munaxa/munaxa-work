import { flatMap, map, uuidV7, type EventOrigin } from '@work/kernel';

import {
  OrganizationAggregate,
  checkedCode,
  checkedMetadata,
  nameFrom,
  type BilingualName,
  type Metadata,
} from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import type { OrganizationStatus } from './organization-vocabulary.js';

/**
 * A cost centre or a profit centre: organizational reference data that finance recognizes
 * (AD-007).
 *
 * Financial *ownership* is not here and never will be. There is no budget on this aggregate, no
 * actuals, no variance and no allocation rule — those belong to the finance system this product
 * integrates with, and a centre that carried a budget would be this product quietly becoming a
 * general ledger. What Organization owns is the fact that the centre exists, what it is called
 * in both languages, and which part of the structure it attaches to.
 *
 * Cost and profit centres are the same shape and different concepts, so they share this class
 * and are distinguished by `kind`. The alternative — two near-identical classes and two
 * near-identical tables — is duplicated business logic, which the standards forbid outright, and
 * the duplication would drift the first time one of them gained a field.
 */

export const CENTER_KINDS = ['cost', 'profit'] as const;
export type CenterKind = (typeof CENTER_KINDS)[number];

export interface FinancialCenterState {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: CenterKind;
  readonly code: string;
  readonly name: BilingualName;
  /** The unit it belongs to, if any. A shared services centre legitimately belongs to none. */
  readonly unitId?: string;
  readonly status: OrganizationStatus;
  readonly metadata: Metadata;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface OpenCenter {
  readonly tenantId: string;
  readonly kind: CenterKind;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export class FinancialCenter extends OrganizationAggregate {
  private constructor(private state: FinancialCenterState) {
    super(state.id, state.tenantId, state.version, 'FinancialCenter');
  }

  public static open(
    request: OpenCenter,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<FinancialCenter> {
    return flatMap(checkedCode(request.code), (code) =>
      flatMap(nameFrom(request.name), (name) =>
        map(checkedMetadata(request.metadata), (metadata) => {
          const center = new FinancialCenter({
            id: uuidV7(occurredAt.getTime()),
            tenantId: request.tenantId,
            kind: request.kind,
            code,
            name,
            ...(request.unitId === undefined ? {} : { unitId: request.unitId }),
            status: 'active',
            metadata,
            effectiveFrom: request.effectiveFrom,
            version: 0,
          });

          center.raise(
            request.kind === 'cost'
              ? OrganizationEvents.costCenterOpened
              : OrganizationEvents.profitCenterOpened,
            { centerId: center.id, kind: request.kind, code, unitId: request.unitId ?? null },
            origin,
            occurredAt,
          );
          return center;
        }),
      ),
    );
  }

  public static rehydrate(state: FinancialCenterState): FinancialCenter {
    return new FinancialCenter(state);
  }

  public get kind(): CenterKind {
    return this.state.kind;
  }

  public get code(): string {
    return this.state.code;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  public existsOn(instant: Date): boolean {
    const time = instant.getTime();
    if (time < this.state.effectiveFrom.getTime()) return false;
    return this.state.effectiveTo === undefined || time < this.state.effectiveTo.getTime();
  }

  public rename(
    name: Readonly<Record<string, string>>,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<BilingualName> {
    if (this.state.status === 'closed') return refuse('center_closed', { kind: this.state.kind });

    return map(nameFrom(name), (checked) => {
      this.state = { ...this.state, name: checked };
      this.raise(
        this.state.kind === 'cost'
          ? OrganizationEvents.costCenterOpened
          : OrganizationEvents.profitCenterOpened,
        { centerId: this.id, kind: this.state.kind, renamed: true },
        origin,
        occurredAt,
      );
      return checked;
    });
  }

  /**
   * Closes the centre from a date. Postings already made against it are evidence, so the row
   * survives and every historical reference still resolves — which is the whole reason there is
   * no hard delete anywhere in this product.
   */
  public close(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationStatus> {
    if (this.state.status === 'closed') return refuse('center_closed', { kind: this.state.kind });
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('center_closed_before_it_existed');
    }

    this.state = { ...this.state, status: 'closed', effectiveTo };
    this.raise(
      this.state.kind === 'cost'
        ? OrganizationEvents.costCenterClosed
        : OrganizationEvents.profitCenterClosed,
      { centerId: this.id, kind: this.state.kind, effectiveTo },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public snapshot(): FinancialCenterState {
    return { ...this.state, version: this.version };
  }
}
