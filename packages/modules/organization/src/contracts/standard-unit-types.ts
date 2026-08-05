/**
 * The nine levels the phase specification names, offered as a starting set — and offered rather
 * than installed.
 *
 * This is the honest place for them. ADR-0034 makes the levels of a hierarchy tenant data, which
 * is what makes unlimited depth true rather than claimed (AD-003); but the nine names are the
 * specification's ubiquitous language and most customers do want most of them. Deleting them from
 * the product entirely would make every new tenant type them in, and hardcoding them into the
 * schema would put a fixed ladder back into a design that exists to have none.
 *
 * So they live here, in the contracts, as **data an administrator may adopt**. Nothing creates
 * them. An administration screen offers them, the import format accepts them, and a tenant whose
 * structure is company / region / store adopts none of them and is not worse off.
 *
 * The `allowedParentCodes` are the specification's high-level model expressed as configuration —
 * and note that they are *suggestions inside a suggestion*: a tenant that adopts these may then
 * edit them, because a holding company with a legal entity under a legal entity is ordinary and
 * a ladder that forbade it would be wrong for a real customer on day one.
 *
 * The names are in both first-class languages, because a tenant that adopts this set and never
 * edits it must still have an org chart that reads correctly in Arabic.
 */

export interface StandardUnitType {
  readonly code: string;
  readonly name: { readonly en: string; readonly ar: string };
  readonly ordinal: number;
  readonly allowedParentCodes: readonly string[];
  readonly allowedAtRoot: boolean;
  readonly carriesLegalEntity: boolean;
}

export const STANDARD_UNIT_TYPES: readonly StandardUnitType[] = [
  {
    code: 'company',
    name: { en: 'Company', ar: 'شركة' },
    ordinal: 10,
    allowedParentCodes: [],
    allowedAtRoot: true,
    carriesLegalEntity: false,
  },
  {
    code: 'legal-entity',
    name: { en: 'Legal entity', ar: 'كيان قانوني' },
    ordinal: 20,
    // A legal entity under a company, or under another legal entity — a group registers
    // subsidiaries under subsidiaries, and refusing that would be wrong for a real customer.
    allowedParentCodes: ['company', 'legal-entity'],
    allowedAtRoot: true,
    carriesLegalEntity: true,
  },
  {
    code: 'business-unit',
    name: { en: 'Business unit', ar: 'وحدة أعمال' },
    ordinal: 30,
    allowedParentCodes: ['company', 'legal-entity', 'business-unit'],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
  {
    code: 'branch',
    name: { en: 'Branch', ar: 'فرع' },
    ordinal: 40,
    allowedParentCodes: ['legal-entity', 'business-unit', 'branch'],
    allowedAtRoot: false,
    // Some jurisdictions register a branch separately. Adopting the set does not commit a tenant
    // to that; editing this flag is how a tenant says its branches are registered.
    carriesLegalEntity: false,
  },
  {
    code: 'division',
    name: { en: 'Division', ar: 'قطاع' },
    ordinal: 50,
    allowedParentCodes: ['legal-entity', 'business-unit', 'branch', 'division'],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
  {
    code: 'department',
    name: { en: 'Department', ar: 'إدارة' },
    ordinal: 60,
    allowedParentCodes: ['branch', 'division', 'business-unit', 'department'],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
  {
    code: 'section',
    name: { en: 'Section', ar: 'قسم' },
    ordinal: 70,
    allowedParentCodes: ['department', 'section'],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
  {
    code: 'team',
    name: { en: 'Team', ar: 'فريق' },
    ordinal: 80,
    allowedParentCodes: ['department', 'section', 'team'],
    allowedAtRoot: false,
    carriesLegalEntity: false,
  },
];
