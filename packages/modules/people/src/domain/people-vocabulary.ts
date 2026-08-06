/**
 * The ubiquitous language of People, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is the boundary being kept rather than
 * described: *department*, *position*, *manager*, *cost centre*, *shift*, *supervisor*, *salary*,
 * *contract* and *employee*. A Person contains no organizational information (AD-003) and no
 * payroll or attendance information (AD-004, AD-005). Those belong to Employment's assignment.
 *
 * Also absent: any list of countries, any list of identity document types, and any nationality
 * with meaning attached to it. A person's nationality is an input to statutory rules and never a
 * business rule in itself (00B); which documents a country requires is country-pack content
 * (Phase 11.1), so an identifier *type* here is a code the tenant or the pack supplies, validated
 * by shape and never against a list this product ships.
 */

/**
 * The lifecycle of a Person.
 *
 * `draft` — recorded but not yet confirmed as a real human being. Bulk import and recruitment
 * both create people before anybody has checked them, and a registry that could not hold an
 * unconfirmed record would push that state into a spreadsheet.
 * `active` — a confirmed identity, referenceable by every other module.
 * `archived` — no longer expected to appear in a picker, and still fully answerable. A person who
 * left years ago is this, and it is not a deletion: identity is permanent (AD-009), and the
 * employment records that point here must still resolve.
 * `merged` — terminal. This record was found to be the same human being as another and now
 * redirects to it. The row survives because everything that ever referenced it must still
 * resolve, which is the whole reason a merge is not a delete.
 */
export const PERSON_STATUSES = ['draft', 'active', 'archived', 'merged'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** A person whose identity may still be amended. A merged record never can be. */
export const acceptsAmendment = (status: PersonStatus): boolean => status !== 'merged';

/**
 * How a communication channel is reached.
 *
 * Deliberately about the *channel* rather than about the person's relationship to the company:
 * `work` and `personal` are the *purpose*, below. A registry that had a `workEmail` column would
 * be holding an employment fact, and employment is Phase 5's (AD-002).
 */
export const CONTACT_CHANNELS = ['email', 'mobile', 'phone', 'fax', 'messaging'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_PURPOSES = ['personal', 'work', 'emergency'] as const;
export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];

/**
 * What an address is for.
 *
 * `residential` — where the person lives. `mailing` — where post reaches them. `national` — the
 * address registered with an authority, which several markets require separately from the other
 * two and which no rule in this module interprets.
 */
export const ADDRESS_KINDS = ['residential', 'mailing', 'national', 'other'] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/**
 * How well somebody uses a language, ordered least to most.
 *
 * Ordered so a consumer may compare by index without this module publishing a numeric scale it
 * would then have to keep stable. It is a self-declared capability, not an assessment — Learning
 * (Phase 14) owns assessment.
 */
export const LANGUAGE_PROFICIENCIES = [
  'basic',
  'conversational',
  'professional',
  'fluent',
  'native',
] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

/** How strong a skill is, on the same ordered-not-numbered principle. */
export const SKILL_LEVELS = ['novice', 'intermediate', 'advanced', 'expert'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** A capability the person holds. Both kinds are self-declared and separately permissioned. */
export const CAPABILITY_KINDS = ['language', 'skill'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/**
 * A period of the person's life before or outside this employer.
 *
 * `education` and `experience` are history the person brings with them; `certification` is a
 * formal qualification that may expire. None of the three is employment *with this company* —
 * that is Phase 5's, and this module holds no assignment (AD-002).
 */
export const HISTORY_KINDS = ['education', 'experience', 'certification'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** Whether a duplicate the system suspected has been looked at, and what the reviewer decided. */
export const DUPLICATE_STATUSES = ['pending', 'confirmed', 'dismissed'] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

/**
 * An ISO 3166-1 alpha-2 country code, validated as a *shape* and never against a list.
 *
 * The same rule Organization applies (ADR-0035): a hardcoded list of countries is a code change
 * every time the product sells somewhere new, which 00B prohibits. Here it appears on a
 * nationality, on an identifier's issuing country and on an address — and in none of those places
 * does this module attach a meaning to the value.
 */
export const isCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);

/**
 * A BCP 47 language tag, validated by shape.
 *
 * Arabic and English are first-class in the *catalogues*; the languages a person speaks are not
 * limited to those two, and a registry that could only record `ar` and `en` would be unusable for
 * the multinational workforces this product is sold into.
 */
export const isLanguageTag = (value: string): boolean =>
  /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);

/**
 * A stable, human-authored code, unique within its tenant and its kind.
 *
 * ASCII by design, for the same reason Organization's codes are: a code travels into payroll
 * files, bank formats and government uploads, where a non-ASCII character is a rejected
 * submission. Names carry the Arabic, and they are `LocalizedText`.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

/**
 * The shape of an email address, checked loosely on purpose.
 *
 * A strict RFC 5322 expression rejects addresses that work, and the only authoritative test of an
 * address is sending to it. This refuses what is obviously not an address and no more.
 */
export const isEmailAddress = (value: string): boolean =>
  /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 320;

/**
 * A telephone number in E.164-ish form: a leading `+`, then digits.
 *
 * Stored normalized because a number recorded as `+966 50 123 4567` in one screen and
 * `+966501234567` in another is two numbers to a duplicate check and one number to a human.
 */
export const isTelephoneNumber = (value: string): boolean => /^\+[1-9]\d{6,17}$/.test(value);

export const normalizeTelephone = (value: string): string => value.replace(/[\s()-]/g, '');

/**
 * A civil date as `YYYY-MM-DD`.
 *
 * People's dates of birth, issue dates and expiry dates are civil dates rather than instants: a
 * date of birth is the same date in every time zone, and storing it as a timestamp makes it
 * shift across a zone boundary and change somebody's age.
 */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
