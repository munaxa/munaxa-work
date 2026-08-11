import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type {
  IssuedLetterState,
  LetterRequestState,
  ResolvedValues,
  SourceVersions,
} from '../domain/letter-generation.js';
import type {
  LetterTemplateState,
  LetterTemplateVersionState,
  LocalizedBody,
} from '../domain/letter-template.js';
import type {
  ApprovalDecision,
  ExposableField,
  LetterStatus,
  Locale,
  SignatureState,
  TemplateStatus,
} from '../domain/letters-vocabulary.js';
import { asNumber, orNull, type RowValues } from './row-writer.js';

/**
 * Rows to state and back.
 *
 * The convention that carries through every mapper here: **`version` never appears in a values
 * map** — `auditForInsert` writes it on insert and `Repository.updateRow` appends
 * `version = version + 1`, so including it produces "multiple assignments to same column", which is
 * the defect Phase 10 found the hard way.
 *
 * `substituted_values` and `source_versions` are `jsonb` and are what make an issued letter
 * reproducible. They are stringified on the way in and read straight back — nothing reshapes them,
 * because a letter's snapshot must round-trip exactly or it is not a snapshot.
 */

export interface LetterTemplateRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedBody;
  readonly category: string;
  readonly requires_approval: boolean;
  readonly employee_requestable: boolean;
  readonly current_version_id: string | null;
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | null;
  readonly active: boolean;
  readonly version: number;
}

export const templateState = (row: LetterTemplateRow): LetterTemplateState => ({
  letterTemplateId: row.id,
  code: row.code,
  name: row.name,
  category: row.category,
  requiresApproval: row.requires_approval,
  employeeRequestable: row.employee_requestable,
  active: row.active,
  version: asNumber(row.version),
  ...(row.current_version_id === null ? {} : { currentVersionId: row.current_version_id }),
  ...(row.country_pack_id === null ? {} : { countryPackId: row.country_pack_id }),
  ...(row.country_pack_version === null
    ? {}
    : { countryPackVersion: asNumber(row.country_pack_version) }),
});

export const templateValues = (state: LetterTemplateState, tenantId: string): RowValues => ({
  id: state.letterTemplateId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  category: state.category,
  requires_approval: state.requiresApproval,
  employee_requestable: state.employeeRequestable,
  current_version_id: orNull(state.currentVersionId),
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  active: state.active,
});

export interface LetterTemplateVersionRow {
  readonly id: string;
  readonly letter_template_id: string;
  readonly version_number: number;
  readonly body: LocalizedBody;
  readonly variables: string[];
  readonly exposed_fields: string[];
  readonly letterhead_reference: string | null;
  readonly requires_signature: boolean;
  readonly status: string;
  readonly first_issued_at: Date | null;
  readonly version: number;
}

export const templateVersionState = (
  row: LetterTemplateVersionRow,
): LetterTemplateVersionState => ({
  letterTemplateVersionId: row.id,
  letterTemplateId: row.letter_template_id,
  versionNumber: asNumber(row.version_number),
  body: row.body,
  variables: row.variables,
  exposedFields: row.exposed_fields as readonly ExposableField[],
  requiresSignature: row.requires_signature,
  status: row.status as TemplateStatus,
  version: asNumber(row.version),
  ...(row.letterhead_reference === null ? {} : { letterheadReference: row.letterhead_reference }),
  ...(row.first_issued_at === null ? {} : { firstIssuedAt: row.first_issued_at }),
});

export const templateVersionValues = (
  state: LetterTemplateVersionState,
  tenantId: string,
): RowValues => ({
  id: state.letterTemplateVersionId,
  tenant_id: tenantId,
  letter_template_id: state.letterTemplateId,
  version_number: state.versionNumber,
  body: JSON.stringify(state.body),
  variables: [...state.variables],
  exposed_fields: [...state.exposedFields],
  letterhead_reference: orNull(state.letterheadReference),
  requires_signature: state.requiresSignature,
  status: state.status,
  first_issued_at: orNull(state.firstIssuedAt),
});

export interface LetterRequestRow {
  readonly id: string;
  readonly letter_template_id: string;
  readonly letter_template_version_id: string;
  readonly employment_id: string;
  readonly person_id: string;
  readonly locale: string;
  readonly purpose: string | null;
  readonly addressee: string | null;
  readonly status: string;
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly failure_reason: string | null;
  readonly version: number;
}

export const requestState = (row: LetterRequestRow): LetterRequestState => ({
  letterRequestId: row.id,
  letterTemplateId: row.letter_template_id,
  letterTemplateVersionId: row.letter_template_version_id,
  employmentId: row.employment_id,
  personId: row.person_id,
  locale: row.locale as Locale,
  status: row.status as LetterStatus,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  version: asNumber(row.version),
  ...(row.purpose === null ? {} : { purpose: row.purpose }),
  ...(row.addressee === null ? {} : { addressee: row.addressee }),
  ...(row.failure_reason === null ? {} : { failureReason: row.failure_reason }),
});

