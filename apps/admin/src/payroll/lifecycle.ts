import type { PayrollExceptionView, PayrollRunView } from '@work/payroll/contracts';

/**
 * Which actions a run's state permits, and which it does not.
 *
 * **This is not authorization.** The API is authoritative and refuses every one of these
 * independently — `run_finalized`, `run_is_stale`, `run_has_unresolved_exceptions`,
 * `self_approval_not_permitted` — and a caller with `curl` reaches the same handler this screen
 * does. What this gives a payroll operator is an interface that does not offer them an action the
 * system is going to refuse, which is a usability property rather than a security one. Hiding a
 * control has never stopped anybody, and nothing here relies on it having done so.
 *
 * The rules are read straight off the run's own state, not recomputed from parts:
 *
 * - **Finalized** shows neither Calculate, nor Adjust, nor Approve. The figures are frozen at the
 *   table by a trigger (ADR-0066); the remedy for a wrong finalized run is Reverse, which creates
 *   new state rather than editing old state.
 * - **Reversed** shows nothing but reading. It is terminal.
 * - **Stale** shows neither Approve nor Finalize. A source moved after the run was calculated, so
 *   approving it would be approving figures that no longer follow from their inputs. Reconcile and
 *   recalculate first.
 * - **Incomplete** — the cursor has not covered the population — shows neither Approve nor
 *   Finalize, for the same reason: half a payroll is not a payroll.
 * - **Unresolved `eligibility_rule_failed`** blocks Finalize. That exception means the group's
 *   eligibility rule could not be evaluated for somebody, which is a broken configuration rather
 *   than a decision to leave them out — finalizing over it would quietly pay a smaller workforce.
 */

export const PAYROLL_ACTIONS = [
  'calculate',
  'reconcile',
  'approve',
  'finalize',
  'reverse',
  'adjust',
] as const;
export type PayrollAction = (typeof PAYROLL_ACTIONS)[number];

/** The exception codes that must be resolved before a run may be finalized. */
const BLOCKING = new Set(['eligibility_rule_failed']);

export const blockingExceptions = (
  exceptions: readonly PayrollExceptionView[],
): readonly PayrollExceptionView[] =>
  exceptions.filter(
    (raised) => raised.resolvedAt === undefined && BLOCKING.has(raised.exceptionCode),
  );

export const unresolvedExceptions = (
  exceptions: readonly PayrollExceptionView[],
): readonly PayrollExceptionView[] =>
  exceptions.filter((raised) => raised.resolvedAt === undefined);

export interface RunPosture {
  readonly frozen: boolean;
  readonly stale: boolean;
  readonly incomplete: boolean;
  readonly blocked: boolean;
}

export const postureOf = (
  run: PayrollRunView,
  exceptions: readonly PayrollExceptionView[],
): RunPosture => ({
  frozen: run.status === 'finalized' || run.status === 'reversed',
  stale: run.status === 'stale',
  incomplete: !run.complete,
  blocked: blockingExceptions(exceptions).length > 0,
});

/**
 * The actions this run's state permits.
 *
 * Returned as a set the screen renders from, rather than as six booleans read at six call sites —
 * one of which would eventually disagree with the others.
 */
export const actionsFor = (
  run: PayrollRunView | undefined,
  exceptions: readonly PayrollExceptionView[] = [],
): ReadonlySet<PayrollAction> => {
  if (run === undefined) return new Set();

  const posture = postureOf(run, exceptions);
  const permitted = new Set<PayrollAction>();

  // A reversed run is terminal: it offers nothing, not even a reversal of itself.
  if (run.status === 'reversed') return permitted;

  if (posture.frozen) {
    // Finalized. The one thing left is the explicit correction path.
    permitted.add('reverse');
    return permitted;
  }

  permitted.add('calculate');
  permitted.add('reconcile');
  permitted.add('adjust');

  if (posture.stale || posture.incomplete) return permitted;

  permitted.add('approve');
  if (run.approvedAt !== undefined && !posture.blocked) permitted.add('finalize');
  return permitted;
};

/** Why an action is not offered, as a catalogue key — never a blank, disabled control. */
export const withheldBecause = (
  run: PayrollRunView | undefined,
  exceptions: readonly PayrollExceptionView[] = [],
): string | undefined => {
  if (run === undefined) return undefined;

  const posture = postureOf(run, exceptions);

  if (posture.frozen) return 'payroll.notice.finalizedRun';
  if (posture.stale) return 'payroll.notice.staleRun';
  if (posture.blocked) return 'payroll.notice.unresolvedExceptions';
  return undefined;
};
