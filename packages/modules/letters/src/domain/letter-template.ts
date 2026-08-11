import {
  EXPOSABLE_FIELDS,
  LOCALES,
  TEMPLATE_TRANSITIONS,
  canTransition,
  isEntityCode,
  isVariableName,
  type ExposableField,
  type Locale,
  type TemplateStatus,
} from './letters-vocabulary.js';
import { accept, refuse, type LettersResult } from './letters-rejection.js';

/**
 * A letter a tenant may issue, and the immutable versions of what it says.
 *
 * **Nothing is hardcoded.** An employment certificate, a salary certificate, an experience letter
 * and an embassy letter are all *templates a tenant authors*, shipped at most as default
 * configuration they may edit or disable. There is no endpoint per letter type and no letter type
 * in this module's code (5.1 AD-001).
 *
 * **A version that has issued a letter is frozen.** Editing it would silently change what a
 * historical letter claims to have been generated from, which is the one thing a letter register
 * exists to prevent. A database trigger refuses the update; this refuses it first, with a reason.
 *
 * **`exposedFields` is the first of two gates on salary.** 5.1 AD-005: a template may not expose
 * salary unless the letter type permits it *and* the requester holds the permission. This column is
 * the template's half; the application checks the caller's.
 */

export interface LocalizedBody {
  readonly en: string;
  readonly ar: string;
}

export interface LetterTemplateState {
  readonly letterTemplateId: string;
  readonly code: string;
  readonly name: LocalizedBody;
  readonly category: string;
  readonly requiresApproval: boolean;
  readonly employeeRequestable: boolean;
  readonly currentVersionId?: string;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface LetterTemplateVersionState {
  readonly letterTemplateVersionId: string;
  readonly letterTemplateId: string;
  readonly versionNumber: number;
  readonly body: LocalizedBody;
  readonly variables: readonly string[];
  readonly exposedFields: readonly ExposableField[];
  readonly letterheadReference?: string;
  readonly requiresSignature: boolean;
  readonly status: TemplateStatus;
  readonly firstIssuedAt?: Date;
  readonly version: number;
}

export interface DefineTemplateRequest {
  readonly letterTemplateId: string;
  readonly code: string;
  readonly name: LocalizedBody;
  readonly category: string;
  readonly requiresApproval: boolean;
  readonly employeeRequestable: boolean;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}

export const createTemplate = (
  request: DefineTemplateRequest,
): LettersResult<LetterTemplateState> => {
  if (!isEntityCode(request.code)) return refuse('template_code_malformed', { field: 'code' });
  if (request.name.en.trim() === '' || request.name.ar.trim() === '') {
    return refuse('template_name_incomplete', { field: 'name' });
  }
  if (!isEntityCode(request.category)) {
    return refuse('template_category_malformed', { field: 'category' });
  }

  return accept({
    letterTemplateId: request.letterTemplateId,
    code: request.code,
    name: request.name,
    category: request.category,
    requiresApproval: request.requiresApproval,
    employeeRequestable: request.employeeRequestable,
    active: true,
    version: 1,
    ...(request.countryPackId === undefined ? {} : { countryPackId: request.countryPackId }),
    ...(request.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: request.countryPackVersion }),
  });
};

export interface DraftVersionRequest {
  readonly letterTemplateVersionId: string;
  readonly letterTemplateId: string;
  readonly versionNumber: number;
  readonly body: LocalizedBody;
  readonly variables: readonly string[];
  readonly exposedFields: readonly string[];
  readonly letterheadReference?: string;
  readonly requiresSignature?: boolean;
}

/**
 * A new draft version.
 *
 * **Both languages are required.** A template authored only in English is a letter an Arabic
 * speaker cannot be issued, and the specification requires every template in both (AD-001). One
 * version carrying both is deliberate: two per-language templates drift the moment somebody edits
 * one and forgets the other.
 *
 * Every placeholder the body uses must be a **declared** variable, and every declared variable must
 * be a name rather than an expression. That is the whole safety model: substitution is a lookup.
 */
