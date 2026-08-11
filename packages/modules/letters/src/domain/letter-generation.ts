import {
  LETTER_TRANSITIONS,
  canTransition,
  isLocale,
  type Locale,
  type LetterStatus,
  type SignatureState,
} from './letters-vocabulary.js';
import { accept, refuse, type LettersResult } from './letters-rejection.js';
import {
  bodyFor,
  placeholdersIn,
  usableForGeneration,
  type LetterTemplateVersionState,
} from './letter-template.js';

/**
 * Generating a letter, and freezing what it said.
 *
 * **The substitution is a lookup and nothing else.** A placeholder is a declared name; resolving it
 * is a map read; an unresolved one fails the generation. There is no expression language, no
 * conditional, no loop and no way for template text to reach code — which is the property that
 * makes a tenant-authored template safe to execute against another employee's salary.
 *
 * **An unresolved variable fails loudly.** Rendering a blank where a salary should be would produce
 * a bank letter stating an employee earns nothing, signed by the employer. A missing value is a
 * refusal, not an empty string (§21 of the brief).
 *
 * **What is frozen at issue is everything.** The template version, every substituted value, the
 * locale, and the version of each source the values came from. A salary certificate issued in March
 * still reads March's salary after April's raise, because nothing re-reads a source after issue —
 * the same argument as Payroll's input snapshot (ADR-0064), for the same reason.
 */

export interface LetterRequestState {
  readonly letterRequestId: string;
  readonly letterTemplateId: string;
  readonly letterTemplateVersionId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly locale: Locale;
  readonly purpose?: string;
  readonly addressee?: string;
  readonly status: LetterStatus;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly failureReason?: string;
  readonly version: number;
}

export interface RequestLetterRequest {
  readonly letterRequestId: string;
  readonly template: { readonly letterTemplateId: string; readonly requiresApproval: boolean };
  readonly templateVersion: LetterTemplateVersionState;
  readonly employmentId: string;
  readonly personId: string;
  readonly locale: string;
  readonly purpose?: string;
  readonly addressee?: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
}

/**
 * A new request.
 *
 * It starts in `pending_approval` where the template requires approval and `requested` where it
 * does not — the template decides, not the caller, so a requester cannot skip a control by asking
 * differently.
 */
export const requestLetter = (request: RequestLetterRequest): LettersResult<LetterRequestState> => {
  if (!isLocale(request.locale)) return refuse('locale_unknown', { field: 'locale' });

  const usable = usableForGeneration(request.templateVersion);

  if (!usable.ok) return usable;
  if (request.requestedBy.trim() === '') {
    return refuse('requester_required', { field: 'requestedBy' });
  }

  return accept({
    letterRequestId: request.letterRequestId,
    letterTemplateId: request.template.letterTemplateId,
    letterTemplateVersionId: request.templateVersion.letterTemplateVersionId,
    employmentId: request.employmentId,
    personId: request.personId,
    locale: request.locale,
    status: request.template.requiresApproval ? 'pending_approval' : 'requested',
    requestedBy: request.requestedBy,
    requestedAt: request.requestedAt,
    version: 1,
    ...(request.purpose === undefined ? {} : { purpose: request.purpose }),
    ...(request.addressee === undefined ? {} : { addressee: request.addressee }),
  });
};

export const moveRequestTo = (
  state: LetterRequestState,
  status: LetterStatus,
  failureReason?: string,
): LettersResult<LetterRequestState> => {
  if (!canTransition(LETTER_TRANSITIONS, state.status, status)) {
    return refuse('letter_transition_not_permitted', { from: state.status, to: status });
  }
  if (status === 'failed' && (failureReason ?? '').trim() === '') {
    return refuse('failure_needs_reason', { field: 'failureReason' });
  }

  const { failureReason: _previous, ...rest } = state;

  return accept({
    ...rest,
    status,
    version: state.version + 1,
    ...(failureReason === undefined ? {} : { failureReason }),
  });
};

/** What the template resolved, ready to be frozen. Values are strings: nothing computes here. */
export type ResolvedValues = Readonly<Record<string, string>>;

export interface GenerationRequest {
  readonly templateVersion: LetterTemplateVersionState;
  readonly locale: Locale;
  readonly resolved: ResolvedValues;
}

export interface GeneratedContent {
  readonly body: string;
  readonly substitutedValues: ResolvedValues;
}