export const requestValues = (state: LetterRequestState, tenantId: string): RowValues => ({
  id: state.letterRequestId,
  tenant_id: tenantId,
  letter_template_id: state.letterTemplateId,
  letter_template_version_id: state.letterTemplateVersionId,
  employment_id: state.employmentId,
  person_id: state.personId,
  locale: state.locale,
  purpose: orNull(state.purpose),
  addressee: orNull(state.addressee),
  status: state.status,
  requested_by: state.requestedBy,
  requested_at: state.requestedAt,
  failure_reason: orNull(state.failureReason),
});

export interface IssuedLetterRow {
  readonly id: string;
  readonly letter_request_id: string;
  readonly letter_template_id: string;
  readonly letter_template_version_id: string;
  readonly employment_id: string;
  readonly person_id: string;
  readonly reference_number: string;
  readonly verification_token: string;
  readonly locale: string;
  readonly substituted_values: ResolvedValues;
  readonly source_versions: SourceVersions;
  readonly issued_at: Date;
  readonly issued_by: string;
  readonly signatory: string | null;
  readonly signature_required: boolean;
  readonly signature_state: string;
  readonly document_id: string | null;
  readonly superseded_by_id: string | null;
  readonly superseded_at: Date | null;
  readonly version: number;
}

export const issuedLetterState = (row: IssuedLetterRow): IssuedLetterState => ({
  issuedLetterId: row.id,
  letterRequestId: row.letter_request_id,
  letterTemplateId: row.letter_template_id,
  letterTemplateVersionId: row.letter_template_version_id,
  employmentId: row.employment_id,
  personId: row.person_id,
  referenceNumber: row.reference_number,
  verificationToken: row.verification_token,
  locale: row.locale as Locale,
  substitutedValues: row.substituted_values,
  sourceVersions: row.source_versions,
  issuedAt: row.issued_at,
  issuedBy: row.issued_by,
  signatureRequired: row.signature_required,
  signatureState: row.signature_state as SignatureState,
  version: asNumber(row.version),
  ...(row.signatory === null ? {} : { signatory: row.signatory }),
  // Absent on every row today: no renderer exists in this repository (D-15).
  ...(row.document_id === null ? {} : { documentId: row.document_id }),
  ...(row.superseded_by_id === null ? {} : { supersededById: row.superseded_by_id }),
  ...(row.superseded_at === null ? {} : { supersededAt: row.superseded_at }),
});

export const issuedLetterValues = (state: IssuedLetterState, tenantId: string): RowValues => ({
  id: state.issuedLetterId,
  tenant_id: tenantId,
  letter_request_id: state.letterRequestId,
  letter_template_id: state.letterTemplateId,
  letter_template_version_id: state.letterTemplateVersionId,
  employment_id: state.employmentId,
  person_id: state.personId,
  reference_number: state.referenceNumber,
  verification_token: state.verificationToken,
  locale: state.locale,
  substituted_values: JSON.stringify(state.substitutedValues),
  source_versions: JSON.stringify(state.sourceVersions),
  issued_at: state.issuedAt,
  issued_by: state.issuedBy,
  signatory: orNull(state.signatory),
  signature_required: state.signatureRequired,
  signature_state: state.signatureState,
  document_id: orNull(state.documentId),
  superseded_by_id: orNull(state.supersededById),
  superseded_at: orNull(state.supersededAt),
});

export interface ApprovalDecisionRow {
  readonly id: string;
  readonly letter_request_id: string;
  readonly sequence: number;
  readonly decision: string;
  readonly requested_by: string;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly comment: string | null;
  readonly reverses_id: string | null;
  readonly version: number;
}

export const decisionState = (row: ApprovalDecisionRow): ApprovalDecisionState => ({
  approvalDecisionId: row.id,
  letterRequestId: row.letter_request_id,
  sequence: asNumber(row.sequence),
  decision: row.decision as ApprovalDecision,
  requestedBy: row.requested_by,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  version: asNumber(row.version),
  ...(row.comment === null ? {} : { comment: row.comment }),
  ...(row.reverses_id === null ? {} : { reversesId: row.reverses_id }),
});

export const decisionValues = (state: ApprovalDecisionState, tenantId: string): RowValues => ({
  id: state.approvalDecisionId,
  tenant_id: tenantId,
  letter_request_id: state.letterRequestId,
  sequence: state.sequence,
  decision: state.decision,
  // Copied onto the row so the self-approval check constraint can compare them: a constraint
  // cannot reach another table, which is why Compensation and Payroll both carry it the same way.
  requested_by: state.requestedBy,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  comment: orNull(state.comment),
  reverses_id: orNull(state.reversesId),
});
