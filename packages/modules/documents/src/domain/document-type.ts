import {
  CONFIDENTIALITY_LEVELS,
  RESERVED_OWNER_TYPES,
  isEntityCode,
  isOwnerType,
  type Confidentiality,
  type OwnerType,
} from './documents-vocabulary.js';
import { accept, refuse, type DocumentsResult } from './documents-rejection.js';

/**
 * What a tenant calls a kind of document, and the rules that follow from it.
 *
 * **Nothing statutory and nothing country-specific ships.** Not a passport, not a residency permit,
 * not a work permit — every one of those is a *type a tenant or a country pack defines*, and this
 * product ships none of them (00B, 4.1 AD-002). What ships is the shape of a type and the rules it
 * may declare.
 *
 * Three of those rules are load-bearing:
 *
 * - **`ownerTypes`** is the set a document of this type may attach to, so a passport cannot be
 *   filed against a legal entity and a commercial registration cannot be filed against a person.
 * - **`confidentiality`** is what makes AD-007 true: seeing an employee never implies seeing their
 *   medical or disciplinary attachments. A confidential type is invisible without the specific
 *   permission, and it may not be manager-visible at all.
 * - **`noticeDays`** is the invariant AD-003 states — a type that expires must say when to warn.
 *   The thresholds are configuration and **nothing fires them**: `JobPort` has no adapter, so this
 *   module records when a warning is due and never claims to have sent one (D-26).
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface DocumentTypeState {
  readonly documentTypeId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly ownerTypes: readonly OwnerType[];
  readonly expires: boolean;
  readonly requiresVerification: boolean;
  readonly confidentiality: Confidentiality;
  readonly employeeVisible: boolean;
  readonly managerVisible: boolean;
  readonly retentionPolicyCode?: string;
  readonly noticeDays: readonly number[];
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineDocumentTypeRequest {
  readonly documentTypeId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly ownerTypes: readonly string[];
  readonly expires: boolean;
  readonly requiresVerification: boolean;
  readonly confidentiality: string;
  readonly employeeVisible: boolean;
  readonly managerVisible: boolean;
  readonly retentionPolicyCode?: string;
  readonly noticeDays?: readonly number[];
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}

export const createDocumentType = (
  request: DefineDocumentTypeRequest,
): DocumentsResult<DocumentTypeState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    documentTypeId: request.documentTypeId,
    code: request.code,
    name: request.name,
    ownerTypes: checked.value.ownerTypes,
    expires: request.expires,
    requiresVerification: request.requiresVerification,
    confidentiality: checked.value.confidentiality,
    employeeVisible: request.employeeVisible,
    managerVisible: request.managerVisible,
    noticeDays: checked.value.noticeDays,
    active: true,
    version: 1,
    ...(request.retentionPolicyCode === undefined
      ? {}
      : { retentionPolicyCode: request.retentionPolicyCode }),
    ...(request.countryPackId === undefined ? {} : { countryPackId: request.countryPackId }),
    ...(request.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: request.countryPackVersion }),
  });
};

interface Checked {
  readonly ownerTypes: readonly OwnerType[];
  readonly confidentiality: Confidentiality;
  readonly noticeDays: readonly number[];
}

const validate = (request: DefineDocumentTypeRequest): DocumentsResult<Checked> => {
  if (!isEntityCode(request.code)) return refuse('type_code_malformed', { field: 'code' });
  if (request.name.en.trim() === '' || request.name.ar.trim() === '') {
    // Both languages are required by the domain rather than by a screen. A type named only in
    // English is a dropdown an Arabic-speaking administrator cannot read.
    return refuse('type_name_incomplete', { field: 'name' });
  }

  const owners = ownersOf(request.ownerTypes);

  if (!owners.ok) return owners;

  const confidentiality = confidentialityOf(request.confidentiality);

  if (!confidentiality.ok) return confidentiality;

  const notice = noticeOf(request);

  if (!notice.ok) return notice;
  if (request.managerVisible && confidentiality.value === 'confidential') {
    // A confidential type is one a manager has no business reading. Permitting both would make the
    // classification decorative.
    return refuse('confidential_type_cannot_be_manager_visible', { field: 'managerVisible' });
  }

  return accept({
    ownerTypes: owners.value,
    confidentiality: confidentiality.value,
    noticeDays: notice.value,
  });
};

const ownersOf = (values: readonly string[]): DocumentsResult<readonly OwnerType[]> => {
  if (values.length === 0) return refuse('type_owner_types_empty', { field: 'ownerTypes' });

  const owners: OwnerType[] = [];

  for (const value of values) {
    // `dependent` is refused by name rather than as an unknown value, because the specification
    // names it and this repository models no dependent. The refusal says which, so the gap reads
    // as deliberate rather than as a typo.
    if ((RESERVED_OWNER_TYPES as readonly string[]).includes(value)) {
      return refuse('owner_type_not_available', { field: 'ownerTypes', ownerType: value });
    }
    if (!isOwnerType(value)) {
      return refuse('owner_type_unknown', { field: 'ownerTypes', ownerType: value });
    }
    if (!owners.includes(value)) owners.push(value);
  }
  return accept(owners);
};

const confidentialityOf = (value: string): DocumentsResult<Confidentiality> =>
  (CONFIDENTIALITY_LEVELS as readonly string[]).includes(value)
    ? accept(value as Confidentiality)
    : refuse('confidentiality_unknown', { field: 'confidentiality' });

/**
 * The AD-003 invariant, and the ordering that makes a threshold list readable.
 *
 * Sorted descending so "90, 60, 30, 7" is the order somebody would say them in, and deduplicated
 * because two identical thresholds would mean two identical warnings.
 */
const noticeOf = (request: DefineDocumentTypeRequest): DocumentsResult<readonly number[]> => {
  const days = [...new Set(request.noticeDays ?? [])].sort((one, other) => other - one);

  if (request.expires && days.length === 0) {
    return refuse('expiring_type_needs_notice_days', { field: 'noticeDays' });
  }
  if (!request.expires && days.length > 0) {
    // A threshold on a type that never expires is a warning that can never be due.
    return refuse('notice_days_without_expiry', { field: 'noticeDays' });
  }
  if (days.some((day) => day <= 0 || !Number.isInteger(day))) {
    return refuse('notice_days_invalid', { field: 'noticeDays' });
  }
  return accept(days);
};

/** Whether this type may hold a document for that owner. Checked before an owner is resolved. */
export const permitsOwner = (state: DocumentTypeState, ownerType: OwnerType): boolean =>
  state.ownerTypes.includes(ownerType);
