/**
 * The ubiquitous language of Compensation, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described. *Gross*, *net*, *tax*, *social security*, *contribution*, *arrears*, *payslip* and
 * *journal* are Payroll's: this module states entitlement and computes no payment. *Deduction* is
 * absent because deductions are out of scope for this phase entirely (D-1) — statutory deductions
 * are Payroll's and loan recovery is Phase 10.1's, and a competing concept here would create the
 * second owner this architecture forbids. *End-of-service*, *gratuity*, *pension* and *minimum
 * wage* are statutory content no generic module may hold (00B). *Person*, *employee number* and
 * *employment status* are Employment's and People's, referenced by identifier and read as at a date
 * (ADR-0051).
 *
 * *Basic salary*, *housing allowance*, *transport allowance* and *meal allowance* are absent too,
 * and that is the most deliberate absence here. Every one of them is a **component a tenant or a
 * country pack configures**. This module ships none, seeds none and branches on none.
 *
 * The pattern is the one every module before this uses. A **state** is product behaviour and is
 * checked in the database. A **code** — a reason, a payroll treatment, an adjustment type, a
 * progression model, a statutory source — is tenant or country-pack data, validated by shape and
 * never against a list this product ships.
 */

/** Draft, published, superseded — as every versioned definition in this product (ADR-0048). */
export const DEFINITION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

/**
 * What a component *is*.
 *
 * Three kinds, and `deduction` is not among them. The phase specification lists deduction
 * definitions as an aggregate root; decision D-1 excludes them from Phase 10 rather than shipping a
 * partial version, because a voluntary deduction is only meaningful against a net figure this
 * module does not compute, and loan recovery already belongs to Phase 10.1.
 */
