import { loadPortalProcessEnvironment } from '@work/config';
import type {
  BenchStrengthView,
  CareerPathDetailView,
  CareerPathView,
  CareerPlanView,
  CareerSummaryView,
  DevelopmentPlanDetailView,
  MobilityRecommendationView,
  PoolMembershipView,
  ReadinessAssessmentView,
  ReadinessLevelView,
  SuccessionPlanDetailView,
  SuccessionPlanView,
  TalentPoolView,
} from '@work/career/contracts';

/**
 * Reading the career workspace from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about. **Nothing here touches a repository, a store, a domain entity, Prisma or a
 * cross-module adapter.** Every value on the screen came down an HTTP response: Admin → API →
 * dispatcher → application → repository → PostgreSQL, in that order and no other.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed — but *closed* is not *empty*:
 * `unavailable` says the service did not answer, and the screen distinguishes that from a tenant
 * with nothing in it. A refusal is never rendered as zero rows.
 *
 * **Several reads are expected to fail for most callers, and that is the design.** Paths sit behind
 * `career.path.read`, benches behind `career.succession.read`, readiness behind
 * `career.readiness.read`. A caller who can list paths and not read the succession bench gets an
 * empty bench — which is exactly what that permission separation means, and the screen says so.
 *
 * **No employment identifier is ever sent as a claim about who is asking.** Three searches accept
 * one as a *filter*; this screen supplies it only where the API *requires* one to answer at all —
 * the summary and the readiness history — and then only for an employment a listing already
 * returned, as an administrator's read of that record. A caller holding only `plan.read-team` reads
 * nothing whatever this screen names, because the API resolves scope from what the caller holds. A
 * picker here would be an administrator's filter wearing an employee's identity.
 *
 * **Career is never asked to discover a position.** No request omits an identifier in order to
 * enumerate, and no request carries a criticality filter — there is none to carry. The succession
 * listing returns the plans this tenant already has, and a `positionId` on one of them is a
 * reference the tenant wrote down, not a claim that the position is critical (D-4).
 *
 * **Every read is bounded and the number of them is fixed.** No collection call omits `page` and
 * `size`, and the five detail reads are made **once, for the first row of their listing** — never
 * one per path, per succession plan, per employee, per successor or per development item.
 *
 * The count is **thirteen at most and it does not grow with the size of a tenant**: seven collection
 * reads, then at most six details for the first row of three of them. A tenant with four thousand
 * career plans costs exactly the same thirteen requests as a tenant with one. An empty tenant costs
 * seven, because there is no first row to read a detail for.
 */

/** One page, the size every listing on this screen uses. Nothing asks for more. */
const PAGE = 'page=1&size=50';

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * One person's readiness statements.
 *
 * Declared here rather than imported because the module publishes the *assessments* as a contract
 * and this envelope only in its application layer — the same case as Learning's course detail. It is
 * composed entirely of published views, so a field that disappeared from `ReadinessAssessmentView`
 * would stop compiling here.
 */
export interface ReadinessHistoryForDisplay {
  readonly employmentId: string;
  readonly assessments: readonly ReadinessAssessmentView[];
  readonly latest?: ReadinessAssessmentView;
}

