import { pagedResult, success, type Query, type QueryHandler } from '@work/kernel';

/**
 * The three upstream contracts Performance actually reads, answered as the real modules answer
 * them.
 *
 * Stub *query handlers on the same dispatcher* rather than fake ports. The distinction is the
 * point: the adapter under test still sends `employment.read-employment`, `employment.search` and
 * `organization.governing-legal-entity` through the dispatcher, still runs inside its bounded
 * service grant, and still maps the published view — so a change to any of those contracts' shapes
 * breaks this suite, which is what testing an adapter rather than a mock of one is for.
 *
 * Each handler declares the permission the real handler declares, so an adapter whose grant named
 * the wrong permission is refused here exactly as it would be in production.
 *
 * **`employment.search` is answered with the real filter semantics** — `managerEmploymentId`
 * resolved against the reporting line, `size` clamped to Employment's own maximum. That is D-31's
 * answer, and it is the contract this module consumes rather than one added for it.
 */

export const NOW = new Date('2027-01-10T09:00:00Z');

export const MANAGER_ID = '01900000-0000-7000-8000-00000000b001';
export const EMPLOYEE_ID = '01900000-0000-7000-8000-00000000b002';
export const PEER_ID = '01900000-0000-7000-8000-00000000b003';
export const OUTSIDER_ID = '01900000-0000-7000-8000-00000000b004';
export const UNIT_ID = '01900000-0000-7000-8000-00000000b005';
export const LEGAL_ENTITY_ID = '01900000-0000-7000-8000-00000000b006';
export const DOCUMENT_ID = '01900000-0000-7000-8000-00000000b007';

/** Employment's own page ceiling. An adapter that ignored it would enrol a fraction of a unit. */
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
  documentPresent: boolean;
}

export const upstream = (): UpstreamFacts => ({
  employments: [
    { employmentId: MANAGER_ID, status: 'active', unitId: UNIT_ID },
    {
      employmentId: EMPLOYEE_ID,
      status: 'active',
      managerEmploymentId: MANAGER_ID,
      unitId: UNIT_ID,
      positionId: '01900000-0000-7000-8000-00000000b0a1',
    },
    { employmentId: PEER_ID, status: 'active', managerEmploymentId: MANAGER_ID, unitId: UNIT_ID },
    { employmentId: OUTSIDER_ID, status: 'active', unitId: UNIT_ID },
  ],
  documentPresent: true,
});

const viewOf = (employment: UpstreamEmployment): Record<string, unknown> => ({
  employmentId: employment.employmentId,
  employmentNumber: `E-${employment.employmentId.slice(-4)}`,
  personId: `01900000-0000-7000-8000-00000000c${employment.employmentId.slice(-3)}`,
  status: employment.status,
  ...(employment.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: employment.managerEmploymentId }),
  ...(employment.unitId === undefined
    ? {}
    : {
        assignment: {
          unitId: employment.unitId,
          ...(employment.positionId === undefined ? {} : { positionId: employment.positionId }),
        },
      }),
});

interface ReadEmployment extends Query {
  readonly employmentId: string;
  readonly asOf?: Date;
}

const readEmployment = (facts: UpstreamFacts): QueryHandler<ReadEmployment, unknown> => ({
  queryName: 'employment.read-employment',
  permission: 'employment.employment.read',

  handle: (query) => {
    // The contract declares `asOf` as a `Date`. An adapter that sent a civil-date string would be
    // caught here rather than three phases later — the Phase 8 defect, made loud.
    if (query.asOf !== undefined && !(query.asOf instanceof Date)) {
      throw new TypeError('employment.read-employment expects `asOf` as a Date, not a string.');
    }

    const found = facts.employments.find(
      (employment) => employment.employmentId === query.employmentId,
    );

    return Promise.resolve(
      found === undefined
        ? { ok: false as const, error: { kind: 'not_found' as const, resource: 'employment' } }
        : success(viewOf(found)),
    );
  },
});

interface SearchEmployments extends Query {
  readonly managerEmploymentId?: string;
  readonly unitId?: string;
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

const searchEmployments = (facts: UpstreamFacts): QueryHandler<SearchEmployments, unknown> => ({
  queryName: 'employment.search',
  permission: 'employment.employment.read',

  handle: (query) => {
    if (query.asOf !== undefined && !(query.asOf instanceof Date)) {
      throw new TypeError('employment.search expects `asOf` as a Date, not a string.');
    }

    const matched = facts.employments.filter(
      (employment) =>
        (query.managerEmploymentId === undefined ||
          employment.managerEmploymentId === query.managerEmploymentId) &&
        (query.unitId === undefined || employment.unitId === query.unitId),
    );
    const size = Math.min(query.size ?? 25, EMPLOYMENT_MAX_PAGE);
    const page = query.page ?? 1;

    return Promise.resolve(
      success(
        pagedResult(
          matched.slice((page - 1) * size, page * size).map(viewOf),
          page,
          size,
          matched.length,
        ),
      ),
    );
  },
});

interface GoverningLegalEntity extends Query {
  readonly unitId: string;
}

const governingLegalEntity = (): QueryHandler<GoverningLegalEntity, unknown> => ({
  queryName: 'organization.governing-legal-entity',
  permission: 'organization.legal-entity.read',

  handle: (query) =>
    Promise.resolve(
      query.unitId === UNIT_ID
        ? success({ legalEntityId: LEGAL_ENTITY_ID })
        : { ok: false as const, error: { kind: 'not_found' as const, resource: 'legal_entity' } },
    ),
});

interface ReadDocument extends Query {
  readonly documentId: string;
}

/**
 * Documents' published read, answered as Documents answers it.
 *
 * The view it returns carries a `storageReference` that resolves to nothing, exactly as production
 * does — `StoragePort` has no adapter anywhere in this repository. Performance keeps only the
 * identifier, and this handler exists to prove the *reference* path works without pretending
 * storage does.
 */
const readDocument = (facts: UpstreamFacts): QueryHandler<ReadDocument, unknown> => ({
  queryName: 'documents.read-document',
  permission: 'document.read',

  handle: (query) =>
    Promise.resolve(
      facts.documentPresent && query.documentId === DOCUMENT_ID
        ? success({ documentId: DOCUMENT_ID, status: 'active' })
        : { ok: false as const, error: { kind: 'not_found' as const, resource: 'document' } },
    ),
});

export const upstreamHandlers = (facts: UpstreamFacts): readonly QueryHandler<Query, unknown>[] =>
  [
    readEmployment(facts),
    searchEmployments(facts),
    governingLegalEntity(),
    readDocument(facts),
  ] as readonly QueryHandler<Query, unknown>[];
