import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { posture, establishmentTimeline } from '../domain/establishment.js';
import type { LegalEntityState } from '../domain/legal-entity.js';
import type { OrganizationUnitState } from '../domain/organization-unit.js';
import type {
  EstablishmentPostureView,
  GoverningLegalEntity,
  LegalEntityView,
  OrganizationTree,
  OrganizationTreeNode,
  OrganizationUnitView,
  UnitPlacementView,
} from '../contracts/views.js';

import { ancestorsOf, childIndexAt, loadPlacementIndex, parentOfOn, rootsAt } from './hierarchy.js';
import { legalEntityView, placementView, unitView } from './organization-views.js';
import { notFound } from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The queries that answer questions about the *shape* of the organization.
 *
 * Every one of them takes an `asOf` date, defaulted to now. That is the phase's central claim
 * made usable: "what did this structure look like on this date" is not a report somebody builds
 * later, it is the ordinary way this module is read, and today's chart is just the case where
 * the date is today.
 */

const at = (asOf: Date | undefined, dependencies: OrganizationDependencies): Date =>
  asOf ?? dependencies.clock.now();

export interface ReadHierarchy extends Query {
  readonly queryName: 'organization.hierarchy';
  readonly asOf?: Date;
  /** Restricts the answer to the subtree beneath one unit, which is what a branch admin sees. */
  readonly rootUnitId?: string;
}

export const readHierarchyHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ReadHierarchy, OrganizationTree> => ({
  queryName: 'organization.hierarchy',
  permission: OrganizationPermissions.hierarchyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = at(query.asOf, dependencies);
      const index = await loadPlacementIndex(dependencies.stores.placements, transaction);
      const units = await dependencies.stores.units.all(transaction);
      const existing = new Map(
        units
          .filter((unit) => existsOn(unit, asOf))
          .map((unit) => [unit.id, unitView(unit)] as const),
      );
      const children = childIndexAt(index, asOf);
      const roots = rootsAt(index, asOf).filter((id) => existing.has(id));

      if (query.rootUnitId !== undefined && !existing.has(query.rootUnitId)) {
        return notFound<OrganizationTree>('unit');
      }

      const emitted = new Set<string>();
      const tops = query.rootUnitId === undefined ? roots : [query.rootUnitId];
      const assembled = tops.flatMap((id) => build(id, existing, children, emitted));

      // A unit that exists but is in nobody's structure on this date: created, not yet placed,
      // or detached and not re-placed. Real, and deliberately reported rather than dropped —
      // a chart that silently omits a branch is how one gets forgotten.
      const unplacedUnitIds = [...existing.keys()].filter(
        (id) =>
          !emitted.has(id) && parentOfOn(index, id, asOf) === undefined && !roots.includes(id),
      );

      return success({ asOf, roots: assembled, unplacedUnitIds });
    }),
});

/**
 * Assembles a subtree.
 *
 * `placed` guards against a cycle the same way the ancestor walk does: a node already emitted is
 * not descended into again, so a structure that somehow acquired a loop produces a truncated
 * tree rather than exhausting the stack. The write path refuses cycles; this is the read path
 * refusing to be the thing that falls over if one ever existed.
 */
const build = (
  unitId: string,
  units: ReadonlyMap<string, OrganizationUnitView>,
  children: ReadonlyMap<string, readonly string[]>,
  emitted: Set<string>,
): readonly OrganizationTreeNode[] => {
  const unit = units.get(unitId);

  if (unit === undefined || emitted.has(unitId)) return [];
  emitted.add(unitId);

  return [
    {
      unit,
      children: (children.get(unitId) ?? []).flatMap((child) =>
        build(child, units, children, emitted),
      ),
    },
  ];
};

const existsOn = (unit: OrganizationUnitState, asOf: Date): boolean => {
  const time = asOf.getTime();
  if (time < unit.effectiveFrom.getTime()) return false;
  return unit.effectiveTo === undefined || time < unit.effectiveTo.getTime();
};

export interface ReadUnitAncestry extends Query {
  readonly queryName: 'organization.unit-ancestry';
  readonly unitId: string;
  readonly asOf?: Date;
}

export interface UnitAncestry {
  readonly unitId: string;
  readonly asOf: Date;
  readonly parentUnitId: string | undefined;
  /** Nearest first, up to the root. Never bounded by a fixed depth (AD-003). */
  readonly ancestors: readonly OrganizationUnitView[];
}

export const readUnitAncestryHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ReadUnitAncestry, UnitAncestry> => ({
  queryName: 'organization.unit-ancestry',
  permission: OrganizationPermissions.hierarchyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const unit = await dependencies.stores.units.byId(transaction, query.unitId);

      if (unit === undefined) return notFound<UnitAncestry>('unit');

      const asOf = at(query.asOf, dependencies);
      const index = await loadPlacementIndex(dependencies.stores.placements, transaction);
      const chain = ancestorsOf(index, query.unitId, asOf);
      const states = await dependencies.stores.units.byIds(transaction, chain);
      const byId = new Map(states.map((state) => [state.id, state] as const));

      return success({
        unitId: query.unitId,
        asOf,
        parentUnitId: parentOfOn(index, query.unitId, asOf),
        ancestors: chain
          .map((id) => byId.get(id))
          .filter((state): state is OrganizationUnitState => state !== undefined)
          .map(unitView),
      });
    }),
});

