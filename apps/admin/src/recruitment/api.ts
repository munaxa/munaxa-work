import { loadPortalProcessEnvironment } from '@work/config';
import type { EmploymentView } from '@work/employment/contracts';
import type {
  ApplicationSnapshot,
  ApplicationView,
  CandidateSnapshot,
  CandidateView,
  FeedbackView,
  PipelineView,
  RequisitionSnapshot,
  RequisitionView,
  VacancyView,
} from '@work/recruitment/contracts';

/**
 * Reading the hiring pipeline from the API.
 *
 * The types come from each module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps these screens from breaking on a refactor they have no
 * business knowing about.
 *
 * **Refused and empty are different answers, and this file keeps them apart.** The CQRS pipeline
 * checks the permission *before* the handler runs, so a caller without `recruitment.application.read`
 * is refused while a caller who holds it and has no applications receives an empty page. Collapsing
 * the two would tell a recruiter that nobody has applied when the truth is that they were not
 * allowed to look — and in this deployment, where Platform's authentication adapter is absent and
 * every business route answers 401, refusal is the *ordinary* state. `undefined` is a refusal; a
 * `Listing` with no items is an empty answer.
 *
 * **The total is the server's, always.** `searchApplicationsHandler` returns a `pagedResult` whose
 * total is counted in the database; a screen that reported `items.length` would tell somebody with
 * four hundred applicants that they have twenty-five.
 *
 * **The pipeline is counted by the server too.** `PipelineView` publishes `countsByStatus` and
 * `total` from an aggregate query, and the module's own handler says why: a vacancy with forty
 * thousand applications must not be loaded to be counted. Nothing here adds, subtracts or
 * percentages any of it.
 *
 * **One bounded read per identifier, never a lookup pass.** An employment named on a requisition is
 * resolved to a person's name by `GET /employments/:id`, which is the same single bounded read the
 * Employee Record makes for a manager. The applications list resolves no candidate names at all:
 * `ApplicationView` carries none, and one candidate read per row is the unbounded N+1 this module's
 * own handler comments warn about. The name appears on the application record, from one read.
 */

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&size=25';

interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * A page, or the fact that there was not one.
 *
 * The rows and the server's total travel together or not at all: a screen that fell back to an
 * empty list while keeping a stale total would print "0 of 400", and one that fell back to
 * `items.length` would report a page as a pipeline.
 */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a hiring pipeline holds a named candidate's progress, and a cached
 * copy of it is one person's application sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

const listing = <TItem>(page: Paged<TItem> | undefined): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/** A vacancy and the server's own count of what is in its pipeline. */
export interface VacancyPipeline {
  readonly vacancy: VacancyView;
  /** Absent means the pipeline read was refused, which is not the same as an empty pipeline. */
  readonly pipeline: PipelineView | undefined;
}

export interface HiringForDisplay {
  readonly requisitions: Listing<RequisitionView> | undefined;
  readonly vacancies: Listing<VacancyView> | undefined;
  readonly candidates: Listing<CandidateView> | undefined;
  readonly applications: Listing<ApplicationView> | undefined;
  /** One entry per vacancy on this page. Absent when the vacancy listing itself was refused. */
  readonly pipelines: readonly VacancyPipeline[] | undefined;
}

/**
 * The pipeline for each vacancy on a page.
 *
 * One aggregate request per vacancy, bounded by the page the server already returned rather than by
 * anything this screen chose — the same discipline as the record's single manager read, applied to
 * a set the API bounded. Each may be refused on its own, and a refused pipeline is rendered as
 * refused rather than as an empty one.
 */
const pipelinesFor = async (
  vacancies: readonly VacancyView[],
): Promise<readonly VacancyPipeline[]> =>
  Promise.all(
    vacancies.map(async (vacancy) => ({
      vacancy,
      pipeline: await read<PipelineView>(`/recruitment/vacancies/${vacancy.vacancyId}/pipeline`),
    })),
  );

/**
 * The hiring workspace: what is authorized, what is open, what is in flight and who has applied.
 *
 * Four independent reads under four permissions, issued together. A caller may hold
 * `recruitment.requisition.read` and not `recruitment.candidate.read`, and the screen says which
 * half it was shown rather than rendering the other half as empty.
 */
