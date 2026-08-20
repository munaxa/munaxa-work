import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';

/**
 * How long a step is expected to take, and whether it has taken longer.
 *
 * **Two things this is not.** It is not a deadline: nothing happens when it passes. And it is not a
 * state: no step becomes `expired`, no instance ends, no history is written, no branch changes and no
 * denominator moves (D-16C-06). What a target buys is a **question a reader can ask** — "has this
 * been waiting longer than somebody said it should?" — answered from two instants and an integer,
 * every time it is asked, and stored nowhere.
 *
 * That restraint is the whole design. A written `expired` state would need something to write it, and
 * the only things that could are a scheduler this phase does not have (D-16C-01) or a synthetic actor
 * ADR-0045 refuses (D-16C-02). A derived answer needs neither and cannot drift, because there is no
 * second record to disagree with the decisions.
 *
 * **Elapsed time, in whole hours or whole days** (D-16C-05). Not business days: Workflow holds no
 * calendar, and the one that exists publishes weekends but not holidays. A tenant whose weekend is
 * Friday and Saturday will find a two-day target elapsing across it, and that is a stated limit
 * rather than a bug — the alternative was an Organization dependency the approval declined.
 *
 * **The clock starts when the step becomes `awaiting`** (P-5), not when the approval started. For a
 * sequential chain the third step's clock starts when the second is answered; for a parallel branch
 * every step starts its own when the branch opens. Nothing restarts it: not an escalation, not a
 * delegation, not a decision on a sibling step. A step with no target has no due time at all, and
 * `dueAt` returning nothing is the honest answer rather than a distant date nobody set.
 */

/** The two units a target may be expressed in. Whole numbers of each; nothing smaller. */
export const SERVICE_LEVEL_UNITS = ['hours', 'days'] as const;
export type ServiceLevelUnit = (typeof SERVICE_LEVEL_UNITS)[number];

/**
 * A target somebody configured on a step template.
 *
 * A whole number and a unit, kept apart rather than normalized into milliseconds, because "two days"
 * is what an administrator typed and is what the screen must show them back. Normalizing would make
 * `2 days` and `48 hours` indistinguishable, and they are not the same sentence even where they are
 * the same duration.
 *
 * `count` rather than `amount`: an **amount** is money in this repository — Payroll and Compensation
 * both mean currency by it — and a duration borrowing the word would be the first business
 * vocabulary to reach a module that has none (AD-001). The domain's boundary suite catches it.
 */
export interface ServiceLevelTarget {
  readonly count: number;
  readonly unit: ServiceLevelUnit;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A target, checked.
 *
 * **A whole number of one or more, and no upper bound.** The lower bound is the same rule the quorum
 * carries: zero is not a duration and a negative one is not a mistake anybody can act on. The absence
 * of an upper bound is AD-004's rule about approval limits applied here — a ceiling would be a policy
 * about how long an approval may take, invented in a value object, and the storage's own integer
 * range is a property of the column rather than a rule about approvals.
 *
 * Fractions are refused rather than rounded. Half a day is a business rule about working hours that
 * this module cannot answer, and rounding one silently would answer it wrongly.
 */
export const serviceLevelTarget = (
  count: number,
  unit: string,
): WorkflowResult<ServiceLevelTarget> => {
  if (!Number.isInteger(count) || count < 1) return refuse('service-level-count-invalid');
  if (!isServiceLevelUnit(unit)) return refuse('service-level-unit-invalid');
  return accept({ count, unit });
};

export const isServiceLevelUnit = (value: string): value is ServiceLevelUnit =>
  SERVICE_LEVEL_UNITS.includes(value as ServiceLevelUnit);

/**
 * When a step falls due, from the instant it became awaiting.
 *
 * Exact arithmetic on milliseconds: an hour is 3,600,000 and a day is 86,400,000, with no calendar
 * consulted and therefore no daylight-saving shift applied. That is the honest consequence of
 * elapsed-time targets — a "one day" target is twenty-four hours, not "the same clock time
 * tomorrow", and across a spring-forward those differ by an hour.
 *
 * Absent when the step has no target, and absent when the step is not waiting for anybody: a step
 * that was never asked has no clock, and one already decided has stopped mattering. The caller
 * supplies `awaitingSince` only for a step that is actually awaiting, which is what makes this
 * function unable to invent a due time for a step nobody is waiting on.
 */
export const dueAt = (
  target: ServiceLevelTarget | undefined,
  awaitingSince: Date | undefined,
): Date | undefined => {
  if (target === undefined || awaitingSince === undefined) return undefined;
  const span = target.unit === 'hours' ? target.count * HOUR_MS : target.count * DAY_MS;

  return new Date(awaitingSince.getTime() + span);
};

/** How a step stands against its target, as a reader sees it at one instant. */
export type ServiceLevelState = 'none' | 'within' | 'overdue';

/**
 * Whether a step has been waiting longer than its target says it should, **as at a supplied
 * instant**.
 *
 * The instant is a parameter and never a clock this function reads. A domain that consulted the time
 * would be untestable at its own boundary and would give two different answers to one question asked
 * twice in a millisecond; every other instant in this module arrives the same way.
 *
 * **Due exactly on the boundary is `within`.** A target of one hour is met by an answer at exactly
 * one hour: the strict comparison is what makes "two hours to approve" mean two whole hours rather
 * than one hour and a fraction, and a reader watching the boundary tick over sees the transition
 * once rather than at an instant that depends on rounding.
 */
export const serviceLevelState = (
  target: ServiceLevelTarget | undefined,
  awaitingSince: Date | undefined,
  asAt: Date,
): ServiceLevelState => {
  const due = dueAt(target, awaitingSince);

  if (due === undefined) return 'none';
  return asAt.getTime() > due.getTime() ? 'overdue' : 'within';
};

/**
 * How long a step has been overdue, in whole minutes, or nothing when it is not.
 *
 * Whole minutes because a screen showing "overdue by 3,600,017 milliseconds" is a screen nobody
 * reads, and because every number this module publishes is an integer. Truncated rather than
 * rounded — a step three seconds past its target is overdue by **zero** minutes and not by one,
 * since claiming a minute that has not elapsed is the same overstatement as a percentage would be.
 *
 * `Math.trunc` rather than `Math.floor` is deliberate even though the value can never be negative
 * here: the two differ only for negatives, and the one that cannot silently turn a near-miss into a
 * whole unit in the wrong direction is the one to reach for.
 */
export const overdueByMinutes = (
  target: ServiceLevelTarget | undefined,
  awaitingSince: Date | undefined,
  asAt: Date,
): number | undefined => {
  const due = dueAt(target, awaitingSince);

  if (due === undefined || asAt.getTime() <= due.getTime()) return undefined;
  return Math.trunc((asAt.getTime() - due.getTime()) / 60_000);
};
