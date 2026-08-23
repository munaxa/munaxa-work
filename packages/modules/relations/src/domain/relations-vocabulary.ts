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
 * **Four values, not the specification's twelve.** Checkpoint 2 built three; Checkpoint 4 adds
 * `action_issued`, because it builds the capability that reaches it. The lifecycle continues through
 * acknowledged, appealed, upheld, annulled, expired and archived, and every one of those is still
 * reached by a capability nothing here builds. Listing a state nothing can produce is the promise
 * the code cannot keep that Checkpoint 1 declined to make; declining it three times is consistency
 * rather than timidity. The database CHECK widens by an approved change, never by convenience.
 */
export const CASE_STATES = [
  'reported',
  'under_investigation',
  'findings',
  'action_issued',
] as const;
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
 * Note what is *not* here: nothing returns to `reported`, and **nothing leaves `action_issued`**.
 * Acknowledging an action, appealing it, upholding or annulling it are all later capabilities;
 * leaving their edges out means a request for them is refused rather than silently accepted into a
 * state nothing can act on. `findings → action_issued` is Checkpoint 4's one new edge.
 */
export const PERMITTED_CASE_TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = {
  reported: ['under_investigation'],
  under_investigation: ['findings'],
  findings: ['action_issued'],
  action_issued: [],
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
 *
 * Checkpoint 3 adds `escalation_read`. Asking how many times an employment has done this before is
 * asking about their disciplinary record, so it is audited — one event per violation the count
 * actually disclosed, not one per question asked, because the trail answers *which records were
 * seen* and a single event for an aggregate would leave that unanswerable.
 *
 * Checkpoint 4 adds `disciplinary_action_read`. An issued action is the most consequential record
 * this module holds — somebody may be dismissed on the strength of it — so reading one is audited
 * like reading the inquiry behind it.
 */
export const ACCESS_ACTIONS = [
  'violation_read',
  'violation_listed',
  'investigation_read',
  'investigation_listed',
  'case_history_read',
  'escalation_read',
  'disciplinary_action_read',
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

/**
 * What a tenant's ladder may prescribe — five rungs, and no sixth.
 *
 * **Small and explicit, rather than every action the specification names.** Each of these has a
 * business meaning this module can actually represent, and nothing is here speculatively.
 *
 * **The two most serious are recommendations, and the naming is the boundary.** Employment owns
 * `suspended` and `ended` (AD-005: *"a recommendation only. Employment executes, through its own
 * lifecycle and approvals"*). A value called `termination` would promise something Relations must
 * never do, and the day somebody wired it to Employment nobody would notice the promise had been
 * made. `*_recommendation` cannot be misread.
 *
 * **Nothing here is ordered by severity.** The rungs are values a tenant assigns to thresholds; this
 * module does not know that a final warning is "worse" than a verbal one, because ranking them would
 * be this product deciding disciplinary policy for every customer (AD-002, D-5.2-06).
 */
export const DISCIPLINARY_ACTIONS = [
  'verbal_warning',
  'written_warning',
  'final_warning',
  /** A recommendation to Employment. **This module suspends nobody.** */
  'suspension_recommendation',
  /** A recommendation to Employment (AD-005). **This module ends no employment.** */
  'termination_recommendation',
] as const;
export type DisciplinaryAction = (typeof DISCIPLINARY_ACTIONS)[number];

export const isDisciplinaryAction = (value: string): value is DisciplinaryAction =>
  (DISCIPLINARY_ACTIONS as readonly string[]).includes(value);
