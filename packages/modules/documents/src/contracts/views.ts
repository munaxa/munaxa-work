/**
 * What Documents publishes.
 *
 * Every consumer — the admin workspace, Letters, and whatever later reads an employee's file —
 * depends on these shapes and never on a row. Three properties hold across all of them:
 *
 * **No storage reference and no URL.** A view never carries the address of the bytes. Reaching them
 * is a separate, authorized, audited operation, and a consumer holding a reference could try to
 * resolve it without one.
 *
 * **No file content, ever.** These describe documents; they do not contain them.
 *
 * **Expiry is derived and says who owns it.** `expiryOwnedByPeople` is true where the document
 * evidences a `person_identifier`, in which case the date reported is People's and this module
 * stores none of its own (D-1a).
 */

export interface LocalizedNameView {
  readonly en: string;
  readonly ar: string;
}

/** A civil date in both calendars, derived rather than stored twice (D-28). */
export interface DualCalendarView {
  readonly gregorian: string;
  /** `yyyy-mm-dd` in the Umm al-Qura calendar, from the kernel's arithmetic conversion. */
  readonly hijri: string;
}

export interface DocumentTypeView {
  readonly documentTypeId: string;
  readonly code: string;
  readonly name: LocalizedNameView;
  readonly ownerTypes: readonly string[];
  readonly expires: boolean;
  readonly requiresVerification: boolean;
  readonly confidentiality: string;
  readonly employeeVisible: boolean;
  readonly managerVisible: boolean;
  /** Configuration. **Nothing fires a notice** — no scheduler exists (D-26). */
  readonly noticeDays: readonly number[];
  readonly retentionPolicyCode?: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DocumentView {
  readonly documentId: string;
  readonly documentTypeId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  /** Set where this document evidences an identifier People owns. */
  readonly personIdentifierId?: string;
  readonly title: LocalizedNameView;
  readonly status: string;
  readonly confidentiality: string;
  readonly issueDate?: DualCalendarView;
  readonly expiryDate?: DualCalendarView;
  /** Derived from the date and today. Never stored, because nothing would maintain it. */
  readonly expiryState: string;
  /** True where People owns the expiry and this module stores none of its own. */
  readonly expiryOwnedByPeople: boolean;
  /** The configured threshold this document has crossed, if any. A screen reads it; no inbox does. */
  readonly noticeThresholdCrossed?: number;
  readonly verificationState: string;
  readonly currentVersionId?: string;
  readonly versionCount: number;
  readonly source: string;
  readonly legalHold: boolean;
  readonly legalHoldReason?: string;
  readonly retentionPolicyCode?: string;
  readonly archivedAt?: Date;
  readonly version: number;
}

/**
 * A version, **without its storage reference**.
 *
 * `hashVerified` is false on every row today: nothing has re-computed a hash against stored bytes,
 * because no storage adapter exists. `detectedMediaType` is absent for the same reason — the
 * declared type is what a client claimed, and nothing has inspected content to confirm it.
 */
export interface DocumentVersionView {
  readonly documentVersionId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly originalFileName: string;
  readonly declaredMediaType: string;
  readonly detectedMediaType?: string;
  /** An exact decimal string. A file can exceed what a double represents exactly. */
  readonly sizeInBytes: string;
  readonly contentHash: string;
  readonly hashAlgorithm: string;
  readonly hashVerified: boolean;
  readonly source: string;
  readonly verificationState: string;
  readonly supersededAt?: Date;
}

export interface VerificationView {
  readonly verificationId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly reason?: string;
}

/** One line of the access trail. Carries no content, no reference and no URL. */
export interface AccessEventView {
  readonly accessEventId: string;
  readonly documentId: string;
  readonly documentVersionId?: string;
  readonly action: string;
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId?: string;
  readonly outcome: string;
}

/**
 * A download authorization.
 *
 * `available` is false and `url` absent wherever no storage adapter is wired, which is everywhere
 * in this repository today. A consumer must branch on `available` rather than assume a URL.
 */
export interface DownloadAuthorizationView {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly url?: string;
  readonly available: boolean;
  readonly expiresInSeconds: number;
}

/** What reconciliation found. It reports; it repairs nothing. */
export interface ReconciliationFindingView {
  readonly finding: string;
  readonly documentId: string;
  readonly documentVersionId?: string;
  readonly detail?: Readonly<Record<string, string>>;
}
