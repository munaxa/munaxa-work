/**
 * The ubiquitous language of Leave, in one file so the API, the contracts and the aggregates cannot
 * drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described. *Person*, *employee number*, *employment status* and *contracted hours* are
 * Employment's and People's, referenced by identifier and read as at a date (ADR-0051). *Rate*,
 * *multiplier*, *amount* and *value* are Compensation's and Payroll's: nothing in this module holds
 * money, and `paidTreatmentCode` is a code Leave stores and never interprets. *Schedule*, *shift*,
 * *roster* and *punch* are Attendance's; Leave asks Attendance what a working day is and does not
 * decide for itself.
 *
 * *Annual leave*, *sick leave*, *maternity*, *Hajj* and *Iddah* are absent too, and that is the most
 * deliberate absence here. Every one of them is a **leave type a tenant or a country pack
 * configures**. This module ships none, seeds none and branches on none (00B).
 *
 * The pattern is the one every module before this uses. A **state** is product behaviour and is
 * checked in the database. A **code** — a reason, a paid treatment, a gender restriction, a
 * statutory source — is tenant or country-pack data, validated by shape and never against a list
 * this product ships.
 */

/**
 * The unit a leave type is *expressed* in.
 *
 * Storage is always integer minutes regardless (§10.4). This is what a screen renders and what a
 * policy's limits are authored against — a tenant who thinks in days should not have to think in
 * minutes to configure a cap.
 */
export const LEAVE_UNITS = ['days', 'hours'] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];

/** Draft, published, superseded — as every versioned definition in this product. */
export const DEFINITION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

/**
 * How a request's length is counted.
 *
 * `working_days` asks Attendance which dates were expected and for how long. `calendar_days` counts
 * every date in the range, and it is a **configured** choice rather than a fallback: some statutory
 * leave genuinely is counted that way, and pretending calendar days are working days when nobody
 * could be asked would mis-charge somebody's entitlement (§19).
 */
export const DURATION_BASES = ['working_days', 'calendar_days'] as const;
export type DurationBasis = (typeof DURATION_BASES)[number];

/**
 * Which calendar a leave year is reckoned in.
 *
 * A first-class configuration rather than a display preference, because it changes *when
 * entitlement resets*. The conversion is the kernel's Umm al-Qura implementation; no Hijri
 * arithmetic exists in this module.
 */
export const LEAVE_YEAR_CALENDARS = ['gregorian', 'hijri'] as const;
export type LeaveYearCalendar = (typeof LEAVE_YEAR_CALENDARS)[number];

/**
 * How entitlement is produced.
 *
 * Six methods, closed — and not one of them carries a figure. `service_band` takes a
 * `RuleDefinition` evaluated by the kernel rule engine, which is how a country pack supplies bands
 * without a line of code here. That twenty-one days follow five years is Jordanian law, not this
 * product's opinion (§22).
 */
export const ACCRUAL_METHODS = [
  'none',
  'monthly',
  'weekly',
  'annual',
  'front_loaded',
  'service_band',
] as const;
export type AccrualMethod = (typeof ACCRUAL_METHODS)[number];

/** How a partial period is scaled. `none` means a period is either accrued in full or not at all. */
export const PRORATION_BASES = ['none', 'hire_date', 'calendar_month'] as const;
export type ProrationBasis = (typeof PRORATION_BASES)[number];

/** What happens to an unused balance when a leave year closes. `none` is the default: most do not. */
export const CARRY_OVER_METHODS = [
  'none',
  'unlimited',
  'capped_minutes',
  'capped_percent',
] as const;
export type CarryOverMethod = (typeof CARRY_OVER_METHODS)[number];

/** Where a policy assignment or a blackout applies. Most-specific-wins, resolved as at a date. */
export const SCOPES = ['tenant', 'legal_entity', 'unit', 'employment'] as const;
export type Scope = (typeof SCOPES)[number];

/** Where a grant of entitlement came from. Recorded so a figure stays explainable. */
export const ENTITLEMENT_SOURCES = [
  'opening',
  'accrual',
  'carry_over',
  'adjustment',
  'statutory',
] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/**
 * A movement in the ledger.
 *
 * Eight kinds, closed, and the sign convention is enforced by a check constraint rather than by
 * application code alone: credits positive, consumption and expiry negative, adjustments and
 * reversals either way. A ledger whose signs live in one language is a ledger that eventually sums
 * to the wrong number.
 */
