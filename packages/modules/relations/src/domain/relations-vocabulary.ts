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
 * Where a **case** has got to — which is not the same fact as what the violation row says.
 *
 * `relation_violation.state` is still `'reported'` for every row and always will be: that row is the
 * factual record of what was reported, it is immutable at the database (D-5.2-03), and a factual
 * record does not move. The case built on top of it does move, and D-5.2-15 puts that movement in a
 * separate Relations-owned lifecycle record rather than in a column somebody has to update.
 *
 * **Three values, not the specification's twelve.** The lifecycle continues through pending-approval,
 * action-issued, acknowledged, appealed, upheld, annulled, expired and archived; every one of those
 * is reached by a capability Checkpoint 2 does not build. Listing a state nothing can produce is the
 * promise the code cannot keep that Checkpoint 1 declined to make, and declining it twice is
 * consistency rather than timidity. The database CHECK widens by an approved change.
 */
export const CASE_STATES = ['reported', 'under_investigation', 'findings'] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const isCaseState = (value: string): value is CaseState =>
  (CASE_STATES as readonly string[]).includes(value);

/**
 * The state a case is in before anything has happened to it.
 *
 * Not stored anywhere (D-5.2-16). A case with no lifecycle events **is** `reported`, because the
 * violation being recorded is what reported it; writing an event to say so would be recording that a
 * thing is itself.
 */
export const INITIAL_CASE_STATE: CaseState = 'reported';

/**
 * Which transitions exist, stated as data and exhaustively.
 *
 * **This is the whole state machine, and it is nine lines long.** No engine, no registry, no
 * pluggable rule set — D-5.2-16 forbids the generic framework, and a domain with three states and two
 * edges does not need one. A transition absent from this map is refused by name, so adding a state
 * later means adding its edges here and nowhere else.
 *
 * Note what is *not* here: nothing returns to `reported`, and nothing leaves `findings`. Reopening a
 * concluded case and acting on findings are both later capabilities; leaving their edges out means a
 * request for them is refused rather than silently accepted into a state nothing can act on.
 */
export const PERMITTED_CASE_TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = {
  reported: ['under_investigation'],
  under_investigation: ['findings'],
  findings: [],
};

export const permitsTransition = (from: CaseState, to: CaseState): boolean =>
  PERMITTED_CASE_TRANSITIONS[from].includes(to);

/**
 * Whether an investigation is still being written or has become evidence.
 *
 * The database enforces the consequence rather than trusting this type: a row at `concluded` refuses
 * every update and every delete, from any path including a direct `psql` session.
 */
export const INVESTIGATION_STATES = ['open', 'concluded'] as const;
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];

/**
 * What a read of a disciplinary record was.
 *
 * `violation_read` is one record fetched by identifier; `violation_listed` is one record disclosed
 * as part of a bounded list. They are separate values because "who opened this violation" and "whose
 * violation appeared on somebody's screen" are different questions an investigator asks, and
 * collapsing them would make the first unanswerable.
 *
 * Checkpoint 2 adds three more for the same reason it audited the first two: an investigation's
 * findings and a case's history are disciplinary content, and AD-007 audits reading it. `case_history_read`
 * has no `_listed` twin because the history of one case is only ever fetched whole.
 */
export const ACCESS_ACTIONS = [
  'violation_read',
  'violation_listed',
  'investigation_read',
  'investigation_listed',
  'case_history_read',
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/**
 * The shape a code must take: lower-case, digits and hyphens, no leading or trailing hyphen.
 *
 * The same expression `document_type` and `letter_template` already enforce, so a tenant meets one
 * rule for what a code looks like across this product rather than three.
 */
const ENTITY_CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isEntityCode = (value: string): boolean => ENTITY_CODE.test(value);
