/**
 * Every permission this module registers.
 *
 * Declared here and referenced by handlers, never spelled out at a call site, because a permission
 * string that exists in two places will eventually differ in one — and the difference fails open
 * exactly once, on the endpoint whose spelling nobody checked.
 *
 * **The split is finer here than in any previous module, and that is the point.** Organization
 * holds structure and could reasonably use read/manage per concern. This module holds national
 * identifiers, dates of birth, home addresses, emergency contacts and free-text notes, and those
 * are not one sensitivity. The person who maintains the register needs to see who exists; almost
 * nobody needs to see a passport number; the person handling a wellbeing case needs the notes and
 * has no business reading a bank-adjacent government identifier.
 *
 * So reading a person and reading their sensitive fields are **different permissions**, and
 * holding the first grants a redacted answer rather than a refusal — a picker that 403s for every
 * user who cannot see passport numbers is a picker nobody can use, and the pressure that creates
 * is to grant everybody the sensitive permission.
 *
 * Reading an identifier's *value* is finer still than reading that it exists, because the
 * existence of a residency permit is an ordinary administrative fact and the number on it is not.
 *
 * Registration is automatic — the module registry derives the list from the handlers — so a
 * permission cannot exist in code and be missing from the administration screen. Platform decides
 * who holds them; this module only says what they are and what they guard.
 */
export const PeoplePermissions = {
  /** Seeing that a person exists, their number, and their name. The ordinary directory read. */
  personRead: 'people.person.read',
  personManage: 'people.person.manage',

  /**
   * Date of birth, place of birth, gender and marital status — the fields a statutory rule reads
   * and a colleague has no reason to.
   */
  sensitiveRead: 'people.person.read-sensitive',

  identifierRead: 'people.identifier.read',
  /**
   * The number itself, rather than its kind and its expiry. Held by very few, and every use of it
   * is recorded — see `DisclosurePort`.
   */
  identifierReadValue: 'people.identifier.read-value',
  identifierManage: 'people.identifier.manage',

  nationalityRead: 'people.nationality.read',
  nationalityManage: 'people.nationality.manage',

  contactRead: 'people.contact.read',
  contactManage: 'people.contact.manage',

  addressRead: 'people.address.read',
  addressManage: 'people.address.manage',

  /** Another human being's data, held about somebody who never consented to this system. */
  emergencyContactRead: 'people.emergency-contact.read',
  emergencyContactManage: 'people.emergency-contact.manage',

  preferenceRead: 'people.preference.read',
  preferenceManage: 'people.preference.manage',

  capabilityRead: 'people.capability.read',
  capabilityManage: 'people.capability.manage',

  historyRead: 'people.history.read',
  historyManage: 'people.history.manage',

  tagRead: 'people.tag.read',
  tagManage: 'people.tag.manage',

  /** Free text an administrator wrote about somebody. The highest-risk field in the module. */
  noteRead: 'people.note.read',
  noteWrite: 'people.note.write',

  duplicateRead: 'people.duplicate.read',
  /** Deciding that two records are, or are not, one human being. */
  duplicateReview: 'people.duplicate.review',
  /**
   * Merging two people. Separate from reviewing, because a merge is effectively irreversible for
   * every module that has since referenced the record that loses.
   */
  personMerge: 'people.person.merge',

  importPeople: 'people.import',
  /** Taking the register out of the product. Separate, and held by fewer people than reading it. */
  exportPeople: 'people.export',
} as const;

export type PeoplePermission = (typeof PeoplePermissions)[keyof typeof PeoplePermissions];

export const ALL_PEOPLE_PERMISSIONS: readonly PeoplePermission[] = Object.values(PeoplePermissions);
