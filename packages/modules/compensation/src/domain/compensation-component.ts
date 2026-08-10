import { uuidV7, type RuleDefinition } from '@work/kernel';

import {
  CompensationAggregate,
  bilingualFrom,
  checkedCode,
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
  isCalculationBasis,
  isComponentKind,
  isRecurrence,
  isRoundingMode,
  type CalculationBasis,
  type ComponentKind,
  type DefinitionStatus,
  type Recurrence,
  type RoundingMode,
} from './compensation-vocabulary.js';

/**
 * The configurable definition of *a thing an employment can be entitled to*.
 *
 * **Nothing is seeded.** Basic Salary, Housing, Transport, Meal and Phone are examples in the phase
 * specification and appear nowhere in this module. Every one of them is a component a tenant or a
 * country pack defines, and a product that shipped them would be asserting that every customer in
 * every market wants the same set (00B).
 *
 * **`deduction` is not a kind.** Decision D-1 excludes deductions from this phase rather than
 * shipping a partial version: statutory deductions are Payroll's, loan recovery is Phase 10.1's,
 * and a voluntary deduction is only meaningful against a net figure this module does not compute.
 *
 * Three fields are boundaries rather than features:
 *
 * - **`payrollTreatmentCode` is the whole tax boundary.** A tenant or country-pack code
 *   Compensation stores and never reads. Whether a housing allowance is taxable is a jurisdictional
 *   question whose answer differs by country and by contract; deciding it here would put a tax rule
 *   inside a generic module. This is the discipline `paidTreatmentCode` follows in Leave and
 *   `overtimeCandidateMinutes` in Attendance.
 * - **`proratable` is a flag, not arithmetic.** Compensation states whether Payroll *may* prorate a
 *   component; how a mid-period change is prorated — by calendar days, working days or a statutory
 *   formula — is Payroll's and its country pack's.
 * - **`statutorySourceCode` is null for a tenant-defined component** and set by a country pack. It
 *   is how a screen can say "this exists because the law requires it" without any code branching on
 *   which law.
 *
 * **Immutable once published**: a compensation record names the component version it was created
 * under, and a component edited in June would restate what March meant.
 */

