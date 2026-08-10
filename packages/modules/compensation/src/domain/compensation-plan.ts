import { uuidV7, type RuleDefinition } from '@work/kernel';

import {
  CompensationAggregate,
  bilingualFrom,
  checkedCode,
  checkedCount,
  checkedMetadata,
  checkedOptionalCode,
  definedOnly,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import {
  MAX_BASIS_POINTS,
  MAX_CURRENCY_EXPONENT,
  isCurrencyCode,
  type DefinitionStatus,
} from './compensation-vocabulary.js';
import type { MoneyAmount } from './money-amount.js';

/**
 * A compensation plan version — the configuration an employment is assigned to.
 *
 * **Nothing is seeded.** There is no default plan, no starter structure, no suggested component
 * set and no bootstrap a tenant has to delete. A tenant that has configured no plan has no plan,
 * and the screen says so.
 *
 * **Immutable once published**, like every definition in this product (ADR-0048): a compensation
 * record names the plan version that governed it, and a plan edited in June would rewrite what
 * March meant. Changing a plan means drafting a new version.
 *
 * Three fields are boundaries rather than features:
 *
 * - **`salaryStructureId` is optional.** Every level of the hierarchy is optional, and a plan that
 *   names no structure is the ordinary shape for a company paying simple salaries. Forcing a
 *   government-style grade/step model on a forty-person business is the failure this prevents.
 * - **`maximumIncreaseBasisPoints` / `maximumDecreaseBasisPoints` are nullable and inert when
 *   null.** They are change control a tenant may configure, not a statutory bound this product
 *   ships. Nothing anywhere implies a minimum wage or a mandated rise.
 * - **`countryPackId` is null for a tenant-defined plan.** It is how a screen can say "this plan
 *   exists because a country pack authored it" without any code branching on which country (00B).
 */

export interface PlanComponentTerms {
  readonly id: string;
  readonly tenantId: string;
  readonly compensationPlanId: string;
  readonly componentId: string;
  readonly mandatory: boolean;
  /** Bounds a plan places on this component. Both optional; a bound carries its own currency. */
  readonly minimum?: MoneyAmount;
  readonly maximum?: MoneyAmount;
  /** Evaluated by the kernel rule engine. Data, so a country pack needs no code here. */
  readonly eligibilityRule?: RuleDefinition;
  readonly version: number;
}

export interface CompensationPlanState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly versionNumber: number;
  readonly status: DefinitionStatus;
  readonly salaryStructureId?: string;
  readonly defaultCurrencyCode: string;
  readonly defaultCurrencyExponent: number;
  readonly approvalRequired: boolean;
  readonly approvalsRequired: number;
  readonly selfApprovalPermitted: boolean;
  readonly maximumIncreaseBasisPoints?: number;
  readonly maximumDecreaseBasisPoints?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineCompensationPlan {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly defaultCurrencyCode: string;
  readonly defaultCurrencyExponent: number;
  readonly salaryStructureId?: string;
  readonly approvalRequired?: boolean;
  readonly approvalsRequired?: number;
  readonly selfApprovalPermitted?: boolean;
  readonly maximumIncreaseBasisPoints?: number;
  readonly maximumDecreaseBasisPoints?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

const MAX_APPROVALS = 10;

export class CompensationPlan extends CompensationAggregate {
  private constructor(private state: CompensationPlanState) {
    super(state.id, state.tenantId, state.version, 'CompensationPlan');
  }

  public static define(
    request: DefineCompensationPlan,
    occurredAt: Date,
  ): CompensationResult<CompensationPlan> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const approval = checkedApproval(request);

    if (!approval.ok) return approval;

    const bounds = checkedBounds(request);

    if (!bounds.ok) return bounds;

    const pack = checkedPack(request);

    if (!pack.ok) return pack;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new CompensationPlan({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        ...identity.value,
        ...approval.value,
        ...definedOnly({ salaryStructureId: request.salaryStructureId }),
        ...bounds.value,
        ...pack.value,
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: CompensationPlanState): CompensationPlan {
    return new CompensationPlan(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  /**
   * Freezes the plan version.
   *
   * Separate from drafting it, and behind a separate permission, because a published plan governs
   * everybody it is assigned to and every compensation record created under it will name it by
   * identity for as long as the record exists.
   */
  public publish(by: string, at: Date): CompensationResult<CompensationPlanState> {
    if (this.state.status !== 'draft') return refuse('plan_not_draft');

    this.state = { ...this.state, status: 'published', publishedAt: at, publishedBy: by };
    return accept(this.state);
  }

  /** Retiring a version. The records that name it keep naming it; nothing is rewritten. */
  public supersede(): CompensationResult<CompensationPlanState> {
    if (this.state.status !== 'published') return refuse('plan_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state);
  }

  public snapshot(): CompensationPlanState {
    return this.state;
  }
}

const checkedIdentity = (
  request: DefineCompensationPlan,
): CompensationResult<{
  readonly code: string;
  readonly name: BilingualText;
  readonly defaultCurrencyCode: string;
  readonly defaultCurrencyExponent: number;
}> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  if (!isCurrencyCode(request.defaultCurrencyCode)) {
    return refuse('currency_code_malformed', { field: 'defaultCurrencyCode' });
  }
  if (
    !Number.isInteger(request.defaultCurrencyExponent) ||
    request.defaultCurrencyExponent < 0 ||
    request.defaultCurrencyExponent > MAX_CURRENCY_EXPONENT
  ) {
    return refuse('currency_exponent_implausible', { field: 'defaultCurrencyExponent' });
  }
  return accept({
    code: code.value,
    name: name.value,
    defaultCurrencyCode: request.defaultCurrencyCode,
    defaultCurrencyExponent: request.defaultCurrencyExponent,
  });
};

/**
 * The approval configuration.
 *
 * `selfApprovalPermitted` defaults to **false**, and the domain refuses self-approval regardless of
 * how it is set on a plan whose subject and decider are the same person — the flag exists so a
 * tenant can be *more* restrictive, never less. The database refuses it too (D-9).
 */
const checkedApproval = (
  request: DefineCompensationPlan,
): CompensationResult<{
  readonly approvalRequired: boolean;
  readonly approvalsRequired: number;
  readonly selfApprovalPermitted: boolean;
}> => {
  const approvalRequired = request.approvalRequired ?? true;
  const count = checkedCount(
    request.approvalsRequired ?? (approvalRequired ? 1 : 0),
    'approvalsRequired',
    MAX_APPROVALS,
  );

  if (!count.ok) return count;
  if (approvalRequired && count.value === 0) return refuse('plan_requires_an_approver');

  return accept({
    approvalRequired,
    approvalsRequired: count.value,
    selfApprovalPermitted: request.selfApprovalPermitted ?? false,
  });
};

const checkedBounds = (
  request: DefineCompensationPlan,
): CompensationResult<{
  readonly maximumIncreaseBasisPoints?: number;
  readonly maximumDecreaseBasisPoints?: number;
}> => {
  const increase = checkedBasisPoints(request.maximumIncreaseBasisPoints, 'maximumIncrease');

  if (!increase.ok) return increase;

  const decrease = checkedBasisPoints(request.maximumDecreaseBasisPoints, 'maximumDecrease');

  if (!decrease.ok) return decrease;

  return accept(
    definedOnly({
      maximumIncreaseBasisPoints: increase.value,
      maximumDecreaseBasisPoints: decrease.value,
    }),
  );
};

const checkedBasisPoints = (
  value: number | undefined,
  field: string,
): CompensationResult<number | undefined> => {
  if (value === undefined) return accept(undefined);
  if (!Number.isInteger(value) || value < 0 || value > MAX_BASIS_POINTS) {
    return refuse('basis_points_out_of_range', { field });
  }
  return accept(value);
};

/** A pack identifier and a pack version travel together, or neither does. */
const checkedPack = (
  request: DefineCompensationPlan,
): CompensationResult<{
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}> => {
  const pack = checkedOptionalCode(request.countryPackId, 'countryPackId');

  if (!pack.ok) return pack;
  if ((pack.value === undefined) !== (request.countryPackVersion === undefined)) {
    return refuse('country_pack_version_required');
  }
  return accept(
    definedOnly({
      countryPackId: pack.value,
      countryPackVersion: request.countryPackVersion,
    }),
  );
};
