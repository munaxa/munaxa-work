import { loadPortalProcessEnvironment } from '@work/config';
import type { CandidateView, RequisitionView, VacancyView } from '@work/recruitment/contracts';

/**
 * Reading the hiring pipeline from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032). So
 * these calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page, because "not signed in yet" is the expected
 * condition today rather than a fault.
 */

export interface HiringForDisplay {
  readonly requisitions: readonly RequisitionView[];
  readonly vacancies: readonly VacancyView[];
  readonly candidates: readonly CandidateView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/recruitment${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

export const loadHiring = async (): Promise<HiringForDisplay> => {
  const requisitions = await read<Page<RequisitionView>>('/requisitions');

  if (requisitions === undefined) {
    return { requisitions: [], vacancies: [], candidates: [], unavailable: true };
  }

  const vacancies = await read<Page<VacancyView>>('/vacancies');
  const candidates = await read<Page<CandidateView>>('/candidates');

  return {
    requisitions: requisitions.items,
    vacancies: vacancies?.items ?? [],
    candidates: candidates?.items ?? [],
    unavailable: false,
  };
};
