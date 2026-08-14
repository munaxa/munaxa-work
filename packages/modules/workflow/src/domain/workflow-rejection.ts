/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **codes, ordinals, states and identifiers — never a comment somebody wrote on a
 * decision, and never the name of an approver**. A refusal ends up in a log, an error tracker and on
 * a screen somebody left open, and "rejected by the finance director" is a disclosure about a
 * colleague's decision that the person refused was never entitled to. A rejection may say that a
 * step is not awaiting a decision, or that a version is already published; it says nothing about who
 * decided what.
 */

export interface WorkflowRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never a comment, a rationale or an approver's name.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type WorkflowResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: WorkflowRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): WorkflowResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `workflow.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): WorkflowResult<TValue> => ({ ok: true, value });
