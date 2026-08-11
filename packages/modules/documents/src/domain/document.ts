import {
  DOCUMENT_TRANSITIONS,
  VERIFICATION_TRANSITIONS,
  canTransition,
  isCivilDate,
  type Confidentiality,
  type DocumentSource,
  type DocumentStatus,
  type OwnerType,
  type VerificationState,
} from './documents-vocabulary.js';
import { accept, refuse, type DocumentsResult } from './documents-rejection.js';
import { permitsOwner, type DocumentTypeState, type LocalizedName } from './document-type.js';

/**
 * A document: **one stable identity, across every replacement of its file.**
 *
 * The identity never changes when the bytes do. Somebody who renews a passport has one document
 * with two versions, not two documents — which is what makes "show me the current passport" and
 * "show me what we held in March" both answerable, and what stops a renewal quietly orphaning the
 * verification, the expiry and the audit trail attached to the old record.
 *
 * **This aggregate holds no identity data.** `person_identifier` (People, Phase 4) already owns an
 * identifier's number, issuing country, issue date and expiry, with an index built for the expiry
 * query. A document that evidences one carries `personIdentifierId` and nothing else about it, and
 * `expiryDate` stays absent — a check constraint refuses the combination, so there is exactly one
 * authoritative answer to when an identity document expires (D-1a). For everything else — a
 * contract scan, a certificate, a licence — this module's own `expiryDate` is authoritative.
 *
 * `currentVersionId` and `versionCount` are denormalizations of the version table, written in the
 * same transaction as the version they describe. The version table remains authoritative; these
 * exist because every list view needs the current file's name and size, and resolving that per row
 * would be the N+1 the benchmark would find later.
 */

export interface DocumentState {
  readonly documentId: string;
  readonly documentTypeId: string;
  readonly ownerType: OwnerType;
  readonly ownerId: string;
  /** Set only where this document evidences an identifier People owns. Never a copy of its data. */
  readonly personIdentifierId?: string;
  readonly title: LocalizedName;
  readonly status: DocumentStatus;
  readonly confidentiality: Confidentiality;
  readonly issueDate?: string;
  readonly expiryDate?: string;
  readonly verificationState: VerificationState;
  readonly currentVersionId?: string;
  readonly versionCount: number;
  readonly source: DocumentSource;
  readonly sourceReference?: string;
  readonly legalHold: boolean;
  readonly legalHoldReason?: string;
  readonly retentionPolicyCode?: string;
  readonly archivedAt?: Date;
  readonly archivedBy?: string;
  readonly version: number;
}

export interface CreateDocumentRequest {
  readonly documentId: string;
  readonly type: DocumentTypeState;
  readonly ownerType: OwnerType;
  readonly ownerId: string;
  readonly personIdentifierId?: string;
  readonly title: LocalizedName;
  readonly issueDate?: string;
  readonly expiryDate?: string;
  readonly source: DocumentSource;
  readonly sourceReference?: string;
}

/**
 * A new document, in `draft` and `unverified`.
 *
 * **Draft, not active**: a document with no version is a record of intent, and calling it active
 * would let a mandatory-document check count it. **Unverified**, always — uploading is not
 * verifying, and there is no argument by which creating a record could establish that somebody
 * checked it.
 *
 * The confidentiality comes from the *type*, never from the caller. A caller who could mark their
 * own upload `normal` could file a medical certificate where colleagues can read it.
 */
export const createDocument = (request: CreateDocumentRequest): DocumentsResult<DocumentState> => {
  if (!permitsOwner(request.type, request.ownerType)) {
    return refuse('owner_type_not_permitted_for_type', {
      field: 'ownerType',
      ownerType: request.ownerType,
      code: request.type.code,
    });
  }
  if (request.title.en.trim() === '' || request.title.ar.trim() === '') {
    return refuse('title_incomplete', { field: 'title' });
  }

  const dates = checkedDates(request);

  if (!dates.ok) return dates;

  return accept({
    documentId: request.documentId,
    documentTypeId: request.type.documentTypeId,
    ownerType: request.ownerType,
    ownerId: request.ownerId,
    title: request.title,
    status: 'draft',
    confidentiality: request.type.confidentiality,
    verificationState: 'unverified',
    versionCount: 0,
    source: request.source,
    legalHold: false,
    version: 1,
    ...(request.personIdentifierId === undefined
      ? {}
      : { personIdentifierId: request.personIdentifierId }),
    ...(request.issueDate === undefined ? {} : { issueDate: request.issueDate }),
    ...(dates.value === undefined ? {} : { expiryDate: dates.value }),
    ...(request.sourceReference === undefined ? {} : { sourceReference: request.sourceReference }),
    ...(request.type.retentionPolicyCode === undefined
      ? {}
      : { retentionPolicyCode: request.type.retentionPolicyCode }),
  });
};

/**
 * The date rules, including the half of D-1a a domain can express.
 *
 * A document that points at a People identifier carries no expiry of its own. The database refuses
 * the combination too; this refuses it first, with a reason a caller can read.
 */
