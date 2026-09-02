import type { DuplicateCandidateView, PersonView } from '@work/people/contracts';
import { apiRead } from '../shell/api-request';

/**
 * Reading the register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about. In this module it matters twice over: the contracts are also where the
 * redaction is expressed, so a screen written against them cannot accidentally render a field the
 * API withheld.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet"
 * is the expected condition today rather than a fault.
 */

export interface RegisterForDisplay {
  readonly people: readonly PersonView[];
  readonly duplicates: readonly DuplicateCandidateView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a register shown as at a date must not be a cached answer for a
 * different date — and because the whole point of the `asOf` parameter is that the answer changes
 * with it. It matters more here than for an org chart: a cached page of personal data is a page of
 * personal data sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> =>
  apiRead<TValue>(`/people${path}`);

interface Page<TItem> {
  readonly items: readonly TItem[];
}

export const loadRegister = async (asOf?: string): Promise<RegisterForDisplay> => {
  const query = asOf === undefined ? '' : `?asOf=${encodeURIComponent(asOf)}`;
  // Issued together rather than in sequence: two round trips one after another is twice the
  // latency for a page that needs both before it renders anything.
  const [people, duplicates] = await Promise.all([
    read<Page<PersonView>>(query),
    read<Page<DuplicateCandidateView>>('/duplicates?status=pending'),
  ]);

  return {
    people: people?.items ?? [],
    duplicates: duplicates?.items ?? [],
    unavailable: people === undefined,
  };
};
