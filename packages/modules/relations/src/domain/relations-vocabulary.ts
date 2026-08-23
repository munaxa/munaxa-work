/**
 * The closed sets this module recognises, and the one it deliberately does not close.
 *
 * **`severity` is not here, and its absence is the point.** AD-002 says violation categories are
 * *"tenant configurable … Nothing is hardcoded"*, so a fixed list of severities would be this
 * product deciding what "gross misconduct" means for every customer in every jurisdiction. Severity
 * is a **label a tenant chooses**, and nothing in this module orders by it — ordering comes from the
 * catalogue's own `sequence` (D-5.2-07), which is data.
 *
 * **`countryPackSource` is a boundary marker, not statutory content.** `tenant` means the tenant
 * wrote this rule; `country_pack` means a statutory pack did. **No pack exists yet** —
 * `packages/country-packs` *"deliberately exports nothing yet … Filled in Phase 11.1"* — so every
 * row written today is `tenant`. The discriminator ships now so that when packs arrive, a row's
 * provenance is already recorded rather than guessed. It is the same marker `attendance_policy.source`
 * carries and the same pair of columns `document_type` carries (D-5.2-06).
 *
 * **`VIOLATION_STATES` holds exactly one value in Checkpoint 1, and that is honest rather than
 * unfinished.** The specification's lifecycle runs *Reported → Under Investigation → Findings →
 * Pending Approval → Action Issued → …*, and every state after the first is reached by a capability
 * Checkpoint 1 does not build. A vocabulary listing states nothing can produce would be a promise
 * the code cannot keep; the database CHECK is closed at `reported` and widens by an approved change,
 * exactly as `workflow_history`'s event CHECK was widened for `step-reminded`.
 */

export const COUNTRY_PACK_SOURCES = ['tenant', 'country_pack'] as const;
export type CountryPackSource = (typeof COUNTRY_PACK_SOURCES)[number];

export const isCountryPackSource = (value: string): value is CountryPackSource =>
  (COUNTRY_PACK_SOURCES as readonly string[]).includes(value);

export const VIOLATION_STATES = ['reported'] as const;
export type ViolationState = (typeof VIOLATION_STATES)[number];

/**
 * What a read of a disciplinary record was.
 *
 * `violation_read` is one record fetched by identifier; `violation_listed` is one record disclosed
 * as part of a bounded list. They are separate values because "who opened this violation" and "whose
 * violation appeared on somebody's screen" are different questions an investigator asks, and
 * collapsing them would make the first unanswerable.
 */
export const ACCESS_ACTIONS = ['violation_read', 'violation_listed'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/**
 * The shape a code must take: lower-case, digits and hyphens, no leading or trailing hyphen.
 *
 * The same expression `document_type` and `letter_template` already enforce, so a tenant meets one
 * rule for what a code looks like across this product rather than three.
 */
const ENTITY_CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isEntityCode = (value: string): boolean => ENTITY_CODE.test(value);