export const draftTemplateVersion = (
  request: DraftVersionRequest,
): LettersResult<LetterTemplateVersionState> => {
  if (request.body.en.trim() === '' || request.body.ar.trim() === '') {
    return refuse('template_body_incomplete', { field: 'body' });
  }

  const declared = checkedVariables(request.variables);

  if (!declared.ok) return declared;

  const exposed = checkedExposure(request.exposedFields);

  if (!exposed.ok) return exposed;

  const used = checkedPlaceholders(request.body, declared.value);

  if (!used.ok) return used;

  return accept({
    letterTemplateVersionId: request.letterTemplateVersionId,
    letterTemplateId: request.letterTemplateId,
    versionNumber: request.versionNumber,
    body: request.body,
    variables: declared.value,
    exposedFields: exposed.value,
    requiresSignature: request.requiresSignature ?? false,
    status: 'draft',
    version: 1,
    ...(request.letterheadReference === undefined
      ? {}
      : { letterheadReference: request.letterheadReference }),
  });
};

const checkedVariables = (values: readonly string[]): LettersResult<readonly string[]> => {
  for (const value of values) {
    if (!isVariableName(value)) return refuse('variable_name_malformed', { variable: value });
  }
  return accept([...new Set(values)]);
};

const checkedExposure = (values: readonly string[]): LettersResult<readonly ExposableField[]> => {
  for (const value of values) {
    if (!(EXPOSABLE_FIELDS as readonly string[]).includes(value)) {
      return refuse('exposed_field_unknown', { field: value });
    }
  }
  return accept([...new Set(values)] as readonly ExposableField[]);
};

/** `{{ name }}` — the only substitution syntax. Nothing evaluates, nothing calls, nothing loops. */
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9.]+)\s*\}\}/g;

export const placeholdersIn = (text: string): readonly string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');

/**
 * Every placeholder a body uses must be declared.
 *
 * Checked when the version is authored rather than when a letter is generated, so a template with a
 * typo is refused by the person who wrote it instead of failing for the employee who requested a
 * salary certificate.
 */
const checkedPlaceholders = (
  body: LocalizedBody,
  declared: readonly string[],
): LettersResult<'declared'> => {
  for (const locale of LOCALES) {
    for (const used of placeholdersIn(body[locale])) {
      if (!declared.includes(used)) {
        return refuse('placeholder_not_declared', { variable: used, locale });
      }
    }
  }
  return accept('declared');
};

export const moveTemplateVersionTo = (
  state: LetterTemplateVersionState,
  status: TemplateStatus,
): LettersResult<LetterTemplateVersionState> => {
  if (!canTransition(TEMPLATE_TRANSITIONS, state.status, status)) {
    return refuse('template_transition_not_permitted', { from: state.status, to: status });
  }
  return accept({ ...state, status, version: state.version + 1 });
};

/**
 * Whether this version may still be edited.
 *
 * Once it has issued a letter it may not, ever. A published version that has issued nothing yet is
 * still editable, because nothing depends on it — the freeze is caused by *issuance*, not by
 * publication.
 */
export const editable = (state: LetterTemplateVersionState): LettersResult<'editable'> =>
  state.firstIssuedAt === undefined
    ? accept('editable')
    : refuse('template_version_already_issued');

/** Whether this version may be used to generate. Draft and retired versions may not. */
export const usableForGeneration = (state: LetterTemplateVersionState): LettersResult<'usable'> => {
  if (state.status === 'draft') return refuse('template_version_not_published');
  if (state.status === 'retired') return refuse('template_version_retired');
  return accept('usable');
};

/** Whether this template's language variant exists. Both always do, by construction above. */
export const bodyFor = (state: LetterTemplateVersionState, locale: Locale): string =>
  state.body[locale];
