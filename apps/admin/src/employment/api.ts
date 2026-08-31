import type { EmploymentHistoryView, EmploymentView } from '@work/employment/contracts';
import { apiRead } from '../shell/api-request.js';

/**
 * Reading the workforce from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet"
 * is the expected condition today rather than a fault.
 */

export interface WorkforceForDisplay {
  readonly employments: readonly EmploymentView[];
  /** The first employment's history, so the screen can show what a timeline looks like. */
  readonly history?: EmploymentHistoryView;
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a workforce shown as at a date must not be a cached answer for a
 * different date — and because the whole point of the `asOf` parameter is that the answer changes
 * with it.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> =>
  apiRead<TValue>(`/employments${path}`);

interface Page<TItem> {
  readonly items: readonly TItem[];
}

export const loadWorkforce = async (asOf?: string): Promise<WorkforceForDisplay> => {
  const query = asOf === undefined ? '' : `?asOf=${encodeURIComponent(asOf)}`;
  const page = await read<Page<EmploymentView>>(query);

  if (page === undefined) return { employments: [], unavailable: true };

  const first = page.items[0];
  // Fetched only when there is something to fetch it for. A second round trip on an empty
  // workforce is latency spent to render nothing.
  const history =
    first === undefined
      ? undefined
      : await read<EmploymentHistoryView>(`/${first.employmentId}/history`);

  return {
    employments: page.items,
    ...(history === undefined ? {} : { history }),
    unavailable: false,
  };
};
