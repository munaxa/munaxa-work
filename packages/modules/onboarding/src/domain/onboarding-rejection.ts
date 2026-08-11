import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing: "this onboarding still has three required tasks
 * open" is an outcome an administrator caused and can act on, not a bug, and modelling it as a value
 * means the compiler checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence, so the message an Arabic-speaking
 * administrator reads is chosen at the edge from their language.
 *
 * The values interpolated into that message name *states, fields and codes* — never a person, an
 * employment identifier, a task note or a document reference. A refusal ends up in a log line, a
 * browser history entry and a support ticket, and this module's tasks are about a named human being.
 */
export interface OnboardingRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the reader uses. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. Never personal data. */
  readonly values?: Readonly<Record<string, string>>;
}

export type OnboardingResult<TValue> = Result<TValue, OnboardingRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): OnboardingResult<TValue> =>
  err({
    reason,
    messageKey: `onboarding.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): OnboardingResult<TValue> => ok(value);
