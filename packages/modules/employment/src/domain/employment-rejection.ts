import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing: "this person already has an open employment" is
 * an outcome an administrator caused and can act on, not a bug, and modelling it as a value means
 * the compiler checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence, so the message an Arabic-speaking
 * administrator reads is chosen at the edge from their language.
 *
 * The values interpolated into that message name *statuses, fields and codes* — never a person, a
 * name or a number. A refusal that echoed an employee number back would put it into a log line, a
 * browser history entry and a support ticket.
 */
export interface EmploymentRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the reader uses. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. Never personal data. */
  readonly values?: Readonly<Record<string, string>>;
}

export type EmploymentResult<TValue> = Result<TValue, EmploymentRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): EmploymentResult<TValue> =>
  err({
    reason,
    messageKey: `employment.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): EmploymentResult<TValue> => ok(value);
