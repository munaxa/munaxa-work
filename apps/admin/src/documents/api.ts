import { apiRead } from '../shell/api-request.js';
import type {
  AccessEventView,
  DocumentTypeView,
  DocumentVersionView,
  DocumentView,
  ReconciliationFindingView,
  VerificationView,
} from '@work/documents/contracts';

/**
 * Reading the document register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about. **Nothing here touches a repository or a database.**
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * These calls are written against the real contract and fail closed: an unreachable or unauthorized
 * API renders the empty state rather than an error page, because "not signed in yet" is the
 * expected condition today rather than a fault.
 *
 * **Several reads are expected to fail for most callers, and that is the design.** The access trail
 * sits behind `document.audit` and reconciliation behind `document.manage`. A caller who can see
 * that a document exists and not who has looked at it gets an empty trail — which is exactly what
 * that permission separation means, and the screen says so rather than showing a blank.
 *
 * **No file ever passes through here.** There is no upload call and no download call. The screen
 * shows what a document *is*; obtaining the bytes is a separate authorized operation, and today it
 * answers that the capability is unavailable.
 */

export interface DocumentsForDisplay {
  readonly types: readonly DocumentTypeView[];
  readonly documents: readonly DocumentView[];
  readonly total: number;
  /** The document the detail sections describe: the first in the register, or nothing. */
  readonly document: DocumentView | undefined;
  readonly versions: readonly DocumentVersionView[];
  readonly verifications: readonly VerificationView[];
  readonly trail: readonly AccessEventView[];
  readonly expiring: readonly DocumentView[];
  readonly awaitingVerification: readonly DocumentView[];
  readonly findings: readonly ReconciliationFindingView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when the register is visible but the trail is not: a permission boundary, not an outage. */
  readonly trailWithheld: boolean;
}

const read = async <TValue>(path: string): Promise<TValue | undefined> =>
  apiRead<TValue>(`/documents${path}`);

interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];

const EMPTY: DocumentsForDisplay = {
  types: [],
  documents: [],
  total: 0,
  document: undefined,
  versions: [],
  verifications: [],
  trail: [],
  expiring: [],
  awaitingVerification: [],
  findings: [],
  unavailable: true,
  trailWithheld: false,
};

/**
 * The reads the screen makes.
 *
 * The type listing is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadDocuments = async (): Promise<DocumentsForDisplay> => {
  const types = await read<{ readonly items: readonly DocumentTypeView[] }>('/types');

  if (types === undefined) return EMPTY;

  const register = await read<Page<DocumentView>>('?page=1&size=50');
  const document = register?.items[0];

  return {
    ...EMPTY,
    unavailable: false,
    types: types.items,
    documents: itemsOf(register),
    total: register?.total ?? 0,
    ...(await queues()),
    findings:
      (await read<{ readonly findings: readonly ReconciliationFindingView[] }>('/reconciliation'))
        ?.findings ?? [],
    ...(document === undefined ? {} : await forDocument(document)),
  };
};

/**
 * The two queues that make this module useful day to day.
 *
 * Both are **indexed predicates**, not text searches: "what expires in the next ninety days" and
 * "what is waiting for a verifier" are the highest-value questions in the domain, and running them
 * through `ILIKE` is what would fail first at scale.
 *
 * The expiry window is fixed at ninety days here rather than read from the configured thresholds,
 * because a screen showing "expiring soon" needs one horizon and the thresholds are per type. The
 * per-document threshold each row actually crossed is on the row.
 */
const queues = async (): Promise<
  Pick<DocumentsForDisplay, 'expiring' | 'awaitingVerification'>
> => {
  const horizon = new Date(Date.now() + NINETY_DAYS).toISOString().slice(0, 10);

  return {
    expiring: itemsOf(
      await read<Page<DocumentView>>(`?page=1&size=50&expiringOnOrBefore=${horizon}`),
    ),
    awaitingVerification: itemsOf(
      await read<Page<DocumentView>>('?page=1&size=50&verificationState=pending_verification'),
    ),
  };
};

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

/** One document's versions, decisions and access trail. Each stands on its own permission. */
const forDocument = async (
  document: DocumentView,
): Promise<
  Pick<DocumentsForDisplay, 'document' | 'versions' | 'verifications' | 'trail' | 'trailWithheld'>
> => {
  const detail = await read<{
    readonly document: DocumentView;
    readonly versions: readonly DocumentVersionView[];
    readonly verifications: readonly VerificationView[];
  }>(`/${document.documentId}`);
  const trail = await read<Page<AccessEventView>>(`/${document.documentId}/audit?page=1&size=50`);

  return {
    document: detail?.document ?? document,
    versions: detail?.versions ?? [],
    verifications: detail?.verifications ?? [],
    trail: itemsOf(trail),
    // The document was readable and the trail was not. That difference is `document.audit` — a
    // boundary, not an outage, and the screen says which.
    trailWithheld: detail !== undefined && trail === undefined,
  };
};
