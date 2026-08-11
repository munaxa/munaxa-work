/**
 * The ubiquitous language of Employment, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described.
 *
 * *On leave* is not a status here. An employee on annual leave is employed, and their leave is
 * Leave's (Phase 9) — two modules holding "is this person on leave" would produce two answers, and
 * the one that is wrong is whichever screen read the other.
 *
 * *Retired* and *archived* are not statuses either. Retirement is a *reason* an employment ended,
 * with statutory consequences that differ in every market this product sells into, and a status
 * called `retired` would be a product opinion about labour law (00B). Archival is a retention
 * decision, not a state of a working relationship.
 *
 * *Salary*, *grade*, *pay element*, *shift*, *timesheet*, *balance*, *entitlement*, *clearance*
 * and *settlement* appear nowhere: Compensation, Attendance, Leave and Offboarding own those.
 */

/**
 * The lifecycle of an employment.
 *
 * `draft` — recorded, not yet real. A hire being prepared, an import that has not been checked.
 * `pending_approval` — submitted and awaiting a human decision. It is a *state*, not an approval
 * engine: nothing here routes, assigns or escalates, because approvals are Workflow's (Phase 16).
 * Modelling the state now is what lets Workflow drive it later without reshaping this aggregate.
 * `active` — the employment is in force. This is the state every later module means by "employed".
 * `suspended` — in force but stood down. The relationship survives, which is precisely what
 * distinguishes it from ending: a suspended employee is still employed, and their contract, their
 * assignment and their service length all continue to exist.
 * `ended` — terminal. Dated and explained, and never reopened: somebody returning is a *new*
 * employment with a new number and the same Person (AD-004).
 */
export const EMPLOYMENT_STATUSES = [
  'draft',
  'pending_approval',
  'active',
  'suspended',
  'ended',
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/**
 * Which transitions the domain permits.
 *
 * Stated as data rather than as a chain of conditionals, so the machine can be read in one glance
 * and tested exhaustively — every pair, permitted or refused, rather than the handful somebody
 * thought of.
 *
 * Two entries are worth defending. `draft → active` exists because not every customer approves a
 * hire in this system, and forcing a pointless `pending_approval` hop would teach administrators
 * to click through a state that means nothing. `suspended → ended` exists because a suspension
 * that concludes in dismissal must not require reinstating somebody first.
 *
 * Nothing leaves `ended`. A terminal state that could be reopened is not terminal, and every
 * later module — payroll, settlement, reporting — reads it as final.
 */
export const PERMITTED_TRANSITIONS: Readonly<
  Record<EmploymentStatus, readonly EmploymentStatus[]>
> = {
  draft: ['pending_approval', 'active', 'ended'],
  pending_approval: ['draft', 'active', 'ended'],
  active: ['suspended', 'ended'],
  suspended: ['active', 'ended'],
  ended: [],
};

export const canTransition = (from: EmploymentStatus, to: EmploymentStatus): boolean =>
  PERMITTED_TRANSITIONS[from].includes(to);

/** An employment that may still be amended. An ended one is the record of what happened. */
export const acceptsAmendment = (status: EmploymentStatus): boolean => status !== 'ended';

/** An employment that occupies a place in the organization, and counts toward a headcount. */
export const isOpen = (status: EmploymentStatus): boolean => status !== 'ended';

/**
 * Whether an assignment is the employment's main organizational placement.
 *
 * Explicit rather than inferred from insertion order (AD-005, §15). An employment has at most one
 * open `primary` assignment, and the database enforces that as well as the domain: two
 * simultaneous primaries is not a display problem, it is two answers to "which department is this
 * person in".
 */
export const ASSIGNMENT_TYPES = ['primary', 'secondary'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

/**
 * What kind of reporting relationship a line records.
 *
 * `primary` is the one an employment has at most one of at a time, and the only one this phase
 * creates. `functional` exists as the shape a matrix or dotted-line relationship arrives through
 * later, so adding one is a value rather than a migration. §16 is silent on multiplicity, and
 * inventing dotted-line semantics now would be inventing a business rule the specification did not
 * ask for.
 */
export const REPORTING_LINE_TYPES = ['primary', 'functional'] as const;
export type ReportingLineType = (typeof REPORTING_LINE_TYPES)[number];

/**
 * How a probation period concluded.
 *
 * There is no `failed`. A failed probation *ends the employment*, which is a status transition
 * carrying its own reason, its own audit and its own events — recording it quietly on a contract
 * row would leave somebody's employment showing `active` while the business believed it was over.
 */
export const PROBATION_OUTCOMES = ['pending', 'passed', 'waived'] as const;
export type ProbationOutcome = (typeof PROBATION_OUTCOMES)[number];

/**
 * A stable, human-authored code, unique within its tenant and its kind.
 *
 * ASCII by design, for the same reason Organization's and People's codes are: a code travels into
 * payroll files, bank formats and government uploads, where a non-ASCII character is a rejected
 * submission.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

/**
 * A civil date as `YYYY-MM-DD`.
 *
 * An employment's dates are civil dates rather than instants. A start date is the same date in
 * Riyadh and in London; stored as a timestamp it shifts across a zone boundary, and a start date
 * that moves by a day changes a probation end, a notice period and — in several of this product's
 * markets — an end-of-service entitlement.
 */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * A reference into the document store.
 *
 * Employment records that a contract document exists and where it lives. It stores no bytes and
 * builds no document management (§24) — that is the future Documents domain's, and this is the
 * seam it will be reached through.
 */
export const isDocumentReference = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);
