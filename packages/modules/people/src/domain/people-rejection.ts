import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing: "that national identifier already belongs to
 * somebody in this tenant" is an outcome an administrator caused and can act on, not a bug, and
 * modelling it as a value means the compiler checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * The `values` interpolated into that message are deliberately *non-identifying*. A refusal that
 * echoed a national identifier back would put it into a log line, a browser history entry and a
 * support ticket — this module's rejections name the kind of thing that clashed, never the value.
 */
export interface PeopleRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the reader uses. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. Never personal data. */
  readonly values?: Readonly<Record<string, string>>;
}

export type PeopleResult<TValue> = Result<TValue, PeopleRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): PeopleResult<TValue> =>
  err({
    reason,
    messageKey: `people.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): PeopleResult<TValue> => ok(value);
