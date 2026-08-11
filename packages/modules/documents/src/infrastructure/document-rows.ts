import type { AccessEventState } from '../domain/access-event.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import type { LocalizedName } from '../domain/document-type.js';
import type { VerificationDecisionState } from '../domain/verification.js';
import type {
  AccessAction,
  Confidentiality,
  DocumentSource,
  DocumentStatus,
  OwnerType,
  VerificationState,
} from '../domain/documents-vocabulary.js';
import { asBigInt, asNumber, orNull, orUndefined, type RowValues } from './row-writer.js';

/**
 * Rows to state and back.
 *
 * Two conventions carry through every mapper here. **`version` never appears in a values map** —
 * `auditForInsert` writes it on insert and `Repository.updateRow` appends `version = version + 1`,
 * so including it produces "multiple assignments to same column", which is the defect Phase 10
 * found the hard way. And **`size_in_bytes` round-trips as a string**: `bigint` arrives from the
 * driver as text and is parsed with `BigInt`, never `Number`, because a file can exceed what a
 * double represents exactly.
 *
 * Civil dates are read from `to_char(...)` aliases rather than `date` columns — the driver would
 * otherwise turn a date into a `Date` at the process's local midnight, which on a server west of
 * UTC reports a valid passport as expired.
 */

export interface DocumentTypeRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly owner_types: string[];
  readonly expires: boolean;
  readonly requires_verification: boolean;
  readonly confidentiality: string;
  readonly employee_visible: boolean;
  readonly manager_visible: boolean;
  readonly retention_policy_code: string | null;
  readonly notice_days: number[];
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | null;
  readonly active: boolean;
  readonly version: number;
}

export const documentTypeState = (row: DocumentTypeRow): DocumentTypeState => ({
  documentTypeId: row.id,
  code: row.code,
  name: row.name,
  ownerTypes: row.owner_types as readonly OwnerType[],
  expires: row.expires,
  requiresVerification: row.requires_verification,
  confidentiality: row.confidentiality as Confidentiality,
  employeeVisible: row.employee_visible,
  managerVisible: row.manager_visible,
  noticeDays: row.notice_days.map(asNumber),
  active: row.active,
  version: asNumber(row.version),
  ...(row.retention_policy_code === null ? {} : { retentionPolicyCode: row.retention_policy_code }),
  ...(row.country_pack_id === null ? {} : { countryPackId: row.country_pack_id }),
  ...(row.country_pack_version === null
    ? {}
    : { countryPackVersion: asNumber(row.country_pack_version) }),
});

export const documentTypeValues = (state: DocumentTypeState, tenantId: string): RowValues => ({
  id: state.documentTypeId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  owner_types: [...state.ownerTypes],
  expires: state.expires,
  requires_verification: state.requiresVerification,
  confidentiality: state.confidentiality,
  employee_visible: state.employeeVisible,
  manager_visible: state.managerVisible,
  retention_policy_code: orNull(state.retentionPolicyCode),
  notice_days: [...state.noticeDays],
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  active: state.active,
});

export interface DocumentRow {
  readonly id: string;
  readonly document_type_id: string;
  readonly owner_type: string;
  readonly owner_id: string;
  readonly person_identifier_id: string | null;
  readonly title: LocalizedName;
  readonly status: string;
  readonly confidentiality: string;
  readonly issue_date: string | null;
  readonly expiry_date: string | null;
  readonly verification_state: string;
  readonly current_version_id: string | null;
  readonly version_count: number;
  readonly source: string;
  readonly source_reference: string | null;
  readonly legal_hold: boolean;
  readonly legal_hold_reason: string | null;
  readonly retention_policy_code: string | null;
  readonly archived_at: Date | null;
  readonly archived_by: string | null;
  readonly version: number;
}

export const documentState = (row: DocumentRow): DocumentState => ({
  documentId: row.id,
  documentTypeId: row.document_type_id,
  ownerType: row.owner_type as OwnerType,
  ownerId: row.owner_id,
  title: row.title,
  status: row.status as DocumentStatus,
  confidentiality: row.confidentiality as Confidentiality,
  verificationState: row.verification_state as VerificationState,
  versionCount: asNumber(row.version_count),
  source: row.source as DocumentSource,
  legalHold: row.legal_hold,
  version: asNumber(row.version),
  ...(row.person_identifier_id === null ? {} : { personIdentifierId: row.person_identifier_id }),
  ...(row.issue_date === null ? {} : { issueDate: row.issue_date }),
  ...(row.expiry_date === null ? {} : { expiryDate: row.expiry_date }),
  ...(row.current_version_id === null ? {} : { currentVersionId: row.current_version_id }),
  ...(row.source_reference === null ? {} : { sourceReference: row.source_reference }),
  ...(row.legal_hold_reason === null ? {} : { legalHoldReason: row.legal_hold_reason }),
  ...(row.retention_policy_code === null ? {} : { retentionPolicyCode: row.retention_policy_code }),
  ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
  ...(row.archived_by === null ? {} : { archivedBy: row.archived_by }),
});

