import { loadPortalProcessEnvironment } from '@work/config';
import type { EmploymentView } from '@work/employment/contracts';

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
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a workforce shown as at a date must not be a cached answer for a
 * different date — and because the whole point of the `asOf` parameter is that the answer changes
 * with it.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/employments${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

/**
 * The workforce listing, and nothing about any single employment.
 *
 * This loader used to make a second request — the *first row's* history — so the directory could
 * demonstrate a timeline. That history rendered under a heading that named nobody, which made the
 * screen a display of one arbitrary person's employment history. A history belongs to the
 * employment whose record is being read, so it is loaded by the employee record, keyed on the
 * requested employment, and never by position in a page.
 */
export const loadWorkforce = async (asOf?: string): Promise<WorkforceForDisplay> => {
  const query = asOf === undefined ? '' : `?asOf=${encodeURIComponent(asOf)}`;
  const page = await read<Page<EmploymentView>>(query);

  if (page === undefined) return { employments: [], unavailable: true };

  return { employments: page.items, unavailable: false };
};