export interface ResolveGoverningLegalEntity extends Query {
  readonly queryName: 'organization.governing-legal-entity';
  readonly unitId: string;
  readonly asOf?: Date;
}

/**
 * Which legal entity — and therefore which country's law — governs a unit on a date.
 *
 * This is the query Phase 11.1 depends on, and the single most load-bearing read in this module.
 * 00B is explicit: *an employment resolves its country pack from its legal entity, not from the
 * tenant*. The walk goes up from the unit until it finds a registration, so a team inside a
 * department inside a branch of a Jordanian company resolves to Jordan, and its sibling under
 * the Saudi company resolves to Saudi Arabia, in the same tenant, on the same request.
 *
 * When nothing is found the answer is `undefined` rather than a default. A tenant-level fallback
 * is exactly the mistake 00B names — it would silently compute somebody's end of service under
 * the wrong country's law, and produce a number that looks right.
 */
export const resolveGoverningLegalEntityHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ResolveGoverningLegalEntity, GoverningLegalEntity> => ({
  queryName: 'organization.governing-legal-entity',
  permission: OrganizationPermissions.legalEntityRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const unit = await dependencies.stores.units.byId(transaction, query.unitId);

      if (unit === undefined) return notFound<GoverningLegalEntity>('unit');

      const asOf = at(query.asOf, dependencies);
      const index = await loadPlacementIndex(dependencies.stores.placements, transaction);
      const chain = [query.unitId, ...ancestorsOf(index, query.unitId, asOf)];
      const entities = await dependencies.stores.legalEntities.forUnits(transaction, chain);
      const byUnit = new Map(entities.map((entity) => [entity.unitId, entity] as const));

      return success(nearest(query.unitId, asOf, chain, byUnit));
    }),
});

const nearest = (
  unitId: string,
  asOf: Date,
  chain: readonly string[],
  byUnit: ReadonlyMap<string, LegalEntityState>,
): GoverningLegalEntity => {
  const walked: string[] = [];

  for (const candidate of chain) {
    const entity = byUnit.get(candidate);

    // Effective dating applies to the answer as much as to the walk: an entity closed before
    // this date did not govern anybody on this date, and the walk continues past it.
    if (entity !== undefined && governsOn(entity, asOf)) {
      return { unitId, asOf, legalEntity: legalEntityView(entity), throughUnitIds: walked };
    }
    if (candidate !== unitId) walked.push(candidate);
  }
  return { unitId, asOf, legalEntity: undefined, throughUnitIds: walked };
};

const governsOn = (entity: LegalEntityState, asOf: Date): boolean => {
  const time = asOf.getTime();
  if (time < entity.effectiveFrom.getTime()) return false;
  return entity.effectiveTo === undefined || time < entity.effectiveTo.getTime();
};

export interface ReadEstablishmentPosture extends Query {
  readonly queryName: 'organization.establishment-posture';
  readonly unitId: string;
  readonly asOf?: Date;
}

/**
 * Approved, filled and vacant for every position budgeted in a unit on a date.
 *
 * `filled` comes from the `FilledHeadcountPort`, which Employment supplies from Phase 5. Until
 * then it answers zero for everything — honestly and by construction, because there are no
 * assignments to count. Organization never counts employees itself (AD-002).
 */
export const readEstablishmentPostureHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ReadEstablishmentPosture, readonly EstablishmentPostureView[]> => ({
  queryName: 'organization.establishment-posture',
  permission: OrganizationPermissions.establishmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = at(query.asOf, dependencies);
      const lines = await dependencies.stores.establishments.forUnit(transaction, query.unitId);
      const byPosition = groupByPosition(lines);
      const views: EstablishmentPostureView[] = [];

      for (const [positionId, periods] of byPosition) {
        const inForce = establishmentTimeline(periods).at(asOf);
        const approved =
          inForce !== undefined && inForce.value.status === 'approved'
            ? inForce.value.budgetedHeadcount
            : 0;
        const filled = await dependencies.filled.filledFor(positionId, query.unitId, asOf);

        views.push({ positionId, unitId: query.unitId, asOf, ...posture(approved, filled) });
      }
      return success(views);
    }),
});

const groupByPosition = <TLine extends { readonly positionId: string }>(
  lines: readonly TLine[],
): ReadonlyMap<string, readonly TLine[]> => {
  const grouped = new Map<string, TLine[]>();

  for (const line of lines) {
    const existing = grouped.get(line.positionId);

    if (existing === undefined) grouped.set(line.positionId, [line]);
    else existing.push(line);
  }
  return grouped;
};

export interface ListPlacementHistory extends Query {
  readonly queryName: 'organization.placement-history';
  readonly unitId: string;
}

export const listPlacementHistoryHandler = (
  dependencies: OrganizationDependencies,
): QueryHandler<ListPlacementHistory, readonly UnitPlacementView[]> => ({
  queryName: 'organization.placement-history',
  permission: OrganizationPermissions.hierarchyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const periods = await dependencies.stores.placements.forUnit(transaction, query.unitId);

      return success([...periods].sort(byStart).map(placementView));
    }),
});

const byStart = (
  left: { readonly effectiveFrom: Date },
  right: { readonly effectiveFrom: Date },
): number => left.effectiveFrom.getTime() - right.effectiveFrom.getTime();

/** Loads every legal entity the tenant holds, for the export document. */
export const allLegalEntities = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
): Promise<readonly LegalEntityView[]> =>
  (await dependencies.stores.legalEntities.list(transaction)).map(legalEntityView);