export const LEDGER_KINDS = [
  'opening',
  'accrual',
  'carry_in',
  'carry_out',
  'consumption',
  'expiry',
  'adjustment',
  'reversal',
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Kinds that may only ever be credits. */
const CREDIT_KINDS: readonly LedgerKind[] = ['opening', 'accrual', 'carry_in'];

/** Kinds that may only ever be debits. */
const DEBIT_KINDS: readonly LedgerKind[] = ['consumption', 'expiry', 'carry_out'];

/**
 * Whether a kind and a sign agree, in the same terms the check constraint uses.
 *
 * Stated here as well as in the database deliberately: the constraint is the guarantee, and this is
 * the refusal a caller can read. A domain that only learned the rule from a `23514` would report it
 * as a system fault rather than as the mistake it is.
 */
export const signAgreesWithKind = (kind: LedgerKind, minutes: number): boolean => {
  if (CREDIT_KINDS.includes(kind)) return minutes > 0;
  if (DEBIT_KINDS.includes(kind)) return minutes < 0;
  return minutes !== 0;
};

/** What caused a ledger entry. The other half of the idempotency key. */
export const LEDGER_SOURCES = [
  'request',
  'accrual_run',
  'adjustment',
  'leave_year',
  'entitlement',
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

/**
 * A leave request's lifecycle.
 *
 * `submitted` is distinct from `pending_approval` because a policy may require no approval at all:
 * such a request goes `submitted → approved` with **no decision row**, and the absence of the row
 * is itself the record. Recording `system:auto-approval` as though a human had decided is the fake
 * completeness this phase refuses (ADR-0045).
 */
export const REQUEST_STATES = [
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'taken',
  'closed',
  'rejected',
  'cancelled',
  'withdrawn',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

/**
 * The state machine, as data.
 *
 * Data rather than a switch so the test can be exhaustive over **every** ordered pair — which is
 * the only way to know that a transition nobody thought about is refused rather than merely
 * untested.
 */
export const PERMITTED_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['pending_approval', 'approved', 'rejected', 'withdrawn'],
  pending_approval: ['approved', 'rejected', 'withdrawn'],
  approved: ['taken', 'cancelled', 'closed'],
  taken: ['closed', 'cancelled'],
  closed: [],
  rejected: [],
  cancelled: [],
  withdrawn: [],
} as const;

export const canTransition = (from: RequestState, to: RequestState): boolean =>
  PERMITTED_TRANSITIONS[from].includes(to);

/**
 * The states that consume balance and block a date.
 *
 * A draft asserts nothing and blocks nothing. A rejected or withdrawn request blocks nothing
 * either — which is why the overlap constraint is written over live rows and an amendment's
 * superseded days are soft-deleted out of its way.
 */
export const LIVE_REQUEST_STATES: readonly RequestState[] = [
  'submitted',
  'pending_approval',
  'approved',
  'taken',
  'closed',
];

export const isLive = (state: RequestState): boolean => LIVE_REQUEST_STATES.includes(state);

/** The states in which leave is actually granted, and therefore visible to Attendance. */
export const APPROVED_REQUEST_STATES: readonly RequestState[] = ['approved', 'taken', 'closed'];

export const isApproved = (state: RequestState): boolean => APPROVED_REQUEST_STATES.includes(state);

/**
 * How much of a date a request takes.
 *
 * `first_half`/`second_half` rather than a bare `half_day`, because two half-days on one date must
 * be distinguishable — and because a manager needs to know which half.
 */
export const DAY_PORTIONS = ['full_day', 'first_half', 'second_half', 'hours'] as const;
export type DayPortion = (typeof DAY_PORTIONS)[number];

/** A decision on a request. Two outcomes; there is no "deferred", because that is not a decision. */
export const DECISIONS = ['approved', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** What happened to a request, recorded as history rather than inferred from audit columns. */
export const REQUEST_EVENT_KINDS = [
  'created',
  'submitted',
  'decided',
  'approved',
  'rejected',
  'cancelled',
  'withdrawn',
  'amended',
  'superseded',
  'taken',
  'closed',
] as const;
export type RequestEventKind = (typeof REQUEST_EVENT_KINDS)[number];

/**
 * A code the tenant or a country pack supplies.
 *
 * Lower-case letters, digits and dashes: a shape, never a membership test against a list this
 * product ships. A reason code, a paid-treatment code, a gender restriction and a statutory source
 * are all this.
 */
const CODE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export const isEntityCode = (value: string): boolean => CODE.test(value);

/** A civil date — a date on somebody's calendar, not an instant. */
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isCivilDate = (value: string): boolean =>
  CIVIL_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** A wall-clock time of day, meaningless until something says which zone it is in. */
const WALL_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isWallClock = (value: string): boolean => WALL_CLOCK.test(value);

/** Minutes in a day. The bound every portion and every hourly range is measured against. */
export const MINUTES_IN_DAY = 1440;

/** Minutes from midnight, for a checked wall clock. Used for ordering, never for arithmetic on dates. */
export const minutesFromMidnight = (wallClock: string): number => {
  const [hours = '0', minutes = '0'] = wallClock.split(':');
  return Number(hours) * 60 + Number(minutes);
};