/**
 * Substituting a template version's body for one locale.
 *
 * Pure: no clock, no database, no source call. The values were resolved before this ran, which is
 * what makes a generated letter reproducible from its frozen snapshot — replaying the same values
 * against the same template version yields the same text, byte for byte.
 */
export const generate = (request: GenerationRequest): LettersResult<GeneratedContent> => {
  const template = bodyFor(request.templateVersion, request.locale);
  const used = placeholdersIn(template);
  const substituted: Record<string, string> = {};

  for (const name of used) {
    const value = request.resolved[name];

    // A blank where a figure belongs is how a bank letter comes to state an employee earns
    // nothing. A missing value is a refusal.
    if (value === undefined) return refuse('variable_unresolved', { variable: name });
    substituted[name] = value;
  }

  return accept({
    body: template.replace(
      /\{\{\s*([A-Za-z0-9.]+)\s*\}\}/g,
      (_match, name: string) =>
        // Every name here was resolved in the loop above; the fallback cannot fire and is present
        // because the replacer's signature permits an index it never uses.
        substituted[name] ?? '',
    ),
    substitutedValues: substituted,
  });
};

/** Which source each value came from, and at what version. Frozen beside the values themselves. */
export type SourceVersions = Readonly<Record<string, string>>;

export interface IssuedLetterState {
  readonly issuedLetterId: string;
  readonly letterRequestId: string;
  readonly letterTemplateId: string;
  readonly letterTemplateVersionId: string;
  readonly employmentId: string;
  readonly personId: string;
  readonly referenceNumber: string;
  readonly verificationToken: string;
  readonly locale: Locale;
  readonly substitutedValues: ResolvedValues;
  readonly sourceVersions: SourceVersions;
  readonly issuedAt: Date;
  readonly issuedBy: string;
  readonly signatory?: string;
  readonly signatureRequired: boolean;
  readonly signatureState: SignatureState;
  /** The rendered artefact. Absent: no renderer exists in this repository. */
  readonly documentId?: string;
  readonly supersededById?: string;
  readonly supersededAt?: Date;
  readonly version: number;
}

export interface IssueLetterRequest {
  readonly issuedLetterId: string;
  readonly request: LetterRequestState;
  readonly templateVersion: LetterTemplateVersionState;
  readonly content: GeneratedContent;
  readonly sourceVersions: SourceVersions;
  readonly referenceNumber: string;
  readonly verificationToken: string;
  readonly issuedAt: Date;
  readonly issuedBy: string;
  readonly signatory?: string;
}

export const issueLetter = (request: IssueLetterRequest): LettersResult<IssuedLetterState> => {
  if (request.request.status !== 'generated') {
    return refuse('letter_not_generated', { status: request.request.status });
  }
  if (request.issuedBy.trim() === '') return refuse('issuer_required', { field: 'issuedBy' });
  if (request.verificationToken.length < 32) {
    // A guessable token is a public letter: the verification endpoint takes nothing else.
    return refuse('verification_token_too_short', { field: 'verificationToken' });
  }

  return accept({
    issuedLetterId: request.issuedLetterId,
    letterRequestId: request.request.letterRequestId,
    letterTemplateId: request.request.letterTemplateId,
    letterTemplateVersionId: request.templateVersion.letterTemplateVersionId,
    employmentId: request.request.employmentId,
    personId: request.request.personId,
    referenceNumber: request.referenceNumber,
    verificationToken: request.verificationToken,
    locale: request.request.locale,
    substitutedValues: request.content.substitutedValues,
    sourceVersions: request.sourceVersions,
    issuedAt: request.issuedAt,
    issuedBy: request.issuedBy,
    signatureRequired: request.templateVersion.requiresSignature,
    // `required` records that somebody must sign; it never claims anybody did. No signature
    // provider exists in this repository (D-16).
    signatureState: request.templateVersion.requiresSignature ? 'required' : 'not_required',
    version: 1,
    ...(request.signatory === undefined ? {} : { signatory: request.signatory }),
  });
};

/**
 * Superseding an issued letter with a corrected one.
 *
 * The only permitted change to an issued letter, and the reason a correction is a *new* letter: the
 * original stays exactly as issued, because somebody may be holding a printed copy of it.
 */
export const supersede = (
  state: IssuedLetterState,
  supersededById: string,
  moment: Date,
): LettersResult<IssuedLetterState> => {
  if (state.supersededById !== undefined) return refuse('letter_already_superseded');
  if (state.issuedLetterId === supersededById) return refuse('letter_cannot_supersede_itself');
  return accept({ ...state, supersededById, supersededAt: moment, version: state.version + 1 });
};
