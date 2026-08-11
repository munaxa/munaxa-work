/**
 * What Letters publishes.
 *
 * Three properties hold across all of them.
 *
 * **No template body reaches a letter view.** A request or an issued letter carries what was
 * *substituted*, not the template it came from — the body is authoring content and belongs to the
 * template views.
 *
 * **The verification token never appears in a register view.** It is the unguessable half of a
 * letter's identity, and a register listing that carried it would hand every reader the means to
 * verify letters they have no business verifying. It travels once, to whoever issued the letter.
 *
 * **The third-party verification view carries no employee data.** 5.1 AD-006 requires a third party
 * to confirm authenticity *without* seeing employee data, so `LetterVerificationView` answers
 * whether a reference is genuine and current, and nothing about who it is about.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

/** A civil date in both calendars, derived rather than stored twice (D-28). */
export interface DualCalendarView {
  readonly gregorian: string;
  readonly hijri: string;
}

export interface LetterTemplateView {
  readonly letterTemplateId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly category: string;
  readonly requiresApproval: boolean;
  readonly employeeRequestable: boolean;
  readonly currentVersionId?: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface LetterTemplateVersionView {
  readonly letterTemplateVersionId: string;
  readonly letterTemplateId: string;
  readonly versionNumber: number;
  readonly body: LocalizedTextView;
  readonly variables: readonly string[];
  readonly exposedFields: readonly string[];
  readonly letterheadReference?: string;
  /** Declares that a human must sign. **Never claims one did** — no provider exists (D-16). */
  readonly requiresSignature: boolean;
  readonly status: string;
  /** Set the moment this version first issued a letter. From then on it is frozen. */
  readonly firstIssuedAt?: Date;
  /** False once anything has been issued from it. Derived, so a screen need not know the rule. */
  readonly editable: boolean;
  readonly version: number;
}

export interface LetterRequestView {
  readonly letterRequestId: string;
  readonly letterTemplateId: string;
  readonly letterTemplateVersionId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly locale: string;
  readonly purpose?: string;
  readonly addressee?: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly failureReason?: string;
  /** What the approval chain currently says. Derived from every decision, not from the latest. */
  readonly approvalState: string;
  readonly version: number;
}

export interface ApprovalDecisionView {
  readonly approvalDecisionId: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly reversesId?: string;
}

/**
 * An issued letter, as the register shows it.
 *
 * `documentId` is absent on every row today: no PDF renderer exists in this repository, so a letter
 * has content and no artefact (D-15). The frozen `substitutedValues` are what make it reproducible
 * — the same values against the same template version yield the same text.
 */
export interface IssuedLetterView {
  readonly issuedLetterId: string;
  readonly letterRequestId: string;
  readonly letterTemplateId: string;
  readonly letterTemplateVersionId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly referenceNumber: string;
  readonly locale: string;
  readonly issuedAt: DualCalendarView;
  readonly issuedBy: string;
  readonly signatory?: string;
  readonly signatureRequired: boolean;
  readonly signatureState: string;
  /** Absent everywhere: nothing renders a file. Reported as absent, never as a URL. */
  readonly documentId?: string;
  readonly supersededById?: string;
  readonly supersededAt?: Date;
  readonly version: number;
}

/**
 * One issued letter in full, including what it said.
 *
 * Behind `letter.read`, and separate from the register view because the substituted values may
 * include a salary figure. A list does not carry them; opening one does.
 */
export interface IssuedLetterDetailView {
  readonly letter: IssuedLetterView;
  readonly substitutedValues: Readonly<Record<string, string>>;
  /** Which source each value came from, and at what version. What makes the letter reproducible. */
  readonly sourceVersions: Readonly<Record<string, string>>;
}

/**
 * The third-party answer, and deliberately almost nothing.
 *
 * A bank holding a printed letter can confirm it is genuine and still current. It learns the
 * reference, the date and whether the letter has been superseded — **no name, no employer, no
 * salary, no purpose**. Anything more would make the verification endpoint a public register of who
 * works where (AD-006).
 */
export interface LetterVerificationView {
  readonly genuine: boolean;
  readonly referenceNumber?: string;
  readonly issuedOn?: DualCalendarView;
  readonly superseded?: boolean;
}

/** What reconciliation found. It reports; it repairs nothing. */
export interface LettersReconciliationFindingView {
  readonly finding: string;
  readonly letterRequestId: string;
  readonly issuedLetterId?: string;
  readonly detail?: Readonly<Record<string, string>>;
}
