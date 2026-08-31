import type { EmploymentView } from '@work/employment/contracts';
import { apiOutcome } from '../shell/api-request.js';
import type {
  CalibrationSessionView,
  CompetencyFrameworkView,
  CycleView,
  FeedbackView,
  GoalCategoryView,
  GoalView,
  RatingScaleView,
  ReconciliationFindingView,
  ReviewDetailView,
  ReviewTemplateView,
  ReviewView,
  TalentPlacementView,
} from '@work/performance/contracts';

/**
 * Reading performance from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps these screens from breaking on a refactor they have no
 * business knowing about. **Nothing here touches a repository, a database or an application
 * handler.** Every value on the screen came down an HTTP response.
 *
 * **Eight permissions, eight independent refusals.** `performance.configure.read` answers the
 * scales, frameworks, templates and categories; `cycle.read` the cycles; `goal.read-team` the goal
 * list and `goal.read` one goal; `review.read-team` the queue *and* one review; `talent.read` the
 * matrix; `calibrate` the sessions; `feedback.read-team` the feedback; `reconcile` the findings. A
 * caller may hold any subset, so every read is kept as its own value and an absent one renders as
 * withheld rather than as an empty table.
 *
 * **A 404 and a 403 are not the same answer, and on one route they are deliberately the same
 * status.** The goal route answers 404 only for a goal that does not exist. The review route
 * answers 404 for a review that does not exist **and** for one outside the caller's scope, because
 * — in the module's own words — "confirming a review exists is the disclosure". The review page is
 * written to be true in both cases; see `app/performance/reviews/[reviewId]/not-found.tsx`.
 *
 * **The total is the server's, always.** Every paged read returns `{ items, total }` counted in the
 * database. The screen this replaced discarded `total` in an `itemsOf` helper for six of its
 * listings and then counted the page it had received.
 *
 * **Nothing here selects a record for the reader.** The screen this replaced read
 * `reviews.items[0]` and rendered its rating, its working, its assessments and its panel across
 * four sections that never said which review they were about — and `goals[0]` for a fifth. A
 * specific record is opened by a route with that record's identifier in it, or it is not opened.
 */

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&size=50';

interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/** A page, or the fact that there was not one. Rows and the server's total travel together. */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * What a read that defines a route actually answered.
 *
 * `missing` is a 404 the module raised; `refused` is a 401 or a 403. Collapsing them would render a
 * not-found page at a caller who simply lacks a permission — telling them the goal does not exist,
 * which is the opposite of true.
 */
export type Outcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' };

const outcome = async <TValue>(path: string): Promise<Outcome<TValue>> => {
  const answer = await apiOutcome<TValue>(`${path}`);

  if (answer.kind === 'ok') return { kind: 'ok', value: answer.value };
  return answer.kind === 'missing' ? { kind: 'missing' } : { kind: 'refused' };
};

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a performance page says what somebody was rated, and a cached copy of
 * it is that rating sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await outcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};

const listing = <TItem>(page: Paged<TItem> | undefined): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/** What the tenant rates against. One permission answers all four, so they refuse together. */
export interface PerformanceConfiguration {
  readonly scales: Listing<RatingScaleView> | undefined;
  readonly frameworks: Listing<CompetencyFrameworkView> | undefined;
  readonly templates: Listing<ReviewTemplateView> | undefined;
  readonly categories: Listing<GoalCategoryView> | undefined;
}

export interface PerformanceRegister extends PerformanceConfiguration {
  readonly cycles: Listing<CycleView> | undefined;
  /** The cycle the scoped listings below describe, and the one the heading names. */
  readonly cycle: CycleView | undefined;
  readonly goals: Listing<GoalView> | undefined;
  readonly reviews: Listing<ReviewView> | undefined;
  readonly sessions: Listing<CalibrationSessionView> | undefined;
  readonly placements: Listing<TalentPlacementView> | undefined;
  readonly feedback: Listing<FeedbackView> | undefined;
  readonly findings: Listing<ReconciliationFindingView> | undefined;
}

