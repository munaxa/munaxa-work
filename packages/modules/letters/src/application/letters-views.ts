import { formatCalendarDate, toHijri } from '@work/kernel';

import { approvalState } from '../domain/letter-approval.js';
import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type { LetterTemplateState, LetterTemplateVersionState } from '../domain/letter-template.js';
import type {
  ApprovalDecisionView,
  DualCalendarView,
  IssuedLetterView,
  LetterRequestView,
  LetterTemplateVersionView,
  LetterTemplateView,
} from '../contracts/views.js';

/**
 * Turning state into what a caller reads.
 *
 * Assembled here rather than returned raw, so a column rename is not an API change. Two things
 * happen in this file worth noticing.
 *
 * **Dates carry both calendars**, derived from the kernel's conversion rather than stored twice —
 * two stored dates are two things that can disagree (D-28). 5.1 requires letters to render in both.
 *
 * **The verification token never reaches a view.** It is the unguessable half of a letter's
 * identity; a register listing carrying it would hand every reader the means to verify letters they
 * have no business verifying.
 */

export const dual = (moment: Date): DualCalendarView => ({
  gregorian: moment.toISOString().slice(0, 10),
  hijri: formatCalendarDate(toHijri(moment)),
});

const present = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  ) as Defined<TShape>;

/**
 * The optional half of a view, with the absent members dropped.
 *
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", and a
 * view carrying `signatory: undefined` would serialize a null nobody meant.
 */
type Defined<TShape> = { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> };

export const templateView = (state: LetterTemplateState): LetterTemplateView => ({
  letterTemplateId: state.letterTemplateId,
  code: state.code,
  name: state.name,
  category: state.category,
  requiresApproval: state.requiresApproval,
  employeeRequestable: state.employeeRequestable,
  active: state.active,
  version: state.version,
  ...present({
    currentVersionId: state.currentVersionId,
    countryPackId: state.countryPackId,
    countryPackVersion: state.countryPackVersion,
  }),
});

export const templateVersionView = (
  state: LetterTemplateVersionState,
): LetterTemplateVersionView => ({
  letterTemplateVersionId: state.letterTemplateVersionId,
  letterTemplateId: state.letterTemplateId,
  versionNumber: state.versionNumber,
  body: state.body,
  variables: state.variables,
  exposedFields: state.exposedFields,
  requiresSignature: state.requiresSignature,
  status: state.status,
  // Derived, so a screen does not have to know that issuance rather than publication is the freeze.
  editable: state.firstIssuedAt === undefined,
  version: state.version,
  ...present({
    letterheadReference: state.letterheadReference,
    firstIssuedAt: state.firstIssuedAt,
  }),
});

export const requestView = (
  state: LetterRequestState,
  decisions: readonly ApprovalDecisionState[],
): LetterRequestView => ({
  letterRequestId: state.letterRequestId,
  letterTemplateId: state.letterTemplateId,
  letterTemplateVersionId: state.letterTemplateVersionId,
  employmentId: state.employmentId,
  personId: state.personId,
  locale: state.locale,
  status: state.status,
  requestedBy: state.requestedBy,
  requestedAt: state.requestedAt,
  // Read from the whole chain, because a reversal does not erase what it reverses.
  approvalState: approvalState(decisions),
  version: state.version,
  ...present({
    purpose: state.purpose,
    addressee: state.addressee,
    failureReason: state.failureReason,
  }),
});

export const decisionView = (state: ApprovalDecisionState): ApprovalDecisionView => ({
  approvalDecisionId: state.approvalDecisionId,
  sequence: state.sequence,
  decision: state.decision,
  decidedBy: state.decidedBy,
  decidedAt: state.decidedAt,
  ...present({ comment: state.comment, reversesId: state.reversesId }),
});

/** The register row. Carries no substituted values and never the verification token. */
export const issuedLetterView = (state: IssuedLetterState): IssuedLetterView => ({
  issuedLetterId: state.issuedLetterId,
  letterRequestId: state.letterRequestId,
  letterTemplateId: state.letterTemplateId,
  letterTemplateVersionId: state.letterTemplateVersionId,
  employmentId: state.employmentId,
  personId: state.personId,
  referenceNumber: state.referenceNumber,
  locale: state.locale,
  issuedAt: dual(state.issuedAt),
  issuedBy: state.issuedBy,
  signatureRequired: state.signatureRequired,
  signatureState: state.signatureState,
  version: state.version,
  ...present({
    signatory: state.signatory,
    documentId: state.documentId,
    supersededById: state.supersededById,
    supersededAt: state.supersededAt,
  }),
});
