/**
 * The closed vocabularies this module owns, and the transitions between them.
 *
 * Closed because they are *this module's* concepts rather than a tenant's or a country's: a
 * document is verified or it is not, and there is no jurisdiction in which that means something
 * else. Everything a tenant or a country pack decides — what kinds of document exist, what they are
 * called, whether they expire, how long they are kept — is configuration and appears nowhere here
 * (00B).
 *
 * The transition tables are data rather than `switch` statements for the same reason Payroll's are:
 * a reader can see every permitted move at once, and a move nobody listed is refused by default
 * instead of falling through to "allowed".
 */

/** Where a document belongs. Explicit and never inferred (4.1 AD-001). */
export const OWNER_TYPES = ['person', 'employment', 'legal_entity'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

/**
 * `dependent` is deliberately absent.
 *
 * The 4.1 specification names it as a fourth owner, and nothing in this repository models a
 * dependent — there is no table, no contract and no registry. Reserving the word here without a
 * subject would invite a second person registry inside Documents, so the type refuses it and the
 * gap is recorded rather than approximated (D-1).
 */
export const RESERVED_OWNER_TYPES = ['dependent'] as const;

export const isOwnerType = (value: string): value is OwnerType =>
  (OWNER_TYPES as readonly string[]).includes(value);

export const DOCUMENT_STATUSES = ['draft', 'active', 'archived', 'superseded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * What a document may become.
 *
 * `archived` is reachable and reversible; nothing here reaches a deleted state, because deletion is
 * not a status in this module. A verified historical document is never removed by an ordinary path
 * (D-10), so there is no transition to offer.
 */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  draft: ['active', 'archived'],
  active: ['archived', 'superseded'],
  archived: ['active'],
  superseded: [],
};

export const VERIFICATION_STATES = [
  'unverified',
  'pending_verification',
  'verified',
  'rejected',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * What a verification state may become.
 *
 * **Uploading is not verifying**, so a new document and a new version both start at `unverified`
 * and there is no transition that skips the decision. A `verified` state moves only back to
 * `pending_verification` — which is what replacing the file does, because a verdict was given for
 * bytes that are no longer current.
 */
export const VERIFICATION_TRANSITIONS: Readonly<
  Record<VerificationState, readonly VerificationState[]>
> = {
  unverified: ['pending_verification', 'verified', 'rejected'],
  pending_verification: ['verified', 'rejected'],
  verified: ['pending_verification'],
  rejected: ['pending_verification', 'verified'],
};

/** Whether seeing the owning record is enough. For a `confidential` type it never is (AD-007). */
export const CONFIDENTIALITY_LEVELS = ['normal', 'confidential'] as const;
export type Confidentiality = (typeof CONFIDENTIALITY_LEVELS)[number];

/** Where a document came from. `letter` is an artefact Letters produced; the rest are uploads. */
export const DOCUMENT_SOURCES = [
  'direct',
  'recruitment',
  'onboarding',
  'letter',
  'migration',
] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

/**
 * What the access trail records.
 *
 * `download_refused` is on this list deliberately. An audit that records only what succeeded hides
 * the more interesting half — somebody trying repeatedly to reach a document they may not see is
 * exactly what an access trail exists to surface.
 */
export const ACCESS_ACTIONS = [
  'metadata_read',
  'download_authorized',
  'download_refused',
  'verified',
  'rejected',
  'replaced',
  'archived',
  'restored',
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/**
 * How a document stands against its expiry date.
 *
 * Derived on read from `expiry_date` and never stored: a materialized `expired` flag needs
 * something to update it, `JobPort` has no adapter in this repository, and a flag that nothing
 * maintains is worse than no flag at all (D-26, §12 of the plan).
 */
export const EXPIRY_STATES = ['no_expiry', 'valid', 'expiring_soon', 'expired'] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

/** The only hash this module writes. The repository had no convention to inherit (D-5a). */
export const HASH_ALGORITHM = 'sha-256';

/**
 * A storage reference, in the shape Employment, Recruitment and Onboarding already validate.
 *
 * Adopted rather than reinvented: three modules define this identical expression today, and a
 * fourth spelling would make a reference valid in one module and malformed in the next. It is
 * deliberately not a URL and not a path — nothing may infer a provider from it.
 */
export const isStorageReference = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);

/** A tenant-authored code: lower case, hyphenated, never a sentence and never a translation. */
export const isEntityCode = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

export const isCivilDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Whether a target state is reachable from the current one, by the tables above. */
export const canTransition = <TState extends string>(
  table: Readonly<Record<TState, readonly TState[]>>,
  from: TState,
  to: TState,
): boolean => (table[from] as readonly string[]).includes(to);
