import { loadPortalProcessEnvironment } from '@work/config';
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
 * Reading the performance workspace from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about. **Nothing here touches a repository, a database or an application
 * handler.** Every value on the screen came down an HTTP response.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page, because "not signed in yet" is the
 * expected condition today rather than a fault.
 *
 * **Several reads are expected to fail for most callers, and that is the design.** Reconciliation
 * sits behind `performance.reconcile`, the talent matrix behind `performance.talent.read`, and
 * calibration behind `performance.calibrate`. A caller who can list cycles and not read the matrix
 * gets an empty matrix — which is exactly what that permission separation means, and the screen
 * says so rather than showing a blank.
 *
 * **`managerEmploymentId` is never sent.** The API honours it only for a caller who could already
 * read everything, and a screen that offered an administrator a manager picker and called the
 * result "My Team" would be dressing a filter up as an identity. There is no principal → employment
 * resolution in this product; the screen says that rather than faking it.
 *
 * **Every read is bounded.** No call omits `page` and `size`, and nothing here fetches a collection
 * in order to count or filter it in the browser.
 */

export interface PerformanceForDisplay {
  readonly scales: readonly RatingScaleView[];
  readonly frameworks: readonly CompetencyFrameworkView[];
  readonly templates: readonly ReviewTemplateView[];
  readonly categories: readonly GoalCategoryView[];
  readonly cycles: readonly CycleView[];
  /** The cycle the workspaces below describe: the first open one, else the first. */
  readonly cycle: CycleView | undefined;
  readonly goals: readonly GoalView[];
  readonly goalsTotal: number;
  readonly reviews: readonly ReviewView[];
  readonly reviewsTotal: number;
  /** One review in full: assessments, working, panel and — once completed — the snapshot. */
  readonly review: ReviewDetailView | undefined;
  readonly sessions: readonly CalibrationSessionView[];
  readonly placements: readonly TalentPlacementView[];
  readonly feedback: readonly FeedbackView[];
  readonly findings: readonly ReconciliationFindingView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when cycles are visible but the matrix is not: a permission boundary, not an outage. */
  readonly talentWithheld: boolean;
  /** True when cycles are visible but reconciliation is not. Same distinction. */
  readonly findingsWithheld: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** One page, the size every listing on this screen uses. Nothing asks for more. */
const PAGE = 'page=1&size=50';

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/performance${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];

export const EMPTY: PerformanceForDisplay = {
  scales: [],
  frameworks: [],
  templates: [],
  categories: [],
  cycles: [],
  cycle: undefined,
  goals: [],
  goalsTotal: 0,
  reviews: [],
  reviewsTotal: 0,
  review: undefined,
  sessions: [],
  placements: [],
  feedback: [],
  findings: [],
  unavailable: true,
  talentWithheld: false,
  findingsWithheld: false,
};

/**
 * The reads the screen makes.
 *
 * The scale listing is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 *
 * The cycle-scoped reads are made **once, for one cycle**, rather than per row. A workspace that
 * asked for the calibration sessions of every cycle in the list would be the N+1 this screen is
 * written to avoid, and the number of requests it makes does not grow with the number of cycles,
 * goals or reviews a tenant has.
 */
export const loadPerformance = async (): Promise<PerformanceForDisplay> => {
  const scales = await read<Page<RatingScaleView>>(`/rating-scales?${PAGE}`);

  if (scales === undefined) return EMPTY;

  const cycles = itemsOf(await read<Page<CycleView>>(`/cycles?${PAGE}`));
  const cycle = cycles.find((each) => each.status === 'open' || each.status === 'in_progress');

  return {
    ...EMPTY,
    unavailable: false,
    scales: scales.items,
    frameworks: itemsOf(await read<Page<CompetencyFrameworkView>>(`/frameworks?${PAGE}`)),
    templates: itemsOf(await read<Page<ReviewTemplateView>>(`/templates?${PAGE}`)),
    categories: itemsOf(await read<Page<GoalCategoryView>>(`/goal-categories?${PAGE}`)),
    cycles,
    ...(await forCycle(cycle ?? cycles[0])),
  };
};

/**
 * Everything scoped to one cycle: its goals, its reviews, one review in full, and the three reads
 * that each stand on their own permission.
 *
 * Split out because it is the part that does not run when a tenant has no cycle yet — and a
 * workspace that issued six requests against an identifier it did not have would answer six 404s
 * and render the same empty tables it would have rendered for free.
 */
const forCycle = async (cycle: CycleView | undefined): Promise<Partial<PerformanceForDisplay>> => {
  if (cycle === undefined) return {};

  const scoped = `cycleId=${cycle.cycleId}`;
  const goals = await read<Page<GoalView>>(`/goals?${PAGE}&${scoped}`);
  const reviews = await read<Page<ReviewView>>(`/reviews?${PAGE}&${scoped}`);
  const placements = await read<Page<TalentPlacementView>>(`/talent/matrix?${PAGE}&${scoped}`);
  const findings = await read<Page<ReconciliationFindingView>>(`/reconciliation?${PAGE}&${scoped}`);

  return {
    cycle,
    goals: itemsOf(goals),
    goalsTotal: goals?.total ?? 0,
    reviews: itemsOf(reviews),
    reviewsTotal: reviews?.total ?? 0,
    sessions: itemsOf(
      await read<Page<CalibrationSessionView>>(`/calibration-sessions?${PAGE}&${scoped}`),
    ),
    placements: itemsOf(placements),
    feedback: itemsOf(await read<Page<FeedbackView>>(`/feedback?${PAGE}`)),
    findings: itemsOf(findings),
    // The cycle was readable and these were not. That difference is a permission boundary, not an
    // outage, and the screen says which rather than showing an empty table that implies neither.
    talentWithheld: placements === undefined,
    findingsWithheld: findings === undefined,
    ...(await forReview(reviews?.items[0])),
  };
};

/** One review in full. The detail read carries the working, the panel and the snapshot. */
const forReview = async (
  review: ReviewView | undefined,
): Promise<Partial<PerformanceForDisplay>> =>
  review === undefined
    ? {}
    : { review: await read<ReviewDetailView>(`/reviews/${review.reviewId}`) };
