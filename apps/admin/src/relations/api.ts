import { loadPortalProcessEnvironment } from '@work/config';
import type { EmploymentView } from '@work/employment/contracts';
import type {
  ApplicableActionView,
  CaseHistoryView,
  DisciplinaryActionView,
  EscalationContextView,
  InvestigationView,
  ViolationCategoryView,
  ViolationView,
} from '@work/relations/contracts';

/**
 * Reading Employee Relations from the API.
 *
 * The types come from the module's published *contracts*, never from its internals. Eight of them —
 * every investigation, case, escalation and disciplinary view — were written for
 * `contracts/views.ts` and had never been re-exported, so this slice added the exports and nothing
 * else. No route changed, no permission changed, and the reads answer exactly what they answered
 * before.
 *
 * **There is deliberately no tenant-wide relations register.** The only collection read of
 * violations takes an `employmentId`; in the module's own words, a query returning every
 * disciplinary matter in an organisation is a watchlist rather than a case file, and nobody
 * approved one. So this slice has no listing screen and does not assemble one: its entry point is
 * one employment's record, and its subject is one case.
 *
 * **One grant answers nearly everything, and that shapes the screens.** `relations.violation.read`
 * reaches the case, its history, the fact that inquiries exist, the repeat position and the issued
 * action, so unlike the Assets screens there is no section-by-section permission split to render —
 * one refusal is the whole case file refused. The two real seams are the catalogue
 * (`relations.category.read`, a fallback to the code when refused) and an inquiry's findings
 * (`relations.investigation.read-findings`), which the module withholds *inside* the payload:
 * absent fields, never blanked ones, indistinguishable from an inquiry still open — and this
 * screen preserves that indistinguishability rather than guessing.
 *
 * **Reading here is being recorded.** Every violation, history, escalation and action read writes
 * an access event against the caller's name, inside the read's own transaction (AD-007). The
 * screens say so — it is the module's most customer-visible property.
 *
 * **Nothing here derives anything.** The occurrence ordinal, the repeat window, the current state
 * and the applicable rule are all derived inside the module and published; nothing in this file
 * counts, compares dates, or infers a state. There is no severity ranking, no risk score and no
 * outcome prediction, because the module publishes none and says so in its catalogue.
 */

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&pageSize=50';

/**
 * What a read that defines a route actually answered.
 *
 * `missing` is a 404 the module raised; `refused` is a 401 or a 403. Collapsing them would render a
 * not-found page at a caller who simply lacks a permission — telling them the case does not exist,
 * which is the opposite of true.
 */
export type Outcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' };

const outcome = async <TValue>(path: string): Promise<Outcome<TValue>> => {
  try {
    const response = await fetch(`${BASE}/api/v1${path}`, { cache: 'no-store' });

    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'refused' };
    return { kind: 'ok', value: (await response.json()) as TValue };
  } catch {
    return { kind: 'refused' };
  }
};

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` on every read here without exception: a disciplinary record is the most
 * sensitive thing this product renders, and a cached page of one is that record sitting somewhere
 * nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await outcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};

/** A page, or the fact that there was not one. Rows and the server's total travel together. */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

const listing = <TItem>(
  page: { readonly items: readonly TItem[]; readonly total: number } | undefined,
): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/**
 * The tenant's violation catalogue — asked for its *names*, and only as a courtesy.
 *
 * A violation already carries `categoryCode` frozen at recording time, so a screen refused the
 * catalogue still shows the code the record meant. What the catalogue adds is the bilingual name a
 * reader recognises, and losing it degrades the screen rather than breaking it.
 */
const catalogue = async (): Promise<readonly ViolationCategoryView[] | undefined> =>
  read<readonly ViolationCategoryView[]>('/relations/categories');

/**
 * One employment's relations record: the reads behind the employment relations page.
 *
 * The employment itself is asked with its outcome kept whole, because its two failure modes mean
 * different pages: a 404 is "no such employment" and renders not-found, while a refusal merely
 * costs the page its person name — AD-007 restricts relations access *independently* of ordinary
 * employee access, so a relations officer without `employment.read` is a legitimate caller and the
 * heading falls back to the identifier they arrived with.
 */
export interface EmploymentRelations {
  readonly employment: Outcome<EmploymentView>;
  readonly violations: Listing<ViolationView> | undefined;
  readonly categories: readonly ViolationCategoryView[] | undefined;
}

export const loadEmploymentRelations = async (
  employmentId: string,
): Promise<EmploymentRelations> => {
  const [employment, violations, categories] = await Promise.all([
    outcome<EmploymentView>(`/employments/${employmentId}`),
    read<{ readonly items: readonly ViolationView[]; readonly total: number }>(
      `/relations/violations?employmentId=${encodeURIComponent(employmentId)}&${PAGE}`,
    ),
    catalogue(),
  ]);

  return { employment, violations: listing(violations), categories };
};

/** One case: the read that defines the route, so its outcome is kept whole. */
export const loadCase = async (violationId: string): Promise<Outcome<ViolationView>> =>
  outcome<ViolationView>(`/relations/violations/${violationId}`);

/**
 * Everything else the case screen shows, in one round of parallel requests.
 *
 * The issued action's outcome is kept whole because its 404 is not the route's 404: the module
 * answers `not_found` for a case nothing was issued on — deliberately the same answer another
 * tenant's case gives — and by the time this runs the violation itself has already resolved, so
 * `missing` here means *no action has been issued*, which is an empty state and never a withheld
 * one.
 *
 * The escalation read is asked `asAt` the violation's own conduct date, which is the reference the
 * module used to derive this violation's ordinal — so the window on the screen is the window the
 * ordinal came from, not a different one measured from today.
 */
export interface CaseContext {
  readonly history: CaseHistoryView | undefined;
  readonly investigations: Listing<InvestigationView> | undefined;
  readonly escalation: EscalationContextView | undefined;
  readonly applicable: ApplicableActionView | undefined;
  readonly action: Outcome<DisciplinaryActionView>;
  readonly categories: readonly ViolationCategoryView[] | undefined;
}

export const loadCaseContext = async (violation: ViolationView): Promise<CaseContext> => {
  const id = violation.violationId;
  const escalationQuery =
    `employmentId=${encodeURIComponent(violation.employmentId)}` +
    `&violationCategoryId=${encodeURIComponent(violation.violationCategoryId)}` +
    `&asAt=${encodeURIComponent(violation.occurredOn)}`;

  const [history, investigations, escalation, applicable, action, categories] = await Promise.all([
    read<CaseHistoryView>(`/relations/cases/${id}/history`),
    read<{ readonly items: readonly InvestigationView[]; readonly total: number }>(
      `/relations/investigations?violationId=${encodeURIComponent(id)}&${PAGE}`,
    ),
    read<EscalationContextView>(`/relations/violations/escalation?${escalationQuery}`),
    read<ApplicableActionView>(`/relations/cases/${id}/applicable-action`),
    outcome<DisciplinaryActionView>(`/relations/cases/${id}/action`),
    catalogue(),
  ]);

  return {
    history,
    investigations: listing(investigations),
    escalation,
    applicable,
    action,
    categories,
  };
};