export interface CompensationComponentState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: ComponentKind;
  readonly calculationBasis: CalculationBasis;
  readonly basisComponentId?: string;
  /** Integer basis points — 40% is 4000. Never a float. */
  readonly percentageBasisPoints?: number;
  readonly roundingMode: RoundingMode;
  readonly recurrence: Recurrence;
  readonly payrollTreatmentCode: string;
  readonly proratable: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly statutorySourceCode?: string;
  readonly status: DefinitionStatus;
  readonly versionNumber: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineCompensationComponent {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly kind: string;
  readonly calculationBasis: string;
  readonly basisComponentId?: string;
  readonly percentageBasisPoints?: number;
  readonly roundingMode: string;
  readonly recurrence?: string;
  readonly payrollTreatmentCode: string;
  readonly proratable?: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly statutorySourceCode?: string;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

export class CompensationComponent extends CompensationAggregate {
  private constructor(private state: CompensationComponentState) {
    super(state.id, state.tenantId, state.version, 'CompensationComponent');
  }

  public static define(
    request: DefineCompensationComponent,
    occurredAt: Date,
  ): CompensationResult<CompensationComponent> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const calculation = checkedCalculation(request);

    if (!calculation.ok) return calculation;

    const codes = checkedCodes(request);

    if (!codes.ok) return codes;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new CompensationComponent({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        ...identity.value,
        ...calculation.value,
        ...codes.value,
        proratable: request.proratable ?? true,
        ...definedOnly({ eligibilityRule: request.eligibilityRule }),
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: CompensationComponentState): CompensationComponent {
    return new CompensationComponent(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public publish(by: string, at: Date): CompensationResult<CompensationComponentState> {
    if (this.state.status !== 'draft') return refuse('component_not_draft');

    this.state = { ...this.state, status: 'published', publishedAt: at, publishedBy: by };
    return accept(this.state);
  }

  public supersede(): CompensationResult<CompensationComponentState> {
    if (this.state.status !== 'published') return refuse('component_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state);
  }

  public snapshot(): CompensationComponentState {
    return this.state;
  }
}

const checkedIdentity = (
  request: DefineCompensationComponent,
): CompensationResult<{
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: ComponentKind;
  readonly recurrence: Recurrence;
}> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  if (!isComponentKind(request.kind))
    return refuse('component_kind_unknown', { kind: request.kind });

  const recurrence = request.recurrence ?? (request.kind === 'one_time' ? 'one_time' : 'recurring');

  if (!isRecurrence(recurrence)) return refuse('recurrence_unknown', { recurrence });
  // A one-time component that claims to recur, or a base salary that claims not to, is a
  // contradiction a later reader would have to guess at.
  if ((request.kind === 'one_time') !== (recurrence === 'one_time')) {
    return refuse('component_recurrence_disagrees_with_kind', { kind: request.kind });
  }
  return accept({ code: code.value, name: name.value, kind: request.kind, recurrence });
};

/**
 * The calculation basis, and the two fields that must accompany a percentage.
 *
 * A percentage names *what it is a percentage of* and *how much*, or it is not a percentage. A fixed
 * amount carries neither. The database enforces the same pairing, so a row that reached it another
 * way would still be refused.
 */
const checkedCalculation = (
  request: DefineCompensationComponent,
): CompensationResult<{
  readonly calculationBasis: CalculationBasis;
  readonly basisComponentId?: string;
  readonly percentageBasisPoints?: number;
  readonly roundingMode: RoundingMode;
}> => {
  if (!isCalculationBasis(request.calculationBasis)) {
    return refuse('calculation_basis_unknown', { calculationBasis: request.calculationBasis });
  }
  // Rounding is stated, never defaulted. `Money.multipliedBy` has no default mode, and a component
  // that did not say how it rounds would be resolved differently by whoever guessed first.
  if (!isRoundingMode(request.roundingMode)) {
    return refuse('rounding_mode_unknown', { roundingMode: request.roundingMode });
  }

  const pairing = checkedPairing(request);

  if (!pairing.ok) return pairing;

  return accept({
    calculationBasis: request.calculationBasis,
    roundingMode: request.roundingMode,
    ...definedOnly({
      basisComponentId: request.basisComponentId,
      percentageBasisPoints: request.percentageBasisPoints,
    }),
  });
};

/**
 * A percentage names *what it is a percentage of* and *how much*, or it is not a percentage.
 *
 * A fixed amount carries neither. The database enforces the same pairing, so a row that reached it
 * another way would still be refused.
 */
const checkedPairing = (request: DefineCompensationComponent): CompensationResult<void> => {
  const percentage = request.calculationBasis === 'percentage_of_component';
  const hasBasis = request.basisComponentId !== undefined;
  const hasPoints = request.percentageBasisPoints !== undefined;

  if (percentage && !(hasBasis && hasPoints)) return refuse('percentage_requires_a_basis');
  if (!percentage && (hasBasis || hasPoints)) return refuse('fixed_amount_takes_no_basis');
  if (!plausibleBasisPoints(request.percentageBasisPoints)) {
    return refuse('basis_points_out_of_range', { field: 'percentageBasisPoints' });
  }
  return accept(undefined);
};

const plausibleBasisPoints = (value: number | undefined): boolean =>
  value === undefined || (Number.isInteger(value) && value >= 0 && value <= MAX_BASIS_POINTS);

const checkedCodes = (
  request: DefineCompensationComponent,
): CompensationResult<{
  readonly payrollTreatmentCode: string;
  readonly statutorySourceCode?: string;
}> => {
  const treatment = checkedCode(request.payrollTreatmentCode, 'payrollTreatmentCode');

  if (!treatment.ok) return treatment;

  const statutory = checkedOptionalCode(request.statutorySourceCode, 'statutorySourceCode');

  if (!statutory.ok) return statutory;

  return accept({
    payrollTreatmentCode: treatment.value,
    ...definedOnly({ statutorySourceCode: statutory.value }),
  });
};

/** One link in a component's percentage chain: which component it takes its basis from. */
export interface BasisLink {
  readonly id: string;
  readonly basisComponentId?: string;
}

/**
 * Whether a component's percentage chain returns to itself.
 *
 * A self-referential allowance — 40% of a component that is 10% of it — has no value and would loop
 * at resolution. Refused at *definition* time so the configuration cannot be saved, rather than
 * discovered when somebody's payslip is being assembled.
 *
 * Walks the chain rather than recursing, and bounds the walk by the number of components, so a
 * cycle introduced some other way still terminates.
 */
export const chainIsCircular = (candidate: BasisLink, existing: readonly BasisLink[]): boolean => {
  const byId = new Map(existing.map((link) => [link.id, link]));
  const seen = new Set<string>([candidate.id]);
  let next = candidate.basisComponentId;

  while (next !== undefined) {
    if (seen.has(next)) return true;
    seen.add(next);
    next = byId.get(next)?.basisComponentId;
  }
  return false;
};