const EMPTY_REGISTER: PerformanceRegister = {
  scales: undefined,
  frameworks: undefined,
  templates: undefined,
  categories: undefined,
  cycles: undefined,
  cycle: undefined,
  goals: undefined,
  reviews: undefined,
  sessions: undefined,
  placements: undefined,
  feedback: undefined,
  findings: undefined,
};

/**
 * Which cycle the scoped listings describe.
 *
 * The **first cycle the server returned that is open, in progress or in calibration**, else the
 * first cycle. This is a *request parameter* the screen has to supply — `/goals`, `/reviews`,
 * `/talent/matrix`, `/reconciliation` and `/calibration-sessions` all take `cycleId` — and it is
 * named on the page beside every listing it scopes, so nobody reads a queue as the tenant's whole
 * review set.
 *
 * It is deliberately not a filter the reader chose: choosing one needs a control, and a control on
 * this portal would post unauthenticated. The cycle list is on the same page, and every row in it
 * carries its own code and status.
 */
const RUNNING = new Set(['open', 'in_progress', 'calibration']);

export const runningCycle = (cycles: readonly CycleView[]): CycleView | undefined =>
  cycles.find((cycle) => RUNNING.has(cycle.status)) ?? cycles[0];

/** The four configuration reads, behind one permission. */
const loadConfiguration = async (): Promise<PerformanceConfiguration> => {
  const [scales, frameworks, templates, categories] = await Promise.all([
    read<Paged<RatingScaleView>>(`/performance/rating-scales?${PAGE}`),
    read<Paged<CompetencyFrameworkView>>(`/performance/frameworks?${PAGE}`),
    read<Paged<ReviewTemplateView>>(`/performance/templates?${PAGE}`),
    read<Paged<GoalCategoryView>>(`/performance/goal-categories?${PAGE}`),
  ]);

  return {
    scales: listing(scales),
    frameworks: listing(frameworks),
    templates: listing(templates),
    categories: listing(categories),
  };
};

/**
 * Everything scoped to one cycle, in one round.
 *
 * Six reads issued together rather than in sequence, and **none of them per row**: a screen that
 * asked for the calibration sessions of every cycle in the list would be the N+1 this product's
 * screens are forbidden, and the number of requests here does not grow with the number of cycles,
 * goals or reviews a tenant has.
 */
const loadForCycle = async (cycleId: string): Promise<Partial<PerformanceRegister>> => {
  const scoped = `cycleId=${cycleId}`;

  const [goals, reviews, sessions, placements, feedback, findings] = await Promise.all([
    read<Paged<GoalView>>(`/performance/goals?${PAGE}&${scoped}`),
    read<Paged<ReviewView>>(`/performance/reviews?${PAGE}&${scoped}`),
    read<Paged<CalibrationSessionView>>(`/performance/calibration-sessions?${PAGE}&${scoped}`),
    read<Paged<TalentPlacementView>>(`/performance/talent/matrix?${PAGE}&${scoped}`),
    read<Paged<FeedbackView>>(`/performance/feedback?${PAGE}`),
    read<Paged<ReconciliationFindingView>>(`/performance/reconciliation?${PAGE}&${scoped}`),
  ]);

  return {
    goals: listing(goals),
    reviews: listing(reviews),
    sessions: listing(sessions),
    placements: listing(placements),
    feedback: listing(feedback),
    findings: listing(findings),
  };
};

/**
 * The register: what the tenant rates against, which cycle is running, and the work inside it.
 *
 * The cycle list is read first because it decides the scope of six other reads. When it is refused
 * or empty there is no cycle to scope by, and the six scoped reads are not issued at all — a screen
 * that fired them against an identifier it did not have would answer six 404s and render the same
 * empty tables it would have rendered for free.
 */
export const loadPerformanceRegister = async (): Promise<PerformanceRegister> => {
  const [configuration, cycles] = await Promise.all([
    loadConfiguration(),
    read<Paged<CycleView>>(`/performance/cycles?${PAGE}`),
  ]);

  const cycle = cycles === undefined ? undefined : runningCycle(cycles.items);

  return {
    ...EMPTY_REGISTER,
    ...configuration,
    cycles: listing(cycles),
    cycle,
    ...(cycle === undefined ? {} : await loadForCycle(cycle.cycleId)),
  };
};

