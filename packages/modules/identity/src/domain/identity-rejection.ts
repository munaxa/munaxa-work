import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing (see `Result` in the kernel): "this membership
 * has already ended" is an outcome, not a bug, and modelling it as a value means the compiler
 * checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence. A domain that returned English
 * prose would be a domain that cannot be shown to an Arabic-speaking user, and no amount of
 * translating at the edge recovers a sentence that was built by concatenation.
 */
export interface IdentityRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the user reads. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. */
  readonly values?: Readonly<Record<string, string>>;
}

export type IdentityResult<TValue> = Result<TValue, IdentityRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): IdentityResult<TValue> =>
  err({
    reason,
    messageKey: `identity.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): IdentityResult<TValue> => ok(value);
