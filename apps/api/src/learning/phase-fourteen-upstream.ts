import {
  err,
  pagedResult,
  success,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

/** What a module answers when it has nothing — or, for the two flags below, when it cannot answer. */
const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

/**
 * The three upstream contracts Learning actually reads, answered as the real modules answer them.
 *
 * Stub *query handlers on the same dispatcher* rather than fake ports. The distinction is the point:
 * the adapter under test still sends `employment.read-employment`, `employment.search`,
 * `organization.unit-ancestry` and `documents.read-document` through the dispatcher, still runs
 * inside its bounded service grant, and still maps the published view — so a change to any of those
 * contracts' shapes breaks this suite, which is what testing an adapter rather than a mock of one is
 * for.
 *
 * Each handler declares the permission the real handler declares, so an adapter whose grant named
 * the wrong permission is refused here exactly as it would be in production.
 *
 * **`employment.search` is answered with the real filter semantics** — `status`, `unitId`,
 * `positionId` and `managerEmploymentId` all applied, `size` clamped to Employment's own maximum,
 * and `page` one-based. An adapter that ignored the clamp would reconcile a fraction of a workforce
 * and report success.
 *
 * **Each contract can be made to fail**, and that is not a convenience. Learning must refuse rather
 * than invent an employee, treat an unknown unit as valid, or fabricate a document — and a stub with
 * no way to fail could not tell the difference between "nobody matched" and "I could not ask".
 */

export const NOW = new Date('2026-08-12T09:00:00.000Z');
export const TODAY = '2026-08-12';

export const MANAGER_ID = '01900000-0000-7000-8000-00000000d001';
export const EMPLOYEE_ID = '01900000-0000-7000-8000-00000000d002';
export const PEER_ID = '01900000-0000-7000-8000-00000000d003';
export const ENDED_ID = '01900000-0000-7000-8000-00000000d004';
export const UNIT_ID = '01900000-0000-7000-8000-00000000d005';
export const OTHER_UNIT_ID = '01900000-0000-7000-8000-00000000d006';
export const POSITION_ID = '01900000-0000-7000-8000-00000000d007';
export const DOCUMENT_ID = '01900000-0000-7000-8000-00000000d008';

/** Employment's own page ceiling. An adapter that ignored it would reconcile a fraction. */
const EMPLOYMENT_MAX_PAGE = 100;

export interface UpstreamEmployment {
  readonly employmentId: string;
  status: string;
  managerEmploymentId?: string;
  unitId?: string;
  positionId?: string;
}

/** What the upstream modules currently say. Changed by a suite between reads. */
export interface UpstreamFacts {
  employments: UpstreamEmployment[];
  units: string[];
  documentPresent: boolean;
  /** Set by a suite to make a module stop answering, which is not the same as answering "none". */
  employmentReachable: boolean;
  organizationReachable: boolean;
}

export const upstream = (): UpstreamFacts => ({
  employments: [
    { employmentId: MANAGER_ID, status: 'active', unitId: UNIT_ID },
    {
      employmentId: EMPLOYEE_ID,
      status: 'active',
      managerEmploymentId: MANAGER_ID,
      unitId: UNIT_ID,
      positionId: POSITION_ID,
    },
    { employmentId: PEER_ID, status: 'active', managerEmploymentId: MANAGER_ID, unitId: UNIT_ID },
    { employmentId: ENDED_ID, status: 'ended', unitId: UNIT_ID },
  ],
  units: [UNIT_ID, OTHER_UNIT_ID],
  documentPresent: true,
  employmentReachable: true,
  organizationReachable: true,
});

const viewOf = (employment: UpstreamEmployment): Record<string, unknown> => ({
  employmentId: employment.employmentId,
  employmentNumber: `E-${employment.employmentId.slice(-4)}`,
  personId: `01900000-0000-7000-8000-00000000e${employment.employmentId.slice(-3)}`,
  status: employment.status,
  ...(employment.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: employment.managerEmploymentId }),
  ...(employment.unitId === undefined && employment.positionId === undefined
    ? {}
    : {
        assignment: {
          ...(employment.unitId === undefined ? {} : { unitId: employment.unitId }),
          ...(employment.positionId === undefined ? {} : { positionId: employment.positionId }),
        },
      }),
});

interface ReadEmployment extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

interface SearchEmployments extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly managerEmploymentId?: string;
  readonly unitId?: string;
  readonly positionId?: string;
  readonly page?: number;
  readonly size?: number;
}

interface UnitAncestry extends Query {
  readonly queryName: 'organization.unit-ancestry';
  readonly unitId: string;
}

interface ReadDocument extends Query {
  readonly queryName: 'documents.read-document';
  readonly documentId: string;
}

const matches = (employment: UpstreamEmployment, query: SearchEmployments): boolean =>
  (query.status === undefined || employment.status === query.status) &&
  (query.unitId === undefined || employment.unitId === query.unitId) &&
  (query.positionId === undefined || employment.positionId === query.positionId) &&
  (query.managerEmploymentId === undefined ||
    employment.managerEmploymentId === query.managerEmploymentId);

export const upstreamHandlers = (facts: UpstreamFacts): readonly QueryHandler<Query, unknown>[] => [
  {
    queryName: 'employment.read-employment',
    permission: 'employment.employment.read',
    handle: (query: ReadEmployment) => {
      if (!facts.employmentReachable) return Promise.resolve(notFound('employment_unreachable'));

      const found = facts.employments.find(
        (employment) => employment.employmentId === query.employmentId,
      );

      return Promise.resolve(found === undefined ? notFound('employment') : success(viewOf(found)));
    },
  },
  {
    queryName: 'employment.search',
    permission: 'employment.employment.read',
    handle: (query: SearchEmployments) => {
      // A module that cannot answer refuses. It does not return an empty page, which would read as
      // "nobody works here" — the failure mode Learning's reconciliation exists to refuse.
      if (!facts.employmentReachable) return Promise.resolve(notFound('employment_unreachable'));

      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(EMPLOYMENT_MAX_PAGE, Math.max(1, query.size ?? 25));
      const all = facts.employments.filter((employment) => matches(employment, query));
      const window = all.slice((page - 1) * size, page * size);

      return Promise.resolve(success(pagedResult(window.map(viewOf), page, size, all.length)));
    },
  },
  {
    queryName: 'organization.unit-ancestry',
    permission: 'organization.hierarchy.read',
    handle: (query: UnitAncestry) => {
      if (!facts.organizationReachable)
        return Promise.resolve(notFound('organization_unreachable'));

      return Promise.resolve(
        facts.units.includes(query.unitId)
          ? success({ unitId: query.unitId, ancestors: [] })
          : notFound('unit'),
      );
    },
  },
  {
    queryName: 'documents.read-document',
    permission: 'document.read',
    handle: (query: ReadDocument) =>
      Promise.resolve(
        facts.documentPresent && query.documentId === DOCUMENT_ID
          ? success({ documentId: query.documentId })
          : notFound('document'),
      ),
  },
];
