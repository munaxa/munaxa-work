/**
 * The closed sets this module recognises in Checkpoint 1, and the ones it deliberately does not hold.
 *
 * **`ASSET_STATUSES` holds four of the specification's seven, and the three that are missing are the
 * point.** The specification's lifecycle runs *Registered → Available → Issued → In Custody →
 * Returned → Under Repair → Retired.* Three of those — `issued`, `in_custody`, `returned` — are not
 * facts about an asset at all; they are facts about **custody**, and custody is Checkpoint 2's table.
 * Persisting them here would put a second, staler answer beside the authority: ADR-0070 says a stored
 * flag that nothing maintains is worse than no flag, and D-5.2-16 chose a derived read over a
 * persisted projection for the same reason. They are derived from `asset_custody` when it exists.
 *
 * The database CHECK is closed at these four and widens by an approved change, exactly as
 * `workflow_history`'s event CHECK was widened for `step-reminded`. A vocabulary listing a state
 * nothing can produce is a promise the code cannot keep.
 *
 * **There is no condition scale here, and no valuation basis.** D-5.3-05 is open and nothing in this
 * checkpoint records a condition; D-5.3-03 is open and nothing here computes or authorizes money.
 * Shipping either as configuration no code reads is the `repeat_window_days` mistake, and this module
 * declines to repeat it.
 */

export const ASSET_STATUSES = ['registered', 'available', 'under_repair', 'retired'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const isAssetStatus = (value: string): value is AssetStatus =>
  (ASSET_STATUSES as readonly string[]).includes(value);

/**
 * Which moves the domain permits, stated as data rather than as a chain of conditionals.
 *
 * `registered` is where an asset starts — known to exist, not yet in service. `retired` is terminal:
 * an asset leaves service permanently, and nothing brings it back, because an asset that returned
 * from retirement would make the retirement date meaningless. Repair is a round trip, so
 * `under_repair` goes back to `available`.
 *
 * **Nothing here transitions on custody.** An asset does not become `issued` — a custody row says who
 * holds it, and this table does not duplicate that answer.
 */
export const PERMITTED_ASSET_TRANSITIONS: Readonly<Record<AssetStatus, readonly AssetStatus[]>> = {
  registered: ['available', 'retired'],
  available: ['under_repair', 'retired'],
  under_repair: ['available', 'retired'],
  retired: [],
};

export const permitsAssetTransition = (from: AssetStatus, to: AssetStatus): boolean =>
  PERMITTED_ASSET_TRANSITIONS[from].includes(to);

/** Where an asset starts. Registered is not in service: it is known to exist and nothing more. */
export const INITIAL_ASSET_STATUS: AssetStatus = 'registered';

/**
 * The shape a code must take: lower-case, digits and hyphens, no leading or trailing hyphen.
 *
 * The same expression `document_type`, `letter_template` and `relation_violation_category` already
 * enforce, so a tenant meets one rule for what a code looks like across this product rather than four.
 */
const ENTITY_CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isEntityCode = (value: string): boolean => ENTITY_CODE.test(value);
