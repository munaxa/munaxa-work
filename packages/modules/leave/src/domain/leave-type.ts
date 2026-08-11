import { uuidV7 } from '@work/kernel';

import {
  LeaveAggregate,
  bilingualFrom,
  checkedCode,
  checkedMetadata,
  checkedOptionalCode,
  type BilingualInput,
  type BilingualText,
  type Metadata,
} from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { LEAVE_UNITS, type DefinitionStatus, type LeaveUnit } from './leave-vocabulary.js';

/**
 * A kind of leave a tenant offers.
 *
 * **Nothing is seeded.** There is no annual leave here, no sick leave, no maternity, no Hajj and no
 * bereavement. Every one of those appears in the phase specification as an *example of what a
 * tenant or a country pack may define*, and a product that shipped them would be asserting that
 * every customer in every market wants the same set — which is the assumption 00B exists to
 * prevent. A tenant that has configured no leave types gets a screen that says so.
 *
 * Four fields are codes rather than enumerations, and each is a boundary:
 *
 * - **`paidTreatmentCode`** is stored and never interpreted. Whether "half pay" means half of base
 *   or half of gross is a payroll question whose answer differs by jurisdiction and by contract;
 *   deciding it here would put a compensation rule inside a leave module (§21).
 * - **`genderRestriction`** is a code, not an enumeration. Maternity and Iddah leave exist in this
 *   product's markets without this product enumerating them, and a closed set would have to be
 *   extended by a release every time a jurisdiction recognised a distinction it had not.
 * - **`statutorySourceCode`** is null for a tenant-defined type and set by a country pack. It is how
 *   a screen can say "this type exists because the law requires it" without any code branching on
 *   which law.
 * - **`code`** is the tenant's own or the pack's, never one this product ships.
 *
 * **Immutable once published**, like every definition in this product: entitlements and requests
 * name the type they were created under, and a type edited in June would rewrite what March meant.
 */

export interface LeaveTypeState {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly unit: LeaveUnit;
  readonly paidTreatmentCode: string;
  /** Whether the type has entitlement at all. Unpaid leave typically does not. */
  readonly accrues: boolean;
  readonly requiresAttachment: boolean;
  readonly requiresReplacement: boolean;
  readonly requiresContact: boolean;
  readonly requiresAddress: boolean;
  readonly genderRestriction?: string;
  readonly statutorySourceCode?: string;
  readonly status: DefinitionStatus;
  readonly versionNumber: number;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface DefineLeaveType {
  readonly tenantId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly unit: string;
  readonly paidTreatmentCode: string;
  readonly accrues?: boolean;
  readonly requiresAttachment?: boolean;
  readonly requiresReplacement?: boolean;
  readonly requiresContact?: boolean;
  readonly requiresAddress?: boolean;
  readonly genderRestriction?: string;
  readonly statutorySourceCode?: string;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

export class LeaveType extends LeaveAggregate {
  private constructor(private state: LeaveTypeState) {
    super(state.id, state.tenantId, state.version, 'LeaveType');
  }

  public static define(request: DefineLeaveType, occurredAt: Date): LeaveResult<LeaveType> {
    const identity = checkedIdentity(request);

    if (!identity.ok) return identity;

    const codes = checkedCodes(request);

    if (!codes.ok) return codes;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    return accept(
      new LeaveType({
        id: uuidV7(occurredAt.getTime()),
        tenantId: request.tenantId,
        ...identity.value,
        ...codes.value,
        accrues: request.accrues ?? true,
        requiresAttachment: request.requiresAttachment ?? false,
        requiresReplacement: request.requiresReplacement ?? false,
        requiresContact: request.requiresContact ?? false,
        requiresAddress: request.requiresAddress ?? false,
        status: 'draft',
        versionNumber: request.versionNumber ?? 1,
        metadata: metadata.value,
        version: 0,
      }),
    );
  }

  public static rehydrate(state: LeaveTypeState): LeaveType {
    return new LeaveType(state);
  }

  public get status(): DefinitionStatus {
    return this.state.status;
  }

  public get code(): string {
    return this.state.code;
  }

  /**
   * Freezes the type.
   *
   * Separate from drafting it, and behind a separate permission, because a published type is what
   * every policy, every entitlement and every request in the tenant will reference by identity.
   */
  public publish(by: string, at: Date): LeaveResult<LeaveTypeState> {
    if (this.state.status !== 'draft') return refuse('leave_type_not_draft');

    this.state = { ...this.state, status: 'published', publishedAt: at, publishedBy: by };
    return accept(this.state);
  }

  /** Retiring a type. The rows that reference it keep referencing it; nothing is rewritten. */
  public supersede(): LeaveResult<LeaveTypeState> {
    if (this.state.status !== 'published') return refuse('leave_type_not_published');

    this.state = { ...this.state, status: 'superseded' };
    return accept(this.state);
  }

  public snapshot(): LeaveTypeState {
    return this.state;
  }
}

const checkedIdentity = (
  request: DefineLeaveType,
): LeaveResult<{
  readonly code: string;
  readonly name: BilingualText;
  readonly unit: LeaveUnit;
}> => {
  const code = checkedCode(request.code, 'code');

  if (!code.ok) return code;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  if (!isLeaveUnit(request.unit)) return refuse('leave_unit_unknown', { unit: request.unit });

  return accept({ code: code.value, name: name.value, unit: request.unit });
};

/**
 * The three optional codes, checked for shape and never for membership.
 *
 * A gender restriction of `expectant-mother` and one of `widow-in-iddah` are equally valid here,
 * and neither is a word this product ships.
 */
const checkedCodes = (
  request: DefineLeaveType,
): LeaveResult<{
  readonly paidTreatmentCode: string;
  readonly genderRestriction?: string;
  readonly statutorySourceCode?: string;
}> => {
  const paid = checkedCode(request.paidTreatmentCode, 'paidTreatmentCode');

  if (!paid.ok) return paid;

  const gender = checkedOptionalCode(request.genderRestriction, 'genderRestriction');

  if (!gender.ok) return gender;

  const statutory = checkedOptionalCode(request.statutorySourceCode, 'statutorySourceCode');

  if (!statutory.ok) return statutory;

  return accept({
    paidTreatmentCode: paid.value,
    ...(gender.value === undefined ? {} : { genderRestriction: gender.value }),
    ...(statutory.value === undefined ? {} : { statutorySourceCode: statutory.value }),
  });
};

const isLeaveUnit = (value: string): value is LeaveUnit =>
  (LEAVE_UNITS as readonly string[]).includes(value);