const checkedDates = (request: CreateDocumentRequest): DocumentsResult<string | undefined> => {
  const shapes = checkedShapes(request);

  if (!shapes.ok) return shapes;

  if (request.personIdentifierId !== undefined && request.expiryDate !== undefined) {
    return refuse('identifier_document_holds_no_expiry', { field: 'expiryDate' });
  }
  if (request.expiryDate !== undefined && !request.type.expires) {
    return refuse('type_does_not_expire', { field: 'expiryDate', code: request.type.code });
  }
  if (
    request.expiryDate !== undefined &&
    request.issueDate !== undefined &&
    request.expiryDate < request.issueDate
  ) {
    return refuse('expiry_before_issue', { field: 'expiryDate' });
  }
  return accept(request.expiryDate);
};

/** Both civil dates, checked for shape before anything compares them. */
const checkedShapes = (request: CreateDocumentRequest): DocumentsResult<'well_formed'> => {
  for (const [field, value] of [
    ['issueDate', request.issueDate],
    ['expiryDate', request.expiryDate],
  ] as const) {
    if (value !== undefined && !isCivilDate(value)) return refuse('date_malformed', { field });
  }
  return accept('well_formed');
};

export const moveDocumentTo = (
  state: DocumentState,
  status: DocumentStatus,
  moment: Date,
  actor: string,
): DocumentsResult<DocumentState> => {
  if (state.status === status) return refuse('document_already_in_status', { status });
  if (!canTransition(DOCUMENT_TRANSITIONS, state.status, status)) {
    return refuse('document_transition_not_permitted', { from: state.status, to: status });
  }
  // A legal hold outranks every lifecycle move that hides a document. Archiving one under hold
  // would be a quiet way to make it stop appearing in the searches a hold exists to guarantee.
  if (state.legalHold && status === 'archived') {
    return refuse('document_under_legal_hold', { status });
  }

  // The archive stamp is *removed* rather than set to `undefined` on restore: with
  // `exactOptionalPropertyTypes`, an explicit `undefined` is not the same as an absent key, and a
  // restored document should carry no trace of having been archived.
  const { archivedAt: _at, archivedBy: _by, ...rest } = state;

  return accept(
    status === 'archived'
      ? { ...rest, status, version: state.version + 1, archivedAt: moment, archivedBy: actor }
      : { ...rest, status, version: state.version + 1 },
  );
};

/**
 * Recording a new version against the document.
 *
 * **The verification state falls back**, and that is the point of attaching verification to a
 * version. A document verified in March whose file is replaced in June is not verified: somebody
 * checked different bytes. Returning it to `pending_verification` rather than `unverified` says
 * the document is still expected to be checked, which is what a verification queue reads.
 */
export const versionAdded = (
  state: DocumentState,
  versionId: string,
  requiresVerification: boolean,
): DocumentState => ({
  ...state,
  currentVersionId: versionId,
  versionCount: state.versionCount + 1,
  status: state.status === 'draft' ? 'active' : state.status,
  verificationState: requiresVerification ? 'pending_verification' : state.verificationState,
  version: state.version + 1,
});

export const verificationRecorded = (
  state: DocumentState,
  decision: VerificationState,
): DocumentsResult<DocumentState> => {
  if (!canTransition(VERIFICATION_TRANSITIONS, state.verificationState, decision)) {
    return refuse('verification_transition_not_permitted', {
      from: state.verificationState,
      to: decision,
    });
  }
  return accept({ ...state, verificationState: decision, version: state.version + 1 });
};

/**
 * A legal hold, and the one thing it guarantees: nothing goes away while it is on.
 *
 * The reason is required. A hold nobody can explain is a hold nobody can lift, and this module
 * cannot tell whether one is still needed.
 */
export const legalHoldPlaced = (
  state: DocumentState,
  reason: string,
): DocumentsResult<DocumentState> => {
  if (reason.trim() === '') return refuse('legal_hold_needs_reason', { field: 'reason' });
  if (state.legalHold) return refuse('document_already_under_legal_hold');
  return accept({ ...state, legalHold: true, legalHoldReason: reason, version: state.version + 1 });
};

export const legalHoldLifted = (state: DocumentState): DocumentsResult<DocumentState> => {
  if (!state.legalHold) return refuse('document_not_under_legal_hold');

  const { legalHoldReason: _reason, ...rest } = state;

  return accept({ ...rest, legalHold: false, version: state.version + 1 });
};

/**
 * Whether this document may be removed at all.
 *
 * Three refusals, and each is a rule the brief states plainly: a legal hold refuses everything, a
 * verified document is not deletable by an ordinary path, and neither is one that has ever held a
 * file. What remains deletable is a draft nobody ever attached anything to — a mistake, not a
 * record.
 */
export const deletionEligibility = (state: DocumentState): DocumentsResult<'eligible'> => {
  if (state.legalHold) return refuse('document_under_legal_hold');
  if (state.verificationState === 'verified') return refuse('verified_document_not_deletable');
  if (state.versionCount > 0) return refuse('document_with_versions_not_deletable');
  return accept('eligible');
};
