/**
 * The ubiquitous language of Organization, in one file so the API, the contracts and the
 * aggregates cannot drift into three spellings of the same idea.
 *
 * One word is deliberately absent from this file: *employee*. Organization owns structure and
 * Employment owns assignments (AD-001, AD-002). There is no headcount here, no manager, no
 * reporting line and no attendance — and their absence is the boundary being kept rather than
 * described.
 *
 * The nine level names the specification lists — company, legal entity, business unit, branch,
 * division, section, department, team — are *not* in this file either, and that is the point of
 * ADR-0034. They are tenant data in `organization_unit_type`, because a fixed list of levels is
 * a fixed maximum depth, and AD-003 forbids one.
 */

/**
 * The lifecycle of an organizational entity.
 *
 * `active` — part of the organization now.
 * `inactive` — retained and referenceable, but not to be offered for new structure. A branch
 * between closing and its final payroll run is exactly this, and deleting it would orphan the
 * history that still points at it.
 * `closed` — terminal. The entity no longer exists in the organization, and the rows that
 * reference it still resolve, because history is evidence (AD-005).
 */
export const ORGANIZATION_STATUSES = ['active', 'inactive', 'closed'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

/** An entity that may be given new children, new positions or a new establishment. */
export const acceptsNewStructure = (status: OrganizationStatus): boolean => status === 'active';

/**
 * How critical a position is to the organization, consumed by Career & Succession in Phase 15.
 *
 * Ordered least to most so a consumer may compare by index without this module publishing a
 * numeric scale it would then have to keep stable.
 */
export const POSITION_CRITICALITIES = ['standard', 'important', 'critical'] as const;
export type PositionCriticality = (typeof POSITION_CRITICALITIES)[number];

/**
 * An establishment line is budgeted headcount, and budgeted headcount is approved or it is a
 * proposal. `draft` may be edited freely; `approved` is what a recruitment requisition is
 * validated against (Phase 6).
 */
export const ESTABLISHMENT_STATUSES = ['draft', 'approved', 'withdrawn'] as const;
export type EstablishmentStatus = (typeof ESTABLISHMENT_STATUSES)[number];

/**
 * What a calendar says about one date.
 *
 * `holiday` — a non-working day the organization declares. Which dates these are is tenant and
 * country data, never ours: nothing in this module knows a single national holiday, and adding
 * a country must never require changing this file (00B).
 * `working` — a working day that the ordinary working week would have made non-working. A
 * Saturday opened for a stock count is this.
 * `non-working` — a non-working day that is not a holiday. A planned shutdown is this.
 */
export const CALENDAR_DAY_KINDS = ['holiday', 'working', 'non-working'] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

/**
 * Days of the week as ISO-8601 numbers: Monday is 1, Sunday is 7.
 *
 * ISO rather than the zero-based Sunday-first convention because the working week in this
 * product's first markets does not start on Sunday *or* Monday uniformly, and a convention that
 * privileges one of them invites the arithmetic that assumes the other. The working week is
 * tenant configuration; nothing here has a default.
 */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export const isIsoWeekday = (value: number): value is IsoWeekday =>
  Number.isInteger(value) && value >= 1 && value <= 7;

/**
 * An ISO 3166-1 alpha-2 country code, validated as a *shape* and never against a list.
 *
 * A hardcoded list of countries is a code change every time the product sells somewhere new,
 * which 00B prohibits outright. The country pack (Phase 11.1) is what knows whether a code has
 * statutory content behind it; this module only records which country a legal entity is
 * registered in and refuses something that is not a country code at all.
 */
export const isCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);

/**
 * An ISO 4217 currency code, likewise validated by shape only.
 *
 * Currency belongs to the legal entity rather than the tenant for the same reason the country
 * does: a group operating in Riyadh and Amman has two of each, and a tenant-level currency would
 * force a second tenant per country (00B).
 */
export const isCurrencyCode = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/**
 * A stable, human-authored identifier for an organizational entity, unique within its tenant.
 *
 * Codes exist because every customer already has them — `HR-01`, `RUH-BRANCH`, `CC-4400` — and
 * an import that could not carry them would arrive as a structure nobody recognizes. They are
 * ASCII by design: a code travels into payroll files, bank formats and government uploads,
 * where a non-ASCII character is a rejected submission. The *names* are `LocalizedText` and
 * carry the Arabic.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
