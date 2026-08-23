import type { ViolationRecord } from './violation.js';

/**
 * How many times before — the fact every disciplinary decision needs and none of them may store.
 *
 * **Derived at read time, persisted nowhere.** There is no `occurrence` column, no `repeat_count`,
 * no `is_repeat`, no `breached` and no `escalation_level` anywhere in this module, and a
 * negative-space suite fails if one appears. A stored count is correct until somebody records a
 * violation and the count is not updated; a derived one is correct because it is the violations. The
 * same argument D-5.2-16 made for case state, applied to a number instead of a state.
 *
 * **It makes an existing setting mean something.** `repeat_window_days` has been tenant-configurable
 * since Checkpoint 1 and nothing has ever read it — the ADR-0070 shape, *"a stored flag that nothing
 * maintains is worse than no flag"*. This is the code that reads it.
 *
 * **It decides nothing.** The result says how many and within what window; it does not say what that
 * means, what it should attract, or whether a threshold was crossed. What a repeat produces is
 * D-5.2-20, deliberately still OPEN, and the vocabulary of disciplinary actions does not exist here.
 */

/**
 * The boundary semantics, stated once and asserted exhaustively.
 *
 * * **The window is a civil-date span, closed at both ends.** For `windowDays = 180` and a reference
 *   date of `2026-08-23`, the window is `2026-02-24 … 2026-08-23` inclusive. A violation on the
 *   first day of that span counts; one the day before does not.
 * * **Civil dates, never instants.** Conduct happened on a day in the tenant's world. Comparing
 *   `YYYY-MM-DD` strings is exact and needs no time zone; converting to a timestamp would attach one
 *   to a fact that has none.
 * * **The reference date is the server's**, or an explicit `asAt` a caller may pass. `asAt` moves the
 *   window, never a record: nothing is written by this derivation, so nothing can be backdated by it.
 * * **A violation on the reference date itself counts**, because conduct reported today is conduct.
 * * **`windowDays = 0` means the reference date alone** — a window of no days back, not a window of
 *   none at all. A category configured that way counts same-day repeats and nothing earlier.
 * * **Ordering is `(occurred_on, violationId)` ascending**, so two violations on one day are ordered
 *   deterministically by identifier and an occurrence ordinal never depends on insertion order or on
 *   what the planner returned first.
 */
export interface EscalationContext {
  readonly employmentId: string;
  readonly violationCategoryId: string;
  /** The reference civil date the window was measured back from. */
  readonly asAt: string;
  readonly windowDays: number;
  /** The first civil date inside the window. Inclusive. */
  readonly windowFrom: string;
  /** How many violations of this category fall inside the window, this one included. */
  readonly occurrences: number;
  /** Those violations, oldest first. Identifiers only — nothing about the person. */
  readonly violationIds: readonly string[];
}

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The civil date `days` before `asAt`, inclusive — the first day inside the window.
 *
 * Computed in UTC from a date-only string, which is exact: `Date.UTC` on a `YYYY-MM-DD` has no time
 * component to drift, and subtracting whole days from midnight UTC cannot cross a daylight-saving
 * boundary the way local-time arithmetic would. Attendance's zoned-time helpers solve a different
 * problem — an instant that must be placed in a tenant's day — and this is the opposite direction.
 */
export const windowStart = (asAt: string, days: number): string => {
  const [year, month, day] = asAt.split('-').map(Number);
  const anchor = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);

  return new Date(anchor - days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
};

export const byOccurrenceThenId = (left: ViolationRecord, right: ViolationRecord): number =>
  left.occurredOn.localeCompare(right.occurredOn) ||
  left.violationId.localeCompare(right.violationId);

export interface EscalationRequest {
  readonly employmentId: string;
  readonly violationCategoryId: string;
  readonly windowDays: number;
  readonly asAt: string;
  /**
   * The employment's violations of this category, as read from persisted data.
   *
   * Filtered here rather than trusted: the caller passes what it read, and this function decides
   * what counts. A repository that widened its query by accident would not silently widen the count.
   */
  readonly violations: readonly ViolationRecord[];
}

export const escalationContext = (request: EscalationRequest): EscalationContext => {
  const windowFrom = windowStart(request.asAt, request.windowDays);
  const inWindow = request.violations
    .filter(
      (violation) =>
        violation.violationCategoryId === request.violationCategoryId &&
        violation.employmentId === request.employmentId &&
        violation.occurredOn >= windowFrom &&
        violation.occurredOn <= request.asAt,
    )
    .sort(byOccurrenceThenId);

  return {
    employmentId: request.employmentId,
    violationCategoryId: request.violationCategoryId,
    asAt: request.asAt,
    windowDays: request.windowDays,
    windowFrom,
    occurrences: inWindow.length,
    violationIds: inWindow.map((violation) => violation.violationId),
  };
};

/**
 * Where one violation sits in its own window — 1 for a first occurrence, 3 for a third.
 *
 * The window is measured back from **the violation's own conduct date**, not from today, so an
 * ordinal does not change meaning as time passes: a violation that was the third occurrence when it
 * happened is still the third occurrence when read a year later. Counting back from today instead
 * would silently renumber history every night.
 *
 * Returns `undefined` when the violation is not among those supplied, which is a defect in the
 * caller rather than an answer — and is refused rather than reported as occurrence zero.
 */
export const occurrenceOf = (
  violation: ViolationRecord,
  windowDays: number,
  violations: readonly ViolationRecord[],
): number | undefined => {
  const context = escalationContext({
    employmentId: violation.employmentId,
    violationCategoryId: violation.violationCategoryId,
    windowDays,
    asAt: violation.occurredOn,
    violations,
  });
  const position = context.violationIds.indexOf(violation.violationId);

  return position === -1 ? undefined : position + 1;
};