/** True when not one of the register's reads answered — the ordinary state of this deployment. */
export const registerAnsweredNothing = (register: PerformanceRegister): boolean =>
  register.cycles === undefined &&
  register.scales === undefined &&
  register.frameworks === undefined &&
  register.templates === undefined &&
  register.categories === undefined;

/**
 * One review, from the read that answers it whole.
 *
 * `ReviewDetailView` is the review, its panel, its assessments, its working, its calibration
 * decision and — once completed — its snapshot, together and from one moment. The outcome is
 * carried out whole so the route can tell a 404 from a refusal, even though on this route a 404 is
 * also what an out-of-scope caller receives.
 */
export const loadReview = async (reviewId: string): Promise<Outcome<ReviewDetailView>> =>
  outcome<ReviewDetailView>(`/performance/reviews/${reviewId}`);

/** One goal with its progress history. `performance.goal.read`, which the list read does not need. */
export const loadGoal = async (goalId: string): Promise<Outcome<GoalView>> =>
  outcome<GoalView>(`/performance/goals/${goalId}`);

export interface SubjectEmployments {
  /** The employment the record is about. Absent means Employment refused, or holds no such record. */
  readonly subject: EmploymentView | undefined;
  /** The manager named on the review. Absent for a review that names none. */
  readonly manager: EmploymentView | undefined;
}

/**
 * The employments a detail page names, from Employment's own bounded read of one identifier.
 *
 * **Two requests at most, and only on a detail page.** One for the subject, one for the manager the
 * review names. Never a list scanned for a match, and never one per row: the queue keeps
 * identifiers precisely so that opening it costs one request rather than fifty. `personName` is
 * present only when the caller may read the person, which Employment decides rather than this
 * screen.
 */
export const loadEmployments = async (
  subjectId: string | undefined,
  managerId: string | undefined,
): Promise<SubjectEmployments> => {
  const [subject, manager] = await Promise.all([
    subjectId === undefined ? undefined : read<EmploymentView>(`/employments/${subjectId}`),
    managerId === undefined ? undefined : read<EmploymentView>(`/employments/${managerId}`),
  ]);

  return { subject, manager };
};

/**
 * What a detail page needs beside the record itself: the cycles, and the goal categories.
 *
 * Both are small, bounded, tenant-level lists that the register already reads, and both are here so
 * a detail page can render a **name** where it would otherwise render an identifier. Neither is a
 * per-row lookup: one request each, for the whole page.
 *
 * Either may be refused on its own — the cycles behind `performance.cycle.read`, the categories
 * behind `performance.configure.read` — and a refused one leaves the identifier on screen rather
 * than a blank.
 */
export interface DetailContext {
  readonly cycles: Listing<CycleView> | undefined;
  readonly categories: Listing<GoalCategoryView> | undefined;
}

export const loadDetailContext = async (): Promise<DetailContext> => {
  const [cycles, categories] = await Promise.all([
    read<Paged<CycleView>>(`/performance/cycles?${PAGE}`),
    read<Paged<GoalCategoryView>>(`/performance/goal-categories?${PAGE}`),
  ]);

  return { cycles: listing(cycles), categories: listing(categories) };
};

/** One cycle out of the list the page already read. A `find`, not a request. */
export const cycleAmong = (
  cycles: Listing<CycleView> | undefined,
  cycleId: string | undefined,
): CycleView | undefined =>
  cycleId === undefined ? undefined : cycles?.items.find((cycle) => cycle.cycleId === cycleId);

/** One goal category out of the list the page already read. A `find`, not a request. */
export const categoryAmong = (
  categories: Listing<GoalCategoryView> | undefined,
  goalCategoryId: string | undefined,
): GoalCategoryView | undefined =>
  goalCategoryId === undefined
    ? undefined
    : categories?.items.find((category) => category.goalCategoryId === goalCategoryId);