export const loadHiring = async (): Promise<HiringForDisplay> => {
  const [requisitions, vacancies, candidates, applications] = await Promise.all([
    read<Paged<RequisitionView>>(`/recruitment/requisitions?${PAGE}`),
    read<Paged<VacancyView>>(`/recruitment/vacancies?${PAGE}`),
    read<Paged<CandidateView>>(`/recruitment/candidates?${PAGE}`),
    read<Paged<ApplicationView>>(`/recruitment/applications?${PAGE}`),
  ]);

  return {
    requisitions: listing(requisitions),
    vacancies: listing(vacancies),
    candidates: listing(candidates),
    applications: listing(applications),
    pipelines: vacancies === undefined ? undefined : await pipelinesFor(vacancies.items),
  };
};

export interface RequisitionForDisplay {
  readonly snapshot: RequisitionSnapshot;
  /** One entry per vacancy the snapshot named. */
  readonly pipelines: readonly VacancyPipeline[];
  /** The requester's name, when Employment answered for the caller. */
  readonly requestedByName: Readonly<Record<string, string>> | undefined;
  /** The hiring manager's name, when the requisition names one and Employment answered. */
  readonly hiringManagerName: Readonly<Record<string, string>> | undefined;
}

/**
 * One requisition, asked for first and on its own.
 *
 * An identifier the API will not resolve is a 404 rather than a page of refusals about a
 * requisition that may not exist, and asking for four more things about it would be four requests
 * spent to render nothing.
 */
export const loadRequisition = async (
  requisitionId: string,
): Promise<RequisitionSnapshot | undefined> =>
  read<RequisitionSnapshot>(`/recruitment/requisitions/${requisitionId}`);

/** Everything else about it, in one round. */
export const loadRequisitionDetail = async (
  snapshot: RequisitionSnapshot,
): Promise<RequisitionForDisplay> => {
  const requisition = snapshot.requisition;
  const [pipelines, requestedBy, hiringManager] = await Promise.all([
    pipelinesFor(snapshot.vacancies),
    read<EmploymentView>(`/employments/${requisition.requestedByEmploymentId}`),
    // Asked only when the requisition names one: a requisition with no hiring manager must not cost
    // a request, and `undefined` in means `undefined` out.
    requisition.hiringManagerEmploymentId === undefined
      ? Promise.resolve(undefined)
      : read<EmploymentView>(`/employments/${requisition.hiringManagerEmploymentId}`),
  ]);

  return {
    snapshot,
    pipelines,
    requestedByName: requestedBy?.personName,
    hiringManagerName: hiringManager?.personName,
  };
};

/** One interview and what its panel said, when the caller may read it. */
export interface InterviewFeedback {
  readonly interviewId: string;
  /** Absent means the feedback read was refused — deliberately not the same as nobody answering. */
  readonly feedback: readonly FeedbackView[] | undefined;
}

export interface ApplicationForDisplay {
  readonly snapshot: ApplicationSnapshot;
  /** The candidate, when the caller may read candidates. Absent means refused. */
  readonly candidate: CandidateSnapshot | undefined;
  /** One entry per interview on this application. */
  readonly panels: readonly InterviewFeedback[];
}

/** One application, asked for first and on its own, for the same reason as a requisition. */
export const loadApplication = async (
  applicationId: string,
): Promise<ApplicationSnapshot | undefined> =>
  read<ApplicationSnapshot>(`/recruitment/applications/${applicationId}`);

/**
 * The candidate and the panel, in one round.
 *
 * The snapshot already carries the application's history, its interviews and its offers, so none of
 * those is asked for again: the module returns them together precisely so a screen cannot show an
 * interview from one state beside a status from another. What it does not carry is the candidate's
 * name — `ApplicationView` holds only `candidateId` — and the panel's opinion, which sits behind
 * `recruitment.interview.feedback.read` rather than behind the application's own permission.
 *
 * One feedback request per interview **on this one application**, which is the bound the API itself
 * set by returning that list.
 */
export const loadApplicationDetail = async (
  snapshot: ApplicationSnapshot,
): Promise<ApplicationForDisplay> => {
  const [candidate, panels] = await Promise.all([
    read<CandidateSnapshot>(`/recruitment/candidates/${snapshot.application.candidateId}`),
    Promise.all(
      snapshot.interviews.map(async (interview) => ({
        interviewId: interview.interviewId,
        feedback: await read<readonly FeedbackView[]>(
          `/recruitment/interviews/${interview.interviewId}/feedback`,
        ),
      })),
    ),
  ]);

  return { snapshot, candidate, panels };
};
