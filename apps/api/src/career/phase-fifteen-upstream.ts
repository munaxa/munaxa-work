import {
  err,
  pagedResult,
  success,
  type HandlerFailure,
  type Query,
  type QueryHandler,
  type Result,
} from '@work/kernel';

/** What a module answers when it has nothing — or, for the three flags below, when it cannot answer. */
const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

/**
 * The three upstream contracts Career actually reads, answered as the real modules answer them.
 *
 * Stub *query handlers on the same dispatcher* rather than fake ports. The distinction is the point:
 * the adapter under test still sends `employment.read-employment`, `employment.search`,
 * `organization.list-positions`, `organization.unit-ancestry` and `learning.read-history` through
 * the dispatcher, still runs inside its bounded service grant, and still maps the published view —
 * so a change to any of those contracts' shapes breaks this suite, which is what testing an adapter
 * rather than a mock of one is for.
 *
 * Each handler declares the permission the real handler declares, so an adapter whose grant named
 * the wrong permission is refused here exactly as it would be in production. `learning.read-history`
 * additionally reproduces Learning's **scope resolver**: it answers with an employment's assignments
 * only for a caller holding `assignment.read-all`, and with an empty history otherwise. Career's
 * grant names both permissions for that reason, and this stub is what proves the narrower grant
 * would silently have read as "no such assignment".
 *
 * **`organization.list-positions` reproduces the exact-identifier filter added for this phase**, and
 * reproduces it as a filter over the whole catalogue rather than as a lookup — so an adapter that
 * forgot to pass `positionId` would receive the first page of everything and wrongly conclude the
 * position exists. That is the mistake this stub is shaped to catch.
 *
 * **Each contract can be made to fail**, and that is not a convenience. Career must refuse rather
 * than invent an employment, treat an unknown position as valid, or fabricate an assignment — and a
 * stub with no way to fail could not tell the difference between "nothing matched" and "I could not
 * ask".
 *
 * **Every fact here is tenant-scoped.** The real modules are isolated by row-level security; these
 * stubs carry an explicit `tenantId` on each row and filter on the ambient context, so a Career
 * operation naming another tenant's position is refused for the same reason it would be in
 * production rather than by accident of the fixture holding different values.
 */

export const NOW = new Date('2026-08-13T09:00:00.000Z');
export const TODAY = '2026-08-13';

export const TENANT = '01930000-0000-7000-8000-0000000055aa';
export const OTHER_TENANT = '01930000-0000-7000-8000-0000000066bb';

/**
 * Deliberately **the same identifiers in both tenants**.
 *
 * Two tenants whose fixtures differ prove nothing about isolation: a read could be scoped by the
 * value rather than by the tenant and every assertion would still pass. Career's upstream references
 * are plain `uuid` columns with no foreign key, so the only thing standing between tenant A and
 * tenant B's position is the policy and the predicate — and identical identifiers are what make the
 * suite able to tell.
 */
export const EMPLOYEE_ID = '01900000-0000-7000-8000-00000000c001';
export const PEER_ID = '01900000-0000-7000-8000-00000000c002';
export const ENDED_ID = '01900000-0000-7000-8000-00000000c003';
export const POSITION_ID = '01900000-0000-7000-8000-00000000c004';
export const OTHER_POSITION_ID = '01900000-0000-7000-8000-00000000c005';
export const UNIT_ID = '01900000-0000-7000-8000-00000000c006';
export const ASSIGNMENT_ID = '01900000-0000-7000-8000-00000000c007';
export const PEER_ASSIGNMENT_ID = '01900000-0000-7000-8000-00000000c008';

/** Employment's own page ceiling. An adapter that ignored it would draw a conclusion from a slice. */
const EMPLOYMENT_MAX_PAGE = 100;
/** Organization's own page ceiling, for the same reason. */
const ORGANIZATION_MAX_PAGE = 100;

export interface UpstreamEmployment {
  readonly tenantId: string;
  readonly employmentId: string;
  status: string;
  unitId?: string;
  positionId?: string;
}

export interface UpstreamPosition {
  readonly tenantId: string;
  readonly positionId: string;
  readonly code: string;
}

export interface UpstreamAssignment {
  readonly tenantId: string;
  readonly assignmentId: string;
  readonly employmentId: string;
}

/** What the upstream modules currently say. Changed by a suite between reads. */
export interface UpstreamFacts {
  employments: UpstreamEmployment[];
  positions: UpstreamPosition[];
  units: { readonly tenantId: string; readonly unitId: string }[];
  assignments: UpstreamAssignment[];
  /** Set by a suite to make a module stop answering, which is not the same as answering "none". */
  employmentReachable: boolean;
  organizationReachable: boolean;
  learningReachable: boolean;
}

