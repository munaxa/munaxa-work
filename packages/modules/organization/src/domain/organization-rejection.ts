import { err, ok, type Result } from '@work/kernel';

/**
 * A refusal the business expects.
 *
 * Domain rules return these rather than throwing: "that parent is one of this unit's own
 * descendants" is an outcome an administrator caused and can correct, not a bug, and modelling
 * it as a value means the compiler checks that every caller handled it.
 *
 * Each rejection carries a catalogue key rather than a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language. A domain that
 * returned English prose could not be shown to half this product's users.
 */
export interface OrganizationRejection {
  /** Stable, greppable, and safe to branch on. Never shown to a user. */
  readonly reason: string;
  /** The catalogue key that renders this refusal, in whichever language the reader uses. */
  readonly messageKey: string;
  /** Values interpolated into the catalogue template. */
  readonly values?: Readonly<Record<string, string>>;
}

export type OrganizationResult<TValue> = Result<TValue, OrganizationRejection>;

export const refuse = <TValue>(
  reason: string,
  values?: Readonly<Record<string, string>>,
): OrganizationResult<TValue> =>
  err({
    reason,
    messageKey: `organization.rejection.${reason}`,
    ...(values === undefined ? {} : { values }),
  });

export const accept = <TValue>(value: TValue): OrganizationResult<TValue> => ok(value);
