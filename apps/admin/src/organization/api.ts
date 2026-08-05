import { loadPortalProcessEnvironment } from '@work/config';
import type {
  LegalEntityView,
  OrganizationTree,
  OrganizationUnitTypeView,
  TenantSettingsView,
} from '@work/organization/contracts';

/**
 * Reading the organization from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is
 * what the lint layer enforces and what keeps this screen from breaking on a refactor it has no
 * business knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in
 * yet" is the expected condition today rather than a fault. The moment Platform's adapter lands,
 * the same code shows real data.
 */

export interface OrganizationSnapshotForDisplay {
  readonly tree: OrganizationTree | undefined;
  readonly unitTypes: readonly OrganizationUnitTypeView[];
  readonly legalEntities: readonly LegalEntityView[];
  readonly settings: TenantSettingsView | undefined;
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

/**
 * Read through the configuration package, which validates it — so a typo in `WORK_API_URL` is a
 * startup failure rather than every request quietly 404-ing against a hostname nobody checked.
 */
const BASE = loadPortalProcessEnvironment().WORK_API_URL;

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because an org chart shown as at a date must not be a cached answer for a
 * different date — and because the whole point of the `asOf` parameter is that the answer
 * changes with it.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/organization/${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

export const loadOrganization = async (asOf?: string): Promise<OrganizationSnapshotForDisplay> => {
  const query = asOf === undefined ? '' : `?asOf=${encodeURIComponent(asOf)}`;
  // Issued together rather than in sequence: four round trips one after another is four times
  // the latency for a page that needs all of them before it renders anything.
  const [tree, unitTypes, legalEntities, settings] = await Promise.all([
    read<OrganizationTree>(`hierarchy${query}`),
    read<readonly OrganizationUnitTypeView[]>('unit-types'),
    read<readonly LegalEntityView[]>('legal-entities'),
    read<TenantSettingsView>('tenant-settings'),
  ]);

  return {
    tree,
    unitTypes: unitTypes ?? [],
    legalEntities: legalEntities ?? [],
    settings,
    unavailable: tree === undefined,
  };
};
