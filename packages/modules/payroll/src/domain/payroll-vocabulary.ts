/**
 * The ubiquitous language of Payroll, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and every absence is a boundary being kept rather than
 * described.
 *
 * *Tax*, *social security*, *pension*, *GOSI*, *minimum wage* and *end-of-service* are statutory
 * content no generic engine may hold (ADR-0067). They arrive, if ever, from a country pack through
 * `CountryRulePort`, and this module ships no rate, threshold, bracket or formula.
 *
 * *Posted* and *executed* are absent from every status list here. Payroll prepares an accounting
 * output and a payment instruction; nothing in this repository posts a journal or moves money, and
 * a status claiming otherwise would be the false statement the phase specification names.
 *
 * *Exchange rate* and *conversion* are absent because no authoritative rate owner exists (D-5).
 * Amounts in different currencies are kept apart, never combined.
 *
 * *Loan*, *advance*, *benefit* and *enrolment* are absent as entities: they exist here only as
 * values of `DEDUCTION_SOURCES`, reserving a classification for a domain that will own them.
 *
 * *Person*, *employment status*, *attendance day*, *leave request* and *compensation record* are
 * other modules' and are referenced by identifier, read through a published contract as at a date.
 *
 * The pattern is the one every module before this uses. A **state** is product behaviour and is
 * checked in the database. A **code** — a payroll treatment, a reason, a payment method, an account
 * reference, a statutory source — is tenant or country-pack data, validated by shape and never
 * against a list this product ships.
 */

/**
 * How often a payroll group pays. **Configuration, and nothing more.**
 *
 * It decides which default period dates are *proposed* and decides nothing else. It is never a
 * calculation input and never a proration denominator: whether a biweekly period divides by
 * fourteen calendar days or ten working days is a jurisdictional question (§18), and letting a
 * frequency answer it would smuggle a country rule into a dropdown.
 *
 * `custom` means the dates are supplied and no default is proposed — the honest representation of a
 * cadence this product does not model, which is cheaper than pretending to model all of them.
 */
export const PAY_FREQUENCIES = ['monthly', 'semi_monthly', 'biweekly', 'weekly', 'custom'] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

/**
 * The payroll period's lifecycle.
 *
 * Seven states, each with an invariant the domain enforces, and **no state that is not backed by
 * real functionality**. There is no `paid`, because nothing here pays.
 */
export const PERIOD_STATUSES = [
  'draft',
  'open',
  'calculating',
  'calculated',
  'approved',
  'finalized',
  'reversed',
] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/**
 * Which period transitions the domain permits.
 *
 * Stated as data rather than as a chain of conditionals, so the machine can be read in one glance
 * and tested as a table — the convention Employment established for its five statuses.
 */
export const PERIOD_TRANSITIONS: Readonly<Record<PeriodStatus, readonly PeriodStatus[]>> = {
  draft: ['open'],
  open: ['calculating', 'draft'],
  calculating: ['calculated', 'open'],
  calculated: ['approved', 'open', 'calculating'],
  approved: ['finalized', 'calculated'],
  finalized: ['reversed'],
  reversed: [],
} as const;

/**
 * The run's lifecycle, which is finer than the period's because a run is one execution.
 *
 * `stale` is the state this whole architecture exists to make reachable: a run whose sources have
 * moved since it was calculated. It is entered by reconciliation, never by an event, and it is
 * **not reachable from `finalized`** — a finalized run whose sources moved needs a correction run,
 * not a status change (ADR-0064).
 */
export const RUN_STATUSES = [
  'draft',
  'calculating',
  'calculated',
  'stale',
  'approved',
  'finalized',
  'reversed',
  'failed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  draft: ['calculating', 'failed'],
  calculating: ['calculated', 'failed'],
  calculated: ['stale', 'approved', 'calculating'],
  stale: ['calculating', 'failed'],
  approved: ['finalized', 'stale', 'calculated'],
  finalized: ['reversed'],
  reversed: [],
  failed: [],
} as const;

/**
 * What a run is for.
 *
 * A correction is a **new run** against a period whose previous run was finalized; a reversal
 * carries the negated lines of the run it names. Neither edits what came before, which is the whole
 * of the correction model (§26).
 */