export const COMPONENT_KINDS = ['base', 'allowance', 'one_time'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * How a component's amount is arrived at.
 *
 * `percentage_of_component` is exact integer arithmetic on basis points, never a float — and it is
 * resolved by *this* module rather than by Payroll or a screen, so one rounding mode produces one
 * answer (D-3).
 */
export const CALCULATION_BASES = ['fixed_amount', 'percentage_of_component'] as const;
export type CalculationBasis = (typeof CALCULATION_BASES)[number];

/** Whether a component recurs or is paid once. */
export const RECURRENCES = ['recurring', 'one_time'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/**
 * The rounding modes the kernel's `Money` offers.
 *
 * Restated here so a component definition can carry one as data. There is **no default**: the
 * caller knows whether a statute or a contract rounds half up or half to even, and guessing is how
 * a payroll ends up a fil out.
 */
export const ROUNDING_MODES = ['half-up', 'half-even', 'down', 'up'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Where a plan assignment applies. Most-specific-wins, resolved as at a date; ties are refused. */
export const SCOPES = ['tenant', 'legal_entity', 'unit', 'employment'] as const;
export type Scope = (typeof SCOPES)[number];

/** How specific each scope is. Higher wins; equal specificity on one date is a refused tie. */
export const SCOPE_SPECIFICITY: Readonly<Record<Scope, number>> = {
  tenant: 0,
  legal_entity: 1,
  unit: 2,
  employment: 3,
} as const;

/** What caused a compensation record. Recorded so a figure stays explainable. */
export const COMPENSATION_SOURCES = [
  'manual',
  'import',
  'adjustment',
  'plan_assignment',
  'offer',
] as const;
export type CompensationSource = (typeof COMPENSATION_SOURCES)[number];

/**
 * Where a compensation record stands with respect to approval.
 *
 * `not_required` is a first-class state and not a synonym for approved: a plan that requires no
 * approval produces a change with **no decision row**, and the absence of the row is itself the
 * record. Writing `system:auto-approval` as though a human had decided is the fake completeness
 * this phase refuses (ADR-0045, ADR-0060, D-9).
 */
export const APPROVAL_STATES = ['not_required', 'pending', 'approved', 'rejected'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/** What an approval decision may be. Two outcomes; "deferred" is not a decision. */
export const DECISIONS = ['approved', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** What an approval decision or a history row is *about*. */
export const SUBJECT_KINDS = ['recurring', 'one_time', 'adjustment'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** What happened, recorded as history rather than inferred from audit columns. */
export const CHANGE_KINDS = [
  'assigned',
  'amended',
  'superseded',
  'ended',
  'adjusted',
  'imported',
  'approved',
  'approval_reversed',
  'rejected',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Where a bulk load came from. A code, so no vendor-specific importer is implied. */
export const IMPORT_SOURCES = ['legacy', 'csv', 'api', 'bulk_adjustment', 'offer'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/**
 * A code the tenant or a country pack supplies.
 *
 * Lower-case letters, digits and dashes: a shape, never a membership test against a list this
 * product ships. A component code, a payroll treatment, an adjustment type, a progression model, a
 * reason and a statutory source are all this.
 *
 * **A single character is permitted**, and that differs deliberately from the pattern the other
 * modules use. Pay grades are very often named `a`, `b`, `c` — a one-letter band is the normal
 * shape in every grade structure anybody has described, and a rule inherited from a module whose
 * codes are words would have refused the commonest configuration in this one.
 */
const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isEntityCode = (value: string): boolean => CODE.test(value);

/** A civil date — a date on somebody's calendar, not an instant. */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isCivilDate = (value: string): boolean =>
  CIVIL_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** ISO 4217, upper case. Checked for shape; no list of currencies ships in this product. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export const isCurrencyCode = (value: string): boolean => CURRENCY_CODE.test(value);

/**
 * The denominator percentages are expressed against.
 *
 * Basis points, as integers: 40% is 4000, and 33.33% is 3333. Not a float anywhere, because a
 * percentage stored as `0.4` is the first place a payslip loses a fil.
 */
export const BASIS_POINT_SCALE = 10_000n;

/** A million basis points is 10,000% — far beyond anything meaningful, and a cheap sanity bound. */
export const MAX_BASIS_POINTS = 1_000_000;

/** Plausible decimal places for a currency. KWD, BHD and OMR are 3; JPY is 0. */
export const MAX_CURRENCY_EXPONENT = 4;

export const isDefinitionStatus = (value: string): value is DefinitionStatus =>
  (DEFINITION_STATUSES as readonly string[]).includes(value);

export const isComponentKind = (value: string): value is ComponentKind =>
  (COMPONENT_KINDS as readonly string[]).includes(value);

export const isCalculationBasis = (value: string): value is CalculationBasis =>
  (CALCULATION_BASES as readonly string[]).includes(value);

export const isRecurrence = (value: string): value is Recurrence =>
  (RECURRENCES as readonly string[]).includes(value);

export const isRoundingMode = (value: string): value is RoundingMode =>
  (ROUNDING_MODES as readonly string[]).includes(value);

export const isScope = (value: string): value is Scope =>
  (SCOPES as readonly string[]).includes(value);

export const isCompensationSource = (value: string): value is CompensationSource =>
  (COMPENSATION_SOURCES as readonly string[]).includes(value);

export const isSubjectKind = (value: string): value is SubjectKind =>
  (SUBJECT_KINDS as readonly string[]).includes(value);

export const isDecision = (value: string): value is Decision =>
  (DECISIONS as readonly string[]).includes(value);

export const isImportSource = (value: string): value is ImportSource =>
  (IMPORT_SOURCES as readonly string[]).includes(value);

/**
 * Whether two civil-date periods overlap, half-open.
 *
 * `[from, to)` — a period ending on the day the next begins does **not** overlap it, which is
 * exactly what the database's `daterange(..., '[)')` exclusion constraint means. Stated here as
 * well so the domain can refuse with a business reason rather than by catching a `23P01`; the
 * constraint remains the guarantee under concurrency.
 */
export const periodsOverlap = (
  left: { readonly from: string; readonly to?: string },
  right: { readonly from: string; readonly to?: string },
): boolean =>
  (right.to === undefined || left.from < right.to) &&
  (left.to === undefined || right.from < left.to);

/** Whether a civil date falls inside a half-open period. */
export const periodContains = (
  period: { readonly from: string; readonly to?: string },
  onDate: string,
): boolean => onDate >= period.from && (period.to === undefined || onDate < period.to);
