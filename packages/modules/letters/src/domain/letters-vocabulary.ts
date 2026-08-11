/**
 * The closed vocabularies Letters owns, and the transitions between them.
 *
 * What a tenant decides — which letters exist, what they say, in which languages, whether they need
 * approval — is configuration and appears nowhere here. What this module owns is the shape of a
 * letter's life, and that is the same in every jurisdiction.
 */

export const LETTER_STATUSES = [
  'requested',
  'pending_approval',
  'approved',
  'rejected',
  'generating',
  'generated',
  'failed',
  'issued',
  'cancelled',
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

/**
 * What a request may become.
 *
 * **`issued` is terminal**, which is the whole point: an issued letter is frozen, and a correction
 * issues a new one that supersedes it rather than moving this one anywhere. `rejected` and
 * `cancelled` are terminal too.
 *
 * `generating` exists as a state and **nothing runs asynchronously**: there is no `JobPort` adapter
 * and no renderer, so generation completes or fails within the request that asked for it. The state
 * is here because the lifecycle the specification approves has it, and because a future renderer
 * will need somewhere to be in the middle of.
 */
export const LETTER_TRANSITIONS: Readonly<Record<LetterStatus, readonly LetterStatus[]>> = {
  requested: ['pending_approval', 'generating', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['generating', 'cancelled'],
  generating: ['generated', 'failed'],
  generated: ['issued', 'cancelled'],
  failed: ['generating', 'cancelled'],
  issued: [],
  rejected: [],
  cancelled: [],
};

export const TEMPLATE_STATUSES = ['draft', 'published', 'retired'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const TEMPLATE_TRANSITIONS: Readonly<Record<TemplateStatus, readonly TemplateStatus[]>> = {
  draft: ['published'],
  published: ['retired'],
  retired: [],
};

export const APPROVAL_DECISIONS = ['approved', 'rejected', 'reversed'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * What a letter may say about a signature.
 *
 * There is no `signed`. No signature provider, signing contract or certificate infrastructure
 * exists in this repository, and a state meaning "this product signed it" would be a claim nothing
 * performed. `declared_signed_externally` is a human asserting they signed a printed copy — a fact
 * about the world, recorded as such, not a cryptographic one (D-16).
 */
export const SIGNATURE_STATES = ['not_required', 'required', 'declared_signed_externally'] as const;
export type SignatureState = (typeof SIGNATURE_STATES)[number];

export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

export const isEntityCode = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

/**
 * A template variable name.
 *
 * Deliberately narrow: letters, digits and dots, so `employment.startDate` is a name and nothing
 * else is. There is no expression language, no function call and no operator — a variable is a
 * key looked up in a resolved map, and anything a template author writes that is not a declared
 * name fails the generation (D-13).
 */
export const isVariableName = (value: string): boolean =>
  /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*){0,3}$/.test(value);

/** The fields a template may be permitted to expose. `salary` is gated twice — see the template. */
export const EXPOSABLE_FIELDS = [
  'person',
  'employment',
  'organization',
  'salary',
  'payroll',
] as const;
export type ExposableField = (typeof EXPOSABLE_FIELDS)[number];

export const canTransition = <TState extends string>(
  table: Readonly<Record<TState, readonly TState[]>>,
  from: TState,
  to: TState,
): boolean => (table[from] as readonly string[]).includes(to);
