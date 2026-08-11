import { expiryStateOf, inBothCalendars, noticeThresholdCrossed } from '../domain/expiry.js';
import type { AccessEventState } from '../domain/access-event.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import type { VerificationDecisionState } from '../domain/verification.js';
import type { IdentifierFacts } from './documents-ports.js';
import type {
  AccessEventView,
  DocumentTypeView,
  DocumentVersionView,
  DocumentView,
  DualCalendarView,
  VerificationView,
} from '../contracts/views.js';

/**
 * Turning state into what a caller reads.
 *
 * Assembled here rather than returned raw, so a column rename is not an API change — the shape a
 * consumer depends on is the view, and the row is this module's business.
 *
 * Two things happen in this file that are worth noticing. **Expiry is derived**, not read: the view
 * carries `expiryState` and the notice threshold a document has crossed, computed from the date and
 * today, because nothing scheduled runs to maintain a stored flag (§12 of the plan). And **dates
 * carry both calendars**, derived from the kernel's conversion rather than stored twice — two
 * stored dates are two things that can disagree (D-28).
 *
 * A view never carries a storage reference. That value is this module's internal address for
 * something a caller reaches only through an authorized download.
 */

export interface ExpiryWindowInput {
  readonly today: string;
  readonly noticeDays: readonly number[];
}

const dual = (civilDate: string | undefined): DualCalendarView | undefined => {
  if (civilDate === undefined) return undefined;

  const both = inBothCalendars(civilDate);

  return both.ok
    ? {
        gregorian: both.value.gregorian,
        hijri: `${String(both.value.hijri.year)}-${pad(both.value.hijri.month)}-${pad(both.value.hijri.day)}`,
      }
    : undefined;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const documentTypeView = (state: DocumentTypeState): DocumentTypeView => ({
  documentTypeId: state.documentTypeId,
  code: state.code,
  name: state.name,
  ownerTypes: state.ownerTypes,
  expires: state.expires,
  requiresVerification: state.requiresVerification,
  confidentiality: state.confidentiality,
  employeeVisible: state.employeeVisible,
  managerVisible: state.managerVisible,
  noticeDays: state.noticeDays,
  active: state.active,
  version: state.version,
  ...present({
    retentionPolicyCode: state.retentionPolicyCode,
    countryPackId: state.countryPackId,
    countryPackVersion: state.countryPackVersion,
  }),
});

export const documentView = (
  state: DocumentState,
  window: ExpiryWindowInput,
  identifier?: IdentifierFacts,
): DocumentView => {
  // The D-1a boundary, visible in the view. Where People owns the expiry, the view reports
  // People's date and says so; this module's own `expiryDate` is absent on such a document.
  const effectiveExpiry = state.expiryDate ?? identifier?.expiresOn;
  const issued = dual(state.issueDate ?? identifier?.issuedOn);
  const expires = dual(effectiveExpiry);
  const threshold = noticeThresholdCrossed(effectiveExpiry, window);

  return {
    documentId: state.documentId,
    documentTypeId: state.documentTypeId,
    ownerType: state.ownerType,
    ownerId: state.ownerId,
    title: state.title,
    status: state.status,
    confidentiality: state.confidentiality,
    verificationState: state.verificationState,
    versionCount: state.versionCount,
    source: state.source,
    legalHold: state.legalHold,
    expiryState: expiryStateOf(effectiveExpiry, window),
    expiryOwnedByPeople: state.personIdentifierId !== undefined,
    version: state.version,
    ...present({
      personIdentifierId: state.personIdentifierId,
      currentVersionId: state.currentVersionId,
      issueDate: issued,
      expiryDate: expires,
      noticeThresholdCrossed: threshold,
      retentionPolicyCode: state.retentionPolicyCode,
      legalHoldReason: state.legalHoldReason,
      archivedAt: state.archivedAt,
    }),
  };
};

/**
 * The optional half of a view, with the absent members dropped.
 *
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", and a
 * view that carried `expiryDate: undefined` would serialize a null nobody meant. Dropping them once
 * here beats a conditional spread per field.
 */
type Defined<TShape> = { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> };

const present = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  ) as Defined<TShape>;

/**
 * A version, without its storage reference.
 *
 * The reference is how this module addresses the bytes and is not a caller's business: a consumer
 * that held one could try to resolve it themselves, which is the direct-object-reference problem
 * the download authorization exists to prevent.
 */
export const documentVersionView = (state: DocumentVersionState): DocumentVersionView => ({
  documentVersionId: state.documentVersionId,
  documentId: state.documentId,
  versionNumber: state.versionNumber,
  originalFileName: state.originalFileName,
  declaredMediaType: state.declaredMediaType,
  sizeInBytes: state.sizeInBytes.toString(),
  contentHash: state.contentHash,
  hashAlgorithm: state.hashAlgorithm,
  hashVerified: state.hashVerified,
  source: state.source,
  verificationState: state.verificationState,
  ...present({
    detectedMediaType: state.detectedMediaType,
    supersededAt: state.supersededAt,
  }),
});

export const verificationView = (state: VerificationDecisionState): VerificationView => ({
  verificationId: state.verificationId,
  documentId: state.documentId,
  documentVersionId: state.documentVersionId,
  decision: state.decision,
  decidedBy: state.decidedBy,
  decidedAt: state.decidedAt,
  ...(state.reason === undefined ? {} : { reason: state.reason }),
});

export const accessEventView = (state: AccessEventState): AccessEventView => ({
  accessEventId: state.accessEventId,
  documentId: state.documentId,
  action: state.action,
  actor: state.actor,
  occurredAt: state.occurredAt,
  outcome: state.outcome,
  ...present({
    documentVersionId: state.documentVersionId,
    correlationId: state.correlationId,
  }),
});
