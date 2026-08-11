import { loadPortalProcessEnvironment } from '@work/config';
import type {
  ApprovalDecisionView,
  IssuedLetterDetailView,
  IssuedLetterView,
  LetterRequestView,
  LetterTemplateVersionView,
  LetterTemplateView,
  LettersReconciliationFindingView,
} from '@work/letters/contracts';

/**
 * Reading the letter register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals. **Nothing here
 * touches a repository or a database.**
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page.
 *
 * **The detail read is expected to fail for some callers.** What a letter *said* includes its
 * substituted values, and those may include a salary figure — so the register listing carries none
 * of them and opening one is a separate read. A caller who sees the register and not the values is
 * meeting a permission boundary, and the screen says so.
 *
 * **No file is fetched, because none exists.** An issued letter carries its content and no artefact:
 * there is no renderer in this repository.
 */

export interface LettersForDisplay {
  readonly templates: readonly LetterTemplateView[];
  readonly versions: readonly LetterTemplateVersionView[];
  readonly requests: readonly LetterRequestView[];
  readonly decisions: readonly ApprovalDecisionView[];
  readonly issued: readonly IssuedLetterView[];
  /** One issued letter in full, including what it said. Absent when the caller may not see it. */
  readonly detail: IssuedLetterDetailView | undefined;
  readonly findings: readonly LettersReconciliationFindingView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when a letter is listed but its values are not readable: a boundary, not an outage. */
  readonly valuesWithheld: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/letters${path}`, { cache: 'no-store' });

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

const EMPTY: LettersForDisplay = {
  templates: [],
  versions: [],
  requests: [],
  decisions: [],
  issued: [],
  detail: undefined,
  findings: [],
  unavailable: true,
  valuesWithheld: false,
};

/**
 * The reads the screen makes.
 *
 * The template listing is read first and its failure is the signal: if the service will not answer
 * the cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadLetters = async (): Promise<LettersForDisplay> => {
  const templates = await read<{ readonly items: readonly LetterTemplateView[] }>('/templates');

  if (templates === undefined) return EMPTY;

  const first = templates.items[0];
  const requests = itemsOf(await read<Page<LetterRequestView>>('/requests?page=1&size=50'));
  const issued = itemsOf(await read<Page<IssuedLetterView>>('/issued?page=1&size=50'));

  return {
    ...EMPTY,
    unavailable: false,
    templates: templates.items,
    versions:
      first === undefined
        ? []
        : ((
            await read<{ readonly versions: readonly LetterTemplateVersionView[] }>(
              `/templates/${first.letterTemplateId}`,
            )
          )?.versions ?? []),
    requests,
    decisions: await decisionsFor(requests[0]),
    issued,
    ...(await forIssued(issued[0])),
    findings:
      (
        await read<{ readonly findings: readonly LettersReconciliationFindingView[] }>(
          '/requests/reconciliation',
        )
      )?.findings ?? [],
  };
};

const decisionsFor = async (
  request: LetterRequestView | undefined,
): Promise<readonly ApprovalDecisionView[]> => {
  if (request === undefined) return [];

  const detail = await read<{ readonly decisions: readonly ApprovalDecisionView[] }>(
    `/requests/${request.letterRequestId}`,
  );

  return detail?.decisions ?? [];
};

/** What one letter said. A separate read because the values may include pay. */
const forIssued = async (
  letter: IssuedLetterView | undefined,
): Promise<Pick<LettersForDisplay, 'detail' | 'valuesWithheld'>> => {
  if (letter === undefined) return { detail: undefined, valuesWithheld: false };

  const detail = await read<IssuedLetterDetailView>(`/issued/${letter.issuedLetterId}`);

  // The letter was listed and its values were not readable. That difference is a permission
  // boundary, and the screen says which rather than showing an empty panel.
  return { detail, valuesWithheld: detail === undefined };
};