export const documentValues = (state: DocumentState, tenantId: string): RowValues => ({
  id: state.documentId,
  tenant_id: tenantId,
  document_type_id: state.documentTypeId,
  owner_type: state.ownerType,
  owner_id: state.ownerId,
  person_identifier_id: orNull(state.personIdentifierId),
  title: JSON.stringify(state.title),
  status: state.status,
  confidentiality: state.confidentiality,
  issue_date: orNull(state.issueDate),
  expiry_date: orNull(state.expiryDate),
  verification_state: state.verificationState,
  current_version_id: orNull(state.currentVersionId),
  version_count: state.versionCount,
  source: state.source,
  source_reference: orNull(state.sourceReference),
  legal_hold: state.legalHold,
  legal_hold_reason: orNull(state.legalHoldReason),
  retention_policy_code: orNull(state.retentionPolicyCode),
  archived_at: orNull(state.archivedAt),
  archived_by: orNull(state.archivedBy),
});

export interface DocumentVersionRow {
  readonly id: string;
  readonly document_id: string;
  readonly version_number: number;
  readonly storage_reference: string;
  readonly original_file_name: string;
  readonly declared_media_type: string;
  readonly detected_media_type: string | null;
  readonly size_in_bytes: string;
  readonly content_hash: string;
  readonly hash_algorithm: string;
  readonly hash_verified: boolean;
  readonly source: string;
  readonly verification_state: string;
  readonly superseded_at: Date | null;
  readonly version: number;
}

export const documentVersionState = (row: DocumentVersionRow): DocumentVersionState => ({
  documentVersionId: row.id,
  documentId: row.document_id,
  versionNumber: asNumber(row.version_number),
  storageReference: row.storage_reference,
  originalFileName: row.original_file_name,
  declaredMediaType: row.declared_media_type,
  sizeInBytes: asBigInt(row.size_in_bytes),
  contentHash: row.content_hash,
  hashAlgorithm: row.hash_algorithm,
  hashVerified: row.hash_verified,
  source: row.source as DocumentSource,
  verificationState: row.verification_state as VerificationState,
  version: asNumber(row.version),
  ...(orUndefined(row.detected_media_type) === undefined
    ? {}
    : { detectedMediaType: row.detected_media_type as string }),
  ...(row.superseded_at === null ? {} : { supersededAt: row.superseded_at }),
});

export const documentVersionValues = (
  state: DocumentVersionState,
  tenantId: string,
): RowValues => ({
  id: state.documentVersionId,
  tenant_id: tenantId,
  document_id: state.documentId,
  version_number: state.versionNumber,
  storage_reference: state.storageReference,
  original_file_name: state.originalFileName,
  declared_media_type: state.declaredMediaType,
  detected_media_type: orNull(state.detectedMediaType),
  // A string on the way in: the driver stores a decimal string in a `bigint` column exactly.
  size_in_bytes: state.sizeInBytes.toString(),
  content_hash: state.contentHash,
  hash_algorithm: state.hashAlgorithm,
  hash_verified: state.hashVerified,
  source: state.source,
  verification_state: state.verificationState,
  superseded_at: orNull(state.supersededAt),
});

export interface VerificationRow {
  readonly id: string;
  readonly document_id: string;
  readonly document_version_id: string;
  readonly decision: string;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly reason: string | null;
  readonly version: number;
}

export const verificationState = (row: VerificationRow): VerificationDecisionState => ({
  verificationId: row.id,
  documentId: row.document_id,
  documentVersionId: row.document_version_id,
  decision: row.decision as 'verified' | 'rejected',
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  version: asNumber(row.version),
  ...(row.reason === null ? {} : { reason: row.reason }),
});

export const verificationValues = (
  state: VerificationDecisionState,
  tenantId: string,
): RowValues => ({
  id: state.verificationId,
  tenant_id: tenantId,
  document_id: state.documentId,
  document_version_id: state.documentVersionId,
  decision: state.decision,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  reason: orNull(state.reason),
});

export interface AccessEventRow {
  readonly id: string;
  readonly document_id: string;
  readonly document_version_id: string | null;
  readonly action: string;
  readonly actor: string;
  readonly occurred_at: Date;
  readonly correlation_id: string | null;
  readonly outcome: string;
  readonly version: number;
}

export const accessEventState = (row: AccessEventRow): AccessEventState => ({
  accessEventId: row.id,
  documentId: row.document_id,
  action: row.action as AccessAction,
  actor: row.actor,
  occurredAt: row.occurred_at,
  outcome: row.outcome as 'permitted' | 'refused',
  version: asNumber(row.version),
  ...(row.document_version_id === null ? {} : { documentVersionId: row.document_version_id }),
  ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
});

export const accessEventValues = (state: AccessEventState, tenantId: string): RowValues => ({
  id: state.accessEventId,
  tenant_id: tenantId,
  document_id: state.documentId,
  document_version_id: orNull(state.documentVersionId),
  action: state.action,
  actor: state.actor,
  occurred_at: state.occurredAt,
  correlation_id: orNull(state.correlationId),
  outcome: state.outcome,
});
