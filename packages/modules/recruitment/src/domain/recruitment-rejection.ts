import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing: "this candidate has already applied to that
 * vacancy" is an outcome a recruiter caused and can act on, not a bug, and modelling it as a value
 * means the compiler checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence, so the message an Arabic-speaking
 * administrator reads is chosen at the edge from their language.
 *
 * The values interpolated into that message name *statuses, fields and codes* — never a candidate,
 * a name, an email address or a number. This module holds third-party personal data about people
 * who never consented to this system, and a refusal that echoed an address back would put it into a
 * log line, a browser history entry and a support ticket.
 */
export interface RecruitmentRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the reader uses. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. Never personal data. */
  readonly values?: Readonly<Record<string, string>>;
}

export type RecruitmentResult<TValue> = Result<TValue, RecruitmentRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): RecruitmentResult<TValue> =>
  err({
    reason,
    messageKey: `recruitment.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): RecruitmentResult<TValue> => ok(value);
