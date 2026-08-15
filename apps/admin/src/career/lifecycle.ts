import type {
  CareerPathView,
  CareerPlanView,
  DevelopmentItemView,
  DevelopmentPlanView,
  MobilityRecommendationView,
  SuccessionPlanView,
  SuccessorView,
  TalentPoolView,
} from '@work/career/contracts';

/**
 * Which transitions a record's state permits, and which it does not.
 *
 * **This is not authorization, and it is not a control.** The API is authoritative and refuses every
 * one of these independently — a stale version earns a 409, an invalid transition a 422, a missing
 * permission a 403 — and a caller with `curl` reaches the same handler this screen reads from. This
 * Admin portal has no mutation architecture at all: no form, no dialog, no client state. What this
 * gives an HR administrator is a *readable statement of where a record stands*, phrased as the
 * transitions the API would entertain, so that a screen showing "archived" also says plainly that
 * nothing further can happen to it.
 *
 * Two of these stand on permissions the rest do not imply, and this file cannot know whether the
 * reader holds them: **confirming** a successor records that an organization agrees, and
 * **assigning** somebody to a pool is a judgement about them. Both are named where the record's
 * state allows them, and both are refused by the API for a caller holding only the neighbouring
 * `manage` permission.
 *
 * The rules are read straight off each record's own state, never recomputed from parts:
 *
 * - **An archived path offers nothing.** Archival is terminal and it is not deletion: a plan created
 *   against a 2024 path stays explainable, which is the whole reason the row is still there.
 * - **A path with no stages publishes nothing** — a ladder with no rungs describes no career — so
 *   publication is offered only once it has one.
 * - **A closed pool takes nobody new.** Who was in it stays readable; that is what closure means.
 * - **A bench with nobody on it does not activate.** An "active" succession plan with no successors
 *   reads to a review as cover that does not exist.
 * - **A confirmed or withdrawn nomination is finished.** Withdrawal is a state and never a delete:
 *   "we put this person forward and then took them off the list" is the history a review needs.
 * - **A decided recommendation is not decided again**, and `expired` is never among the choices —
 *   it is derived from a stated day and no command writes it.
 * - **There is no promote, transfer or salary action anywhere below**, because Career recommends and
 *   executes nothing (ADR-0072). Accepting a mobility recommendation records that somebody agreed
 *   with a suggestion; the move itself is another module's act, taken elsewhere by somebody else.
 */

export const pathActionsFor = (path: CareerPathView | undefined): readonly string[] => {
  if (path === undefined || path.status === 'archived') return [];
  if (path.status === 'published') return ['addStage', 'archive'];
  // A ladder with no rungs describes no career, so publication waits for the first stage.
  return path.stageCount === 0 ? ['addStage'] : ['addStage', 'publish', 'archive'];
};

const CLOSED_PLANS = new Set(['achieved', 'abandoned', 'archived']);

export const planActionsFor = (plan: CareerPlanView | undefined): readonly string[] => {
  if (plan === undefined || CLOSED_PLANS.has(plan.status)) return [];
  return ['amend', 'move'];
};

export const poolActionsFor = (pool: TalentPoolView | undefined): readonly string[] =>
  pool === undefined || pool.status === 'closed' ? [] : ['addMember', 'close'];

export const successionActionsFor = (
  plan: SuccessionPlanView | undefined,
  successorCount: number,
): readonly string[] => {
  if (plan === undefined || plan.status === 'archived') return [];
  if (plan.status === 'active') return ['nominate', 'archive'];
  // Draft: activation is offered only once somebody is actually on the bench.
  return successorCount === 0 ? ['nominate', 'archive'] : ['nominate', 'activate', 'archive'];
};

export const successorActionsFor = (successor: SuccessorView | undefined): readonly string[] => {
  if (successor === undefined || successor.status !== 'nominated') return [];
  return ['confirm', 'withdraw'];
};

const CLOSED_DEVELOPMENT = new Set(['completed', 'abandoned']);

export const developmentActionsFor = (
  plan: DevelopmentPlanView | undefined,
  itemCount: number,
): readonly string[] => {
  if (plan === undefined || CLOSED_DEVELOPMENT.has(plan.status)) return [];
  if (plan.status === 'active') return ['addItem', 'acknowledge', 'move'];
  // A plan with nothing in it does not become active; there is nothing to develop.
  return itemCount === 0 ? ['addItem'] : ['addItem', 'move'];
};

const CLOSED_ITEMS = new Set(['completed', 'cancelled']);

export const itemActionsFor = (item: DevelopmentItemView | undefined): readonly string[] =>
  item === undefined || CLOSED_ITEMS.has(item.status) ? [] : ['move'];

/**
 * A recommendation's actions, read from its **stored** status rather than its standing.
 *
 * `standing` may read `expired` on the day somebody asks while the stored status is still
 * `proposed` — that is the whole design (D-13). The decision the API would entertain depends on
 * what is stored, so an expired-looking recommendation still offers a decision, and a decided one
 * offers nothing whatever its standing says.
 */
export const mobilityActionsFor = (
  recommendation: MobilityRecommendationView | undefined,
): readonly string[] =>
  recommendation === undefined || recommendation.status !== 'proposed' ? [] : ['decide'];