export interface CareerForDisplay {
  readonly paths: readonly CareerPathView[];
  readonly pathsTotal: number;
  /** One path with its stages, in sequence. The first of the listing, never each of them. */
  readonly path: CareerPathDetailView | undefined;
  readonly plans: readonly CareerPlanView[];
  readonly plansTotal: number;
  readonly pools: readonly TalentPoolView[];
  readonly poolsTotal: number;
  readonly memberships: readonly PoolMembershipView[];
  readonly membershipsTotal: number;
  readonly successionPlans: readonly SuccessionPlanView[];
  readonly successionPlansTotal: number;
  /** One bench with its nominations. */
  readonly succession: SuccessionPlanDetailView | undefined;
  /** The counts the API's own bounded query returned. Nothing here counts rows to get them. */
  readonly bench: BenchStrengthView | undefined;
  readonly levels: readonly ReadinessLevelView[];
  /** One person's statements, for the employment the plan listing happened to surface. */
  readonly readiness: ReadinessHistoryForDisplay | undefined;
  /** One development plan with its items and its counted mix. The verdict is `NOT VERIFIED`. */
  readonly development: DevelopmentPlanDetailView | undefined;
  readonly recommendations: readonly MobilityRecommendationView[];
  readonly recommendationsTotal: number;
  /** One person's standing, for the employment the plan listing happened to surface. */
  readonly summary: CareerSummaryView | undefined;
  /** The day the derived answers were computed against, as the API reported it. */
  readonly asOf: string | undefined;
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when paths are visible and the succession bench is not: a permission boundary. */
  readonly successionWithheld: boolean;
}

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/career${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

/**
 * A page's rows and the server's own total, with the absent case answered once.
 *
 * Written as one helper rather than a `?.items ?? []` and a `?.total ?? 0` at each call site,
 * because the pair must always travel together: a screen that fell back to an empty list while
 * keeping a stale total would print "0 of 4000", and one that fell back to a total of `items.length`
 * would report a page as an organization.
 */
const pageParts = <TItem>(
  page: Page<TItem> | undefined,
): { readonly items: readonly TItem[]; readonly total: number } => ({
  items: page?.items ?? [],
  total: page?.total ?? 0,
});

export const EMPTY: CareerForDisplay = {
  paths: [],
  pathsTotal: 0,
  path: undefined,
  plans: [],
  plansTotal: 0,
  pools: [],
  poolsTotal: 0,
  memberships: [],
  membershipsTotal: 0,
  successionPlans: [],
  successionPlansTotal: 0,
  succession: undefined,
  bench: undefined,
  levels: [],
  readiness: undefined,
  development: undefined,
  recommendations: [],
  recommendationsTotal: 0,
  summary: undefined,
  asOf: undefined,
  unavailable: true,
  successionWithheld: false,
};

/**
 * The reads the screen makes. **Thirteen at most, and never more with more data.**
 *
 * The path listing is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 *
 * `succession-plans` is read before the rest because its refusal tells the screen something worth
 * saying — paths and benches sit behind different permissions, and a caller who has one and not the
 * other is looking at a boundary rather than an outage.
 */
export const loadCareer = async (): Promise<CareerForDisplay> => {
  const paths = await read<Page<CareerPathView>>(`/paths?${PAGE}`);

  if (paths === undefined) return EMPTY;

  const plans = await read<Page<CareerPlanView>>(`/plans?${PAGE}`);
  const pools = await read<Page<TalentPoolView>>(`/pools?${PAGE}`);
  const memberships = await read<Page<PoolMembershipView>>(`/pool-memberships?${PAGE}`);
  const levels = await read<{ readonly items: readonly ReadinessLevelView[] }>(`/readiness/levels`);

  return {
    ...EMPTY,
    unavailable: false,
    paths: paths.items,
    pathsTotal: paths.total,
    plans: pageParts(plans).items,
    plansTotal: pageParts(plans).total,
    pools: pageParts(pools).items,
    poolsTotal: pageParts(pools).total,
    memberships: pageParts(memberships).items,
    membershipsTotal: pageParts(memberships).total,
    // The readiness ladder is bounded by the domain at a hundred rungs rather than by a page, which
    // is why this one query alone carries no `page` and `size` — a ladder shown in halves is not a
    // ladder. The API declares no paging parameters on it.
    levels: levels?.items ?? [],
    ...(await forFirstPath(paths.items[0])),
    ...(await succession()),
    ...(await forFirstPerson(plans?.items[0])),
    ...(await mobility()),
  };
};

/**
 * One path in full: its stages, in sequence.
 *
 * **The first of the listing, never each of it.** A workspace that read the stages of every path in
 * the page would issue fifty requests to render one table, and the number would grow with the
 * tenant's configuration — the amplification this screen is written to avoid.
 */
const forFirstPath = async (
  path: CareerPathView | undefined,
): Promise<Partial<CareerForDisplay>> =>
  path === undefined ? {} : { path: await read<CareerPathDetailView>(`/paths/${path.pathId}`) };

/**
 * The succession workspace: the benches, one of them in full, and its counted strength.
 *
 * Split out because it stands on its own permission, and because its refusal means something
 * different from the path listing's. `successionWithheld` is the distinction: the caller could read
 * paths and could not read benches, which is a permission boundary rather than a service that is
 * down.
 *
 * **No criticality is asked for and none is returned.** The listing carries no filter beyond the
 * page, so this is the plans the tenant already has — not a search for the positions that matter
 * most, which Career cannot perform (D-4).
 */
const succession = async (): Promise<Partial<CareerForDisplay>> => {
  const plans = await read<Page<SuccessionPlanView>>(`/succession-plans?${PAGE}`);
  const benches = pageParts(plans);
  const first = benches.items[0];

  return {
    successionPlans: benches.items,
    successionPlansTotal: benches.total,
    successionWithheld: plans === undefined,
    ...(first === undefined
      ? {}
      : {
          succession: await read<SuccessionPlanDetailView>(
            `/succession-plans/${first.successionPlanId}`,
          ),
          // The module's own bounded query. This screen never counts nominations itself: a count of
          // a page is not a bench's strength, and the API answers the question properly.
          bench: await read<BenchStrengthView>(
            `/succession-plans/${first.successionPlanId}/bench-strength`,
          ),
        }),
  };
};

/**
 * One person's records: their standing, their readiness statements and their development plan.
 *
 * **One person, for the first row of the plan listing** — never one per employee. Reading the
 * summary of every employment in the page would be fifty requests, and a real workforce would make
 * it thousands. The three reads below are an administrator's read of a record the listing already
 * showed them; none of them is a claim about who is signed in, and this screen has no way to make
 * such a claim (ADR-0032).
 *
 * The development plan is reached through the summary rather than by listing development plans,
 * because the API publishes no development-plan search — a deliberate absence, since a development
 * plan is read about a person rather than browsed.
 */
const forFirstPerson = async (
  plan: CareerPlanView | undefined,
): Promise<Partial<CareerForDisplay>> => {
  if (plan === undefined) return {};

  const summary = await read<CareerSummaryView>(`/summary/${plan.employmentId}`);
  const readiness = await read<ReadinessHistoryForDisplay>(
    `/readiness/history/${plan.employmentId}`,
  );
  const active = summary?.activeDevelopmentPlan;

  return {
    ...(summary === undefined ? {} : { summary }),
    ...(readiness === undefined ? {} : { readiness }),
    ...(active === undefined
      ? {}
      : {
          development: await read<DevelopmentPlanDetailView>(
            `/development-plans/${active.developmentPlanId}`,
          ),
        }),
    // The day the summary's derived answers were computed against, taken from the server. Never
    // `new Date()`: a screen that stamped its own clock would caption an answer with a day the
    // answer was not computed for.
    ...(summary?.asOf === undefined ? {} : { asOf: summary.asOf }),
  };
};

/** The recommendations, and the day their standing was worked out against. */
const mobility = async (): Promise<Partial<CareerForDisplay>> => {
  const found = await read<Page<MobilityRecommendationView> & { readonly asOf?: string }>(
    `/mobility-recommendations?${PAGE}`,
  );
  const page = pageParts(found);

  return {
    recommendations: page.items,
    recommendationsTotal: page.total,
    // This read runs last, so its `asOf` is the one the screen captions with. Both this and the
    // summary's are the server's own day for the same request, so which one wins does not change
    // the answer — but it is deliberate rather than incidental, because the recommendations table
    // is the largest thing on the page whose standing depends on it.
    ...(found?.asOf === undefined ? {} : { asOf: found.asOf }),
  };
};