/** The same shape in both tenants, so isolation is proved by the boundary rather than by the data. */
const forTenant = (
  tenantId: string,
): Pick<UpstreamFacts, 'employments' | 'positions' | 'units' | 'assignments'> => ({
  employments: [
    {
      tenantId,
      employmentId: EMPLOYEE_ID,
      status: 'active',
      unitId: UNIT_ID,
      positionId: POSITION_ID,
    },
    { tenantId, employmentId: PEER_ID, status: 'active', unitId: UNIT_ID },
    { tenantId, employmentId: ENDED_ID, status: 'ended', unitId: UNIT_ID },
  ],
  positions: [
    { tenantId, positionId: POSITION_ID, code: 'finance-director' },
    { tenantId, positionId: OTHER_POSITION_ID, code: 'engineering-lead' },
  ],
  units: [{ tenantId, unitId: UNIT_ID }],
  assignments: [
    { tenantId, assignmentId: ASSIGNMENT_ID, employmentId: EMPLOYEE_ID },
    { tenantId, assignmentId: PEER_ASSIGNMENT_ID, employmentId: PEER_ID },
  ],
});

export const upstream = (): UpstreamFacts => {
  const mine = forTenant(TENANT);
  const theirs = forTenant(OTHER_TENANT);

  return {
    employments: [...mine.employments, ...theirs.employments],
    positions: [...mine.positions, ...theirs.positions],
    units: [...mine.units, ...theirs.units],
    assignments: [...mine.assignments, ...theirs.assignments],
    employmentReachable: true,
    organizationReachable: true,
    learningReachable: true,
  };
};

const employmentViewOf = (employment: UpstreamEmployment): Record<string, unknown> => ({
  employmentId: employment.employmentId,
  employmentNumber: `E-${employment.employmentId.slice(-4)}`,
  personId: `01900000-0000-7000-8000-00000000f${employment.employmentId.slice(-3)}`,
  status: employment.status,
  ...(employment.unitId === undefined && employment.positionId === undefined
    ? {}
    : {
        assignment: {
          ...(employment.unitId === undefined ? {} : { unitId: employment.unitId }),
          ...(employment.positionId === undefined ? {} : { positionId: employment.positionId }),
        },
      }),
});

/** Everything `PositionView` carries — including the `criticality` Career must never store. */
const positionViewOf = (position: UpstreamPosition): Record<string, unknown> => ({
  id: position.positionId,
  code: position.code,
  title: { en: position.code, ar: position.code },
  criticality: 'critical',
  status: 'active',
  metadata: {},
  effectiveFrom: NOW,
  version: 1,
});

const assignmentViewOf = (assignment: UpstreamAssignment): Record<string, unknown> => ({
  assignmentId: assignment.assignmentId,
  employmentId: assignment.employmentId,
  courseId: '01900000-0000-7000-8000-00000000ca01',
  status: 'assigned',
  source: 'manual',
  assignedOn: TODAY,
  assignedBy: 'user:learning-hr',
  overdue: false,
  version: 1,
});

interface ReadEmployment extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

interface SearchEmployments extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly positionId?: string;
  readonly page?: number;
  readonly size?: number;
}