export const RUN_KINDS = ['regular', 'correction', 'reversal'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/**
 * Where an earning line came from.
 *
 * **`attendance_overtime` is declared and unreachable.** Attendance publishes *candidate* minutes by
 * design (ADR-0054) and no approved overtime result exists, so no code path produces a line with
 * this source and a test asserts it. The value ships anyway to reserve the classification, so the
 * eventual Attendance contract does not require a migration of historical lines — and the test is
 * what stops it becoming reachable by accident (ADR-0065).
 */
export const EARNING_SOURCES = [
  'compensation_recurring',
  'compensation_one_time',
  'attendance_overtime',
  'leave_paid',
  'payroll_adjustment',
  'country_rule',
] as const;
export type EarningSource = (typeof EARNING_SOURCES)[number];

/**
 * Where a deduction line came from.
 *
 * Three are implemented generically. Three — `statutory`, `benefit`, `loan_advance` — are
 * **classifications with no producer in this phase**: their input contracts are defined so a future
 * domain has something to satisfy, and no table, entity or rule is created for them (ADR-0067).
 * Creating a loan schedule here would make Payroll the owner of a domain it must not own.
 */
export const DEDUCTION_SOURCES = [
  'unpaid_leave',
  'voluntary',
  'payroll_adjustment',
  'statutory',
  'benefit',
  'loan_advance',
] as const;
export type DeductionSource = (typeof DEDUCTION_SOURCES)[number];

/** How a configured deduction arrives at its amount. Exact integer arithmetic in both cases. */
export const DEDUCTION_BASES = ['fixed_amount', 'basis_points_of_gross'] as const;
export type DeductionBasis = (typeof DEDUCTION_BASES)[number];

/**
 * What a proration divides by.
 *
 * Stated on the payroll group and recorded on every prorated line, because there is **no universal
 * formula** and a system that picked one silently would be applying somebody's labour law to
 * everybody. Country compliance may later override the denominator; it may not change the fact that
 * the choice is recorded.
 */
export const PRORATION_BASES = ['calendar_days', 'working_days', 'scheduled_minutes'] as const;
export type ProrationBasis = (typeof PRORATION_BASES)[number];

/** Why a line was prorated. Recorded so a partial figure explains itself without a re-run. */
export const PRORATION_CAUSES = [
  'hired_mid_period',
  'ended_mid_period',
  'partial_period_component',
  'status_change_mid_period',
] as const;
export type ProrationCause = (typeof PRORATION_CAUSES)[number];

/**
 * The rounding modes the kernel's `Money` offers, restated so configuration can carry one as data.
 *
 * There is **no default**, here or in the kernel. Rounding happens at the **component level** — each
 * line is rounded to the currency's minor unit as it is produced, and gross and net are exact sums
 * of already-rounded lines. The alternative rounds the total independently, and then the lines on a
 * payslip do not add up to it: an employee who adds them is right and the system is wrong.
 */
export const ROUNDING_MODES = ['half-up', 'half-even', 'down', 'up'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** An accounting line's side. Payroll owns no chart of accounts; the account reference is a code. */
export const ACCOUNTING_DIRECTIONS = ['debit', 'credit'] as const;
export type AccountingDirection = (typeof ACCOUNTING_DIRECTIONS)[number];

/**
 * A payment instruction's state.
 *
 * `prepared` and nothing further. There is no `sent`, no `executed`, no `settled` and no `failed`,
 * because nothing in this repository transmits a payment and a state claiming progress the system
 * cannot make is worse than an absent feature (ADR-0067).
 */
export const PAYMENT_STATUSES = ['prepared', 'reversed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Why an employment was not calculated, or was calculated with a doubt recorded.
 *
 * Every one of these is a **real answer reported**, never a silent skip and never a zero. A payroll
 * that quietly pays nothing to somebody whose compensation is missing is the worst failure this
 * module has, because it looks exactly like a correct payroll of zero.
 */
export const EXCEPTION_CODES = [
  'compensation_missing',
  'attendance_snapshot_missing',
  'attendance_blocking_exceptions',
  'attendance_leave_state_unknown',
  'leave_unavailable',
  'employment_unresolved',
  'employment_ended_before_period',
  'currency_not_permitted',
  'net_would_be_negative',
  'cost_centre_missing',
  'duplicate_one_time',
  /**
   * The group's eligibility rule could not be evaluated for this employment.
   *
   * Distinct from being excluded by it. Both leave somebody unpaid and only one of them should:
   * this one is a broken configuration, and recording it means a misconfigured rule shows up as a
   * number somebody must resolve before the run can be finalized, rather than as a quietly smaller
   * payroll.
   */
  'eligibility_rule_failed',
] as const;
export type ExceptionCode = (typeof EXCEPTION_CODES)[number];

/** Which source moved after a calculation. Written by reconciliation, one row per employment. */
export const STALE_SOURCES = ['compensation', 'attendance', 'leave', 'employment'] as const;
export type StaleSource = (typeof STALE_SOURCES)[number];

/** What an adjustment does. The reason and the note beside it are required in every case. */
export const ADJUSTMENT_KINDS = ['earning', 'deduction'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** An approval decision, and the reversal that corrects a wrong one without erasing it. */
export const APPROVAL_DECISIONS = ['approved', 'rejected', 'reversed'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** ISO 4217 shape. Validated by shape, never against a list this product ships. */
export const isCurrencyCode = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/** Three decimal places is Jordan, Kuwait, Bahrain and Oman. Four exists. Beyond that is a defect. */
export const MAX_CURRENCY_EXPONENT = 4;

/** 100% in basis points, and the scale every basis-point calculation divides by. */
export const BASIS_POINT_SCALE = 10_000n;
export const MAX_BASIS_POINTS = 1_000_000;

/**
 * A tenant-authored code: lowercase, digits and hyphens, one to sixty-four characters.
 *
 * Single characters are permitted — the Compensation lesson. A pay grade is commonly `a`, and a
 * regex that refused it was a design defect inherited from a module whose codes happened to be
 * words.
 */
const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isCode = (value: string): boolean => CODE.test(value);

/** An ISO date, `YYYY-MM-DD`, validated for shape and for being a real day. */
export const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

export const isPayFrequency = (value: string): value is PayFrequency =>
  (PAY_FREQUENCIES as readonly string[]).includes(value);

export const isRoundingMode = (value: string): value is RoundingMode =>
  (ROUNDING_MODES as readonly string[]).includes(value);

export const isProrationBasis = (value: string): value is ProrationBasis =>
  (PRORATION_BASES as readonly string[]).includes(value);

export const isDeductionBasis = (value: string): value is DeductionBasis =>
  (DEDUCTION_BASES as readonly string[]).includes(value);

export const isDeductionSource = (value: string): value is DeductionSource =>
  (DEDUCTION_SOURCES as readonly string[]).includes(value);

export const isAdjustmentKind = (value: string): value is AdjustmentKind =>
  (ADJUSTMENT_KINDS as readonly string[]).includes(value);