interface ListPositions extends Query {
  readonly queryName: 'organization.list-positions';
  readonly positionId?: string;
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

interface UnitAncestry extends Query {
  readonly queryName: 'organization.unit-ancestry';
  readonly unitId: string;
}

interface ReadLearningHistory extends Query {
  readonly queryName: 'learning.read-history';
  readonly employmentId: string;
}

export interface UpstreamOptions {
  /** The tenant the ambient context is in. Every stub filters on it, as row-level security would. */
  readonly tenantOf: () => string;
  /**
   * Whether the caller holds `learning.assignment.read-all`.
   *
   * Reproduces Learning's scope resolver. Without it `learning.read-history` returns an empty
   * history rather than refusing — which is exactly why Career's grant names the permission, and why
   * a narrower grant would have read as "that assignment does not exist".
   */
  readonly readsAllLearners: () => boolean;
}

const positionHandlers = (
  facts: UpstreamFacts,
  options: UpstreamOptions,
): readonly QueryHandler<Query, unknown>[] => [
  {
    queryName: 'organization.list-positions',
    permission: 'organization.position.read',
    handle: (query: ListPositions) => {
      if (!facts.organizationReachable) {
        return Promise.resolve(notFound('organization_unreachable'));
      }

      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(ORGANIZATION_MAX_PAGE, Math.max(1, query.size ?? 25));
      // Filtered over the catalogue, exactly as the real handler does. An adapter that omitted
      // `positionId` would get the first page of every position and wrongly read it as a match.
      const all = facts.positions.filter(
        (position) =>
          position.tenantId === options.tenantOf() &&
          (query.positionId === undefined || position.positionId === query.positionId),
      );
      const window = all.slice((page - 1) * size, page * size);

      return Promise.resolve(
        success(pagedResult(window.map(positionViewOf), page, size, all.length)),
      );
    },
  },
  {
    queryName: 'organization.unit-ancestry',
    permission: 'organization.hierarchy.read',
    handle: (query: UnitAncestry) => {
      if (!facts.organizationReachable) {
        return Promise.resolve(notFound('organization_unreachable'));
      }

      const known = facts.units.some(
        (unit) => unit.tenantId === options.tenantOf() && unit.unitId === query.unitId,
      );

      return Promise.resolve(
        known ? success({ unitId: query.unitId, ancestors: [] }) : notFound('unit'),
      );
    },
  },
];

/** Employment, answering one employment and a paged search over a position. */
const employmentHandlers = (
  facts: UpstreamFacts,
  options: UpstreamOptions,
): readonly QueryHandler<Query, unknown>[] => [
  {
    queryName: 'employment.read-employment',
    permission: 'employment.employment.read',
    handle: (query: ReadEmployment) => {
      if (!facts.employmentReachable) return Promise.resolve(notFound('employment_unreachable'));

      const found = facts.employments.find(
        (employment) =>
          employment.tenantId === options.tenantOf() &&
          employment.employmentId === query.employmentId,
      );

      return Promise.resolve(
        found === undefined ? notFound('employment') : success(employmentViewOf(found)),
      );
    },
  },
  {
    queryName: 'employment.search',
    permission: 'employment.employment.read',
    handle: (query: SearchEmployments) => {
      // A module that cannot answer refuses. It does not return an empty page, which would read as
      // "nobody holds this position" — a meaningful and completely different answer.
      if (!facts.employmentReachable) return Promise.resolve(notFound('employment_unreachable'));

      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(EMPLOYMENT_MAX_PAGE, Math.max(1, query.size ?? 25));
      const all = facts.employments.filter(
        (employment) =>
          employment.tenantId === options.tenantOf() &&
          (query.status === undefined || employment.status === query.status) &&
          (query.positionId === undefined || employment.positionId === query.positionId),
      );
      const window = all.slice((page - 1) * size, page * size);

      return Promise.resolve(
        success(pagedResult(window.map(employmentViewOf), page, size, all.length)),
      );
    },
  },
];

/** Learning, answering one person's history — and applying its own scope resolver while it does. */
const learningHandlers = (
  facts: UpstreamFacts,
  options: UpstreamOptions,
): readonly QueryHandler<Query, unknown>[] => [
  {
    queryName: 'learning.read-history',
    permission: 'learning.assignment.read',
    handle: (query: ReadLearningHistory) => {
      if (!facts.learningReachable) return Promise.resolve(notFound('learning_unreachable'));

      // Learning's own scope resolver: a caller without `assignment.read-all` sees nothing, and the
      // handler answers rather than refusing. Career's grant names the permission for this reason.
      const assignments = options.readsAllLearners()
        ? facts.assignments.filter(
            (assignment) =>
              assignment.tenantId === options.tenantOf() &&
              assignment.employmentId === query.employmentId,
          )
        : [];

      return Promise.resolve(
        success({
          employmentId: query.employmentId,
          asOf: TODAY,
          assignments: assignments.map(assignmentViewOf),
          enrolments: [],
          certifications: [],
          openAssignments: assignments.length,
          overdueAssignments: 0,
          completedCourses: 0,
          activeCertifications: 0,
          expiringCertifications: 0,
        }),
      );
    },
  },
];

/**
 * The three upstream modules, as query handlers on Career's own dispatcher.
 *
 * Grouped per module rather than listed flat, so the shape of each module's answers stays beside
 * the reachability flag that turns it off.
 */
export const upstreamHandlers = (
  facts: UpstreamFacts,
  options: UpstreamOptions,
): readonly QueryHandler<Query, unknown>[] => [
  ...employmentHandlers(facts, options),
  ...positionHandlers(facts, options),
  ...learningHandlers(facts, options),
];
